/**
 * A second instance for the competence copy's runtime test (D108 item 9): launches the engine under the application and
 * executor id it is given, starts one `competenceCopy` workflow here (directly, so this executor owns it), takes the
 * source's lease in the copy's first step and hangs reading the first page, until the parent kills it. The parent then
 * adopts the workflow, and its run must go on under the same lease and read the source to the end, once.
 */
import { launchDurable } from '../../src/dbos/runtime';
import { bindActivities, competenceCopy } from '../../src/dbos/workflows';
import { startDurable } from '../../src/dbos/start';
import { postgresCompetenceStore } from '../../src/modules/competence/adapters/postgres';
import { competenceUsecases } from '../../src/modules/competence/usecases';
import type { CopyInput } from '../../src/modules/competence/domain';
import type { WorkflowStart } from '../../src/modules/competence/model';

const application = process.env.DURABLE_APP!;
const source = JSON.parse(process.env.COPY_SOURCE!) as { connectorId: string; source: string };
const start = JSON.parse(process.env.COPY_START!) as WorkflowStart;
const competence = competenceUsecases({
  store: postgresCompetenceStore({ application, queue: application + '.ledger' }),
  staff: async () => ({ units: [] }),
  clock: () => new Date(),
  ids: () => crypto.randomUUID(),
  holdings: {
    switchedOn: async () => true,
    holdingsSources: async () => [source],
    readHoldings: () => {
      console.log('reading');
      return new Promise(() => {});
    },
    admitted: async (_connectorId, personIds) => new Set(personIds),
    reaches: async () => true,
  },
});
bindActivities({
  scheduleCompetenceCopy: async () => undefined,
  competenceSources: only => competence.copySources(only),
  copyHoldings: async (run, s) => (await competence.copySource('system:test-child', run, s)).outcome,
});
await launchDurable({ name: application, executorID: process.env.DURABLE_EXECUTOR, heartbeat: false });
await startDurable(competenceCopy, start.id, start.input as CopyInput);
console.log(`started ${start.id}`);
await new Promise(() => {});
