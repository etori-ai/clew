import type { AuthenticatedContext, CommitmentOwner, StaffOverview, Subject } from '@clew/contracts';

/**
 * The ports of the talks module (D96, D25): Clew's first owned domain, the round of development talks and the action
 * points (`commitment`) that come out of them. Everything the use cases read and write in Clew's own tables happens
 * inside one `TalkStore` transaction, together with the audit row and the owner's card (`WorkItemTx`), so a change and
 * its card commit or roll back as one. `adapters/postgres.ts` runs in the server, `adapters/memory.ts` in the unit tests,
 * both held to one store contract. Who manages whom comes in as a function filled in composition, so the module does not
 * import the people module. When a talk is booked is the module's own record (D132), never read from a calendar: the
 * calendar module tells it of an invitation it sent through `talkInvitations` in `usecases.ts`.
 *
 * Every instant is an ISO string and every date a `YYYY-MM-DD` calendar day in Swedish time, both handed in by the use
 * case from `clock`; every id comes from `ids`. Text is plain here: sealing an action point's text at rest is the
 * Postgres adapter's job (`Sealer`). No audit entry carries an action point's text or a person's name (D96 item 6).
 */

/** The only kind of round there is so far (D96 item 1). */
export type RoundKind = 'development';
/** How a write holds the open round it reads (`TalkTx.currentRound`): against closing it, or against every other write. */
export type RoundHold = 'write' | 'close';
/** A round of talks for one organisation (D96 item 1): open while `closedAt` is null, at most one open per organisation and kind. */
export interface RoundRecord {
  id: string;
  organisationId: string;
  kind: RoundKind;
  /** Swedish, as a person reads it. */
  label: string;
  opensOn: string;
  dueOn: string;
  /**
   * How many working days before a booked talk the manager whose booking it is is reminded to prepare (D134), the same
   * for everyone in the organisation; 0 is no reminder.
   */
  prepareDays: number;
  /** The actor that opened it, such as `operator:cli`; not a person id. */
  createdBy: string;
  createdAt: string;
  closedAt: string | null;
}
/**
 * When a talk is to take place (D132): Clew's own record, written when an invitation Clew sent is read back from the
 * calendar, or when a manager registers a time they agreed on by hand. It is whose booking it is that decides whether
 * it counts: only while `bookedBy` manages the employee (`standingBooking` in `domain.ts`).
 */
/**
 * What the calendar holds for a booking's invitation when it is not what the booking says (D133): the event at another
 * time, or no event (`gone`). It is read by the event's own id, and it changes nothing by itself: the booking stands
 * until the manager whose booking it is settles it.
 */
export type CalendarDifference = { start: string; end: string } | 'gone';
export interface TalkBooking {
  start: string;
  end: string;
  /** The manager whose booking it is; null once that person was erased, and the booking then counts for nobody. */
  bookedBy: string | null;
  /** When it was recorded. */
  bookedAt: string;
  /**
   * The invitation that carries it, by the calendar module's id for it: the booking ends when that invitation is undone,
   * replaced or declined, and is not changed by hand. Null for a time a manager registered by hand.
   */
  invitationId: string | null;
  /** Null while the calendar agrees with the booking, has not been read, or no invitation carries it. */
  calendar: CalendarDifference | null;
}
/**
 * One employee's talk in one round; it exists once it has been booked or a manager has marked it held, and stays when
 * either is undone.
 */
export interface TalkRecord {
  id: string;
  roundId: string;
  employeeId: string;
  /** The day it was held; null when it is not (or no longer) marked held. */
  heldOn: string | null;
  /** Who marked it held; null when not held, or when that person was erased. */
  heldBy: string | null;
  /** When it is booked; null when it is not (or no longer). */
  booking: TalkBooking | null;
  createdAt: string;
  updatedAt: string;
}
/** An action point (D96 item 4): tied to the employee the talk is with and the round it was added in. */
export interface CommitmentRecord {
  id: string;
  roundId: string;
  employeeId: string;
  ownerRole: CommitmentOwner;
  /** The owner: the employee, or the manager who added it for themselves. Null once the owner was erased. */
  ownerId: string | null;
  /** Plain text; the Postgres adapter seals it at rest. Never in an audit row, a log line, a trace or a card. */
  text: string;
  dueOn: string;
  doneAt: string | null;
  doneBy: string | null;
  /** The manager who added it; null once erased. */
  createdBy: string | null;
  createdAt: string;
  /** The owner's card in their stream; null once the card is removed by erasure. */
  threadId: string | null;
}
export type CommitmentPatch = Partial<Pick<CommitmentRecord, 'doneAt' | 'doneBy'>>;
/**
 * A person as the domain needs them: to key a row on the user name (D96 item 8), to name the employee to the reader, and
 * to erase only a person the source has deactivated (D123 item 3).
 */
export interface PersonRef {
  id: string;
  organisationId: string;
  name: string;
  /** Null for a person provisioned without one. */
  userName: string | null;
  /** False once the source has deactivated the person (D68 item 1). */
  enabled: boolean;
}
/** One audit row, written in the same transaction as the change. Metadata only: ids, dates, counts and roles. */
export interface TalkAudit {
  actor: string;
  action: string;
  subject: string;
  at: string;
  details?: Record<string, unknown>;
}
/** What `TalkTx.erasePerson` did (D96 item 10). */
export interface Erased {
  /** Talks removed because they were the person's own. */
  talks: number;
  /** Action points removed because they were about the person. */
  commitments: number;
  /** Rows of other people's talks and action points from which the person was removed (held by, booked by, owner, added by, done by). */
  cleared: number;
  /** The cards to remove with `WorkItemTx.remove`: of every action point about the person, and of every one they owned. */
  threadIds: string[];
}
/** The whole domain for one organisation (D96 item 10), plain text included; the use case turns it into `clew.talks/1`. */
export interface TalkExport {
  rounds: RoundRecord[];
  talks: TalkRecord[];
  commitments: CommitmentRecord[];
}

/**
 * The owner's card for an action point (D96 item 5): a pushed thread in the owner's stream, with the due date and no
 * action-point text and no other person's name in its title, summary or message, since those are what the assistant
 * reads (item 6). Its timer, of kind `due`, brings the card back the morning after the due date while the action point
 * is open. Implemented in composition over the thread store's transaction (`withThreadTx`), on the same database
 * transaction as the `TalkTx` it belongs to, the way `composition/followup-store.ts` implements `FollowupTx`.
 */
export interface WorkItemTx {
  /**
   * Insert the owner's open card `threadId`, admit its delivery, write its message and its `thread.pushed` audit row, and
   * schedule its `due` timer for 06:00 Europe/Stockholm on the day after `dueOn` (with this commit, D86). The timer
   * carries the owner's current unit and authorisation version, read in the same transaction. Call it before the action
   * point that names `threadId` is inserted, since that row refers to the card. `subject` is the employee the talk is
   * with, by Clew's key, their id (D97 item 6, D122): the card is about them, so it shows under "Behöver dig" on that
   * person for its owner, while nothing drawn on the card or read by the assistant names them (item 6).
   */
  open(input: {
    threadId: string;
    personId: string;
    commitmentId: string;
    dueOn: string;
    at: string;
    subject: Subject;
  }): Promise<void>;
  /** Mark the card handled and cancel its `due` timer. A card that no longer exists is no error. */
  close(threadId: string, at: string): Promise<void>;
  /**
   * Open the card again and schedule its `due` timer for the morning after `dueOn` as `open` does; a date already past
   * gives a timer due at once. A card that no longer exists is no error.
   */
  reopen(threadId: string, dueOn: string, at: string): Promise<void>;
  /**
   * The `due` timer fired at `generation`: when that timer is still active at that generation and due by `at`, mark it
   * fired, bring the card back to the top of the owner's stream (open, through a reminder delivery) and return true.
   * Otherwise change nothing and return false, so a replaced or cancelled timer's late workflow is harmless.
   */
  fire(threadId: string, generation: number, at: string): Promise<boolean>;
  /** Erasure: the cards gone with their messages, deliveries and timers (their workflows cancelled after commit). */
  remove(threadIds: readonly string[]): Promise<void>;
}

/** Everything a talks use case reads and writes in one transaction. Reads that a write follows take a row lock. */
export interface TalkTx {
  // Rounds.
  /**
   * The organisation's open round of this kind, or undefined when none is open. A read takes no lock, so every talks
   * page and every manager's scan reads the round beside the others (BD-L4). `hold: 'write'` holds it against being
   * closed until the transaction ends, as a write in the round takes it (a talk, a booking, an action point), while
   * other writes in the round go on beside this one; `hold: 'close'` holds it against every other write too, as closing
   * it takes it.
   */
  currentRound(organisationId: string, kind?: RoundKind, hold?: RoundHold): Promise<RoundRecord | undefined>;
  /** Insert a round. At most one per organisation and kind may be open: close the last one first. */
  insertRound(round: RoundRecord): Promise<void>;
  closeRound(id: string, at: string): Promise<void>;
  // Talks.
  /** The talks of these employees in this round; an employee without a row has none. */
  talks(roundId: string, employeeIds: readonly string[]): Promise<TalkRecord[]>;
  /** One employee's talk in this round, locked. */
  talk(roundId: string, employeeId: string): Promise<TalkRecord | undefined>;
  /**
   * Insert or update by (round, employee): a new row takes `id` and `createdAt`, an existing row keeps its own and takes
   * `heldOn`, `heldBy`, `booking` and `updatedAt`. Marking held, booking and undoing either are all this, with null to
   * undo.
   */
  saveTalk(talk: TalkRecord): Promise<void>;
  /** The talk whose booking this invitation carries, locked; undefined when none does (any more). */
  talkByInvitation(invitationId: string): Promise<TalkRecord | undefined>;
  /** The talks of this round that have a booking, locked: what a new round takes over when it opens. */
  bookedTalks(roundId: string): Promise<TalkRecord[]>;
  // Action points.
  /**
   * The action points about these employees that the round shows: every one added in `roundId`, and every open one from
   * any round (carried over, never copied). With `roundId` null, only the open ones.
   */
  commitmentsAbout(employeeIds: readonly string[], roundId: string | null): Promise<CommitmentRecord[]>;
  /** The action points this person owns, chosen the same way as `commitmentsAbout`. */
  commitmentsOwnedBy(ownerId: string, roundId: string | null): Promise<CommitmentRecord[]>;
  /** How many open action points each of these employees has, from any round; an employee with none is absent. */
  openCounts(employeeIds: readonly string[]): Promise<ReadonlyMap<string, number>>;
  /** One action point, locked. */
  commitment(id: string): Promise<CommitmentRecord | undefined>;
  /** The action point whose card this is, locked: what the `due` timer knows. */
  commitmentByThread(threadId: string): Promise<CommitmentRecord | undefined>;
  insertCommitment(commitment: CommitmentRecord): Promise<void>;
  updateCommitment(id: string, patch: CommitmentPatch): Promise<void>;
  // People.
  /** These people as the domain names them; an unknown id is absent. */
  persons(ids: readonly string[]): Promise<PersonRef[]>;
  // Erasure and export (D96 item 10).
  /**
   * Remove the person's talks and every action point about them, and remove them from the rest (null `heldBy`,
   * `bookedBy`, `ownerId`, `createdBy`, `doneBy` where they are the person). Returns the counts and the cards to remove; the use case
   * passes those to `workItems.remove` in the same transaction.
   */
  erasePerson(personId: string): Promise<Erased>;
  /** Every round of the organisation, open and closed, with their talks and action points, text opened. */
  exportOrganisation(organisationId: string): Promise<TalkExport>;
  audit(entry: TalkAudit): Promise<void>;
  workItems: WorkItemTx;
}
export interface TalkStore {
  transaction<T>(fn: (tx: TalkTx) => Promise<T>): Promise<T>;
}

/**
 * The units the person manages and the people on them (D94), from the assignments when asked (D96 item 1). Someone who
 * manages no unit gets `{ units: [] }`: composition maps the people module's refusal to that, so the module decides
 * what a non-manager is refused with and never imports another module's error.
 */
export type Staff = (persona: AuthenticatedContext) => Promise<StaffOverview>;
/**
 * The people this person manages now (D94, D99), by id: everyone on the units they manage, as `Staff` lists them for
 * them, without themselves and without deactivated people. Empty for an unknown or deactivated person and for someone
 * who manages no unit. Asked when a manager ticks off an action point a manager owns (only one whose owner no longer
 * manages the employee may be taken over, Q12), and for whose booking a talk's is: it counts only while that manager
 * still manages the employee (D132), which a reorganisation changes without a write here.
 */
export type Reports = (managerId: string) => Promise<ReadonlySet<string>>;
/** Seals an action point's text at rest (D96 item 6), as approved execution input is. Used by the Postgres adapter only. */
export interface Sealer {
  seal(value: string, purpose: string): string;
  open(value: string, purpose: string): string;
}
export interface TalkDeps {
  store: TalkStore;
  staff: Staff;
  reports: Reports;
  clock: () => Date;
  ids: () => string;
}
