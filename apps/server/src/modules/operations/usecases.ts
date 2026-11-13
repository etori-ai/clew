import type { AuthenticatedContext } from '@clew/contracts';
import { ForbiddenError } from '../../context';
export interface ReliabilityCounts {
  pendingExecutions: number;
  oldestPendingSeconds: number;
  unknownExecutions: number;
  undeliveredExecutions: number;
  oldestOutboxSeconds: number;
  queuedTimers: number;
  overdueTimers: number;
  blockedTimers: number;
  staleSources: number;
  blockedFollowups: number;
  legacyJobsAwaitingDrain: number;
  /**
   * Scheduled jobs whose claim's lease ended more than five minutes ago without a completion: a run renews its lease
   * while it lasts, so such a job's run stopped, and no workflow has claimed it again.
   */
  stalledJobs: number;
  /**
   * Scheduled jobs whose run has held its claim for more than ten minutes and still renews it: every job takes seconds,
   * so such a run waits on something that does not answer, and it keeps its job until it settles or its process stops
   * (`JOB_RUN_LONG_MS` in the scheduler).
   */
  longRunningJobs: number;
}
export function operationsUsecases(read: () => Promise<ReliabilityCounts>) {
  return {
    async reliability(persona: AuthenticatedContext) {
      await persona.authorize();
      if (!persona.capabilities.includes('admin.connectors')) throw new ForbiddenError();
      return read();
    },
  };
}
