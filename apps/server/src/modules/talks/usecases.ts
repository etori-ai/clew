import type {
  AuthenticatedContext,
  CommitmentAddBody,
  CommitmentRow,
  CommitmentsInput,
  CommitmentsOutput,
  StaffPerson,
  TalkHeldBody,
  TalkState,
  TalksOutput,
} from '@clew/contracts';
import { ForbiddenError, InputError } from '../../context';
import {
  commitmentRow,
  isCalendarDay,
  normaliseLabel,
  normaliseText,
  orderCommitmentRows,
  orderTalkRows,
  overdueCounts,
  personKey,
  sameUserName,
  swedishDay,
  talkRow,
  talkState,
} from './domain';
import type { RoundRecord, TalkDeps, TalkExport, TalkRecord, TalkTx } from './model';

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
/** The actor of a row written because a `due` timer fired; the convention of the other timer-driven rows. */
const TIMER_ACTOR = 'system:scheduler';
/** The version of the export document (D96 item 10); a breaking change is a new version. */
export const TALKS_EXPORT_FORMAT = 'clew.talks/1';
/** The open round as a list about people or units names it (D97): its label and the day it is due. */
export interface RoundHeading {
  label: string;
  dueOn: string;
  /** The calendar did not answer, so a talk counted missing may be booked. */
  bookedUnknown: boolean;
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
 * The talks module's use cases (D96): the round of development talks and its action points. A manager's reach is
 * computed from the assignments when asked (`deps.staff`), never stored, so a former manager reads and writes nothing
 * the day the assignment changes. Every change is one `deps.store` transaction with its audit row and, for an action
 * point, its owner's card. Audit rows carry ids, dates, counts and roles: never an action point's text or a name.
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
   * Where these people stand in the open round (D96 item 2): the round read, then who is booked from the calendar.
   * Undefined when no round is open. `bookings` is undefined when the calendar did not answer.
   */
  async function standing(persona: AuthenticatedContext, people: Map<string, StaffPerson>, overdueOn?: string) {
    const read = await roundOf(persona, people, overdueOn);
    if (!read.round) return undefined;
    const round = read.round;
    const bookings = await deps.bookings(persona, round);
    const stateOf = (id: string) => talkState(read.talks.get(id), bookings?.get(id));
    return { ...read, round, bookings, stateOf };
  }
  const headingOf = (s: NonNullable<Awaited<ReturnType<typeof standing>>>): RoundHeading => ({
    label: s.round.label,
    dueOn: s.round.dueOn,
    bookedUnknown: !s.bookings,
  });
  /** Mark a commitment done or open again: for its owner, or for the current manager of the employee's unit. */
  async function setDone(persona: AuthenticatedContext, id: string, done: boolean) {
    const { people } = await managed(persona);
    const at = now().toISOString();
    await deps.store.transaction(async tx => {
      const c = await tx.commitment(id);
      const asOwner = !!c && c.ownerId === persona.id,
        asManager = !!c && people.has(c.employeeId);
      if (!c || (!asOwner && !asManager)) throw new ForbiddenError(NOT_ALLOWED);
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
     * transaction. `actor` is the operator's, such as `operator:cli`. Returns the new round's id.
     */
    async openRound(
      actor: string,
      input: { organisationId: string; label: string; opensOn: string; dueOn: string },
    ): Promise<string> {
      const label = normaliseLabel(input.label);
      if (!label) throw new TalkError('The label must be 1 to 120 characters.');
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
          createdBy: actor,
          createdAt: at,
          closedAt: null,
        });
        await tx.audit({
          actor,
          action: 'talks.round_opened',
          subject: 'round:' + id,
          at,
          details: {
            organisationId: input.organisationId,
            opensOn: input.opensOn,
            dueOn: input.dueOn,
            closed: current?.id ?? null,
          },
        });
        return id;
      });
    },

    /**
     * `talks.talks` (D96 items 2 and 8): the open round and one row per person the manager plans a talk with. Booked
     * comes from the calendar after the transaction; when the calendar does not answer, `bookedUnknown` says so.
     */
    async round(persona: AuthenticatedContext): Promise<TalksOutput> {
      const { manages, people } = await managed(persona);
      if (!manages) throw new ForbiddenError(NOT_A_MANAGER);
      const read = await standing(persona, people);
      if (!read) return { round: null, rows: [] };
      const { round, bookings } = read;
      const rows = [...read.people.values()].map(p =>
        talkRow(p, read.talks.get(p.id), bookings?.get(p.id), read.open.get(p.id) ?? 0),
      );
      return {
        round: { label: round.label, opensOn: round.opensOn, dueOn: round.dueOn },
        rows: orderTalkRows(rows),
        ...(bookings ? {} : { bookedUnknown: true }),
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
     * round. Null for someone who manages nobody, with no open round, or with nobody due a talk. Reads no calendar.
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
     * one): that employee's action points, for the current manager of their unit. Without: the reader's, since both
     * see them: every one the reader owns and every one about the reader, each once, the reader's own listed first.
     * Either way every one added in the open round and every open one from earlier rounds.
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

    /** The manager marks the talk with an employee held (D96 item 2), on `heldOn` or today in Swedish time. */
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
        const id = existing?.id ?? deps.ids();
        if (existing?.heldOn === heldOn) return { id, heldOn };
        await tx.saveTalk({
          id,
          roundId: round.id,
          employeeId,
          heldOn,
          heldBy: persona.id,
          createdAt: existing?.createdAt ?? iso,
          updatedAt: iso,
        });
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

    /** The manager undoes marking a talk held. A talk that is not marked held is left as it is, with no audit row. */
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
     * The manager adds an action point in an employee's talk (D96 items 4 and 5), owned by the employee or by the
     * manager. The owner's card is opened first in the same transaction, since the action point refers to it. Returns
     * the action point's id.
     */
    async addCommitment(persona: AuthenticatedContext, employeeId: string, body: CommitmentAddBody): Promise<string> {
      await employeeOf(persona, employeeId);
      const text = normaliseText(body.text);
      if (!text) throw new TalkError('Skriv åtgärdspunkten på en rad, högst 280 tecken.');
      if (!isCalendarDay(body.dueOn)) throw new TalkError(BAD_DAY);
      const ownerId = body.owner === 'employee' ? employeeId : persona.id;
      const at = now().toISOString(),
        id = deps.ids(),
        threadId = deps.ids();
      return deps.store.transaction(async tx => {
        const round = await openRoundOf(tx, persona.organisationId);
        await tx.workItems.open({ threadId, personId: ownerId, commitmentId: id, dueOn: body.dueOn, at });
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

    /** The owner, or the employee's current manager, marks an action point done; its card closes with it. */
    completeCommitment: (persona: AuthenticatedContext, id: string) => setDone(persona, id, true),
    /** The same people open it again; its card opens again with its `due` timer. */
    reopenCommitment: (persona: AuthenticatedContext, id: string) => setDone(persona, id, false),

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
     * those and of the ones they owned, and their name on other people's records. `actor` is the operator's.
     */
    async erasePerson(
      actor: string,
      personId: string,
    ): Promise<{ talks: number; commitments: number; cleared: number; cards: number }> {
      const at = now().toISOString();
      return deps.store.transaction(async tx => {
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
