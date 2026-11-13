import { afterAll, expect, test } from 'bun:test';
import { randomUUID, randomBytes } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { database, schema } from '../../packages/db/src/index';
import { postgresExecutionStore } from '../../apps/server/src/modules/executions/adapters/postgres';
import { sealSecret, openSecret } from '../../apps/server/src/auth-crypto';
import { executionRecord, executionStoreContract, jobRecord, watchIntentRecord } from '../execution-store-contract';
import { projectExecution } from '../../apps/server/src/composition/execution-projection';
import { watchCardSink } from '../../apps/server/src/composition/watch-card';
import { executionUsecases } from '../../apps/server/src/modules/executions/usecases';
import { jobUsecases } from '../../apps/server/src/modules/jobs/usecases';
import { postgresFollowBindingStore } from '../../apps/server/src/modules/jobs/adapters/postgres';
import type { AuthenticatedContext } from '../../packages/contracts/src/index';
import { enqueuedWorkflows, forgetTestWorkflows, testDurable } from './durable';
process.env.MASTER_KEY ??= randomBytes(32).toString('base64');
const sealer = { seal: sealSecret, open: openSecret };
const people: string[] = [];
const make = async () => {
  const personId = 'exec-test-' + randomUUID();
  people.push(personId);
  await database()
    .insert(schema.people)
    .values({ id: personId, organisationId: 'test', name: 'Synthetic execution test' });
  const store = postgresExecutionStore(sealer, testDurable);
  return {
    personId,
    store,
    auditCount: async (action = 'execution.approved') =>
      (
        await database()
          .select()
          .from(schema.audit)
          .where(and(eq(schema.audit.actor, 'person:' + personId), eq(schema.audit.action, action)))
      ).length,
    enqueued: async (prefix: string) =>
      (await enqueuedWorkflows(prefix)).map(({ workflow, id, input }) => ({ workflow, id, input })),
    watches: async (jobId: string) =>
      (await database().select().from(schema.watchIntents).where(eq(schema.watchIntents.jobId, jobId))).map(r => ({
        ...r,
        expiresAt: r.expiresAt.toISOString(),
        nextAt: r.nextAt.toISOString(),
        leaseUntil: r.leaseUntil?.toISOString() ?? null,
        deliveredAt: r.deliveredAt?.toISOString() ?? null,
      })),
  };
};
executionStoreContract('postgres', make);
test('approved input and source evidence are sealed and survive a new adapter instance', async () => {
  const w = await make(),
    e = executionRecord(w.personId, w.personId + '-sealed');
  e.result = {
    headline: 'Sensitive synthetic evidence',
    rows: [{ ref: 'private-ref', label: 'Sensitive label', detail: 'Sensitive detail', outcome: 'done' }],
  };
  await w.store.transaction(tx => tx.insert(e));
  const [raw] = await database().select().from(schema.executions).where(eq(schema.executions.id, e.id));
  expect(raw!.payload).not.toContain('reference:item:1');
  expect(raw!.result).not.toContain('Sensitive');
  const restarted = postgresExecutionStore(sealer, testDurable);
  expect(await restarted.read(e.id)).toEqual(e);
});
test('the session bindings of a delegated write are sealed to their row and role and survive a new adapter instance (D26)', async () => {
  const w = await make(),
    e = { ...executionRecord(w.personId, w.personId + '-sealed-sessions'), approvingSession: 'synthetic-digest-a' };
  await w.store.transaction(tx => tx.insert(e));
  await w.store.transaction(tx => tx.keepCheckingSession(e.id, 'synthetic-digest-b'));
  const [raw] = await database().select().from(schema.executions).where(eq(schema.executions.id, e.id));
  expect(raw!.approvingSession).not.toContain('synthetic-digest');
  expect(raw!.checkingSession).not.toContain('synthetic-digest');
  expect(await postgresExecutionStore(sealer, testDurable).read(e.id)).toEqual({
    ...e,
    checkingSession: 'synthetic-digest-b',
  });
  // A sealed binding copied onto another row or role does not open there.
  await database()
    .update(schema.executions)
    .set({ checkingSession: raw!.approvingSession })
    .where(eq(schema.executions.id, e.id));
  await expect(w.store.read(e.id)).rejects.toThrow();
});
test("a job's steps are sealed and survive a new adapter instance", async () => {
  const w = await make(),
    e = executionRecord(w.personId, w.personId + '-job-step'),
    job = jobRecord(w.personId, w.personId + '-sealed-job', [e]);
  await w.store.transaction(async tx => {
    await tx.insert(e);
    await tx.insertJob(job);
  });
  const [raw] = await database().select().from(schema.executionJobs).where(eq(schema.executionJobs.id, job.id));
  expect(raw!.steps).not.toContain('hr:emp:1004');
  expect(raw!.steps).not.toContain('registered');
  expect(await postgresExecutionStore(sealer, testDurable).readJob(job.id)).toEqual(job);
});
test('approval, card state and outcome are atomic; an uncertain undo preserves the original receipt', async () => {
  const w = await make(),
    at = '2099-11-05T10:00:00.000Z',
    threadId = w.personId + '-card';
  await database()
    .insert(schema.threads)
    .values({
      id: threadId,
      personId: w.personId,
      kind: 'pushed',
      topic: threadId,
      title: 'Synthetic card',
      connector: 'reference',
      area: 'reference',
      trigger: { reason: 'Test', source: 'Test', at },
      createdAt: new Date(at),
      updatedAt: new Date(at),
    });
  // A reference card has no invitation on its way to anyone (M1): nobody is asked whom they manage.
  const store = postgresExecutionStore(
    sealer,
    testDurable,
    projectExecution(testDurable, async () => new Map()),
  );
  const persona: AuthenticatedContext = {
    id: w.personId,
    name: 'Test',
    unitId: 'test',
    unitLabel: 'Test',
    role: 'manager',
    organisationId: 'test',
    principal: { id: 'person:' + w.personId, kind: 'person' },
    capabilities: [],
    authorizationVersion: 'v1',
    sessionBinding: 'test',
    expiresAt: '2100-01-01',
    authorize: async () => ({ version: 'v1' }),
  };
  const uc = executionUsecases({
    store,
    clock: () => new Date(at),
    ids: randomUUID,
    digest: JSON.stringify,
    source: {
      authorize: async () => ({ connector: 'reference', safety: { strategy: 'manual' }, needsSession: false }),
      current: async () => persona,
      execute: async (_, e) => {
        if (e.compensates) throw new Error('lost undo response');
        return {
          headline: 'Confirmed',
          rows: [{ ref: 'item:1', label: 'Synthetic item', outcome: 'done', detail: 'Read back' }],
          undoCapability: 'reference.undo',
          undoMinutes: 10,
        };
      },
      lookup: async () => undefined,
    },
  });
  const input = {
    decisionId: 'card:' + threadId,
    operation: 'reference.complete',
    payload: { refs: ['item:1'] },
    presentation: { threadId, actionId: 'complete', version: at },
  };
  await expect(
    uc.approve(persona, { ...input, presentation: { ...input.presentation, version: '2000-01-01T00:00:00Z' } }),
  ).rejects.toThrow('Ärendet har ändrats');
  expect(
    (await database().select().from(schema.executions).where(eq(schema.executions.personId, w.personId))).length,
  ).toBe(0);
  const approved = await uc.approve(persona, input);
  const card = async () => (await database().select().from(schema.threads).where(eq(schema.threads.id, threadId)))[0]!;
  expect((await card()).execution?.id).toBe(approved.id);
  expect((await card()).receipt).toBeNull();
  await uc.progress(approved.id);
  const original = (await card()).receipt;
  expect(original?.rows[0]?.outcome).toBe('done');
  expect((await card()).state).toBe('handled');
  const undo = await uc.approve(persona, {
    ...input,
    decisionId: 'undo:' + approved.id,
    operation: 'reference.undo',
    compensates: approved.id,
  });
  await uc.progress(undo.id);
  expect((await card()).execution?.state).toBe('unknown');
  expect((await card()).receipt).toEqual(original);
  expect((await card()).state).toBe('handled');
  expect((await store.read(approved.id))?.state).toBe('succeeded');
  await database()
    .delete(schema.audit)
    .where(eq(schema.audit.subject, 'thread:' + threadId));
  await database().delete(schema.threads).where(eq(schema.threads.id, threadId));
});
test('a watch step that ends unseen leaves one card, one admitted delivery and its audit in the same commit as the settlement', async () => {
  const w = await make(),
    e = executionRecord(w.personId, w.personId + '-expired-step'),
    job = jobRecord(w.personId, w.personId + '-expired-job', [e]);
  const store = postgresExecutionStore(sealer, testDurable, {
    pushCard: watchCardSink(() => ({ source: 'Lönesystemet', area: 'lon' }), testDurable),
  });
  await store.transaction(async tx => {
    await tx.insert(e);
    await tx.insertJob(job);
    await tx.enqueueWatch(watchIntentRecord(job));
  });
  const persona: AuthenticatedContext = {
    id: w.personId,
    name: 'Test',
    unitId: 'test',
    unitLabel: 'Test',
    role: 'manager',
    organisationId: 'test',
    principal: { id: 'person:' + w.personId, kind: 'person' },
    capabilities: [],
    authorizationVersion: 'v1',
    sessionBinding: 'test',
    expiresAt: '2100-01-01',
    authorize: async () => ({ version: 'v1' }),
  };
  let reads = 0;
  const uc = executionUsecases({
    store,
    clock: () => new Date('2099-11-06T10:00:00.000Z'),
    ids: randomUUID,
    digest: JSON.stringify,
    source: {
      authorize: async () => ({ connector: 'reference', safety: { strategy: 'manual' }, needsSession: false }),
      current: async () => persona,
      execute: async () => {
        throw new Error('never');
      },
      lookup: async () => undefined,
    },
    watch: {
      authorize: async () => ({ connector: 'payroll' }),
      read: async () => {
        reads++;
        return { status: 'pending' };
      },
    },
  });
  expect(await uc.observe(job.id, 'watch-1', 0)).toBe('expired');
  expect(reads).toBe(0);
  const threadId = `watch:${job.id}:watch-1`;
  const [card] = await database().select().from(schema.threads).where(eq(schema.threads.id, threadId));
  expect(card).toMatchObject({
    personId: w.personId,
    kind: 'pushed',
    connector: 'payroll',
    area: 'lon',
    title: 'Lönesystemet har inte visat det som bevakades',
    state: 'open',
  });
  expect(card!.trigger.source).toBe('Lönesystemet');
  expect(
    (await database().select().from(schema.deliveries).where(eq(schema.deliveries.threadId, threadId))).length,
  ).toBe(1);
  expect(
    (await database().select().from(schema.threadMessages).where(eq(schema.threadMessages.threadId, threadId))).length,
  ).toBe(1);
  expect(
    (
      await database()
        .select()
        .from(schema.audit)
        .where(and(eq(schema.audit.subject, 'thread:' + threadId), eq(schema.audit.action, 'thread.pushed')))
    ).length,
  ).toBe(1);
  expect(
    (
      await database()
        .select()
        .from(schema.audit)
        .where(and(eq(schema.audit.subject, 'job:' + job.id), eq(schema.audit.action, 'job.watch_expired')))
    ).length,
  ).toBe(1);
  expect(await uc.observe(job.id, 'watch-1', 1)).toBe('expired');
  expect((await database().select().from(schema.threads).where(eq(schema.threads.id, threadId))).length).toBe(1);
  expect(
    (
      await database()
        .select()
        .from(schema.audit)
        .where(and(eq(schema.audit.subject, 'job:' + job.id), eq(schema.audit.action, 'job.watch_expired')))
    ).length,
  ).toBe(1);
  // A store the composition root has not given a card sink refuses to settle silently; the step stays waiting for a retry.
  const silent = postgresExecutionStore(sealer, testDurable),
    w2 = await make(),
    e2 = executionRecord(w2.personId, w2.personId + '-silent-step');
  const other = jobRecord(w2.personId, w2.personId + '-silent-job', [e2]);
  await silent.transaction(async tx => {
    await tx.insert(e2);
    await tx.insertJob(other);
  });
  await expect(
    executionUsecases({
      store: silent,
      clock: () => new Date('2099-11-06T10:00:00.000Z'),
      ids: randomUUID,
      digest: JSON.stringify,
      source: {
        authorize: async () => ({ connector: 'reference', safety: { strategy: 'manual' }, needsSession: false }),
        current: async () => ({ ...persona, id: w2.personId }),
        execute: async () => {
          throw new Error('never');
        },
        lookup: async () => undefined,
      },
    }).observe(other.id, 'watch-1', 0),
  ).rejects.toThrow('No card sink');
  expect((await silent.readJob(other.id))?.steps.at(-1)).toMatchObject({ kind: 'watch', state: 'waiting' });
  await database()
    .delete(schema.audit)
    .where(eq(schema.audit.subject, 'thread:' + threadId));
});

test('job approval retries survive adapter restart with one schedule, and receipts retain their producing authority', async () => {
  const w = await make();
  let now = Date.parse('2099-11-05T10:00:00.000Z'),
    writes = 0;
  const persona: AuthenticatedContext = {
    id: w.personId,
    name: 'Test',
    unitId: 'test',
    unitLabel: 'Test',
    role: 'manager',
    organisationId: 'test',
    principal: { id: 'person:' + w.personId, kind: 'person' },
    capabilities: ['admin.connectors'],
    authorizationVersion: 'v1',
    sessionBinding: 'test',
    expiresAt: '2100-01-01',
    authorize: async () => ({ version: 'v1' }),
  };
  const fact = { kind: 'reference:job-' + randomUUID(), attributes: { ref: 'synthetic:item' } };
  const stack = () => {
    const store = postgresExecutionStore(sealer, testDurable);
    const clock = () => new Date(now);
    const ledger = executionUsecases({
      store,
      clock,
      ids: randomUUID,
      digest: JSON.stringify,
      source: {
        authorize: async () => ({ connector: 'reference', safety: { strategy: 'manual' }, needsSession: false }),
        current: async () => persona,
        execute: async () => {
          writes++;
          return {
            headline: 'Confirmed',
            rows: [{ ref: 'synthetic:item', label: 'Item', detail: 'Read back', outcome: 'done' }],
          };
        },
        lookup: async () => undefined,
      },
      watch: { authorize: async () => ({ connector: 'reference' }), read: async () => ({ status: 'pending' }) },
    });
    const jobs = jobUsecases({
      bindings: postgresFollowBindingStore(),
      clock,
      ids: randomUUID,
      digest: JSON.stringify,
      refresh: async () => {},
      offered: () => true,
      followers: () => [
        {
          name: 'reference.follow',
          connectorId: 'reference',
          source: 'Testsystemet',
          follows: [fact.kind],
          available: true,
        },
      ],
      ledger,
    });
    return { store, ledger, jobs };
  };
  const first = stack();
  const binding = await first.jobs.bind(persona, {
    kind: fact.kind,
    capability: 'reference.follow',
    audience: { mode: 'all' },
    within: 'PT1H',
  });
  try {
    const proposal = await first.jobs.assemble(
      persona,
      fact,
      async <O>() =>
        ({
          steps: [
            {
              kind: 'execute',
              operation: 'reference.complete',
              payload: { ref: 'synthetic:item', revision: 'r1' },
              title: 'Registrera',
            },
            {
              kind: 'watch',
              operation: 'reference.status',
              input: { ref: 'synthetic:item' },
              expect: { path: ['status'], equals: 'done' },
              within: 'P1D',
              title: 'Bevaka',
            },
          ],
        }) as O,
    );
    const input = { decisionId: 'restart-job', proposal };
    const approved = (await first.jobs.approve(persona, input)) as Awaited<ReturnType<typeof first.ledger.approveJob>>;
    const before = (await first.store.readJob(approved.id))!;
    const execution = approved.steps.find(s => s.kind === 'execute')!;
    await first.ledger.progress(execution.executionId);
    now += 5000;
    const restarted = stack();
    const replay = (await restarted.jobs.approve(persona, input)) as typeof approved;
    expect(replay.id).toBe(approved.id);
    expect(replay.steps.find(s => s.kind === 'execute')).toMatchObject({
      state: 'succeeded',
      result: { headline: 'Confirmed' },
    });
    expect((await restarted.store.readJob(approved.id))!.steps).toEqual(before.steps);
    expect(await w.auditCount('job.approved')).toBe(1);
    expect(await w.auditCount('execution.approved')).toBe(1);
    expect(
      await database().select().from(schema.watchIntents).where(eq(schema.watchIntents.jobId, approved.id)),
    ).toHaveLength(1);
    expect(writes).toBe(1);
    const changed = {
      ...persona,
      unitId: 'another-unit',
      authorizationVersion: 'v2',
      authorize: async () => ({ version: 'v2' }),
    };
    expect(await restarted.ledger.readJob(changed, approved.id)).toBeUndefined();
    expect(await restarted.ledger.read(changed, execution.executionId)).toBeUndefined();
    await expect(restarted.jobs.approve(changed, input)).rejects.toThrow('finns inte');
    const altered = structuredClone(proposal);
    const step = altered.steps.find(s => s.draft.kind === 'execute')!;
    if (step.draft.kind === 'execute') step.draft.payload = { ref: 'synthetic:item', revision: 'r2' };
    await expect(restarted.jobs.approve(persona, { ...input, proposal: altered })).rejects.toThrow('annat innehåll');
    await restarted.jobs.bind(persona, { ...binding, enabled: false });
    await expect(restarted.jobs.approve(persona, { ...input, decisionId: 'after-disable' })).rejects.toThrow(
      'Förslaget har ändrats',
    );
    expect(
      await database().select().from(schema.executionJobs).where(eq(schema.executionJobs.personId, w.personId)),
    ).toHaveLength(1);
    expect(await w.auditCount('job.approved')).toBe(1);
  } finally {
    await database().delete(schema.followBindings).where(eq(schema.followBindings.id, binding.id));
    await database()
      .delete(schema.audit)
      .where(eq(schema.audit.subject, 'binding:' + binding.id));
  }
});

afterAll(async () => {
  const records = await database().select().from(schema.executions).where(inArray(schema.executions.personId, people));
  const ids = records.map(e => e.id);
  if (ids.length) {
    await database().delete(schema.dispatchOutbox).where(inArray(schema.dispatchOutbox.executionId, ids));
    await database()
      .delete(schema.audit)
      .where(
        inArray(
          schema.audit.subject,
          ids.map(id => 'execution:' + id),
        ),
      );
    await database().delete(schema.executions).where(inArray(schema.executions.id, ids));
  }
  await database()
    .delete(schema.audit)
    .where(
      inArray(
        schema.audit.subject,
        (
          await database().select().from(schema.executionJobs).where(inArray(schema.executionJobs.personId, people))
        ).map(j => 'job:' + j.id),
      ),
    );
  await database().delete(schema.watchIntents).where(inArray(schema.watchIntents.personId, people));
  await database().delete(schema.executionJobs).where(inArray(schema.executionJobs.personId, people));
  await database().delete(schema.threads).where(inArray(schema.threads.personId, people));
  await database().delete(schema.people).where(inArray(schema.people.id, people));
  await forgetTestWorkflows();
});
