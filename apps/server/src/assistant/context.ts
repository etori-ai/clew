import { isSnoozed, type CalendarEvent, type ReceiptRow, type SearchHit, type Thread } from '@clew/contracts';
import { dayLabel, shortDayLabel, timeLabel, timeRange } from '@clew/calendar/dates';

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
    `Fler val (${[...overflow.map(a => a.label), ...own, 'Lägg till i samtalet', 'Avfärda'].join(', ')})`;
  const buttons = (labels: string[]) =>
    labels.length ? ` Knappar i ärendet nu: ${labels.join(', ')}.` : ' Ärendet har inga knappar nu.';
  if (t.state === 'dismissed') return ' Ärendet är avfärdat.' + buttons([]);
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
        ' Ärendet är hanterat.' +
        (undoOpen ? ` Ångra allt tar tillbaka inbjudningarna fram till ${timeLabel(undoUntil)}.` : '')
      );
    }
    const done = ` Ärendet är redan hanterat${t.handledAt ? ' ' + timeLabel(t.handledAt) : ''}: ${r.headline} Kvitto: ${r.rows.map(x => `${x.label} · ${x.detail} (${outcome[x.outcome]})`).join('; ')}.`;
    const undoOpen = !!r.undoCapability && !!r.undoUntil && Date.parse(r.undoUntil) > Date.parse(now);
    if (!undoOpen)
      return done + ` Det går inte längre att ångra i Startsidan; en ändring görs i ${t.trigger.source}.` + buttons([]);
    const own = [primary, ...secondary].filter(a => !!a && a.kind !== 'read').map(a => a!.label);
    return (
      done +
      buttons([
        `Ångra (fram till ${timeLabel(r.undoUntil!)})`,
        ...secondary.filter(a => a.kind === 'read').map(a => a.label),
      ]) +
      ` Ångra tar tillbaka det som gjordes i ${t.trigger.source}${own.length ? ` och först därefter visar ärendet ${own.join(' och ')} igen` : ''}.`
    );
  }
  if (isSnoozed(t, now)) return ' Ärendet ligger under Inte nu.' + buttons(['Ta upp nu', more()]);
  if (t.waitingOn) return ` Ärendet väntar på ${t.waitingOn}.` + buttons(['Påminn mig', more()]);
  return buttons([...(primary ? [primary.label] : []), ...secondary.map(a => a.label), 'Inte nu', more()]);
}
/** A work item's last day as a person reads it ("måndag 16 november"); anything that is not a date as it came. */
export const dueLabel = (date: string) => (/^\d{4}-\d{2}-\d{2}$/.test(date) ? dayLabel(date) : date);
/**
 * A work item about a person the conversation names (D115), as the model is handed it: its title, its source, its last
 * day and the buttons it shows now. Never its summary, its rows or its receipt: a source's text about a person may say
 * something about their health, and with the person named the model could tie it to them.
 */
export function workItemLine(t: Thread, now: string): string {
  return (
    `Ärende "${t.title}" (${t.trigger.source}${t.deadline ? ', senast ' + dueLabel(t.deadline) : ''}).` +
    (t.state === 'handled' ? ' Ärendet är hanterat.' : cardState(t, now))
  );
}
/**
 * Swedish lines for the system prompt's "Du tittar på" block. Names appear here only because the person pointed at the
 * object. `now` (an instant) decides whether a card's undo window is still open; chips are resolved again every turn, so
 * the state is the card's as it is now, not as it was when it was added. A card in `guarded` is about a person the
 * conversation names (D115) and is handed by its title, last day and buttons alone, whichever of its parts was pointed at.
 */
export function serialiseContext(
  objects: ResolvedObject[],
  now: string,
  guarded: ReadonlySet<string> = new Set(),
): string[] {
  return objects.map(o => {
    if ('thread' in o && guarded.has(o.thread.id)) return workItemLine(o.thread, now);
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
          `Ärende "${t.title}" (${t.trigger.source}, område ${t.area}${t.deadline ? ', senast ' + t.deadline : ''}). ${t.summary}` +
          (rows.length ? ` Rader: ${rows.join('; ')}.` : '') +
          (proposals.length ? ` Förslag: ${proposals.join('; ')}.` : '') +
          cardState(t, now)
        );
      }
      case 'item':
        return `Rad "${o.item.label} · ${o.item.detail}" i ärendet "${o.thread.title}" (${o.thread.trigger.source}).${cardState(o.thread, now)}`;
      case 'proposal':
        return `Förslaget ${o.proposal.participant.name} ${day(o.proposal.start)} ${timeRange(o.proposal.start, o.proposal.end)} i ärendet "${o.thread.title}".`;
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
