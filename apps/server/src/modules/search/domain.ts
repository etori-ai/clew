import { foldSourceKey, type SearchHit, type SearchResult, type SearchSource } from '@clew/contracts';

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
/**
 * One list from every source that answered: each source's own order is kept and the sources are interleaved, so a slow
 * source with a strong hit is not buried under a fast one with ten weak ones. Hits from several sources about the same
 * person or unit are one hit (D97 item 6): the first one's, where it came, with `sources` naming every source that
 * answered for it in the order their hits came. A hit without a subject is as its source gave it.
 */
export function merge(outcomes: SourceOutcome[], now: number, limit = ROW_LIMIT): SearchResult['rows'] {
  const seen = new Set<string>();
  const queues = outcomes.filter(o => o.status === 'ok').map(o => ({ connector: o.id, rows: [...o.rows] }));
  const out: SearchResult['rows'] = [];
  const entities = new Map<string, SearchResult['rows'][number]>();
  const entityOf = (hit: SearchHit) =>
    hit.subject && `${hit.subject.entity}\u0000${foldSourceKey(hit.subject.entity, hit.subject.key)}`;
  /** Another source's hit about an entity already listed: its source joins the first hit's, once. */
  const join = (first: SearchResult['rows'][number], connector: string, hit: SearchHit) => {
    const sources = first.sources ?? [{ connector: first.connector, source: first.source }];
    if (!sources.some(s => s.connector === connector)) sources.push({ connector, source: hit.source });
    if (sources.length > 1) first.sources = sources;
  };
  while (out.length < limit && queues.some(q => q.rows.length)) {
    for (const q of queues) {
      const hit = q.rows.shift();
      if (!hit) continue;
      const key = q.connector + ':' + hit.ref;
      if (seen.has(key)) continue;
      seen.add(key);
      const entity = entityOf(hit);
      const first = entity && entities.get(entity);
      if (first) {
        join(first, q.connector, hit);
        continue;
      }
      const row = { ...hit, snippet: clip(hit.snippet), stale: staleness(hit, now), connector: q.connector };
      if (entity) entities.set(entity, row);
      out.push(row);
      if (out.length >= limit) break;
    }
  }
  // A source whose hit about a listed entity came after the list was full still answered for it.
  for (const q of queues)
    for (const hit of q.rows) {
      const entity = entityOf(hit);
      const first = entity && entities.get(entity);
      if (first) join(first, q.connector, hit);
    }
  return out;
}
/** The user names the hits name people by (D116), each once: what is resolved to Clew's key before the list is answered. */
export const hitNames = (rows: readonly Pick<SearchHit, 'subject'>[]): string[] => [
  ...new Set(rows.flatMap(r => (r.subject?.entity === 'person' ? [r.subject.key] : []))),
];
/**
 * The list as the person gets it (D116): a hit that names a person by the source's key, their user name, names them by
 * Clew's key, their id, from `held` (the name as asked, to the id of whoever holds it now), so it links to their page. A
 * hit whose name nobody of the reader's organisation holds names nobody, the rest of it kept. A unit's id is both keys.
 */
export function keyedHits<T extends Pick<SearchHit, 'subject'>>(
  rows: readonly T[],
  held: ReadonlyMap<string, string>,
): T[] {
  return rows.map(row => {
    if (row.subject?.entity !== 'person') return row;
    const id = held.get(row.subject.key);
    if (id) return { ...row, subject: { entity: 'person', key: id } };
    const { subject: _, ...rest } = row;
    return rest as T;
  });
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
