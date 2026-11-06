import type { CalendarEvent, Proposal } from '@clew/contracts';
import { timeLabel } from '@clew/calendar/dates';
import type { AgendaItem } from './week-agenda';

const SAMTAL = 'Utvecklingssamtal';
const live = new Set<Proposal['status']>(['proposed', 'confirmed', 'final', 'accepted']);
/** The assistant's mark (D71, artboard 6): before a proposal's title on every calendar surface, never before a meeting's. */
export const PROPOSAL_MARK = '✦';
/** What the longest free gap of the day says under its row: the assistant books nothing there without asking. */
export const LONGEST_GAP = 'Längsta luckan · jag bokar inget här utan att fråga';

const minutes = (span: { start: string; end: string }) =>
  Math.round((Date.parse(span.end) - Date.parse(span.start)) / 60000);
/** How long an entry is, as the rows write it: "30 min", "1 tim", "1,5 tim". */
export const duration = (span: { start: string; end: string }) => {
  const m = minutes(span);
  return m < 60 ? `${m} min` : `${(m / 60).toLocaleString('sv-SE', { maximumFractionDigits: 1 })} tim`;
};
/** A row's meta line (D71): the length, then the place, or who a samtal is with when it has no place. */
const meta = (span: { start: string; end: string; allDay: boolean }, ...rest: (string | undefined)[]) =>
  [span.allDay ? 'hela dagen' : duration(span), ...rest].filter(Boolean).join(' · ');

/**
 * The one mapping from what the API returns to what every calendar surface draws (D32): a meeting is an `event`, a drawn
 * proposal a `proposal`, a sent samtal (its own event, or a confirmed proposal) a `booked` entry. A samtal event already
 * covered by a proposal is drawn once, as the proposal, so the week never shows the same hour twice. A proposal carries
 * the assistant's mark; every entry carries its meta line. The day's free gaps, when given (I dag on Hem), become `gap`
 * rows, the longest one saying that nothing is booked there without asking; the grid and the week agenda draw no gap.
 */
export function agendaItems(
  events: CalendarEvent[],
  proposals: Proposal[],
  gaps: { start: string; end: string }[] = [],
): AgendaItem[] {
  const rows = proposals.filter(p => live.has(p.status));
  const covered = (e: CalendarEvent) => rows.some(p => p.eventRef && e.id.startsWith(p.eventRef));
  const longest = gaps.reduce<(typeof gaps)[number] | null>(
    (best, g) => (best && minutes(best) >= minutes(g) ? best : g),
    null,
  );
  return [
    ...events
      .filter(e => !e.title.startsWith(SAMTAL))
      .map(e => ({
        id: e.id,
        title: e.title,
        short: e.title.split(' ')[0]!,
        start: e.start,
        end: e.end,
        allDay: e.allDay,
        kind: 'event' as const,
        subtitle: e.participants.length ? e.participants.join(', ') : undefined,
        ...(e.room ? { place: e.room } : {}),
        meta: meta(e, e.room),
        event: e,
      })),
    ...events
      .filter(e => e.title.startsWith(SAMTAL) && !covered(e))
      .map(e => ({
        id: e.id,
        title: e.title,
        short: 'Samtal',
        start: e.start,
        end: e.end,
        allDay: e.allDay,
        kind: 'booked' as const,
        ...(e.room ? { place: e.room } : {}),
        meta: meta(e, e.room),
        event: e,
      })),
    ...rows.map(p => {
      const drawn = p.status === 'proposed';
      const span = { start: p.start, end: p.end, allDay: false };
      return {
        id: p.id,
        title: SAMTAL,
        short: 'Samtal',
        subtitle: p.participant.name,
        ...span,
        kind: drawn ? ('proposal' as const) : ('booked' as const),
        ...(drawn ? { marker: PROPOSAL_MARK } : {}),
        meta: meta(span, p.participant.name),
        proposal: p,
      };
    }),
    ...gaps.map(g => ({
      id: `gap:${g.start}`,
      title: `Ledigt till ${timeLabel(g.end)}`,
      start: g.start,
      end: g.end,
      allDay: false,
      kind: 'gap' as const,
      ...(longest && longest.start === g.start ? { meta: LONGEST_GAP } : {}),
    })),
  ];
}
