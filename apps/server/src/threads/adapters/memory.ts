import type { Thread } from '@clew/contracts';
import type { AuditEntry, JobInput, ReminderTimers, ThreadStore, ThreadTx } from '../model';

/**
 * The store in memory: the unit tests' adapter (D25). Same contract as Postgres, held to it by `tests/store-contract.ts`.
 * A transaction is a snapshot: when the callback throws, every write since the snapshot is gone, the audit row included.
 * `audit` and `jobs` are exposed so a test can assert what a mutation recorded.
 */
export interface MemoryThreadStore extends ThreadStore {
  audit: AuditEntry[];
  jobs: JobInput[];
  /** Every thread with its owner, for assertions that need to see across people. */
  dump(): Array<{ personId: string; thread: Thread }>;
}
export function memoryThreadStore(): MemoryThreadStore {
  let threads = new Map<string, { personId: string; thread: Thread }>();
  let audit: AuditEntry[] = [];
  let jobs: JobInput[] = [];
  let messageSequence = 0;
  const copy = <T>(value: T): T => structuredClone(value);
  const own = (personId: string, id: string) => { const row = threads.get(id); return row && row.personId === personId ? row : undefined; };
  const tx: ThreadTx = {
    async lockThread(personId, id) { const row = own(personId, id); return row ? copy(row.thread) : undefined; },
    async insertThread(thread) {
      const { personId, ...rest } = thread;
      const clash = [...threads.values()].some(r => r.personId === personId && r.thread.topic === rest.topic && r.thread.state === 'open' && r.thread.kind === 'pushed');
      if (rest.kind === 'pushed' && rest.state === 'open' && clash) return false;
      threads.set(rest.id, { personId, thread: { ...copy(rest), receipt: null, handledAt: null, remindedAt: null, messages: [], proposals: [] } });
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
      row.thread.messages.push({ id: `message-${++messageSequence}`, role: message.role, body: message.body, createdAt: message.at, ...(message.meta ? { meta: message.meta } : {}) });
      row.thread.updatedAt = message.at;
    },
    async writeAudit(entry) { audit.push(copy(entry)); },
    async scheduleJob(job) { if (!jobs.some(j => j.id === job.id)) jobs.push(copy(job)); },
  };
  const store: MemoryThreadStore = {
    get audit() { return audit; },
    get jobs() { return jobs; },
    dump: () => [...threads.values()].map(copy),
    async listThreads(personId, now) {
      const since = Date.parse(now) - 7 * 86400_000;
      return [...threads.values()].filter(r => r.personId === personId && (r.thread.state === 'open' || Date.parse(r.thread.updatedAt) >= since))
        .sort((a, b) => Date.parse(b.thread.createdAt) - Date.parse(a.thread.createdAt)).slice(0, 50).map(r => copy(r.thread));
    },
    async readThread(personId, id) { const row = own(personId, id); return row ? copy(row.thread) : undefined; },
    async readThreadById(id) { const row = threads.get(id); return row ? copy(row.thread) : undefined; },
    async openThread(personId, topic) {
      const row = [...threads.values()].find(r => r.personId === personId && r.thread.topic === topic && r.thread.state === 'open');
      return row ? copy(row.thread) : undefined;
    },
    async countPushedSince(personId, since) {
      return [...threads.values()].filter(r => r.personId === personId && r.thread.kind === 'pushed' && Date.parse(r.thread.createdAt) >= Date.parse(since)).length;
    },
    async transaction(fn) {
      const snapshot = { threads: copy(threads), audit: copy(audit), jobs: copy(jobs) };
      try { return await fn(tx); }
      catch (error) { threads = snapshot.threads; audit = snapshot.audit; jobs = snapshot.jobs; throw error; }
    },
  };
  return store;
}

/** Timers that only remember what was asked of them. */
export function memoryTimers(options: { available?: boolean } = {}): ReminderTimers & { started: Array<Parameters<ReminderTimers['start']>[0]>; cancelled: string[] } {
  const started: Array<Parameters<ReminderTimers['start']>[0]> = [], cancelled: string[] = [];
  return {
    started, cancelled,
    async start(input) { if (options.available === false) throw new Error('Timer service unavailable.'); started.push(input); },
    async cancel(workflowId) { cancelled.push(workflowId); },
  };
}
