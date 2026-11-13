import { describe, expect, test } from 'bun:test';
import type { AuthenticatedContext } from '../../packages/contracts/src/index';
import type { Job, JobExecutions, JobQueue } from '../../apps/server/src/scheduler/model';
import {
  createScheduler,
  NIGHTLY,
  scheduledJobRunner,
  SIGN_IN_CLEANUP,
} from '../../apps/server/src/scheduler/usecases';

/** The scheduled jobs (D15, D47) driven by hand (D25): a job table in memory, use cases that only record what they were asked. */
const T0 = '2026-11-04T07:00:00.000Z';
const persona = (id: string): AuthenticatedContext => ({
  id,
  name: id,
  unitId: 'u',
  unitLabel: 'U',
  role: 'manager',
  organisationId: 'o',
  principal: { id: 'person:' + id, kind: 'person' },
  capabilities: [],
  authorizationVersion: 'v1',
  sessionBinding: 'system:scan',
  expiresAt: '2099-01-01T00:00:00.000Z',
  async authorize() {
    return { version: 'v1' };
  },
});
type Row = Job & { runAt: string; status: 'temporal' | 'executing' | 'done'; attempts: number; leaseUntil?: string };
/**
 * The job table as the engine sees it: a row is claimed once its run time has come, under a two-minute lease. The jobs
 * in `stranded` wait under a replaced release until they are taken over.
 */
function memoryJobs() {
  const rows: Row[] = [];
  const finished: Array<[string, number]> = [];
  const stranded = new Set<string>();
  const queue: JobQueue & JobExecutions & { rows: Row[]; finished: typeof finished; stranded: Set<string> } = {
    rows,
    finished,
    stranded,
    async schedule(job) {
      if (!rows.some(r => r.id === job.id))
        rows.push({ ...job, payload: job.payload ?? {}, status: 'temporal', attempts: 0 });
    },
    async takeOver(ids) {
      const taken = ids.filter(id => stranded.has(id));
      taken.forEach(id => stranded.delete(id));
      return taken;
    },
    async claimExecution(id, at) {
      const row = rows.find(r => r.id === id);
      if (!row || row.status === 'done') return undefined;
      if (row.runAt > at || (row.status === 'executing' && row.leaseUntil! > at)) return 'busy';
      Object.assign(row, {
        status: 'executing',
        attempts: row.attempts + 1,
        leaseUntil: new Date(Date.parse(at) + 120_000).toISOString(),
      });
      return { id, kind: row.kind, payload: row.payload, attempt: row.attempts };
    },
    async completed(id, attempt) {
      const row = rows.find(r => r.id === id)!;
      if (row.status !== 'executing' || row.attempts !== attempt) return;
      row.status = 'done';
      finished.push([id, attempt]);
    },
  };
  return queue;
}
function world() {
  const jobs = memoryJobs(),
    calls: string[] = [],
    logged: unknown[][] = [];
  let time = Date.parse(T0);
  let cleanupFails = false;
  const clock = () => new Date(time);
  const scheduler = createScheduler({
    jobs,
    clock,
    signIns: {
      removeExpired: async now => {
        calls.push('clean:' + now.toISOString());
        if (cleanupFails) throw new Error('database unavailable');
      },
    },
    log: (...args) => logged.push(args),
    people: {
      granted: async () => ['hillevi', 'gone', 'hassan'],
      personaFor: async id => (id === 'gone' ? undefined : persona(id)),
    },
    threads: {
      ensureThreads: async p => {
        calls.push('scan:' + p.id);
        if (p.id === 'hassan') throw new Error('calendar down');
      },
      closeReceiptWindow: async id => {
        calls.push('receipt:' + id);
      },
    },
    calendar: {
      closeUndoWindow: async id => {
        calls.push('undo:' + id);
      },
    },
  });
  const runJob = scheduledJobRunner({
    executions: jobs,
    release: async batch => {
      calls.push('release:' + batch);
    },
    run: scheduler.run,
    clock,
  });
  return {
    jobs,
    calls,
    logged,
    scheduler,
    runJob,
    advance: (ms: number) => {
      time += ms;
    },
    failCleanup: () => {
      cleanupFails = true;
    },
  };
}

describe('the scheduled jobs', () => {
  test('schedules the nightly scan at the next 06:00 Stockholm, once per date', async () => {
    const w = world();
    await w.scheduler.scheduleNightly();
    await w.scheduler.scheduleNightly();
    expect(w.jobs.rows).toEqual([
      {
        id: 'scan:2026-11-05',
        kind: NIGHTLY,
        runAt: '2026-11-05T05:00:00.000Z',
        payload: {},
        status: 'temporal',
        attempts: 0,
      },
    ]);
  });
  test('schedules the sign-in clean-up at the next 03:00 Stockholm, once per date', async () => {
    const w = world();
    await w.scheduler.scheduleCleanup();
    await w.scheduler.scheduleCleanup();
    expect(w.jobs.rows).toEqual([
      {
        id: 'sign-in-cleanup:2026-11-05',
        kind: SIGN_IN_CLEANUP,
        runAt: '2026-11-05T02:00:00.000Z',
        payload: {},
        status: 'temporal',
        attempts: 0,
      },
    ]);
  });
  test('a start schedules the next night of the scan and of the clean-up, and takes over a night a deployment left under the replaced release', async () => {
    const w = world();
    // The night of the scan was scheduled by an earlier start or night, and its workflow waits under the release that
    // a deployment replaced: only a night's run schedules the night after it, so it must be taken over.
    await w.jobs.schedule({ id: 'scan:2026-11-05', kind: NIGHTLY, runAt: '2026-11-05T05:00:00.000Z' });
    w.jobs.stranded.add('scan:2026-11-05');
    expect(await w.scheduler.startNightly()).toEqual(['scan:2026-11-05']);
    expect(w.jobs.rows.map(r => [r.id, r.status])).toEqual([
      ['scan:2026-11-05', 'temporal'],
      ['sign-in-cleanup:2026-11-05', 'temporal'],
    ]);
    // A second start of the same release finds nothing to take over and schedules nothing more.
    expect(await w.scheduler.startNightly()).toEqual([]);
    expect(w.jobs.rows).toHaveLength(2);
  });
  test('the sign-in clean-up removes what expired by its clock and schedules the next night', async () => {
    const w = world();
    await w.jobs.schedule({
      id: 'sign-in-cleanup:2026-11-04',
      kind: SIGN_IN_CLEANUP,
      runAt: '2026-11-04T02:00:00.000Z',
    });
    expect(await w.runJob('sign-in-cleanup:2026-11-04')).toBe('done');
    expect(w.calls).toEqual(['clean:' + T0]);
    expect(w.jobs.rows.map(r => [r.id, r.status, r.runAt])).toEqual([
      ['sign-in-cleanup:2026-11-04', 'done', '2026-11-04T02:00:00.000Z'],
      ['sign-in-cleanup:2026-11-05', 'temporal', '2026-11-05T02:00:00.000Z'],
    ]);
    expect(w.logged).toEqual([]);
  });
  test('a night whose clean-up fails says so and completes, and the next night is scheduled to clean what it left', async () => {
    const w = world();
    w.failCleanup();
    await w.jobs.schedule({
      id: 'sign-in-cleanup:2026-11-04',
      kind: SIGN_IN_CLEANUP,
      runAt: '2026-11-04T02:00:00.000Z',
    });
    // As the engine's step runs a job: the run resolves, so the night completes in the ledger. A run that threw would
    // be claimed again by its workflow every few minutes for as long as the failure lasted.
    expect(await w.runJob('sign-in-cleanup:2026-11-04')).toBe('done');
    expect(w.calls).toEqual(['clean:' + T0]);
    expect(w.logged).toEqual([['sign-in clean-up failed', new Error('database unavailable')]]);
    expect(w.jobs.rows.map(r => [r.id, r.status, r.runAt])).toEqual([
      ['sign-in-cleanup:2026-11-04', 'done', '2026-11-04T02:00:00.000Z'],
      ['sign-in-cleanup:2026-11-05', 'temporal', '2026-11-05T02:00:00.000Z'],
    ]);
    // The next night fails too, and completes as well, never left to be claimed again.
    w.advance(24 * 3600_000);
    expect(await w.runJob('sign-in-cleanup:2026-11-05')).toBe('done');
    expect(w.jobs.rows.map(r => [r.id, r.status])).toEqual([
      ['sign-in-cleanup:2026-11-04', 'done'],
      ['sign-in-cleanup:2026-11-05', 'done'],
      ['sign-in-cleanup:2026-11-06', 'temporal'],
    ]);
    expect(w.jobs.finished).toEqual([
      ['sign-in-cleanup:2026-11-04', 1],
      ['sign-in-cleanup:2026-11-05', 1],
    ]);
    expect(w.logged).toHaveLength(2);
  });
  test('each kind reaches its use case, a job without its thread changes nothing and an unknown kind is refused', async () => {
    const w = world();
    await w.scheduler.run({ id: 'u1', kind: 'undo-expiry', payload: { threadId: 't1' } });
    await w.scheduler.run({ id: 'r1', kind: 'receipt-final', payload: { threadId: 't2' } });
    await w.scheduler.run({ id: 'bad', kind: 'receipt-final', payload: {} });
    await expect(w.scheduler.run({ id: 'x', kind: 'something-else', payload: {} })).rejects.toThrow(
      'Unsupported scheduled job kind: something-else',
    );
    expect(w.calls).toEqual(['undo:t1', 'receipt:t2']);
  });
  test('the nightly scan runs for everyone with a grant, skips a gone grant, logs a failed person and reschedules itself', async () => {
    const w = world();
    await w.scheduler.run({ id: 'scan:2026-11-04', kind: NIGHTLY, payload: {} });
    expect(w.calls).toEqual(['scan:hillevi', 'scan:hassan']);
    expect(w.logged).toEqual([['scan', 'hassan', expect.any(Error)]]);
    expect(w.jobs.rows.map(r => r.id)).toEqual(['scan:2026-11-05']);
  });
  test('a job’s workflow step waits for the run time, makes an attention batch ready, runs any other kind and completes the attempt it claimed', async () => {
    const w = world();
    const batch = 'automatic:p1:2026-11-04T11:00:00.000Z';
    await w.jobs.schedule({
      id: 'attention:' + batch,
      kind: 'attention-release',
      runAt: '2026-11-04T11:00:00.000Z',
      payload: { batch },
    });
    await w.jobs.schedule({
      id: 'r1',
      kind: 'receipt-final',
      runAt: '2026-11-04T06:00:00.000Z',
      payload: { threadId: 't2' },
    });
    expect(await w.runJob('attention:' + batch)).toBe('busy');
    expect(await w.runJob('r1')).toBe('done');
    w.advance(4 * 3600_000);
    expect(await w.runJob('attention:' + batch)).toBe('done');
    expect(w.calls).toEqual(['receipt:t2', 'release:' + batch]);
    expect(w.jobs.finished).toEqual([
      ['r1', 1],
      ['attention:' + batch, 1],
    ]);
    // A replayed step, or a job the engine does not hold, changes nothing.
    expect(await w.runJob('attention:' + batch)).toBe('done');
    expect(await w.runJob('missing')).toBe('done');
    expect(w.calls).toHaveLength(2);
  });
  test('a job whose run fails is not completed, and its next attempt waits for the lease', async () => {
    const w = world();
    await w.jobs.schedule({ id: 'x', kind: 'something-else', runAt: T0 });
    await expect(w.runJob('x')).rejects.toThrow('Unsupported scheduled job kind');
    expect(await w.runJob('x')).toBe('busy');
    w.advance(120_001);
    await expect(w.runJob('x')).rejects.toThrow('Unsupported scheduled job kind');
    expect(w.jobs.rows[0]).toMatchObject({ status: 'executing', attempts: 2 });
    expect(w.jobs.finished).toEqual([]);
  });
});
