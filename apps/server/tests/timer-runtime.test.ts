import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Worker, NativeConnection } from '@temporalio/worker';
import { Client, Connection } from '@temporalio/client';
import { and, eq, inArray } from 'drizzle-orm';
import { database, schema, closeDatabase } from '@clew/db';
import { postgresThreadStore } from '../src/threads/adapters/postgres';
import { postgresTimerDelivery } from '../src/threads/adapters/timer-postgres';
import { reminderUsecases } from '../src/threads/usecases/reminders';
import { timerDispatcher } from '../src/threads/usecases/timer-dispatch';
import type { TimerIntent } from '../src/threads/model';

test('real timer workflows recover delayed delivery; cancelled/replaced generations never surface; old histories replay', { timeout: 60000 }, async () => {
  const id = 'timer-runtime-' + randomUUID(), queue = id, store = postgresThreadStore(), delivery = postgresTimerDelivery(id);
  // Future outbox eligibility isolates test claims from the development server; absolute timer due times are already past.
  let now = Date.parse('2098-11-05T10:00:00.000Z'); const clock = () => new Date(now);
  const uc = reminderUsecases({ store, clock, authorized: async () => true });
  const connection = await Connection.connect({ address: process.env.TEMPORAL_ADDRESS ?? 'temporal:7233' });
  const native = await NativeConnection.connect({ address: process.env.TEMPORAL_ADDRESS ?? 'temporal:7233' });
  const client = new Client({ connection });
  let worker: Worker | undefined, running: Promise<void> | undefined, legacy: Worker | undefined, legacyRun: Promise<void> | undefined;
  const ids: string[] = [];
  const seed = async (suffix: string) => {
    const threadId = id + suffix; ids.push(threadId);
    return store.transaction(async tx => {
      await tx.insertThread({ id: threadId, personId: id, topic: threadId, kind: 'pushed', connector: 'clew', area: 'test', title: 'Synthetic timer', state: 'open', summary: '', week: null, items: [], actions: [], waitingOn: 'påminnelse', deadline: null, trigger: { reason: '', source: 'test', at: clock().toISOString() }, createdAt: clock().toISOString(), updatedAt: clock().toISOString() });
      const timer = await tx.scheduleTimer({ id: 'reminder:' + threadId, threadId, personId: id, kind: 'reminder', unitId: 'test', authorizationVersion: 'v1', requestedAt: clock().toISOString(), dueAt: '2020-01-01T00:00:00.000Z' });
      await tx.writeAudit({ actor: 'test', action: 'reminder.set', subject: 'thread:' + threadId, at: clock().toISOString() }); return timer;
    });
  };
  const start = async (t: TimerIntent) => client.workflow.start('durableReminder', { workflowId: `${t.id}:v2:${t.generation}`, taskQueue: queue, args: [{ id: t.id, generation: t.generation, dueAt: t.dueAt }], workflowIdConflictPolicy: 'USE_EXISTING', workflowIdReusePolicy: 'REJECT_DUPLICATE' });
  try {
    await database().insert(schema.people).values({ id, name: 'Synthetic timer', organisationId: 'test' });
    worker = await Worker.create({ connection: native, taskQueue: queue, workflowsPath: fileURLToPath(new URL('../src/temporal/workflows.ts', import.meta.url)), activities: { fireTimer: uc.fire }, maxConcurrentActivityTaskExecutions: 2, maxConcurrentWorkflowTaskExecutions: 2 }); running = worker.run();
    const first = await seed(':first');
    await timerDispatcher({ store: delivery, clock, deliver: async () => { throw new Error('simulated unavailable Temporal'); } })();
    assert.equal((await store.readTimer(first.id))?.deliveredGeneration, null);
    now += 120000;
    await timerDispatcher({ store: delivery, clock, deliver: async t => { await start(t); } })();
    await client.workflow.getHandle(`${first.id}:v2:1`).result();
    assert.equal((await store.readTimer(first.id))?.state, 'fired');
    await uc.fire(first.id, 1); // Crash after commit but before activity acknowledgement.
    assert.equal((await database().select().from(schema.deliveries).where(eq(schema.deliveries.threadId, first.threadId))).length, 1);
    assert.equal((await database().select().from(schema.audit).where(and(eq(schema.audit.subject, 'thread:' + first.threadId), eq(schema.audit.action, 'thread.reminded')))).length, 1);
    const cancelled = await seed(':cancelled');
    await store.transaction(async tx => { await tx.cancelTimer(cancelled.id, clock().toISOString()); await tx.writeAudit({ actor: 'test', action: 'reminder.cancelled', subject: 'thread:' + cancelled.threadId, at: clock().toISOString() }); });
    await (await start(cancelled)).result(); assert.equal((await store.readThread(id, cancelled.threadId))?.remindedAt, null);
    const old = await seed(':replaced');
    const replacement = await store.transaction(tx => tx.scheduleTimer({ id: old.id, threadId: old.threadId, personId: id, kind: 'reminder', unitId: 'test', authorizationVersion: 'v1', requestedAt: clock().toISOString(), dueAt: old.dueAt }));
    await (await start(old)).result(); assert.equal((await store.readThread(id, old.threadId))?.remindedAt, null);
    await (await start(replacement)).result(); assert.equal((await store.readTimer(old.id))?.generation, 2);

    // Histories are produced by the previous release's workflow code, then replayed by the current release.
    legacy = await Worker.create({ connection: native, taskQueue: queue + ':legacy', workflowsPath: fileURLToPath(new URL('./fixtures/workflows-v46.ts', import.meta.url)), activities: {
      surfaceReminder: async () => 'surfaced', checkObligation: async () => ({ action: 'return', why: 'answered' }), returnObligation: async () => {},
    }, maxConcurrentActivityTaskExecutions: 2, maxConcurrentWorkflowTaskExecutions: 2 }); legacyRun = legacy.run();
    for (const name of ['reminder', 'obligation']) {
      const handle = await client.workflow.start(name, { workflowId: id + ':legacy:' + name, taskQueue: queue + ':legacy', args: [{ threadId: id, personId: id, requestedAt: clock().toISOString(), seconds: 0, title: 'Test', area: 'test' }] });
      await handle.result(); await Worker.runReplayHistory({ workflowsPath: fileURLToPath(new URL('../src/temporal/workflows.ts', import.meta.url)) }, await handle.fetchHistory());
    }
  } finally {
    if (legacy) { legacy.shutdown(); await legacyRun; } if (worker) { worker.shutdown(); await running; }
    await native.close(); await connection.close();
    if (ids.length) { await database().delete(schema.audit).where(inArray(schema.audit.subject, ids.map(i => 'thread:' + i))); await database().delete(schema.threads).where(inArray(schema.threads.id, ids)); }
    await database().delete(schema.people).where(eq(schema.people.id, id)); await closeDatabase();
  }
});
