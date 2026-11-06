import { describe, expect, test } from 'bun:test';
import type { Execution, ExecutionStore, Job, WatchIntent } from '../apps/server/src/modules/executions/model';
export const executionRecord = (personId: string, id: string): Execution => ({
  id,
  personId,
  decisionId: 'decision:' + personId,
  principal: 'person:' + personId,
  unitId: 'test',
  authorizationVersion: 'v1',
  connector: 'reference',
  operation: 'reference.complete',
  digest: 'input-digest',
  payload: { ref: 'reference:item:1', revision: 1 },
  safety: { strategy: 'deduplicated', retentionSeconds: 86400, lookup: 'reference.lookup' },
  state: 'pending',
  reason: null,
  result: null,
  compensates: null,
  createdAt: '2099-11-05T10:00:00.000Z',
  updatedAt: '2099-11-05T10:00:00.000Z',
  expiresAt: '2099-11-06T10:00:00.000Z',
  dispatchedAt: null,
  attempt: 0,
  leaseUntil: null,
});
/** A job (D55) over two step executions; the watch step carries the read input a Postgres adapter must seal. */
export const jobRecord = (personId: string, id: string, steps: Execution[]): Job => ({
  id,
  personId,
  decisionId: 'job:' + personId,
  principal: 'person:' + personId,
  unitId: 'test',
  authorizationVersion: 'v1',
  digest: 'job-digest',
  steps: [
    ...steps.map((e, i) => ({
      id: 'step-' + (i + 1),
      kind: 'execute' as const,
      connector: e.connector,
      operation: e.operation,
      executionId: e.id,
    })),
    {
      id: 'watch-1',
      kind: 'watch' as const,
      connector: 'payroll',
      operation: 'payroll.absenceStatus',
      input: { person: 'hr:emp:1004' },
      expect: { path: ['status'], equals: 'registered' },
      checks: ['2099-11-05T14:00:00.000Z'],
      expiresAt: '2099-11-06T10:00:00.000Z',
      title: 'Bevakas i lönesystemet',
      source: 'Lönesystemet',
      state: 'waiting' as const,
      reason: null,
      observations: [],
    },
  ],
  createdAt: '2099-11-05T10:00:00.000Z',
  updatedAt: '2099-11-05T10:00:00.000Z',
});
/** The watch step's timer intent (D47) as the approval commits it beside the job. */
export const watchIntentRecord = (job: Job): WatchIntent => ({
  id: `watch:${job.id}:watch-1`,
  jobId: job.id,
  stepId: 'watch-1',
  personId: job.personId,
  generation: 1,
  checks: ['2099-11-05T14:00:00.000Z'],
  expiresAt: '2099-11-06T10:00:00.000Z',
  attempt: 0,
  leaseUntil: null,
  nextAt: job.createdAt,
  deliveredAt: null,
  lastError: null,
});
export function executionStoreContract(
  name: string,
  create: () => Promise<{ store: ExecutionStore; personId: string; auditCount: (action?: string) => Promise<number> }>,
) {
  describe(name + ' execution store', () => {
    test('concurrent approval identity has one owner, one approval audit and one delivery intent', async () => {
      const w = await create(),
        a = executionRecord(w.personId, w.personId + '-a'),
        b = { ...a, id: w.personId + '-b' };
      const reserve = (record: Execution) =>
        w.store.transaction(async tx => {
          const saved = await tx.insert(record);
          if (saved.inserted) {
            await tx.audit({
              actor: record.principal,
              action: 'execution.approved',
              subject: 'execution:' + record.id,
              at: record.createdAt,
            });
            await tx.enqueue({
              id: record.id,
              executionId: record.id,
              attempt: 0,
              leaseUntil: null,
              nextAt: record.createdAt,
              deliveredAt: null,
              lastError: null,
            });
          }
          return saved.execution.id;
        });
      const [x, y] = await Promise.all([reserve(a), reserve(b)]);
      expect(x).toBe(y);
      expect(await w.auditCount()).toBe(1);
      const claimed = await w.store.claimDispatch(a.createdAt, a.expiresAt);
      expect(claimed?.executionId).toBe(x);
      expect(await w.store.claimDispatch(a.createdAt, a.expiresAt)).toBeUndefined();
    });
    test('rollback leaves no approved action, audit or dispatch intent', async () => {
      const w = await create(),
        e = executionRecord(w.personId, w.personId + '-rollback');
      await expect(
        w.store.transaction(async tx => {
          await tx.insert(e);
          await tx.audit({
            actor: e.principal,
            action: 'execution.approved',
            subject: 'execution:' + e.id,
            at: e.createdAt,
          });
          await tx.enqueue({
            id: e.id,
            executionId: e.id,
            attempt: 0,
            leaseUntil: null,
            nextAt: e.createdAt,
            deliveredAt: null,
            lastError: null,
          });
          throw new Error('crash');
        }),
      ).rejects.toThrow('crash');
      expect(await w.store.read(e.id)).toBeUndefined();
      expect(await w.auditCount()).toBe(0);
      expect(await w.store.claimDispatch(e.createdAt, e.expiresAt)).toBeUndefined();
    });
    test('a job and its step executions are one decision: concurrent approvals keep one job, one job audit and one intent per step', async () => {
      const w = await create();
      const steps = (suffix: string) => [
        { ...executionRecord(w.personId, w.personId + '-s1' + suffix), decisionId: 'job:' + w.personId + ':step-1' },
        {
          ...executionRecord(w.personId, w.personId + '-s2' + suffix),
          decisionId: 'job:' + w.personId + ':step-2',
          connector: 'timesheet',
          operation: 'timesheet.markAbsence',
        },
      ];
      const approve = (suffix: string) =>
        w.store.transaction(async tx => {
          const saved: Execution[] = [];
          for (const step of steps(suffix)) {
            const s = await tx.insert(step);
            saved.push(s.execution);
            if (s.inserted)
              await tx.enqueue({
                id: 'execution:' + step.id,
                executionId: step.id,
                attempt: 0,
                leaseUntil: null,
                nextAt: step.createdAt,
                deliveredAt: null,
                lastError: null,
              });
          }
          const job = await tx.insertJob(jobRecord(w.personId, w.personId + '-job' + suffix, saved));
          if (job.inserted)
            await tx.audit({
              actor: 'person:' + w.personId,
              action: 'job.approved',
              subject: 'job:' + job.job.id,
              at: job.job.createdAt,
            });
          return job.job;
        });
      const [x, y] = await Promise.all([approve('a'), approve('b')]);
      expect(x.id).toBe(y.id);
      expect(x.steps.map(s => (s.kind === 'execute' ? s.executionId : s.id))).toEqual(
        y.steps.map(s => (s.kind === 'execute' ? s.executionId : s.id)),
      );
      expect(await w.auditCount('job.approved')).toBe(1);
      expect(await w.store.readJob(x.id)).toEqual(x);
      const claimed = [
        await w.store.claimDispatch(x.createdAt, '2099-11-07T00:00:00.000Z'),
        await w.store.claimDispatch(x.createdAt, '2099-11-07T00:00:00.000Z'),
      ];
      expect(claimed.map(c => c?.executionId).sort()).toEqual(
        x.steps.flatMap(s => (s.kind === 'execute' ? [s.executionId] : [])).sort(),
      );
      expect(await w.store.claimDispatch(x.createdAt, '2099-11-07T00:00:00.000Z')).toBeUndefined();
      await w.store.transaction(async tx => {
        const j = (await tx.lockJob(x.id))!;
        await tx.updateJob({
          ...j,
          steps: j.steps.map(s => (s.kind === 'watch' ? { ...s, state: 'seen' as const } : s)),
        });
      });
      expect((await w.store.readJob(x.id))?.steps.at(-1)).toMatchObject({ kind: 'watch', state: 'seen' });
    });
    test('a watch intent commits with its job, is delivered once under a lease, and is gone when the job rolls back', async () => {
      const w = await create(),
        e = executionRecord(w.personId, w.personId + '-watch-step'),
        job = jobRecord(w.personId, w.personId + '-watch-job', [e]),
        intent = watchIntentRecord(job);
      await expect(
        w.store.transaction(async tx => {
          await tx.insert(e);
          await tx.insertJob(job);
          await tx.enqueueWatch(intent);
          throw new Error('crash');
        }),
      ).rejects.toThrow('crash');
      expect(await w.store.claimWatch(job.createdAt, '2099-11-07T00:00:00.000Z')).toBeUndefined();
      await w.store.transaction(async tx => {
        await tx.insert(e);
        await tx.insertJob(job);
        await tx.enqueueWatch(intent);
        await tx.enqueueWatch(intent);
      });
      expect(await w.store.claimWatch('2099-11-05T09:59:00.000Z', '2099-11-07T00:00:00.000Z')).toBeUndefined();
      const first = await w.store.claimWatch(job.createdAt, job.createdAt);
      expect(first).toMatchObject({
        id: intent.id,
        jobId: job.id,
        stepId: 'watch-1',
        checks: intent.checks,
        expiresAt: intent.expiresAt,
        attempt: 1,
      });
      const second = await w.store.claimWatch(job.createdAt, '2099-11-07T00:00:00.000Z');
      expect(second?.attempt).toBe(2);
      await w.store.finishWatch(intent.id, first!.attempt, job.createdAt, job.createdAt);
      expect(await w.store.claimWatch(job.createdAt, '2099-11-07T00:00:00.000Z')).toBeUndefined();
      await w.store.finishWatch(intent.id, second!.attempt, job.createdAt, job.createdAt, 'retry');
      expect((await w.store.claimWatch(job.createdAt, '2099-11-07T00:00:00.000Z'))?.attempt).toBe(3);
      await w.store.finishWatch(intent.id, 3, job.createdAt, job.createdAt);
      expect(await w.store.claimWatch('2099-11-08T00:00:00.000Z', '2099-11-09T00:00:00.000Z')).toBeUndefined();
    });
    test('rollback leaves no job', async () => {
      const w = await create(),
        e = executionRecord(w.personId, w.personId + '-job-rollback-step');
      await expect(
        w.store.transaction(async tx => {
          await tx.insert(e);
          await tx.insertJob(jobRecord(w.personId, w.personId + '-job-rollback', [e]));
          throw new Error('crash');
        }),
      ).rejects.toThrow('crash');
      expect(await w.store.readJob(w.personId + '-job-rollback')).toBeUndefined();
      expect(await w.store.read(e.id)).toBeUndefined();
    });
    test('an expired delivery lease is reclaimed and an older acknowledgement cannot release it', async () => {
      const w = await create(),
        e = executionRecord(w.personId, w.personId + '-lease');
      await w.store.transaction(async tx => {
        await tx.insert(e);
        await tx.enqueue({
          id: e.id,
          executionId: e.id,
          attempt: 0,
          leaseUntil: null,
          nextAt: e.createdAt,
          deliveredAt: null,
          lastError: null,
        });
      });
      const first = await w.store.claimDispatch(e.createdAt, e.createdAt);
      const second = await w.store.claimDispatch(e.createdAt, e.expiresAt);
      expect(second?.attempt).toBe(first!.attempt + 1);
      await w.store.finishDispatch(e.id, first!.attempt, e.createdAt, e.createdAt);
      expect(await w.store.claimDispatch(e.createdAt, e.expiresAt)).toBeUndefined();
      await w.store.finishDispatch(e.id, second!.attempt, e.createdAt, e.createdAt, 'retry');
      expect((await w.store.claimDispatch(e.createdAt, e.expiresAt))?.attempt).toBe(second!.attempt + 1);
    });
  });
}
