import { and, eq } from 'drizzle-orm';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { attentionLevel, worstLevel, type AuthenticatedContext, type Area, type Receipt, type Thread } from '@clew/contracts';
import { database, schema } from '@clew/db';
import { postgresState, resetState } from '@clew/db/state';
import { addMessage, listThreads, openProposalThread, readThread, writeAudit } from '@clew/db/threads';
import { scheduleJob } from '@clew/db/jobs';
import { CapabilityError, Registry, receipt, type Actor, type ExecuteResult } from '@clew/modules';
import { heromaModule } from '@clew/modules/mock/heroma';
import { raindanceModule } from '@clew/modules/mock/raindance';
import { treservaModule } from '@clew/modules/mock/treserva';
import { kommunikationModule } from '@clew/modules/mock/kommunikation';
import { InputError } from './context';
import { calendarModule } from './calendar-module';
import { peopleModule } from './people-module';
import { ensureProposalThread, replan } from './planner';

/**
 * The registry the BFF runs with: the four mock integrations plus the calendar. Every REST route, card action and
 * (later) tool definition is derived from here. Nothing in `routes/` knows a module by name.
 */
export const registry = new Registry();
for (const m of [heromaModule(postgresState), raindanceModule(postgresState), treservaModule(postgresState), kommunikationModule(postgresState), calendarModule(), peopleModule()]) registry.register(m);
export const actorOf = (persona: AuthenticatedContext): Actor => ({ id: persona.id, name: persona.name, unitId: persona.unitId, unitLabel: persona.unitLabel, role: persona.role });

const ajv = addFormats(new Ajv({ allErrors: false, strict: false }));
const validators = new Map<string, ReturnType<typeof ajv.compile>>();
function validateInput(name: string, schemaObject: object, input: unknown) {
  let v = validators.get(name); if (!v) { v = ajv.compile(schemaObject); validators.set(name, v); }
  if (!v(input)) throw new InputError('Ogiltig förfrågan till ' + name + '.');
}
/** Run a capability through the registry with input validation. The single path for REST, cards and tools. */
export async function runCapability<O = unknown>(persona: AuthenticatedContext, name: string, input: unknown): Promise<O> {
  const found = registry.find(name);
  if (!found) throw new InputError('Okänd förmåga.');
  validateInput(name, found.capability.input as object, input ?? {});
  if (found.capability.kind === 'execute') await persona.authorize();
  try { return await registry.run<O>(actorOf(persona), name, input ?? {}); }
  catch (error) { if (error instanceof CapabilityError) throw new InputError(error.message); throw error; }
}

/**
 * First visit of the day and the nightly scan: every module says what it wants to push, one open thread per topic.
 * The calendar's proposal thread keeps its own path (planner), everything else is a generic card.
 */
const inFlight = new Map<string, Promise<void>>();
export function ensureThreads(persona: AuthenticatedContext, source = 'Nattlig genomgång 06:00') {
  // One scan per person at a time; a second caller waits for the first instead of pushing the same cards again.
  const running = inFlight.get(persona.id);
  if (running) return running;
  const task = scanInto(persona, source).finally(() => inFlight.delete(persona.id));
  inFlight.set(persona.id, task);
  return task;
}
async function scanInto(persona: AuthenticatedContext, source: string) {
  await ensureProposalThread(persona, source);
  const drafts = await registry.scan(actorOf(persona));
  const now = new Date();
  for (const d of drafts) {
    const existing = await openProposalThread(persona.id, d.topic);
    if (existing) {
      // An untouched open card follows its source: rows, title and deadline refresh, the person's selection survives.
      if (existing.receipt) continue;
      const items = (d.items ?? []).map(i => ({ ...i, selected: existing.items.find(x => x.ref === i.ref)?.selected ?? i.selected }));
      await database().update(schema.threads).set({ title: d.title, summary: d.summary, items, actions: d.actions, deadline: d.deadline ?? null }).where(eq(schema.threads.id, existing.id));
      continue;
    }
    const id = crypto.randomUUID();
    await database().transaction(async tx => {
      // The partial unique index (person, topic, open, pushed) makes the insert idempotent across processes.
      const inserted = await tx.insert(schema.threads).values({ id, personId: persona.id, kind: 'pushed', topic: d.topic, title: d.title, state: 'open', week: null,
        module: d.module, area: d.area, summary: d.summary, items: d.items ?? [], actions: d.actions, waitingOn: d.waitingOn ?? null, deadline: d.deadline ?? null,
        trigger: { reason: d.reason, source: registry.module(d.module)?.source ?? d.module, at: now.toISOString() } }).onConflictDoNothing().returning({ id: schema.threads.id });
      if (!inserted.length) return;
      await tx.insert(schema.threadMessages).values({ id: crypto.randomUUID(), threadId: id, role: 'assistant', body: d.summary });
      await writeAudit(tx, { actor: 'assistant:scan', action: 'thread.pushed', subject: 'thread:' + id, details: { module: d.module, topic: d.topic, owner: persona.id } });
    });
  }
}
/** Areas with live counts for the sidebar. */
export async function listAreas(persona: AuthenticatedContext): Promise<Area[]> {
  const [areas, threads] = await Promise.all([registry.areas(actorOf(persona)), listThreads(persona.id)]);
  const open = threads.filter(t => t.state === 'open' && t.kind === 'pushed');
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm' }).format(new Date());
  return areas.map(a => {
    const needsYou = open.filter(t => t.area === a.id && !t.waitingOn);
    return { ...a, needsYou: needsYou.length, waiting: open.filter(t => t.area === a.id && !!t.waitingOn).length, urgency: worstLevel(needsYou.map(t => attentionLevel(t, today))) };
  });
}
/**
 * A card action: resolve the action on the thread, merge its fixed input with the selected refs, run the capability,
 * and record the receipt. Execute actions close the thread; read actions return their output for the panel.
 */
export async function act(persona: AuthenticatedContext, threadId: string, actionId: string, refs?: string[]) {
  const current = await readThread(persona.id, threadId);
  if (!current) throw new InputError('Tråden finns inte.');
  const thread = current.thread;
  const action = thread.actions.find(a => a.id === actionId);
  if (!action) throw new InputError('Okänd handling.');
  const selected = refs ?? thread.items.filter(i => i.selected).map(i => i.ref);
  if (action.usesItems && thread.items.length && selected.some(r => !thread.items.some(i => i.ref === r))) throw new InputError('Något val är inte längre aktuellt. Läs om sidan.');
  const input = { ...(action.input ?? {}), ...(action.usesItems ? { refs: selected } : {}) };
  if (action.kind !== 'execute') return { kind: action.kind, output: await runCapability(persona, action.capability, input) };
  if (thread.state !== 'open') throw new InputError('Tråden är redan hanterad.');
  const result = await runCapability<ExecuteResult>(persona, action.capability, input);
  const now = new Date(), r: Receipt = receipt(result, now);
  await database().transaction(async tx => {
    const items = thread.items.map(i => ({ ...i, selected: selected.includes(i.ref) }));
    await tx.update(schema.threads).set({ state: 'handled', handledAt: now, updatedAt: now, receipt: r, items }).where(eq(schema.threads.id, threadId));
    await addMessage(tx, threadId, 'user', action.label);
    await addMessage(tx, threadId, 'assistant', result.headline);
    await writeAudit(tx, { actor: persona.principal.id, action: 'thread.acted', subject: 'thread:' + threadId, details: { capability: action.capability, refs: selected, outcomes: r.rows.map(x => x.outcome), undoUntil: r.undoUntil } });
    if (r.undoUntil) await scheduleJob({ id: `receipt-final:${threadId}:${now.getTime()}`, kind: 'receipt-final', runAt: new Date(r.undoUntil), payload: { threadId } }, tx);
  });
  return { kind: 'execute' as const, thread: (await readThread(persona.id, threadId))!.thread };
}
/** Undo a receipt within its window: run the undo capability with the same refs, reopen the thread. */
export async function undoReceipt(persona: AuthenticatedContext, threadId: string) {
  const current = await readThread(persona.id, threadId);
  if (!current?.thread.receipt) throw new InputError('Det finns inget att ångra.');
  const r = current.thread.receipt;
  if (!r.undoCapability || !r.undoUntil || Date.parse(r.undoUntil) < Date.now()) throw new InputError('Ångerfönstret har gått ut.');
  const refs = r.rows.filter(x => x.outcome === 'done').map(x => x.ref);
  const result = await runCapability<ExecuteResult>(persona, r.undoCapability, { refs });
  const now = new Date();
  await database().transaction(async tx => {
    await tx.update(schema.threads).set({ state: 'open', handledAt: null, updatedAt: now, receipt: null }).where(eq(schema.threads.id, threadId));
    await addMessage(tx, threadId, 'user', 'Ångra');
    await addMessage(tx, threadId, 'assistant', result.headline);
    await writeAudit(tx, { actor: persona.principal.id, action: 'thread.undone', subject: 'thread:' + threadId, details: { capability: r.undoCapability, refs } });
  });
  return (await readThread(persona.id, threadId))!.thread;
}
export async function closeReceiptWindow(threadId: string) {
  const [row] = await database().select().from(schema.threads).where(and(eq(schema.threads.id, threadId), eq(schema.threads.state, 'handled')));
  if (!row?.receipt?.undoUntil) return;
  await database().update(schema.threads).set({ receipt: { ...row.receipt, undoUntil: null, undoCapability: null }, updatedAt: new Date() }).where(eq(schema.threads.id, threadId));
}
export async function dismissThread(persona: AuthenticatedContext, threadId: string, reason = 'inte aktuellt') {
  const current = await readThread(persona.id, threadId);
  if (!current || current.thread.state !== 'open') throw new InputError('Tråden är redan hanterad.');
  const now = new Date();
  await database().transaction(async tx => {
    await tx.update(schema.threads).set({ state: 'dismissed', handledAt: now, updatedAt: now }).where(eq(schema.threads.id, threadId));
    await addMessage(tx, threadId, 'user', `Avfärdad · ${reason}`);
    await writeAudit(tx, { actor: persona.principal.id, action: 'thread.dismissed', subject: 'thread:' + threadId, details: { reason } });
  });
  return (await readThread(persona.id, threadId))!.thread as Thread;
}
/** Snooze: keep the thread open but hide it until the next bundle (tomorrow 06:00). Stored as a deadline-free `waitingOn`. */
export async function snoozeThread(persona: AuthenticatedContext, threadId: string) {
  const current = await readThread(persona.id, threadId);
  if (!current || current.thread.state !== 'open') throw new InputError('Tråden är redan hanterad.');
  const now = new Date();
  await database().transaction(async tx => {
    await tx.update(schema.threads).set({ waitingOn: 'i morgon 06:00', updatedAt: now }).where(eq(schema.threads.id, threadId));
    await addMessage(tx, threadId, 'user', 'Inte nu');
    await writeAudit(tx, { actor: persona.principal.id, action: 'thread.snoozed', subject: 'thread:' + threadId });
  });
  return (await readThread(persona.id, threadId))!.thread as Thread;
}

const REOPEN_MS = 10 * 60_000;
/**
 * The Ångra row after Avfärda or Inte nu: a dismissed thread comes back within ten minutes, a snoozed one any time.
 * Proposal threads whose drawn times were declined get them redrawn by the planner.
 */
export async function reopenThread(persona: AuthenticatedContext, threadId: string) {
  const current = await readThread(persona.id, threadId);
  if (!current) throw new InputError('Tråden finns inte.');
  const t = current.thread;
  const snoozed = t.state === 'open' && t.waitingOn === 'i morgon 06:00';
  const dismissed = t.state === 'dismissed' && !!t.handledAt && Date.now() - Date.parse(t.handledAt) <= REOPEN_MS;
  if (!snoozed && !dismissed) throw new InputError(t.state === 'dismissed' ? 'Ångerfönstret har gått ut.' : 'Tråden går inte att återöppna.');
  const now = new Date();
  await database().transaction(async tx => {
    await tx.update(schema.threads).set({ state: 'open', handledAt: null, waitingOn: null, updatedAt: now }).where(eq(schema.threads.id, threadId));
    await addMessage(tx, threadId, 'user', 'Ångra');
    await writeAudit(tx, { actor: persona.principal.id, action: 'thread.reopened', subject: 'thread:' + threadId, details: { from: snoozed ? 'snoozed' : 'dismissed' } });
  });
  if (dismissed && t.week && t.proposals.length && !t.proposals.some(p => p.status === 'proposed')) return replan(persona, threadId, t.week);
  return (await readThread(persona.id, threadId))!.thread as Thread;
}

/** Development only: forget every mock decision and close the mocks' open cards, so the next scan starts from the fixtures. */
export async function resetMocks(persona: AuthenticatedContext) {
  if (process.env.CLEW_POC !== 'true') throw new InputError('Bara i utvecklingsmiljön.');
  await resetState();
  const mockIds = registry.list().filter(m => m.kind === 'passthrough' && m.id !== 'calendar').map(m => m.id).concat('kommunikation');
  const now = new Date();
  await database().transaction(async tx => {
    for (const id of mockIds) await tx.update(schema.threads).set({ state: 'dismissed', handledAt: now, updatedAt: now }).where(and(eq(schema.threads.module, id), eq(schema.threads.state, 'open')));
    await writeAudit(tx, { actor: persona.principal.id, action: 'mocks.reset', subject: 'module_state', details: { modules: mockIds } });
  });
}
