import type { ErrandRow, ErrandState, SearchSource } from '@clew/contracts';

/**
 * The pure part of the combined errand list (D35 item 4, D89): how rows from several case systems become one list and
 * how a fan-out's outcome is reported. No I/O and no clock: the order depends only on what the systems answered.
 */
export const ROW_LIMIT = 200;
/** The order a list is drawn in: what waits on the person first. The same order as `ERRAND_STATES` in the contract. */
const STATE_ORDER: ErrandState[] = ['waiting-on-me', 'new', 'active', 'waiting-on-others', 'closed'];

export type SystemOutcome = { id: string; source: string } & (
  { status: 'ok'; rows: ErrandRow[] } | { status: 'unavailable' | 'timeout' }
);
export type MergedRow = ErrandRow & { connector: string; system: string };

const time = (value: string | undefined) => {
  const at = value ? Date.parse(value) : Number.NaN;
  return Number.isNaN(at) ? Number.POSITIVE_INFINITY : at;
};

/**
 * One list from every system that answered. What waits on the person comes first, whichever system holds it; within
 * a state the nearest deadline, then the errand that has waited longest. A system's own order is not kept: the shared
 * state is what makes the systems comparable. A ref is one errand, so a repeated one is listed once.
 */
export function merge(outcomes: SystemOutcome[], limit = ROW_LIMIT): MergedRow[] {
  const seen = new Set<string>();
  const rows: MergedRow[] = [];
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
        STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state) ||
        time(a.dueAt) - time(b.dueAt) ||
        time(a.since) - time(b.since) ||
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
