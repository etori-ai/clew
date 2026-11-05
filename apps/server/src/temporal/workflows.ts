/**
 * Workflow code. This file runs inside Temporal's deterministic sandbox: it may import only `@temporalio/workflow`
 * and types. Side effects happen in activities (`activities.ts`), which run in Node with the live adapters.
 */
import { condition, defineSignal, proxyActivities, setHandler, sleep } from '@temporalio/workflow';
import type * as activities from './activities';
import type { ReminderInput } from '../threads/model';

const { surfaceReminder, checkObligation, remindInvitees, returnObligation } = proxyActivities<typeof activities>({ startToCloseTimeout: '1 minute', retry: { maximumAttempts: 5 } });
const { progressExecution } = proxyActivities<typeof activities>({ startToCloseTimeout: '1 minute', retry: { maximumAttempts: 5 } });
const { fireTimer } = proxyActivities<typeof activities>({ startToCloseTimeout: '1 minute' });
const { runScheduledJob } = proxyActivities<typeof activities>({ startToCloseTimeout: '1 minute' });
export async function scheduledJob(input: { id: string; dueAt: string }): Promise<void> {
  const wait = Date.parse(input.dueAt) - Date.now();
  if (wait > 0) await sleep(wait);
  while (await runScheduledJob(input.id) === 'busy') await sleep('30 seconds');
}

/** Absolute time: delayed dispatch cannot restart the original duration. Old reminder histories stay unchanged. */
export async function durableReminder(input: { id: string; generation: number; dueAt: string }): Promise<void> {
  let cancelled = false;
  setHandler(defineSignal('cancel'), () => { cancelled = true; });
  await condition(() => cancelled, Math.max(0, Date.parse(input.dueAt) - Date.now()));
  if (!cancelled) await fireTimer(input.id, input.generation);
}

/** Retries re-enter the persisted ledger; a dispatched operation is always investigated before any replay. */
export async function approvedExecution(id: string): Promise<void> {
  for (;;) {
    const state = await progressExecution(id);
    if (state === 'done') return;
    await sleep(state === 'busy' ? '30 seconds' : '2 seconds');
  }
}

export type { ReminderInput };
/** "Glöm det": a reminder can be cancelled until it fires. */
export const cancelReminder = defineSignal('cancel');

/** Ångra on the confirmation ends the follow-ups. */
export const cancelObligation = defineSignal('cancel');
/**
 * The follow-ups of an obligation (D30): look at the replies at every office hour, remind whoever is overdue, and
 * return the thread to the manager on the Friday review or when every reply is in. The policy lives in the activities'
 * use cases; the workflow only keeps time.
 */
export async function obligation(input: { threadId: string; personId: string }): Promise<'answered' | 'deadline' | 'cancelled'> {
  let cancelled = false;
  setHandler(cancelObligation, () => { cancelled = true; });
  for (;;) {
    const step = await checkObligation(input.threadId);
    if (step.action === 'return') { await returnObligation(input.threadId, step.why === 'deadline' ? 'deadline' : 'answered'); return step.why === 'deadline' ? 'deadline' : 'answered'; }
    if (step.action === 'remind') await remindInvitees(input.threadId, step.due);
    await condition(() => cancelled, Math.max(60_000, Date.parse(step.next) - Date.now()));
    if (cancelled) return 'cancelled';
  }
}
/** A person's own timer (D17): wait, then bring the card back to the top of the stream. Cancel ends it quietly. */
export async function reminder(input: ReminderInput): Promise<'fired' | 'cancelled'> {
  let cancelled = false;
  setHandler(cancelReminder, () => { cancelled = true; });
  await condition(() => cancelled, input.seconds * 1000);
  if (cancelled) return 'cancelled';
  await surfaceReminder(input);
  return 'fired';
}
