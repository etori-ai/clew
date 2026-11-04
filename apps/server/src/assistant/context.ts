import type { CalendarEvent, SearchHit, Thread } from '@clew/contracts';
import { shortDayLabel, timeRange } from '@clew/calendar/dates';

/** A chip resolved against what the person may actually see. Labels from the browser are never trusted. */
export type ResolvedObject =
  | { kind: 'thread'; ref: string; thread: Thread }
  | { kind: 'item'; ref: string; thread: Thread; item: Thread['items'][number] }
  | { kind: 'proposal'; ref: string; thread: Thread; proposal: Thread['proposals'][number] }
  | { kind: 'event'; ref: string; event: CalendarEvent }
  | { kind: 'capability'; ref: string; name: string; title: string; source: string }
  | { kind: 'document'; ref: string; hit: SearchHit };

const day = (iso: string) => shortDayLabel(iso.slice(0, 10));
/** Swedish lines for the system prompt's "Du tittar på" block. Names appear here only because the person pointed at the object. */
export function serialiseContext(objects: ResolvedObject[]): string[] {
  return objects.map(o => {
    switch (o.kind) {
      case 'thread': {
        const t = o.thread;
        const rows = t.items.map(i => `${i.label} · ${i.detail}${i.selectable ? (i.selected ? ' [vald]' : ' [avmarkerad]') : ''}`);
        const proposals = t.proposals.filter(p => p.status === 'proposed').map(p => `${p.participant.name} ${day(p.start)} ${timeRange(p.start, p.end)}`);
        const actions = t.actions.map(a => `${a.label} (${a.role})`);
        return `Kort "${t.title}" (${t.trigger.source}, område ${t.area}${t.deadline ? ', senast ' + t.deadline : ''}). ${t.summary}` +
          (rows.length ? ` Rader: ${rows.join('; ')}.` : '') + (proposals.length ? ` Förslag: ${proposals.join('; ')}.` : '') + (actions.length ? ` Knappar: ${actions.join(', ')}.` : '');
      }
      case 'item': return `Rad "${o.item.label} · ${o.item.detail}" i kortet "${o.thread.title}" (${o.thread.trigger.source}).`;
      case 'proposal': return `Förslaget ${o.proposal.participant.name} ${day(o.proposal.start)} ${timeRange(o.proposal.start, o.proposal.end)} i kortet "${o.thread.title}".`;
      case 'event': return `Mötet "${o.event.title}" ${day(o.event.start)} ${o.event.allDay ? 'heldag' : timeRange(o.event.start, o.event.end)}${o.event.room ? ', ' + o.event.room : ''} i kalendern.`;
      case 'capability': return `Förmågan "${o.title}" (${o.source}).`;
      case 'document': {
        const h = o.hit;
        const kept = [h.owner, h.reviewedAt ?? h.updatedAt ? 'granskad ' + (h.reviewedAt ?? h.updatedAt)!.slice(0, 10) : undefined].filter(Boolean).join(', ');
        return `Avsnitt "${h.label}${h.section ? ', ' + h.section : ''}" ur ${h.source}${kept ? ` (${kept})` : ''}: "${h.snippet}"`;
      }
    }
  });
}
