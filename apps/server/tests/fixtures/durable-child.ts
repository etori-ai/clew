/**
 * A second instance for the runtime tests: launches the engine under the application and executor id it is given,
 * starts one reminder workflow here (directly, so this executor and not the parent's queue runner owns it) and waits
 * to be killed. Its activities must never run: the parent kills it before the reminder is due and adopts the workflow.
 */
import { launchDurable } from '../../src/dbos/runtime';
import { bindActivities, durableReminder } from '../../src/dbos/workflows';
import { startDurable } from '../../src/dbos/start';
import { reminderStart } from '../../src/threads/domain';
import type { TimerIntent } from '../../src/threads/model';

bindActivities({
  fireTimer: async () => {
    throw new Error('the child instance must not fire the reminder');
  },
});
const timer = JSON.parse(process.env.DURABLE_TIMER!) as TimerIntent;
await launchDurable({ name: process.env.DURABLE_APP, executorID: process.env.DURABLE_EXECUTOR, heartbeat: false });
const start = reminderStart(timer);
await startDurable(durableReminder, start.id, start.input as { id: string; generation: number; dueAt: string });
console.log(`started ${start.id}`);
await new Promise(() => {});
