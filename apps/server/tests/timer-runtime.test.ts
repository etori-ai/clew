import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { and, eq, inArray } from 'drizzle-orm';
import { DBOS } from '@dbos-inc/dbos-sdk';
import { database, schema, closeDatabase } from '@clew/db';
import { postgresThreadStore } from '../src/threads/adapters/postgres';
import { reminderUsecases } from '../src/threads/usecases/reminders';
import { reminderStart, reminderWorkflowId } from '../src/threads/domain';
import { bindActivities } from '../src/dbos/workflows';
import { cancelDurable, durableResult } from '../src/dbos/start';
import { adoptExecutors, beat, claimDead, ensureHeartbeatTable } from '../src/dbos/heartbeat';
import { testEngine } from './durable';

// Real PostgreSQL, the durable engine (DBOS) in production Node, synthetic person and threads. The engine runs under its own application name.
test(
  'a reminder’s workflow starts in the ledger’s own transaction and waits in the queue until an engine launches; cancelled and replaced generations never surface; a killed instance’s reminder is adopted and fires once',
  { timeout: 90_000 },
  async () => {
    const id = 'timer-runtime-' + randomUUID(),
      engine = testEngine('timer'),
      cancelled: string[] = [],
      store = postgresThreadStore({
        durable: engine.durable,
        cancel: async workflowID => {
          cancelled.push(workflowID);
          await cancelDurable(workflowID);
        },
      });
    // Absolute timer due times are already past unless a case says otherwise; the ledger's clock is in the far future.
    const now = Date.parse('2098-11-05T10:00:00.000Z');
    const clock = () => new Date(now);
    const uc = reminderUsecases({ store, clock, authorized: async () => true });
    bindActivities({ fireTimer: uc.fire });
    const ids: string[] = [];
    const seed = async (
      suffix: string,
      kind: 'reminder' | 'snooze' = 'reminder',
      dueAt = '2020-01-01T00:00:00.000Z',
      start = true,
    ) => {
      const threadId = id + suffix;
      ids.push(threadId);
      return store.transaction(async tx => {
        await tx.insertThread({
          id: threadId,
          personId: id,
          topic: threadId,
          kind: 'pushed',
          connector: 'clew',
          area: 'test',
          title: 'Synthetic timer',
          state: 'open',
          summary: '',
          week: null,
          items: [],
          actions: [],
          waitingOn: 'påminnelse',
          deadline: null,
          trigger: { reason: '', source: 'test', at: clock().toISOString() },
          createdAt: clock().toISOString(),
          updatedAt: clock().toISOString(),
        });
        if (kind === 'snooze')
          await tx.updateThread(threadId, { waitingOn: null, snoozedUntil: '2020-01-01T00:00:00.000Z' });
        const timer = await tx.scheduleTimer({
          id: kind + ':' + threadId,
          threadId,
          personId: id,
          kind,
          unitId: 'test',
          authorizationVersion: 'v1',
          requestedAt: clock().toISOString(),
          dueAt,
        });
        // The start is part of the same commit (D86); a seed for the child instance leaves it to the child.
        if (start) await tx.enqueue(reminderStart(timer));
        await tx.writeAudit({
          actor: 'test',
          action: 'reminder.set',
          subject: 'thread:' + threadId,
          at: clock().toISOString(),
        });
        return timer;
      });
    };
    const deliveries = (threadId: string) =>
      database().select().from(schema.deliveries).where(eq(schema.deliveries.threadId, threadId));
    const audit = (threadId: string, action: string) =>
      database()
        .select()
        .from(schema.audit)
        .where(and(eq(schema.audit.subject, 'thread:' + threadId), eq(schema.audit.action, action)));
    let child: ReturnType<typeof spawn> | undefined, launched: Awaited<ReturnType<typeof engine.launch>> | undefined;
    try {
      await database().insert(schema.people).values({ id, name: 'Synthetic timer', organisationId: 'test' });
      // Committed before any engine of this application runs: the row waits in the ledger queue, nothing polls for it.
      const first = await seed(':first');
      assert.deepEqual(await engine.row(reminderWorkflowId(first)), {
        status: 'ENQUEUED',
        executor_id: null,
        queue_name: engine.durable.queue,
      });
      assert.equal((await store.readThread(id, first.threadId))?.timers?.[0]?.state, 'scheduled');
      launched = await engine.launch();
      await durableResult(reminderWorkflowId(first));
      assert.equal((await store.readTimer(first.id))?.state, 'fired');
      await uc.fire(first.id, 1); // Crash after commit but before the step is acknowledged.
      assert.equal((await deliveries(first.threadId)).length, 1);
      assert.equal((await audit(first.threadId, 'thread.reminded')).length, 1);
      // A snooze's timer comes back the way a reminder does (D49): the same delivery and mark, its own audit action.
      const snoozed = await seed(':snoozed', 'snooze');
      await durableResult(reminderWorkflowId(snoozed));
      const back = await store.readThread(id, snoozed.threadId);
      assert.equal(back?.snoozedUntil, null);
      assert.ok(back?.remindedAt);
      assert.equal((await deliveries(snoozed.threadId)).length, 1);
      assert.equal((await audit(snoozed.threadId, 'thread.woken')).length, 1);
      // A reminder waiting for an hour is ended by the cancel the store issues after its commit.
      const waiting = await seed(':cancelled', 'reminder', new Date(Date.now() + 3_600_000).toISOString());
      await durableWait(() => DBOS.getWorkflowStatus(reminderWorkflowId(waiting)), 'PENDING');
      await store.transaction(async tx => {
        await tx.cancelTimer(waiting.id, clock().toISOString());
        await tx.writeAudit({
          actor: 'test',
          action: 'reminder.cancelled',
          subject: 'thread:' + waiting.threadId,
          at: clock().toISOString(),
        });
      });
      assert.deepEqual(cancelled, [reminderWorkflowId(waiting)]);
      assert.equal((await DBOS.getWorkflowStatus(reminderWorkflowId(waiting)))?.status, 'CANCELLED');
      assert.equal((await store.readThread(id, waiting.threadId))?.remindedAt, null);
      // Replacing a waiting reminder cancels the old generation after the commit and starts the new one; a late
      // fire of the old generation is refused by the ledger.
      const old = await seed(':replaced', 'reminder', new Date(Date.now() + 3_600_000).toISOString());
      await durableWait(() => DBOS.getWorkflowStatus(reminderWorkflowId(old)), 'PENDING');
      const replacement = await store.transaction(async tx => {
        const timer = await tx.scheduleTimer({
          id: old.id,
          threadId: old.threadId,
          personId: id,
          kind: 'reminder',
          unitId: 'test',
          authorizationVersion: 'v1',
          requestedAt: clock().toISOString(),
          dueAt: '2020-01-01T00:00:00.000Z',
        });
        await tx.enqueue(reminderStart(timer));
        return timer;
      });
      assert.equal(replacement.generation, 2);
      assert.deepEqual(cancelled.at(-1), reminderWorkflowId(old));
      assert.equal((await DBOS.getWorkflowStatus(reminderWorkflowId(old)))?.status, 'CANCELLED');
      await durableResult(reminderWorkflowId(replacement));
      assert.equal(await uc.fire(old.id, 1), 'skipped');
      assert.equal((await store.readTimer(old.id))?.state, 'fired');
      assert.equal((await deliveries(old.threadId)).length, 1);

      // Process death: a second instance of the same application starts a reminder due in ten seconds and is SIGKILLed.
      // Its heartbeat lapses, this instance claims it once and adopts its workflow, which fires here exactly once.
      const adopted = await seed(':adopted', 'reminder', new Date(Date.now() + 10_000).toISOString(), false);
      child = spawn(
        process.execPath,
        ['--import', 'tsx', fileURLToPath(new URL('./fixtures/durable-child.ts', import.meta.url))],
        {
          env: {
            ...process.env,
            DURABLE_APP: engine.name,
            DURABLE_EXECUTOR: 'timer-child',
            DURABLE_TIMER: JSON.stringify(adopted),
          },
          stdio: ['ignore', 'pipe', 'inherit'],
        },
      );
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('child instance did not start')), 30_000);
        child!.once('exit', code => reject(new Error('child instance exited during startup: ' + code)));
        child!.stdout!.on('data', chunk => {
          if (String(chunk).includes('started ')) {
            clearTimeout(timeout);
            resolve();
          }
        });
      });
      await new Promise<void>(resolve => {
        child!.once('exit', () => resolve());
        child!.kill('SIGKILL');
      });
      const stranded = await DBOS.getWorkflowStatus(reminderWorkflowId(adopted));
      assert.deepEqual([stranded?.status, stranded?.executorId], ['PENDING', 'timer-child']);
      await ensureHeartbeatTable();
      await beat(engine.name, 'timer-child', new Date(Date.now() - 120_000));
      assert.deepEqual(await claimDead(engine.name, launched.executorID), ['timer-child']);
      assert.deepEqual(await claimDead(engine.name, launched.executorID), [], 'claimed once');
      assert.deepEqual(await adoptExecutors(['timer-child']), [reminderWorkflowId(adopted)]);
      await durableResult(reminderWorkflowId(adopted));
      assert.equal((await store.readTimer(adopted.id))?.state, 'fired');
      assert.equal((await deliveries(adopted.threadId)).length, 1);
      assert.equal((await audit(adopted.threadId, 'thread.reminded')).length, 1);
    } finally {
      if (child && child.exitCode === null) child.kill('SIGKILL');
      await launched?.shutdown();
      if (ids.length) {
        await database()
          .delete(schema.audit)
          .where(
            inArray(
              schema.audit.subject,
              ids.map(i => 'thread:' + i),
            ),
          );
        await database().delete(schema.threads).where(inArray(schema.threads.id, ids));
      }
      await database().delete(schema.people).where(eq(schema.people.id, id));
      await engine.forget();
      await closeDatabase();
    }
  },
);
/** The queue runner polls about once a second: wait for the row to be dequeued into the asked-for status. */
async function durableWait(read: () => Promise<{ status: string } | null>, status: string) {
  for (let i = 0; i < 100; i++) {
    if ((await read())?.status === status) return;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error(`workflow did not reach ${status}`);
}
