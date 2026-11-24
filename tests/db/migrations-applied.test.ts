import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { migrationGaps } from '../../packages/db/src/migrations';
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

test('db:init preserves a database with an earlier pre-release baseline and refuses to migrate it', async () => {
  const own = await upgradeDatabase();
  try {
    const [base] = await journal();
    const previous = { ...base!, when: base!.when - 1, tag: 'previous_baseline' };
    await own.migrate([previous], {
      previous_baseline:
        "create table preview_data (value text);\n--> statement-breakpoint\ninsert into preview_data values ('preserve me');",
    });
    const run = init(own);
    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('different migration baseline');
    expect(run.stderr).not.toContain('another branch');
    expect(await recorded(own)).toEqual([previous.when]);
    expect((await own.db.execute(sql`select value from preview_data`)).map(row => row.value)).toEqual(['preserve me']);
    expect((await own.db.execute(sql`select to_regclass('public.thread') as name`))[0]?.name).toBeNull();
    expect(await engine(own)).toBe(0);
  } finally {
    await own.drop();
  }
}, 60_000);

test('a shared baseline still detects a skipped intermediate migration by name', async () => {
  const own = await upgradeDatabase();
  const folder = await mkdtemp(join(tmpdir(), 'clew-journal-'));
  try {
    const entries = await journal();
    const last = entries.at(-1)!;
    const skipped = { ...last, tag: 'skipped', idx: last.idx + 1, when: last.when + 1 };
    const later = { ...last, tag: 'later', idx: last.idx + 2, when: last.when + 2 };
    await own.migrate([...entries, later], { later: 'select 1;' });
    await mkdir(join(folder, 'meta'));
    await writeFile(join(folder, 'meta/_journal.json'), JSON.stringify({ entries: [...entries, skipped, later] }));
    expect(await migrationGaps(own.db, folder)).toEqual({
      missingBaseline: false,
      skipped: [skipped.tag],
      unknown: [],
    });
  } finally {
    await rm(folder, { recursive: true, force: true });
    await own.drop();
  }
}, 60_000);

test('db:init initialises a fresh database, and run again over a migration of another branch it names it in a warning and goes on', async () => {
  const own = await upgradeDatabase();
  try {
    const entries = await journal();
    const first = init(own);
    expect(first.exitCode).toBe(0);
    expect(first.stdout).toContain('Migrations applied.');
    expect(first.stdout).toContain('Durable engine schema (dbos) ready.');
    expect(first.stderr).not.toContain('This database has');
    expect(await recorded(own)).toEqual(entries.map(e => e.when));
    expect(await engine(own)).toBe(1);

    // Another branch's migration, applied to the same database after this journal's newest.
    const other = entries.at(-1)!.when + 1;
    await own.db.execute(
      sql`insert into drizzle.__drizzle_migrations (hash, created_at) values ('other-branch', ${other})`,
    );
    expect(await migrationGaps(own.db, MIGRATIONS)).toEqual({ missingBaseline: false, skipped: [], unknown: [other] });
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
