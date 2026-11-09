import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { and, eq, inArray } from 'drizzle-orm';
import { DBOS } from '@dbos-inc/dbos-sdk';
import { database, schema, closeDatabase } from '@clew/db';
import { postgresThreadStore } from '../src/threads/adapters/postgres';
import { postgresTimerDelivery } from '../src/threads/adapters/timer-postgres';
import { reminderUsecases } from '../src/threads/usecases/reminders';
import { timerDispatcher } from '../src/threads/usecases/timer-dispatch';
import { bindActivities } from '../src/dbos/workflows';
import { deliverTimer, reminderWorkflowId } from '../src/dbos/timers';
import { durableResult } from '../src/dbos/start';
import { adoptExecutors, beat, claimDead, ensureHeartbeatTable } from '../src/dbos/heartbeat';
import { launchTestEngine } from './durable';

// Real PostgreSQL, the durable engine (DBOS) in production Node, synthetic person and threads. The engine runs under its own application name.
test(
  'real timer workflows recover delayed delivery; cancelled/replaced generations never surface; a killed instance’s reminder is adopted and fires once',
  { timeout: 90_000 },
  async () => {
    const id = 'timer-runtime-' + randomUUID(),
      store = postgresThreadStore(),
      delivery = postgresTimerDelivery(id);
    // Future outbox eligibility isolates test claims from the development server; absolute timer due times are already past.
    let now = Date.parse('2098-11-05T10:00:00.000Z');
    const clock = () => new Date(now);
    const uc = reminderUsecases({ store, clock, authorized: async () => true });
    bindActivities({ fireTimer: uc.fire });
    const engine = await launchTestEngine('timer');
    const ids: string[] = [];
    const seed = async (
      suffix: string,
      kind: 'reminder' | 'snooze' = 'reminder',
      dueAt = '2020-01-01T00:00:00.000Z',
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
    let child: ReturnType<typeof spawn> | undefined;
    try {
      await database().insert(schema.people).values({ id, name: 'Synthetic timer', organisationId: 'test' });
      const first = await seed(':first');
      await timerDispatcher({
        store: delivery,
        clock,
        deliver: async () => {
          throw new Error('simulated unavailable engine');
        },
      })();
      assert.equal((await store.readTimer(first.id))?.deliveredGeneration, null);
      now += 120000;
      await timerDispatcher({ store: delivery, clock, deliver: deliverTimer })();
      await durableResult(reminderWorkflowId(first));
      assert.equal((await store.readTimer(first.id))?.state, 'fired');
      await uc.fire(first.id, 1); // Crash after commit but before the step is acknowledged.
      assert.equal((await deliveries(first.threadId)).length, 1);
      assert.equal((await audit(first.threadId, 'thread.reminded')).length, 1);
      // A snooze's timer comes back the way a reminder does (D49): the same delivery and mark, its own audit action.
      const snoozed = await seed(':snoozed', 'snooze');
      await deliverTimer(snoozed);
      await durableResult(reminderWorkflowId(snoozed));
      const back = await store.readThread(id, snoozed.threadId);
      assert.equal(back?.snoozedUntil, null);
      assert.ok(back?.remindedAt);
      assert.equal((await deliveries(snoozed.threadId)).length, 1);
      assert.equal((await audit(snoozed.threadId, 'thread.woken')).length, 1);
      const cancelled = await seed(':cancelled');
      await store.transaction(async tx => {
        await tx.cancelTimer(cancelled.id, clock().toISOString());
        await tx.writeAudit({
          actor: 'test',
          action: 'reminder.cancelled',
          subject: 'thread:' + cancelled.threadId,
          at: clock().toISOString(),
        });
      });
      // The outbox delivers the cancelled state: nothing to cancel yet, and a late start of the old generation is fenced by the ledger.
      await deliverTimer({ ...cancelled, state: 'cancelled' });
      await deliverTimer(cancelled);
      await durableResult(reminderWorkflowId(cancelled));
      assert.equal((await store.readThread(id, cancelled.threadId))?.remindedAt, null);
      const old = await seed(':replaced');
      const replacement = await store.transaction(tx =>
        tx.scheduleTimer({
          id: old.id,
          threadId: old.threadId,
          personId: id,
          kind: 'reminder',
          unitId: 'test',
          authorizationVersion: 'v1',
          requestedAt: clock().toISOString(),
          dueAt: old.dueAt,
        }),
      );
      await deliverTimer(old);
      await durableResult(reminderWorkflowId(old));
      assert.equal((await store.readThread(id, old.threadId))?.remindedAt, null);
      await deliverTimer(replacement);
      await durableResult(reminderWorkflowId(replacement));
      assert.equal((await store.readTimer(old.id))?.generation, 2);
      assert.equal((await deliveries(old.threadId)).length, 1);

      // A reminder waiting on a different instance ends when that instance is killed; cancel from here ends it quietly.
      const waiting = await seed(':waiting', 'reminder', new Date(Date.now() + 3_600_000).toISOString());
      await deliverTimer(waiting);
      assert.equal((await DBOS.getWorkflowStatus(reminderWorkflowId(waiting)))?.status, 'PENDING');
      await deliverTimer({ ...waiting, state: 'cancelled' });
      assert.equal((await DBOS.getWorkflowStatus(reminderWorkflowId(waiting)))?.status, 'CANCELLED');

      // Process death: a second instance of the same application starts a reminder due in ten seconds and is SIGKILLed.
      // Its heartbeat lapses, this instance claims it once and adopts its workflow, which fires here exactly once.
      const adopted = await seed(':adopted', 'reminder', new Date(Date.now() + 10_000).toISOString());
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
      assert.deepEqual(await claimDead(engine.name, engine.executorID), ['timer-child']);
      assert.deepEqual(await claimDead(engine.name, engine.executorID), [], 'claimed once');
      assert.deepEqual(await adoptExecutors(['timer-child']), [reminderWorkflowId(adopted)]);
      await durableResult(reminderWorkflowId(adopted));
      assert.equal((await store.readTimer(adopted.id))?.state, 'fired');
      assert.equal((await deliveries(adopted.threadId)).length, 1);
      assert.equal((await audit(adopted.threadId, 'thread.reminded')).length, 1);
    } finally {
      if (child && child.exitCode === null) child.kill('SIGKILL');
      await engine.shutdown();
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
      await closeDatabase();
    }
  },
);
