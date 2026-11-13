import type { AuthenticatedContext, DialogueAreaKind, DialogueTone, Subject } from '@clew/contracts';

/**
 * The ports of the follow-up dialogue (D118): a manager's dialogue about a unit, area by area. Everything the use cases
 * read and write in Clew's own tables happens inside one `DialogueStore` transaction, together with the audit row and the
 * owner's card (`DialogueWorkItems`), so a change and its card commit or roll back as one. `adapters/postgres.ts` runs in
 * the server, `adapters/memory.ts` in the unit tests, both held to one store contract. Which units the person follows up
 * comes in as a function filled in composition (`Followed`), so the module imports neither the people module nor the
 * entities module.
 *
 * Every instant is an ISO string and every date a `YYYY-MM-DD` calendar day in Swedish time, both handed in by the use
 * case from `clock`; every id comes from `ids`. Text is plain here: sealing it at rest is the Postgres adapter's job.
 * No audit entry carries an activity's text, a note, a comment or a person's name (D118 item 9).
 */

/** An area of an organisation's dialogue, as the operator configured it (D118 item 3). */
export interface AreaRecord {
  organisationId: string;
  key: string;
  title: string;
  kind: DialogueAreaKind;
  /** For a measured area, the read about a unit that answers its figure. */
  measure: string | null;
  info: string | null;
  /** Empty for an area assessed as a whole (and for a measured area). */
  dimensions: Array<{ key: string; title: string }>;
  ordinal: number;
}
/** A question of an area; with `unitId` it is shown on that unit only, in place of the area's general questions. */
export interface QuestionRecord {
  id: string;
  organisationId: string;
  areaKey: string;
  unitId: string | null;
  heading: string | null;
  text: string;
  basedOn: string | null;
  ordinal: number;
}
/** An assessment (D118 item 6): append-only; the newest per unit, area and dimension counts. */
export interface AssessmentRecord {
  id: string;
  organisationId: string;
  unitId: string;
  areaKey: string;
  /** '' for an area assessed as a whole. */
  dimension: string;
  tone: DialogueTone;
  /** Plain text; the Postgres adapter seals it at rest. */
  comment: string | null;
  /** Null once the author was erased. */
  authorId: string | null;
  at: string;
}
/** An activity (D118 items 4, 5, 7): a line of work in a unit's area with an owner whose card it is. */
export interface ActivityRecord {
  id: string;
  organisationId: string;
  unitId: string;
  areaKey: string;
  /** Null once the owner was erased. */
  ownerId: string | null;
  /** Plain text; the Postgres adapter seals it at rest. Never in an audit row, a log line, a trace or a card. */
  text: string;
  /** Optional (D118 item 5): only a dated activity has a timer. */
  dueOn: string | null;
  doneAt: string | null;
  doneBy: string | null;
  /** How it went, written when it was marked done; plain here, sealed at rest. */
  doneNote: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  /** The owner's card; null once the card is removed. */
  threadId: string | null;
}
export type ActivityPatch = Partial<
  Pick<ActivityRecord, 'text' | 'dueOn' | 'doneAt' | 'doneBy' | 'doneNote' | 'updatedAt'>
>;
/** One audit row, written in the same transaction as the change. Metadata only: ids, dates, keys, counts and tones. */
export interface DialogueAudit {
  actor: string;
  action: string;
  subject: string;
  at: string;
  details?: Record<string, unknown>;
}
/** What `DialogueTx.erasePerson` did. */
export interface Erased {
  /** Rows from which the person was removed (owner, author, added by, done by). */
  cleared: number;
  /** The cards of the activities they owned, to remove with `workItems.remove`. */
  threadIds: string[];
}
/** The whole dialogue of an organisation, text opened; the use case turns it into `clew.dialogue/1`. */
export interface DialogueExport {
  areas: AreaRecord[];
  questions: QuestionRecord[];
  assessments: AssessmentRecord[];
  activities: ActivityRecord[];
}

/**
 * The owner's card of an activity (D118 item 4): a pushed thread in the owner's stream with no activity text and no
 * name in its title, summary or messages, since those are what the assistant reads. Its subject is the unit, so it
 * shows under "Behöver dig" on the unit's page. A dated activity's card has a `dialogue-due` timer that brings it back
 * the morning after the due date while the activity is open; an undated one has none and says so (D49). Implemented in
 * composition over the thread store's transaction, on the same database transaction as the `DialogueTx`.
 */
export interface DialogueWorkItems {
  /** Insert the owner's open card and, for a dated activity, its timer. Call it before the activity is inserted. */
  open(input: {
    threadId: string;
    personId: string;
    activityId: string;
    dueOn: string | null;
    at: string;
    subject: Subject;
  }): Promise<void>;
  /** Mark the card handled and cancel its timer. A card that no longer exists is no error. */
  close(threadId: string, at: string): Promise<void>;
  /** Open the card again, with a timer when dated. A card that no longer exists is no error. */
  reopen(threadId: string, dueOn: string | null, at: string): Promise<void>;
  /** The due date changed on an open activity: the card's date and timer follow it. */
  retime(threadId: string, dueOn: string | null, at: string): Promise<void>;
  /**
   * The timer fired at `generation`: when it is still active at that generation and due by `at`, mark it fired, bring
   * the card back to the top of the owner's stream and return true; otherwise change nothing and return false.
   */
  fire(threadId: string, generation: number, at: string): Promise<boolean>;
  /** The cards gone with their messages, deliveries and timers. */
  remove(threadIds: readonly string[]): Promise<void>;
}

/** Everything a dialogue use case reads and writes in one transaction. Reads that a write follows take a row lock. */
export interface DialogueTx {
  // Configuration.
  areas(organisationId: string): Promise<AreaRecord[]>;
  questions(organisationId: string): Promise<QuestionRecord[]>;
  /** Replace the organisation's areas and questions whole (D118 item 3); records stay. */
  replaceConfig(organisationId: string, areas: AreaRecord[], questions: QuestionRecord[]): Promise<void>;
  // Assessments.
  /** Every assessment of these units, the newest first. */
  assessments(organisationId: string, unitIds: readonly string[]): Promise<AssessmentRecord[]>;
  insertAssessment(assessment: AssessmentRecord): Promise<void>;
  // Activities.
  /** Every activity of these units, oldest first. */
  activities(organisationId: string, unitIds: readonly string[]): Promise<ActivityRecord[]>;
  /** The areas of the organisation that have an open activity: a configuration may not drop them. */
  openAreaKeys(organisationId: string): Promise<string[]>;
  /** The open activities this person owns, oldest first. */
  activitiesOwnedBy(ownerId: string): Promise<ActivityRecord[]>;
  /** One activity, locked. */
  activity(id: string): Promise<ActivityRecord | undefined>;
  /** The activity whose card this is, locked: what the timer knows. */
  activityByThread(threadId: string): Promise<ActivityRecord | undefined>;
  insertActivity(activity: ActivityRecord): Promise<void>;
  updateActivity(id: string, patch: ActivityPatch): Promise<void>;
  deleteActivity(id: string): Promise<void>;
  // Names.
  /** These people's names; an unknown id is absent. */
  names(ids: readonly string[]): Promise<ReadonlyMap<string, string>>;
  /** These units' names; an unknown id is absent. */
  unitLabels(ids: readonly string[]): Promise<ReadonlyMap<string, string>>;
  // Erasure and export.
  /** Remove the person from every row (owner, author, added by, done by); the cards of what they owned are returned. */
  erasePerson(personId: string): Promise<Erased>;
  exportOrganisation(organisationId: string): Promise<DialogueExport>;
  audit(entry: DialogueAudit): Promise<void>;
  workItems: DialogueWorkItems;
}
export interface DialogueStore {
  transaction<T>(fn: (tx: DialogueTx) => Promise<T>): Promise<T>;
}

/**
 * A unit the person follows up (D117): one they manage (`own`) or one led by a manager who reports to them (`below`),
 * with the unit's manager, who owns what is added on it. A person who manages no unit follows up nothing.
 */
export interface FollowedUnit {
  unitId: string;
  label: string;
  relation: 'own' | 'below';
  /** The manager the unit's activities go to: the reader on their own unit, the reporting manager on one below. */
  managerId: string;
}
export type Followed = (persona: AuthenticatedContext) => Promise<FollowedUnit[]>;
/** Seals free text at rest. Used by the Postgres adapter only. */
export interface Sealer {
  seal(value: string, purpose: string): string;
  open(value: string, purpose: string): string;
}
export interface DialogueDeps {
  store: DialogueStore;
  followed: Followed;
  clock: () => Date;
  ids: () => string;
}
