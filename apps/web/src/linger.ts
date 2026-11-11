import { useEffect, useRef, useState } from 'react';
import type { Thread } from '@clew/contracts';
import { receiptComplete } from './receipt-state';

/**
 * The moment a receipt arrives (D70). A card whose decision the source has read back gets a receipt in the cache: an
 * execute turns the card from open to handled, and a confirmed proposal leaves it open, waiting on the invitees (D70
 * amended). Either way the row it was pressed on keeps its place for `LINGER_MS` in its receipt state, with what was
 * done and Ångra, before it goes to Klart or Väntar på andra. Nothing here predicts anything: the transition is seen in
 * the threads the cache holds.
 */
export const LINGER_MS = 2_500;

/**
 * The decisions sent from a surface Hem may not have been drawn under (D73: Skicka in the review). Hem's first reading
 * is a baseline, so a receipt that came while Hem was not on screen would otherwise be taken for an old one and draw
 * neither the row's moment nor the toast. The review lies over the page it was opened on (D110 rule 5): over Hem, Hem's
 * own reading sees the receipt arrive and this is belt and braces; over any other page it is what lets Hem show the
 * receipt's moment when the person comes back. The set lives in memory only, so a reload forgets it.
 */
const expected = new Set<string>();
/** The decision on this card was sent from another page: Hem's next reading counts its receipt as arriving. */
export function expectReceipt(threadId: string): void {
  expected.add(threadId);
}

/**
 * The threads whose receipt arrived between two readings: open without a receipt before, with one now, whatever state
 * the decision left them in. A thread named in `sent` and not in the previous reading counts as open before (D73).
 */
export function receiptArrivals(
  previous: ReadonlyMap<string, Thread>,
  threads: readonly Thread[],
  sent: ReadonlySet<string> = new Set(),
): Thread[] {
  return threads.filter(t => {
    const before = previous.get(t.id);
    const wasOpen = before ? before.state === 'open' && !before.receipt : sent.has(t.id);
    const newlyConfirmed = !!before?.receipt && !receiptComplete(before.receipt) && receiptComplete(t.receipt);
    return (wasOpen || newlyConfirmed) && t.state !== 'dismissed' && !!t.receipt;
  });
}

/**
 * Watches the threads for arriving receipts: `onArrive` runs once per arrival, and the returned set holds the cards that
 * still keep their place in the stream. The first reading is a baseline, never an arrival, so a reload draws no toast;
 * the one exception is a decision named by `expectReceipt` (D73).
 */
export function useReceiptArrivals(threads: readonly Thread[], onArrive: (thread: Thread) => void): Set<string> {
  const previous = useRef<Map<string, Thread> | null>(null);
  const [lingering, setLingering] = useState<Set<string>>(() => new Set());
  const latest = useRef(onArrive);
  latest.current = onArrive;
  useEffect(() => {
    const arrivals = receiptArrivals(previous.current ?? new Map(), threads, expected);
    previous.current = new Map(threads.map(t => [t.id, t]));
    // A decision named by `expectReceipt` is read once it is in the threads: with its receipt it arrives now, without
    // one it is the baseline and arrives the ordinary way.
    for (const t of threads) expected.delete(t.id);
    if (!arrivals.length) return;
    setLingering(set => new Set([...set, ...arrivals.map(t => t.id)]));
    for (const t of arrivals) latest.current(t);
    // The moment ends on its own clock: not cleared when the threads are read again meanwhile (a refetch within the
    // 2,5 s would otherwise keep the row forever), nor by StrictMode's second run of the effect when Hem mounts with an
    // arrival (D73). A timer that fires after Hem has gone sets the state of nothing.
    setTimeout(() => {
      setLingering(set => {
        const next = new Set(set);
        for (const t of arrivals) next.delete(t.id);
        return next;
      });
    }, LINGER_MS);
  }, [threads]);
  return lingering;
}
