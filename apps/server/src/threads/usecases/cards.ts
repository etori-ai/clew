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
  type Receipt,
  type SnoozeInput,
  type SnoozePreset,
  type Thread,
} from '@clew/contracts';
import { rhythmFor } from '../domain';
import { actorOf, receipt, type Actor, type ExecuteResult, type Registry, type ThreadDraft } from '@clew/connectors';
import { InputError } from '../../context';
import type { ReminderTimers, ThreadStore, ThreadTx } from '../model';
import { threadAccess } from '../access';

/**
 * The stream's use cases (D20, D25): one function per user action, the actor first, built over ports. Nothing in here
 * reads a clock, draws an id or opens a connection; `composition.ts` hands in the live adapters and the tests hand in
 * the memory ones. Every mutation writes its audit row through the same transaction as its other writes.
 */
export interface ThreadDeps {
  store: ThreadStore;
  registry: Pick<Registry, 'scan' | 'areas' | 'connector' | 'visible' | 'find' | 'viewFor' | 'allowed'>;
  /** Run a capability as the person, with input validation and scope: `runCapability` in the server. */
  run: <O = unknown>(persona: AuthenticatedContext, name: string, input: unknown) => Promise<O>;
  /** The calendar's proposal path, the one coupling the stream has to a module (recorded as debt in D20). */
  calendar: {
    ensureProposalThread(persona: AuthenticatedContext, source: string): Promise<Thread | undefined>;
    replan(persona: AuthenticatedContext, threadId: string, week: string): Promise<Thread>;
    dismiss(persona: AuthenticatedContext, threadId: string): Promise<Thread>;
    /** Today's timed meetings, for the preset "när jag är tillbaka från …" (D29). Empty when the calendar cannot be read. */
    todayEvents(persona: AuthenticatedContext): Promise<Array<{ title: string; end: string }>>;
  };
  /** The timers behind a snooze (D29, D49): the same reminder workflow as D17, and the same return. */
  timers?: ReminderTimers;
  clock: () => Date;
  ids: () => string;
}
const REOPEN_MS = 10 * 60_000;
/** Attention budget: pushed threads today against a fixed daily budget. The rest is bundled to lunch or the next morning. */
export const ATTENTION_BUDGET = 3;
const sameDraft = (t: Thread, d: ThreadDraft, items: Thread['items']) =>
  t.title === d.title &&
  t.summary === d.summary &&
  (t.deadline ?? null) === (d.deadline ?? null) &&
  JSON.stringify(t.items) === JSON.stringify(items) &&
  JSON.stringify(t.actions) === JSON.stringify(d.actions);

export function threadUsecases(deps: ThreadDeps) {
  const { store, registry, run, calendar, clock, ids } = deps;
  const access = threadAccess(store, registry);
  const inFlight = new Map<string, Promise<void>>();
  const read = async (persona: Pick<AuthenticatedContext, 'id'>, threadId: string) =>
    (await store.readThread(persona.id, threadId))!;

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
    if (registry.visible(actorOf(persona), 'calendar')) await calendar.ensureProposalThread(persona, source);
    await wakeDue(persona);
    const drafts = await registry.scan(actorOf(persona));
    const now = clock();
    for (const d of drafts) {
      const scopedTopic = `${d.topic}:authority:${persona.authorizationVersion}`;
      const existing =
        (await store.openThread(persona.id, scopedTopic)) ?? (await store.openThread(persona.id, d.topic));
      // Changed authority must not manufacture a second decision while the old one may have reached the source.
      if (
        existing &&
        (existing.receipt ||
          (existing.execution && ['pending', 'running', 'unknown'].includes(existing.execution.state)))
      )
        continue;
      if (!existing || existing.sourceAuthorization !== persona.authorizationVersion) {
        await pushDraft(persona, existing ? { ...d, topic: scopedTopic } : d, 'assistant:scan', now);
        continue;
      }
      // An untouched open card follows its source: rows, title and deadline refresh, the person's selection survives.
      const items = (d.items ?? []).map(i => ({
        ...i,
        selected: existing.items.find(x => x.ref === i.ref)?.selected ?? i.selected,
      }));
      if (sameDraft(existing, d, items)) continue;
      await store.transaction(async tx => {
        const current = await tx.lockThread(persona.id, existing.id);
        if (
          !current ||
          current.updatedAt !== existing.updatedAt ||
          current.state !== 'open' ||
          current.receipt ||
          (current.execution && ['pending', 'running', 'unknown'].includes(current.execution.state))
        )
          return;
        await tx.updateThread(existing.id, {
          title: d.title,
          summary: d.summary,
          items,
          actions: d.actions,
          deadline: d.deadline ?? null,
          updatedAt: now.toISOString(),
        });
        await tx.writeAudit({
          actor: 'assistant:scan',
          action: 'thread.refreshed',
          subject: 'thread:' + existing.id,
          at: now.toISOString(),
          details: { connector: d.connector, topic: d.topic, owner: persona.id },
        });
        // A snoozed card whose source moved comes back early (D28, D29): the snooze breaks on activity.
        if (existing.snoozedUntil) {
          await wake(tx, existing, 'changed', now.toISOString());
          // The timer ends here, so the word the person was promised goes out now (D49), as it does on the refresh path.
          await tx.admitDelivery({
            id: `woken:${existing.id}:${now.toISOString()}`,
            personId: persona.id,
            threadId: existing.id,
            kind: 'automatic',
            at: now.toISOString(),
          });
        }
      });
    }
  }
  /** Clear a snooze and say why, in the same transaction as what woke it: the time passed, or the source changed. The timer, if any, is ended quietly. */
  async function wake(tx: ThreadTx, thread: Thread, reason: 'time' | 'changed', at: string) {
    await tx.updateThread(thread.id, { snoozedUntil: null, updatedAt: at });
    await tx.writeAudit({
      actor: 'assistant:scan',
      action: 'thread.woken',
      subject: 'thread:' + thread.id,
      at,
      details: { reason, snoozedUntil: thread.snoozedUntil },
    });
    if (thread.snoozedUntil) await tx.cancelTimer(`snooze:${thread.id}`, at);
  }
  /** The sweep (D28): every open card whose snooze has run out is awake again. Runs before every read of the stream and on the 06:00 scan. */
  async function wakeDue(persona: Pick<AuthenticatedContext, 'id'>) {
    const now = clock().toISOString();
    const due = (await store.listThreads(persona.id, now)).filter(
      t => t.state === 'open' && t.snoozedUntil && !isSnoozed(t, now),
    );
    for (const t of due)
      await store.transaction(async tx => {
        const current = await tx.lockThread(persona.id, t.id);
        if (await tx.readTimer(`snooze:${t.id}`)) return;
        if (current?.state === 'open' && current.snoozedUntil && !isSnoozed(current, now))
          await wake(tx, current, 'time', now);
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
  /** Areas with live counts for the sidebar, and each figure with the time Clew read it (D54: "Personalsystemet 06:00"). */
  async function listAreas(persona: AuthenticatedContext): Promise<Area[]> {
    await persona.authorize();
    const now = clock();
    const threads = await access.list(persona, now.toISOString());
    const areas = await registry.areas(actorOf(persona), { authorize: () => persona.authorize() });
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
    if (!thread || thread.state !== 'open') throw new InputError('Kortet är redan hanterat.');
    const at = clock().toISOString();
    await store.transaction(async tx => {
      const locked = await tx.lockThread(persona.id, threadId);
      if (
        !locked ||
        locked.state !== 'open' ||
        locked.updatedAt !== thread.updatedAt ||
        (locked.execution && ['pending', 'running', 'unknown'].includes(locked.execution.state))
      )
        throw new InputError('Kortet har ändrats. Läs om sidan.');
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
      registry.visible(actorOf(persona), 'calendar') ? await calendar.todayEvents(persona) : [],
    );
  }
  /**
   * Inte nu (D28, D29): the card keeps its state and moves to the Inte nu pile until a time the person chose, a preset,
   * free text in Swedish, or an instant; nothing means the next 06:00 review. Its timer brings it back on time and says
   * so, as a reminder does (D49). The snooze breaks early when something happens in the thread.
   */
  async function snoozeThread(persona: AuthenticatedContext, threadId: string, input: SnoozeInput = {}) {
    const thread = await threadFor(persona, threadId);
    if (!thread || thread.state !== 'open') throw new InputError('Kortet är redan hanterat.');
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
      if (!current || current.state !== 'open') throw new InputError('Kortet är redan hanterat.');
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
          delivery: 'queued',
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
    if (!t) throw new InputError('Kortet finns inte.');
    const now = clock(),
      at = now.toISOString();
    const snoozed = t.state === 'open' && !!t.snoozedUntil;
    const dismissed = t.state === 'dismissed' && !!t.handledAt && now.getTime() - Date.parse(t.handledAt) <= REOPEN_MS;
    if (!snoozed && !dismissed)
      throw new InputError(t.state === 'dismissed' ? 'Ångerfönstret har gått ut.' : 'Kortet går inte att återöppna.');
    await store.transaction(async tx => {
      const current = await tx.lockThread(persona.id, threadId);
      if (!current || current.updatedAt !== t.updatedAt)
        throw new InputError('Kortet har ändrats. Läs tillbaka det först.');
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
    return access.list(persona, clock().toISOString());
  };
  /** One of the person's threads, or undefined when it is not theirs. */
  const threadFor = (persona: AuthenticatedContext, threadId: string) => access.read(persona, threadId);
  /** Avfärda from the card: proposal threads decline their drawn times through the planner, every other card is dismissed as is. */
  async function dismissAny(persona: AuthenticatedContext, threadId: string) {
    const thread = await threadFor(persona, threadId);
    if (!thread) throw new InputError('Kortet finns inte.');
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
    if (!message || !sources.length) throw new InputError('Svaret har inga källor att göra ett kort av.');
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
          reason: `Du frågade ${now.toLocaleTimeString('sv-SE', { timeStyle: 'short', timeZone: 'Europe/Stockholm' })} och gjorde svaret till ett kort`,
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
      throw new InputError('Kortet kunde inte skapas.');
    }
    return { threadId: id };
  }
  return {
    ensureThreads,
    pushDraft,
    listAreas,
    closeReceiptWindow,
    dismissThread,
    snoozeThread,
    snoozeOptions,
    reopenThread,
    attentionFor,
    listThreadsFor,
    threadFor,
    dismissAny,
    cardFromAnswer,
  };
}
export type ThreadUsecases = ReturnType<typeof threadUsecases>;
