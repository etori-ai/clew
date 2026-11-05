import { WorkflowExecutionAlreadyStartedError } from '@temporalio/client';
import { temporalClient, TASK_QUEUE } from './client';

export async function startExecutionWorkflow(id: string, executionId: string) {
  const client = await temporalClient();
  try {
    await client.workflow.start('approvedExecution', { workflowId: id, taskQueue: TASK_QUEUE, args: [executionId], workflowIdConflictPolicy: 'USE_EXISTING', workflowIdReusePolicy: 'REJECT_DUPLICATE' });
  } catch (error) {
    // Only our immutable outbox ID can reach this adapter. A closed matching workflow is already delivered.
    if (!(error instanceof WorkflowExecutionAlreadyStartedError)) throw error;
  }
}
