import { describe, expect, test } from 'bun:test';
import type { AuthenticatedContext } from '../../packages/contracts/src/index';
import type { Job, JobQueue } from '../../apps/server/src/scheduler/model';
import { createScheduler, NIGHTLY } from '../../apps/server/src/scheduler/usecases';

/** The Postgres-backed scheduler (D15) driven by hand (D25): a queue in memory, use cases that only record what they were asked. */
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
function memoryQueue() {
  const rows: Array<Job & { runAt: string; status: 'due' | 'running' | 'done' | 'failed'; error?: string }> = [];
  const queue: JobQueue & { rows: typeof rows } = {
    rows,
    async claim(now) {
      const job = rows
        .filter(r => r.status === 'due' && r.runAt <= now)
        .sort((a, b) => a.runAt.localeCompare(b.runAt))[0];
      if (!job) return undefined;
      job.status = 'running';
      return { id: job.id, kind: job.kind, payload: job.payload };
    },
    async finish(id, error) {
      const job = rows.find(r => r.id === id)!;
      job.status = error ? 'failed' : 'done';
      job.error = error;
    },
    async schedule(job) {
      if (!rows.some(r => r.id === job.id)) rows.push({ ...job, payload: job.payload ?? {}, status: 'due' });
    },
  };
  return queue;
}
function world() {
  const jobs = memoryQueue(),
    calls: string[] = [],
    logged: unknown[][] = [];
  let time = Date.parse(T0);
  const scheduler = createScheduler({
    jobs,
    clock: () => new Date(time),
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
        if (id === 'explode') throw new Error('kaboom');
        calls.push('undo:' + id);
      },
    },
  });
  return {
    jobs,
    calls,
    logged,
    scheduler,
    advance: (ms: number) => {
      time += ms;
    },
  };
}

describe('the scheduler', () => {
  test('schedules the nightly scan at the next 06:00 Stockholm, once per date', async () => {
    const w = world();
    await w.scheduler.scheduleNightly();
    await w.scheduler.scheduleNightly();
    expect(w.jobs.rows).toEqual([
      { id: 'scan:2026-11-05', kind: NIGHTLY, runAt: '2026-11-05T05:00:00.000Z', payload: {}, status: 'due' },
    ]);
  });
  test('a tick runs what is due, in order, finishes each job and never lets one failure stop the rest', async () => {
    const w = world();
    await w.jobs.schedule({
      id: 'u1',
      kind: 'undo-expiry',
      runAt: '2026-11-04T06:30:00.000Z',
      payload: { threadId: 't1' },
    });
    await w.jobs.schedule({
      id: 'r1',
      kind: 'receipt-final',
      runAt: '2026-11-04T06:00:00.000Z',
      payload: { threadId: 't2' },
    });
    await w.jobs.schedule({ id: 'bad', kind: 'receipt-final', runAt: '2026-11-04T06:10:00.000Z', payload: {} });
    await w.jobs.schedule({
      id: 'boom',
      kind: 'undo-expiry',
      runAt: '2026-11-04T06:20:00.000Z',
      payload: { threadId: 'explode' },
    });
    await w.jobs.schedule({
      id: 'later',
      kind: 'receipt-final',
      runAt: '2026-11-04T08:00:00.000Z',
      payload: { threadId: 't3' },
    });
    await w.scheduler.tick();
    expect(w.calls).toEqual(['receipt:t2', 'undo:t1']);
    expect(w.jobs.rows.map(r => [r.id, r.status, r.error])).toEqual([
      ['u1', 'done', undefined],
      ['r1', 'done', undefined],
      ['bad', 'done', undefined],
      ['boom', 'failed', 'kaboom'],
      ['later', 'due', undefined],
    ]);
    w.advance(2 * 3600_000);
    await w.scheduler.tick();
    expect(w.calls.at(-1)).toBe('receipt:t3');
    expect(w.jobs.rows.find(r => r.id === 'later')!.status).toBe('done');
  });
  test('the nightly scan runs for everyone with a grant, skips a gone grant, logs a failed person and reschedules itself', async () => {
    const w = world();
    await w.jobs.schedule({ id: 'scan:2026-11-04', kind: NIGHTLY, runAt: '2026-11-04T05:00:00.000Z' });
    await w.scheduler.tick();
    expect(w.calls).toEqual(['scan:hillevi', 'scan:hassan']);
    expect(w.logged).toEqual([['scan', 'hassan', expect.any(Error)]]);
    expect(w.jobs.rows.map(r => [r.id, r.status])).toEqual([
      ['scan:2026-11-04', 'done'],
      ['scan:2026-11-05', 'due'],
    ]);
  });
});
