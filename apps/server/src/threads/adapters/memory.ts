import { unresolvedExecution, type Thread } from '@clew/contracts';
import type { AuditEntry, JobInput, ThreadStore, ThreadTx, TimerIntent, WorkflowStart } from '../model';
import { admitAttention, type AttentionDay } from '../attention-domain';
import { namedAmong, namedSubjects, reminderWorkflowId, withoutSubject } from '../domain';

/**
 * The store in memory: the unit tests' adapter (D25). Same contract as Postgres, held to it by `tests/store-contract.ts`.
 * A transaction is a snapshot: when the callback throws, every write since the snapshot is gone, the audit row and the
 * workflow starts included. `audit`, `jobs`, `enqueued` and `cancelled` are exposed so a test can assert what a mutation
 * recorded and which workflows it started or ended (D86).
 */
export interface MemoryThreadStore extends ThreadStore {
  audit: AuditEntry[];
  /** What the person is due to be told, by delivery id. */
  deliveries: string[];
  jobs: JobInput[];
  /** Every workflow start committed through `enqueue`, in order. */
  enqueued: WorkflowStart[];
  /** Every workflow id whose wait a committed transaction ended: a cancelled timer or a replaced generation. */
  cancelled: string[];
  /** Every thread with its owner, for assertions that need to see across people. */
  dump(): Array<{ personId: string; thread: Thread }>;
}
export function memoryThreadStore(): MemoryThreadStore {
  let threads = new Map<string, { personId: string; thread: Thread }>();
  let audit: AuditEntry[] = [];
  let jobs: JobInput[] = [];
  let enqueued: WorkflowStart[] = [];
  const cancelled: string[] = [];
  let ended: string[] = [];
  let timerRows = new Map<string, TimerIntent>();
  let days = new Map<string, AttentionDay>(),
    deliveries = new Set<string>();
  let messageSequence = 0;
  let transactions = Promise.resolve();
  const copy = <T>(value: T): T => structuredClone(value);
  const withTimers = (thread: Thread): Thread => {
    const timers = [...timerRows.values()]
      // Only the person's own timers are theirs to see and cancel; `obligation` and `due` are the system's (D30, D96).
      .filter(
        (t): t is TimerIntent & { kind: 'reminder' | 'snooze' } =>
          t.threadId === thread.id &&
          (t.kind === 'reminder' || t.kind === 'snooze') &&
          ['active', 'blocked'].includes(t.state),
      )
      .map(t => ({
        kind: t.kind,
        dueAt: t.dueAt,
        // The start commits with the row (D86), so an active timer is scheduled; `queued` is the retired outbox's state.
        state: (t.state === 'blocked' ? 'blocked' : 'scheduled') as 'blocked' | 'scheduled' | 'queued',
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
      if (timer.generation > 1) ended.push(reminderWorkflowId({ id: timer.id, generation: timer.generation - 1 }));
      return copy(timer);
    },
    async cancelTimer(id, at, generation) {
      const t = timerRows.get(id);
      if (!t || !['active', 'blocked'].includes(t.state) || (generation !== undefined && t.generation !== generation))
        return false;
      timerRows.set(id, { ...t, state: 'cancelled', reason: null, nextAt: at, leaseUntil: null, attempt: 0 });
      ended.push(reminderWorkflowId(t));
      return true;
    },
    async enqueue(start) {
      if (!enqueued.some(s => s.id === start.id)) enqueued.push(copy(start));
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
      // A thread names no entity of its own unless it says so, as Postgres reads an empty column back (D97).
      const { personId, subjects, ...rest } = thread;
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
          ...(subjects?.length ? { subjects: copy(subjects) } : {}),
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
    // The index from entity to cards is the threads' own rows here, read as Postgres reads its index (D97).
    async eraseSubject(subject) {
      const erased = { cards: 0, rows: 0, cardSubjects: 0 };
      for (const row of threads.values()) {
        const left = withoutSubject(row.thread, subject);
        if (!left) continue;
        const { subjects, erased: counts, items } = left;
        const { subjects: _, ...thread } = row.thread;
        row.thread = { ...thread, items, ...(subjects.length ? { subjects } : {}) };
        erased.cards++;
        erased.rows += counts.rows;
        erased.cardSubjects += counts.cardSubjects;
      }
      return erased;
    },
  };
  const store: MemoryThreadStore = {
    readTimer: tx.readTimer,
    get audit() {
      return audit;
    },
    get deliveries() {
      return [...deliveries];
    },
    get jobs() {
      return jobs;
    },
    get enqueued() {
      return enqueued;
    },
    get cancelled() {
      return cancelled;
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
    async threadsNaming(personId, subjects) {
      return [...threads.values()]
        .filter(
          r =>
            r.personId === personId &&
            r.thread.kind === 'pushed' &&
            (r.thread.state === 'open' || unresolvedExecution(r.thread)),
        )
        .map(r => ({ thread: r.thread, subjects: namedAmong(namedSubjects(r.thread), subjects) }))
        .filter(r => r.subjects.length)
        .sort((a, b) => Date.parse(b.thread.createdAt) - Date.parse(a.thread.createdAt))
        .map(r => ({ thread: withTimers(r.thread), subjects: r.subjects }));
    },
    async history(subjects, limit) {
      // Oldest first by time, then in the order written, as Postgres orders by its timestamp and serial id.
      const rows = audit
        .map((entry, at) => ({ entry, at }))
        .filter(r => subjects.includes(r.entry.subject))
        .sort((a, b) => Date.parse(a.entry.at) - Date.parse(b.entry.at) || a.at - b.at)
        .map(r => copy(r.entry));
      return rows.slice(Math.max(0, rows.length - limit));
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
        enqueued: copy(enqueued),
        timerRows: copy(timerRows),
        days: copy(days),
        deliveries: copy(deliveries),
      };
      ended = [];
      try {
        const result = await fn(tx);
        // Committed: the waits this transaction ended are cancelled afterwards, as the Postgres store does.
        cancelled.push(...ended);
        return result;
      } catch (error) {
        threads = snapshot.threads;
        audit = snapshot.audit;
        jobs = snapshot.jobs;
        enqueued = snapshot.enqueued;
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
