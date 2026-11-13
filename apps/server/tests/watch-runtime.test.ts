import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { database, schema, closeDatabase } from '@clew/db';
import type { AuthenticatedContext } from '@clew/contracts';
import { openSecret, sealSecret } from '../src/auth-crypto';
import { postgresExecutionStore } from '../src/modules/executions/adapters/postgres';
import { executionUsecases } from '../src/modules/executions/usecases';
import { watchStart, watchWorkflowId } from '../src/modules/executions/domain';
import { watchCardSink } from '../src/composition/watch-card';
import type { ExecutionSource, WatchSource } from '../src/modules/executions/model';
import { bindActivities, type WatchOutcome } from '../src/dbos/workflows';
import { durableResult } from '../src/dbos/start';
import { testEngine } from './durable';

// A job's watch steps (D55) on PostgreSQL, the durable engine and production Node: its own application name and a synthetic person and source.
test(
  "real watch workflows start in the approval's transaction, read at the committed checks, settle when the fact is seen, leave one card at the window's end, and ignore a replayed start",
  { timeout: 60_000 },
  async () => {
    const id = 'watch-runtime-' + randomUUID();
    process.env.MASTER_KEY ??= randomBytes(32).toString('base64');
    // The approval runs on a far-future clock; the ledger's clock is then moved inside the committed window, which lies
    // in the real past, so the workflow waits for nothing once the engine launches and dequeues it.
    const approvedAt = '2098-11-05T10:00:00.000Z';
    let now = Date.parse(approvedAt);
    const clock = () => new Date(now);
    const persona: AuthenticatedContext = {
      id,
      name: 'Synthetic watch test',
      unitId: 'test',
      unitLabel: 'Test',
      role: 'manager',
      organisationId: 'test',
      principal: { id: 'person:' + id, kind: 'person' },
      capabilities: [],
      authorizationVersion: 'v1',
      sessionBinding: 'test',
      expiresAt: '2099-01-01',
      authorize: async () => ({ version: 'v1' }),
    };
    const reads = { seen: 0, expired: 0 };
    // The payroll stand-in: each read moves the ledger's clock 25 minutes; the fact shows on the second read of the seen step and never for the expired one,
    // whose third read also carries the clock past its window, so the workflow's final observe settles it without waiting for a retry.
    const watch: WatchSource = {
      authorize: async () => ({ connector: 'payroll' }),
      async read(_, __, input) {
        const step = (input as { step: 'seen' | 'expired' }).step;
        reads[step]++;
        now = step === 'expired' && reads.expired === 3 ? Date.parse('2020-01-01T06:01:00.000Z') : now + 25 * 60_000;
        return { status: step === 'seen' && reads.seen >= 2 ? 'registered' : 'pending' };
      },
    };
    const source: ExecutionSource = {
      authorize: async () => {
        throw new Error('no execute in this test');
      },
      current: async () => persona,
      execute: async () => {
        throw new Error('never');
      },
      lookup: async () => {
        throw new Error('never');
      },
    };
    const engine = testEngine('watch');
    const store = postgresExecutionStore({ seal: sealSecret, open: openSecret }, engine.durable, {
      pushCard: watchCardSink(() => ({ source: 'Lönesystemet', area: 'lon' }), engine.durable),
    });
    const uc = executionUsecases({ store, source, watch, clock, ids: randomUUID, digest: JSON.stringify });
    bindActivities({ observeWatch: uc.observe });
    let launched: Awaited<ReturnType<typeof engine.launch>> | undefined;
    try {
      await database().insert(schema.people).values({ id, name: 'Synthetic watch test', organisationId: 'test' });
      const checks = ['2020-01-01T00:00:00.000Z', '2020-01-01T00:30:00.000Z', '2020-01-01T01:00:00.000Z'];
      const approve = (step: 'seen' | 'expired', expiresAt: string) =>
        uc.approveJob(persona, {
          decisionId: `${id}:${step}`,
          steps: [
            {
              id: 'payroll-1',
              kind: 'watch' as const,
              operation: 'payroll.absenceStatus',
              input: { step },
              expect: { path: ['status'], equals: 'registered' },
              checks,
              expiresAt,
              title: 'Bevakas i lönesystemet',
              source: 'Lönesystemet',
            },
          ],
        });
      const seen = await approve('seen', '2020-01-01T10:00:00.000Z'),
        expired = await approve('expired', '2020-01-01T06:00:00.000Z');
      assert.equal((await approve('seen', '2020-01-01T10:00:00.000Z')).id, seen.id);
      const intents = await database().select().from(schema.watchIntents).where(eq(schema.watchIntents.personId, id));
      assert.deepEqual(
        intents.map(i => [i.jobId, i.stepId, i.generation, i.checks, i.deliveredAt?.toISOString()]).sort(),
        [
          [expired.id, 'payroll-1', 1, checks, approvedAt],
          [seen.id, 'payroll-1', 1, checks, approvedAt],
        ].sort(),
      );
      // Both workflows were committed with the approvals (D86) and wait in the queue for an engine of this application.
      const seenWorkflow = watchWorkflowId({ id: `watch:${seen.id}:payroll-1`, generation: 1 }),
        expiredWorkflow = watchWorkflowId({ id: `watch:${expired.id}:payroll-1`, generation: 1 });
      assert.equal((await engine.row(seenWorkflow))?.status, 'ENQUEUED');
      assert.equal((await engine.row(expiredWorkflow))?.status, 'ENQUEUED');
      now = Date.parse('2020-01-01T02:00:00.000Z');
      launched = await engine.launch();
      assert.equal(await durableResult<WatchOutcome>(seenWorkflow), 'seen');
      assert.equal(await durableResult<WatchOutcome>(expiredWorkflow), 'expired');
      assert.deepEqual(reads, { seen: 2, expired: 3 });
      const seenStep = (await uc.readJob(persona, seen.id))!.steps[0]!,
        expiredStep = (await uc.readJob(persona, expired.id))!.steps[0]!;
      assert.deepEqual([seenStep.state, seenStep.kind === 'watch' && seenStep.observations], ['seen', 2]);
      assert.deepEqual([expiredStep.state, expiredStep.kind === 'watch' && expiredStep.observations], ['expired', 3]);
      const audit = (subject: string, action: string) =>
        database()
          .select()
          .from(schema.audit)
          .where(and(eq(schema.audit.subject, subject), eq(schema.audit.action, action)));
      assert.equal((await audit('job:' + seen.id, 'job.watch_observed')).length, 2);
      assert.equal((await audit('job:' + seen.id, 'job.watch_expired')).length, 0);
      assert.equal((await audit('job:' + expired.id, 'job.watch_observed')).length, 3);
      assert.equal((await audit('job:' + expired.id, 'job.watch_expired')).length, 1);
      const cardId = `watch:${expired.id}:payroll-1`;
      const cards = await database().select().from(schema.threads).where(eq(schema.threads.personId, id));
      assert.deepEqual(
        cards.map(c => [c.id, c.title, c.connector, c.area, c.state]),
        [[cardId, 'Lönesystemet har inte visat det som bevakades', 'payroll', 'lon', 'open']],
      );
      assert.equal(
        (await database().select().from(schema.deliveries).where(eq(schema.deliveries.threadId, cardId))).length,
        1,
      );
      assert.equal((await audit('thread:' + cardId, 'thread.pushed')).length, 1);
      // A replayed start under the same id meets the finished workflow and changes nothing.
      const [intent] = intents.filter(i => i.jobId === expired.id);
      await store.transaction(tx =>
        tx.enqueue(
          watchStart({
            ...intent!,
            expiresAt: intent!.expiresAt.toISOString(),
            nextAt: intent!.nextAt.toISOString(),
            leaseUntil: null,
            deliveredAt: approvedAt,
          }),
        ),
      );
      assert.equal((await engine.row(expiredWorkflow))?.status, 'SUCCESS');
      await new Promise(resolve => setTimeout(resolve, 2500));
      assert.equal(await uc.observe(expired.id, 'payroll-1', 0), 'expired');
      assert.equal((await database().select().from(schema.threads).where(eq(schema.threads.personId, id))).length, 1);
      assert.equal((await audit('job:' + expired.id, 'job.watch_expired')).length, 1);
      assert.deepEqual(reads, { seen: 2, expired: 3 });
    } finally {
      await launched?.shutdown();
      const jobs = (
        await database().select().from(schema.executionJobs).where(eq(schema.executionJobs.personId, id))
      ).map(j => j.id);
      const threads = (await database().select().from(schema.threads).where(eq(schema.threads.personId, id))).map(
        t => t.id,
      );
      if (jobs.length || threads.length)
        await database()
          .delete(schema.audit)
          .where(inArray(schema.audit.subject, [...jobs.map(j => 'job:' + j), ...threads.map(t => 'thread:' + t)]));
      await database().delete(schema.threads).where(eq(schema.threads.personId, id));
      await database().delete(schema.watchIntents).where(eq(schema.watchIntents.personId, id));
      await database().delete(schema.executionJobs).where(eq(schema.executionJobs.personId, id));
      await database().delete(schema.people).where(eq(schema.people.id, id));
      await engine.forget();
      await closeDatabase();
    }
  },
);
