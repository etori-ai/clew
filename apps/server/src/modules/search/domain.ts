import type { SearchHit, SearchResult, SearchSource } from '@clew/contracts';

/**
 * The pure part of the composite search (D26): what "stale" means, how hits from several sources become one list, and
 * how a fan-out's outcome is reported. No I/O, no clock of its own: `now` is passed in.
 */
export const DAY_MS = 86_400_000;
/** Without a review interval from the source a document counts as stale a year after it was last reviewed or changed. */
export const DEFAULT_REVIEW_DAYS = 365;
export const SNIPPET_LIMIT = 600;
export const ROW_LIMIT = 10;

/** Stale when the review interval has passed since `reviewedAt` (or `updatedAt` when the source has no review date); null when the source gives no date at all. */
export function staleness(
  hit: Pick<SearchHit, 'reviewedAt' | 'updatedAt' | 'reviewIntervalDays'>,
  now: number,
): boolean | null {
  const at = hit.reviewedAt ?? hit.updatedAt;
  if (!at) return null;
  const since = Date.parse(at);
  if (Number.isNaN(since)) return null;
  return now - since > (hit.reviewIntervalDays ?? DEFAULT_REVIEW_DAYS) * DAY_MS;
}
export type SourceOutcome = { id: string; source: string } & (
  { status: 'ok'; rows: SearchHit[] } | { status: 'unavailable' | 'timeout' }
);
/** One list from every source that answered: each source's own order is kept and the sources are interleaved, so a slow source with a strong hit is not buried under a fast one with ten weak ones. */
export function merge(outcomes: SourceOutcome[], now: number, limit = ROW_LIMIT): SearchResult['rows'] {
  const seen = new Set<string>();
  const queues = outcomes.filter(o => o.status === 'ok').map(o => ({ connector: o.id, rows: [...o.rows] }));
  const out: SearchResult['rows'] = [];
  while (out.length < limit && queues.some(q => q.rows.length)) {
    for (const q of queues) {
      const hit = q.rows.shift();
      if (!hit) continue;
      const key = q.connector + ':' + hit.ref;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ...hit, snippet: clip(hit.snippet), stale: staleness(hit, now), connector: q.connector });
      if (out.length >= limit) break;
    }
  }
  return out;
}
export const clip = (text: string, limit = SNIPPET_LIMIT) =>
  text.length <= limit ? text : text.slice(0, limit - 1).trimEnd() + '…';
export function sourceReport(outcomes: SourceOutcome[]): SearchSource[] {
  return outcomes.map(o => ({ id: o.id, source: o.source, status: o.status }));
}
/** The document's headings as the follow-up questions when there is no model to write them (D26, settled 2026-11-04). */
export function headingFollowUps(rows: Pick<SearchHit, 'section'>[], count = 3): string[] {
  const out: string[] = [];
  for (const r of rows) {
    const s = r.section?.trim();
    if (s && !out.includes(s)) out.push(s);
    if (out.length >= count) break;
  }
  return out;
}
