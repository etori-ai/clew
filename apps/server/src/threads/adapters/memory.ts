import { unresolvedExecution, type Thread } from '@clew/contracts';
import type { AuditEntry, JobInput, ReminderTimers, ThreadStore, ThreadTx, TimerDelivery, TimerIntent } from '../model';
import { admitAttention, type AttentionDay } from '../attention-domain';

/**
 * The store in memory: the unit tests' adapter (D25). Same contract as Postgres, held to it by `tests/store-contract.ts`.
 * A transaction is a snapshot: when the callback throws, every write since the snapshot is gone, the audit row included.
 * `audit` and `jobs` are exposed so a test can assert what a mutation recorded.
 */
export interface MemoryThreadStore extends ThreadStore, TimerDelivery {
  audit: AuditEntry[];
  /** What the person is due to be told, by delivery id. */
  deliveries: string[];
  jobs: JobInput[];
  /** Every thread with its owner, for assertions that need to see across people. */
  dump(): Array<{ personId: string; thread: Thread }>;
}
export function memoryThreadStore(): MemoryThreadStore {
  let threads = new Map<string, { personId: string; thread: Thread }>();
  let audit: AuditEntry[] = [];
  let jobs: JobInput[] = [];
  let timerRows = new Map<string, TimerIntent>();
  let days = new Map<string, AttentionDay>(),
    deliveries = new Set<string>();
  let messageSequence = 0;
  let transactions = Promise.resolve();
  const copy = <T>(value: T): T => structuredClone(value);
  const withTimers = (thread: Thread): Thread => {
    const timers = [...timerRows.values()]
      .filter(t => t.threadId === thread.id && t.kind !== 'obligation' && ['active', 'blocked'].includes(t.state))
      .map(t => ({
        kind: t.kind as 'reminder' | 'snooze',
        dueAt: t.dueAt,
        state: (t.state === 'blocked'
          ? 'blocked'
          : t.deliveredGeneration === t.generation && t.deliveredState === 'active'
            ? 'scheduled'
            : 'queued') as 'blocked' | 'scheduled' | 'queued',
      }));
    return copy({ ...thread, ...(timers.length ? { timers } : {}) });
  };
  const own = (personId: string, id: string) => {
    const row = threads.get(id);
    return row && row.personId === personId ? row : undefined;
  };
  const tx: ThreadTx = {
    async admitDelivery(input) {
      if (deliveries.has(input.id)) return;
      deliveries.add(input.id);
      if (input.kind === 'automatic') {
        const next = admitAttention(days.get(input.personId), input.personId, input.at);
        days.set(input.personId, next);
      }
    },
    async readTimer(id) {
      return copy(timerRows.get(id));
    },
    async scheduleTimer(input) {
      const timer: TimerIntent = {
        ...copy(input),
        generation: (timerRows.get(input.id)?.generation ?? 0) + 1,
        state: 'active',
        reason: null,
        deliveredGeneration: null,
        deliveredState: null,
        attempt: 0,
        nextAt: input.requestedAt,
        leaseUntil: null,
      };
      timerRows.set(timer.id, timer);
      return copy(timer);
    },
    async cancelTimer(id, at, generation) {
      const t = timerRows.get(id);
      if (!t || !['active', 'blocked'].includes(t.state) || (generation !== undefined && t.generation !== generation))
        return false;
      timerRows.set(id, { ...t, state: 'cancelled', reason: null, nextAt: at, leaseUntil: null, attempt: 0 });
      return true;
    },
    async updateTimer(t) {
      if (timerRows.get(t.id)?.generation === t.generation) timerRows.set(t.id, copy(t));
    },
    async lockThreadById(id) {
      const row = threads.get(id);
      return row ? withTimers(row.thread) : undefined;
    },
    async lockThread(personId, id) {
      const row = own(personId, id);
      return row ? withTimers(row.thread) : undefined;
    },
    async insertThread(thread) {
      const { personId, ...rest } = thread;
      const clash = [...threads.values()].some(
        r =>
          r.personId === personId &&
          r.thread.topic === rest.topic &&
          r.thread.state === 'open' &&
          r.thread.kind === 'pushed',
      );
      if (rest.kind === 'pushed' && rest.state === 'open' && clash) return false;
      threads.set(rest.id, {
        personId,
        thread: {
          ...copy(rest),
          receipt: null,
          handledAt: null,
          remindedAt: null,
          snoozedUntil: null,
          messages: [],
          proposals: [],
        },
      });
      return true;
    },
    async updateThread(id, patch) {
      const row = threads.get(id);
      if (!row) return;
      row.thread = { ...row.thread, ...copy(patch) };
    },
    async addMessage(threadId, message) {
      const row = threads.get(threadId);
      if (!row) throw new Error(`Thread ${threadId} does not exist.`);
      row.thread.messages.push({
        id: `message-${++messageSequence}`,
        role: message.role,
        body: message.body,
        createdAt: message.at,
        ...(message.meta ? { meta: message.meta } : {}),
      });
      row.thread.updatedAt = message.at;
    },
    async writeAudit(entry) {
      audit.push(copy(entry));
    },
    async scheduleJob(job) {
      if (!jobs.some(j => j.id === job.id)) jobs.push(copy(job));
    },
  };
  const store: MemoryThreadStore = {
    readTimer: tx.readTimer,
    claimTimer: (now, until) =>
      store.transaction(async () => {
        const t = [...timerRows.values()]
          .sort((a, b) => a.nextAt.localeCompare(b.nextAt))
          .find(
            t =>
              ['active', 'cancelled'].includes(t.state) &&
              (t.deliveredGeneration !== t.generation || t.deliveredState !== t.state) &&
              t.nextAt <= now &&
              (!t.leaseUntil || t.leaseUntil <= now),
          );
        if (!t) return undefined;
        const claimed = { ...t, attempt: t.attempt + 1, leaseUntil: until };
        timerRows.set(t.id, claimed);
        return copy(claimed);
      }),
    finishTimer: (t, retryAt, error) =>
      store.transaction(async () => {
        const current = timerRows.get(t.id);
        if (
          !current ||
          current.generation !== t.generation ||
          current.state !== t.state ||
          current.attempt !== t.attempt
        )
          return;
        timerRows.set(t.id, {
          ...current,
          nextAt: retryAt,
          leaseUntil: null,
          reason: error ?? null,
          ...(!error ? { deliveredGeneration: t.generation, deliveredState: t.state } : {}),
        });
      }),
    get audit() {
      return audit;
    },
    get deliveries() {
      return [...deliveries];
    },
    get jobs() {
      return jobs;
    },
    dump: () => [...threads.values()].map(copy),
    async listThreads(personId, now) {
      const since = Date.parse(now) - 7 * 86400_000;
      const visible = [...threads.values()]
        .filter(
          r =>
            r.personId === personId &&
            (r.thread.state === 'open' || unresolvedExecution(r.thread) || Date.parse(r.thread.updatedAt) >= since),
        )
        .sort((a, b) => Date.parse(b.thread.createdAt) - Date.parse(a.thread.createdAt));
      let history = 0;
      return visible
        .filter(
          r =>
            (r.thread.kind === 'pushed' && (r.thread.state === 'open' || unresolvedExecution(r.thread))) ||
            history++ < 50,
        )
        .map(r => withTimers(r.thread));
    },
    async readThread(personId, id) {
      const row = own(personId, id);
      return row ? withTimers(row.thread) : undefined;
    },
    async readThreadById(id) {
      const row = threads.get(id);
      return row ? withTimers(row.thread) : undefined;
    },
    async openThread(personId, topic) {
      const row = [...threads.values()].find(
        r => r.personId === personId && r.thread.topic === topic && r.thread.state === 'open',
      );
      return row ? withTimers(row.thread) : undefined;
    },
    async transaction(fn) {
      const previous = transactions;
      let release!: () => void;
      transactions = new Promise<void>(resolve => {
        release = resolve;
      });
      await previous;
      const snapshot = {
        threads: copy(threads),
        audit: copy(audit),
        jobs: copy(jobs),
        timerRows: copy(timerRows),
        days: copy(days),
        deliveries: copy(deliveries),
      };
      try {
        return await fn(tx);
      } catch (error) {
        threads = snapshot.threads;
        audit = snapshot.audit;
        jobs = snapshot.jobs;
        timerRows = snapshot.timerRows;
        days = snapshot.days;
        deliveries = snapshot.deliveries;
        throw error;
      } finally {
        release();
      }
    },
  };
  return store;
}

/** Timers that only remember what was asked of them. */
export function memoryTimers(
  options: { available?: boolean } = {},
): ReminderTimers & { started: Array<Parameters<ReminderTimers['start']>[0]>; cancelled: string[] } {
  const started: Array<Parameters<ReminderTimers['start']>[0]> = [],
    cancelled: string[] = [];
  return {
    started,
    cancelled,
    async start(input) {
      if (options.available === false) throw new Error('Timer service unavailable.');
      started.push(input);
    },
    async cancel(workflowId) {
      cancelled.push(workflowId);
    },
  };
}
