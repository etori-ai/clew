import type { AuthenticatedContext, Proposal, Thread, TodayView, WeekView } from '@clew/contracts';
import { addDays, dayStart, displayDate, nextWeekStart, weekNumber, weekStart, shortDayLabel, timeRange, localClock } from '@clew/calendar/dates';
import { collides, freeGaps, planWeek, type Interval } from '@clew/calendar/proposals';
import { CalendarError } from '@clew/calendar/model';
import { InputError } from '../../../context';
import type { CalendarBinder, ProposalRecord, ProposalStore } from '../model';
import { heldAddresses, SAMTAL_TITLE, toEvent } from './reads';

/**
 * The calendar's use cases (D20, D25): the person's day and week, and the utvecklingssamtal proposal thread from
 * the nightly draw to the human decision, undo and the timer that makes a confirmation final. Built by a factory over
 * ports; `composition/calendar.ts` hands in Postgres and the real calendar bindings, the tests hand in memory.
 */
export interface CalendarDeps { store: ProposalStore; bind: CalendarBinder; clock: () => Date; ids: () => string }
export const TOPIC = 'utvecklingssamtal';
export const DEADLINE = '2026-11-28';
export const UNDO_MS = 10 * 60_000;
const SAMTAL_MINUTES = 60;
const interval = (p: { start: string; end: string }): Interval => ({ start: p.start, end: p.end });
const toProposal = (p: ProposalRecord): Proposal => ({ id: p.id, threadId: p.threadId, status: p.status, start: p.start, end: p.end, participant: { ...p.participant }, eventRef: p.eventRef, undoUntil: p.undoUntil });
/** Rows with refs for the card (D12): one per drawn proposal, all selected until the person or the conversation changes that. */
const proposalItems = (rows: ProposalRecord[], selected?: (id: string) => boolean) =>
  rows.map(p => ({ ref: 'proposal:' + p.id, label: p.participant.name, detail: `${shortDayLabel(displayDate(p.start))} ${timeRange(p.start, p.end)}`, selectable: true, selected: selected ? selected(p.id) : true }));
const weekStartMismatch = (week: string) => { try { const d = new Date(week + 'T12:00:00Z').getUTCDay(); return (d === 0 ? 7 : d) !== 1; } catch { return true; } };

export function calendarUsecases(deps: CalendarDeps) {
  const { store, bind, clock, ids } = deps;
  const principal = (persona: AuthenticatedContext) => persona.principal.id;
  const today = () => displayDate(clock().toISOString());
  const thread = async (persona: Pick<AuthenticatedContext, 'id'>, threadId: string) => (await store.readThread(persona.id, threadId))!.thread;

  async function listWeek(persona: AuthenticatedContext, from: string, days = 7) {
    const binding = bind(persona);
    const events = await binding.provider.list(dayStart(from), dayStart(addDays(from, days)));
    return { binding, events, view: events.map(e => toEvent(e, binding, persona.name)) };
  }
  async function readToday(persona: AuthenticatedContext): Promise<TodayView> {
    const date = today();
    const { view } = await listWeek(persona, date, 1);
    return { date, events: view, gaps: freeGaps(date, view.filter(e => !e.allDay)) };
  }
  /** The week's events for the agenda and the model; `from` is any date in the week, this week when absent. */
  async function weekView(persona: AuthenticatedContext, from?: string): Promise<Omit<WeekView, 'proposals'>> {
    const start = weekStart(from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : today());
    return { from: start, events: (await listWeek(persona, start, 7)).view };
  }
  /** The week view with the person's live proposals for the agenda. */
  async function weekOverview(persona: AuthenticatedContext, from?: string): Promise<WeekView> {
    return { ...await weekView(persona, from), proposals: (await store.activeProposals(persona.id)).map(toProposal) };
  }
  /** Utvecklingssamtal already in the calendar between this week and the deadline, by participant address. */
  async function heldSamtal(persona: AuthenticatedContext) {
    const binding = bind(persona);
    // The provider caps a read at 32 days: from the start of this week to the day after the deadline.
    const events = await binding.provider.list(dayStart(weekStart(today())), dayStart(addDays(DEADLINE, 1)));
    return { binding, done: heldAddresses(events) };
  }
  /** What the nightly scan knows: who still lacks a samtal, and which proposals already exist. */
  async function remaining(persona: AuthenticatedContext) {
    const { binding, done } = await heldSamtal(persona);
    const booked = await store.activeProposals(persona.id);
    const bookedEmails = new Set(booked.filter(p => p.status !== 'proposed').map(p => p.participant.email.toLowerCase()));
    const members = binding.members.filter(m => !done.has(m.email.toLowerCase()) && !bookedEmails.has(m.email.toLowerCase()));
    return { binding, members, done, booked };
  }
  async function samtalStatus(persona: AuthenticatedContext) {
    const { binding, done, booked } = await remaining(persona);
    const held = binding.members.filter(m => done.has(m.email.toLowerCase())).length;
    const pending = booked.filter(p => p.status === 'confirmed' || p.status === 'final').filter(p => !done.has(p.participant.email.toLowerCase())).length;
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
      store.activeProposals(persona.id),
    ]);
    const managerBusy: Interval[] = [...events.filter(e => !e.allDay).map(interval), ...existing.filter(p => p.threadId !== excludeThread).map(interval)];
    const candidates = members.map(m => {
      const periods = busy.find(b => b.ref === m.ref);
      if (!periods || periods.state === 'unknown') throw new CalendarError('Medarbetarnas kalendrar kunde inte läsas just nu.');
      return { participant: { email: m.email, name: m.name }, busy: periods.busy };
    });
    const notBefore = new Date(clock().getTime() + 3600_000).toISOString();
    return { members, planned: planWeek({ week, managerBusy, candidates, notBefore, durationMinutes: SAMTAL_MINUTES }) };
  }
  function explain(week: string, planned: number, members: number) {
    const daysLeft = Math.ceil((Date.parse(dayStart(DEADLINE)) - clock().getTime()) / 86400000);
    const head = `${members} utvecklingssamtal återstår före 28 november, om ${daysLeft} dagar.`;
    if (!planned) return `${head} Vecka ${weekNumber(week)} har inga lediga timmar som passar både dig och medarbetarna. Prova en annan vecka.`;
    const tail = planned < members ? ` ${members - planned} fick ingen tid vecka ${weekNumber(week)}; jag föreslår dem i nästa vecka om du vill.` : '';
    return `${head} Jag har ritat in ${planned} förslag vecka ${weekNumber(week)} som inte krockar med något i din eller medarbetarnas kalendrar. Bekräfta så skickar jag inbjudningarna; du kan ångra i tio minuter.${tail}`;
  }
  const records = (persona: AuthenticatedContext, threadId: string, planned: ReturnType<typeof planWeek>): ProposalRecord[] =>
    planned.map(p => ({ id: ids(), threadId, personId: persona.id, status: 'proposed', participant: { email: p.participant.email, name: p.participant.name }, start: p.start, end: p.end,
      eventUid: null, eventRef: null, eventRevision: null, confirmedAt: null, undoUntil: null }));
  /**
   * The nightly scan (and the first visit): one open thread per topic. Re-running refreshes the proposals of an
   * untouched thread; it never silently changes confirmed ones.
   */
  async function ensureProposalThread(persona: AuthenticatedContext, source = 'Nattlig genomgång 06:00'): Promise<Thread | undefined> {
    if (persona.role !== 'manager') return undefined;
    const existing = await store.openThread(persona.id, TOPIC);
    if (existing) {
      // A thread drawn before rows existed gets them now, so the card and the conversation see one draft mechanism.
      const proposed = existing.proposals.filter(p => p.status === 'proposed');
      if (!existing.thread.items.length && proposed.length) {
        await store.transaction(tx => tx.updateThread(existing.thread.id, { items: proposalItems(proposed) }));
        return thread(persona, existing.thread.id);
      }
      return existing.thread;
    }
    const week = nextWeekStart(today());
    const { members, planned } = await draw(persona, week);
    if (!members.length) return undefined;
    const at = clock().toISOString(), id = ids();
    await store.transaction(async tx => {
      const summary = explain(week, planned.length, members.length);
      await tx.insertThread({ id, personId: persona.id, topic: TOPIC, title: `Planera utvecklingssamtal vecka ${weekNumber(week)}`, week, area: 'utvecklingssamtal', summary,
        trigger: { reason: `${members.length} samtal saknar tid före 28 november`, source, at }, createdAt: at, updatedAt: at });
      await tx.addMessage(id, { role: 'assistant', body: summary, at });
      const rows = records(persona, id, planned);
      await tx.insertProposals(rows);
      await tx.updateThread(id, { items: proposalItems(rows) });
      await tx.writeAudit({ actor: 'assistant:scan', action: 'thread.pushed', subject: 'thread:' + id, at, details: { topic: TOPIC, week, proposals: planned.length, owner: persona.id } });
    });
    return thread(persona, id);
  }
  /** "Vecka 47 i stället": redraw every unconfirmed proposal of the thread in another week. */
  async function replan(persona: AuthenticatedContext, threadId: string, week: string) {
    const current = await store.readThread(persona.id, threadId);
    if (!current || current.thread.state !== 'open') throw new InputError('Tråden är redan hanterad.');
    if (Date.parse(dayStart(week)) < Date.parse(dayStart(today())) || weekStartMismatch(week)) throw new InputError('Välj en kommande vecka.');
    const { members, planned } = await draw(persona, week, threadId);
    const at = clock().toISOString();
    await store.transaction(async tx => {
      await tx.transition(threadId, 'proposed', { status: 'superseded' });
      const rows = records(persona, threadId, planned);
      await tx.insertProposals(rows);
      await tx.updateThread(threadId, { week, title: `Planera utvecklingssamtal vecka ${weekNumber(week)}`, items: proposalItems(rows), updatedAt: at });
      await tx.addMessage(threadId, { role: 'user', body: `Vecka ${weekNumber(week)} i stället`, at });
      await tx.addMessage(threadId, { role: 'assistant', body: explain(week, planned.length, members.length), at });
      await tx.writeAudit({ actor: principal(persona), action: 'proposals.replanned', subject: 'thread:' + threadId, at, details: { week, proposals: planned.length } });
    });
    return thread(persona, threadId);
  }
  /**
   * The human decision endpoint. Re-validates every selected proposal against the live calendars, then writes the
   * calendar events; the status change and the audit row commit together. A lost provider reply is recorded as such.
   */
  async function confirm(persona: AuthenticatedContext, threadId: string, proposalIds: string[]) {
    await persona.authorize();
    const current = await store.readThread(persona.id, threadId);
    if (!current || current.thread.state !== 'open') throw new InputError('Tråden är redan hanterad.');
    const selected = current.proposals.filter(p => proposalIds.includes(p.id) && p.status === 'proposed');
    if (selected.length !== proposalIds.length) throw new InputError('Något förslag är inte längre aktuellt. Läs om sidan.');
    const binding = bind(persona);
    const first = selected.reduce((a, b) => a.start < b.start ? a : b).start, last = selected.reduce((a, b) => a.end > b.end ? a : b).end;
    const events = await binding.provider.list(new Date(Date.parse(first) - 86400000).toISOString(), new Date(Date.parse(last) + 86400000).toISOString());
    const taken = events.filter(e => !e.allDay).map(interval);
    for (const p of selected) if (collides(interval(p), taken)) throw new InputError(`Tiden ${shortDayLabel(displayDate(p.start))} ${timeRange(p.start, p.end)} krockar numera med din kalender. Flytta den först.`);
    await persona.authorize();
    const now = clock(), at = now.toISOString(), undoUntil = new Date(now.getTime() + UNDO_MS).toISOString();
    const created: { id: string; uid: string; ref: string | null; revision: string | null; outcome: 'created' | 'unknown' }[] = [];
    for (const p of selected) {
      const uid = `clew-samtal-${p.id}`;
      try {
        const event = await binding.provider.create(uid, { title: `${SAMTAL_TITLE} · ${p.participant.name}`, start: p.start, end: p.end, participants: [p.participant.email] });
        created.push({ id: p.id, uid, ref: event.ref, revision: event.revision, outcome: 'created' });
      } catch { created.push({ id: p.id, uid, ref: await binding.provider.eventRef(uid).catch(() => null), revision: null, outcome: 'unknown' }); }
    }
    await store.transaction(async tx => {
      for (const c of created) await tx.updateProposals([c.id], { status: 'confirmed', eventUid: c.uid, eventRef: c.ref, eventRevision: c.revision, confirmedAt: at, undoUntil });
      const declined = current.proposals.filter(p => p.status === 'proposed' && !proposalIds.includes(p.id)).map(p => p.id);
      await tx.updateProposals(declined, { status: 'declined' });
      await tx.updateThread(threadId, { state: 'handled', handledAt: at, updatedAt: at, items: proposalItems(current.proposals.filter(p => p.status === 'proposed'), id => proposalIds.includes(id)) });
      const unknown = created.filter(c => c.outcome === 'unknown').length;
      await tx.addMessage(threadId, { role: 'user', body: `Bekräftade ${created.length} tider`, at });
      await tx.addMessage(threadId, { role: 'assistant', at, body: unknown ? `${created.length - unknown} inbjudningar är skickade. ${unknown} fick inget svar från kalendern; kontrollera dem i kalendern innan du försöker igen.`
        : `${created.length} inbjudningar är skickade. Du kan ångra till ${localClock(undoUntil).slice(11)}.` });
      await tx.writeAudit({ actor: principal(persona), action: 'proposals.confirmed', subject: 'thread:' + threadId, at, details: { proposals: created.map(c => c.id), unknown, undoUntil } });
      await tx.scheduleJob({ id: `undo-expiry:${threadId}:${now.getTime()}`, kind: 'undo-expiry', runAt: undoUntil, payload: { threadId, personId: persona.id } });
    });
    return thread(persona, threadId);
  }
  /** Undo within the window: cancel every event the confirmation created and record a second audit row. */
  async function undo(persona: AuthenticatedContext, threadId: string) {
    await persona.authorize();
    const current = await store.readThread(persona.id, threadId);
    if (!current) throw new InputError('Tråden finns inte.');
    const confirmed = current.proposals.filter(p => p.status === 'confirmed');
    if (!confirmed.length) throw new InputError('Det finns inget att ångra.');
    const now = clock(), at = now.toISOString();
    if (confirmed.some(p => !p.undoUntil || Date.parse(p.undoUntil) < now.getTime())) throw new InputError('Ångerfönstret på tio minuter har gått ut.');
    const binding = bind(persona);
    const results: { id: string; outcome: 'cancelled' | 'unknown' }[] = [];
    for (const p of confirmed) {
      try {
        const ref = p.eventRef ?? await binding.provider.eventRef(p.eventUid!);
        const event = await binding.provider.lookup(ref);
        if (event) await binding.provider.cancel(ref, event.revision);
        results.push({ id: p.id, outcome: 'cancelled' });
      } catch { results.push({ id: p.id, outcome: 'unknown' }); }
    }
    await store.transaction(async tx => {
      const unknown = results.filter(r => r.outcome === 'unknown').length;
      await tx.updateThread(threadId, { state: unknown ? 'handled' : 'open', handledAt: unknown ? at : null, updatedAt: at });
      await tx.addMessage(threadId, { role: 'user', body: 'Ångra', at });
      await tx.addMessage(threadId, { role: 'assistant', at, body: unknown ? `${unknown} inbjudningar kunde inte tas tillbaka säkert. Kontrollera dem i kalendern.` : 'Inbjudningarna är återkallade. Förslagen ligger kvar här om du vill bekräfta igen eller välja en annan vecka.' });
      if (unknown) await tx.updateProposals(results.filter(r => r.outcome === 'cancelled').map(r => r.id), { status: 'undone' });
      else await tx.updateProposals(results.map(r => r.id), { status: 'proposed', eventUid: null, eventRef: null, eventRevision: null, confirmedAt: null, undoUntil: null });
      await tx.writeAudit({ actor: principal(persona), action: 'proposals.undone', subject: 'thread:' + threadId, at, details: { proposals: results.map(r => r.id), unknown } });
    });
    return thread(persona, threadId);
  }
  /** Timer: after ten minutes a confirmation becomes final and the thread shows it under "Redan hanterat". */
  async function closeUndoWindow(threadId: string) {
    const at = clock().toISOString();
    await store.transaction(async tx => {
      const ids = await tx.transition(threadId, 'confirmed', { status: 'final' });
      if (!ids.length) return;
      await tx.updateThread(threadId, { updatedAt: at });
      await tx.writeAudit({ actor: 'assistant:timer', action: 'proposals.final', subject: 'thread:' + threadId, at, details: { proposals: ids } });
    });
  }
  /** Avfärda on a proposal thread: the drawn times are declined, nothing was ever sent. */
  async function dismiss(persona: AuthenticatedContext, threadId: string) {
    const current = await store.readThread(persona.id, threadId);
    if (!current || current.thread.state !== 'open') throw new InputError('Tråden är redan hanterad.');
    const at = clock().toISOString();
    await store.transaction(async tx => {
      await tx.transition(threadId, 'proposed', { status: 'declined' });
      await tx.updateThread(threadId, { state: 'dismissed', handledAt: at, updatedAt: at });
      await tx.writeAudit({ actor: principal(persona), action: 'thread.dismissed', subject: 'thread:' + threadId, at });
    });
    return thread(persona, threadId);
  }
  return { listWeek, readToday, weekView, weekOverview, samtalStatus, ensureProposalThread, replan, confirm, undo, closeUndoWindow, dismiss };
}
export type CalendarUsecases = ReturnType<typeof calendarUsecases>;
