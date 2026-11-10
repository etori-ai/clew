import type { AuthenticatedContext, CommitmentOwner, StaffOverview, Subject } from '@clew/contracts';

/**
 * The ports of the talks module (D96, D25): Clew's first owned domain, the round of development talks and the action
 * points (`commitment`) that come out of them. Everything the use cases read and write in Clew's own tables happens
 * inside one `TalkStore` transaction, together with the audit row and the owner's card (`WorkItemTx`), so a change and
 * its card commit or roll back as one. `adapters/postgres.ts` runs in the server, `adapters/memory.ts` in the unit tests,
 * both held to one store contract. Who manages whom and who is booked come in as functions filled in composition, so
 * the module imports neither the people module nor the calendar.
 *
 * Every instant is an ISO string and every date a `YYYY-MM-DD` calendar day in Swedish time, both handed in by the use
 * case from `clock`; every id comes from `ids`. Text is plain here: sealing an action point's text at rest is the
 * Postgres adapter's job (`Sealer`). No audit entry carries an action point's text or a person's name (D96 item 6).
 */

/** The only kind of round there is so far (D96 item 1). */
export type RoundKind = 'development';
/** A round of talks for one organisation (D96 item 1): open while `closedAt` is null, at most one open per organisation and kind. */
export interface RoundRecord {
  id: string;
  organisationId: string;
  kind: RoundKind;
  /** Swedish, as a person reads it. */
  label: string;
  opensOn: string;
  dueOn: string;
  /** The actor that opened it, such as `operator:cli`; not a person id. */
  createdBy: string;
  createdAt: string;
  closedAt: string | null;
}
/** One employee's talk in one round; it exists once the manager has marked it held, and stays when that is undone. */
export interface TalkRecord {
  id: string;
  roundId: string;
  employeeId: string;
  /** The day it was held; null when it is not (or no longer) marked held. */
  heldOn: string | null;
  /** Who marked it held; null when not held, or when that person was erased. */
  heldBy: string | null;
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
/** A person as the domain needs them: to key a row on the user name (D96 item 8) and to name the employee to the reader. */
export interface PersonRef {
  id: string;
  organisationId: string;
  name: string;
  /** Null for a person provisioned without one. */
  userName: string | null;
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
  /** Rows of other people's talks and action points from which the person was removed (held by, owner, added by, done by). */
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
   * with, by user name (D97 item 6): the card is about them, so it shows under "Behöver dig" on that person for its
   * owner, while nothing drawn on the card or read by the assistant names them (item 6).
   */
  open(input: {
    threadId: string;
    personId: string;
    commitmentId: string;
    dueOn: string;
    at: string;
    subject?: Subject;
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
  /** The organisation's open round of this kind, locked, or undefined when none is open. */
  currentRound(organisationId: string, kind?: RoundKind): Promise<RoundRecord | undefined>;
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
   * `heldOn`, `heldBy` and `updatedAt`. Marking held and undoing it are both this, with null to undo.
   */
  saveTalk(talk: TalkRecord): Promise<void>;
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
   * `ownerId`, `createdBy`, `doneBy` where they are the person). Returns the counts and the cards to remove; the use case
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
 * Who among the people the manager plans for has a talk in the calendar inside the round's period (D96 item 2), by
 * person id, with when; booked is never stored. `undefined` means the calendar did not answer, which the page says.
 */
export type Bookings = (
  persona: AuthenticatedContext,
  round: Pick<RoundRecord, 'opensOn' | 'dueOn'>,
) => Promise<ReadonlyMap<string, { at: string }> | undefined>;
/** Seals an action point's text at rest (D96 item 6), as approved execution input is. Used by the Postgres adapter only. */
export interface Sealer {
  seal(value: string, purpose: string): string;
  open(value: string, purpose: string): string;
}
export interface TalkDeps {
  store: TalkStore;
  staff: Staff;
  bookings: Bookings;
  clock: () => Date;
  ids: () => string;
}
