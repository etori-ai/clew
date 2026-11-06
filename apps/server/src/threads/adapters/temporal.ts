import { TASK_QUEUE, temporalClient } from '../../temporal/client';
import type { ReminderTimers } from '../model';

/** The reminder timers on Temporal (D17): one `reminder` workflow per request, cancelled by signal. */
export function temporalTimers(): ReminderTimers {
  return {
    async start(input) {
      const client = await temporalClient();
      const { workflowId, ...args } = input;
      // The workflow is `reminder` in temporal/workflows.ts; named rather than typed so this adapter does not pull the workflow module (and through it the activities and the composition root) into its import graph.
      await client.workflow.start('reminder', { taskQueue: TASK_QUEUE, workflowId, args: [args] });
    },
    async cancel(workflowId) {
      try {
        const client = await temporalClient();
        await client.workflow.getHandle(workflowId).signal('cancel');
      } catch {
        /* already fired or gone: the caller corrects the card state regardless */
      }
    },
  };
}
