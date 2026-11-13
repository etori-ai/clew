import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { database, type Database } from '../../packages/db/src/index';

/** A migrated database of a test's own, and the way to remove it: `drop` closes its connections and drops it. */
export interface CLocaleDatabase {
  db: Database;
  drop(): Promise<void>;
}
/**
 * A database created from `template0` with the locale C and migrated, which D100 supports: there a plain `lower` or
 * `ilike` folds only A to Z. The suite's database is initdb's default, en_US.utf8, where they fold å, ä and ö by
 * themselves, so a comparison that leaves the folding to the database's collation passes there and fails here (L13).
 * The database is created beside the suite's, on the same server, and the caller drops it when its tests end.
 */
export async function cLocaleDatabase(): Promise<CLocaleDatabase> {
  const name = 'clew_test_c_locale_' + randomUUID().replaceAll('-', '').slice(0, 12),
    url = new URL(process.env.DATABASE_URL!);
  url.pathname = '/' + name;
  await database().execute(
    sql.raw(`create database ${name} template template0 encoding 'UTF8' locale_provider libc locale 'C'`),
  );
  const db = drizzle({ connection: { url: url.toString(), max: 5, onnotice: () => undefined } });
  const drop = async () => {
    await db.$client.end();
    await database().execute(sql.raw(`drop database if exists ${name} with (force)`));
  };
  try {
    const [locale] = await db.execute<{ collation: string; folds: boolean }>(
      sql`select datcollate as collation, lower('Å') = 'å' as folds from pg_database where datname = current_database()`,
    );
    if (locale?.collation !== 'C' || locale.folds)
      throw new Error(`${name} folds Å by itself, so it cannot show a comparison that leaves the folding to it.`);
    await migrate(db, { migrationsFolder: resolve(import.meta.dir, '../../packages/db/migrations') });
  } catch (error) {
    await drop();
    throw error;
  }
  return { db, drop };
}
