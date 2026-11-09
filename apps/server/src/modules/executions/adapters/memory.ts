import type { Execution, ExecutionAudit, ExecutionStore, Job, WatchCard, WatchIntent, WorkflowStart } from '../model';

/** The ledger in memory for the unit tests (D25): the same contract as Postgres, with the workflow starts a commit made recorded in `enqueued` (D86). */
export function memoryExecutionStore() {
  let records = new Map<string, Execution>(),
    jobs = new Map<string, Job>(),
    enqueued = new Map<string, WorkflowStart>(),
    watches = new Map<string, WatchIntent>(),
    cards = new Map<string, WatchCard>(),
    audit: ExecutionAudit[] = [];
  let tail = Promise.resolve();
  const serialized = async <T>(fn: () => Promise<T>): Promise<T> => {
    const previous = tail;
    let release!: () => void;
    tail = new Promise<void>(resolve => {
      release = resolve;
    });
    await previous;
    try {
      return await fn();
    } finally {
      release();
    }
  };
  const store: ExecutionStore = {
    async readDecision(personId, decisionId) {
      return structuredClone([...records.values()].find(e => e.personId === personId && e.decisionId === decisionId));
    },
    async read(id) {
      return structuredClone(records.get(id));
    },
    async readJob(id) {
      return structuredClone(jobs.get(id));
    },
    transaction: fn =>
      serialized(async () => {
        const r = structuredClone(records),
          j = structuredClone(jobs),
          o = structuredClone(enqueued),
          w = structuredClone(watches),
          c = structuredClone(cards),
          a = structuredClone(audit);
        const result = await fn({
          async insert(e) {
            const existing = [...r.values()].find(
              row => row.personId === e.personId && row.decisionId === e.decisionId,
            );
            if (existing) return { inserted: false, execution: structuredClone(existing) };
            if (r.has(e.id)) throw new Error('Duplicate execution ID');
            r.set(e.id, structuredClone(e));
            return { inserted: true, execution: structuredClone(e) };
          },
          async lock(id) {
            return structuredClone(r.get(id));
          },
          async update(e) {
            r.set(e.id, structuredClone(e));
          },
          async enqueue(start) {
            if (!o.has(start.id)) o.set(start.id, structuredClone(start));
          },
          async audit(entry) {
            a.push(structuredClone(entry));
          },
          async insertJob(job) {
            const existing = [...j.values()].find(
              row => row.personId === job.personId && row.decisionId === job.decisionId,
            );
            if (existing) return { inserted: false, job: structuredClone(existing) };
            if (j.has(job.id)) throw new Error('Duplicate job ID');
            j.set(job.id, structuredClone(job));
            return { inserted: true, job: structuredClone(job) };
          },
          async lockJob(id) {
            return structuredClone(j.get(id));
          },
          async updateJob(job) {
            j.set(job.id, structuredClone(job));
          },
          async enqueueWatch(intent) {
            if (!j.has(intent.jobId)) throw new Error('Watch intent without its job');
            if (!w.has(intent.id)) w.set(intent.id, structuredClone(intent));
          },
          async pushCard(card) {
            if (!c.has(card.id)) c.set(card.id, structuredClone(card));
          },
        });
        records = r;
        jobs = j;
        enqueued = o;
        watches = w;
        cards = c;
        audit = a;
        return result;
      }),
  };
  return Object.assign(store, {
    dump: () => structuredClone([...records.values()]),
    jobs: () => structuredClone([...jobs.values()]),
    enqueued: () => structuredClone([...enqueued.values()]),
    watches: () => structuredClone([...watches.values()]),
    cards: () => structuredClone([...cards.values()]),
    audit: () => structuredClone(audit),
  });
}
