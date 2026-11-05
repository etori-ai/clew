import { obligationStep, replySummary, type AuthenticatedContext, type Proposal, type Thread, type ThreadItem, type TodayView, type WeekView } from '@clew/contracts';
import { addDays, dayStart, displayDate, nextWeekStart, weekNumber, weekStart, shortDayLabel, timeRange, localClock } from '@clew/calendar/dates';
import { collides, freeGaps, planWeek, unplacedReasons, type Interval, type PlanInput } from '@clew/calendar/proposals';
import type { ParticipantResponse } from '@clew/calendar/model';
import { FOLLOW_UP, obligationPlan, returnAt, stepOf, waitingOnInvitee, type ObligationPlan } from './obligation';
import { CalendarError } from '@clew/calendar/model';
import { InputError } from '../../../context';
import type { CalendarBinder, Notifier, ObligationTimers, People, ProposalRecord, ProposalStore } from '../model';
import { heldAddresses, SAMTAL_TITLE, toEvent } from './reads';

/**
 * The calendar's use cases (D20, D25): the person's day and week, and the utvecklingssamtal proposal thread from
 * the nightly draw to the human decision, undo and the timer that makes a confirmation final. Built by a factory over
 * ports; `composition/calendar.ts` hands in Postgres and the real calendar bindings, the tests hand in memory.
 */
export interface CalendarDeps {
  store: ProposalStore; bind: CalendarBinder; clock: () => Date; ids: () => string;
  /** The obligation's follow-ups (D30): who a thread belongs to, how to put a card in an invitee's stream, and the workflow timers. */
  people: People; notify: Notifier; obligations: ObligationTimers;
}
export const TOPIC = 'utvecklingssamtal';
export const DEADLINE = '2026-11-28';
export const UNDO_MS = 10 * 60_000;
const SAMTAL_MINUTES = 60;
const interval = (p: { start: string; end: string }): Interval => ({ start: p.start, end: p.end });
const toProposal = (p: ProposalRecord): Proposal => ({ id: p.id, threadId: p.threadId, status: p.status, start: p.start, end: p.end, participant: { ...p.participant }, eventRef: p.eventRef, undoUntil: p.undoUntil, reminders: p.reminders, remindedAt: p.remindedAt });
/** Rows with refs for the card (D12): one per drawn proposal, all selected until the person or the conversation changes that. */
const proposalItems = (rows: ProposalRecord[], selected?: (id: string) => boolean) =>
  rows.map(p => ({ ref: 'proposal:' + p.id, label: p.participant.name, detail: `${shortDayLabel(displayDate(p.start))} ${timeRange(p.start, p.end)}`, selectable: true, selected: selected ? selected(p.id) : true }));
/** The people the planner could not place (D30): rows without a ref to select, one reason each, for the judgement calls on the card. */
const unplacedItems = (unplaced: Array<{ participant: { email: string; name: string }; reason: string }>): ThreadItem[] =>
  unplaced.map(u => ({ ref: 'unplaced:' + u.participant.email.toLowerCase(), label: u.participant.name, detail: u.reason, selectable: false, selected: false }));
const keepUnplaced = (items: ThreadItem[]) => items.filter(i => i.ref.startsWith('unplaced:'));
const weekStartMismatch = (week: string) => { try { const d = new Date(week + 'T12:00:00Z').getUTCDay(); return (d === 0 ? 7 : d) !== 1; } catch { return true; } };

export function calendarUsecases(deps: CalendarDeps) {
  const { store, bind, clock, ids, people, notify, obligations } = deps;
  const principal = (persona: AuthenticatedContext) => persona.principal.id;
  const todayDate = () => displayDate(clock().toISOString());
  const thread = async (persona: Pick<AuthenticatedContext, 'id'>, threadId: string) => (await store.readThread(persona.id, threadId))!.thread;

  async function listWeek(persona: AuthenticatedContext, from: string, days = 7) {
    const binding = bind(persona);
    const events = await binding.provider.list(dayStart(from), dayStart(addDays(from, days)));
    return { binding, events, view: events.map(e => toEvent(e, binding, persona.name)) };
  }
  async function readToday(persona: AuthenticatedContext): Promise<TodayView> {
    const date = todayDate();
    const { view } = await listWeek(persona, date, 1);
    return { date, events: view, gaps: freeGaps(date, view.filter(e => !e.allDay)) };
  }
  /** The week's events for the agenda and the model; `from` is any date in the week, this week when absent. */
  async function weekView(persona: AuthenticatedContext, from?: string): Promise<Omit<WeekView, 'proposals'>> {
    const start = weekStart(from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : todayDate());
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
    const events = await binding.provider.list(dayStart(weekStart(todayDate())), dayStart(addDays(DEADLINE, 1)));
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
    const pending = booked.filter(p => p.status === 'confirmed' || p.status === 'final' || p.status === 'accepted').filter(p => !done.has(p.participant.email.toLowerCase())).length;
    return { held, booked: pending, deadline: '28 november' };
  }
  /** Draw proposals for one week. Reads the manager's calendar and the unit's free-busy, nothing is written to any source. */
  async function draw(persona: AuthenticatedContext, week: string, excludeThread?: string) {
    const { binding, members } = await remaining(persona);
    if (!members.length) return { members, planned: [] as ReturnType<typeof planWeek>, unplaced: [] as ReturnType<typeof unplacedReasons> };
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
    const input: PlanInput = { week, managerBusy, candidates, notBefore, durationMinutes: SAMTAL_MINUTES };
    const planned = planWeek(input);
    return { members, planned, unplaced: unplacedReasons(input, planned) };
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
      eventUid: null, eventRef: null, eventRevision: null, confirmedAt: null, undoUntil: null, reminders: 0, remindedAt: null }));
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
    const week = nextWeekStart(todayDate());
    const { members, planned, unplaced } = await draw(persona, week);
    if (!members.length) return undefined;
    const at = clock().toISOString(), id = ids();
    await store.transaction(async tx => {
      const summary = explain(week, planned.length, members.length);
      await tx.insertThread({ id, personId: persona.id, topic: TOPIC, title: `Planera utvecklingssamtal vecka ${weekNumber(week)}`, week, area: 'utvecklingssamtal', summary,
        trigger: { reason: `${members.length} samtal saknar tid före 28 november`, source, at }, createdAt: at, updatedAt: at });
      await tx.addMessage(id, { role: 'assistant', body: summary, at });
      const rows = records(persona, id, planned);
      await tx.insertProposals(rows);
      await tx.updateThread(id, { items: [...proposalItems(rows), ...unplacedItems(unplaced)] });
      await tx.writeAudit({ actor: 'assistant:scan', action: 'thread.pushed', subject: 'thread:' + id, at, details: { topic: TOPIC, week, proposals: planned.length, owner: persona.id } });
    });
    return thread(persona, id);
  }
  /** "Vecka 47 i stället": redraw every unconfirmed proposal of the thread in another week. */
  async function replan(persona: AuthenticatedContext, threadId: string, week: string) {
    const current = await store.readThread(persona.id, threadId);
    if (!current || current.thread.state !== 'open') throw new InputError('Kortet är redan hanterat.');
    if (Date.parse(dayStart(week)) < Date.parse(dayStart(todayDate())) || weekStartMismatch(week)) throw new InputError('Välj en kommande vecka.');
    const { members, planned, unplaced } = await draw(persona, week, threadId);
    const at = clock().toISOString();
    await store.transaction(async tx => {
      await tx.transition(threadId, 'proposed', { status: 'superseded' });
      const rows = records(persona, threadId, planned);
      await tx.insertProposals(rows);
      await tx.updateThread(threadId, { week, title: `Planera utvecklingssamtal vecka ${weekNumber(week)}`, items: [...proposalItems(rows), ...unplacedItems(unplaced)], updatedAt: at });
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
    if (!current || current.thread.state !== 'open') throw new InputError('Kortet är redan hanterat.');
    if (!proposalIds.length) throw new InputError('Välj minst en tid.');
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
    // A new time for someone who said no (D30): their old invitation leaves the calendar only after the new one was read back.
    const replaced: string[] = [];
    for (const c of created.filter(c => c.outcome === 'created')) {
      const chosen = selected.find(p => p.id === c.id)!;
      for (const old of current.proposals.filter(p => p.status === 'declined-by-invitee' && p.participant.email.toLowerCase() === chosen.participant.email.toLowerCase())) {
        try { const ref = old.eventRef ?? await binding.provider.eventRef(old.eventUid!); const event = await binding.provider.lookup(ref); if (event) await binding.provider.cancel(ref, event.revision); } catch { /* the old event is read-only noise at worst */ }
        replaced.push(old.id);
      }
    }
    await store.transaction(async tx => {
      for (const c of created) await tx.updateProposals([c.id], { status: 'confirmed', eventUid: c.uid, eventRef: c.ref, eventRevision: c.revision, confirmedAt: at, undoUntil });
      const declined = current.proposals.filter(p => p.status === 'proposed' && !proposalIds.includes(p.id)).map(p => p.id);
      await tx.updateProposals(declined, { status: 'declined' });
      await tx.updateProposals(replaced, { status: 'superseded' });
      // The obligation stays one open thread, in the Pågår utan dig pile, until the invitees have answered or the Friday review returns it (D28, D30).
      const waiting = current.proposals.filter(p => waitingOnInvitee(p.status === 'proposed' && proposalIds.includes(p.id) ? { status: 'confirmed' } : p)).length;
      await tx.updateThread(threadId, { state: 'open', handledAt: null, updatedAt: at, deadline: null, waitingOn: `svar från ${waiting} ${waiting === 1 ? 'medarbetare' : 'medarbetare'}`,
        items: [...proposalItems(current.proposals.filter(p => p.status === 'proposed'), id => proposalIds.includes(id)), ...keepUnplaced(current.thread.items)] });
      const unknown = created.filter(c => c.outcome === 'unknown').length;
      await tx.addMessage(threadId, { role: 'user', body: `Bekräftade ${created.length} tider`, at });
      await tx.addMessage(threadId, { role: 'assistant', at, body: unknown ? `${created.length - unknown} inbjudningar är skickade. ${unknown} fick inget svar från kalendern; kontrollera dem i kalendern innan du försöker igen.`
        : `${created.length} inbjudningar är skickade. Du kan ångra till ${localClock(undoUntil).slice(11)}. Jag påminner den som inte svarat efter ${FOLLOW_UP.afterWorkdays} arbetsdagar, högst ${FOLLOW_UP.maxReminders} gånger, och lägger resten hos dig ${shortDayLabel(displayDate(returnAt(current.proposals.map(p => ({ ...p, status: 'confirmed' as const, confirmedAt: at })), at)))} ${FOLLOW_UP.at}.` });
      await tx.writeAudit({ actor: principal(persona), action: 'proposals.confirmed', subject: 'thread:' + threadId, at, details: { proposals: created.map(c => c.id), unknown, undoUntil, replaced } });
      await tx.scheduleJob({ id: `undo-expiry:${threadId}:${now.getTime()}`, kind: 'undo-expiry', runAt: undoUntil, payload: { threadId, personId: persona.id } });
    });
    // The follow-up workflow (D30) is a convenience for the invitees; a timer service that is away is noted, not an error.
    try { await obligations.start({ threadId, personId: persona.id }); }
    catch { await store.transaction(tx => tx.writeAudit({ actor: 'assistant:obligation', action: 'obligation.unavailable', subject: 'thread:' + threadId, at, details: { owner: persona.id } })); }
    return thread(persona, threadId);
  }
  /** Undo within the window: cancel every event the confirmation created and record a second audit row. */
  async function undo(persona: AuthenticatedContext, threadId: string) {
    await persona.authorize();
    const current = await store.readThread(persona.id, threadId);
    if (!current) throw new InputError('Kortet finns inte.');
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
      await tx.updateThread(threadId, { state: unknown ? 'handled' : 'open', handledAt: unknown ? at : null, waitingOn: null, updatedAt: at });
      await tx.addMessage(threadId, { role: 'user', body: 'Ångra', at });
      await tx.addMessage(threadId, { role: 'assistant', at, body: unknown ? `${unknown} inbjudningar kunde inte tas tillbaka säkert. Kontrollera dem i kalendern.` : 'Inbjudningarna är återkallade. Förslagen ligger kvar här om du vill bekräfta igen eller välja en annan vecka.' });
      if (unknown) await tx.updateProposals(results.filter(r => r.outcome === 'cancelled').map(r => r.id), { status: 'undone' });
      else await tx.updateProposals(results.map(r => r.id), { status: 'proposed', eventUid: null, eventRef: null, eventRevision: null, confirmedAt: null, undoUntil: null });
      await tx.writeAudit({ actor: principal(persona), action: 'proposals.undone', subject: 'thread:' + threadId, at, details: { proposals: results.map(r => r.id), unknown } });
    });
    await obligations.cancel(threadId);
    return thread(persona, threadId);
  }
  /** The thread and the identity of its owner, for the timers that know only the thread. */
  async function owned(threadId: string) {
    const current = await store.readThreadById(threadId);
    if (!current) return undefined;
    const owner = current.proposals[0]?.personId;
    const persona = owner ? await people.personaFor(owner) : undefined;
    return persona ? { current, persona, binding: bind(persona) } : undefined;
  }
  const responseOf = (response: ParticipantResponse | undefined): 'accepted' | 'declined-by-invitee' | null => response === 'accepted' ? 'accepted' : response === 'declined' ? 'declined-by-invitee' : null;
  /**
   * Replies read back from the calendar (D30): every invitation still waiting is looked up and the invitee's PARTSTAT
   * becomes the proposal's status. A no draws two alternative times for that one person and puts the thread back under
   * Nu for the manager, so the answer is a card with two choices, never a calendar to search.
   */
  async function readReplies(threadId: string) {
    const found = await owned(threadId);
    if (!found) return { accepted: [] as string[], declined: [] as string[] };
    const { current, persona, binding } = found;
    const accepted: ProposalRecord[] = [], declined: ProposalRecord[] = [];
    for (const p of current.proposals.filter(waitingOnInvitee)) {
      try {
        const ref = p.eventRef ?? (p.eventUid ? await binding.provider.eventRef(p.eventUid) : null);
        const event = ref ? await binding.provider.lookup(ref) : null;
        const invitee = event?.participants.find(x => x.email.toLowerCase() === p.participant.email.toLowerCase());
        const status = responseOf(invitee?.response);
        if (status === 'accepted') accepted.push(p); else if (status === 'declined-by-invitee') declined.push(p);
      } catch { /* a calendar that cannot answer now is asked again at the next check */ }
    }
    if (!accepted.length && !declined.length) return { accepted: [], declined: [] };
    const now = clock(), at = now.toISOString();
    // Two alternatives per no, drawn like any proposal: the person's own busy time and the manager's, this week or the next.
    const alternatives: ProposalRecord[] = [];
    for (const p of declined) {
      const member = binding.members.find(m => m.email.toLowerCase() === p.participant.email.toLowerCase());
      const week = Date.parse(dayStart(current.thread.week ?? todayDate())) > now.getTime() ? current.thread.week! : nextWeekStart(todayDate());
      const start = dayStart(week), end = dayStart(addDays(week, 5));
      const [events, busy, existing] = await Promise.all([binding.provider.list(start, end), member ? binding.provider.freeBusy(start, end, [{ ref: member.ref, email: member.email }]) : Promise.resolve([]), store.activeProposals(persona.id)]);
      const periods = busy[0];
      // The declined time stays busy: the old invitation is in the calendar until the new one is read back, and the person said no to it.
      const managerBusy: Interval[] = [...events.filter(e => !e.allDay).map(interval), ...existing.filter(x => x.id !== p.id).map(interval)];
      const candidate = { participant: { ...p.participant }, busy: periods && periods.state === 'known' ? periods.busy : [] };
      const notBefore = new Date(now.getTime() + 3600_000).toISOString();
      const first = planWeek({ week, managerBusy, candidates: [candidate], notBefore, durationMinutes: SAMTAL_MINUTES })[0];
      const second = first ? planWeek({ week, managerBusy: [...managerBusy, interval(first)], candidates: [candidate], notBefore, durationMinutes: SAMTAL_MINUTES })[0] : undefined;
      for (const slot of [first, second]) if (slot) alternatives.push(...records(persona, threadId, [slot]));
    }
    await store.transaction(async tx => {
      if (accepted.length) await tx.updateProposals(accepted.map(p => p.id), { status: 'accepted' });
      if (declined.length) await tx.updateProposals(declined.map(p => p.id), { status: 'declined-by-invitee' });
      if (alternatives.length) await tx.insertProposals(alternatives);
      const sum = replySummary([...current.proposals.filter(p => p.status !== 'superseded').map(p => ({ status: accepted.includes(p) ? 'accepted' as const : declined.includes(p) ? 'declined-by-invitee' as const : p.status }))]);
      if (declined.length) {
        const names = declined.map(p => `${p.participant.name} kan inte ${shortDayLabel(displayDate(p.start))} ${timeRange(p.start, p.end)}`).join('. ');
        const summary = alternatives.length ? `${names}. Jag har ritat ${alternatives.length === 1 ? 'en annan tid' : 'två andra tider'} som är ${alternatives.length === 1 ? 'ledig' : 'lediga'} för er båda; välj en så skickar jag en ny inbjudan och tar bort den gamla.`
          : `${names}. Jag hittade ingen annan tid den här veckan; prova en annan vecka.`;
        const firstAlternative = new Set(declined.map(d => alternatives.find(a => a.participant.email === d.participant.email)?.id));
        await tx.updateThread(threadId, { state: 'open', handledAt: null, waitingOn: null, deadline: todayDate(), summary, updatedAt: at,
          items: [...proposalItems(alternatives, id => firstAlternative.has(id)), ...keepUnplaced(current.thread.items)] });
        await tx.addMessage(threadId, { role: 'assistant', body: summary, at });
      } else {
        await tx.updateThread(threadId, { updatedAt: at, ...(current.thread.waitingOn ? { waitingOn: sum.waiting ? `svar från ${sum.waiting} medarbetare` : null } : {}) });
        await tx.addMessage(threadId, { role: 'assistant', body: `${sum.accepted} av ${sum.total} har svarat ja.${sum.waiting ? ` ${sum.waiting} har inte svarat ännu.` : ''}`, at });
      }
      await tx.writeAudit({ actor: 'assistant:obligation', action: 'proposals.replies', subject: 'thread:' + threadId, at, details: { accepted: accepted.map(p => p.id), declined: declined.map(p => p.id), alternatives: alternatives.map(a => a.id), owner: persona.id } });
    });
    return { accepted: accepted.map(p => p.id), declined: declined.map(p => p.id) };
  }
  /**
   * A follow-up to whoever has not answered (D30): a card in the invitee's own stream, never an e-mail. The workflow sends
   * it two workdays after the invitation and once more after two further workdays; the manager can send one at any time.
   */
  async function remindInvitees(threadId: string, actor: AuthenticatedContext | 'assistant:obligation', only?: string[]) {
    const found = await owned(threadId);
    if (!found) throw new InputError('Kortet finns inte.');
    const { current, persona, binding } = found;
    if (actor !== 'assistant:obligation' && actor.id !== persona.id) throw new InputError('Kortet finns inte.');
    const waiting = current.proposals.filter(waitingOnInvitee).filter(p => !only || only.includes(p.id));
    const at = clock().toISOString();
    const back = returnAt(current.proposals, at);
    const pushed: string[] = [], skipped: string[] = [];
    for (const p of waiting) {
      const member = binding.members.find(m => m.email.toLowerCase() === p.participant.email.toLowerCase());
      if (!member) { skipped.push(p.id); continue; }
      const id = await notify(member.personId, { topic: `samtal-svar:${p.id}`, area: 'kalender', title: 'Svara på inbjudan till utvecklingssamtal', deadline: displayDate(back),
        summary: `${persona.name} väntar på ditt svar om utvecklingssamtalet ${shortDayLabel(displayDate(p.start))} ${timeRange(p.start, p.end)}. Svara i din kalender.`,
        reason: `Inbjudan skickad ${shortDayLabel(displayDate(p.confirmedAt ?? at))}, inget svar ännu`, actions: [] });
      (id ? pushed : skipped).push(p.id);
    }
    await store.transaction(async tx => {
      for (const p of waiting) await tx.updateProposals([p.id], { reminders: p.reminders + 1, remindedAt: at });
      await tx.updateThread(threadId, { updatedAt: at });
      if (waiting.length) await tx.addMessage(threadId, { role: actor === 'assistant:obligation' ? 'assistant' : 'user', body: actor === 'assistant:obligation' ? `Påminde ${waiting.length} som inte svarat.` : `Påminn de ${waiting.length} som inte svarat`, at });
      await tx.writeAudit({ actor: actor === 'assistant:obligation' ? actor : principal(actor), action: 'obligation.reminded', subject: 'thread:' + threadId, at, details: { proposals: waiting.map(p => p.id), pushed, skipped, owner: persona.id } });
    });
    return thread(persona, threadId);
  }
  /** The workflow's one question (D30): read the replies, then say what to do now and when to look again. */
  async function obligationCheck(threadId: string): Promise<Pick<ObligationPlan, 'action' | 'why' | 'next'> & { due: string[] }> {
    await readReplies(threadId);
    const current = await store.readThreadById(threadId);
    const now = clock().toISOString();
    if (!current) return { action: 'return', why: 'answered', next: now, due: [] };
    const plan = obligationPlan(now, current.proposals);
    return { action: plan.action, why: plan.why, next: plan.next, due: plan.due.map(p => p.id) };
  }
  /**
   * The end of the follow-ups (D30): on the Friday review the thread goes back to the manager's Nu group with the sum
   * and whoever stayed silent; when every reply is in, the sum is written and the thread stays where it is.
   */
  async function returnObligation(threadId: string, why: 'answered' | 'deadline') {
    const current = await store.readThreadById(threadId);
    if (!current) return;
    const at = clock().toISOString();
    const rows = current.proposals.filter(p => p.status !== 'superseded');
    const sum = replySummary(rows), silent = rows.filter(waitingOnInvitee);
    const summary = why === 'deadline'
      ? `${sum.accepted} av ${sum.total} har svarat ja. ${silent.length} har inte svarat${silent.some(p => p.reminders >= FOLLOW_UP.maxReminders) ? ` efter ${FOLLOW_UP.maxReminders} påminnelser` : ''}: ${silent.map(p => p.participant.name).join(', ')}.`
      : `Alla ${sum.total} har svarat: ${sum.accepted} ja${sum.declined ? `, ${sum.declined} nej` : ''}.`;
    await store.transaction(async tx => {
      await tx.updateThread(threadId, { ...(why === 'deadline' ? { state: 'open', handledAt: null, waitingOn: null, deadline: todayDate() } : { state: 'handled', handledAt: at, waitingOn: null, deadline: null }), summary, updatedAt: at });
      await tx.addMessage(threadId, { role: 'assistant', body: summary, at });
      await tx.writeAudit({ actor: 'assistant:obligation', action: 'obligation.returned', subject: 'thread:' + threadId, at, details: { why, silent: silent.map(p => p.id), step: stepOf(current.proposals, obligationStep) } });
    });
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
    if (!current || current.thread.state !== 'open') throw new InputError('Kortet är redan hanterat.');
    const at = clock().toISOString();
    await store.transaction(async tx => {
      await tx.transition(threadId, 'proposed', { status: 'declined' });
      await tx.updateThread(threadId, { state: 'dismissed', handledAt: at, updatedAt: at });
      await tx.writeAudit({ actor: principal(persona), action: 'thread.dismissed', subject: 'thread:' + threadId, at });
    });
    return thread(persona, threadId);
  }
  return { listWeek, readToday, weekView, weekOverview, samtalStatus, ensureProposalThread, replan, confirm, undo, closeUndoWindow, dismiss, readReplies, remindInvitees, obligationCheck, returnObligation };
}
export type CalendarUsecases = ReturnType<typeof calendarUsecases>;
