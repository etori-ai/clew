/**
 * A second instance for the runtime tests: launches the engine under the application and executor id it is given,
 * starts one reminder workflow and waits to be killed. Its activities must never run: the parent kills it before the
 * reminder is due and adopts the workflow.
 */
import { launchDurable } from '../../src/dbos/runtime';
import { bindActivities } from '../../src/dbos/workflows';
import { deliverTimer } from '../../src/dbos/timers';
import type { TimerIntent } from '../../src/threads/model';

bindActivities({
  fireTimer: async () => {
    throw new Error('the child instance must not fire the reminder');
  },
});
const timer = JSON.parse(process.env.DURABLE_TIMER!) as TimerIntent;
await launchDurable({ name: process.env.DURABLE_APP, executorID: process.env.DURABLE_EXECUTOR, heartbeat: false });
await deliverTimer(timer);
console.log(`started ${timer.id}:v2:${timer.generation}`);
await new Promise(() => {});
