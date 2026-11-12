import type { NewsRow } from '@clew/contracts';

/**
 * The pure part of the combined news list (D112, amended 2026-11-11): how rows from several news sources become one
 * list. No I/O and no clock: the order depends only on what the sources answered.
 */
export const ROW_LIMIT = 100;

/** One source's part in the fan-out: its rows, or nothing (it failed, was late or answered out of shape). */
export type SourceOutcome = { id: string; source: string; rows: NewsRow[] };
export type MergedNewsRow = NewsRow & { connector: string; system: string };

const time = (value: string) => {
  const at = Date.parse(value);
  return Number.isNaN(at) ? Number.NEGATIVE_INFINITY : at;
};

/**
 * One list from every source that answered, newest first whichever source holds it; at the same instant by source,
 * then by ref, so the order is stable. A ref is one item in its source, so a repeated one is listed once.
 */
export function merge(outcomes: SourceOutcome[], limit = ROW_LIMIT): MergedNewsRow[] {
  const seen = new Set<string>();
  const rows: MergedNewsRow[] = [];
  for (const outcome of outcomes)
    for (const row of outcome.rows) {
      const key = outcome.id + '\n' + row.ref;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({ ...row, connector: outcome.id, system: outcome.source });
    }
  return rows
    .sort(
      (a, b) =>
        time(b.publishedAt) - time(a.publishedAt) ||
        a.connector.localeCompare(b.connector) ||
        a.ref.localeCompare(b.ref),
    )
    .slice(0, limit);
}
