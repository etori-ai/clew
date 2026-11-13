import { DBOS, DBOSClient, type DLogger, type WorkflowStatus } from '@dbos-inc/dbos-sdk';

/** One step a workflow recorded, as the engine lists it; the package does not export the type by name. */
type StepInfo = NonNullable<Awaited<ReturnType<typeof DBOS.listWorkflowSteps>>>[number];

/**
 * Start a workflow under a stable id, or meet the one already running or finished under it: the outboxes deliver an
 * id more than once after a lost acknowledgement, and the second delivery must change nothing. Rejects when the engine
 * is not launched or the database is unreachable, which the outbox records and retries with backoff.
 */
export async function startDurable<Args extends unknown[], R>(
  workflow: (...args: Args) => Promise<R>,
  workflowID: string,
  ...args: Args
) {
  return DBOS.startWorkflow(workflow, { workflowID, workflowIDReusePolicy: 'return-existing' })(...args);
}
/** Cancel ends a wait quietly. A workflow already finished, or never started, is left as the records say. */
export async function cancelDurable(workflowID: string) {
  const status = await DBOS.getWorkflowStatus(workflowID);
  if (status && (status.status === 'PENDING' || status.status === 'ENQUEUED')) await DBOS.cancelWorkflow(workflowID);
}
/** The result of a workflow started elsewhere; waits until it has one. */
export const durableResult = <R>(workflowID: string) => DBOS.retrieveWorkflow<R>(workflowID).getResult();

const waiting = (status: string) => status === 'PENDING' || status === 'ENQUEUED';
/**
 * The engine's controls that a move uses: this process's engine in a server (`engineControls`), or a client of the
 * engine's database in an operator's script (`scripts/workflows-move.ts`), which launches no engine of its own.
 */
export interface WorkflowControls {
  status(
    workflowID: string,
  ): Promise<Pick<WorkflowStatus, 'status' | 'workflowName' | 'applicationVersion'> | null | undefined>;
  steps(workflowID: string): Promise<ReadonlyArray<Pick<StepInfo, 'functionID' | 'error'>> | undefined>;
  cancel(workflowID: string): Promise<unknown>;
  rewind(
    workflowID: string,
    options: { startStep: number; applicationVersion: string; queueName: string },
  ): Promise<unknown>;
}
/** The engine of this process, once it has launched. */
export const engineControls: WorkflowControls = {
  status: workflowID => DBOS.getWorkflowStatus(workflowID),
  steps: workflowID => DBOS.listWorkflowSteps(workflowID),
  cancel: workflowID => DBOS.cancelWorkflow(workflowID),
  rewind: (workflowID, options) => DBOS.rewindWorkflow(workflowID, options),
};
/**
 * Moves one workflow to `version` on `queue` under its own id, which the ledger's row names (D86): cancelled first when
 * it waits (`status`), since only a workflow that has ended can be rewound, then rewound from `startStep`, which drops
 * what it recorded from there on. Cancelling changes the engine's records only and stops no process. One of the older
 * version that still runs the workflow sleeps on a timer of its own, finds the workflow no longer cancelled when it
 * wakes, since the rewind has queued it again, and runs on until it next records a step, which fails, because the
 * workflow is no longer its: a step it runs meanwhile runs in both, unless the ledger fences it, as a job's claim
 * fences a night. False when another move to the same version, by another start or an operator, moved it between the
 * two.
 */
async function moveOne(
  controls: WorkflowControls,
  workflowID: string,
  status: string,
  to: { version: string; queue: string; startStep: number },
) {
  if (waiting(status)) await controls.cancel(workflowID);
  try {
    await controls.rewind(workflowID, { startStep: to.startStep, applicationVersion: to.version, queueName: to.queue });
    return true;
  } catch (error) {
    // Another move to the same version, a start of another process or an operator's, moved it after the status read.
    const now = await controls.status(workflowID);
    if (now && waiting(now.status) && now.applicationVersion === to.version) return false;
    throw error;
  }
}
/**
 * Hands workflows that wait under another version of the application to the version that runs, at a server's start
 * (D85 item 2, as amended 2026-11-13): the nights of the nightly jobs. Only executors of a workflow's own version
 * recover it, so one that a replaced release took from the queue waits under that release for good. Each of
 * `workflowIDs` that is PENDING or ENQUEUED under another version is moved (`moveOne`) from its first step, on `queue`
 * and under the running version, whose queue runner then takes it; one that is CANCELLED under another version is a
 * move that stopped between its two calls, and is rewound. Only for a workflow that nothing else cancels, that has
 * done nothing a restart repeats before its last step, and whose ledger fences a second run: a process of the older
 * version that still runs at the night's time wakes and may claim the night itself and run it with its own code, and
 * only its record of the step fails. The ids moved here.
 */
export async function moveToRunningVersion(workflowIDs: string[], queue: string, controls = engineControls) {
  const running = DBOS.applicationVersion,
    moved: string[] = [];
  for (const workflowID of workflowIDs) {
    const status = await controls.status(workflowID);
    if (!status?.applicationVersion || status.applicationVersion === running) continue;
    if (!waiting(status.status) && status.status !== 'CANCELLED') continue;
    if (await moveOne(controls, workflowID, status.status, { version: running, queue, startStep: 0 }))
      moved.push(workflowID);
  }
  return moved;
}
/**
 * Where a workflow that an operator moves continues: from the step that failed, which a workflow in ERROR recorded
 * with its error, or else from its first step without a record, as the engine continues a workflow it recovers after
 * a crash. The steps before it stand and are not run again.
 */
export function continuesFrom(steps: ReadonlyArray<Pick<StepInfo, 'functionID' | 'error'>>) {
  const failed = steps.find(step => step.error);
  return failed ? failed.functionID : steps.reduce((next, step) => Math.max(next, step.functionID + 1), 0);
}
/** One workflow that an operator's move looks at: where it stands, and from which step a move continues it. */
export interface MoveCandidate {
  workflowID: string;
  name: string;
  status: string;
  version?: string;
  from: number;
}
/**
 * What an operator's move (`scripts/workflows-move.ts`, D85 item 2 as amended 2026-11-13) finds for one workflow:
 * it moves one that waits (PENDING or ENQUEUED) under another version than `latest`, one left CANCELLED under
 * another version by a move cut short, and one that ended in ERROR, under any version, to start it again once its
 * cause is fixed. Anything else is refused with the reason, in English. A cancelled workflow is moved only when an
 * operator names it, since Clew cancels a replaced reminder or a follow-up that was undone on purpose.
 */
export async function moveCandidate(
  controls: WorkflowControls,
  workflowID: string,
  latest: string,
): Promise<MoveCandidate | { workflowID: string; refused: string }> {
  const status = await controls.status(workflowID);
  if (!status) return { workflowID, refused: 'no such workflow' };
  const other = status.applicationVersion !== latest;
  if (status.status === 'SUCCESS') return { workflowID, refused: 'it has finished' };
  if (waiting(status.status) && !other) return { workflowID, refused: 'it already waits under the latest version' };
  if (status.status === 'CANCELLED' && !other)
    return { workflowID, refused: 'it was cancelled under the latest version, which Clew does on purpose' };
  if (!waiting(status.status) && status.status !== 'CANCELLED' && status.status !== 'ERROR')
    return { workflowID, refused: `its status is ${status.status}` };
  return {
    workflowID,
    name: status.workflowName,
    status: status.status,
    ...(status.applicationVersion ? { version: status.applicationVersion } : {}),
    from: continuesFrom((await controls.steps(workflowID)) ?? []),
  };
}
/**
 * Moves what `moveCandidate` found to `latest` on `queue`, from the step it found, under the workflow's own id. False
 * when another move took it first.
 */
export const moveWorkflow = (controls: WorkflowControls, candidate: MoveCandidate, latest: string, queue: string) =>
  moveOne(controls, candidate.workflowID, candidate.status, { version: latest, queue, startStep: candidate.from });
/**
 * A client of the engine's database for an operator's move (`scripts/workflows-move.ts`): the engine's controls without
 * an engine, the application's latest version, and what waits under another one. It launches no engine and runs no
 * workflow; the engine of a running server runs what it moves. The client's own warnings and errors go to `warn`.
 */
export async function workflowClient(databaseUrl: string, application: string, warn: (line: string) => void) {
  const logger: DLogger = {
    debug: () => undefined,
    info: () => undefined,
    warn: entry => warn(String(entry)),
    error: entry => warn(String(entry)),
  };
  const client = await DBOSClient.create({ systemDatabaseUrl: databaseUrl, applicationName: application, logger });
  const controls: WorkflowControls = {
    status: workflowID => client.getWorkflow(workflowID),
    steps: workflowID => client.listWorkflowSteps(workflowID),
    cancel: workflowID => client.cancelWorkflow(workflowID),
    rewind: (workflowID, options) => client.rewindWorkflow(workflowID, options),
  };
  return {
    controls,
    /** The version the application last launched with, or undefined when no engine of it has launched here. */
    latest: async () => (await client.listApplicationVersions())[0]?.versionName,
    /** The workflows that wait, PENDING or ENQUEUED, under another version than `latest`. */
    async waitingUnderAnother(latest: string) {
      const listed = await client.listWorkflows({
        applicationName: application,
        status: ['PENDING', 'ENQUEUED'],
        loadInput: false,
        loadOutput: false,
      });
      return listed.filter(w => w.applicationVersion && w.applicationVersion !== latest).map(w => w.workflowID);
    },
    destroy: () => client.destroy(),
  };
}
