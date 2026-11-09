import type { TimerIntent } from '../threads/model';
import { cancelDurable, startDurable } from './start';
import { durableReminder } from './workflows';

export const reminderWorkflowId = (timer: Pick<TimerIntent, 'id' | 'generation'>) =>
  `${timer.id}:v2:${timer.generation}`;
/** The timer outbox's delivery (D47): the current generation starts, every other state cancels its workflow. */
export async function deliverTimer(timer: TimerIntent) {
  const id = reminderWorkflowId(timer);
  if (timer.state === 'active')
    await startDurable(durableReminder, id, { id: timer.id, generation: timer.generation, dueAt: timer.dueAt });
  else await cancelDurable(id);
}
