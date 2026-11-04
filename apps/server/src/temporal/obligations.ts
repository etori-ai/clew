import { TASK_QUEUE, temporalClient } from './client';
import type { ObligationTimers } from '../modules/calendar/model';

/** The follow-up workflow on Temporal (D30): one `obligation` workflow per proposal thread, cancelled by signal. Lives beside the client because a module never imports the platform; composition pairs it with the port. */
export function temporalObligations(): ObligationTimers {
  return {
    async start(input) {
      const client = await temporalClient();
      // Named rather than typed so this adapter does not pull the workflow module (and the composition root) into itself. Idempotent by thread.
      try { await client.workflow.start('obligation', { taskQueue: TASK_QUEUE, workflowId: `obligation:${input.threadId}`, args: [input] }); }
      catch (error) { if (!(error instanceof Error && error.name === 'WorkflowExecutionAlreadyStartedError')) throw error; }
    },
    async cancel(threadId) {
      try { const client = await temporalClient(); await client.workflow.getHandle(`obligation:${threadId}`).signal('cancel'); }
      catch { /* already finished or gone: the records say what happened regardless */ }
    },
  };
}
