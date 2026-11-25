import type {
  AuthenticatedContext,
  CommitmentAddBody,
  CommitmentRow,
  CommitmentsInput,
  CommitmentsOutput,
  StaffPerson,
  TalkBookingBody,
  TalkHeldBody,
  TalkState,
  TalksOutput,
} from '@clew/contracts';
import { ForbiddenError, InputError } from '../../context';
import {
  PREPARE_DAYS_DEFAULT,
  PREPARE_DAYS_MAX,
  bookingAsks,
  commitmentRow,
  differenceDetails,
  differenceOf,
  isCalendarDay,
  noticeCard,
  normaliseLabel,
  normaliseSpan,
  normaliseText,
  orderCommitmentRows,
  orderTalkRows,
  overdueCounts,
  personKey,
  sameDifference,
  sameUserName,
  standingBooking,
  swedishDay,
  talkRow,
  talkState,
} from './domain';
import type {
  CalendarDifference,
  CommitmentRecord,
  RoundRecord,
  TalkBooking,
  TalkDeps,
  TalkExport,
  TalkRecord,
  TalkTx,
} from './model';

/** A request the talks module turns down for what it asks, not who asks (D96); a 400 with this message. */
export class TalkError extends InputError {
  constructor(message: string) {
    super(message);
    this.name = 'TalkError';
  }
}
const NOT_A_MANAGER = 'Utvecklingssamtalen är för den som är chef för en enhet.';
const NOT_YOURS = 'Personen finns inte bland dem du är chef för.';
const NO_ROUND = 'Det finns ingen öppen omgång av utvecklingssamtal.';
const NOT_ALLOWED = 'Du kan inte ändra den här åtgärdspunkten.';
const BAD_DAY = 'Ange ett giltigt datum.';
const BAD_SPAN = 'Ange en giltig start- och sluttid, med högst ett dygn emellan.';
const HELD_ALREADY = 'Samtalet är redan markerat som hållet.';
/**
 * A booking an invitation carries is changed by what happens to the invitation, never by hand (D132 item 4). The
 * sentence names who sent the invitation, the installation by its name (D98); it is only shown, never matched on.
 */
const INVITED = (site: string) => `Samtalet är bokat genom en inbjudan från ${site}, så tiden kan inte ändras här.`;
const CHANGED = 'Samtalet har ändrats. Läs om sidan.';
/** Whether two readings of a talk's booking are the same booking: by whom, when recorded and what carries it. */
const sameBooking = (a: TalkBooking | null | undefined, b: TalkBooking | null | undefined) =>
  (a ?? null) === (b ?? null) ||
  (!!a && !!b && a.bookedBy === b.bookedBy && a.bookedAt === b.bookedAt && a.invitationId === b.invitationId);
/** The actor of a row written because a `due` timer fired; the convention of the other timer-driven rows. */
const TIMER_ACTOR = 'system:scheduler';
/** The version of the export document (D96 item 10); a breaking change is a new version. */
export const TALKS_EXPORT_FORMAT = 'clew.talks/1';
/** The open round as a list about people or units names it (D97): its label and the day it is due. */
export interface RoundHeading {
  label: string;
  dueOn: string;
}
/** Where one person stands in the open round (D97, `talks.person`), keyed as they were asked about. */
export interface PersonStanding {
  key: string;
  personId: string;
  state: TalkState;
  /** The booked instant or the held day. */
  at?: string;
  /** Open action points about the person, from any round. */
  open: number;
  /** Of those, the ones whose due day has passed. */
  overdue: number;
}
/** Where the people of one unit stand in the open round (D97, `talks.unit`). */
export interface UnitStanding {
  key: string;
  due: number;
  held: number;
  booked: number;
  missing: number;
}
/**
 * A card the scan asks for about one person's talk (D133, D134), for the manager whose booking it is: `calendar` when
 * the calendar no longer holds what the booking says, `prepare` in the working days before a booked talk, and `held`
 * from the day after its time, asking whether it took place. Derived from the talk's record and the clock each time and
 * never stored: the platform opens the card, resolves it when its cause is gone and brings a handled one back when what
 * it says changes (D47).
 */
export type TalkNotice = {
  personId: string;
  /** The person's user name, by which a card's row names them; null for a person provisioned without one. */
  userName: string | null;
  booking: { start: string; end: string };
  card: ReturnType<typeof noticeCard>;
} & ({ kind: 'calendar'; calendar: CalendarDifference } | { kind: 'prepare' } | { kind: 'held' });
/**
 * What erasing one person from the domain did, counts only (D96 item 10), or why it erased nothing: an id the people
 * table does not hold, or a person the source has not deactivated (D122 item 7, D123 item 3).
 */
export type TalkErasure =
  { refused: 'unknown' | 'active' } | { talks: number; commitments: number; cleared: number; cards: number };

/**
 * The talks module's use cases (D96): the round of development talks and its action points. A manager's reach is
 * computed from the assignments when asked (`deps.staff`), never stored, so the day the assignment changes a former
 * manager reads and writes nothing about the person but the action points they own themselves: those stay theirs, on
 * their own list, until they are done (As built item 5, M2). One record per person per round, read and written by every
 * current manager (Q12). When a talk is booked is that record's (D132): nothing is read from a calendar, and a booking
 * counts while the manager whose booking it is still manages the person. Every change is one `deps.store` transaction
 * with its audit row and, for an action point, its owner's card. Audit rows carry ids, dates, counts and roles: never an
 * action point's text or a name.
 */
export function talkUsecases(deps: TalkDeps) {
  const now = () => deps.clock();
  /**
   * The people the persona manages a talk with now: everyone on the units they manage except themselves, each once,
   * deactivated people left out. `manages` is false for someone who manages no unit.
   */
  async function managed(persona: AuthenticatedContext) {
    const staff = await deps.staff(persona);
    const people = new Map<string, StaffPerson>();
    for (const unit of staff.units)
      for (const p of unit.people)
        if (p.id !== persona.id && p.enabled !== false && !people.has(p.id)) people.set(p.id, p);
    return { manages: staff.units.length > 0, people, units: staff.units };
  }
  async function employeeOf(persona: AuthenticatedContext, employeeId: string) {
    const { manages, people } = await managed(persona);
    if (!manages) throw new ForbiddenError(NOT_A_MANAGER);
    const employee = people.get(employeeId);
    if (!employee) throw new ForbiddenError(NOT_YOURS);
    return employee;
  }
  async function openRoundOf(tx: TalkTx, organisationId: string) {
    const round = await tx.currentRound(organisationId);
    if (!round) throw new TalkError(NO_ROUND);
    return round;
  }
  /**
   * The round, the talks and the open counts of the people the persona manages, read in one transaction. With
   * `overdueOn` (today), also how many of each person's open action points are overdue.
   */
  async function roundOf(persona: AuthenticatedContext, people: Map<string, StaffPerson>, overdueOn?: string) {
    const ids = [...people.keys()];
    return deps.store.transaction(async tx => {
      const round = await tx.currentRound(persona.organisationId);
      if (!round)
        return {
          round: undefined,
          people,
          talks: new Map<string, TalkRecord>(),
          open: new Map<string, number>() as ReadonlyMap<string, number>,
          overdue: new Map<string, number>() as ReadonlyMap<string, number>,
        };
      const talks = new Map((await tx.talks(round.id, ids)).map(t => [t.employeeId, t]));
      const overdue: ReadonlyMap<string, number> =
        overdueOn === undefined || !ids.length
          ? new Map()
          : overdueCounts(await tx.commitmentsAbout(ids, round.id), overdueOn);
      return { round, people, talks, open: await tx.openCounts(ids), overdue };
    });
  }
  /**
   * Whose bookings count among these talks (D132 item 2), for `standingBooking`: the reader's own, since every talk
   * here is with someone the reader manages, and another manager's while that manager still manages the employee. Each
   * other manager's people are asked for once.
   */
  async function bookers(readerId: string, talks: Iterable<TalkRecord>) {
    const others = new Set<string>();
    for (const t of talks) if (t.booking?.bookedBy && t.booking.bookedBy !== readerId) others.add(t.booking.bookedBy);
    const reports = new Map(await Promise.all([...others].map(async id => [id, await deps.reports(id)] as const)));
    return (talk: TalkRecord | undefined) =>
      standingBooking(talk, id => id === readerId || (!!talk && !!reports.get(id)?.has(talk.employeeId)));
  }
  /**
   * Whether an invitation carries this person's talk now (D132 item 4): the booking on the record is an invitation's
   * and still counts, so it is not changed by hand. One that no longer counts is as no booking to the reader.
   */
  async function invitationStands(readerId: string, employeeId: string, booking: TalkBooking | null | undefined) {
    if (!booking?.invitationId || booking.bookedBy === null) return false;
    return booking.bookedBy === readerId || (await deps.reports(booking.bookedBy)).has(employeeId);
  }
  /**
   * The booking on the person's talk in the open round as it reads now, and whether an invitation carries it. Whether a
   * booking still counts is the people module's to say, so this is read before a write to it; the write's transaction
   * refuses when the booking is no longer the one that was read (`sameBooking`).
   */
  async function bookingBefore(persona: AuthenticatedContext, employeeId: string) {
    const before = await deps.store.transaction(async tx => {
      const round = await tx.currentRound(persona.organisationId);
      return round ? (await tx.talk(round.id, employeeId))?.booking : undefined;
    });
    return { before, invited: await invitationStands(persona.id, employeeId, before) };
  }
  /**
   * Where these people stand in the open round (D96 item 2, D132): the round and its talks, and for each the booking
   * that counts now. Undefined when no round is open.
   */
  async function standing(persona: AuthenticatedContext, people: Map<string, StaffPerson>, overdueOn?: string) {
    const read = await roundOf(persona, people, overdueOn);
    if (!read.round) return undefined;
    const round = read.round;
    const booked = await bookers(persona.id, read.talks.values());
    const bookingOf = (id: string) => booked(read.talks.get(id));
    const stateOf = (id: string) => talkState(read.talks.get(id), bookingOf(id));
    return { ...read, round, bookingOf, stateOf };
  }
  const headingOf = (s: NonNullable<Awaited<ReturnType<typeof standing>>>): RoundHeading => ({
    label: s.round.label,
    dueOn: s.round.dueOn,
  });
  /** A talk's record with one part replaced, new when the person has none in the round yet. */
  const talkWith = (
    existing: TalkRecord | undefined,
    roundId: string,
    employeeId: string,
    at: string,
    patch: Partial<Pick<TalkRecord, 'heldOn' | 'heldBy' | 'booking'>>,
  ): TalkRecord => ({
    id: existing?.id ?? deps.ids(),
    roundId,
    employeeId,
    heldOn: existing?.heldOn ?? null,
    heldBy: existing?.heldBy ?? null,
    booking: existing?.booking ?? null,
    createdAt: existing?.createdAt ?? at,
    ...patch,
    updatedAt: at,
  });
  /**
   * Who may mark this action point done or open it again (D96 item 4, Q12), and as whom: its owner, or a current manager
   * of the employee (`people`, the persona's own) taking over a manager's point whose owner no longer manages the
   * employee or was erased. Nobody else, so a co-manager's points and the employee's own stay their owners'.
   */
  async function mayChange(
    persona: AuthenticatedContext,
    people: ReadonlyMap<string, StaffPerson>,
    c: CommitmentRecord,
  ): Promise<'owner' | 'manager' | undefined> {
    if (c.ownerId === persona.id) return 'owner';
    return c.ownerRole === 'manager' &&
      people.has(c.employeeId) &&
      (c.ownerId === null || !(await deps.reports(c.ownerId)).has(c.employeeId))
      ? 'manager'
      : undefined;
  }
  /**
   * Mark an action point done or open again (D96 item 4, Q12): its owner does; a current manager of the employee takes
   * over a manager's point whose owner no longer manages the employee (or was erased), so that nothing stays open for good
   * when a manager leaves. A co-manager's points and the employee's own are left to their owners. Who may is read before
   * the transaction, since whether the owner still manages the employee is the people module's to say; the transaction
   * refuses if the point's owner or employee moved in between.
   */
  async function setDone(persona: AuthenticatedContext, id: string, done: boolean) {
    const { people } = await managed(persona);
    const read = await deps.store.transaction(tx => tx.commitment(id));
    const as = read && (await mayChange(persona, people, read));
    if (!read || !as) throw new ForbiddenError(NOT_ALLOWED);
    const asOwner = as === 'owner',
      asManager = as === 'manager';
    const at = now().toISOString();
    await deps.store.transaction(async tx => {
      const c = await tx.commitment(id);
      if (!c || c.employeeId !== read.employeeId || (c.ownerId !== read.ownerId && !(asManager && c.ownerId === null)))
        throw new ForbiddenError(NOT_ALLOWED);
      if ((c.doneAt !== null) === done) return;
      if (done) {
        await tx.updateCommitment(id, { doneAt: at, doneBy: persona.id });
        if (c.threadId) await tx.workItems.close(c.threadId, at);
      } else {
        await tx.updateCommitment(id, { doneAt: null, doneBy: null });
        if (c.threadId) await tx.workItems.reopen(c.threadId, c.dueOn, at);
      }
      await tx.audit({
        actor: persona.principal.id,
        action: done ? 'talks.commitment_done' : 'talks.commitment_reopened',
        subject: 'commitment:' + id,
        at,
        details: { roundId: c.roundId, ownerRole: c.ownerRole, by: asOwner ? 'owner' : 'manager' },
      });
    });
  }

  return {
    /**
     * An operator opens a round for the organisation (D96 item 1): the open one, if any, is closed in the same
     * transaction. A talk of the closed round that is booked for a time still to come, and not held, is the new round's
     * talk from then on: its booking moves with it, invitation and all, so the person reads as booked in the round that
     * is open and the cards that hang on the booking are still asked for (D132). `actor` is the operator's, such as
     * `operator:cli`. Returns the new round's id.
     */
    async openRound(
      actor: string,
      input: { organisationId: string; label: string; opensOn: string; dueOn: string; prepareDays?: number },
    ): Promise<string> {
      const label = normaliseLabel(input.label);
      if (!label) throw new TalkError('The label must be 1 to 120 characters.');
      const prepareDays = input.prepareDays ?? PREPARE_DAYS_DEFAULT;
      if (!Number.isInteger(prepareDays) || prepareDays < 0 || prepareDays > PREPARE_DAYS_MAX)
        throw new TalkError(`prepareDays must be a whole number from 0 to ${PREPARE_DAYS_MAX}.`);
      if (!isCalendarDay(input.opensOn) || !isCalendarDay(input.dueOn))
        throw new TalkError('opensOn and dueOn must be calendar days, YYYY-MM-DD.');
      if (input.dueOn < input.opensOn) throw new TalkError('dueOn may not be before opensOn.');
      const at = now().toISOString(),
        id = deps.ids();
      return deps.store.transaction(async tx => {
        const current = await tx.currentRound(input.organisationId);
        if (current) {
          await tx.closeRound(current.id, at);
          await tx.audit({
            actor,
            action: 'talks.round_closed',
            subject: 'round:' + current.id,
            at,
            details: { organisationId: input.organisationId },
          });
        }
        await tx.insertRound({
          id,
          organisationId: input.organisationId,
          kind: 'development',
          label,
          opensOn: input.opensOn,
          dueOn: input.dueOn,
          prepareDays,
          createdBy: actor,
          createdAt: at,
          closedAt: null,
        });
        let carried = 0;
        for (const talk of current ? await tx.bookedTalks(current.id) : []) {
          if (talk.heldOn || !talk.booking || talk.booking.end <= at) continue;
          await tx.saveTalk({ ...talk, booking: null, updatedAt: at });
          await tx.saveTalk({
            id: deps.ids(),
            roundId: id,
            employeeId: talk.employeeId,
            heldOn: null,
            heldBy: null,
            booking: talk.booking,
            createdAt: at,
            updatedAt: at,
          });
          carried++;
        }
        await tx.audit({
          actor,
          action: 'talks.round_opened',
          subject: 'round:' + id,
          at,
          details: {
            organisationId: input.organisationId,
            opensOn: input.opensOn,
            dueOn: input.dueOn,
            prepareDays,
            closed: current?.id ?? null,
            carried,
          },
        });
        return id;
      });
    },

    /**
     * `talks.talks` (D96 items 2 and 8, D132): the open round and one row per person the manager plans a talk with,
     * each from the talk's own record. A booked row says when, to every current manager of the person.
     */
    async round(persona: AuthenticatedContext): Promise<TalksOutput> {
      const { manages, people } = await managed(persona);
      if (!manages) throw new ForbiddenError(NOT_A_MANAGER);
      const read = await standing(persona, people);
      if (!read) return { round: null, rows: [] };
      const { round } = read;
      const rows = [...read.people.values()].map(p =>
        talkRow(p, read.talks.get(p.id), read.bookingOf(p.id), read.open.get(p.id) ?? 0, persona.id),
      );
      return {
        round: { label: round.label, opensOn: round.opensOn, dueOn: round.dueOn },
        rows: orderTalkRows(rows),
      };
    },

    /**
     * `talks.person` (D97): where each person asked about stands in the open round, with their open and overdue action
     * points. `keys` are user names, compared without regard to case; a row carries the key as it was asked. Only the
     * people the persona plans a talk with now are answered: anyone else, a person without a user name, a key asked twice
     * and everything when no round is open are answered as no row, never as a refusal. Reads, so no audit row.
     */
    async aboutPeople(
      persona: AuthenticatedContext,
      keys: readonly string[],
    ): Promise<{ round: RoundHeading | null; rows: PersonStanding[] }> {
      const { people } = await managed(persona);
      const asked = new Map<string, StaffPerson>();
      for (const key of keys) {
        const p = [...people.values()].find(x => sameUserName(x.userName, key));
        if (p && ![...asked.values()].includes(p)) asked.set(key, p);
      }
      const read = await standing(persona, new Map([...asked.values()].map(p => [p.id, p])), swedishDay(now()));
      if (!read) return { round: null, rows: [] };
      const rows = [...asked].map(([key, p]): PersonStanding => {
        const { state, at } = read.stateOf(p.id);
        return {
          key,
          personId: p.id,
          state,
          ...(at ? { at } : {}),
          open: read.open.get(p.id) ?? 0,
          overdue: read.overdue.get(p.id) ?? 0,
        };
      });
      return { round: headingOf(read), rows };
    },

    /**
     * `talks.unit` (D97): for each unit asked about that the persona manages, how many of its people are due a talk in
     * the open round and how many of those are held, booked and missing. A unit the persona does not manage, or with
     * nobody due, is answered as no row. Reads, so no audit row.
     */
    async aboutUnits(
      persona: AuthenticatedContext,
      keys: readonly string[],
    ): Promise<{ round: RoundHeading | null; rows: UnitStanding[] }> {
      const { people, units } = await managed(persona);
      const asked = new Set(keys);
      const chosen = units.filter(u => asked.has(u.unitId));
      const due = (unit: (typeof units)[number]) => [
        ...new Set(unit.people.filter(p => people.has(p.id)).map(p => p.id)),
      ];
      const members = new Map(chosen.flatMap(due).map(id => [id, people.get(id)!] as const));
      const read = await standing(persona, members);
      if (!read) return { round: null, rows: [] };
      const rows = [...new Map(chosen.map(u => [u.unitId, u])).values()].flatMap((u): UnitStanding[] => {
        const ids = due(u);
        if (!ids.length) return [];
        const count = (state: TalkState) => ids.filter(id => read.stateOf(id).state === state).length;
        return [
          { key: u.unitId, due: ids.length, held: count('held'), booked: count('booked'), missing: count('missing') },
        ];
      });
      return { round: headingOf(read), rows };
    },

    /**
     * The area's figure (D96 item 7): how many of the people the manager plans for have had their talk held in the open
     * round. Null for someone who manages nobody, with no open round, or with nobody due a talk.
     */
    async progress(
      persona: AuthenticatedContext,
    ): Promise<{ held: number; due: number; round: Pick<RoundRecord, 'label' | 'dueOn'> } | null> {
      const { manages, people } = await managed(persona);
      if (!manages) return null;
      const read = await roundOf(persona, people);
      if (!read.round || !read.people.size) return null;
      const held = [...read.people.keys()].filter(id => read.talks.get(id)?.heldOn).length;
      return { held, due: read.people.size, round: { label: read.round.label, dueOn: read.round.dueOn } };
    },

    /**
     * `talks.commitments` (D96 items 4 and 8). With `person` (a user name, or the id of a person provisioned without
     * one): that employee's action points, for any current manager of theirs. Without: the reader's, since both see
     * them: every one the reader owns, about whomever (a former manager's own points stay theirs until done, M2), and
     * every one about the reader, each once, the reader's own listed first. Either way every one added in the open
     * round and every open one from earlier rounds.
     */
    async commitments(persona: AuthenticatedContext, input: CommitmentsInput = {}): Promise<CommitmentsOutput> {
      let about: string | undefined;
      if (input.person !== undefined) {
        const { manages, people } = await managed(persona);
        if (!manages) throw new ForbiddenError(NOT_A_MANAGER);
        // A user name is compared without regard to case (D97), so a row of `talks.person` opens with its key as asked.
        const person = input.person;
        about = [...people.values()].find(p => sameUserName(personKey(p), person))?.id;
        if (!about) throw new ForbiddenError(NOT_YOURS);
      }
      return deps.store.transaction(async tx => {
        const round = await tx.currentRound(persona.organisationId);
        const roundId = round?.id ?? null;
        const records = about
          ? await tx.commitmentsAbout([about], roundId)
          : [
              ...new Map(
                [
                  ...(await tx.commitmentsOwnedBy(persona.id, roundId)),
                  ...(await tx.commitmentsAbout([persona.id], roundId)),
                ].map(c => [c.id, c] as const),
              ).values(),
            ];
        const persons = new Map(
          (await tx.persons([...new Set(records.map(c => c.employeeId))])).map(p => [p.id, p] as const),
        );
        const rows: CommitmentRow[] = records.flatMap(c => {
          const employee = persons.get(c.employeeId);
          return employee ? [commitmentRow(c, employee, persona.id, roundId)] : [];
        });
        return { rows: orderCommitmentRows(rows, { mineFirst: !about }) };
      });
    },

    /**
     * A current manager of the employee marks the talk held (D96 item 2), on `heldOn` or today in Swedish time. A person
     * with two managers has one talk a round: either marks it, moves its day or undoes it, and the audit row names who
     * (Q12).
     */
    async markHeld(
      persona: AuthenticatedContext,
      employeeId: string,
      body: TalkHeldBody = {},
    ): Promise<{ id: string; heldOn: string }> {
      await employeeOf(persona, employeeId);
      const at = now(),
        iso = at.toISOString(),
        today = swedishDay(at);
      const heldOn = body.heldOn ?? today;
      if (!isCalendarDay(heldOn)) throw new TalkError(BAD_DAY);
      if (heldOn > today) throw new TalkError('Ett samtal kan inte markeras som hållet en dag som inte har kommit.');
      return deps.store.transaction(async tx => {
        const round = await openRoundOf(tx, persona.organisationId);
        const existing = await tx.talk(round.id, employeeId);
        if (existing?.heldOn === heldOn) return { id: existing.id, heldOn };
        const talk = talkWith(existing, round.id, employeeId, iso, { heldOn, heldBy: persona.id });
        const id = talk.id;
        await tx.saveTalk(talk);
        await tx.audit({
          actor: persona.principal.id,
          action: 'talks.held',
          subject: 'talk:' + id,
          at: iso,
          details: { roundId: round.id, employeeId, heldOn },
        });
        return { id, heldOn };
      });
    },

    /**
     * A current manager of the employee undoes marking the talk held. A talk that is not marked held is left as it is,
     * with no audit row.
     */
    async unmarkHeld(persona: AuthenticatedContext, employeeId: string): Promise<void> {
      await employeeOf(persona, employeeId);
      const at = now().toISOString();
      await deps.store.transaction(async tx => {
        const round = await openRoundOf(tx, persona.organisationId);
        const existing = await tx.talk(round.id, employeeId);
        if (!existing?.heldOn) return;
        await tx.saveTalk({ ...existing, heldOn: null, heldBy: null, updatedAt: at });
        await tx.audit({
          actor: persona.principal.id,
          action: 'talks.held_undone',
          subject: 'talk:' + existing.id,
          at,
          details: { roundId: round.id, employeeId },
        });
      });
    },

    /**
     * A current manager of the employee registers when the talk is to take place (D132 item 4): a time the two agreed on
     * that no invitation from Clew carries, so nothing is sent and nothing is written to a calendar. It replaces a time
     * registered by hand before, whoever of the person's managers registered it, and a booking that no longer counts
     * because its manager has left the person. Refused for a talk marked held, and while an invitation carries the
     * booking: that one ends with its invitation.
     */
    async book(
      persona: AuthenticatedContext,
      employeeId: string,
      body: TalkBookingBody,
    ): Promise<{ id: string; start: string; end: string }> {
      await employeeOf(persona, employeeId);
      const span = normaliseSpan(body.start, body.end);
      if (!span) throw new TalkError(BAD_SPAN);
      const at = now().toISOString();
      const { before, invited } = await bookingBefore(persona, employeeId);
      const refused = invited ? INVITED(await deps.siteName()) : null;
      return deps.store.transaction(async tx => {
        const round = await openRoundOf(tx, persona.organisationId);
        const existing = await tx.talk(round.id, employeeId);
        if (existing?.heldOn) throw new TalkError(HELD_ALREADY);
        if (!sameBooking(existing?.booking, before)) throw new TalkError(CHANGED);
        if (refused) throw new TalkError(refused);
        const current = existing?.booking;
        // The same time by the same manager again changes nothing.
        const same =
          !!current &&
          current.invitationId === null &&
          current.bookedBy === persona.id &&
          current.start === span.start &&
          current.end === span.end;
        if (existing && same) return { id: existing.id, ...span };
        const booking: TalkBooking = {
          ...span,
          bookedBy: persona.id,
          bookedAt: at,
          invitationId: null,
          calendar: null,
        };
        const talk = talkWith(existing, round.id, employeeId, at, { booking });
        await tx.saveTalk(talk);
        await tx.audit({
          actor: persona.principal.id,
          action: 'talks.booked',
          subject: 'talk:' + talk.id,
          at,
          details: { roundId: round.id, employeeId, ...span, by: 'manager', replaced: !!current },
        });
        return { id: talk.id, ...span };
      });
    },

    /**
     * A current manager of the employee removes a time registered by hand (D132 item 4). A talk without a booking is
     * left as it is, with no audit row; a booking an invitation carries is refused, as in `book`.
     */
    async unbook(persona: AuthenticatedContext, employeeId: string): Promise<void> {
      await employeeOf(persona, employeeId);
      const at = now().toISOString();
      const { before, invited } = await bookingBefore(persona, employeeId);
      const refused = invited ? INVITED(await deps.siteName()) : null;
      await deps.store.transaction(async tx => {
        const round = await openRoundOf(tx, persona.organisationId);
        const existing = await tx.talk(round.id, employeeId);
        if (!existing?.booking) return;
        if (!sameBooking(existing.booking, before)) throw new TalkError(CHANGED);
        if (refused) throw new TalkError(refused);
        await tx.saveTalk({ ...existing, booking: null, updatedAt: at });
        await tx.audit({
          actor: persona.principal.id,
          action: 'talks.booking_removed',
          subject: 'talk:' + existing.id,
          at,
          details: { roundId: round.id, employeeId, by: 'manager' },
        });
      });
    },

    /**
     * What the scan asks cards for (D133, D134): for each person whose talk the persona booked and which is not held,
     * what the calendar holds when it differs from the booking, and what the booking's time asks now, a reminder to
     * prepare in the round's working days before it or, from the day after it, whether it was held. Only the manager
     * whose booking it is gets a card; a co-manager reads the talk. Nothing for someone who manages nobody or without an
     * open round. A complete reading of the persona's people, so a read that fails throws.
     */
    async scanOf(persona: AuthenticatedContext): Promise<{ observedAt: string; notices: TalkNotice[] }> {
      const observedAt = now().toISOString();
      const { manages, people } = await managed(persona);
      if (!manages) return { observedAt, notices: [] };
      const read = await standing(persona, people);
      if (!read) return { observedAt, notices: [] };
      const notices: TalkNotice[] = [];
      for (const p of read.people.values()) {
        const booking = read.stateOf(p.id).state === 'booked' ? read.bookingOf(p.id) : undefined;
        if (!booking || booking.bookedBy !== persona.id) continue;
        const about = {
          personId: p.id,
          userName: p.userName,
          booking: { start: booking.start, end: booking.end },
        };
        if (booking.calendar) {
          const says = booking.calendar === 'gone' ? 'gone' : `${booking.calendar.start}/${booking.calendar.end}`;
          notices.push({
            ...about,
            kind: 'calendar',
            calendar: booking.calendar,
            card: noticeCard('calendar', p.id, read.round.id, says),
          });
        }
        const asks = bookingAsks(booking, read.round.prepareDays, observedAt);
        // The card says the time it is about: a talk moved to another time is a card that comes back.
        if (asks)
          notices.push({
            ...about,
            kind: asks,
            card: noticeCard(asks, p.id, read.round.id, `${booking.start}/${booking.end}`),
          });
      }
      return { observedAt, notices: notices.sort((a, b) => a.card.topic.localeCompare(b.card.topic)) };
    },

    /**
     * The manager adds an action point in an employee's talk (D96 items 4 and 5), owned by the employee or by the
     * manager. The owner's card is opened first in the same transaction, since the action point refers to it. Returns
     * the action point's id.
     */
    async addCommitment(persona: AuthenticatedContext, employeeId: string, body: CommitmentAddBody): Promise<string> {
      const employee = await employeeOf(persona, employeeId);
      const text = normaliseText(body.text);
      if (!text) throw new TalkError('Skriv åtgärdspunkten på en rad, högst 280 tecken.');
      if (!isCalendarDay(body.dueOn)) throw new TalkError(BAD_DAY);
      const ownerId = body.owner === 'employee' ? employeeId : persona.id;
      const at = now().toISOString(),
        id = deps.ids(),
        threadId = deps.ids();
      return deps.store.transaction(async tx => {
        const round = await openRoundOf(tx, persona.organisationId);
        // The card is about the employee (D97 item 6), by Clew's key, their id (D122): a rename or a reused user name
        // moves nothing.
        await tx.workItems.open({
          threadId,
          personId: ownerId,
          commitmentId: id,
          dueOn: body.dueOn,
          at,
          subject: { entity: 'person' as const, key: employeeId },
        });
        await tx.insertCommitment({
          id,
          roundId: round.id,
          employeeId,
          ownerRole: body.owner,
          ownerId,
          text,
          dueOn: body.dueOn,
          doneAt: null,
          doneBy: null,
          createdBy: persona.id,
          createdAt: at,
          threadId,
        });
        await tx.audit({
          actor: persona.principal.id,
          action: 'talks.commitment_added',
          subject: 'commitment:' + id,
          at,
          details: { roundId: round.id, ownerRole: body.owner, dueOn: body.dueOn },
        });
        return id;
      });
    },

    /**
     * The owner marks an action point done, or a current manager of the employee a manager's point whose owner no longer
     * manages the employee (Q12); its card closes with it.
     */
    completeCommitment: (persona: AuthenticatedContext, id: string) => setDone(persona, id, true),
    /** The same people open it again; its card opens again with its `due` timer. */
    reopenCommitment: (persona: AuthenticatedContext, id: string) => setDone(persona, id, false),
    /**
     * Which of these action points the persona may take over (Q12): a manager's point about someone they manage now,
     * whose owner no longer manages that person or was erased. What the talks seam asks when a manager reads a person's
     * points, so that the page offers Klar on those rows too, as `completeCommitment` allows. Their own are not asked.
     */
    async takeovers(persona: AuthenticatedContext, ids: readonly string[]): Promise<Set<string>> {
      const taken = new Set<string>();
      if (!ids.length) return taken;
      const { people } = await managed(persona);
      if (!people.size) return taken;
      const records = await deps.store.transaction(async tx => {
        const found: CommitmentRecord[] = [];
        for (const id of new Set(ids)) {
          const c = await tx.commitment(id);
          if (c) found.push(c);
        }
        return found;
      });
      for (const c of records) if ((await mayChange(persona, people, c)) === 'manager') taken.add(c.id);
      return taken;
    },

    /**
     * The `due` timer of an action point's card fired at `generation` (D96 item 5). While the action point is open the
     * card comes back, and when it did, the audit row says so. A done or unknown action point, or a timer the card no
     * longer has, changes nothing. Returns whether the card came back.
     */
    async commitmentDue(threadId: string, generation: number): Promise<boolean> {
      const at = now().toISOString();
      return deps.store.transaction(async tx => {
        const c = await tx.commitmentByThread(threadId);
        if (!c || c.doneAt !== null) return false;
        const fired = await tx.workItems.fire(threadId, generation, at);
        if (fired)
          await tx.audit({
            actor: TIMER_ACTOR,
            action: 'talks.commitment_due',
            subject: 'commitment:' + c.id,
            at,
            details: { roundId: c.roundId, dueOn: c.dueOn, generation },
          });
        return fired;
      });
    },

    /**
     * Erase one person from the domain (D96 item 10): their talks and every action point about them, the cards of
     * those and of the ones they owned, and their name on other people's records. `actor` is the operator's. An id the
     * people table does not hold (a user name, a typo) and a person who is still active erase nothing and write no
     * audit row: only a person the source has deactivated is erased (D123 item 3).
     */
    async erasePerson(actor: string, personId: string): Promise<TalkErasure> {
      const at = now().toISOString();
      return deps.store.transaction(async (tx): Promise<TalkErasure> => {
        const [person] = await tx.persons([personId]);
        if (!person) return { refused: 'unknown' };
        if (person.enabled) return { refused: 'active' };
        const erased = await tx.erasePerson(personId);
        if (erased.threadIds.length) await tx.workItems.remove(erased.threadIds);
        const counts = {
          talks: erased.talks,
          commitments: erased.commitments,
          cleared: erased.cleared,
          cards: erased.threadIds.length,
        };
        await tx.audit({ actor, action: 'talks.person_erased', subject: 'person:' + personId, at, details: counts });
        return counts;
      });
    },

    /** The whole domain of one organisation as one versioned document (D96 item 10), text included. */
    async exportDomain(
      actor: string,
      organisationId: string,
    ): Promise<{ format: typeof TALKS_EXPORT_FORMAT; exportedAt: string; organisationId: string } & TalkExport> {
      const at = now().toISOString();
      return deps.store.transaction(async tx => {
        const data = await tx.exportOrganisation(organisationId);
        await tx.audit({
          actor,
          action: 'talks.exported',
          subject: 'organisation:' + organisationId,
          at,
          details: { rounds: data.rounds.length, talks: data.talks.length, commitments: data.commitments.length },
        });
        return { format: TALKS_EXPORT_FORMAT, exportedAt: at, organisationId, ...data };
      });
    },
  };
}
export type TalkUsecases = ReturnType<typeof talkUsecases>;

/** An invitation to a talk as the calendar module names it (D132 item 3): its own id for it, who sent it and to whom. */
export interface TalkInvitation {
  /** Who the row is written as: the execution that read the invitation back, or the check that read an answer. */
  actor: string;
  invitationId: string;
  managerId: string;
  employeeId: string;
  start: string;
  end: string;
  at: string;
}
/**
 * Why an invitation no longer carries a booking: the manager undid it, replaced it, the employee said no, its event was
 * cancelled, in Clew or in the calendar, or its time passed without the talk taking place.
 */
export type InvitationEnd = 'undone' | 'replaced' | 'declined' | 'cancelled' | 'missed';
/**
 * What an invitation Clew sent means to the talks module (D132 item 3, D133), told by the calendar module in the
 * transaction that changes the invitation (bound in composition, the way the people module tells of a leaver), so the
 * talk and the invitation that carries its booking commit or roll back as one and never say different things.
 *
 * `established`: the invitation was sent and read back from the calendar, so the employee's talk in the open round of
 * the manager's organisation is booked at that time by that manager. It replaces a booking already on the record (a
 * time registered by hand, or an invitation that reached the person first: the invitation just read back is the one in
 * their calendar). Nothing is written without an open round (another system holds the talks, or none is open), for a
 * talk already marked held, or for people the directory does not hold in one organisation.
 *
 * `observed`: what the calendar holds for the invitation's event now, read by the event's own id. When it is not what
 * the booking says, the difference is recorded beside the booking and nothing else changes: the manager settles it.
 * When it is, a difference recorded before is cleared. A held talk has nothing to settle.
 *
 * `moved`: the invitation itself is at another time now, because the manager moved the meeting through Clew or took
 * the time the calendar holds, so the booking is at that time and no difference stands.
 *
 * `ended`: the invitation was undone, replaced, declined or cancelled, so the talk whose booking it carried lacks a
 * time again; with `keep`, the time stays as one that manager set by hand, with no invitation. An invitation that
 * carries no booking (any more) changes nothing.
 */
export function talkInvitations(
  tx: Pick<TalkTx, 'currentRound' | 'talk' | 'talkByInvitation' | 'saveTalk' | 'persons' | 'audit'>,
  deps: { ids: () => string },
) {
  return {
    async established(i: TalkInvitation): Promise<void> {
      const span = normaliseSpan(i.start, i.end);
      const persons = await tx.persons([i.managerId, i.employeeId]);
      const manager = persons.find(p => p.id === i.managerId),
        employee = persons.find(p => p.id === i.employeeId);
      if (!span || !manager || !employee || manager.organisationId !== employee.organisationId) return;
      const round = await tx.currentRound(manager.organisationId);
      if (!round) return;
      const existing = await tx.talk(round.id, i.employeeId);
      if (existing?.heldOn) return;
      const current = existing?.booking ?? null;
      if (current?.invitationId === i.invitationId && current.start === span.start && current.end === span.end) return;
      const talk: TalkRecord = {
        id: existing?.id ?? deps.ids(),
        roundId: round.id,
        employeeId: i.employeeId,
        heldOn: null,
        heldBy: null,
        booking: { ...span, bookedBy: i.managerId, bookedAt: i.at, invitationId: i.invitationId, calendar: null },
        createdAt: existing?.createdAt ?? i.at,
        updatedAt: i.at,
      };
      await tx.saveTalk(talk);
      await tx.audit({
        actor: i.actor,
        action: 'talks.booked',
        subject: 'talk:' + talk.id,
        at: i.at,
        details: {
          roundId: round.id,
          employeeId: i.employeeId,
          ...span,
          by: 'invitation',
          invitationId: i.invitationId,
          bookedBy: i.managerId,
          replaced: current !== null,
        },
      });
    },
    async observed(o: {
      actor: string;
      invitationId: string;
      event: { start: string; end: string } | null;
      at: string;
    }): Promise<void> {
      const talk = await tx.talkByInvitation(o.invitationId);
      if (!talk?.booking) return;
      const seen = talk.heldOn ? null : differenceOf(talk.booking, o.event);
      if (seen === undefined || sameDifference(talk.booking.calendar, seen)) return;
      await tx.saveTalk({ ...talk, booking: { ...talk.booking, calendar: seen }, updatedAt: o.at });
      await tx.audit({
        actor: o.actor,
        action: seen ? 'talks.calendar_differs' : 'talks.calendar_agrees',
        subject: 'talk:' + talk.id,
        at: o.at,
        details: {
          roundId: talk.roundId,
          employeeId: talk.employeeId,
          invitationId: o.invitationId,
          ...(seen ? { calendar: differenceDetails(seen) } : {}),
        },
      });
    },
    async moved(m: { actor: string; invitationId: string; start: string; end: string; at: string }): Promise<void> {
      const span = normaliseSpan(m.start, m.end);
      const talk = await tx.talkByInvitation(m.invitationId);
      if (!span || !talk?.booking) return;
      const { booking } = talk;
      if (booking.start === span.start && booking.end === span.end && booking.calendar === null) return;
      const from = { start: booking.start, end: booking.end };
      await tx.saveTalk({ ...talk, booking: { ...booking, ...span, calendar: null }, updatedAt: m.at });
      await tx.audit({
        actor: m.actor,
        action: 'talks.booking_moved',
        subject: 'talk:' + talk.id,
        at: m.at,
        details: {
          roundId: talk.roundId,
          employeeId: talk.employeeId,
          invitationId: m.invitationId,
          from,
          ...span,
        },
      });
    },
    async ended(e: {
      actor: string;
      invitationId: string;
      why: InvitationEnd;
      at: string;
      /** The time stays, as one this manager set by hand: the meeting is gone from the calendar and the talk is not. */
      keep?: { managerId: string };
    }): Promise<void> {
      const talk = await tx.talkByInvitation(e.invitationId);
      if (!talk?.booking) return;
      const { booking } = talk;
      const kept: TalkBooking | null = e.keep
        ? {
            start: booking.start,
            end: booking.end,
            bookedBy: e.keep.managerId,
            bookedAt: e.at,
            invitationId: null,
            calendar: null,
          }
        : null;
      await tx.saveTalk({ ...talk, booking: kept, updatedAt: e.at });
      await tx.audit({
        actor: e.actor,
        action: kept ? 'talks.booking_kept' : 'talks.booking_removed',
        subject: 'talk:' + talk.id,
        at: e.at,
        details: {
          roundId: talk.roundId,
          employeeId: talk.employeeId,
          by: 'invitation',
          invitationId: e.invitationId,
          why: e.why,
        },
      });
    },
  };
}
export type TalkInvitations = ReturnType<typeof talkInvitations>;
