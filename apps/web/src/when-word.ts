import { daysUntil, stockholmDate } from '@clew/contracts';
import { today } from '@clew/calendar/dates';

const longDate = (date: string) =>
  new Intl.DateTimeFormat('sv-SE', { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(
    new Date(date.slice(0, 10) + 'T12:00:00Z'),
  );
const clock = (iso: string) => new Date(iso).toLocaleTimeString('sv-SE', { timeStyle: 'short' });
/**
 * An instant as a person says it beside today: "i dag 08.31", "i går 16.02", "i morgon 06:00", else "11 november 08.31".
 * Here rather than in `work-item.tsx`, so the item's buttons and its status notice (`card.tsx`, D126 item 13) say an
 * instant in the same words as its facts and its Händelser.
 */
export function whenWord(instant: string, now = today()): string {
  const date = stockholmDate(instant);
  const days = daysUntil(date, now);
  const day = days === 0 ? 'i dag' : days === -1 ? 'i går' : days === 1 ? 'i morgon' : longDate(date);
  return `${day} ${clock(instant)}`;
}
