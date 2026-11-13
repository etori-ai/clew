import { describe, expect, test } from 'bun:test';
import type { AuthenticatedContext } from '../../packages/contracts/src/index';
import {
  JOB_LEASE_MS,
  JOB_RUN_LONG_MS,
  type Job,
  type JobExecutions,
  type JobQueue,
} from '../../apps/server/src/scheduler/model';
import {
  createScheduler,
  NIGHTLY,
  SCAN_PAGE,
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
/** The job table as the engine sees it: a row is claimed once its run time has come, under the lease, which its run renews. */
function memoryJobs() {
  const rows: Row[] = [];
  const finished: Array<[string, number]> = [];
  let renewFails = false;
  const holds = (row: Row | undefined, attempt: number): row is Row =>
    !!row && row.status === 'executing' && row.attempts === attempt;
  const queue: JobQueue &
    JobExecutions & { rows: Row[]; finished: typeof finished; failRenewal: (fails: boolean) => void } = {
    rows,
    finished,
    failRenewal: fails => {
      renewFails = fails;
    },
    async schedule(job) {
      if (!rows.some(r => r.id === job.id))
        rows.push({ ...job, payload: job.payload ?? {}, status: 'temporal', attempts: 0 });
    },
    async claimExecution(id, at) {
      const row = rows.find(r => r.id === id);
      if (!row || row.status === 'done') return undefined;
      if (row.runAt > at || (row.status === 'executing' && row.leaseUntil! > at)) return 'busy';
      Object.assign(row, {
        status: 'executing',
        attempts: row.attempts + 1,
        leaseUntil: new Date(Date.parse(at) + JOB_LEASE_MS).toISOString(),
      });
      return { id, kind: row.kind, payload: row.payload, attempt: row.attempts };
    },
    async renew(id, attempt, at) {
      if (renewFails) throw new Error('database unavailable');
      const row = rows.find(r => r.id === id);
      if (!holds(row, attempt)) return false;
      row.leaseUntil = new Date(Date.parse(at) + JOB_LEASE_MS).toISOString();
      return true;
    },
    async completed(id, attempt) {
      const row = rows.find(r => r.id === id);
      if (!holds(row, attempt)) return false;
      row.status = 'done';
      finished.push([id, attempt]);
      return true;
    },
  };
  return queue;
}
/** The runner's repeating timer, fired by hand: `fire` runs every tick still running and lets what they started settle. */
function manualTimer() {
  const running = new Set<{ ms: number; tick: () => void }>();
  return {
    every(ms: number, tick: () => void) {
      const timer = { ms, tick };
      running.add(timer);
      return () => void running.delete(timer);
    },
    intervals: () => [...running].map(t => t.ms),
    async fire() {
      for (const timer of [...running]) timer.tick();
      await settle();
    },
  };
}
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
function world(granted = ['hillevi', 'gone', 'hassan']) {
  const jobs = memoryJobs(),
    timer = manualTimer(),
    calls: string[] = [],
    logged: unknown[][] = [],
    gates = new Map<string, Promise<void>>();
  let time = Date.parse(T0);
  let cleanupFails = false;
  const clock = () => new Date(time);
  // The people with a grant, in id order, a page at a time as the store reads them.
  const sorted = [...granted].sort();
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
      granted: async ({ after, limit }) => sorted.filter(id => after === undefined || id > after).slice(0, limit),
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
      // An undo window whose thread has a gate closes when the test opens it: a run that lasts.
      closeUndoWindow: async id => {
        calls.push('undo:' + id);
        await gates.get(id);
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
    every: timer.every,
    log: (...args) => logged.push(args),
  });
  return {
    jobs,
    timer,
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
    /** Holds the undo window of `threadId` open until the function it returns is called. */
    gate: (threadId: string) => {
      let open = () => undefined as void;
      gates.set(
        threadId,
        new Promise<void>(resolve => {
          open = resolve;
        }),
      );
      return () => open();
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
    expect(w.calls).toEqual(['scan:hassan', 'scan:hillevi']);
    expect(w.logged).toEqual([['scan', 'hassan', expect.any(Error)]]);
    expect(w.jobs.rows.map(r => r.id)).toEqual(['scan:2026-11-05']);
  });
  test('every process schedules both nights when it starts, the scan at 06:00 and the clean-up at 03:00 Stockholm, once per date', async () => {
    const w = world();
    await w.scheduler.scheduleNights();
    await w.scheduler.scheduleNights();
    expect(w.jobs.rows).toEqual([
      {
        id: 'scan:2026-11-05',
        kind: NIGHTLY,
        runAt: '2026-11-05T05:00:00.000Z',
        payload: {},
        status: 'temporal',
        attempts: 0,
      },
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
  test('the nightly scan runs a page at a time, each page a job of its own, and only the first page schedules the next night', async () => {
    const people = Array.from({ length: 2 * SCAN_PAGE + 1 }, (_, i) => 'p' + String(i).padStart(4, '0'));
    const w = world(people);
    await w.jobs.schedule({ id: 'scan:2026-11-04', kind: NIGHTLY, runAt: '2026-11-04T05:00:00.000Z' });
    expect(await w.runJob('scan:2026-11-04')).toBe('done');
    // The first page: the next night, then the first page of people, then the next page to run at once.
    expect(w.calls).toEqual(people.slice(0, SCAN_PAGE).map(id => 'scan:' + id));
    expect(w.jobs.rows.map(r => [r.id, r.status, r.runAt, r.payload])).toEqual([
      ['scan:2026-11-04', 'done', '2026-11-04T05:00:00.000Z', {}],
      ['scan:2026-11-05', 'temporal', '2026-11-05T05:00:00.000Z', {}],
      ['scan:2026-11-04:2', 'temporal', T0, { night: 'scan:2026-11-04', page: 2, after: people[SCAN_PAGE - 1] }],
    ]);
    w.advance(10_000);
    expect(await w.runJob('scan:2026-11-04:2')).toBe('done');
    // A page run again, as after a failure, scans its own people again and schedules the same next page.
    await w.scheduler.run({ id: 'scan:2026-11-04:2', kind: NIGHTLY, payload: w.jobs.rows[2]!.payload });
    expect(w.calls.slice(SCAN_PAGE)).toEqual(
      [...people.slice(SCAN_PAGE, 2 * SCAN_PAGE), ...people.slice(SCAN_PAGE, 2 * SCAN_PAGE)].map(id => 'scan:' + id),
    );
    expect(await w.runJob('scan:2026-11-04:3')).toBe('done');
    // The last page is not full and ends the night: everyone was scanned, and the next night is scheduled once.
    expect(new Set(w.calls)).toEqual(new Set(people.map(id => 'scan:' + id)));
    expect(w.calls.at(-1)).toBe('scan:' + people.at(-1));
    expect(w.jobs.rows.map(r => [r.id, r.status])).toEqual([
      ['scan:2026-11-04', 'done'],
      ['scan:2026-11-05', 'temporal'],
      ['scan:2026-11-04:2', 'done'],
      ['scan:2026-11-04:3', 'done'],
    ]);
    expect(w.jobs.rows[3]!.payload).toEqual({ night: 'scan:2026-11-04', page: 3, after: people[2 * SCAN_PAGE - 1] });
    expect(w.logged).toEqual([]);
  });
  test('a run that outlasts its lease keeps its claim: the workflow’s next attempt finds the job claimed, and it runs and completes once', async () => {
    const w = world();
    const open = w.gate('slow');
    await w.jobs.schedule({ id: 'u', kind: 'undo-expiry', runAt: T0, payload: { threadId: 'slow' } });
    const first = w.runJob('u');
    await settle();
    expect(w.timer.intervals()).toEqual([JOB_LEASE_MS / 4]);
    // Three minutes on the clock, renewed at every quarter of the lease.
    for (let quarter = 0; quarter < 6; quarter++) {
      w.advance(JOB_LEASE_MS / 4);
      await w.timer.fire();
    }
    const next = w.runJob('u');
    open();
    expect(await next).toBe('busy');
    expect(await first).toBe('done');
    expect(w.calls).toEqual(['undo:slow']);
    expect(w.jobs.rows[0]).toMatchObject({ status: 'done', attempts: 1 });
    expect(w.jobs.finished).toEqual([['u', 1]]);
    // The renewal ends with the run.
    expect(w.timer.intervals()).toEqual([]);
    expect(w.logged).toEqual([]);
  });
  test('a run that lasts ten minutes is said once, with the job and the attempt, and keeps its claim until it settles', async () => {
    const w = world();
    const open = w.gate('hung');
    await w.jobs.schedule({ id: 'u', kind: 'undo-expiry', runAt: T0, payload: { threadId: 'hung' } });
    const first = w.runJob('u');
    await settle();
    // Renewed at every quarter of the lease, and nothing said, until the run has lasted ten minutes.
    for (let lasted = JOB_LEASE_MS / 4; lasted < JOB_RUN_LONG_MS; lasted += JOB_LEASE_MS / 4) {
      w.advance(JOB_LEASE_MS / 4);
      await w.timer.fire();
    }
    expect(w.logged).toEqual([]);
    w.advance(JOB_LEASE_MS / 4);
    await w.timer.fire();
    const long = [
      'scheduled job still running after ten minutes; it holds its claim until the run settles or its process stops',
      'u',
      1,
    ];
    expect(w.logged).toEqual([long]);
    // Said once: the claim is still renewed, so the workflow's next attempt finds the job claimed.
    for (let quarter = 0; quarter < 8; quarter++) {
      w.advance(JOB_LEASE_MS / 4);
      await w.timer.fire();
    }
    expect(await w.runJob('u')).toBe('busy');
    open();
    expect(await first).toBe('done');
    expect(w.jobs.finished).toEqual([['u', 1]]);
    expect(w.timer.intervals()).toEqual([]);
    expect(w.logged).toEqual([long]);
  });
  test('a renewal that fails is said and tried again at the next quarter, and the run completes', async () => {
    const w = world();
    const open = w.gate('slow');
    await w.jobs.schedule({ id: 'u', kind: 'undo-expiry', runAt: T0, payload: { threadId: 'slow' } });
    const first = w.runJob('u');
    await settle();
    w.jobs.failRenewal(true);
    w.advance(JOB_LEASE_MS / 4);
    await w.timer.fire();
    w.jobs.failRenewal(false);
    w.advance(JOB_LEASE_MS / 4);
    await w.timer.fire();
    w.advance(JOB_LEASE_MS / 2);
    const next = w.runJob('u');
    open();
    expect(await next).toBe('busy');
    expect(await first).toBe('done');
    expect(w.jobs.finished).toEqual([['u', 1]]);
    expect(w.logged).toEqual([['scheduled job claim not renewed', 'u', new Error('database unavailable')]]);
  });
  test('a run whose claim was taken all the same, after its process stood still past the lease, says so, and only the attempt that holds the job completes it', async () => {
    const w = world();
    const open = w.gate('stalled');
    await w.jobs.schedule({ id: 'u', kind: 'undo-expiry', runAt: T0, payload: { threadId: 'stalled' } });
    const first = w.runJob('u');
    await settle();
    // No renewal ran while the process stood still, and the job's workflow claimed it again elsewhere.
    w.advance(JOB_LEASE_MS + 1);
    const second = w.runJob('u');
    await settle();
    expect(w.jobs.rows[0]).toMatchObject({ status: 'executing', attempts: 2 });
    await w.timer.fire();
    expect(w.logged).toEqual([['scheduled job lost its claim while it ran', 'u', 1]]);
    open();
    expect(await first).toBe('done');
    expect(await second).toBe('done');
    expect(w.jobs.finished).toEqual([['u', 2]]);
    expect(w.logged).toEqual([
      ['scheduled job lost its claim while it ran', 'u', 1],
      ['scheduled job finished after another attempt took it; its completion is not recorded', 'u', 1],
    ]);
    expect(w.timer.intervals()).toEqual([]);
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
  test('a job whose run fails is not completed, its claim is no longer renewed, and its next attempt waits for the lease', async () => {
    const w = world();
    await w.jobs.schedule({ id: 'x', kind: 'something-else', runAt: T0 });
    await expect(w.runJob('x')).rejects.toThrow('Unsupported scheduled job kind');
    expect(w.timer.intervals()).toEqual([]);
    expect(await w.runJob('x')).toBe('busy');
    w.advance(JOB_LEASE_MS + 1);
    await expect(w.runJob('x')).rejects.toThrow('Unsupported scheduled job kind');
    expect(w.jobs.rows[0]).toMatchObject({ status: 'executing', attempts: 2 });
    expect(w.jobs.finished).toEqual([]);
  });
});
