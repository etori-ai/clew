import { and, eq, inArray } from 'drizzle-orm';
import type { AuthenticatedContext, Thread } from '@clew/contracts';
import { database, schema, type Transaction } from '@clew/db';
import { activeProposals, addMessage, openProposalThread, readThread, toThread, writeAudit } from '@clew/db/threads';
import { scheduleJob } from '@clew/db/jobs';
import { addDays, dayStart, nextWeekStart, today, weekNumber, shortDayLabel, timeRange, localClock } from '@clew/calendar/dates';
import { collides, planWeek, type Interval } from '@clew/calendar/proposals';
import { CalendarError } from '@clew/calendar/model';
import { InputError } from './context';
import { calendarFor, heldSamtal, SAMTAL_TITLE } from './calendar';

const { threads, proposals } = schema;
export const TOPIC = 'utvecklingssamtal';
export const DEADLINE = '2026-11-28';
export const UNDO_MS = 10 * 60_000;
const SAMTAL_MINUTES = 60;
const actorOf = (persona: AuthenticatedContext) => persona.principal.id;
const interval = (p: { start: Date; end: Date }): Interval => ({ start: p.start.toISOString(), end: p.end.toISOString() });


/** Rows with refs for the card (D12): one per drawn proposal, all selected until the person or the conversation changes that. */
const proposalItems = (rows: { id: string; participantName: string; start: Date; end: Date; status?: string }[], selected?: (id: string) => boolean) =>
  rows.map(p => ({ ref: 'proposal:' + p.id, label: p.participantName, detail: `${shortDayLabel(p.start.toISOString().slice(0, 10))} ${timeRange(p.start.toISOString(), p.end.toISOString())}`, selectable: true, selected: selected ? selected(p.id) : true }));
/** What the nightly scan knows: who still lacks a samtal, and which proposals already exist. */
async function remaining(persona: AuthenticatedContext) {
  const { binding, done } = await heldSamtal(persona, DEADLINE);
  const booked = await activeProposals(persona.id);
  const bookedEmails = new Set(booked.filter(p => p.status !== 'proposed').map(p => p.participantEmail.toLowerCase()));
  const members = binding.members.filter(m => !done.has(m.email.toLowerCase()) && !bookedEmails.has(m.email.toLowerCase()));
  return { binding, members, done, booked };
}
export async function samtalStatus(persona: AuthenticatedContext) {
  const { binding, done, booked } = await remaining(persona);
  const held = binding.members.filter(m => done.has(m.email.toLowerCase())).length;
  const pending = booked.filter(p => p.status === 'confirmed' || p.status === 'final').filter(p => !done.has(p.participantEmail.toLowerCase())).length;
  return { held, booked: pending, deadline: '28 november' };
}

/** Draw proposals for one week. Reads the manager's calendar and the unit's free-busy, nothing is written to any source. */
async function draw(persona: AuthenticatedContext, week: string, excludeThread?: string) {
  const { binding, members } = await remaining(persona);
  if (!members.length) return { members, planned: [] as ReturnType<typeof planWeek> };
  const start = dayStart(week), end = dayStart(addDays(week, 5));
  const [events, busy, existing] = await Promise.all([
    binding.provider.list(start, end),
    binding.provider.freeBusy(start, end, members.map(m => ({ ref: m.ref, email: m.email }))),
    activeProposals(persona.id),
  ]);
  const managerBusy: Interval[] = [...events.filter(e => !e.allDay).map(e => ({ start: e.start, end: e.end })),
    ...existing.filter(p => p.threadId !== excludeThread).map(interval)];
  const candidates = members.map(m => {
    const periods = busy.find(b => b.ref === m.ref);
    if (!periods || periods.state === 'unknown') throw new CalendarError('Medarbetarnas kalendrar kunde inte läsas just nu.');
    return { participant: { email: m.email, name: m.name }, busy: periods.busy };
  });
  const notBefore = new Date(Date.now() + 3600_000).toISOString();
  return { members, planned: planWeek({ week, managerBusy, candidates, notBefore, durationMinutes: SAMTAL_MINUTES }) };
}
function explain(week: string, planned: number, members: number) {
  const deadline = new Date(dayStart(DEADLINE));
  const daysLeft = Math.ceil((deadline.getTime() - Date.now()) / 86400000);
  const head = `${members} utvecklingssamtal återstår före 28 november, om ${daysLeft} dagar.`;
  if (!planned) return `${head} Vecka ${weekNumber(week)} har inga lediga timmar som passar både dig och medarbetarna. Prova en annan vecka.`;
  const tail = planned < members ? ` ${members - planned} fick ingen tid vecka ${weekNumber(week)}; jag föreslår dem i nästa vecka om du vill.` : '';
  return `${head} Jag har ritat in ${planned} förslag vecka ${weekNumber(week)} som inte krockar med något i din eller medarbetarnas kalendrar. Bekräfta så skickar jag inbjudningarna; du kan ångra i tio minuter.${tail}`;
}
/**
 * The nightly scan (and the first visit): one open thread per topic. Re-running refreshes the proposals of an
 * untouched thread; it never silently changes confirmed ones.
 */
export async function ensureProposalThread(persona: AuthenticatedContext, source = 'Nattlig genomgång 06:00'): Promise<Thread | undefined> {
  if (persona.role !== 'manager') return undefined;
  const existing = await openProposalThread(persona.id, TOPIC);
  if (existing) {
    const found = await readThread(persona.id, existing.id);
    // A thread drawn before rows existed gets them now, so the card and the conversation see one draft mechanism.
    if (found && !found.row.items.length && found.proposalRows.some(p => p.status === 'proposed')) {
      await database().update(threads).set({ items: proposalItems(found.proposalRows.filter(p => p.status === 'proposed')) }).where(eq(threads.id, existing.id));
      return (await readThread(persona.id, existing.id))?.thread;
    }
    return found?.thread;
  }
  const week = nextWeekStart(today());
  const { members, planned } = await draw(persona, week);
  if (!members.length) return undefined;
  const now = new Date();
  const id = crypto.randomUUID();
  await database().transaction(async tx => {
    await tx.insert(threads).values({ id, personId: persona.id, kind: 'pushed', topic: TOPIC, title: `Planera utvecklingssamtal vecka ${weekNumber(week)}`, week,
      module: 'calendar', area: 'utvecklingssamtal', summary: explain(week, planned.length, members.length),
      trigger: { reason: `${members.length} samtal saknar tid före 28 november`, source, at: now.toISOString() } });
    await tx.insert(schema.threadMessages).values({ id: crypto.randomUUID(), threadId: id, role: 'assistant', body: explain(week, planned.length, members.length) });
    const rows = planned.map(p => ({ id: crypto.randomUUID(), threadId: id, personId: persona.id, participantEmail: p.participant.email, participantName: p.participant.name, start: new Date(p.start), end: new Date(p.end) }));
    if (rows.length) await tx.insert(proposals).values(rows);
    await tx.update(threads).set({ items: proposalItems(rows) }).where(eq(threads.id, id));
    await writeAudit(tx, { actor: 'assistant:scan', action: 'thread.pushed', subject: 'thread:' + id, details: { topic: TOPIC, week, proposals: planned.length, owner: persona.id } });
  });
  return (await readThread(persona.id, id))?.thread;
}
/** "Vecka 47 i stället": redraw every unconfirmed proposal of the thread in another week. */
export async function replan(persona: AuthenticatedContext, threadId: string, week: string) {
  const current = await readThread(persona.id, threadId);
  if (!current || current.row.state !== 'open') throw new InputError('Tråden är redan hanterad.');
  if (Date.parse(dayStart(week)) < Date.parse(dayStart(today())) || new Date(dayStart(week)).getUTCDay() !== 1 && weekStartMismatch(week)) throw new InputError('Välj en kommande vecka.');
  const { members, planned } = await draw(persona, week, threadId);
  await database().transaction(async tx => {
    await tx.update(proposals).set({ status: 'superseded' }).where(and(eq(proposals.threadId, threadId), eq(proposals.status, 'proposed')));
    const rows = planned.map(p => ({ id: crypto.randomUUID(), threadId, personId: persona.id, participantEmail: p.participant.email, participantName: p.participant.name, start: new Date(p.start), end: new Date(p.end) }));
    if (rows.length) await tx.insert(proposals).values(rows);
    await tx.update(threads).set({ week, title: `Planera utvecklingssamtal vecka ${weekNumber(week)}`, items: proposalItems(rows), updatedAt: new Date() }).where(eq(threads.id, threadId));
    await addMessage(tx, threadId, 'user', `Vecka ${weekNumber(week)} i stället`);
    await addMessage(tx, threadId, 'assistant', explain(week, planned.length, members.length));
    await writeAudit(tx, { actor: actorOf(persona), action: 'proposals.replanned', subject: 'thread:' + threadId, details: { week, proposals: planned.length } });
  });
  return (await readThread(persona.id, threadId))!.thread;
}
const weekStartMismatch = (week: string) => { try { return Temporal_dayOfWeek(week) !== 1; } catch { return true; } };
function Temporal_dayOfWeek(date: string) { const d = new Date(date + 'T12:00:00Z').getUTCDay(); return d === 0 ? 7 : d; }

/**
 * The human decision endpoint. Re-validates every selected proposal against the live calendars, then writes the
 * CalDAV events; the status change and the audit row commit together. A lost provider reply is recorded as such.
 */
export async function confirm(persona: AuthenticatedContext, threadId: string, proposalIds: string[]) {
  await persona.authorize();
  const current = await readThread(persona.id, threadId);
  if (!current || current.row.state !== 'open') throw new InputError('Tråden är redan hanterad.');
  const selected = current.proposalRows.filter(p => proposalIds.includes(p.id) && p.status === 'proposed');
  if (selected.length !== proposalIds.length) throw new InputError('Något förslag är inte längre aktuellt. Läs om sidan.');
  const binding = calendarFor(persona);
  const first = selected.reduce((a, b) => a.start < b.start ? a : b).start, last = selected.reduce((a, b) => a.end > b.end ? a : b).end;
  const events = await binding.provider.list(new Date(first.getTime() - 86400000).toISOString(), new Date(last.getTime() + 86400000).toISOString());
  const taken = events.filter(e => !e.allDay).map(e => ({ start: e.start, end: e.end }));
  for (const p of selected) if (collides(interval(p), taken)) throw new InputError(`Tiden ${shortDayLabel(p.start.toISOString().slice(0, 10))} ${timeRange(p.start.toISOString(), p.end.toISOString())} krockar numera med din kalender. Flytta den först.`);
  await persona.authorize();
  const now = new Date(), undoUntil = new Date(now.getTime() + UNDO_MS);
  const created: { id: string; uid: string; ref: string | null; revision: string | null; outcome: 'created' | 'unknown' }[] = [];
  for (const p of selected) {
    const uid = `clew-samtal-${p.id}`;
    try {
      const event = await binding.provider.create(uid, { title: `${SAMTAL_TITLE} · ${p.participantName}`, start: p.start.toISOString(), end: p.end.toISOString(), participants: [p.participantEmail] });
      created.push({ id: p.id, uid, ref: event.ref, revision: event.revision, outcome: 'created' });
    } catch { created.push({ id: p.id, uid, ref: await binding.provider.eventRef(uid).catch(() => null), revision: null, outcome: 'unknown' }); }
  }
  await database().transaction(async tx => {
    for (const c of created) await tx.update(proposals).set({ status: 'confirmed', eventUid: c.uid, eventRef: c.ref, eventRevision: c.revision, confirmedAt: now, undoUntil }).where(eq(proposals.id, c.id));
    const declined = current.proposalRows.filter(p => p.status === 'proposed' && !proposalIds.includes(p.id)).map(p => p.id);
    if (declined.length) await tx.update(proposals).set({ status: 'declined' }).where(inArray(proposals.id, declined));
    const items = proposalItems(current.proposalRows.filter(p => p.status === 'proposed'), id => proposalIds.includes(id));
    await tx.update(threads).set({ state: 'handled', handledAt: now, updatedAt: now, items }).where(eq(threads.id, threadId));
    const unknown = created.filter(c => c.outcome === 'unknown').length;
    await addMessage(tx, threadId, 'user', `Bekräftade ${created.length} tider`);
    await addMessage(tx, threadId, 'assistant', unknown ? `${created.length - unknown} inbjudningar är skickade. ${unknown} fick inget svar från kalendern; kontrollera dem i kalendern innan du försöker igen.`
      : `${created.length} inbjudningar är skickade. Du kan ångra till ${localClock(undoUntil.toISOString()).slice(11)}.`);
    await writeAudit(tx, { actor: actorOf(persona), action: 'proposals.confirmed', subject: 'thread:' + threadId, details: { proposals: created.map(c => c.id), unknown, undoUntil: undoUntil.toISOString() } });
    await scheduleJob({ id: `undo-expiry:${threadId}:${now.getTime()}`, kind: 'undo-expiry', runAt: undoUntil, payload: { threadId, personId: persona.id } }, tx);
  });
  return (await readThread(persona.id, threadId))!.thread;
}
/** Undo within the window: cancel every event the confirmation created and record a second audit row. */
export async function undo(persona: AuthenticatedContext, threadId: string) {
  await persona.authorize();
  const current = await readThread(persona.id, threadId);
  if (!current) throw new InputError('Tråden finns inte.');
  const confirmed = current.proposalRows.filter(p => p.status === 'confirmed');
  if (!confirmed.length) throw new InputError('Det finns inget att ångra.');
  if (confirmed.some(p => !p.undoUntil || p.undoUntil.getTime() < Date.now())) throw new InputError('Ångerfönstret på tio minuter har gått ut.');
  const binding = calendarFor(persona);
  const results: { id: string; outcome: 'cancelled' | 'unknown' }[] = [];
  for (const p of confirmed) {
    try {
      const ref = p.eventRef ?? await binding.provider.eventRef(p.eventUid!);
      const event = await binding.provider.lookup(ref);
      if (event) await binding.provider.cancel(ref, event.revision);
      results.push({ id: p.id, outcome: 'cancelled' });
    } catch { results.push({ id: p.id, outcome: 'unknown' }); }
  }
  const now = new Date();
  await database().transaction(async tx => {
    for (const r of results) await tx.update(proposals).set({ status: r.outcome === 'cancelled' ? 'undone' : 'confirmed' }).where(eq(proposals.id, r.id));
    const unknown = results.filter(r => r.outcome === 'unknown').length;
    await tx.update(threads).set({ state: unknown ? 'handled' : 'open', handledAt: unknown ? now : null, updatedAt: now }).where(eq(threads.id, threadId));
    await addMessage(tx, threadId, 'user', 'Ångra');
    await addMessage(tx, threadId, 'assistant', unknown ? `${unknown} inbjudningar kunde inte tas tillbaka säkert. Kontrollera dem i kalendern.` : 'Inbjudningarna är återkallade. Förslagen ligger kvar här om du vill bekräfta igen eller välja en annan vecka.');
    if (!unknown) await tx.update(proposals).set({ status: 'proposed', eventUid: null, eventRef: null, eventRevision: null, confirmedAt: null, undoUntil: null }).where(inArray(proposals.id, results.map(r => r.id)));
    await writeAudit(tx, { actor: actorOf(persona), action: 'proposals.undone', subject: 'thread:' + threadId, details: { proposals: results.map(r => r.id), unknown } });
  });
  return (await readThread(persona.id, threadId))!.thread;
}
/** Timer: after ten minutes a confirmation becomes final and the thread shows it under "Redan hanterat". */
export async function closeUndoWindow(threadId: string) {
  await database().transaction(async tx => {
    const rows = await tx.update(proposals).set({ status: 'final' }).where(and(eq(proposals.threadId, threadId), eq(proposals.status, 'confirmed'))).returning({ id: proposals.id });
    if (!rows.length) return;
    await tx.update(threads).set({ updatedAt: new Date() }).where(eq(threads.id, threadId));
    await writeAudit(tx, { actor: 'assistant:timer', action: 'proposals.final', subject: 'thread:' + threadId, details: { proposals: rows.map(r => r.id) } });
  });
}
export async function dismiss(persona: AuthenticatedContext, threadId: string) {
  const current = await readThread(persona.id, threadId);
  if (!current || current.row.state !== 'open') throw new InputError('Tråden är redan hanterad.');
  const now = new Date();
  await database().transaction(async tx => {
    await tx.update(proposals).set({ status: 'declined' }).where(and(eq(proposals.threadId, threadId), eq(proposals.status, 'proposed')));
    await tx.update(threads).set({ state: 'dismissed', handledAt: now, updatedAt: now }).where(eq(threads.id, threadId));
    await writeAudit(tx, { actor: actorOf(persona), action: 'thread.dismissed', subject: 'thread:' + threadId });
  });
  return (await readThread(persona.id, threadId))!.thread;
}
export { toThread };
export type { Transaction };
