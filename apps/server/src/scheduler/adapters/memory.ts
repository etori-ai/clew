import { JOB_LEASE_MS, type Job, type JobExecutions, type JobQueue } from '../model';

/** A row of the job table, as much of `schema.jobs` as the scheduler's ports read. */
export interface MemoryJobRow extends Job {
  runAt: string;
  status: 'temporal' | 'executing' | 'done';
  attempts: number;
  leaseUntil?: string;
}
/**
 * The job table in memory, the unit tests' adapter (D25), held to `durableJobs` and `postgresJobQueue` by
 * `tests/job-store-contract.ts`: a job is claimed under a lease once its run time has come, renewed and completed only
 * by the attempt that holds it, and completed with its `job.completed` row. `schedule` writes the row and starts no
 * workflow, and `takeOver` takes over nothing: both are the engine's on Postgres (`bun run test:durability`), so a test
 * that needs them binds its own. Rows keep the order they were scheduled in.
 */
export function memoryJobTable() {
  const rows: MemoryJobRow[] = [],
    audit: Array<{ actor: string; action: string; subject: string; at: string; details: Record<string, unknown> }> = [];
  const holding = (id: string, attempt: number) =>
    rows.find(r => r.id === id && r.status === 'executing' && r.attempts === attempt);
  const leaseFrom = (at: string) => new Date(Date.parse(at) + JOB_LEASE_MS).toISOString();
  const table: JobQueue & JobExecutions = {
    async schedule(job) {
      if (!rows.some(r => r.id === job.id))
        rows.push({
          ...structuredClone(job),
          payload: structuredClone(job.payload ?? {}),
          status: 'temporal',
          attempts: 0,
        });
    },
    async takeOver() {
      return [];
    },
    async unfinished(prefix) {
      // By run time and then id, as Postgres reads them.
      return rows
        .filter(r => r.id.startsWith(prefix) && r.status !== 'done')
        .sort((a, b) => a.runAt.localeCompare(b.runAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        .map(r => r.id);
    },
    async claimExecution(id, at) {
      const row = rows.find(r => r.id === id);
      if (!row || row.status === 'done') return undefined;
      if (row.runAt > at || (row.status === 'executing' && row.leaseUntil! > at)) return 'busy';
      Object.assign(row, { status: 'executing', attempts: row.attempts + 1, leaseUntil: leaseFrom(at) });
      return { id, kind: row.kind, payload: structuredClone(row.payload), attempt: row.attempts };
    },
    async renew(id, attempt, at) {
      const row = holding(id, attempt);
      if (!row) return false;
      row.leaseUntil = leaseFrom(at);
      return true;
    },
    async completed(id, attempt, at) {
      const row = holding(id, attempt);
      if (!row) return false;
      Object.assign(row, { status: 'done', leaseUntil: undefined });
      audit.push({
        actor: 'system:scheduler',
        action: 'job.completed',
        subject: `job:${id}`,
        at,
        details: { attempt },
      });
      return true;
    },
  };
  return Object.assign(table, { rows, audit });
}
