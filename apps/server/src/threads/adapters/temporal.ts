import { TASK_QUEUE, temporalClient } from '../../temporal/client';
import type { reminder } from '../../temporal/workflows';
import type { ReminderTimers } from '../model';

/** The reminder timers on Temporal (D17): one `reminder` workflow per request, cancelled by signal. */
export function temporalTimers(): ReminderTimers {
  return {
    async start(input) {
      const client = await temporalClient();
      const { workflowId, ...args } = input;
      await client.workflow.start<typeof reminder>('reminder', { taskQueue: TASK_QUEUE, workflowId, args: [args] });
    },
    async cancel(workflowId) {
      try { const client = await temporalClient(); await client.workflow.getHandle(workflowId).signal('cancel'); }
      catch { /* already fired or gone: the caller corrects the card state regardless */ }
    },
  };
}
