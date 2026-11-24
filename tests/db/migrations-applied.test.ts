import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { migrationGaps } from '../../packages/db/src/migrations';
import type { Database } from '../../packages/db/src/index';
import { MIGRATIONS, journal, upgradeDatabase, type UpgradeDatabase } from './upgrade';

/**
 * DE-L13: Drizzle runs only the migrations newer than the newest it has recorded, so one that lands with an earlier time
 * than a migration already applied, as when two branches take turns on one database, is never run. Before it migrates
 * anything, `bun run db:init` looks for every migration of the journal at or below the newest recorded one among the
 * recorded ones and refuses a database that lacks one, naming it. A recorded migration the journal lacks, another
 * branch's, is named in a warning and left. Each case runs the script on a database of the test's own. Run with
 * `bun run test:db` inside the devcontainer.
 */
if (!process.env.DATABASE_URL)
  throw new Error('DATABASE_URL is not set. Run `bun run test:db` inside the devcontainer.');

const init = (own: UpgradeDatabase) => {
  const run = Bun.spawnSync([process.execPath, join(import.meta.dir, '../../scripts/db-init.ts')], {
    env: { ...process.env, DATABASE_URL: own.url },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return { exitCode: run.exitCode, stdout: run.stdout.toString(), stderr: run.stderr.toString() };
};
const recorded = async (own: UpgradeDatabase) =>
  (
    await own.db.execute<{ created_at: string }>(sql`select created_at from drizzle.__drizzle_migrations order by id`)
  ).map(r => Number(r.created_at));
const engine = async (own: UpgradeDatabase) =>
  (
    await own.db.execute<{ n: number }>(
      sql`select count(*)::int as n from information_schema.schemata where schema_name = 'dbos'`,
    )
  )[0]!.n;

test('db:init refuses a database that lacks a migration below the newest it recorded, names it, and migrates nothing', async () => {
  const own = await upgradeDatabase();
  try {
    const entries = await journal();
    // Every migration but the newest, as a database one release behind holds them, and then one in the middle lost.
    await own.migrate(entries.slice(0, -1));
    const db = own.db as unknown as Database;
    const skipped = entries.at(-3)!,
      newest = entries.at(-1)!;
    await own.db.execute(sql`delete from drizzle.__drizzle_migrations where created_at = ${skipped.when}`);
    expect(await migrationGaps(db, MIGRATIONS)).toEqual({ skipped: [skipped.tag], unknown: [] });
    const run = init(own);
    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain(`has not applied the migration ${skipped.tag}, though it has applied a later one`);
    expect(run.stderr).toContain(
      'record each migration in drizzle.__drizzle_migrations with its `when` from ' +
        'packages/db/migrations/meta/_journal.json as created_at',
    );
    expect(run.stdout).not.toContain('Migrations applied.');
    // The newest migration, which Drizzle would have run over the gap, was not run, and the engine was not migrated.
    expect(await recorded(own)).not.toContain(newest.when);
    expect(await migrationGaps(db, MIGRATIONS)).toEqual({ skipped: [skipped.tag], unknown: [] });
    expect(await engine(own)).toBe(0);
  } finally {
    await own.drop();
  }
}, 60_000);

test('db:init initialises a fresh database, and run again over a migration of another branch it names it in a warning and goes on', async () => {
  const own = await upgradeDatabase();
  try {
    const entries = await journal();
    const db = own.db as unknown as Database;
    const first = init(own);
    expect(first.exitCode).toBe(0);
    expect(first.stdout).toContain('Migrations applied.');
    expect(first.stdout).toContain('Durable engine schema (dbos) ready.');
    expect(first.stderr).not.toContain('This database has');
    expect(await recorded(own)).toEqual(entries.map(e => e.when));
    expect(await engine(own)).toBe(1);

    // Another branch's migration, applied to the same database between this journal's last two.
    const other = entries.at(-1)!.when - 1;
    await own.db.execute(
      sql`insert into drizzle.__drizzle_migrations (hash, created_at) values ('other-branch', ${other})`,
    );
    expect(await migrationGaps(db, MIGRATIONS)).toEqual({ skipped: [], unknown: [other] });
    const again = init(own);
    expect(again.exitCode).toBe(0);
    expect(again.stderr).toContain(
      `This database has applied a migration that this checkout's journal does not have (recorded with created_at ${other}, ` +
        `${new Date(other).toISOString()}), probably another branch's. It is left as it is.`,
    );
    expect(again.stdout).toContain('Migrations applied.');
    expect(await engine(own)).toBe(1);
  } finally {
    await own.drop();
  }
}, 120_000);
