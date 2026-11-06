import { useEffect, useRef, useState } from 'react';
import type { Thread } from '@clew/contracts';

/**
 * The moment a receipt arrives (D70). A card whose execute the source has read back turns from open to handled with a
 * receipt in the cache; the row it was pressed on keeps its place for `LINGER_MS` in its receipt state, with the check
 * and Ångra, before it goes to Klart. Nothing here predicts anything: the transition is seen in the threads the cache holds.
 */
export const LINGER_MS = 2_500;

/** The threads whose receipt arrived between two readings: open without a receipt before, handled with one now. */
export function receiptArrivals(previous: ReadonlyMap<string, Thread>, threads: readonly Thread[]): Thread[] {
  return threads.filter(t => {
    const before = previous.get(t.id);
    return !!before && before.state === 'open' && !before.receipt && t.state === 'handled' && !!t.receipt;
  });
}

/**
 * Watches the threads for arriving receipts: `onArrive` runs once per arrival, and the returned set holds the cards that
 * still keep their place in the stream. The first reading is a baseline, never an arrival, so a reload draws no toast.
 */
export function useReceiptArrivals(threads: readonly Thread[], onArrive: (thread: Thread) => void): Set<string> {
  const previous = useRef<Map<string, Thread> | null>(null);
  const [lingering, setLingering] = useState<Set<string>>(() => new Set());
  const latest = useRef(onArrive);
  latest.current = onArrive;
  useEffect(() => {
    const arrivals = previous.current ? receiptArrivals(previous.current, threads) : [];
    previous.current = new Map(threads.map(t => [t.id, t]));
    if (!arrivals.length) return;
    setLingering(set => new Set([...set, ...arrivals.map(t => t.id)]));
    for (const t of arrivals) latest.current(t);
    const timer = setTimeout(() => {
      setLingering(set => {
        const next = new Set(set);
        for (const t of arrivals) next.delete(t.id);
        return next;
      });
    }, LINGER_MS);
    return () => clearTimeout(timer);
  }, [threads]);
  return lingering;
}
