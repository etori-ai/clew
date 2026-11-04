import { attentionLevel, worstLevel, type Attention, type AuthenticatedContext, type Area, type Receipt, type Thread } from '@clew/contracts';
import { actorOf, receipt, type ExecuteResult, type Registry, type ThreadDraft } from '@clew/connectors';
import { InputError } from '../../context';
import type { ThreadStore } from '../model';

/**
 * The stream's use cases (D20, D25): one function per user action, the actor first, built over ports. Nothing in here
 * reads a clock, draws an id or opens a connection; `composition.ts` hands in the live adapters and the tests hand in
 * the memory ones. Every mutation writes its audit row through the same transaction as its other writes.
 */
export interface ThreadDeps {
  store: ThreadStore;
  registry: Pick<Registry, 'scan' | 'areas' | 'connector'>;
  /** Run a capability as the person, with input validation and scope: `runCapability` in the server. */
  run: <O = unknown>(persona: AuthenticatedContext, name: string, input: unknown) => Promise<O>;
  /** The calendar's proposal path, the one coupling the stream has to a module (recorded as debt in D20). */
  calendar: {
    ensureProposalThread(persona: AuthenticatedContext, source: string): Promise<Thread | undefined>;
    replan(persona: AuthenticatedContext, threadId: string, week: string): Promise<Thread>;
    dismiss(persona: AuthenticatedContext, threadId: string): Promise<Thread>;
  };
  clock: () => Date;
  ids: () => string;
}
const REOPEN_MS = 10 * 60_000;
/** Attention budget: pushed threads today against a fixed daily budget. The rest is bundled to lunch or the next morning. */
export const ATTENTION_BUDGET = 3;
const stockholmDay = (at: Date) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm' }).format(at);
const sameDraft = (t: Thread, d: ThreadDraft, items: Thread['items']) =>
  t.title === d.title && t.summary === d.summary && (t.deadline ?? null) === (d.deadline ?? null) && JSON.stringify(t.items) === JSON.stringify(items) && JSON.stringify(t.actions) === JSON.stringify(d.actions);

export function threadUsecases(deps: ThreadDeps) {
  const { store, registry, run, calendar, clock, ids } = deps;
  const inFlight = new Map<string, Promise<void>>();
  const read = async (persona: Pick<AuthenticatedContext, 'id'>, threadId: string) => (await store.readThread(persona.id, threadId))!;

  /**
   * First visit of the day and the nightly scan: every connector says what it wants to push, one open thread per topic.
   * The calendar's proposal thread keeps its own path (planner), everything else is a generic card.
   */
  function ensureThreads(persona: AuthenticatedContext, source = 'Nattlig genomgång 06:00') {
    // One scan per person at a time; a second caller waits for the first instead of pushing the same cards again.
    const running = inFlight.get(persona.id);
    if (running) return running;
    const task = scanInto(persona, source).finally(() => inFlight.delete(persona.id));
    inFlight.set(persona.id, task);
    return task;
  }
  async function scanInto(persona: AuthenticatedContext, source: string) {
    await calendar.ensureProposalThread(persona, source);
    const drafts = await registry.scan(actorOf(persona));
    const now = clock();
    for (const d of drafts) {
      const existing = await store.openThread(persona.id, d.topic);
      if (!existing) { await pushDraft(persona, d, 'assistant:scan', now); continue; }
      // An untouched open card follows its source: rows, title and deadline refresh, the person's selection survives.
      if (existing.receipt) continue;
      const items = (d.items ?? []).map(i => ({ ...i, selected: existing.items.find(x => x.ref === i.ref)?.selected ?? i.selected }));
      if (sameDraft(existing, d, items)) continue;
      await store.transaction(async tx => {
        await tx.updateThread(existing.id, { title: d.title, summary: d.summary, items, actions: d.actions, deadline: d.deadline ?? null });
        await tx.writeAudit({ actor: 'assistant:scan', action: 'thread.refreshed', subject: 'thread:' + existing.id, at: now.toISOString(), details: { connector: d.connector, topic: d.topic, owner: persona.id } });
      });
    }
  }
  /** Push one card for a person. Idempotent by (person, topic): the store refuses a second open card on the topic, across processes. */
  async function pushDraft(persona: Pick<AuthenticatedContext, 'id'>, d: ThreadDraft & { connector: string }, actor: string, now = clock()) {
    const id = ids(), at = now.toISOString();
    return store.transaction(async tx => {
      const inserted = await tx.insertThread({ id, personId: persona.id, kind: 'pushed', topic: d.topic, title: d.title, state: 'open', week: null,
        connector: d.connector, area: d.area, summary: d.summary, items: d.items ?? [], actions: d.actions, waitingOn: d.waitingOn ?? null, deadline: d.deadline ?? null,
        trigger: { reason: d.reason, source: registry.connector(d.connector)?.source ?? d.connector, at }, createdAt: at, updatedAt: at });
      if (!inserted) return undefined;
      await tx.addMessage(id, { role: 'assistant', body: d.summary, at });
      await tx.writeAudit({ actor, action: 'thread.pushed', subject: 'thread:' + id, at, details: { connector: d.connector, topic: d.topic, owner: persona.id } });
      return id;
    });
  }
  /** Areas with live counts for the sidebar. */
  async function listAreas(persona: AuthenticatedContext): Promise<Area[]> {
    const now = clock();
    const [areas, threads] = await Promise.all([registry.areas(actorOf(persona)), store.listThreads(persona.id, now.toISOString())]);
    const open = threads.filter(t => t.state === 'open' && t.kind === 'pushed');
    const today = stockholmDay(now);
    return areas.map(a => {
      const needsYou = open.filter(t => t.area === a.id && !t.waitingOn);
      return { ...a, needsYou: needsYou.length, waiting: open.filter(t => t.area === a.id && !!t.waitingOn).length, urgency: worstLevel(needsYou.map(t => attentionLevel(t, today))) };
    });
  }
  /**
   * A card action: resolve the action on the thread, merge its fixed input with the selected refs, run the capability,
   * and record the receipt. Execute actions close the thread; read actions return their output for the panel.
   */
  async function act(persona: AuthenticatedContext, threadId: string, actionId: string, refs?: string[]) {
    const thread = await store.readThread(persona.id, threadId);
    if (!thread) throw new InputError('Tråden finns inte.');
    const action = thread.actions.find(a => a.id === actionId);
    if (!action) throw new InputError('Okänd handling.');
    const selected = refs ?? thread.items.filter(i => i.selected).map(i => i.ref);
    if (action.usesItems && thread.items.length && selected.some(r => !thread.items.some(i => i.ref === r))) throw new InputError('Något val är inte längre aktuellt. Läs om sidan.');
    const input = { ...(action.input ?? {}), ...(action.usesItems ? { refs: selected } : {}) };
    if (action.kind !== 'execute') return { kind: action.kind, output: await run(persona, action.capability, input) };
    if (thread.state !== 'open') throw new InputError('Tråden är redan hanterad.');
    const result = await run<ExecuteResult>(persona, action.capability, input);
    const now = clock(), at = now.toISOString(), r: Receipt = receipt(result, now);
    await store.transaction(async tx => {
      const items = thread.items.map(i => ({ ...i, selected: selected.includes(i.ref) }));
      await tx.updateThread(threadId, { state: 'handled', handledAt: at, updatedAt: at, receipt: r, items });
      await tx.addMessage(threadId, { role: 'user', body: action.label, at });
      await tx.addMessage(threadId, { role: 'assistant', body: result.headline, at });
      await tx.writeAudit({ actor: persona.principal.id, action: 'thread.acted', subject: 'thread:' + threadId, at, details: { capability: action.capability, refs: selected, outcomes: r.rows.map(x => x.outcome), undoUntil: r.undoUntil } });
      if (r.undoUntil) await tx.scheduleJob({ id: `receipt-final:${threadId}:${now.getTime()}`, kind: 'receipt-final', runAt: r.undoUntil, payload: { threadId } });
    });
    return { kind: 'execute' as const, thread: await read(persona, threadId) };
  }
  /** Undo a receipt within its window: run the undo capability with the same refs, reopen the thread. */
  async function undoReceipt(persona: AuthenticatedContext, threadId: string) {
    const thread = await store.readThread(persona.id, threadId);
    if (!thread?.receipt) throw new InputError('Det finns inget att ångra.');
    const r = thread.receipt, now = clock(), at = now.toISOString();
    if (!r.undoCapability || !r.undoUntil || Date.parse(r.undoUntil) < now.getTime()) throw new InputError('Ångerfönstret har gått ut.');
    const refs = r.rows.filter(x => x.outcome === 'done').map(x => x.ref);
    const result = await run<ExecuteResult>(persona, r.undoCapability, { refs });
    await store.transaction(async tx => {
      await tx.updateThread(threadId, { state: 'open', handledAt: null, updatedAt: at, receipt: null });
      await tx.addMessage(threadId, { role: 'user', body: 'Ångra', at });
      await tx.addMessage(threadId, { role: 'assistant', body: result.headline, at });
      await tx.writeAudit({ actor: persona.principal.id, action: 'thread.undone', subject: 'thread:' + threadId, at, details: { capability: r.undoCapability, refs } });
    });
    return read(persona, threadId);
  }
  /** The undo window of a receipt has passed (scheduler): the receipt stays, the Ångra button goes. */
  async function closeReceiptWindow(threadId: string) {
    const thread = await store.readThreadById(threadId);
    if (thread?.state !== 'handled' || !thread.receipt?.undoUntil) return;
    const at = clock().toISOString();
    await store.transaction(async tx => {
      await tx.updateThread(threadId, { receipt: { ...thread.receipt!, undoUntil: null, undoCapability: null }, updatedAt: at });
      await tx.writeAudit({ actor: 'system:scheduler', action: 'thread.receipt_final', subject: 'thread:' + threadId, at });
    });
  }
  async function dismissThread(persona: AuthenticatedContext, threadId: string, reason = 'inte aktuellt') {
    const thread = await store.readThread(persona.id, threadId);
    if (!thread || thread.state !== 'open') throw new InputError('Tråden är redan hanterad.');
    const at = clock().toISOString();
    await store.transaction(async tx => {
      await tx.updateThread(threadId, { state: 'dismissed', handledAt: at, updatedAt: at });
      await tx.addMessage(threadId, { role: 'user', body: `Avfärdad · ${reason}`, at });
      await tx.writeAudit({ actor: persona.principal.id, action: 'thread.dismissed', subject: 'thread:' + threadId, at, details: { reason } });
    });
    return read(persona, threadId);
  }
  /** Snooze: keep the thread open but hide it until the next bundle (tomorrow 06:00). Stored as a deadline-free `waitingOn`. */
  async function snoozeThread(persona: AuthenticatedContext, threadId: string) {
    const thread = await store.readThread(persona.id, threadId);
    if (!thread || thread.state !== 'open') throw new InputError('Tråden är redan hanterad.');
    const at = clock().toISOString();
    await store.transaction(async tx => {
      await tx.updateThread(threadId, { waitingOn: 'i morgon 06:00', updatedAt: at });
      await tx.addMessage(threadId, { role: 'user', body: 'Inte nu', at });
      await tx.writeAudit({ actor: persona.principal.id, action: 'thread.snoozed', subject: 'thread:' + threadId, at });
    });
    return read(persona, threadId);
  }
  /**
   * The Ångra row after Avfärda or Inte nu: a dismissed thread comes back within ten minutes, a snoozed one any time.
   * Proposal threads whose drawn times were declined get them redrawn by the planner.
   */
  async function reopenThread(persona: AuthenticatedContext, threadId: string) {
    const t = await store.readThread(persona.id, threadId);
    if (!t) throw new InputError('Tråden finns inte.');
    const now = clock(), at = now.toISOString();
    const snoozed = t.state === 'open' && t.waitingOn === 'i morgon 06:00';
    const dismissed = t.state === 'dismissed' && !!t.handledAt && now.getTime() - Date.parse(t.handledAt) <= REOPEN_MS;
    if (!snoozed && !dismissed) throw new InputError(t.state === 'dismissed' ? 'Ångerfönstret har gått ut.' : 'Tråden går inte att återöppna.');
    await store.transaction(async tx => {
      await tx.updateThread(threadId, { state: 'open', handledAt: null, waitingOn: null, updatedAt: at });
      await tx.addMessage(threadId, { role: 'user', body: 'Ångra', at });
      await tx.writeAudit({ actor: persona.principal.id, action: 'thread.reopened', subject: 'thread:' + threadId, at, details: { from: snoozed ? 'snoozed' : 'dismissed' } });
    });
    if (dismissed && t.week && t.proposals.length && !t.proposals.some(p => p.status === 'proposed')) return calendar.replan(persona, threadId, t.week);
    return read(persona, threadId);
  }
  async function attentionFor(persona: AuthenticatedContext): Promise<Attention> {
    const since = clock(); since.setHours(0, 0, 0, 0);
    const used = await store.countPushedSince(persona.id, since.toISOString());
    return { used, budget: ATTENTION_BUDGET, bundledUntil: used >= ATTENTION_BUDGET ? 'i morgon 06:00' : null };
  }
  /** The person's own threads, newest first, as the stream shows them. */
  const listThreadsFor = (persona: Pick<AuthenticatedContext, 'id'>) => store.listThreads(persona.id, clock().toISOString());
  /** One of the person's threads, or undefined when it is not theirs. */
  const threadFor = (persona: Pick<AuthenticatedContext, 'id'>, threadId: string) => store.readThread(persona.id, threadId);
  /** Avfärda from the card: proposal threads decline their drawn times through the planner, every other card is dismissed as is. */
  async function dismissAny(persona: AuthenticatedContext, threadId: string) {
    const thread = await threadFor(persona, threadId);
    if (!thread) throw new InputError('Tråden finns inte.');
    return thread.proposals.length ? calendar.dismiss(persona, threadId) : dismissThread(persona, threadId);
  }
  return { ensureThreads, pushDraft, listAreas, act, undoReceipt, closeReceiptWindow, dismissThread, snoozeThread, reopenThread, attentionFor, listThreadsFor, threadFor, dismissAny };
}
export type ThreadUsecases = ReturnType<typeof threadUsecases>;
