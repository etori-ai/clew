import { Type } from '@sinclair/typebox';
import type { Connector } from '@clew/connectors';
import { systemContext } from '../../system-context';
import type { CalendarUsecases } from './usecases/samtal';

/**
 * The calendar as a connector. The provider interface stays the contract (D11); this wraps the module's reads as
 * capabilities and declares the two areas. Proposals keep their own path: the human decision endpoint is not a
 * capability and never a tool. The use cases come built from `composition/calendar.ts` (D25).
 */
async function personaFor(actorId: string) {
  const persona = await systemContext(actorId, 'connector:calendar');
  if (!persona) throw new Error('Okänd person.');
  return persona;
}
export function calendarConnector(calendar: Pick<CalendarUsecases, 'readToday' | 'weekView' | 'samtalStatus'>): Connector {
  return {
    id: 'calendar', kind: 'passthrough', source: 'Kalendern',
    areas: [
      { id: 'kalender', title: 'Kalender', roles: ['manager', 'employee'], standing: ['calendar.today', 'calendar.week'], schedules: [],
        figure: async actor => { try { const v = await calendar.readToday(await personaFor(actor.id)); const n = v.events.filter(e => !e.allDay).length; const gap = v.gaps[0]; return { label: `${n} möten i dag${gap ? ', lucka ' + new Date(gap.start).toLocaleTimeString('sv-SE', { timeStyle: 'short' }) : ''}`, tone: 'none' }; } catch { return { label: 'Kalendern svarar inte', tone: 'warn' }; } } },
      { id: 'utvecklingssamtal', title: 'Utvecklingssamtal', roles: ['manager'], standing: [], schedules: [{ label: 'Samtal utan tid före deadline', when: 'Varje vardag 06:00' }],
        figure: async actor => { try { const s = await calendar.samtalStatus(await personaFor(actor.id)); const total = s.held + s.booked; return { label: `${s.held} hållna, ${s.booked} bokade · senast ${s.deadline}`, tone: total >= 12 ? 'ok' : 'warn' }; } catch { return { label: 'Kalendern svarar inte', tone: 'warn' }; } } },
    ],
    capabilities: [
      { name: 'calendar.today', kind: 'read', title: 'Dagens möten', model: true, description: 'Dagens möten och lediga luckor för den inloggade.',
        input: Type.Object({}, { additionalProperties: false }), output: Type.Any(), scope: () => true, run: async actor => calendar.readToday(await personaFor(actor.id)) },
      { name: 'calendar.week', kind: 'read', title: 'Hela veckan', model: true, description: 'Veckans möten för den inloggade. Ange måndagen som from, annars denna vecka.',
        input: Type.Object({ from: Type.Optional(Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' })) }, { additionalProperties: false }), output: Type.Any(), scope: () => true,
        run: async (actor, input: { from?: string }) => calendar.weekView(await personaFor(actor.id), input.from) },
    ],
  };
}
