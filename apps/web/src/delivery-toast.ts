/** A delivery this tab claimed: a work item that came into Att göra, or a reminder the person asked for. */
export type Arrival = { threadId: string; title: string; kind: 'automatic' | 'reminder' };

/** One toast holds every delivery, so a morning's worth never stacks: a later one replaces it in place. */
export const DELIVERY_TOAST = 'delivery';

/** What is waiting to be said with what has just arrived: a work item is counted once, as it last arrived. */
export function withArrivals(waiting: Arrival[], arrived: Arrival[]): Arrival[] {
  const again = new Set(arrived.map(a => a.threadId));
  return [...waiting.filter(a => !again.has(a.threadId)), ...arrived];
}

/**
 * The one toast's words and where its "Visa" leads: the work item when there is one, Att göra when there are several
 * (`threadId` null). The toast leaves by itself; what it said stays in Att göra and under Påminnelser in the bell.
 */
export function deliveryToast(arrivals: Arrival[]): { body: string; threadId: string | null } {
  const [only] = arrivals;
  if (arrivals.length === 1 && only)
    return {
      body: only.kind === 'reminder' ? 'Påminnelse: ' + only.title : 'Nya uppgifter finns i Att göra.',
      threadId: only.threadId,
    };
  const reminders = arrivals.filter(a => a.kind === 'reminder').length;
  if (reminders === 0) return { body: 'Nya uppgifter finns i Att göra.', threadId: null };
  if (reminders === arrivals.length) return { body: `${reminders} påminnelser finns i Att göra.`, threadId: null };
  return { body: 'Påminnelser och nya uppgifter finns i Att göra.', threadId: null };
}
