import type { WatchIntent } from '../modules/executions/model';
import { startDurable } from './start';
import { approvedExecution, jobWatch } from './workflows';

export const watchWorkflowId = (intent: Pick<WatchIntent, 'id' | 'generation'>) => `${intent.id}:${intent.generation}`;
/** A watch step's committed schedule becomes one `jobWatch` workflow (D55, D47); the id carries the intent's generation, so a redelivery meets the running one. */
export async function startWatchWorkflow(intent: WatchIntent) {
  await startDurable(jobWatch, watchWorkflowId(intent), {
    jobId: intent.jobId,
    stepId: intent.stepId,
    generation: intent.generation,
    checks: intent.checks,
    expiresAt: intent.expiresAt,
  });
}
/** Only the immutable outbox id reaches this adapter (D45). A finished workflow under it is already delivered. */
export async function startExecutionWorkflow(id: string, executionId: string) {
  await startDurable(approvedExecution, id, executionId);
}
