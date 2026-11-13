import { describe, expect, test } from 'bun:test';
import type {
  Execution,
  ExecutionStore,
  Job,
  WatchIntent,
  WorkflowStart,
} from '../apps/server/src/modules/executions/model';
import { executionStart, watchStart } from '../apps/server/src/modules/executions/domain';
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
  approvingSession: null,
  checkingSession: null,
  subject: null,
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
  deliveredAt: job.createdAt,
  lastError: null,
});
/**
 * The ledger's store contract (D45, D86): one suite over the memory adapter and Postgres. `enqueued` reads the workflow
 * starts a commit made under ids with a prefix (the engine's queue rows in Postgres); `watches` the watch intent rows of
 * a job.
 */
export interface ExecutionStoreHarness {
  store: ExecutionStore;
  personId: string;
  auditCount(action?: string): Promise<number>;
  enqueued(prefix: string): Promise<WorkflowStart[]>;
  watches(jobId: string): Promise<WatchIntent[]>;
}
export function executionStoreContract(name: string, create: () => Promise<ExecutionStoreHarness>) {
  describe(name + ' execution store', () => {
    test('concurrent approval identity has one owner, one approval audit and one workflow start', async () => {
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
            await tx.enqueue(executionStart('execution:' + record.id, record.id));
          }
          return saved.execution.id;
        });
      const [x, y] = await Promise.all([reserve(a), reserve(b)]);
      expect(x).toBe(y);
      expect(await w.auditCount()).toBe(1);
      expect(await w.enqueued('execution:' + w.personId)).toEqual([executionStart('execution:' + x, x)]);
    });
    test('rollback leaves no approved action, audit or workflow start', async () => {
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
          await tx.enqueue(executionStart('execution:' + e.id, e.id));
          throw new Error('crash');
        }),
      ).rejects.toThrow('crash');
      expect(await w.store.read(e.id)).toBeUndefined();
      expect(await w.auditCount()).toBe(0);
      expect(await w.enqueued('execution:' + e.id)).toEqual([]);
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
            if (s.inserted) await tx.enqueue(executionStart('execution:' + step.id, step.id));
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
      expect((await w.enqueued('execution:' + w.personId)).map(s => s.input).sort()).toEqual(
        x.steps.flatMap(s => (s.kind === 'execute' ? [s.executionId] : [])).sort(),
      );
      await w.store.transaction(async tx => {
        const j = (await tx.lockJob(x.id))!;
        await tx.updateJob({
          ...j,
          steps: j.steps.map(s => (s.kind === 'watch' ? { ...s, state: 'seen' as const } : s)),
        });
      });
      expect((await w.store.readJob(x.id))?.steps.at(-1)).toMatchObject({ kind: 'watch', state: 'seen' });
    });
    test('a watch intent and its workflow start commit with the job, once, and are gone when the job rolls back', async () => {
      const w = await create(),
        e = executionRecord(w.personId, w.personId + '-watch-step'),
        job = jobRecord(w.personId, w.personId + '-watch-job', [e]),
        intent = watchIntentRecord(job);
      await expect(
        w.store.transaction(async tx => {
          await tx.insert(e);
          await tx.insertJob(job);
          await tx.enqueueWatch(intent);
          await tx.enqueue(watchStart(intent));
          throw new Error('crash');
        }),
      ).rejects.toThrow('crash');
      expect(await w.watches(job.id)).toEqual([]);
      expect(await w.enqueued(intent.id)).toEqual([]);
      await w.store.transaction(async tx => {
        await tx.insert(e);
        await tx.insertJob(job);
        await tx.enqueueWatch(intent);
        await tx.enqueueWatch(intent);
        await tx.enqueue(watchStart(intent));
        await tx.enqueue(watchStart(intent));
      });
      expect(await w.watches(job.id)).toEqual([intent]);
      expect(await w.enqueued(intent.id)).toEqual([watchStart(intent)]);
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
    test("a delegated write's session bindings (D26) survive a round trip, and the checking session is kept alone and rolled back with its transaction", async () => {
      const w = await create(),
        e: Execution = {
          ...executionRecord(w.personId, w.personId + '-sessions'),
          approvingSession: 'synthetic-approving-session',
        };
      await w.store.transaction(async tx => {
        await tx.insert(e);
      });
      expect(await w.store.read(e.id)).toEqual(e);
      expect(await w.store.readDecision(w.personId, e.decisionId)).toEqual(e);
      await w.store.transaction(tx => tx.keepCheckingSession(e.id, 'synthetic-checking-session'));
      expect(await w.store.read(e.id)).toEqual({ ...e, checkingSession: 'synthetic-checking-session' });
      await expect(
        w.store.transaction(async tx => {
          await tx.keepCheckingSession(e.id, 'synthetic-other-session');
          throw new Error('crash');
        }),
      ).rejects.toThrow('crash');
      expect((await w.store.read(e.id))?.checkingSession).toBe('synthetic-checking-session');
      await w.store.transaction(async tx => {
        const row = (await tx.lock(e.id))!;
        expect(row).toMatchObject({
          approvingSession: 'synthetic-approving-session',
          checkingSession: 'synthetic-checking-session',
        });
        await tx.update({ ...row, state: 'unknown', reason: 'needs-session' });
      });
      expect(await w.store.read(e.id)).toEqual({
        ...e,
        state: 'unknown',
        reason: 'needs-session',
        checkingSession: 'synthetic-checking-session',
      });
      expect(await w.auditCount()).toBe(0);
    });
    test('the person a started action is about (D116) survives a round trip, the lock and an update; none stays none', async () => {
      const w = await create(),
        e: Execution = {
          ...executionRecord(w.personId, w.personId + '-subject'),
          payload: { person: 'anna.l', revision: 1 },
          subject: { param: 'person', personId: 'p-anna' },
        };
      await w.store.transaction(async tx => {
        expect((await tx.insert(e)).execution).toEqual(e);
      });
      expect(await w.store.read(e.id)).toEqual(e);
      expect(await w.store.readDecision(w.personId, e.decisionId)).toEqual(e);
      await w.store.transaction(async tx => {
        const row = (await tx.lock(e.id))!;
        expect(row.subject).toEqual({ param: 'person', personId: 'p-anna' });
        await tx.update({ ...row, state: 'failed', reason: 'subject-changed' });
      });
      expect(await w.store.read(e.id)).toEqual({ ...e, state: 'failed', reason: 'subject-changed' });
      const plain = executionRecord(w.personId, w.personId + '-no-subject');
      await w.store.transaction(async tx => {
        await tx.insert({ ...plain, decisionId: 'decision:' + w.personId + ':plain' });
      });
      expect((await w.store.read(plain.id))?.subject).toBeNull();
    });
    test('a workflow start is idempotent by its id: a reconciliation under a new id is a second start, a repeat is none', async () => {
      const w = await create(),
        e = executionRecord(w.personId, w.personId + '-again');
      await w.store.transaction(async tx => {
        await tx.insert(e);
        await tx.enqueue(executionStart('execution:' + e.id, e.id));
      });
      await w.store.transaction(async tx => {
        await tx.enqueue(executionStart('execution:' + e.id, e.id));
        await tx.enqueue(executionStart('reconcile:' + e.id + ':1', e.id));
      });
      expect((await w.enqueued('execution:' + e.id)).map(s => s.id)).toEqual(['execution:' + e.id]);
      expect(await w.enqueued('reconcile:' + e.id)).toEqual([executionStart('reconcile:' + e.id + ':1', e.id)]);
    });
  });
}
