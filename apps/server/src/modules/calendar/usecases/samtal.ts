import {
  obligationStep,
  replySummary,
  type AuthenticatedContext,
  type Proposal,
  type Thread,
  type ThreadItem,
  type TodayView,
  type WeekView,
} from '@clew/contracts';
import {
  addDays,
  dayStart,
  displayDate,
  nextWeekStart,
  weekNumber,
  weekStart,
  shortDayLabel,
  timeRange,
  localClock,
} from '@clew/calendar/dates';
import { collides, freeGaps, planWeek, unplacedReasons, type Interval, type PlanInput } from '@clew/calendar/proposals';
import type { CalendarProvider, EventOccurrence, ParticipantResponse } from '@clew/calendar/model';
import { FOLLOW_UP, obligationPlan, returnAt, stepOf, waitingOnInvitee, type ObligationPlan } from './obligation';
import { CalendarError } from '@clew/calendar/model';
import { InputError } from '../../../context';
import type {
  CalendarBinder,
  Notifier,
  ObligationTimers,
  People,
  PlanningRound,
  ProposalParticipant,
  ProposalRecord,
  ProposalStore,
  ProposalThread,
  RoundReader,
  Team,
  UnitMember,
} from '../model';
import { chunks, dueLabel } from '../domain';
import { heldAddresses, SAMTAL_TITLE, toEvent } from './reads';
import { ALREADY_HELD, BOOKED, BOOKED_ELSEWHERE, bookedElsewhere, NEEDS_TIME, OWN_CALENDAR, within } from './booked';

/**
 * The calendar's use cases (D20, D25): the person's day and week, and the utvecklingssamtal proposal thread from
 * the nightly draw to the human decision, undo and the timer that makes a confirmation final. Built by a factory over
 * ports; `composition/calendar.ts` hands in Postgres and the real calendar bindings, the tests hand in memory. Who is
 * planned for and by when come from the team and the round (D96 item 3), never from constants here.
 */
export interface CalendarDeps {
  store: ProposalStore;
  bind: CalendarBinder;
  /** The people the manager plans for, from the assignments. */
  team: Team;
  /** The open round of talks; none means nothing is planned. */
  round: RoundReader;
  clock: () => Date;
  ids: () => string;
  /** The obligation's follow-ups (D30): who a thread belongs to, how to put a card in an invitee's stream, and the workflow timers. */
  people: People;
  notify: Notifier;
  obligations: ObligationTimers;
}
export const TOPIC = 'utvecklingssamtal';
export const UNDO_MS = 10 * 60_000;
const SAMTAL_MINUTES = 60;
/** A provider reads at most 32 days at a time; longer spans are read in windows of this many days. */
const READ_DAYS = 31;
/** A provider answers free-busy for at most eight people per request. */
const FREE_BUSY_TARGETS = 8;
/**
 * How long the scan, which comes back every minute, leaves an open card without reading the manager's calendar again
 * when neither the round nor another manager's booking changes anything on it (`settleCard`).
 */
const CARD_READ_MS = 60 * 60_000;
/** The row reasons that a talk settled outside the card gave, which say "behöver en tid" once it no longer holds. */
const SETTLED_REASONS: readonly string[] = [ALREADY_HELD, BOOKED_ELSEWHERE, OWN_CALENDAR];
const isoDate = /^\d{4}-\d{2}-\d{2}$/;
/** Events from one date up to (not including) another, in windows the provider accepts, each event once. */
async function listSpan(provider: CalendarProvider, from: string, to: string) {
  const seen = new Map<string, EventOccurrence>();
  for (let day = from; day < to; day = addDays(day, READ_DAYS)) {
    const end = addDays(day, READ_DAYS) < to ? addDays(day, READ_DAYS) : to;
    for (const e of await provider.list(dayStart(day), dayStart(end))) seen.set(e.id, e);
  }
  return [...seen.values()];
}
/** Free-busy for any number of people, asked in requests of at most eight, the answers merged in order. */
async function freeBusyOf(provider: CalendarProvider, start: string, end: string, members: readonly UnitMember[]) {
  const answers = await Promise.all(
    chunks(members, FREE_BUSY_TARGETS).map(part =>
      provider.freeBusy(
        start,
        end,
        part.map(m => ({ ref: m.ref, email: m.email })),
      ),
    ),
  );
  return answers.flat();
}
const interval = (p: { start: string; end: string }): Interval => ({ start: p.start, end: p.end });
/** Whom a member is invited as (N3): their id beside the address and name the team has for them now. */
const participantOf = (m: UnitMember): ProposalParticipant => ({ personId: m.personId, email: m.email, name: m.name });
/** A decision on its way: the card waits for its answer and nothing else changes it meanwhile. */
const deciding = (t: Thread) => !!t.execution && ['pending', 'running', 'unknown'].includes(t.execution.state);
const toProposal = (p: ProposalRecord): Proposal => ({
  id: p.id,
  threadId: p.threadId,
  status: p.status,
  start: p.start,
  end: p.end,
  participant: { email: p.participant.email, name: p.participant.name },
  eventRef: p.eventRef,
  undoUntil: p.undoUntil,
  reminders: p.reminders,
  remindedAt: p.remindedAt,
});
/** Rows with refs for the card (D12): one per drawn proposal, all selected until the person or the conversation changes that. */
const proposalItems = (rows: ProposalRecord[], selected?: (id: string) => boolean) =>
  rows.map(p => ({
    ref: 'proposal:' + p.id,
    label: p.participant.name,
    detail: `${shortDayLabel(displayDate(p.start))} ${timeRange(p.start, p.end)}`,
    selectable: true,
    selected: selected ? selected(p.id) : true,
  }));
/**
 * The people the planner could not place (D30): rows without a ref to select, one reason each, for the judgement calls
 * on the card, each named by the person's id (N3).
 */
const unplacedItems = (unplaced: Array<{ participant: ProposalParticipant; reason: string }>): ThreadItem[] =>
  unplaced.map(u => ({
    ref: 'unplaced:' + u.participant.personId,
    label: u.participant.name,
    detail: u.reason,
    selectable: false,
    selected: false,
  }));
const keepUnplaced = (items: ThreadItem[]) => items.filter(i => i.ref.startsWith('unplaced:'));
const weekStartMismatch = (week: string) => {
  try {
    const d = new Date(week + 'T12:00:00Z').getUTCDay();
    return (d === 0 ? 7 : d) !== 1;
  } catch {
    return true;
  }
};

export function calendarUsecases(deps: CalendarDeps) {
  const { store, bind, team, round, clock, ids, people, notify, obligations } = deps;
  const principal = (persona: AuthenticatedContext) => persona.principal.id;
  const todayDate = () => displayDate(clock().toISOString());
  const thread = async (persona: Pick<AuthenticatedContext, 'id'>, threadId: string) =>
    (await store.readThread(persona.id, threadId))!.thread;

  async function listWeek(persona: AuthenticatedContext, from: string, days = 7) {
    const binding = bind(persona);
    const [events, members] = await Promise.all([
      binding.provider.list(dayStart(from), dayStart(addDays(from, days))),
      team(persona),
    ]);
    return { binding, events, view: events.map(e => toEvent(e, binding, persona.name, members)) };
  }
  async function readToday(persona: AuthenticatedContext): Promise<TodayView> {
    const date = todayDate();
    const { view } = await listWeek(persona, date, 1);
    return {
      date,
      events: view,
      gaps: freeGaps(
        date,
        view.filter(e => !e.allDay),
      ),
    };
  }
  /** The week's events for the agenda and the model; `from` is any date in the week, this week when absent. */
  async function weekView(persona: AuthenticatedContext, from?: string): Promise<Omit<WeekView, 'proposals'>> {
    const start = weekStart(from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : todayDate());
    return { from: start, events: (await listWeek(persona, start, 7)).view };
  }
  /** The week view with the person's live proposals for the agenda. */
  async function weekOverview(persona: AuthenticatedContext, from?: string): Promise<WeekView> {
    return { ...(await weekView(persona, from)), proposals: (await store.activeProposals(persona.id)).map(toProposal) };
  }
  /** Utvecklingssamtal already in the calendar between this week and the round's due date, by participant address. */
  async function heldSamtal(persona: AuthenticatedContext, current: PlanningRound) {
    const binding = bind(persona);
    // From the start of this week to the day after the due date, in windows the provider accepts.
    const events = await listSpan(binding.provider, weekStart(todayDate()), addDays(current.dueOn, 1));
    return { binding, done: heldAddresses(events) };
  }
  /** Who among these people another of their current managers booked through Clew inside a period (M1, Q12). */
  const elsewhereOf = bookedElsewhere({ store, team, people });
  /**
   * The open round, for planning: one that cannot be read now is no round, so the planner plans nothing rather than fail
   * the stream (the reader logs the failure). A confirmation never takes it so (M1), and the dispatch does not read it.
   */
  const roundFor = (persona: AuthenticatedContext) => round(persona).catch(() => null);
  /**
   * What the nightly scan knows: the team, who still lacks a samtal, and which proposals already exist. Held is the
   * round's record (person ids) or a samtal in the calendar, to the person's address now or to the address a confirmed
   * proposal invited them at. Booked is a confirmed proposal of the manager's, or one another of the person's current
   * managers made (M1); proposals are matched on the person's id, never on an address that may have changed (N3).
   * Whom another manager booked is asked for the team and for `also`, people on a card who may have left it.
   */
  async function remaining(persona: AuthenticatedContext, current: PlanningRound, also: readonly string[] = []) {
    const { binding, done } = await heldSamtal(persona, current);
    const [everyone, booked] = await Promise.all([team(persona), store.activeProposals(persona.id)]);
    const elsewhere = await elsewhereOf(persona.id, [...new Set([...everyone.map(m => m.personId), ...also])], current);
    const recorded = new Set(current.held);
    const sent = new Set(
      booked
        .filter(p => BOOKED.includes(p.status) && done.has(p.participant.email.toLowerCase()))
        .map(p => p.participant.personId),
    );
    const isHeld = (m: UnitMember) =>
      recorded.has(m.personId) || done.has(m.email.toLowerCase()) || sent.has(m.personId);
    const bookedIds = new Set([
      ...booked.filter(p => p.status !== 'proposed').map(p => p.participant.personId),
      ...elsewhere,
    ]);
    const members = everyone.filter(m => !isHeld(m) && !bookedIds.has(m.personId));
    return { binding, everyone, members, booked, isHeld, elsewhere };
  }
  /**
   * Held and booked out of the team before the round's due date, each person once; nothing to plan (`members: 0`)
   * without a round.
   */
  async function samtalStatus(persona: AuthenticatedContext) {
    const current = await roundFor(persona);
    if (!current) return { held: 0, booked: 0, members: 0, deadline: '' };
    const { everyone, booked, isHeld, elsewhere } = await remaining(persona, current);
    const inTeam = new Set(everyone.map(m => m.personId));
    const held = new Set(everyone.filter(isHeld).map(m => m.personId));
    const pending = new Set(
      [...booked.filter(p => BOOKED.includes(p.status)).map(p => p.participant.personId), ...elsewhere].filter(
        id => inTeam.has(id) && !held.has(id),
      ),
    );
    return { held: held.size, booked: pending.size, members: everyone.length, deadline: dueLabel(current.dueOn) };
  }
  /**
   * The booked talks of the manager's team inside a period (D96 item 2): per person id, the start of a samtal in the
   * manager's calendar or of a confirmed proposal, the next one to come when there are several, else the latest. A
   * person another of their current managers booked through Clew is booked without a time (M1, Q12). Undefined when the
   * calendar cannot be read; whether a talk was held is the round's record, not this read's.
   */
  async function samtalBookings(
    persona: AuthenticatedContext,
    period: { opensOn: string; dueOn: string },
  ): Promise<Map<string, { at?: string }> | undefined> {
    if (!isoDate.test(period.opensOn) || !isoDate.test(period.dueOn)) throw new InputError('Ogiltig period.');
    const everyone = await team(persona);
    const bookings = new Map<string, { at?: string }>();
    if (!everyone.length || period.opensOn > period.dueOn) return bookings;
    let events: EventOccurrence[];
    try {
      events = await listSpan(bind(persona).provider, period.opensOn, addDays(period.dueOn, 1));
    } catch {
      return undefined;
    }
    const byEmail = new Map(everyone.map(m => [m.email.toLowerCase(), m]));
    const byId = new Map(everyone.map(m => [m.personId, m]));
    const starts = new Map<string, string[]>();
    const add = (member: UnitMember | undefined, start: string) => {
      if (!member || !within(start, period)) return;
      starts.set(member.personId, [...(starts.get(member.personId) ?? []), start]);
    };
    for (const e of events)
      if (!e.allDay && e.title.startsWith(SAMTAL_TITLE))
        for (const p of e.participants)
          if (!p.resource && p.response !== 'declined') add(byEmail.get(p.email.toLowerCase()), e.start);
    // A proposal names the person by id (N3), so a talk stays booked when their address changes.
    for (const p of await store.activeProposals(persona.id))
      if (BOOKED.includes(p.status)) add(byId.get(p.participant.personId), p.start);
    const now = clock().getTime();
    for (const [personId, list] of starts) {
      const sorted = list.sort((a, b) => Date.parse(a) - Date.parse(b));
      bookings.set(personId, { at: sorted.find(s => Date.parse(s) >= now) ?? sorted.at(-1)! });
    }
    for (const personId of await elsewhereOf(
      persona.id,
      everyone.map(m => m.personId),
      period,
    ))
      if (!bookings.has(personId)) bookings.set(personId, {});
    return bookings;
  }
  /** Draw proposals for one week. Reads the manager's calendar and the unit's free-busy, nothing is written to any source. */
  async function draw(persona: AuthenticatedContext, current: PlanningRound, week: string, excludeThread?: string) {
    const { binding, members } = await remaining(persona, current);
    if (!members.length)
      return {
        members,
        planned: [] as ReturnType<typeof planWeek<ProposalParticipant>>,
        unplaced: [] as ReturnType<typeof unplacedReasons<ProposalParticipant>>,
      };
    const start = dayStart(week),
      end = dayStart(addDays(week, 5));
    const [events, busy, existing] = await Promise.all([
      binding.provider.list(start, end),
      freeBusyOf(binding.provider, start, end, members),
      store.activeProposals(persona.id),
    ]);
    const managerBusy: Interval[] = [
      ...events.filter(e => !e.allDay).map(interval),
      ...existing.filter(p => p.threadId !== excludeThread).map(interval),
    ];
    const candidates = members.map(m => {
      const periods = busy.find(b => b.ref === m.ref);
      if (!periods || periods.state === 'unknown')
        throw new CalendarError('Medarbetarnas kalendrar kunde inte läsas just nu.');
      return { participant: participantOf(m), busy: periods.busy };
    });
    const notBefore = new Date(clock().getTime() + 3600_000).toISOString();
    const input: PlanInput<ProposalParticipant> = {
      week,
      managerBusy,
      candidates,
      notBefore,
      durationMinutes: SAMTAL_MINUTES,
    };
    const planned = planWeek(input);
    return { members, planned, unplaced: unplacedReasons(input, planned) };
  }
  function explain(current: PlanningRound, week: string, planned: number, members: number) {
    const daysLeft = Math.ceil((Date.parse(dayStart(current.dueOn)) - clock().getTime()) / 86400000);
    const head = `${members} utvecklingssamtal återstår före ${dueLabel(current.dueOn)}, om ${daysLeft} dagar.`;
    if (!planned)
      return `${head} Vecka ${weekNumber(week)} har inga lediga timmar som passar både dig och medarbetarna. Prova en annan vecka.`;
    const tail =
      planned < members
        ? ` ${members - planned} fick ingen tid vecka ${weekNumber(week)}; jag föreslår dem i nästa vecka om du vill.`
        : '';
    return `${head} Jag har ritat in ${planned} förslag vecka ${weekNumber(week)} som inte krockar med något i din eller medarbetarnas kalendrar. Bekräfta så skickar jag inbjudningarna. Ärendet visar resultatet och vad som går att ångra.${tail}`;
  }
  const records = (
    persona: AuthenticatedContext,
    threadId: string,
    planned: ReturnType<typeof planWeek<ProposalParticipant>>,
  ): ProposalRecord[] =>
    planned.map(p => ({
      id: ids(),
      threadId,
      personId: persona.id,
      status: 'proposed',
      participant: {
        personId: p.participant.personId,
        email: p.participant.email,
        name: p.participant.name,
      },
      start: p.start,
      end: p.end,
      eventUid: null,
      eventRef: null,
      eventRevision: null,
      confirmedAt: null,
      undoUntil: null,
      reminders: 0,
      remindedAt: null,
    }));
  /**
   * The planning thread that belongs to this round: the newest one when it is still open or was created since the round
   * opened, else an older one that is open again. A thread handled in an earlier round does not count.
   */
  async function roundThread(persona: AuthenticatedContext, current: PlanningRound) {
    const latest = await store.latestThread(persona.id, TOPIC);
    if (latest && (latest.thread.state === 'open' || displayDate(latest.thread.createdAt) >= current.opensOn))
      return latest;
    return store.openThread(persona.id, TOPIC);
  }
  /**
   * When the scan last read a manager's calendar for their open card and left the card as it was, or could not read it,
   * per manager, in this process: the next reading waits `CARD_READ_MS` unless the round or another manager's booking
   * changes the card. A card that changes moves its `updatedAt`, which counts as a reading.
   */
  const cardRead = new Map<string, { threadId: string; at: number }>();
  /**
   * An open card kept in step with what the count says (M1, Q12): every row and drawn time follows the facts that leave a
   * person out of "N samtal saknar tid", from one reading of the whole team. A drawn time of a person whose talk the round
   * records as held, or whom another of their current managers has booked through Clew since, leaves the card as a row
   * with that reason (D30's judgement calls), and a row of such a person gets the reason too. A row of someone with a
   * talk in the manager's own calendar (booked by hand, or an invitation of the manager's own that was sent) says "har
   * ett samtal i din kalender"; their drawn time stays, since a no leaves the declined invitation in the calendar while
   * the card offers new times. A row whose reason no longer holds for someone who lacks a time again (the booking was
   * undone or declined, its manager left them, the round no longer records the talk, or the talk left the calendar) says
   * "behöver en tid", and so does a new row for someone of the team who lacks a time and is on the card in no other way
   * (new to the team, or left off when it was drawn): another week draws them, the scan never does. The row of someone
   * who has left the team leaves the card. Each such change counts again who lacks a time, from the same reading and in
   * the same write, with its audit row; when no row and no drawn time changes, nothing is written. So of two cards drawn
   * for one person's two managers the second never sends a second talk, and the card says what the status says.
   *
   * The scan comes back every minute, and only the calendar tells a talk in it, so the cheap facts come first: the round
   * and Clew's own bookings of the people on the card. When they settle or free someone on it, the calendar is read and
   * the card kept in step at once; else it is read an hour after the card last changed or was last read, so what only the
   * calendar or the team says reaches the card within the hour. A card with a decision on its way is left as it is, a
   * time already sent is never touched, and a reading that fails leaves the card to a later scan. Whether anything
   * changed.
   */
  async function settleCard(persona: AuthenticatedContext, current: PlanningRound, card: ProposalThread) {
    if (card.thread.state !== 'open' || deciding(card.thread)) return false;
    const proposed = card.proposals.filter(p => p.status === 'proposed');
    const rowOf = (i: ThreadItem) => (i.ref.startsWith('unplaced:') ? i.ref.slice('unplaced:'.length) : undefined);
    const rowed = (items: readonly ThreadItem[]) => items.flatMap(i => rowOf(i) ?? []);
    const onCard = [...new Set([...proposed.map(p => p.participant.personId), ...rowed(card.thread.items)])];
    const held = new Set(current.held);
    const settledBy = (elsewhere: ReadonlySet<string>) => (id: string) =>
      held.has(id) ? ALREADY_HELD : elsewhere.has(id) ? BOOKED_ELSEWHERE : undefined;
    // The cheap facts: whether the round or another manager's booking settles a drawn time, or settles or frees a row.
    let soon: (id: string) => string | undefined;
    try {
      soon = settledBy(await elsewhereOf(persona.id, onCard, current));
    } catch {
      return false;
    }
    const now = clock().getTime();
    const urgent =
      proposed.some(p => soon(p.participant.personId)) ||
      card.thread.items.some(i => {
        const id = rowOf(i);
        if (id === undefined) return false;
        const reason = soon(id);
        return reason ? reason !== i.detail : i.detail === ALREADY_HELD || i.detail === BOOKED_ELSEWHERE;
      });
    const last = cardRead.get(persona.id);
    const readAt = Math.max(Date.parse(card.thread.updatedAt), last?.threadId === card.thread.id ? last.at : 0);
    if (!urgent && now - readAt < CARD_READ_MS) return false;
    const unchanged = () => {
      cardRead.set(persona.id, { threadId: card.thread.id, at: now });
      return false;
    };
    let facts: Awaited<ReturnType<typeof remaining>>;
    try {
      facts = await remaining(persona, current, onCard);
    } catch {
      return unchanged();
    }
    const { everyone, members } = facts;
    const settled = settledBy(facts.elsewhere);
    const inTeam = new Set(everyone.map(m => m.personId)),
      lacking = new Set(members.map(m => m.personId));
    const gone = proposed.filter(p => settled(p.participant.personId));
    const left = new Set(gone.map(p => 'proposal:' + p.id));
    const changed = new Set<string>();
    // Every row says what holds for its person now, as the count does; a reason the draw gave stands while they lack a
    // time. The row of someone who has left the team leaves the card.
    const items = card.thread.items.flatMap(i => {
      if (left.has(i.ref)) return [];
      const id = rowOf(i);
      if (id === undefined) return [i];
      if (!inTeam.has(id)) {
        changed.add(id);
        return [];
      }
      const reason =
        settled(id) ?? (!lacking.has(id) ? OWN_CALENDAR : SETTLED_REASONS.includes(i.detail) ? NEEDS_TIME : i.detail);
      if (reason === i.detail) return [i];
      changed.add(id);
      return [{ ...i, detail: reason }];
    });
    const rows = new Set(rowed(items)),
      added: ThreadItem[] = [];
    const add = (participant: ProposalParticipant, reason: string) => {
      rows.add(participant.personId);
      changed.add(participant.personId);
      added.push(...unplacedItems([{ participant, reason }]));
    };
    for (const p of gone)
      if (inTeam.has(p.participant.personId) && !rows.has(p.participant.personId))
        add(p.participant, settled(p.participant.personId)!);
    // Someone the card deals with in no other way: no row, and no proposal of theirs but ones replaced since.
    const dealt = new Set([
      ...rows,
      ...card.proposals.filter(p => p.status !== 'superseded' && !gone.includes(p)).map(p => p.participant.personId),
    ]);
    for (const m of members) if (!dealt.has(m.personId)) add(participantOf(m), NEEDS_TIME);
    if (!gone.length && !changed.size) return unchanged();
    cardRead.delete(persona.id);
    const at = clock().toISOString();
    await persona.authorize();
    return store.transaction(async tx => {
      const locked = await tx.lockThread(persona.id, card.thread.id);
      if (
        !locked ||
        locked.thread.updatedAt !== card.thread.updatedAt ||
        locked.thread.state !== 'open' ||
        deciding(locked.thread)
      )
        return false;
      if (gone.length)
        await tx.updateProposals(
          gone.map(p => p.id),
          { status: 'superseded' },
        );
      await tx.updateThread(card.thread.id, {
        items: [...items, ...added],
        trigger: {
          ...locked.thread.trigger,
          reason: `${members.length} samtal saknar tid före ${dueLabel(current.dueOn)}`,
        },
        updatedAt: at,
      });
      await tx.writeAudit({
        actor: 'assistant:scan',
        action: 'proposals.settled_elsewhere',
        subject: 'thread:' + card.thread.id,
        at,
        details: { proposals: gone.map(p => p.id), people: [...changed].sort(), owner: persona.id },
      });
      return true;
    });
  }
  /**
   * The nightly scan (and the first visit): one open thread per topic and round. Re-running keeps an open thread in step
   * with what its count says (`settleCard`): at once when the round or another manager's booking changes it, else within
   * the hour; it never silently changes confirmed ones. Without an open round, or while the round cannot be read,
   * nothing is planned.
   */
  async function ensureProposalThread(
    persona: AuthenticatedContext,
    source = 'Nattlig genomgång 06:00',
  ): Promise<Thread | undefined> {
    if (persona.role !== 'manager') return undefined;
    await persona.authorize();
    const current = await roundFor(persona);
    if (!current) return undefined;
    const existing = await roundThread(persona, current);
    if (existing) {
      // A thread drawn before rows existed gets them now, so the card and the conversation see one draft mechanism.
      const proposed = existing.proposals.filter(p => p.status === 'proposed');
      if (!existing.thread.items.length && proposed.length) {
        await store.transaction(async tx => {
          const locked = await tx.lockThread(persona.id, existing.thread.id);
          if (!locked || locked.thread.items.length || locked.thread.state !== 'open') return;
          await tx.updateThread(existing.thread.id, {
            items: proposalItems(proposed),
            updatedAt: clock().toISOString(),
          });
          await tx.writeAudit({
            actor: 'system:migration',
            action: 'proposals.presentation_repaired',
            subject: 'thread:' + existing.thread.id,
            at: clock().toISOString(),
          });
        });
        return thread(persona, existing.thread.id);
      }
      return (await settleCard(persona, current, existing)) ? thread(persona, existing.thread.id) : existing.thread;
    }
    const week = nextWeekStart(todayDate());
    const { members, planned, unplaced } = await draw(persona, current, week);
    if (!members.length) return undefined;
    const at = clock().toISOString(),
      id = ids();
    await persona.authorize();
    const inserted = await store.transaction(async tx => {
      const summary = explain(current, week, planned.length, members.length);
      const created = await tx.insertThread({
        id,
        personId: persona.id,
        topic: TOPIC,
        title: `Planera utvecklingssamtal vecka ${weekNumber(week)}`,
        week,
        area: 'utvecklingssamtal',
        summary,
        trigger: { reason: `${members.length} samtal saknar tid före ${dueLabel(current.dueOn)}`, source, at },
        createdAt: at,
        updatedAt: at,
      });
      if (!created) return false;
      await tx.addMessage(id, { role: 'assistant', body: summary, at });
      const rows = records(persona, id, planned);
      await tx.insertProposals(rows);
      await tx.updateThread(id, { items: [...proposalItems(rows), ...unplacedItems(unplaced)] });
      await tx.writeAudit({
        actor: 'assistant:scan',
        action: 'thread.pushed',
        subject: 'thread:' + id,
        at,
        details: { topic: TOPIC, week, proposals: planned.length, owner: persona.id },
      });
      return true;
    });
    return inserted ? thread(persona, id) : (await store.latestThread(persona.id, TOPIC))?.thread;
  }
  /**
   * "Vecka 47 i stället": redraw every unconfirmed proposal of the thread in another week, and count again who lacks a
   * time, as the redrawn card shows.
   */
  async function replan(persona: AuthenticatedContext, threadId: string, week: string) {
    const current = await store.readThread(persona.id, threadId);
    if (!current || current.thread.state !== 'open') throw new InputError('Ärendet är redan hanterat.');
    if (Date.parse(dayStart(week)) < Date.parse(dayStart(todayDate())) || weekStartMismatch(week))
      throw new InputError('Välj en kommande vecka.');
    const open = await roundFor(persona);
    if (!open) throw new InputError('Det finns ingen omgång av utvecklingssamtal att planera just nu.');
    const { members, planned, unplaced } = await draw(persona, open, week, threadId);
    const at = clock().toISOString();
    await store.transaction(async tx => {
      const locked = await tx.lockThread(persona.id, threadId);
      if (
        !locked ||
        locked.thread.updatedAt !== current.thread.updatedAt ||
        (locked.thread.execution && ['pending', 'running', 'unknown'].includes(locked.thread.execution.state))
      )
        throw new InputError('Förslaget har ändrats. Läs om sidan.');
      await tx.transition(threadId, 'proposed', { status: 'superseded' });
      const rows = records(persona, threadId, planned);
      await tx.insertProposals(rows);
      await tx.updateThread(threadId, {
        week,
        title: `Planera utvecklingssamtal vecka ${weekNumber(week)}`,
        items: [...proposalItems(rows), ...unplacedItems(unplaced)],
        trigger: {
          ...locked.thread.trigger,
          reason: `${members.length} samtal saknar tid före ${dueLabel(open.dueOn)}`,
        },
        updatedAt: at,
      });
      await tx.addMessage(threadId, { role: 'user', body: `Vecka ${weekNumber(week)} i stället`, at });
      await tx.addMessage(threadId, {
        role: 'assistant',
        body: explain(open, week, planned.length, members.length),
        at,
      });
      await tx.writeAudit({
        actor: principal(persona),
        action: 'proposals.replanned',
        subject: 'thread:' + threadId,
        at,
        details: { week, proposals: planned.length },
      });
    });
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
  const responseOf = (response: ParticipantResponse | undefined): 'accepted' | 'declined-by-invitee' | null =>
    response === 'accepted' ? 'accepted' : response === 'declined' ? 'declined-by-invitee' : null;
  /**
   * Replies read back from the calendar (D30): every invitation still waiting is looked up and the invitee's PARTSTAT
   * becomes the proposal's status. A no draws two alternative times for that one person and puts the thread back under
   * Nu for the manager, so the answer is a card with two choices, never a calendar to search.
   */
  async function readReplies(threadId: string) {
    const found = await owned(threadId);
    if (!found) return { accepted: [] as string[], declined: [] as string[] };
    const { current, persona, binding } = found;
    const accepted: ProposalRecord[] = [],
      declined: ProposalRecord[] = [];
    // The answer itself changes the event, and the replacement cancels it with the revision that holds the answer.
    const revisions = new Map<string, string>();
    for (const p of current.proposals.filter(waitingOnInvitee)) {
      try {
        const ref = p.eventRef ?? (p.eventUid ? await binding.provider.eventRef(p.eventUid) : null);
        const event = ref ? await binding.provider.lookup(ref) : null;
        const invitee = event?.participants.find(x => x.email.toLowerCase() === p.participant.email.toLowerCase());
        const status = responseOf(invitee?.response);
        if (status === 'accepted') accepted.push(p);
        else if (status === 'declined-by-invitee') {
          declined.push(p);
          if (event) revisions.set(p.id, event.revision);
        }
      } catch {
        /* a calendar that cannot answer now is asked again at the next check */
      }
    }
    if (!accepted.length && !declined.length) return { accepted: [], declined: [] };
    const everyone = declined.length ? await team(persona) : [];
    const now = clock(),
      at = now.toISOString();
    // Two alternatives per no, drawn like any proposal: the person's own busy time and the manager's, this week or the next.
    const alternatives: ProposalRecord[] = [];
    for (const p of declined) {
      // The person by id (N3); a new invitation goes to the address the team has for them now.
      const member = everyone.find(m => m.personId === p.participant.personId);
      const week =
        Date.parse(dayStart(current.thread.week ?? todayDate())) > now.getTime()
          ? current.thread.week!
          : nextWeekStart(todayDate());
      const start = dayStart(week),
        end = dayStart(addDays(week, 5));
      const [events, busy, existing] = await Promise.all([
        binding.provider.list(start, end),
        member ? freeBusyOf(binding.provider, start, end, [member]) : Promise.resolve([]),
        store.activeProposals(persona.id),
      ]);
      const periods = busy[0];
      if (!periods || periods.state === 'unknown') continue;
      // The declined time stays busy: the old invitation is in the calendar until the new one is read back, and the person said no to it.
      const managerBusy: Interval[] = [
        ...events.filter(e => !e.allDay).map(interval),
        ...existing.filter(x => x.id !== p.id).map(interval),
      ];
      const candidate = {
        participant: member ? participantOf(member) : { ...p.participant },
        busy: periods && periods.state === 'known' ? periods.busy : [],
      };
      const notBefore = new Date(now.getTime() + 3600_000).toISOString();
      const first = planWeek({
        week,
        managerBusy,
        candidates: [candidate],
        notBefore,
        durationMinutes: SAMTAL_MINUTES,
      })[0];
      const second = first
        ? planWeek({
            week,
            managerBusy: [...managerBusy, interval(first)],
            candidates: [candidate],
            notBefore,
            durationMinutes: SAMTAL_MINUTES,
          })[0]
        : undefined;
      for (const slot of [first, second]) if (slot) alternatives.push(...records(persona, threadId, [slot]));
    }
    await persona.authorize();
    await store.transaction(async tx => {
      const locked = await tx.lockThread(persona.id, threadId);
      if (
        !locked ||
        locked.thread.updatedAt !== current.thread.updatedAt ||
        (locked.thread.execution && ['pending', 'running', 'unknown'].includes(locked.thread.execution.state))
      )
        return;
      if (accepted.length)
        await tx.updateProposals(
          accepted.map(p => p.id),
          { status: 'accepted' },
        );
      for (const p of declined)
        await tx.updateProposals([p.id], {
          status: 'declined-by-invitee',
          eventRevision: revisions.get(p.id) ?? p.eventRevision,
        });
      if (alternatives.length) await tx.insertProposals(alternatives);
      const sum = replySummary([
        ...current.proposals
          .filter(p => p.status !== 'superseded')
          .map(p => ({
            status: accepted.includes(p)
              ? ('accepted' as const)
              : declined.includes(p)
                ? ('declined-by-invitee' as const)
                : p.status,
          })),
      ]);
      if (declined.length) {
        const names = declined
          .map(
            p => `${p.participant.name} kan inte ${shortDayLabel(displayDate(p.start))} ${timeRange(p.start, p.end)}`,
          )
          .join('. ');
        const summary = alternatives.length
          ? `${names}. Jag har ritat ${alternatives.length === 1 ? 'en annan tid' : 'två andra tider'} som är ${alternatives.length === 1 ? 'ledig' : 'lediga'} för er båda; välj en så skickar jag en ny inbjudan och tar bort den gamla.`
          : `${names}. Jag hittade ingen annan tid den här veckan; prova en annan vecka.`;
        const firstAlternative = new Set(
          declined.map(d => alternatives.find(a => a.participant.personId === d.participant.personId)?.id),
        );
        await tx.updateThread(threadId, {
          state: 'open',
          handledAt: null,
          waitingOn: null,
          deadline: todayDate(),
          summary,
          updatedAt: at,
          items: [
            ...proposalItems(alternatives, id => firstAlternative.has(id)),
            ...keepUnplaced(current.thread.items),
          ],
        });
        await tx.addMessage(threadId, { role: 'assistant', body: summary, at });
      } else {
        await tx.updateThread(threadId, {
          updatedAt: at,
          ...(current.thread.waitingOn
            ? { waitingOn: sum.waiting ? `svar från ${sum.waiting} medarbetare` : null }
            : {}),
        });
        await tx.addMessage(threadId, {
          role: 'assistant',
          body: `${sum.accepted} av ${sum.total} har svarat ja.${sum.waiting ? ` ${sum.waiting} har inte svarat ännu.` : ''}`,
          at,
        });
      }
      await tx.writeAudit({
        actor: 'assistant:obligation',
        action: 'proposals.replies',
        subject: 'thread:' + threadId,
        at,
        details: {
          accepted: accepted.map(p => p.id),
          declined: declined.map(p => p.id),
          alternatives: alternatives.map(a => a.id),
          owner: persona.id,
        },
      });
    });
    return { accepted: accepted.map(p => p.id), declined: declined.map(p => p.id) };
  }
  /** Timer: after ten minutes a confirmation becomes final and the thread shows it under "Redan hanterat". */
  async function closeUndoWindow(threadId: string) {
    const at = clock().toISOString(),
      existing = await store.readThreadById(threadId);
    const owner = existing?.proposals[0]?.personId;
    if (!owner) return;
    await store.transaction(async tx => {
      const locked = await tx.lockThread(owner, threadId);
      const ids =
        locked?.proposals.filter(p => p.status === 'confirmed' && p.undoUntil && p.undoUntil <= at).map(p => p.id) ??
        [];
      if (!ids.length) return;
      await tx.updateProposals(ids, { status: 'final' });
      await tx.updateThread(threadId, { updatedAt: at });
      await tx.writeAudit({
        actor: 'assistant:timer',
        action: 'proposals.final',
        subject: 'thread:' + threadId,
        at,
        details: { proposals: ids },
      });
    });
  }
  /** Avfärda on a proposal thread: the drawn times are declined, nothing was ever sent. */
  async function dismiss(persona: AuthenticatedContext, threadId: string) {
    const current = await store.readThread(persona.id, threadId);
    if (!current || current.thread.state !== 'open') throw new InputError('Ärendet är redan hanterat.');
    const at = clock().toISOString();
    await persona.authorize();
    await store.transaction(async tx => {
      const locked = await tx.lockThread(persona.id, threadId);
      if (
        !locked ||
        locked.thread.state !== 'open' ||
        locked.thread.updatedAt !== current.thread.updatedAt ||
        (locked.thread.execution && ['pending', 'running', 'unknown'].includes(locked.thread.execution.state))
      )
        throw new InputError('Ärendet har ändrats. Läs om sidan.');
      await tx.transition(threadId, 'proposed', { status: 'declined' });
      await tx.updateThread(threadId, { state: 'dismissed', handledAt: at, updatedAt: at });
      await tx.writeAudit({ actor: principal(persona), action: 'thread.dismissed', subject: 'thread:' + threadId, at });
    });
    return thread(persona, threadId);
  }
  return {
    listWeek,
    readToday,
    weekView,
    weekOverview,
    samtalStatus,
    samtalBookings,
    ensureProposalThread,
    replan,
    closeUndoWindow,
    dismiss,
    readReplies,
  };
}
export type CalendarUsecases = ReturnType<typeof calendarUsecases>;
