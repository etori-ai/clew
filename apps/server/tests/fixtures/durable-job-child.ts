/**
 * An instance of an older release for the job runtime test: launches the engine under the application, executor id and
 * application version it is given, takes the jobs' workflows from the ledger queue and holds each one in its step, which
 * never finishes, until it is killed. It never runs a job: the parent kills it first, as a deployment replaces it.
 */
import { launchDurable } from '../../src/dbos/runtime';
import { bindActivities } from '../../src/dbos/workflows';

bindActivities({
  runScheduledJob: async id => {
    console.log(`took job:${id}`);
    return new Promise<never>(() => {});
  },
});
await launchDurable({
  name: process.env.DURABLE_APP,
  executorID: process.env.DURABLE_EXECUTOR,
  applicationVersion: process.env.DURABLE_RELEASE,
  heartbeat: false,
});
await new Promise(() => {});
