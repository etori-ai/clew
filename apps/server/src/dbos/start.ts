import { sql } from 'drizzle-orm';
import { database } from '@clew/db';
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
  withMoveLock<T>(queue: string, workflowID: string, run: () => Promise<T>): Promise<T>;
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
/**
 * All starts and operator moves on the same application's queue take this lock before reading mutable engine state.
 * The callback uses DBOS's separate pool. The app-pool connection only holds this one transaction-scoped lock.
 */
function withMoveLock<T>(queue: string, workflowID: string, run: () => Promise<T>) {
  return database().transaction(async tx => {
    const key = JSON.stringify(['clew.workflow-move', queue, workflowID]);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
    return run();
  });
}
type NightlyControls = WorkflowControls & {
  readonly version: string;
  resume(workflowID: string, queue: string): Promise<unknown>;
};
/** The engine of this process, once it has launched. */
export const engineControls: NightlyControls = {
  get version() {
    return DBOS.applicationVersion;
  },
  withMoveLock,
  resume: (workflowID, queue) => DBOS.resumeWorkflow(workflowID, { queueName: queue }),
  status: workflowID => DBOS.getWorkflowStatus(workflowID),
  steps: workflowID => DBOS.listWorkflowSteps(workflowID),
  cancel: workflowID => DBOS.cancelWorkflow(workflowID),
  rewind: (workflowID, options) => DBOS.rewindWorkflow(workflowID, options),
};

/** An executor may have completed its workflow before the cancel arrived. Only a confirmed cancellation may be rewound. */
async function cancelWaiting(controls: WorkflowControls, workflowID: string) {
  await controls.cancel(workflowID);
  return (await controls.status(workflowID))?.status === 'CANCELLED';
}

/**
 * The scheduler selects the last and next nightly jobs and the unfinished pages of the last scan. Nothing in Clew
 * intentionally cancels these workflows. Move an older version's night from step zero under its stable id; its ledger
 * claim fences the job. Resume a cancellation already under this version with its recorded steps intact.
 */
export async function moveToRunningVersion(workflowIDs: string[], queue: string, controls = engineControls) {
  const running = controls.version;
  const moved: string[] = [];
  for (const workflowID of workflowIDs) {
    const taken = await controls.withMoveLock(queue, workflowID, async () => {
      const status = await controls.status(workflowID);
      if (!status?.applicationVersion) return false;
      if (status.applicationVersion === running) {
        if (status.status !== 'CANCELLED') return false;
        await controls.resume(workflowID, queue);
      } else {
        if (waiting(status.status)) {
          if (!(await cancelWaiting(controls, workflowID))) return false;
        } else if (status.status !== 'CANCELLED') return false;
        await controls.rewind(workflowID, { startStep: 0, applicationVersion: running, queueName: queue });
      }
      return true;
    });
    if (taken) moved.push(workflowID);
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
/** Decide under the same lock as startup, then rewind from the checkpoint reached when the workflow finally stopped. */
export function moveWorkflow(controls: WorkflowControls, workflowID: string, latest: string, queue: string) {
  return controls.withMoveLock(queue, workflowID, async () => {
    const candidate = await moveCandidate(controls, workflowID, latest);
    if ('refused' in candidate) return candidate;
    if (waiting(candidate.status)) {
      if (!(await cancelWaiting(controls, workflowID)))
        return { workflowID, refused: 'it finished before it could be cancelled' };
      candidate.from = continuesFrom((await controls.steps(workflowID)) ?? []);
    }
    await controls.rewind(workflowID, { startStep: candidate.from, applicationVersion: latest, queueName: queue });
    return candidate;
  });
}
/**
 * A client of the engine's database for an operator's move (`scripts/workflows-move.ts`): the engine's controls without
 * an engine, the application's latest version, and what waits under another one. It launches no engine and runs no
 * workflow; the engine of a running server runs what it moves. The client's own warnings and errors go to `warn`.
 */
export async function workflowClient(application: string, warn: (line: string) => void) {
  // DBOS and the move lock must use the same installation database.
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is not set.');
  const logger: DLogger = {
    debug: () => undefined,
    info: () => undefined,
    warn: entry => warn(String(entry)),
    error: entry => warn(String(entry)),
  };
  const client = await DBOSClient.create({ systemDatabaseUrl: databaseUrl, applicationName: application, logger });
  const controls: WorkflowControls = {
    withMoveLock,
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
