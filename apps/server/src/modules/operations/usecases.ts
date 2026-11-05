import type { AuthenticatedContext } from '@clew/contracts';
import { ForbiddenError } from '../../context';
export interface ReliabilityCounts {
  pendingExecutions: number; oldestPendingSeconds: number; unknownExecutions: number;
  undeliveredExecutions: number; oldestOutboxSeconds: number; queuedTimers: number; overdueTimers: number;
  blockedTimers: number; staleSources: number; blockedFollowups: number; legacyJobsAwaitingDrain: number;
}
export function operationsUsecases(read: () => Promise<ReliabilityCounts>) {
  return { async reliability(persona: AuthenticatedContext) {
    await persona.authorize();
    if (!persona.capabilities.includes('admin.connectors')) throw new ForbiddenError();
    return read();
  } };
}
