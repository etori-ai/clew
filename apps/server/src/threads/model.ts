import type { MessageMeta, Thread } from '@clew/contracts';

/**
 * The ports of the stream (D25): what a use case may read, and what it may write inside one transaction. The
 * Postgres adapter (`adapters/postgres.ts`) is what the server runs; the memory adapter (`adapters/memory.ts`) is
 * what the unit tests run against, and the store contract test (`tests/store-contract.ts`) holds both to the same
 * behaviour. Every instant is an ISO string handed in by the use case, never read from a clock in here, so a test
 * decides what time it is.
 */

/** A thread as a use case creates it. The store adds nothing: timestamps and ids come from the caller. */
export interface NewThread extends Omit<Thread, 'messages' | 'proposals' | 'receipt' | 'handledAt' | 'remindedAt' | 'snoozedUntil'> { personId: string }
export type ThreadPatch = Partial<Pick<Thread, 'state' | 'title' | 'summary' | 'items' | 'actions' | 'deadline' | 'waitingOn' | 'receipt' | 'handledAt' | 'updatedAt' | 'trigger' | 'remindedAt' | 'snoozedUntil'>>;
export interface NewMessage { role: 'assistant' | 'user'; body: string; at: string; meta?: MessageMeta }
export interface AuditEntry { actor: string; action: string; subject: string; at: string; details?: Record<string, unknown> }
export interface JobInput { id: string; kind: string; runAt: string; payload?: Record<string, unknown> }

/** What a reminder timer carries back when it fires (D17). Declared here so the workflow, the activity and the use case share one shape. */
export interface ReminderInput { personId: string; threadId: string; title: string; area: string; seconds: number; requestedAt: string; /** A snooze's timer (D29): the card comes back without a badge or a toast. */ silent?: boolean }

/** Writes inside one transaction. The audit row of a mutation is written through the same `tx`, so it commits or rolls back with the rest. */
export interface ThreadTx {
  /** The person's thread, held against concurrent writers until the transaction ends (a row lock in Postgres). */
  lockThread(personId: string, id: string): Promise<Thread | undefined>;
  /** False when an open pushed thread with the same topic already exists for the person: the scan is idempotent. */
  insertThread(thread: NewThread): Promise<boolean>;
  updateThread(id: string, patch: ThreadPatch): Promise<void>;
  addMessage(threadId: string, message: NewMessage): Promise<void>;
  writeAudit(entry: AuditEntry): Promise<void>;
  /** Idempotent by job id. */
  scheduleJob(job: JobInput): Promise<void>;
}
export interface ThreadStore {
  /** Open threads plus what was handled in the seven days before `now`, newest first. */
  listThreads(personId: string, now: string): Promise<Thread[]>;
  /** One of the person's threads; undefined when it does not exist or is not theirs. */
  readThread(personId: string, id: string): Promise<Thread | undefined>;
  /** For timers that know only the thread. */
  readThreadById(id: string): Promise<Thread | undefined>;
  /** The person's open pushed thread on a topic. */
  openThread(personId: string, topic: string): Promise<Thread | undefined>;
  countPushedSince(personId: string, since: string): Promise<number>;
  transaction<T>(fn: (tx: ThreadTx) => Promise<T>): Promise<T>;
}

/** The timers behind "Påminn mig" (D17). Temporal runs them; the memory adapter records them. */
export interface ReminderTimers {
  /** Rejects when the timer service cannot be reached. */
  start(input: { workflowId: string; personId: string; threadId: string; title: string; area: string; seconds: number; requestedAt: string; silent?: boolean }): Promise<void>;
  /** Best effort: a timer that already fired or is gone is not an error. */
  cancel(workflowId: string): Promise<void>;
}
