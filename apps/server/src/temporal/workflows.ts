/**
 * Workflow code. This file runs inside Temporal's deterministic sandbox: it may import only `@temporalio/workflow`
 * and types. Side effects happen in activities (`activities.ts`), which run in Node with the live adapters.
 */
import { condition, defineSignal, proxyActivities, setHandler } from '@temporalio/workflow';
import type * as activities from './activities';
import type { ReminderInput } from '../threads/model';

const { surfaceReminder } = proxyActivities<typeof activities>({ startToCloseTimeout: '1 minute', retry: { maximumAttempts: 5 } });

export type { ReminderInput };
/** "Glöm det": a reminder can be cancelled until it fires. */
export const cancelReminder = defineSignal('cancel');

/** A person's own timer (D17): wait, then bring the card back to the top of the stream. Cancel ends it quietly. */
export async function reminder(input: ReminderInput): Promise<'fired' | 'cancelled'> {
  let cancelled = false;
  setHandler(cancelReminder, () => { cancelled = true; });
  await condition(() => cancelled, input.seconds * 1000);
  if (cancelled) return 'cancelled';
  await surfaceReminder(input);
  return 'fired';
}
