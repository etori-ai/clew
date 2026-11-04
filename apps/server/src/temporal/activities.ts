import type { ReminderInput } from '../threads/model';
import { reminders } from '../composition';

/**
 * Activities run in Node with the live adapters. Each one is a use case from the composition root (D25): the
 * workflow in `workflows.ts` proxies them by name, so this file stays a thin binding.
 */
export const surfaceReminder = (input: ReminderInput) => reminders.surface(input);
