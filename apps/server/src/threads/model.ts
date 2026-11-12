import type { MessageMeta, Subject, Thread } from '@clew/contracts';

/**
 * The ports of the stream (D25): what a use case may read, and what it may write inside one transaction. The
 * Postgres adapter (`adapters/postgres.ts`) is what the server runs; the memory adapter (`adapters/memory.ts`) is
 * what the unit tests run against, and the store contract test (`tests/store-contract.ts`) holds both to the same
 * behaviour. Every instant is an ISO string handed in by the use case, never read from a clock in here, so a test
 * decides what time it is.
 */

/** A thread as a use case creates it. The store adds nothing: timestamps and ids come from the caller. */
export interface NewThread extends Omit<
  Thread,
  'messages' | 'proposals' | 'receipt' | 'handledAt' | 'remindedAt' | 'snoozedUntil'
> {
  personId: string;
}
export type ThreadPatch = Partial<
  Pick<
    Thread,
    | 'state'
    | 'title'
    | 'summary'
    | 'items'
    | 'actions'
    | 'deadline'
    | 'waitingOn'
    | 'receipt'
    | 'handledAt'
    | 'updatedAt'
    | 'trigger'
    | 'remindedAt'
    | 'snoozedUntil'
  >
>;
export interface NewMessage {
  role: 'assistant' | 'user';
  body: string;
  at: string;
  meta?: MessageMeta;
}
export interface AuditEntry {
  actor: string;
  action: string;
  subject: string;
  at: string;
  details?: Record<string, unknown>;
}
export interface JobInput {
  id: string;
  kind: string;
  runAt: string;
  payload?: Record<string, unknown>;
}

/**
 * What a timer is for. `reminder` and `snooze` are the person's own (D17, D29): the only kinds a thread lists in
 * `Thread.timers`, the only kinds the reminder path fires, and the person may cancel them. `obligation` keeps a calendar
 * follow-up's time (D30) and `due` brings an action point's card back the morning after its due date (D96 item 5); both
 * are the system's, never shown as the person's timers, and each is fired by its own module.
 */
export type TimerKind = 'reminder' | 'snooze' | 'obligation' | 'due';
/** One current desired timer per purpose and thread. Generation fences every old workflow. The delivery columns (`deliveredGeneration`, `deliveredState`, `attempt`, `nextAt`, `leaseUntil`) are the retired outbox's and stay as evidence (D86). */
export interface TimerIntent {
  id: string;
  personId: string;
  threadId: string;
  kind: TimerKind;
  generation: number;
  unitId: string;
  authorizationVersion: string;
  dueAt: string;
  requestedAt: string;
  state: 'active' | 'cancelled' | 'fired' | 'blocked';
  reason: string | null;
  deliveredGeneration: number | null;
  deliveredState: string | null;
  attempt: number;
  nextAt: string;
  leaseUntil: string | null;
}
export type NewTimerIntent = Pick<
  TimerIntent,
  'id' | 'personId' | 'threadId' | 'kind' | 'unitId' | 'authorizationVersion' | 'dueAt' | 'requestedAt'
>;
/**
 * A durable workflow start, committed with the intent it serves (D86): the registered workflow's name, its stable id
 * (`<timer id>:v2:<generation>` for a reminder) and one JSON input. The Postgres adapter enqueues it on the
 * transaction's own connection; the memory adapter records it for the unit tests.
 */
export interface WorkflowStart {
  workflow: string;
  id: string;
  input: unknown;
}

/** What a reminder timer carries back when it fires (D17). Declared here so the workflow, the activity and the use case share one shape. */
export interface ReminderInput {
  personId: string;
  threadId: string;
  title: string;
  area: string;
  seconds: number;
  requestedAt: string;
  /** This timer belongs to a snooze (D29). The name stays for the workflows already running; since D49 it no longer means a quiet return. */ silent?: boolean;
}

/** Writes inside one transaction. The audit row of a mutation is written through the same `tx`, so it commits or rolls back with the rest. */
export interface ThreadTx {
  admitDelivery(input: {
    id: string;
    personId: string;
    threadId: string;
    kind: 'automatic' | 'reminder';
    at: string;
  }): Promise<void>;
  /** The person's thread, held against concurrent writers until the transaction ends (a row lock in Postgres). */
  lockThreadById(id: string): Promise<Thread | undefined>;
  lockThread(personId: string, id: string): Promise<Thread | undefined>;
  /** False when an open pushed thread with the same topic already exists for the person: the scan is idempotent. */
  insertThread(thread: NewThread): Promise<boolean>;
  updateThread(id: string, patch: ThreadPatch): Promise<void>;
  addMessage(threadId: string, message: NewMessage): Promise<void>;
  writeAudit(entry: AuditEntry): Promise<void>;
  /** Idempotent by job id. */
  scheduleJob(job: JobInput): Promise<void>;
  readTimer(id: string): Promise<TimerIntent | undefined>;
  /** The caller holds the thread lock. Replacing increments generation; the previous generation's workflow is cancelled after commit, best effort, and the fence covers a cancel that does not arrive. */
  scheduleTimer(input: NewTimerIntent): Promise<TimerIntent>;
  /** Optional generation makes an old toast harmless after replacement. A cancelled timer's workflow is cancelled after commit the same way. */
  cancelTimer(id: string, at: string, generation?: number): Promise<boolean>;
  updateTimer(timer: TimerIntent): Promise<void>;
  /** Start a durable workflow with this commit (D86): rolled back with it, dequeued by the engine once committed. Idempotent by workflow id. */
  enqueue(start: WorkflowStart): Promise<void>;
  /**
   * Remove one entity from every thread of every person (D97): the `subject` of each row that names it and the thread's
   * own subject, with the index rows, the rows' text left as the source wrote it. A key is compared as Clew compares it
   * (`foldEntityKey`). Neither `updatedAt` nor anything the person decided on moves.
   */
  eraseSubject(subject: Subject): Promise<SubjectErasure>;
}
/** What `eraseSubject` touched: the threads, the rows that named the entity and the threads' own subjects. Counts only. */
export interface SubjectErasure {
  cards: number;
  rows: number;
  cardSubjects: number;
}
/** A thread found by the entities it names (D97 item 6), with those it names among the ones asked, in the asked spelling. */
export interface NamingThread {
  thread: Thread;
  subjects: Subject[];
}
export interface ThreadStore {
  /** Every unresolved pushed thread, plus at most 50 conversations/recently handled threads, newest first. */
  listThreads(personId: string, now: string): Promise<Thread[]>;
  /** One of the person's threads; undefined when it does not exist or is not theirs. */
  readThread(personId: string, id: string): Promise<Thread | undefined>;
  /** For timers that know only the thread. */
  readThreadById(id: string): Promise<Thread | undefined>;
  readTimer(id: string): Promise<TimerIntent | undefined>;
  /** The person's open pushed thread on a topic. */
  openThread(personId: string, topic: string): Promise<Thread | undefined>;
  /**
   * The index from entity to cards (D97 item 6): the person's unresolved work threads (a pushed card that is open, or
   * whose execution has not settled, as `listThreads` lists work) whose rows, or which themselves, name one of these
   * entities, newest first. A key is compared as Clew compares it (`foldEntityKey`); one read for the whole list.
   */
  threadsNaming(personId: string, subjects: readonly Subject[]): Promise<NamingThread[]>;
  /**
   * The audit rows written about these subjects, oldest first, at most `limit` of the newest: what a work item's
   * "Händelser" is read from (D111 item 4). The caller has checked that the person may see the item; this reads no owner.
   */
  history(subjects: readonly string[], limit: number): Promise<AuditEntry[]>;
  transaction<T>(fn: (tx: ThreadTx) => Promise<T>): Promise<T>;
}
