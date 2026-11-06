import type { DispatchIntent, Execution, ExecutionAudit, ExecutionStore, Job, WatchCard, WatchIntent } from '../model';

export function memoryExecutionStore() {
  let records = new Map<string, Execution>(), jobs = new Map<string, Job>(), outbox = new Map<string, DispatchIntent>(), watches = new Map<string, WatchIntent>(), cards = new Map<string, WatchCard>(), audit: ExecutionAudit[] = [];
  let tail = Promise.resolve();
  const serialized = async <T>(fn: () => Promise<T>): Promise<T> => {
    const previous = tail; let release!: () => void;
    tail = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try { return await fn(); } finally { release(); }
  };
  /** The same lease for both outboxes: the first due, unleased, undelivered row, claimed for `until`. */
  const claim = <T extends { attempt: number; leaseUntil: string | null; nextAt: string; deliveredAt: string | null }>(rows: Map<string, T>, now: string, until: string) => {
    const next = [...rows.values()].sort((a, b) => a.nextAt.localeCompare(b.nextAt)).find(o => !o.deliveredAt && o.nextAt <= now && (!o.leaseUntil || o.leaseUntil <= now));
    if (!next) return undefined;
    next.attempt++; next.leaseUntil = until; return structuredClone(next);
  };
  const finish = <T extends { attempt: number; leaseUntil: string | null; nextAt: string; deliveredAt: string | null; lastError: string | null }>(rows: Map<string, T>, id: string, attempt: number, now: string, retryAt: string, error?: string) => {
    const intent = rows.get(id);
    if (!intent || intent.attempt !== attempt) return;
    Object.assign(intent, { deliveredAt: error ? null : now, leaseUntil: null, nextAt: retryAt, lastError: error ?? null });
  };
  const store: ExecutionStore = {
    async readDecision(personId, decisionId) { return structuredClone([...records.values()].find(e => e.personId === personId && e.decisionId === decisionId)); },
    async read(id) { return structuredClone(records.get(id)); },
    async readJob(id) { return structuredClone(jobs.get(id)); },
    transaction: fn => serialized(async () => {
      const r = structuredClone(records), j = structuredClone(jobs), o = structuredClone(outbox), w = structuredClone(watches), c = structuredClone(cards), a = structuredClone(audit);
      const result = await fn({
        async insert(e) {
          const existing = [...r.values()].find(row => row.personId === e.personId && row.decisionId === e.decisionId);
          if (existing) return { inserted: false, execution: structuredClone(existing) };
          if (r.has(e.id)) throw new Error('Duplicate execution ID');
          r.set(e.id, structuredClone(e)); return { inserted: true, execution: structuredClone(e) };
        },
        async lock(id) { return structuredClone(r.get(id)); },
        async update(e) { r.set(e.id, structuredClone(e)); },
        async enqueue(intent) { if (!o.has(intent.id)) o.set(intent.id, structuredClone(intent)); },
        async audit(entry) { a.push(structuredClone(entry)); },
        async insertJob(job) {
          const existing = [...j.values()].find(row => row.personId === job.personId && row.decisionId === job.decisionId);
          if (existing) return { inserted: false, job: structuredClone(existing) };
          if (j.has(job.id)) throw new Error('Duplicate job ID');
          j.set(job.id, structuredClone(job)); return { inserted: true, job: structuredClone(job) };
        },
        async lockJob(id) { return structuredClone(j.get(id)); },
        async updateJob(job) { j.set(job.id, structuredClone(job)); },
        async enqueueWatch(intent) { if (!j.has(intent.jobId)) throw new Error('Watch intent without its job'); if (!w.has(intent.id)) w.set(intent.id, structuredClone(intent)); },
        async pushCard(card) { if (!c.has(card.id)) c.set(card.id, structuredClone(card)); },
      });
      records = r; jobs = j; outbox = o; watches = w; cards = c; audit = a; return result;
    }),
    claimDispatch: (now, until) => serialized(async () => claim(outbox, now, until)),
    finishDispatch: (id, attempt, now, retryAt, error) => serialized(async () => finish(outbox, id, attempt, now, retryAt, error)),
    claimWatch: (now, until) => serialized(async () => claim(watches, now, until)),
    finishWatch: (id, attempt, now, retryAt, error) => serialized(async () => finish(watches, id, attempt, now, retryAt, error)),
  };
  return Object.assign(store, { dump: () => structuredClone([...records.values()]), jobs: () => structuredClone([...jobs.values()]), outbox: () => structuredClone([...outbox.values()]), watches: () => structuredClone([...watches.values()]), cards: () => structuredClone([...cards.values()]), audit: () => structuredClone(audit) });
}
