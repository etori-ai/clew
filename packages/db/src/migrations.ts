import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import type { Database } from './index';

/** How a database's record of migrations stands against the journal in a folder (DE-L13), read before migrating. */
export interface MigrationGaps {
  /** A populated migration ledger belongs to a different baseline. Its rows must be preserved. */
  missingBaseline: boolean;
  /**
   * The journal's migrations at or below the newest one the database has recorded that it has not recorded itself,
   * oldest first, by tag. Drizzle will never run them.
   */
  skipped: string[];
  /**
   * The migrations the database has recorded that the journal lacks, by the `created_at` Drizzle recorded them with,
   * oldest first: another branch's, applied to a database that branches share.
   */
  unknown: number[];
}
/**
 * The journal's migrations in `folder` against what the database has recorded (DE-L13). Drizzle's migrator
 * (drizzle-orm 0.45.4) runs only the entries whose journal time is later than the newest one it has recorded, and
 * records each it runs with that time as `created_at`. A migration whose time is at or below one already applied, as
 * when two branches take turns on one database, is therefore never run and nothing says so: this compares every entry
 * of the journal with what is recorded, not only the newest. A database Drizzle has never migrated has recorded nothing.
 */
export async function migrationGaps(db: Pick<Database, 'execute'>, folder: string): Promise<MigrationGaps> {
  const { entries } = JSON.parse(await readFile(join(folder, 'meta/_journal.json'), 'utf8')) as {
    entries: Array<{ tag: string; when: number }>;
  };
  const [bookkeeping] = await db.execute<{ found: boolean }>(
    sql`select to_regclass('drizzle.__drizzle_migrations') is not null as found`,
  );
  const rows = bookkeeping?.found
    ? await db.execute<{ created_at: string | number }>(sql`select created_at from drizzle.__drizzle_migrations`)
    : [];
  const recorded = [...new Set(rows.map(r => Number(r.created_at)))].sort((a, b) => a - b);
  const newest = recorded.at(-1) ?? -Infinity;
  const known = new Set(entries.map(e => e.when));
  const held = new Set(recorded);
  return {
    missingBaseline: recorded.length > 0 && entries.length > 0 && !held.has(entries[0]!.when),
    skipped: entries.filter(e => e.when <= newest && !held.has(e.when)).map(e => e.tag),
    unknown: recorded.filter(at => !known.has(at)),
  };
}
