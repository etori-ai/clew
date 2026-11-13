/**
 * A second instance for the competence erasure's runtime test (D108 item 14): launches the engine under the application
 * and executor id it is given and starts one `competenceErasure` workflow here (directly, so this executor and not the
 * parent's queue runner owns it), due some seconds ahead, then waits to be killed. Its step must never run: the parent
 * kills it while the workflow sleeps and adopts it, and the parent's own step must erase the person once.
 */
import { launchDurable } from '../../src/dbos/runtime';
import { bindActivities, competenceErasure } from '../../src/dbos/workflows';
import { startDurable } from '../../src/dbos/start';
import type { ErasureInput } from '../../src/modules/competence/domain';
import type { WorkflowStart } from '../../src/modules/competence/model';

bindActivities({
  eraseLeaver: async () => {
    throw new Error('the child instance must not erase anyone');
  },
});
const start = JSON.parse(process.env.ERASURE_START!) as WorkflowStart;
await launchDurable({ name: process.env.DURABLE_APP, executorID: process.env.DURABLE_EXECUTOR, heartbeat: false });
await startDurable(competenceErasure, start.id, start.input as ErasureInput);
console.log(`started ${start.id}`);
await new Promise(() => {});
