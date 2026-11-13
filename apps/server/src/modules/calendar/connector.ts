import { Type } from 'typebox';
import type { Connector } from '@clew/connectors';
import {
  CalendarRoomSchema,
  DayViewSchema,
  TodayViewSchema,
  WeekEventsSchema,
  type AuthenticatedContext,
} from '@clew/contracts';
import { systemContext } from '../../system-context';
import type { CalendarUsecases } from './usecases/samtal';
import type { EventUsecases } from './usecases/events';
import { roomsMenu, roomsView } from './views';

/**
 * The calendar as a connector. The provider interface stays the contract (D11); this wraps the module's reads as
 * capabilities, with the outputs typed as the browser's contracts, and declares the two areas, neither with a figure. Today, the week and a day
 * are drawn by the calendar family (D32); the rooms declare a view and can be a tool in the menu (D38, D40). Proposals
 * keep their own path: the human decision endpoint is not a capability and never a tool. The use cases come built from
 * `composition/calendar.ts` (D25).
 */
export const RoomsOutput = Type.Object({ rows: Type.Array(CalendarRoomSchema) }, { additionalProperties: false });
async function personaFor(actorId: string) {
  const persona = await systemContext(actorId, 'connector:calendar');
  if (!persona) throw new Error('Okänd person.');
  return persona;
}
/**
 * What `calendar.freeTimes` answers (D112 item 10): free gaps of the asked length in the reader's own calendar, earliest
 * first; named as `calendar.today` names its free gaps.
 */
export const FreeTimesOutput = Type.Object(
  {
    gaps: Type.Array(
      Type.Object(
        { start: Type.String({ format: 'date-time' }), end: Type.String({ format: 'date-time' }) },
        { additionalProperties: false },
      ),
      { maxItems: 3 },
    ),
  },
  { additionalProperties: false },
);
/** `persona` turns the registry's actor into a use-case persona; the unit tests hand in their own. */
export function calendarConnector(
  calendar: Pick<CalendarUsecases, 'readToday' | 'weekView'>,
  events: Pick<EventUsecases, 'dayView' | 'listRooms' | 'freeTimes'>,
  persona: (actorId: string) => Promise<AuthenticatedContext> = personaFor,
): Connector {
  return {
    id: 'calendar',
    kind: 'passthrough',
    source: 'Kalendern',
    areas: [
      {
        id: 'calendar',
        title: 'Kalender',
        icon: 'calendar',
        roles: ['manager', 'employee'],
        standing: ['calendar.today', 'calendar.week'],
        schedules: [],
      },
      {
        // The planner's area; its id is what its threads are counted by. The talks module's area carries the title
        // "Utvecklingssamtal" and the figure of talks held (D96 item 7), so this one is named for what it does.
        id: 'utvecklingssamtal',
        title: 'Boka utvecklingssamtal',
        roles: ['manager'],
        standing: [],
        schedules: [{ label: 'Samtal utan tid före deadline', when: 'Varje vardag 06:00' }],
      },
    ],
    capabilities: [
      {
        name: 'calendar.today',
        kind: 'read',
        title: 'Dagens möten',
        model: true,
        description: 'Dagens möten och lediga luckor för den inloggade.',
        input: Type.Object({}, { additionalProperties: false }),
        output: TodayViewSchema,
        scope: () => true,
        run: async actor => calendar.readToday(await persona(actor.id)),
      },
      {
        name: 'calendar.week',
        kind: 'read',
        title: 'Hela veckan',
        model: true,
        description: 'Veckans möten för den inloggade. Ange måndagen som from, annars denna vecka.',
        input: Type.Object(
          { from: Type.Optional(Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' })) },
          { additionalProperties: false },
        ),
        output: WeekEventsSchema,
        scope: () => true,
        run: async (actor, input: { from?: string }) => calendar.weekView(await persona(actor.id), input.from),
      },
      {
        name: 'calendar.day',
        kind: 'read',
        title: 'En dag',
        model: true,
        description: 'En dags möten och förslag för den inloggade. Ange dagen som date.',
        input: Type.Object(
          { date: Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' }) },
          { additionalProperties: false },
        ),
        output: DayViewSchema,
        scope: () => true,
        run: async (actor, input: { date: string }) => events.dayView(await persona(actor.id), input.date),
      },
      {
        // The suggestions of a write that asks for a meeting time (D112), and the model's read for planning one (D122
        // item 3): the reader's own calendar only, nobody else's, and nothing is booked.
        name: 'calendar.freeTimes',
        kind: 'read',
        title: 'Lediga tider',
        model: true,
        description:
          'Tre lediga tider av en given längd i din egen kalender, den tidigaste först: från en timme fram och två veckor framåt, eller fram till och med dagen before. Ange längden i minuter som durationMinutes och vid behov sista dagen som before (ÅÅÅÅ-MM-DD). Varje tid har start och slut i svensk tid, i ord. Läser bara din egen kalender och bokar ingenting.',
        input: Type.Object(
          {
            durationMinutes: Type.Integer({ minimum: 5, maximum: 480 }),
            before: Type.Optional(Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' })),
          },
          { additionalProperties: false },
        ),
        output: FreeTimesOutput,
        scope: () => true,
        run: async (actor, input: { durationMinutes: number; before?: string }) => ({
          gaps: (await events.freeTimes(await persona(actor.id), input)).slots,
        }),
      },
      {
        name: 'calendar.rooms',
        kind: 'read',
        title: 'Mötesrum',
        model: true,
        description: 'Rummen som kan bokas i kalendern: namn, antal platser och utrustning.',
        input: Type.Object({}, { additionalProperties: false }),
        output: RoomsOutput,
        view: roomsView,
        menu: roomsMenu,
        scope: () => true,
        run: async actor => ({ rows: await events.listRooms(await persona(actor.id)) }),
      },
    ],
  };
}
