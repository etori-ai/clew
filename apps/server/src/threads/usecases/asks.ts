import type { AuthenticatedContext, DayView, MeetingTimes } from '@clew/contracts';
import { audiencedActorOf, type Registry } from '@clew/connectors';
import { InputError } from '../../context';

/**
 * What the dialog of a write needs to draw its asks (D112 item 10), as reads: for an ask of a meeting time, free times in
 * the person's own calendar and their day. The person must be allowed the action and the action must ask for a meeting
 * at that property, checked on every call; the calendar is reached through the registry as the person, never imported.
 * Nobody else's calendar is read and nothing is written.
 */
export interface MeetingCalendar {
  /** Free times of the ask's length in the person's own calendar; empty when they have no calendar or it cannot be read. */
  free(
    persona: AuthenticatedContext,
    input: { durationMinutes: number; before?: string },
  ): Promise<Array<{ start: string; end: string }>>;
  /** The person's own day, for the dialog to draw; undefined when they have no calendar or it cannot be read. */
  day(persona: AuthenticatedContext, date: string): Promise<DayView | undefined>;
}
export interface AskDeps {
  registry: Pick<Registry, 'allowed'>;
  calendar: MeetingCalendar;
}
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function askUsecases({ registry, calendar }: AskDeps) {
  /**
   * Three free times for the meeting `capability` asks for at `property`, before the day `before` when one is given (a
   * work item's deadline), and the person's own `date` when the dialog draws a day.
   */
  async function meetingTimes(
    persona: AuthenticatedContext,
    capability: string,
    property: string,
    options: { date?: string; before?: string } = {},
  ): Promise<MeetingTimes> {
    if ((options.date && !DAY.test(options.date)) || (options.before && !DAY.test(options.before)))
      throw new InputError('Ogiltigt datum.');
    await persona.authorize();
    const found = registry.allowed(audiencedActorOf(persona), capability);
    const ask =
      found && found.capability.kind !== 'read' ? found.capability.asks?.find(a => a.property === property) : undefined;
    if (ask?.kind !== 'meeting') throw new InputError('Okänd förmåga.');
    const [slots, day] = await Promise.all([
      calendar.free(persona, {
        durationMinutes: ask.durationMinutes,
        ...(options.before ? { before: options.before } : {}),
      }),
      options.date ? calendar.day(persona, options.date) : Promise.resolve(undefined),
    ]);
    await persona.authorize();
    return { durationMinutes: ask.durationMinutes, slots: slots.slice(0, 3), ...(day ? { day } : {}) };
  }
  return { meetingTimes };
}
export type AskUsecases = ReturnType<typeof askUsecases>;
