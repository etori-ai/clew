import type { Query } from '@tanstack/react-query';

/**
 * Reads the server writes a row of its read log for (D108 item 15, D121 item 5): a registrar's search across the
 * organisation, and one person's competence opened by someone else (a manager, a registrar). Each request is a read
 * someone may later be asked about, so the browser makes one only when the reader asks: the search pressed or its page
 * changed, the person opened, a "Försök igen". Never again on its own: not when a change notice arrives (`thread-cache`
 * leaves a query marked `logged` alone), when the tab is shown, when the network returns or when the answer ages; and
 * a failure is not retried behind the reader's back. What is on screen stays what was read. This file imports nothing of
 * the page, so a unit test loads it on its own.
 */
export const LOGGED_READ = {
  meta: { logged: true },
  staleTime: Infinity,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
  retry: false,
} as const;
/** Whether a query in the cache is one of those reads. */
export const isLoggedQuery = (query: Pick<Query, 'meta'>) => query.meta?.logged === true;
/** The read of one person's holdings (D108), which the server logs when the reader is not that person. */
const HOLDINGS = 'competence.holdings';
/**
 * Whether a view read is logged on the server: one person's holdings named by `person`. The browser does not know
 * whether that is the reader's own key, so a read that names someone is treated as logged; the reader's own page names
 * nobody and is read as any view is.
 */
export function isLoggedView(capability: string, inputJson: string | null): boolean {
  if (capability !== HOLDINGS || !inputJson) return false;
  try {
    const input = JSON.parse(inputJson) as { person?: unknown } | null;
    return typeof input?.person === 'string';
  } catch {
    return false;
  }
}
