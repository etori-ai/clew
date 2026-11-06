import type { DispatchIntent, Execution, ExecutionAudit, ExecutionStore, Job } from '../model';

export function memoryExecutionStore() {
  let records = new Map<string, Execution>(),
    jobs = new Map<string, Job>(),
    outbox = new Map<string, DispatchIntent>(),
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
          o = structuredClone(outbox),
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
          async enqueue(intent) {
            if (!o.has(intent.id)) o.set(intent.id, structuredClone(intent));
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
        });
        records = r;
        jobs = j;
        outbox = o;
        audit = a;
        return result;
      }),
    claimDispatch: (now, until) =>
      serialized(async () => {
        const next = [...outbox.values()].find(
          o => !o.deliveredAt && o.nextAt <= now && (!o.leaseUntil || o.leaseUntil <= now),
        );
        if (!next) return undefined;
        next.attempt++;
        next.leaseUntil = until;
        return structuredClone(next);
      }),
    finishDispatch: (id, attempt, now, retryAt, error) =>
      serialized(async () => {
        const intent = outbox.get(id);
        if (!intent || intent.attempt !== attempt) return;
        Object.assign(intent, {
          deliveredAt: error ? null : now,
          leaseUntil: null,
          nextAt: retryAt,
          lastError: error ?? null,
        });
      }),
  };
  return Object.assign(store, {
    dump: () => structuredClone([...records.values()]),
    jobs: () => structuredClone([...jobs.values()]),
    outbox: () => structuredClone([...outbox.values()]),
    audit: () => structuredClone(audit),
  });
}
