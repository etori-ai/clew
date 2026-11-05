import type { ReminderInput } from '../threads/model';
import { calendar, fireTimer as deliverTimer, fireLegacyReminder } from '../composition';
import { executions } from '../composition/executions';
export const progressExecution = (id: string) => executions.progress(id);
export { runScheduledJob } from '../composition/jobs';

/**
 * Activities run in Node with the live adapters. Each one is a use case from the composition root (D25): the
 * workflow in `workflows.ts` proxies them by name, so this file stays a thin binding.
 */
export const surfaceReminder = (input: ReminderInput) => fireLegacyReminder(input);
export const fireTimer = (id: string, generation: number) => deliverTimer(id, generation);
/** The obligation's follow-ups (D30): read the replies and plan, remind the overdue, return the thread. */
export const checkObligation = (threadId: string) => calendar.obligationCheck(threadId);
export const remindInvitees = (threadId: string, due: string[]) => calendar.remindInvitees(threadId, 'assistant:obligation', due).then(() => undefined);
export const returnObligation = (threadId: string, why: 'answered' | 'deadline') => calendar.returnObligation(threadId, why);
