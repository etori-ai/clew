import type { AuthenticatedContext, CalendarEvent, Prepared } from '@clew/contracts';
import { dayLabel, displayDate, localInstant, timeRange } from '@clew/calendar/dates';
import type { AssistantDeps } from './ports';
import type { ClewTool } from './model';

/**
 * A prepared decision (the product owner, 2026-11-18): one of Clew's own human decisions, filled in and checked by the
 * assistant and not sent. Two kinds, both about a meeting of the person's own: a new time (`calendar.move`), drawn in
 * the page's move form and saved with its button through the calendar's decision (`rescheduleEvent`,
 * `modules/calendar/usecases/decisions.ts`), and a cancellation (`calendar.cancel`), asked as the page's own "Ställ in
 * mötet?" and sent only by the person's answer (`cancelEvent`). The decision checks everything again. The tools are
 * Clew's own and write nothing: calendar writes are never capabilities and never tools (D45, D47, D112 item 8).
 *
 * The model never names the meeting: `ref`, `id` and `revision` are stripped from what it reads (`modelReading`), so the
 * tools close over the meeting that stands open beside the conversation, resolved fresh on the server for this turn.
 * Each call reports to the same callback, so the last prepared decision of a turn is its answer's, whichever kind.
 */
export const PREPARE_MOVE_TOOL = 'clew.prepareMove';
export const PREPARE_CANCEL_TOOL = 'clew.prepareCancel';
/** Every prepare tool: none of their calls is a read of the turn's. */
export const PREPARE_TOOLS: readonly string[] = [PREPARE_MOVE_TOOL, PREPARE_CANCEL_TOOL];
/**
 * The two decisions as the pane says what the assistant may fill in (D133 item 7): one meeting offers both or neither
 * (`whyNotChangeable`).
 */
export const PREPARED_TITLES: readonly string[] = ['Flytta mötet', 'Ställ in mötet'];

/**
 * Why the person cannot move or cancel this meeting from Clew, in Swedish for the model, or undefined when they can:
 * the rules of the decision's `ownEvent` (a single timed meeting the person may change), and that they organise it.
 * Moving and cancelling share them, so a meeting offers both or neither.
 */
export function whyNotChangeable(
  event: Pick<CalendarEvent, 'mine' | 'canCancel' | 'recurring' | 'allDay'>,
): string | undefined {
  if (!event.mine) return 'Bara organisatören kan flytta eller ställa in mötet.';
  if (!event.canCancel) return 'Mötet går inte att flytta eller ställa in härifrån.';
  if (event.recurring) return 'Ett återkommande möte går inte att flytta eller ställa in härifrån.';
  if (event.allDay) return 'En heldag går inte att flytta eller ställa in härifrån.';
  return undefined;
}

const LOCAL_TIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
/** Whether the first ten characters are a day the calendar has (`2026-02-30` is not one). */
const realDay = (value: string) => {
  const day = value.slice(0, 10);
  const parsed = new Date(day + 'T00:00:00Z');
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day;
};
/**
 * A time as the model writes it, as an instant, or undefined when it is not one. The model reads times in words in
 * Swedish time (D122), so a clock time without an offset is the Stockholm time it says; one that Stockholm skips or has
 * twice is refused, never shifted (`localInstant`). An instant with its offset is taken as it is. Nothing else is a time.
 */
function instantOf(value: unknown): string | undefined {
  if (typeof value !== 'string' || !realDay(value)) return undefined;
  if (LOCAL_TIME.test(value)) {
    try {
      return new Date(localInstant(value.replace(' ', 'T'))).toISOString();
    } catch {
      return undefined;
    }
  }
  if (!INSTANT.test(value)) return undefined;
  const at = Date.parse(value);
  return Number.isNaN(at) ? undefined : new Date(at).toISOString();
}

/** What the tool tells the model once the time is in the form: nothing is saved, the person saves it. */
const PREPARED_NOTE = 'Tiden står i formuläret hos personen. Inget är sparat; personen sparar själv.';
/** Whether the person has anything else then, as the model is told it: a count, never what the meetings are. */
function ownLine(others: number | undefined): string {
  if (others === undefined) return 'Personens kalender gick inte att läsa för den tiden.';
  if (others === 0) return 'Personen har inget annat i kalendern då.';
  return `Personen har redan ${others === 1 ? 'ett annat möte' : `${others} andra möten`} i kalendern då; säg det.`;
}

/**
 * How many of the person's other timed meetings overlap a window, read from their own calendar for the day the window
 * starts on (`listWeek`, the route the assistant already reaches the calendar by); undefined when it cannot be read.
 * The meeting being moved is not one of them, so a move by half an hour does not collide with itself. Nobody else's
 * calendar is read: the event carries its participants by name, and a name is not an address (stage 2's
 * `calendar.meetingTimes` reads the team's free-busy).
 */
export function ownOverlaps(
  calendar: Pick<AssistantDeps['calendar'], 'listWeek'>,
  persona: AuthenticatedContext,
  moving: Pick<CalendarEvent, 'id'>,
): (start: string, end: string) => Promise<number | undefined> {
  return async (start, end) => {
    const from = Date.parse(start),
      to = Date.parse(end);
    try {
      const { view } = await calendar.listWeek(persona, displayDate(start), 1);
      return view.filter(e => e.id !== moving.id && !e.allDay && Date.parse(e.start) < to && from < Date.parse(e.end))
        .length;
    } catch {
      return undefined;
    }
  };
}

/**
 * The tool the model prepares a move with, for the one meeting that stands open beside the conversation. It checks what
 * the decision will check, in its words where it has them: the meeting is the person's to move (`whyNotChangeable`), the
 * new time is a time, ends after it starts, lies on one Stockholm day, has not passed at `now` (the turn's), and is not
 * where the meeting already is. A time that does not pass is answered with the Swedish reason so the model can correct
 * it, and nothing is kept of it. A time that passes is heard by `prepared` (a later one in the same turn replaces it),
 * and the model is told whether the person has anything else then (`overlapping`). Nothing is written anywhere.
 */
export function prepareMoveTool(args: {
  event: CalendarEvent;
  now: string;
  prepared: (decision: Prepared) => void;
  overlapping?: (start: string, end: string) => Promise<number | undefined>;
}): ClewTool {
  const { event, now, prepared, overlapping } = args;
  const minutes = Math.round((Date.parse(event.end) - Date.parse(event.start)) / 60_000);
  const at = event.allDay ? 'heldag' : `${dayLabel(displayDate(event.start))} ${timeRange(event.start, event.end)}`;
  return {
    name: PREPARE_MOVE_TOOL,
    description:
      `Fyll i en ny tid för mötet "${event.title}", som står öppet bredvid samtalet (nu ${at}` +
      (Number.isFinite(minutes) && minutes > 0 ? `, ${minutes} minuter` : '') +
      '). Ingenting sparas eller skickas: tiden visas i mötets flytta-formulär hos personen, som sparar själv.',
    input: {
      type: 'object',
      properties: {
        start: {
          type: 'string',
          description: 'Ny starttid i svensk tid som ÅÅÅÅ-MM-DDTHH:MM, till exempel 2026-11-19T13:00.',
        },
        end: {
          type: 'string',
          description: 'Ny sluttid i svensk tid som ÅÅÅÅ-MM-DDTHH:MM, samma dag som starttiden.',
        },
      },
      required: ['start', 'end'],
      additionalProperties: false,
    },
    execute: async input => {
      const why = whyNotChangeable(event);
      if (why) return { error: why };
      const start = instantOf(input.start),
        end = instantOf(input.end);
      if (!start || !end)
        return { error: 'Skriv tiderna i svensk tid som ÅÅÅÅ-MM-DDTHH:MM, till exempel 2026-11-19T13:00.' };
      const from = Date.parse(start),
        to = Date.parse(end);
      // The decision's own words where it has them (`window` in decisions.ts).
      if (to <= from) return { error: 'Sluttiden måste vara efter starttiden.' };
      // A meeting that ends at midnight still ends on the day it started.
      if (displayDate(start) !== displayDate(new Date(to - 1).toISOString()))
        return { error: 'Mötet ska börja och sluta samma dag.' };
      if (from <= Date.parse(now)) return { error: 'Tiden har redan passerat.' };
      if (from === Date.parse(event.start) && to === Date.parse(event.end))
        return { error: 'Mötet ligger redan på den tiden.' };
      prepared({
        kind: 'calendar.move',
        event: { id: event.id, title: event.title, start: event.start, end: event.end },
        start,
        end,
      });
      return {
        prepared: true,
        note: [
          PREPARED_NOTE,
          ...(overlapping ? [ownLine(await overlapping(start, end))] : []),
          'Om deltagarna är lediga då vet du inte: deras kalendrar läses inte här.',
        ].join(' '),
      };
    },
  };
}

/**
 * The tool the model prepares a cancellation with, for the same meeting and on the same terms as a move
 * (`whyNotChangeable`). It takes nothing: which meeting is the one open beside the conversation. It is heard by
 * `prepared` like a move, and the page asks the person its own "Ställ in mötet?"; nothing is cancelled until they
 * answer it there. Nothing is written anywhere and no source is reached.
 */
export function prepareCancelTool(args: { event: CalendarEvent; prepared: (decision: Prepared) => void }): ClewTool {
  const { event, prepared } = args;
  const at = event.allDay ? 'heldag' : `${dayLabel(displayDate(event.start))} ${timeRange(event.start, event.end)}`;
  return {
    name: PREPARE_CANCEL_TOOL,
    description:
      `Förbered att mötet "${event.title}", som står öppet bredvid samtalet (${at}), ställs in. Ingenting ställs in ` +
      'eller skickas: personen får frågan "Ställ in mötet?" och svarar själv.',
    input: { type: 'object', properties: {}, additionalProperties: false },
    execute: () => {
      const why = whyNotChangeable(event);
      if (why) return { error: why };
      prepared({
        kind: 'calendar.cancel',
        event: { id: event.id, title: event.title, start: event.start, end: event.end },
      });
      return {
        prepared: true,
        note: 'Frågan "Ställ in mötet?" visas nu för personen. Inget är inställt förrän personen har svarat på den.',
      };
    },
  };
}
