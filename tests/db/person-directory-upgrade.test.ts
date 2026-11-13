import { afterAll, beforeAll, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { MIGRATIONS, journal, position, upgradeDatabase, type Entry, type UpgradeDatabase } from './upgrade';

/**
 * An upgrade through the migration that moves a person's work and mobile numbers into `phone_numbers`
 * (`person_directory_profile`, D114) on a database whose people hold numbers. Its UPDATE of `auth_person` queues the
 * deferred change signals of 0019, and an ALTER of a table with signals still pending fails ("pending trigger events",
 * 55006), so the migration fires them as it writes, as 0032 and 0054 do. Drizzle runs every pending migration in one
 * transaction, so the run here has one migration after it that alters `auth_person`, which must find no signal left
 * pending, and stops there: a later migration of the repository may write a person too and change what this test
 * counts. A database that applied the migration before that fix is left alone, since Drizzle compares no file's hash.
 * Run with `bun run test:db` inside the devcontainer: the databases are created beside the suite's and dropped
 * afterwards.
 */
if (!process.env.DATABASE_URL)
  throw new Error('DATABASE_URL is not set. Run `bun run test:db` inside the devcontainer.');

const NAME = 'person_directory_profile';
let installation: UpgradeDatabase;
let upgrade: () => Promise<void>;
beforeAll(async () => {
  installation = await upgradeDatabase();
  const entries = await journal(),
    at = position(entries, NAME);
  const before = entries.slice(0, at),
    target = entries[at]!;
  await installation.migrate(before);
  await installation.db.execute(sql.raw(SEED));
  // The migration and one after it that alters auth_person, in the one transaction Drizzle runs every pending migration
  // in, and nothing later.
  const alters: Entry = { ...target, idx: target.idx + 1, when: target.when + 1, tag: 'upgrade_probe_after' };
  upgrade = () =>
    installation.migrate([...before, target, alters], {
      upgrade_probe_after: 'ALTER TABLE "auth_person" ADD COLUMN "upgrade_probe" text;',
    });
}, 60_000);
afterAll(() => installation?.drop());

/** The people before the upgrade: a work number, a mobile number, both, and none. */
const SEED = `
INSERT INTO auth_person (id, organisation_id, name, work_phone, mobile_phone) VALUES
 ('p-work', 'org', 'Work number only', '+46 8 123 45 67', NULL),
 ('p-mobile', 'org', 'Mobile number only', NULL, '+46 70 123 45 67'),
 ('p-both', 'org', 'Both numbers', '+46 8 765 43 21', '+46 70 765 43 21'),
 ('p-neither', 'org', 'No number', NULL, NULL);
`;
const rows = async <T>(query: string) => (await installation.db.execute(sql.raw(query))) as unknown as T[];
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

test('an upgrade from the migration before it, with a migration after it that alters auth_person, carries each number into phone_numbers, work first, and drops the old columns', async () => {
  // Before the fix this failed: the DROP COLUMN after the UPDATE met the signals the UPDATE had queued (55006).
  await upgrade();
  expect(await rows(`select id, phone_numbers, employments from auth_person order by id`)).toEqual([
    {
      id: 'p-both',
      phone_numbers: [
        { type: 'work', value: '+46 8 765 43 21' },
        { type: 'mobile', value: '+46 70 765 43 21' },
      ],
      employments: [],
    },
    { id: 'p-mobile', phone_numbers: [{ type: 'mobile', value: '+46 70 123 45 67' }], employments: [] },
    { id: 'p-neither', phone_numbers: [], employments: [] },
    { id: 'p-work', phone_numbers: [{ type: 'work', value: '+46 8 123 45 67' }], employments: [] },
  ]);
  // The old columns are gone, and the migration after it altered auth_person in the same transaction.
  expect(
    await rows(
      `select column_name from information_schema.columns where table_schema = 'public' and table_name = 'auth_person'
         and column_name in ('work_phone', 'mobile_phone', 'upgrade_probe')`,
    ),
  ).toEqual([{ column_name: 'upgrade_probe' }]);
  // Every person was signalled once when the seed committed. The migration signals each person whose numbers it moved
  // once more, as it writes instead of at its commit, which loses nothing.
  expect(await rows(`select person_id, policy::int as policy from person_change order by person_id`)).toEqual([
    { person_id: 'p-both', policy: 2 },
    { person_id: 'p-mobile', policy: 2 },
    { person_id: 'p-neither', policy: 1 },
    { person_id: 'p-work', policy: 2 },
  ]);
});

/** The migration as `main` held it from f7fcd6c until its fix, and as every installation that applied it ran it. */
const APPLIED = `ALTER TABLE "auth_person" ADD COLUMN "phone_numbers" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "auth_person" ADD COLUMN "employments" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
UPDATE "auth_person"
SET "phone_numbers" =
  (CASE WHEN "work_phone" IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(jsonb_build_object('type', 'work', 'value', "work_phone")) END)
  || (CASE WHEN "mobile_phone" IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(jsonb_build_object('type', 'mobile', 'value', "mobile_phone")) END)
WHERE "work_phone" IS NOT NULL OR "mobile_phone" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "auth_person" DROP COLUMN "work_phone";--> statement-breakpoint
ALTER TABLE "auth_person" DROP COLUMN "mobile_phone";`;

test('a database that applied the migration before its fix runs nothing again, since Drizzle compares no hash', async () => {
  const applied = await upgradeDatabase();
  try {
    const entries = await journal(),
      entry = entries[position(entries, NAME)]!;
    const recorded = async () =>
      (await applied.db.execute(
        sql.raw(`select id, hash, created_at::text as "when" from drizzle.__drizzle_migrations order by id`),
      )) as unknown as { id: number; hash: string; when: string }[];
    // An installation that took every migration there is, this one as it stood before its fix, recorded that file's
    // hash, the one pinned below; the file has changed since.
    await applied.migrate(entries, { [entry.tag]: APPLIED });
    const before = await recorded();
    expect(before).toHaveLength(entries.length);
    expect(before.find(m => m.when === String(entry.when))?.hash).toBe(sha256(APPLIED));
    expect(sha256(APPLIED)).toBe('c19791e68d5cac72bce595786661d8959b5a1c3259f5e4d5020635016a24b095');
    expect(sha256(await readFile(join(MIGRATIONS, entry.tag + '.sql'), 'utf8'))).not.toBe(sha256(APPLIED));
    // `bun run db:init` with the fixed file: nothing runs, nothing fails and nothing recorded changes.
    await applied.migrate();
    expect(await recorded()).toEqual(before);
  } finally {
    await applied.drop();
  }
}, 60_000);
