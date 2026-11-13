import { DBOS } from '@dbos-inc/dbos-sdk';

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
 * Hands workflows that wait under another version of the application to the version that runs (D85 item 2, as amended
 * 2026-11-13). Only executors of a workflow's own version recover it, so one that a replaced release took from the
 * queue waits under that release for good. Each of `workflowIDs` that is PENDING or ENQUEUED under another version is
 * cancelled, which also ends its wait in a process of that version that still runs, and is rewound to its first step
 * under its own id, on `queue` and under the running version, whose queue runner then takes it. One that is CANCELLED
 * under another version is a move that stopped between the two, and is rewound. A run that a process of the older
 * version had begun can no longer record a step: the rewind takes the workflow from it. Only for a workflow whose
 * ledger fences a second run and that nothing else cancels. The ids moved here.
 */
export async function moveToRunningVersion(workflowIDs: string[], queue: string) {
  const running = DBOS.applicationVersion,
    moved: string[] = [];
  for (const workflowID of workflowIDs) {
    const status = await DBOS.getWorkflowStatus(workflowID);
    if (!status?.applicationVersion || status.applicationVersion === running) continue;
    if (waiting(status.status)) await DBOS.cancelWorkflow(workflowID);
    else if (status.status !== 'CANCELLED') continue;
    try {
      await DBOS.rewindWorkflow(workflowID, { applicationVersion: running, queueName: queue });
    } catch (error) {
      // Another process of this version, starting at the same time, moved it after this one read its status.
      const now = await DBOS.getWorkflowStatus(workflowID);
      if (now && waiting(now.status) && now.applicationVersion === running) continue;
      throw error;
    }
    moved.push(workflowID);
  }
  return moved;
}
