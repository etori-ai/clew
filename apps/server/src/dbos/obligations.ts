import type { ObligationTimers } from '../modules/calendar/model';
import { cancelDurable, startDurable } from './start';
import { obligation } from './workflows';

export const obligationWorkflowId = (threadId: string) => `obligation:${threadId}`;
/** The follow-up workflow (D30): one `obligation` workflow per proposal thread, idempotent by thread, cancelled by undo. Composition pairs it with the port. */
export function durableObligations(): ObligationTimers {
  return {
    async start(input) {
      await startDurable(obligation, obligationWorkflowId(input.threadId), input);
    },
    async cancel(threadId) {
      try {
        await cancelDurable(obligationWorkflowId(threadId));
      } catch {
        /* already finished or gone: the records say what happened regardless */
      }
    },
  };
}
