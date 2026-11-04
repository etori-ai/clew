import { Type } from '@sinclair/typebox';
import type { Connector } from '@clew/connectors';
import { today, weekStart } from '@clew/calendar/dates';
import { listWeek, readToday } from './usecases/reads';
import { samtalStatus } from './usecases/samtal';
import { systemContext } from '../../system-context';

/**
 * The calendar as a connector. The provider interface stays the contract (D11); this wraps the existing reads as
 * capabilities and declares the two areas. Proposals keep their own path in `planner.ts`: the human decision
 * endpoint is not a capability and never a tool.
 */
async function personaFor(actorId: string) {
  const persona = await systemContext(actorId, 'connector:calendar');
  if (!persona) throw new Error('Okänd person.');
  return persona;
}
export function calendarConnector(): Connector {
  return {
    id: 'calendar', kind: 'passthrough', source: 'Kalendern',
    areas: [
      { id: 'kalender', title: 'Kalender', roles: ['manager', 'employee'], standing: ['calendar.today', 'calendar.week'], schedules: [],
        figure: async actor => { try { const v = await readToday(await personaFor(actor.id)); const n = v.events.filter(e => !e.allDay).length; const gap = v.gaps[0]; return { label: `${n} möten i dag${gap ? ', lucka ' + new Date(gap.start).toLocaleTimeString('sv-SE', { timeStyle: 'short' }) : ''}`, tone: 'none' }; } catch { return { label: 'Kalendern svarar inte', tone: 'warn' }; } } },
      { id: 'utvecklingssamtal', title: 'Utvecklingssamtal', roles: ['manager'], standing: [], schedules: [{ label: 'Samtal utan tid före deadline', when: 'Varje vardag 06:00' }],
        figure: async actor => { try { const s = await samtalStatus(await personaFor(actor.id)); const total = s.held + s.booked; return { label: `${s.held} hållna, ${s.booked} bokade · senast ${s.deadline}`, tone: total >= 12 ? 'ok' : 'warn' }; } catch { return { label: 'Kalendern svarar inte', tone: 'warn' }; } } },
    ],
    capabilities: [
      { name: 'calendar.today', kind: 'read', title: 'Dagens möten', model: true, description: 'Dagens möten och lediga luckor för den inloggade.',
        input: Type.Object({}, { additionalProperties: false }), output: Type.Any(), scope: () => true, run: async actor => readToday(await personaFor(actor.id)) },
      { name: 'calendar.week', kind: 'read', title: 'Hela veckan', model: true, description: 'Veckans möten för den inloggade. Ange måndagen som from, annars denna vecka.',
        input: Type.Object({ from: Type.Optional(Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' })) }, { additionalProperties: false }), output: Type.Any(), scope: () => true,
        run: async (actor, input: { from?: string }) => { const { view } = await listWeek(await personaFor(actor.id), weekStart(input.from ?? today()), 7); return { from: weekStart(input.from ?? today()), events: view }; } },
    ],
  };
}
