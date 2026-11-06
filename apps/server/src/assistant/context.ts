import { isSnoozed, type CalendarEvent, type ReceiptRow, type SearchHit, type Thread } from '@clew/contracts';
import { shortDayLabel, timeLabel, timeRange } from '@clew/calendar/dates';

/** A chip resolved against what the person may actually see. Labels from the browser are never trusted. */
export type ResolvedObject =
  | { kind: 'thread'; ref: string; thread: Thread }
  | { kind: 'item'; ref: string; thread: Thread; item: Thread['items'][number] }
  | { kind: 'proposal'; ref: string; thread: Thread; proposal: Thread['proposals'][number] }
  | { kind: 'event'; ref: string; event: CalendarEvent }
  | { kind: 'capability'; ref: string; name: string; title: string; source: string }
  | { kind: 'document'; ref: string; hit: SearchHit };

const day = (iso: string) => shortDayLabel(iso.slice(0, 10));
const outcome: Record<ReceiptRow['outcome'], string> = {
  done: 'klart',
  unknown: 'okänt',
  failed: 'misslyckades',
  skipped: 'inte skickad',
};
/**
 * The card's state and the buttons it shows right now, by the rules of the card's action row
 * (`apps/web/src/components/card.tsx`, `ActionRow`). The model is told to name only these: a card already acted on shows
 * Ångra allt while the window is open, and its own buttons (Godkänn, Avslå) come back only after Ångra allt.
 */
function cardState(t: Thread, now: string): string {
  const primary = t.actions.find(a => a.role === 'primary');
  const secondary = t.actions.filter(a => a.role === 'secondary').slice(0, 2);
  const overflow = t.actions.filter(a => a.role === 'overflow' || (a.role === 'secondary' && !secondary.includes(a)));
  const more = (...own: string[]) =>
    `Fler val (${[...overflow.map(a => a.label), ...own, 'Lägg till i samtalet', 'Avfärda', 'Varför ser jag detta?'].join(', ')})`;
  const buttons = (labels: string[]) =>
    labels.length ? ` Knappar på kortet nu: ${labels.join(', ')}.` : ' Kortet har inga knappar nu.';
  if (t.state === 'dismissed') return ' Kortet är avfärdat.' + buttons([]);
  if (t.state === 'handled') {
    const r = t.receipt;
    if (!r) {
      const undoUntil = t.proposals
        .map(p => p.undoUntil)
        .filter((v): v is string => !!v)
        .sort()
        .at(-1);
      const undoOpen =
        !!undoUntil && Date.parse(undoUntil) > Date.parse(now) && t.proposals.some(p => p.status === 'confirmed');
      return (
        ' Kortet är hanterat.' +
        (undoOpen ? ` Ångra allt tar tillbaka inbjudningarna fram till ${timeLabel(undoUntil)}.` : '')
      );
    }
    const done = ` Kortet är redan hanterat${t.handledAt ? ' ' + timeLabel(t.handledAt) : ''}: ${r.headline} Kvitto: ${r.rows.map(x => `${x.label} · ${x.detail} (${outcome[x.outcome]})`).join('; ')}.`;
    const undoOpen = !!r.undoCapability && !!r.undoUntil && Date.parse(r.undoUntil) > Date.parse(now);
    if (!undoOpen)
      return done + ` Det går inte längre att ångra i Startsidan; en ändring görs i ${t.trigger.source}.` + buttons([]);
    const own = [primary, ...secondary].filter(a => !!a && a.kind !== 'read').map(a => a!.label);
    return (
      done +
      buttons([
        `Ångra allt (fram till ${timeLabel(r.undoUntil!)})`,
        ...secondary.filter(a => a.kind === 'read').map(a => a.label),
      ]) +
      ` Ångra allt tar tillbaka det som gjordes i ${t.trigger.source}${own.length ? ` och först därefter visar kortet ${own.join(' och ')} igen` : ''}.`
    );
  }
  if (isSnoozed(t, now)) return ' Kortet ligger under Inte nu.' + buttons(['Ta upp nu', more()]);
  if (t.waitingOn) return ` Kortet väntar på ${t.waitingOn}.` + buttons(['Påminn mig', more()]);
  return buttons([...(primary ? [primary.label] : []), ...secondary.map(a => a.label), 'Inte nu', more()]);
}
/**
 * Swedish lines for the system prompt's "Du tittar på" block. Names appear here only because the person pointed at the
 * object. `now` (an instant) decides whether a card's undo window is still open; chips are resolved again every turn, so
 * the state is the card's as it is now, not as it was when it was added.
 */
export function serialiseContext(objects: ResolvedObject[], now: string): string[] {
  return objects.map(o => {
    switch (o.kind) {
      case 'thread': {
        const t = o.thread;
        const rows = t.items.map(
          i => `${i.label} · ${i.detail}${i.selectable ? (i.selected ? ' [vald]' : ' [avmarkerad]') : ''}`,
        );
        const proposals = t.proposals
          .filter(p => p.status === 'proposed')
          .map(p => `${p.participant.name} ${day(p.start)} ${timeRange(p.start, p.end)}`);
        return (
          `Kort "${t.title}" (${t.trigger.source}, område ${t.area}${t.deadline ? ', senast ' + t.deadline : ''}). ${t.summary}` +
          (rows.length ? ` Rader: ${rows.join('; ')}.` : '') +
          (proposals.length ? ` Förslag: ${proposals.join('; ')}.` : '') +
          cardState(t, now)
        );
      }
      case 'item':
        return `Rad "${o.item.label} · ${o.item.detail}" i kortet "${o.thread.title}" (${o.thread.trigger.source}).${cardState(o.thread, now)}`;
      case 'proposal':
        return `Förslaget ${o.proposal.participant.name} ${day(o.proposal.start)} ${timeRange(o.proposal.start, o.proposal.end)} i kortet "${o.thread.title}".`;
      case 'event':
        return `Mötet "${o.event.title}" ${day(o.event.start)} ${o.event.allDay ? 'heldag' : timeRange(o.event.start, o.event.end)}${o.event.room ? ', ' + o.event.room : ''} i kalendern.`;
      case 'capability':
        return `Förmågan "${o.title}" (${o.source}).`;
      case 'document': {
        const h = o.hit;
        const kept = [
          h.owner,
          (h.reviewedAt ?? h.updatedAt) ? 'granskad ' + (h.reviewedAt ?? h.updatedAt)!.slice(0, 10) : undefined,
        ]
          .filter(Boolean)
          .join(', ');
        return `Avsnitt "${h.label}${h.section ? ', ' + h.section : ''}" ur ${h.source}${kept ? ` (${kept})` : ''}: "${h.snippet}"`;
      }
    }
  });
}
