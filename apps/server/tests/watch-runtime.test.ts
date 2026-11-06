import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { NativeConnection, Worker } from '@temporalio/worker';
import { Client, Connection, WorkflowExecutionAlreadyStartedError } from '@temporalio/client';
import { and, eq, inArray } from 'drizzle-orm';
import { database, schema, closeDatabase } from '@clew/db';
import type { AuthenticatedContext } from '@clew/contracts';
import { openSecret, sealSecret } from '../src/auth-crypto';
import { postgresExecutionStore } from '../src/modules/executions/adapters/postgres';
import { executionUsecases } from '../src/modules/executions/usecases';
import { watchDispatcher } from '../src/modules/executions/dispatch';
import { watchCardSink } from '../src/composition/watch-card';
import type { ExecutionSource, WatchIntent, WatchSource } from '../src/modules/executions/model';

// A job's watch steps (D55) on PostgreSQL, Temporal and production Node: a separate task queue and a synthetic person and source.
test('real watch workflows read at the committed checks, settle when the fact is seen, leave one card at the window\'s end, and recover delayed delivery', { timeout: 60_000 }, async () => {
  const id = 'watch-runtime-' + randomUUID(), queue = id;
  process.env.MASTER_KEY ??= randomBytes(32).toString('base64');
  // Approval and delivery run on a far-future clock so the development server's dispatcher never claims the test's intents.
  // The ledger's clock is then moved inside the committed window, which lies in the real past, so the workflow waits for nothing.
  let now = Date.parse('2098-11-05T10:00:00.000Z'), dispatchNow = now;
  const clock = () => new Date(now), dispatchClock = () => new Date(dispatchNow);
  const persona: AuthenticatedContext = { id, name: 'Synthetic watch test', unitId: 'test', unitLabel: 'Test', role: 'manager', organisationId: 'test', principal: { id: 'person:' + id, kind: 'person' }, capabilities: [], authorizationVersion: 'v1', sessionBinding: 'test', expiresAt: '2099-01-01', authorize: async () => ({ version: 'v1' }) };
  const reads = { seen: 0, expired: 0 };
  // The payroll stand-in: each read moves the ledger's clock 25 minutes; the fact shows on the second read of the seen step and never for the expired one,
  // whose third read also carries the clock past its window, so the workflow's final observe settles it without waiting for a retry.
  const watch: WatchSource = { authorize: async () => ({ connector: 'payroll' }), async read(_, __, input) {
    const step = (input as { step: 'seen' | 'expired' }).step; reads[step]++;
    now = step === 'expired' && reads.expired === 3 ? Date.parse('2020-01-01T06:01:00.000Z') : now + 25 * 60_000;
    return { status: step === 'seen' && reads.seen >= 2 ? 'registered' : 'pending' };
  } };
  const source: ExecutionSource = { authorize: async () => { throw new Error('no execute in this test'); }, current: async () => persona, execute: async () => { throw new Error('never'); }, lookup: async () => { throw new Error('never'); } };
  const store = postgresExecutionStore({ seal: sealSecret, open: openSecret }, { pushCard: watchCardSink(() => ({ source: 'Lönesystemet', area: 'lon' })) });
  const uc = executionUsecases({ store, source, watch, clock, ids: randomUUID, digest: JSON.stringify });
  const address = process.env.TEMPORAL_ADDRESS ?? 'temporal:7233';
  let worker: Worker | undefined, running: Promise<void> | undefined, native: NativeConnection | undefined, connection: Connection | undefined;
  const started: string[] = [];
  try {
    await database().insert(schema.people).values({ id, name: 'Synthetic watch test', organisationId: 'test' });
    native = await NativeConnection.connect({ address }); connection = await Connection.connect({ address });
    const client = new Client({ connection });
    worker = await Worker.create({ connection: native, taskQueue: queue, workflowsPath: fileURLToPath(new URL('../src/temporal/workflows.ts', import.meta.url)), activities: { observeWatch: uc.observe }, maxConcurrentActivityTaskExecutions: 2, maxConcurrentWorkflowTaskExecutions: 2 });
    running = worker.run();
    const checks = ['2020-01-01T00:00:00.000Z', '2020-01-01T00:30:00.000Z', '2020-01-01T01:00:00.000Z'];
    const approve = (step: 'seen' | 'expired', expiresAt: string) => uc.approveJob(persona, { decisionId: `${id}:${step}`, steps: [{ id: 'payroll-1', kind: 'watch' as const, operation: 'payroll.absenceStatus', input: { step }, expect: { path: ['status'], equals: 'registered' }, checks, expiresAt, title: 'Bevakas i lönesystemet', source: 'Lönesystemet' }] });
    const seen = await approve('seen', '2020-01-01T10:00:00.000Z'), expired = await approve('expired', '2020-01-01T06:00:00.000Z');
    assert.equal((await approve('seen', '2020-01-01T10:00:00.000Z')).id, seen.id);
    const intents = await database().select().from(schema.watchIntents).where(eq(schema.watchIntents.personId, id));
    assert.deepEqual(intents.map(i => [i.jobId, i.stepId, i.generation, i.checks, i.deliveredAt]).sort(), [[expired.id, 'payroll-1', 1, checks, null], [seen.id, 'payroll-1', 1, checks, null]].sort());
    now = Date.parse('2020-01-01T02:00:00.000Z');
    const start = async (i: WatchIntent) => {
      started.push(i.id);
      try { await client.workflow.start('jobWatch', { workflowId: `${i.id}:${i.generation}`, taskQueue: queue, args: [{ jobId: i.jobId, stepId: i.stepId, generation: i.generation, checks: i.checks, expiresAt: i.expiresAt }], workflowIdConflictPolicy: 'USE_EXISTING', workflowIdReusePolicy: 'REJECT_DUPLICATE' }); }
      catch (error) { if (!(error instanceof WorkflowExecutionAlreadyStartedError)) throw error; }
    };
    await watchDispatcher({ store, start: async () => { throw new Error('simulated unavailable Temporal'); }, clock: dispatchClock })();
    for (const i of await database().select().from(schema.watchIntents).where(eq(schema.watchIntents.personId, id))) assert.deepEqual([i.attempt, i.deliveredAt, i.lastError], [1, null, 'workflow-service-unavailable']);
    const dispatch = watchDispatcher({ store, start, clock: dispatchClock });
    await dispatch(); assert.deepEqual(started, [], 'backoff holds the retry');
    dispatchNow += 5_000; await dispatch(); await dispatch();
    assert.deepEqual(started.sort(), [`watch:${expired.id}:payroll-1`, `watch:${seen.id}:payroll-1`].sort(), 'each intent delivered once');
    assert.equal(await client.workflow.getHandle(`watch:${seen.id}:payroll-1:1`).result(), 'seen');
    assert.equal(await client.workflow.getHandle(`watch:${expired.id}:payroll-1:1`).result(), 'expired');
    assert.deepEqual(reads, { seen: 2, expired: 3 });
    const seenStep = (await uc.readJob(persona, seen.id))!.steps[0]!, expiredStep = (await uc.readJob(persona, expired.id))!.steps[0]!;
    assert.deepEqual([seenStep.state, seenStep.kind === 'watch' && seenStep.observations], ['seen', 2]);
    assert.deepEqual([expiredStep.state, expiredStep.kind === 'watch' && expiredStep.observations], ['expired', 3]);
    const audit = (subject: string, action: string) => database().select().from(schema.audit).where(and(eq(schema.audit.subject, subject), eq(schema.audit.action, action)));
    assert.equal((await audit('job:' + seen.id, 'job.watch_observed')).length, 2); assert.equal((await audit('job:' + seen.id, 'job.watch_expired')).length, 0);
    assert.equal((await audit('job:' + expired.id, 'job.watch_observed')).length, 3); assert.equal((await audit('job:' + expired.id, 'job.watch_expired')).length, 1);
    const cardId = `watch:${expired.id}:payroll-1`;
    const cards = await database().select().from(schema.threads).where(eq(schema.threads.personId, id));
    assert.deepEqual(cards.map(c => [c.id, c.title, c.connector, c.area, c.state]), [[cardId, 'Lönesystemet har inte visat det som bevakades', 'payroll', 'lon', 'open']]);
    assert.equal((await database().select().from(schema.deliveries).where(eq(schema.deliveries.threadId, cardId))).length, 1);
    assert.equal((await audit('thread:' + cardId, 'thread.pushed')).length, 1);
    // The acknowledgement is lost after delivery: the outbox hands the same intent in again, which meets the finished workflow and changes nothing.
    await database().update(schema.watchIntents).set({ deliveredAt: null, leaseUntil: null }).where(eq(schema.watchIntents.id, `watch:${expired.id}:payroll-1`));
    dispatchNow += 31_000; await dispatch();
    assert.equal(started.length, 3);
    assert.equal(await uc.observe(expired.id, 'payroll-1', 0), 'expired');
    assert.equal((await database().select().from(schema.threads).where(eq(schema.threads.personId, id))).length, 1);
    assert.equal((await audit('job:' + expired.id, 'job.watch_expired')).length, 1);
    assert.deepEqual(reads, { seen: 2, expired: 3 });
  } finally {
    if (worker) { worker.shutdown(); await running?.catch(() => undefined); }
    await native?.close(); await connection?.close();
    const jobs = (await database().select().from(schema.executionJobs).where(eq(schema.executionJobs.personId, id))).map(j => j.id);
    const threads = (await database().select().from(schema.threads).where(eq(schema.threads.personId, id))).map(t => t.id);
    if (jobs.length || threads.length) await database().delete(schema.audit).where(inArray(schema.audit.subject, [...jobs.map(j => 'job:' + j), ...threads.map(t => 'thread:' + t)]));
    await database().delete(schema.threads).where(eq(schema.threads.personId, id));
    await database().delete(schema.watchIntents).where(eq(schema.watchIntents.personId, id));
    await database().delete(schema.executionJobs).where(eq(schema.executionJobs.personId, id));
    await database().delete(schema.people).where(eq(schema.people.id, id));
    await closeDatabase();
  }
});
