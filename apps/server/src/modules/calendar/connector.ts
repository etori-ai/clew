import { Type } from '@sinclair/typebox';
import type { Connector } from '@clew/connectors';
import { CalendarRoomSchema, DayViewSchema, TodayViewSchema, WeekEventsSchema } from '@clew/contracts';
import { systemContext } from '../../system-context';
import type { CalendarUsecases } from './usecases/samtal';
import type { EventUsecases } from './usecases/events';
import { roomsMenu, roomsView } from './views';

/**
 * The calendar as a connector. The provider interface stays the contract (D11); this wraps the module's reads as
 * capabilities, with the outputs typed as the browser's contracts, and declares the two areas. Today, the week and a day
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
export function calendarConnector(
  calendar: Pick<CalendarUsecases, 'readToday' | 'weekView' | 'samtalStatus'>,
  events: Pick<EventUsecases, 'dayView' | 'listRooms'>,
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
        // Läget's calendar tile (D54, artboard 3): the unit's development talks booked out of everyone due one, for the
        // manager; the day itself is I dag beside the column. A unit without members has no figure. A throw is the
        // registry's warning figure.
        figure: async actor => {
          if (actor.role !== 'manager') return null;
          const s = await calendar.samtalStatus(await personaFor(actor.id));
          if (!s.members) return null;
          const done = s.held + s.booked;
          return {
            label: 'Utvecklingssamtal bokade',
            value: `${done} av ${s.members}`,
            comparison: `senast ${s.deadline}`,
            progress: { value: done, max: s.members },
            tone: 'none',
          };
        },
      },
      {
        id: 'utvecklingssamtal',
        title: 'Utvecklingssamtal',
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
        run: async actor => calendar.readToday(await personaFor(actor.id)),
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
        run: async (actor, input: { from?: string }) => calendar.weekView(await personaFor(actor.id), input.from),
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
        run: async (actor, input: { date: string }) => events.dayView(await personaFor(actor.id), input.date),
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
        run: async actor => ({ rows: await events.listRooms(await personaFor(actor.id)) }),
      },
    ],
  };
}
