import type { RequestRow, RequestState, SearchSource, ViewRef } from '@clew/contracts';

/**
 * The pure part of the combined request list (D123): how rows from several service desks become one list and how a
 * fan-out's outcome is reported. No I/O and no clock: the order depends only on what the systems answered.
 */
export const ROW_LIMIT = 200;
/**
 * Where a request stands as the list says it, the same whichever system holds it (D123 item 6): Clew's words for the
 * shared state, given on the rows here, as the talks round gives its states theirs (`TALK_STATE_WORDS`). Never from the
 * shared value words, which translate every connector's values and would turn another system's `new` or `active` into
 * these.
 */
export const REQUEST_STATE_WORDS: Record<RequestState, string> = {
  'waiting-on-me': 'Väntar på dig',
  new: 'Ny',
  active: 'Pågår',
  closed: 'Stängd',
};
/**
 * The order a list is drawn in: what waits on the person first, then what is open, then what is closed. `new` and
 * `active` are one rank, since for the person who waits both are the desk's move; the oldest of them comes first.
 */
const RANK: Record<RequestState, number> = { 'waiting-on-me': 0, new: 1, active: 1, closed: 2 };
const CLOSED = RANK.closed;

export type SystemOutcome = { id: string; source: string } & (
  { status: 'ok'; rows: RequestRow[] } | { status: 'unavailable' | 'timeout' }
);
export type MergedRequestRow = RequestRow & { connector: string; system: string };
/** The combined list as the use case answers it, the state still the shared code; `clew.requests` puts it in words. */
export interface RequestList {
  rows: Array<MergedRequestRow & { view?: ViewRef }>;
  systems: SearchSource[];
  unanswered: string[];
}

const time = (value: string) => {
  const at = Date.parse(value);
  return Number.isNaN(at) ? Number.POSITIVE_INFINITY : at;
};

/**
 * One list from every system that answered. What waits on the person comes first, whichever system holds it; within an
 * open rank the request made longest ago, and among the closed ones the most recent, since a closed request is listed
 * to show what was recently delivered, and the cap at `ROW_LIMIT` must cut the old ones, not those. A system's own
 * order is not kept: the shared state is what makes the systems comparable. A ref is one request, so a repeated one is
 * listed once.
 */
export function merge(outcomes: SystemOutcome[], limit = ROW_LIMIT): MergedRequestRow[] {
  const seen = new Set<string>();
  const rows: MergedRequestRow[] = [];
  for (const outcome of outcomes) {
    if (outcome.status !== 'ok') continue;
    for (const row of outcome.rows) {
      const key = outcome.id + '\n' + row.ref;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({ ...row, connector: outcome.id, system: outcome.source });
    }
  }
  return rows
    .sort(
      (a, b) =>
        RANK[a.state] - RANK[b.state] ||
        (RANK[a.state] === CLOSED ? time(b.since) - time(a.since) : time(a.since) - time(b.since)) ||
        a.connector.localeCompare(b.connector) ||
        a.ref.localeCompare(b.ref),
    )
    .slice(0, limit);
}
export function systemReport(outcomes: SystemOutcome[]): SearchSource[] {
  return outcomes.map(o => ({ id: o.id, source: o.source, status: o.status }));
}
/** The systems that did not answer, as a person reads them, each once. */
export function unanswered(outcomes: SystemOutcome[]): string[] {
  return [...new Set(outcomes.filter(o => o.status !== 'ok').map(o => o.source))];
}
