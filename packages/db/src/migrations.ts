import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import type { Database } from './index';

/**
 * The migrations of the journal in `folder` that the database holds no record of, oldest first (DE-L13). Drizzle's
 * migrator (drizzle-orm 0.45.4) runs only the entries whose journal time is later than the newest one it has recorded,
 * and records each it runs with that time as `created_at`. A migration whose time is earlier than one already applied,
 * as when two branches take turns on one database, is therefore never run and nothing says so: this compares every
 * entry of the journal with what is recorded, not only the newest.
 */
export async function migrationsNotApplied(db: Database, folder: string): Promise<string[]> {
  const { entries } = JSON.parse(await readFile(join(folder, 'meta/_journal.json'), 'utf8')) as {
    entries: Array<{ tag: string; when: number }>;
  };
  const rows = await db.execute<{ created_at: string | number }>(
    sql`select created_at from drizzle.__drizzle_migrations`,
  );
  const recorded = new Set(rows.map(r => Number(r.created_at)));
  return entries.filter(e => !recorded.has(e.when)).map(e => e.tag);
}
