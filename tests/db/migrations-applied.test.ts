import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { migrationsNotApplied } from '../../packages/db/src/migrations';
import type { Database } from '../../packages/db/src/index';
import { MIGRATIONS, journal, upgradeDatabase } from './upgrade';

/**
 * DE-L13: Drizzle runs only the migrations newer than the newest it has recorded, so one that lands with an earlier time
 * than a migration already applied, as when two branches take turns on one database, is never run. `bun run db:init`
 * looks for every migration of the journal among the recorded ones and refuses a database that lacks one, naming it,
 * before it migrates the durable engine. A database of the test's own is migrated and then made to lack one migration
 * that is not the newest, as such a database lacks it. Run with `bun run test:db` inside the devcontainer.
 */
if (!process.env.DATABASE_URL)
  throw new Error('DATABASE_URL is not set. Run `bun run test:db` inside the devcontainer.');

test('db:init refuses a database that lacks a migration of the journal, names it, and migrates nothing further', async () => {
  const own = await upgradeDatabase();
  try {
    await own.migrate();
    const db = own.db as unknown as Database;
    expect(await migrationsNotApplied(db, MIGRATIONS)).toEqual([]);
    const skipped = (await journal()).at(-2)!;
    await own.db.execute(sql`delete from drizzle.__drizzle_migrations where created_at = ${skipped.when}`);
    expect(await migrationsNotApplied(db, MIGRATIONS)).toEqual([skipped.tag]);
    const run = Bun.spawnSync([process.execPath, join(import.meta.dir, '../../scripts/db-init.ts')], {
      env: { ...process.env, DATABASE_URL: own.url },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    expect(run.exitCode).toBe(1);
    expect(run.stderr.toString()).toContain(
      `has not applied the migration ${skipped.tag}, though it has applied a later one`,
    );
    expect(run.stdout.toString()).not.toContain('Migrations applied.');
    // Drizzle ran nothing (it never runs an older one), and the durable engine's schema was not made.
    expect(await migrationsNotApplied(db, MIGRATIONS)).toEqual([skipped.tag]);
    const [engine] = await own.db.execute<{ n: number }>(
      sql`select count(*)::int as n from information_schema.schemata where schema_name = 'dbos'`,
    );
    expect(engine?.n).toBe(0);
  } finally {
    await own.drop();
  }
}, 60_000);
