import {
  unresolvedExecution,
  attentionLevel,
  dayRhythm,
  isSnoozed,
  MAX_SNOOZE_DAYS,
  nextStockholmTime,
  parseSwedishTime,
  snoozePresets,
  snoozeWhen,
  stockholmDate,
  stockholmInstant,
  worstLevel,
  type Attention,
  type AuthenticatedContext,
  type Area,
  type ConversationPage,
  type ItemEvents,
  type Receipt,
  type SnoozeInput,
  type SnoozePreset,
  type Thread,
} from '@clew/contracts';
import {
  CONVERSATION_PAGE,
  cursorOf,
  cursorText,
  HISTORY_LIMIT,
  historySubjects,
  itemEvents,
  reminderStart,
  rhythmFor,
} from '../domain';
import {
  audiencedActorOf,
  givenBy,
  pathOf,
  receipt,
  type Actor,
  type ExecuteResult,
  type Registry,
  type ThreadDraft,
} from '@clew/connectors';
import { InputError } from '../../context';
import type { ThreadStore, ThreadTx } from '../model';
import { threadAccess } from '../access';

/**
 * The stream's use cases (D20, D25): one function per user action, the actor first, built over ports. Nothing in here
 * reads a clock, draws an id or opens a connection; `composition.ts` hands in the live adapters and the tests hand in
 * the memory ones. Every mutation writes its audit row through the same transaction as its other writes.
 */
export interface ThreadDeps {
  store: ThreadStore;
  registry: Pick<Registry, 'areas' | 'connector' | 'visible' | 'find' | 'viewFor' | 'allowed'>;
  /** Run a capability as the person, with input validation and scope: `runCapability` in the server. */
  run: <O = unknown>(persona: AuthenticatedContext, name: string, input: unknown) => Promise<O>;
  /** The calendar's proposal path, the one coupling the stream has to a module (recorded as debt in D20). */
  calendar: {
    replan(persona: AuthenticatedContext, threadId: string, week: string): Promise<Thread>;
    dismiss(persona: AuthenticatedContext, threadId: string): Promise<Thread>;
    /** Today's timed meetings, for the preset "när jag är tillbaka från …" (D29). Empty when the calendar cannot be read. */
    todayEvents(persona: AuthenticatedContext): Promise<Array<{ title: string; end: string }>>;
  };
  /** The timers behind a snooze (D29, D49): the same reminder workflow as D17, and the same return. */
  clock: () => Date;
  ids: () => string;
}
const REOPEN_MS = 10 * 60_000;
/** Attention budget: pushed threads today against a fixed daily budget. The rest is bundled to lunch or the next morning. */
export const ATTENTION_BUDGET = 3;
export function threadUsecases(deps: ThreadDeps) {
  const { store, registry, run, calendar, clock, ids } = deps;
  const access = threadAccess(store, registry);
  /**
   * A card as the API answers it (D112 item 10): each propose or execute of the card's own connector carries its path,
   * what it asks the person and whether it says beforehand what it writes, from the registered declaration on every read.
   * The store keeps the draft's actions as they came; a path never comes from a draft.
   */
  const pathed = (thread: Thread): Thread => ({
    ...thread,
    actions: thread.actions.map(({ path: _, ...action }) => {
      const found = registry.find(action.capability);
      const path =
        found && found.connector.id === thread.connector
          ? pathOf(found.capability, givenBy(found.capability, action))
          : undefined;
      return path ? { ...action, path } : action;
    }),
  });
  const read = async (persona: Pick<AuthenticatedContext, 'id'>, threadId: string) =>
    pathed((await store.readThread(persona.id, threadId))!);

  /**
   * Clear a snooze whose time has passed and say so, in the sweep's transaction. The timer, if any, is ended quietly. A
   * source that changes the work clears the snooze on the refresh path instead (`refresh.ts`, D28).
   */
  async function wake(tx: ThreadTx, thread: Thread, at: string) {
    await tx.updateThread(thread.id, { snoozedUntil: null, updatedAt: at });
    await tx.writeAudit({
      actor: 'assistant:scan',
      action: 'thread.woken',
      subject: 'thread:' + thread.id,
      at,
      details: { reason: 'time', snoozedUntil: thread.snoozedUntil },
    });
    if (thread.snoozedUntil) await tx.cancelTimer(`snooze:${thread.id}`, at);
  }
  /** The sweep (D28): every open card whose snooze has run out is awake again. Runs before every read of the stream. */
  async function wakeDue(persona: Pick<AuthenticatedContext, 'id'>) {
    const now = clock().toISOString();
    const due = (await store.listThreads(persona.id, now)).filter(
      t => t.state === 'open' && t.snoozedUntil && !isSnoozed(t, now),
    );
    for (const t of due)
      await store.transaction(async tx => {
        const current = await tx.lockThread(persona.id, t.id);
        // A live snooze timer wakes the card itself; one blocked, cancelled or fired never will, so the sweep does (DE-L11).
        if ((await tx.readTimer(`snooze:${t.id}`))?.state === 'active') return;
        if (current?.state === 'open' && current.snoozedUntil && !isSnoozed(current, now)) await wake(tx, current, now);
      });
  }
  /** Push one card for a person. Idempotent by (person, topic): the store refuses a second open card on the topic, across processes. */
  async function pushDraft(
    persona: Pick<AuthenticatedContext, 'id'> & Partial<Pick<AuthenticatedContext, 'authorizationVersion'>>,
    d: ThreadDraft & { connector: string },
    actor: string,
    now = clock(),
  ) {
    const id = ids(),
      at = now.toISOString();
    return store.transaction(async tx => {
      const inserted = await tx.insertThread({
        id,
        personId: persona.id,
        ...(persona.authorizationVersion ? { sourceAuthorization: persona.authorizationVersion } : {}),
        kind: 'pushed',
        topic: d.topic,
        title: d.title,
        state: 'open',
        week: null,
        connector: d.connector,
        area: d.area,
        summary: d.summary,
        items: d.items ?? [],
        // D135: the units the source says the card is about, kept as Clew keeps its own cards' subjects (D97 item 6).
        ...(d.subjects?.length ? { subjects: d.subjects } : {}),
        actions: d.actions,
        waitingOn: d.waitingOn ?? null,
        deadline: d.deadline ?? null,
        trigger: { reason: d.reason, source: registry.connector(d.connector)?.source ?? d.connector, at },
        createdAt: at,
        updatedAt: at,
      });
      if (!inserted) return undefined;
      await tx.addMessage(id, { role: 'assistant', body: d.summary, at });
      await tx.writeAudit({
        actor,
        action: 'thread.pushed',
        subject: 'thread:' + id,
        at,
        details: { connector: d.connector, topic: d.topic, owner: persona.id },
      });
      return id;
    });
  }
  /** A new human review of definitively rejected rows; its stable id prevents replaying a successful retry. */
  async function retryRejected(persona: AuthenticatedContext, threadId: string): Promise<Thread> {
    await persona.authorize();
    const original = await access.read(persona, threadId);
    if (!original) throw new InputError('Ärendet finns inte.');
    const execution = original.execution;
    if (!execution || execution.compensates || !['failed', 'partial'].includes(execution.state))
      throw new InputError('Kontrollera källans besked innan ett nytt försök görs.');
    const action = original.actions.find(a => a.kind === 'execute' && a.role === 'primary' && a.review === 'each');
    if (!action || !registry.allowed(audiencedActorOf(persona), action.capability))
      throw new InputError('Åtgärden är inte tillgänglig.');
    const rejected = new Set(original.receipt?.rows.filter(r => r.outcome === 'failed').map(r => r.ref));
    const items = original.items
      .filter(i => rejected.has(i.ref))
      .map(({ revision: _, ...i }) => ({ ...i, selected: true }));
    if (!items.length) throw new InputError('Det finns inga avvisade rader att granska igen.');
    const id = `retry:${execution.id}`,
      at = clock().toISOString();
    await store.transaction(async tx => {
      const current = await tx.lockThread(persona.id, original.id);
      if (!current || current.updatedAt !== original.updatedAt || current.execution?.id !== execution.id)
        throw new InputError('Resultatet har ändrats. Läs in ärendet igen.');
      if (await tx.lockThread(persona.id, id)) return;
      await tx.insertThread({
        id,
        personId: persona.id,
        sourceAuthorization: persona.authorizationVersion,
        kind: 'pushed',
        topic: id,
        title: `Granska ${items.length} ${items.length === 1 ? 'avvisad rad' : 'avvisade rader'} igen`,
        state: 'open',
        week: null,
        connector: original.connector,
        area: original.area,
        summary: `Nytt försök efter: ${original.receipt!.headline} Tidigare bekräftade rader påverkas inte.`,
        items,
        actions: original.actions,
        waitingOn: null,
        deadline: original.deadline,
        trigger: { reason: `Nytt försök från ${original.title}`, source: original.trigger.source, at },
        createdAt: at,
        updatedAt: at,
      });
      await tx.writeAudit({
        actor: persona.principal.id,
        action: 'thread.retry_created',
        subject: 'thread:' + id,
        at,
        details: { originalThreadId: original.id, originalExecutionId: execution.id, refs: items.map(i => i.ref) },
      });
    });
    return pathed((await access.read(persona, id))!);
  }
  /** Areas with live counts for the sidebar, and each figure with the time Clew read it (D54: "Personalsystemet 06:00"). */
  async function listAreas(persona: AuthenticatedContext): Promise<Area[]> {
    await persona.authorize();
    const now = clock();
    const threads = await access.list(persona, now.toISOString());
    const areas = await registry.areas(audiencedActorOf(persona), { authorize: () => persona.authorize() });
    const open = threads.filter(t => (t.state === 'open' || unresolvedExecution(t)) && t.kind === 'pushed');
    const today = stockholmDate(now.toISOString());
    return areas.map(a => {
      const needsYou = open.filter(t => t.area === a.id && !t.waitingOn && !isSnoozed(t, now.toISOString()));
      return {
        ...a,
        figure: a.figure && !a.figure.unavailable ? { ...a.figure, observedAt: now.toISOString() } : a.figure,
        needsYou: needsYou.length,
        waiting: open.filter(t => t.area === a.id && !!t.waitingOn).length,
        urgency: worstLevel(needsYou.map(t => attentionLevel(t, today))),
      };
    });
  }
  /** The undo window of a receipt has passed (scheduler): the receipt stays, the Ångra button goes. */
  async function closeReceiptWindow(threadId: string) {
    const thread = await store.readThreadById(threadId);
    if (!thread) return;
    const at = clock().toISOString();
    await store.transaction(async tx => {
      const current = await tx.lockThreadById(threadId);
      if (!current?.receipt?.undoUntil || current.receipt.undoUntil > at) return;
      await tx.updateThread(threadId, {
        receipt: { ...current.receipt, undoUntil: null, undoCapability: null },
        updatedAt: at,
      });
      await tx.writeAudit({
        actor: 'system:scheduler',
        action: 'thread.receipt_final',
        subject: 'thread:' + threadId,
        at,
      });
    });
  }
  async function dismissThread(persona: AuthenticatedContext, threadId: string, reason = 'inte aktuellt') {
    const thread = await threadFor(persona, threadId);
    if (!thread || thread.state !== 'open') throw new InputError('Ärendet är redan hanterat.');
    const at = clock().toISOString();
    await store.transaction(async tx => {
      const locked = await tx.lockThread(persona.id, threadId);
      if (
        !locked ||
        locked.state !== 'open' ||
        locked.updatedAt !== thread.updatedAt ||
        (locked.execution && ['pending', 'running', 'unknown'].includes(locked.execution.state))
      )
        throw new InputError('Ärendet har ändrats. Läs om sidan.');
      await tx.updateThread(threadId, { state: 'dismissed', handledAt: at, updatedAt: at });
      await tx.addMessage(threadId, { role: 'user', body: `Avfärdad · ${reason}`, at });
      await tx.writeAudit({
        actor: persona.principal.id,
        action: 'thread.dismissed',
        subject: 'thread:' + threadId,
        at,
        details: { reason },
      });
    });
    return read(persona, threadId);
  }
  /** The picker's rows (D29): presets with their resolved times, from the clock and today's meetings. */
  async function snoozeOptions(persona: AuthenticatedContext): Promise<SnoozePreset[]> {
    return snoozePresets(
      clock().toISOString(),
      registry.visible(audiencedActorOf(persona), 'calendar') ? await calendar.todayEvents(persona) : [],
    );
  }
  /**
   * Inte nu (D28, D29): the card keeps its state and moves to the Inte nu pile until a time the person chose, a preset,
   * free text in Swedish, or an instant; nothing means the next 06:00 review. Its timer brings it back on time and says
   * so, as a reminder does (D49). The snooze breaks early when something happens in the thread.
   */
  async function snoozeThread(persona: AuthenticatedContext, threadId: string, input: SnoozeInput = {}) {
    const thread = await threadFor(persona, threadId);
    if (!thread || thread.state !== 'open') throw new InputError('Ärendet är redan hanterat.');
    const now = clock(),
      at = now.toISOString();
    let until: string;
    if (input.until) until = input.until;
    else if (input.text) {
      const parsed = parseSwedishTime(input.text, at);
      if (!parsed) throw new InputError('Jag förstod inte tiden. Skriv till exempel ”fredag kl 9” eller ”om 20 min”.');
      until = parsed;
    } else if (input.preset) {
      const preset = (await snoozeOptions(persona)).find(p => p.id === input.preset);
      if (!preset) throw new InputError('Okänt förval.');
      until = preset.at;
    } else until = nextStockholmTime(at, dayRhythm.review);
    if (Date.parse(until) <= now.getTime()) throw new InputError('Tiden har redan passerat.');
    if (Date.parse(until) > now.getTime() + MAX_SNOOZE_DAYS * 86_400_000)
      throw new InputError(`Högst ${MAX_SNOOZE_DAYS} dagar framåt.`);
    await persona.authorize();
    await store.transaction(async tx => {
      const current = await tx.lockThread(persona.id, threadId);
      if (!current || current.state !== 'open') throw new InputError('Ärendet är redan hanterat.');
      const timer = await tx.scheduleTimer({
        id: `snooze:${threadId}`,
        personId: persona.id,
        threadId,
        kind: 'snooze',
        unitId: persona.unitId,
        authorizationVersion: persona.authorizationVersion,
        dueAt: until,
        requestedAt: at,
      });
      await tx.enqueue(reminderStart(timer));
      await tx.updateThread(threadId, { snoozedUntil: until, updatedAt: at });
      await tx.addMessage(threadId, { role: 'user', body: `Inte nu · ${snoozeWhen(until, at)}`, at });
      await tx.writeAudit({
        actor: persona.principal.id,
        action: 'thread.snoozed',
        subject: 'thread:' + threadId,
        at,
        details: {
          until,
          timerId: timer.id,
          generation: timer.generation,
          delivery: 'committed',
          ...(input.preset ? { preset: input.preset } : {}),
          ...(input.text ? { text: input.text } : {}),
        },
      });
    });
    return read(persona, threadId);
  }
  /**
   * The Ångra row after Avfärda or Inte nu: a dismissed thread comes back within ten minutes, a snoozed one any time.
   * Proposal threads whose drawn times were declined get them redrawn by the planner.
   */
  async function reopenThread(persona: AuthenticatedContext, threadId: string) {
    const t = await access.read(persona, threadId);
    if (!t) throw new InputError('Ärendet finns inte.');
    const now = clock(),
      at = now.toISOString();
    const snoozed = t.state === 'open' && !!t.snoozedUntil;
    const dismissed = t.state === 'dismissed' && !!t.handledAt && now.getTime() - Date.parse(t.handledAt) <= REOPEN_MS;
    if (!snoozed && !dismissed)
      throw new InputError(t.state === 'dismissed' ? 'Ångerfönstret har gått ut.' : 'Ärendet går inte att återöppna.');
    await store.transaction(async tx => {
      const current = await tx.lockThread(persona.id, threadId);
      if (!current || current.updatedAt !== t.updatedAt)
        throw new InputError('Ärendet har ändrats. Läs tillbaka det först.');
      if (snoozed) await tx.cancelTimer(`snooze:${threadId}`, at);
      await tx.updateThread(threadId, {
        state: 'open',
        handledAt: null,
        snoozedUntil: null,
        ...(dismissed ? { waitingOn: null } : {}),
        updatedAt: at,
      });
      await tx.addMessage(threadId, { role: 'user', body: 'Ångra', at });
      await tx.writeAudit({
        actor: persona.principal.id,
        action: 'thread.reopened',
        subject: 'thread:' + threadId,
        at,
        details: { from: snoozed ? 'snoozed' : 'dismissed' },
      });
    });
    if (dismissed && t.week && t.proposals.length && !t.proposals.some(p => p.status === 'proposed'))
      return calendar.replan(persona, threadId, t.week);
    return read(persona, threadId);
  }
  /**
   * The budget and the day's rhythm (D28): what was pushed today, on one track with the review, the bundles and the quiet
   * hours. The budget counts interruptions, which are moments on the track, never cards: a scan that brings ten cards at
   * once interrupted once, and the cards the review or a bundle brought interrupted nobody.
   */
  async function attentionFor(persona: AuthenticatedContext): Promise<Attention> {
    const now = clock().toISOString();
    const since = stockholmInstant(stockholmDate(now), '00:00');
    const threads = await access.list(persona, now);
    const pushed = threads
      .filter(t => t.kind === 'pushed' && Date.parse(t.createdAt) >= Date.parse(since))
      .map(t => ({ at: t.createdAt, title: t.title }));
    const rhythm = rhythmFor(now, pushed);
    const used = rhythm.filter(p => p.kind === 'interruption').length;
    return { used, budget: ATTENTION_BUDGET, bundledUntil: used >= ATTENTION_BUDGET ? 'i morgon 06:00' : null, rhythm };
  }
  /**
   * An open card from a connector the person cannot see (switched off, or they are outside its audience, D23) is not
   * theirs to find: it stays in the store and comes back if the connector does. The same check protects handled snapshots.
   */
  /** The person's own threads, newest first, as the stream shows them. */
  const listThreadsFor = async (persona: AuthenticatedContext) => {
    await wakeDue(persona);
    return (await access.list(persona, clock().toISOString())).map(pathed);
  };
  /**
   * Alla samtal (WD-L1): one page of the person's conversations, the latest activity first, and where the next page
   * begins. Every conversation the person may see is reached by paging, however many there are; a read, so nothing is
   * written. An `after` this server did not hand out is refused.
   */
  const listConversationsFor = async (persona: AuthenticatedContext, after?: string): Promise<ConversationPage> => {
    const cursor = after === undefined ? undefined : cursorOf(after);
    if (after !== undefined && !cursor) throw new InputError('Ogiltig förfrågan.');
    const page = await access.conversations(persona, cursor, CONVERSATION_PAGE);
    return { conversations: page.threads.map(pathed), next: page.next ? cursorText(page.next) : null };
  };
  /** One of the person's threads, or undefined when it is not theirs. */
  const threadFor = async (persona: AuthenticatedContext, threadId: string) => {
    const thread = await access.read(persona, threadId);
    return thread && pathed(thread);
  };
  /**
   * A work item's "Händelser" (D112 item 4): what the person and Clew did to it, from the audit rows its own mutations
   * wrote, newest first. Only for an item the person may see now (the same check as reading it); a read, so nothing is
   * written and no audit row is kept.
   */
  async function itemHistory(persona: AuthenticatedContext, threadId: string): Promise<ItemEvents> {
    await persona.authorize();
    const thread = await threadFor(persona, threadId);
    if (!thread) throw new InputError('Ärendet finns inte.');
    const rows = await store.history(historySubjects(thread.id), HISTORY_LIMIT);
    return { events: itemEvents(rows, thread, persona.principal.id) };
  }
  /** Avfärda from the card: proposal threads decline their drawn times through the planner, every other card is dismissed as is. */
  async function dismissAny(persona: AuthenticatedContext, threadId: string) {
    const thread = await threadFor(persona, threadId);
    if (!thread) throw new InputError('Ärendet finns inte.');
    return thread.proposals.length ? calendar.dismiss(persona, threadId) : dismissThread(persona, threadId);
  }
  /**
   * A cited answer becomes a card (D26): the sources as rows, the first source's link as the primary button, the answer as
   * the summary. Idempotent per answer: a second click returns the open card. The answer never executes anything; the card does.
   */
  async function cardFromAnswer(persona: AuthenticatedContext, input: { conversationId: string; messageId: string }) {
    const conversation = await access.read(persona, input.conversationId);
    if (!conversation || conversation.kind !== 'question') throw new InputError('Samtalet finns inte.');
    const index = conversation.messages.findIndex(m => m.id === input.messageId && m.role === 'assistant');
    const message = conversation.messages[index];
    const sources = message?.meta?.sources ?? [];
    if (!message || !sources.length) throw new InputError('Svaret har inga källor att göra ett ärende av.');
    const topic = 'answer:' + input.messageId;
    const existing = await store.openThread(persona.id, topic);
    if (existing) return { threadId: existing.id };
    const question =
      [...conversation.messages.slice(0, index)].reverse().find(m => m.role === 'user')?.body ?? conversation.title;
    const now = clock(),
      at = now.toISOString(),
      id = ids();
    const first = sources[0]!;
    const reviewed = (s: typeof first) => (s.reviewedAt ? 'granskad ' + s.reviewedAt.slice(0, 10) : '');
    const inserted = await store.transaction(async tx => {
      const ok = await tx.insertThread({
        id,
        personId: persona.id,
        kind: 'pushed',
        topic,
        title: ('Följ upp: ' + question).slice(0, 120),
        state: 'open',
        week: null,
        connector: 'clew',
        area: 'fragor',
        summary: message.body,
        items: sources.map(s => ({
          ref: s.ref,
          label: `[${s.n}] ${s.label}${s.section ? ' · ' + s.section : ''}`,
          detail: [s.owner, reviewed(s), s.source].filter(Boolean).join(' · '),
          selectable: false,
          selected: false,
        })),
        actions: first.link
          ? [
              {
                id: 'open',
                label: 'Öppna källan',
                capability: 'clew.openSource',
                kind: 'read',
                role: 'primary',
                target: 'link',
                input: { ref: first.ref.replace(/^document:/, '') },
              },
            ]
          : [],
        waitingOn: null,
        deadline: null,
        trigger: {
          reason: `Du frågade ${now.toLocaleTimeString('sv-SE', { timeStyle: 'short', timeZone: 'Europe/Stockholm' })} och gjorde svaret till ett ärende`,
          source: 'Startsidan',
          at,
        },
        createdAt: at,
        updatedAt: at,
      });
      if (!ok) return false;
      await tx.addMessage(id, { role: 'assistant', body: message.body, at, meta: { access: message.meta?.access } });
      await tx.writeAudit({
        actor: 'person:' + persona.id,
        action: 'thread.fromAnswer',
        subject: 'thread:' + id,
        at,
        details: {
          connector: 'clew',
          topic,
          owner: persona.id,
          conversation: input.conversationId,
          message: input.messageId,
          sources: sources.map(s => s.ref),
        },
      });
      return true;
    });
    if (!inserted) {
      const raced = await store.openThread(persona.id, topic);
      if (raced) return { threadId: raced.id };
      throw new InputError('Ärendet kunde inte skapas.');
    }
    return { threadId: id };
  }
  return {
    pushDraft,
    retryRejected,
    listAreas,
    closeReceiptWindow,
    dismissThread,
    snoozeThread,
    snoozeOptions,
    reopenThread,
    attentionFor,
    listThreadsFor,
    listConversationsFor,
    threadFor,
    itemHistory,
    dismissAny,
    cardFromAnswer,
  };
}
export type ThreadUsecases = ReturnType<typeof threadUsecases>;
