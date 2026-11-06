import { WorkflowExecutionAlreadyStartedError } from '@temporalio/client';
import type { WatchIntent } from '../modules/executions/model';
import { temporalClient, TASK_QUEUE } from './client';

/** A watch step's committed schedule becomes one `jobWatch` workflow (D55, D47); the id carries the intent's generation, so a redelivery meets the running one. */
export async function startWatchWorkflow(intent: WatchIntent) {
  const client = await temporalClient();
  try {
    await client.workflow.start('jobWatch', {
      workflowId: `${intent.id}:${intent.generation}`,
      taskQueue: TASK_QUEUE,
      args: [
        {
          jobId: intent.jobId,
          stepId: intent.stepId,
          generation: intent.generation,
          checks: intent.checks,
          expiresAt: intent.expiresAt,
        },
      ],
      workflowIdConflictPolicy: 'USE_EXISTING',
      workflowIdReusePolicy: 'REJECT_DUPLICATE',
    });
  } catch (error) {
    if (!(error instanceof WorkflowExecutionAlreadyStartedError)) throw error;
  }
}

export async function startExecutionWorkflow(id: string, executionId: string) {
  const client = await temporalClient();
  try {
    await client.workflow.start('approvedExecution', {
      workflowId: id,
      taskQueue: TASK_QUEUE,
      args: [executionId],
      workflowIdConflictPolicy: 'USE_EXISTING',
      workflowIdReusePolicy: 'REJECT_DUPLICATE',
    });
  } catch (error) {
    // Only our immutable outbox ID can reach this adapter. A closed matching workflow is already delivered.
    if (!(error instanceof WorkflowExecutionAlreadyStartedError)) throw error;
  }
}
