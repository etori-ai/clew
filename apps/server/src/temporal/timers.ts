import { WorkflowExecutionAlreadyStartedError, WorkflowNotFoundError } from '@temporalio/client';
import type { TimerIntent } from '../threads/model';
import { temporalClient, TASK_QUEUE } from './client';

export async function deliverTimer(timer: TimerIntent) {
  const client = await temporalClient();
  const id = `${timer.id}:v2:${timer.generation}`;
  if (timer.state === 'active') {
    try {
      await client.workflow.start('durableReminder', {
        workflowId: id,
        taskQueue: TASK_QUEUE,
        args: [{ id: timer.id, generation: timer.generation, dueAt: timer.dueAt }],
        workflowIdConflictPolicy: 'USE_EXISTING',
        workflowIdReusePolicy: 'REJECT_DUPLICATE',
      });
    } catch (error) {
      if (!(error instanceof WorkflowExecutionAlreadyStartedError)) throw error;
    }
  } else {
    try {
      await client.workflow.getHandle(id).signal('cancel');
    } catch (error) {
      if (!(error instanceof WorkflowNotFoundError)) throw error;
    }
  }
}
