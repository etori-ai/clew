import { calendar, fireTimer } from '../composition';
import { executions } from '../composition/executions';
import { runScheduledJob } from '../composition/jobs';
import { valuelessFailures } from '../logging';
import { bindActivities, type Activities } from './workflows';

/**
 * The live activities: each one is a use case from the composition root (D25), bound by name so the workflows in
 * `workflows.ts` stay free of Clew imports and a runtime test can bind its own. Called once by main.ts before launch.
 * A statement that fails in one reaches the engine without its values (D91).
 */
export function bindLiveActivities() {
  const live: Activities = {
    fireTimer,
    progressExecution: id => executions.progress(id),
    /** One check of a job's watch step (D55): the ledger reads as the person at a committed time, or settles the window's end. */
    observeWatch: (jobId, stepId, check) => executions.observe(jobId, stepId, check),
    runScheduledJob,
    /** The obligation's follow-ups (D30): read the replies and plan, remind the overdue, return the thread. */
    checkObligation: threadId => calendar.obligationCheck(threadId),
    remindInvitees: (threadId, due) => calendar.remindInvitees(threadId, 'assistant:obligation', due),
    returnObligation: (threadId, why) => calendar.returnObligation(threadId, why),
  };
  bindActivities(valuelessFailures(live));
}
