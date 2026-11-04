import type { CalendarEvent, Proposal } from '@clew/contracts';
import type { AgendaItem } from './week-agenda';

const SAMTAL = 'Utvecklingssamtal';
const live = new Set<Proposal['status']>(['proposed', 'confirmed', 'final', 'accepted']);

/**
 * The one mapping from what the API returns to what every calendar surface draws (D32): a meeting is an `event`, a drawn
 * proposal a `proposal`, a sent samtal (its own event, or a confirmed proposal) a `booked` entry. A samtal event already
 * covered by a proposal is drawn once, as the proposal, so the week never shows the same hour twice.
 */
export function agendaItems(events: CalendarEvent[], proposals: Proposal[]): AgendaItem[] {
  const rows = proposals.filter(p => live.has(p.status));
  const covered = (e: CalendarEvent) => rows.some(p => p.eventRef && e.id.startsWith(p.eventRef));
  return [
    ...events.filter(e => !e.title.startsWith(SAMTAL)).map(e => ({ id: e.id, title: e.title, short: e.title.split(' ')[0]!, start: e.start, end: e.end, allDay: e.allDay, kind: 'event' as const, subtitle: e.participants.length ? e.participants.join(', ') : undefined, event: e })),
    ...events.filter(e => e.title.startsWith(SAMTAL) && !covered(e)).map(e => ({ id: e.id, title: e.title, short: 'Samtal', start: e.start, end: e.end, allDay: e.allDay, kind: 'booked' as const, event: e })),
    ...rows.map(p => ({ id: p.id, title: SAMTAL, short: 'Samtal', subtitle: p.participant.name, start: p.start, end: p.end, allDay: false, kind: p.status === 'proposed' ? 'proposal' as const : 'booked' as const, proposal: p })),
  ];
}
