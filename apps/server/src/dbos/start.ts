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
