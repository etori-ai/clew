import { calendar, fireTimer } from '../composition';
import { competence } from '../composition/competence';
import { executions } from '../composition/executions';
import { runScheduledJob } from '../composition/jobs';
import { COPY_ACTOR, RECONCILE_ACTOR } from '../modules/competence/usecases';
import { bindActivities } from './workflows';

/**
 * The live activities: each one is a use case from the composition root (D25), bound by name so the workflows in
 * `workflows.ts` stay free of Clew imports and a runtime test can bind its own. Called once by main.ts before launch.
 */
export function bindLiveActivities() {
  bindActivities({
    fireTimer,
    progressExecution: id => executions.progress(id),
    /** One check of a job's watch step (D55): the ledger reads as the person at a committed time, or settles the window's end. */
    observeWatch: (jobId, stepId, check) => executions.observe(jobId, stepId, check),
    runScheduledJob,
    /** The obligation's follow-ups (D30): read the replies and plan, remind the overdue, return the thread. */
    checkObligation: threadId => calendar.obligationCheck(threadId),
    remindInvitees: (threadId, due) => calendar.remindInvitees(threadId, 'assistant:obligation', due),
    returnObligation: (threadId, why) => calendar.returnObligation(threadId, why),
    /** The competence copy (D108 item 9): the next day's run, the sources to read, and one source read to the end. */
    scheduleCompetenceCopy: () => competence.scheduleCopy(),
    competenceSources: only => competence.copySources(only),
    copyHoldings: async (run, source, signal) =>
      (await competence.copySource(COPY_ACTOR, run, source, signal ? { signal } : {})).outcome,
    /** The daily reconciliation of the approvals' cards (D108 item 7) with who can decide each now. */
    reconcileApprovals: () => competence.reconcileApprovals(RECONCILE_ACTOR),
  });
}
