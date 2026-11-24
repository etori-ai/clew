import { describe, expect, test } from 'bun:test';
import { JOB_LEASE_MS, type JobExecutions, type JobQueue } from '../apps/server/src/scheduler/model';

/**
 * The job table's contract (D15, D47, D85, D25): one suite, two adapters. `tests/unit/job-store.test.ts` runs it on
 * `memoryJobTable`, `tests/db/postgres-job-store.test.ts` on `durableJobs` and `postgresJobQueue`. A row is written
 * directly, as the engine leaves it: scheduling one starts its workflow and a take-over moves workflows, which are the
 * engine's and run in `bun run test:durability`.
 */
export interface JobStoreHarness {
  executions: JobExecutions;
  unfinished: JobQueue['unfinished'];
  /** Every id of a run begins with it (the Postgres harness removes them afterwards). */
  prefix: string;
  seed(row: {
    id: string;
    kind: string;
    runAt: string;
    status?: 'temporal' | 'executing' | 'done';
    attempts?: number;
    leaseUntil?: string;
  }): Promise<void>;
  row(id: string): Promise<{ status: string; attempts: number; leaseUntil: string | null } | undefined>;
  /** The job's audit rows, oldest first. */
  audit(id: string): Promise<Array<{ action: string; details: Record<string, unknown> }>>;
}
/** `seconds` after a job's run time, on a clock in 2098, so a Postgres row is this run's own. */
const at = (seconds: number) => new Date(Date.parse('2098-11-05T09:00:00.000Z') + seconds * 1000).toISOString();
const lease = (seconds: number) => at(seconds + JOB_LEASE_MS / 1000);
export function jobStoreContract(name: string, make: () => Promise<JobStoreHarness>) {
  describe(`${name} job table`, () => {
    test('the attempt that holds a job renews its lease; one that lost it can neither renew nor complete it, and the holder completes it once, with its row', async () => {
      const h = await make(),
        id = h.prefix + '-lease',
        jobs = h.executions;
      await h.seed({ id, kind: 'receipt-final', runAt: at(0) });
      expect(await jobs.claimExecution(id, at(0))).toEqual({ id, kind: 'receipt-final', payload: {}, attempt: 1 });
      expect(await h.row(id)).toEqual({ status: 'executing', attempts: 1, leaseUntil: lease(0) });
      // Renewed at 90 seconds: at 150, past the first lease, the job is still claimed.
      expect(await jobs.renew(id, 1, at(90))).toBe(true);
      expect((await h.row(id))?.leaseUntil).toBe(lease(90));
      expect(await jobs.claimExecution(id, at(150))).toBe('busy');
      // Not renewed again, as when the run's process has stopped: past the renewed lease, another attempt claims it.
      expect(await jobs.claimExecution(id, at(211))).toMatchObject({ id, attempt: 2 });
      expect(await jobs.renew(id, 1, at(212))).toBe(false);
      expect(await jobs.completed(id, 1, at(213))).toBe(false);
      expect(await h.row(id)).toEqual({ status: 'executing', attempts: 2, leaseUntil: lease(211) });
      expect(await h.audit(id)).toEqual([]);
      // The holder completes it with its row, once; nothing renews, completes or claims it afterwards.
      expect(await jobs.completed(id, 2, at(214))).toBe(true);
      expect(await jobs.renew(id, 2, at(215))).toBe(false);
      expect(await jobs.completed(id, 2, at(216))).toBe(false);
      expect(await jobs.claimExecution(id, at(500))).toBeUndefined();
      expect(await h.row(id)).toEqual({ status: 'done', attempts: 2, leaseUntil: null });
      expect(await h.audit(id)).toEqual([{ action: 'job.completed', details: { attempt: 2 } }]);
    });
    test('a job is busy before its run time, and a job the table does not hold is nobody’s to claim', async () => {
      const h = await make(),
        id = h.prefix + '-later';
      await h.seed({ id, kind: 'receipt-final', runAt: at(60) });
      expect(await h.executions.claimExecution(id, at(59))).toBe('busy');
      expect(await h.row(id)).toEqual({ status: 'temporal', attempts: 0, leaseUntil: null });
      expect(await h.executions.claimExecution(h.prefix + '-unknown', at(60))).toBeUndefined();
      expect(await h.executions.renew(h.prefix + '-unknown', 1, at(60))).toBe(false);
      expect(await h.executions.completed(h.prefix + '-unknown', 1, at(60))).toBe(false);
      expect(await h.executions.claimExecution(id, at(60))).toMatchObject({ id, attempt: 1 });
    });
    test('what is unfinished of a prefix waits or is claimed, by run time and then id; a completed job and another prefix’s are not', async () => {
      const h = await make(),
        night = h.prefix + ':night';
      await h.seed({ id: night, kind: 'nightly', runAt: at(10) });
      await h.seed({
        id: night + ':4',
        kind: 'nightly',
        runAt: at(0),
        status: 'executing',
        attempts: 1,
        leaseUntil: lease(0),
      });
      await h.seed({ id: night + ':2', kind: 'nightly', runAt: at(0) });
      await h.seed({ id: night + ':3', kind: 'nightly', runAt: at(0), status: 'done', attempts: 1 });
      await h.seed({ id: h.prefix + ':other', kind: 'nightly', runAt: at(0) });
      expect(await h.unfinished(night)).toEqual([night + ':2', night + ':4', night]);
      expect(await h.unfinished(h.prefix + ':none')).toEqual([]);
    });
  });
}
