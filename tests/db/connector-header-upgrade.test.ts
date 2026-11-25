import { afterAll, beforeAll, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { journal, position, upgradeDatabase, type Entry, type UpgradeDatabase } from './upgrade';

/**
 * An upgrade through the migration that leaves one holder of the shared header (`connector_header_holder_one`: D88,
 * DE-M5) on a database with two rows holding it. Drizzle runs every pending migration in one transaction, so the run
 * here has one migration before it that writes a connector row and one after it that alters every table it writes:
 * neither may meet deferred trigger events still queued ("pending trigger events", 55006). The holder changed last
 * keeps the header; the other gives it up as the administration page changes a row, with its version and time moved
 * on and a `connector.header` audit row by `system:migration`; from then on the database refuses a second holder. Run
 * with `bun run test:db` inside the devcontainer: the database is created beside the suite's and dropped afterwards.
 */
if (!process.env.DATABASE_URL)
  throw new Error('DATABASE_URL is not set. Run `bun run test:db` inside the devcontainer.');

let installation: UpgradeDatabase;
let upgrade: () => Promise<void>;

beforeAll(async () => {
  installation = await upgradeDatabase();
  const entries = await journal(),
    at = position(entries, 'connector_header_holder_one');
  const before = entries.slice(0, at),
    target = entries[at]!;
  await installation.migrate(before);
  await installation.db.execute(sql.raw(SEED));
  // One migration before the target that writes a connector row, and one after it that alters every table the target
  // writes, run with it in the one transaction Drizzle runs every pending migration in.
  const previous = before.at(-1)!;
  if (previous.when + 1 >= target.when) throw new Error('No room in the journal for a migration before the target.');
  const writes: Entry = { ...previous, when: previous.when + 1, tag: 'upgrade_probe_before' },
    alters: Entry = { ...target, idx: target.idx + 1, when: target.when + 1, tag: 'upgrade_probe_after' };
  const probes = {
    upgrade_probe_before: `UPDATE "connector" SET "state" = "state" WHERE "id" = 'finance';`,
    upgrade_probe_after: ['connector', 'audit']
      .map(table => `ALTER TABLE "${table}" ADD COLUMN "upgrade_probe" text;`)
      .join('--> statement-breakpoint\n'),
  };
  upgrade = () => installation.migrate([...before, writes, target, alters], probes);
}, 60_000);
afterAll(() => installation?.drop());

/** Two rows holding the header, the one changed last `sharepoint`, and one that never held it. */
const SEED = `
INSERT INTO connector (id, bundled, state, created_by, updated_by, header_holder, updated_at, version) VALUES
 ('intranet', true, 'enabled', 'system:boot', 'person:anna', true, '2026-11-01T08:00:00Z', 4),
 ('sharepoint', true, 'enabled', 'system:boot', 'person:bo', true, '2026-11-02T08:00:00Z', 2),
 ('finance', true, 'enabled', 'system:boot', 'system:boot', false, '2026-11-03T08:00:00Z', 1);
`;
const rows = async <T>(query: string) => (await installation.db.execute(sql.raw(query))) as unknown as T[];
/** A time as an ISO instant, whatever the session's time zone. */
const instant = (column: string) => `to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

test('an upgrade with rows runs in one transaction with the migrations around it, keeps the header with the holder changed last and audits the other giving it up', async () => {
  await upgrade();
  const connectors = await rows<{ id: string; holder: boolean; version: number; by: string; updated: string }>(
    `select id, header_holder as holder, version, updated_by as by, ${instant('updated_at')} as updated
       from connector order by id`,
  );
  const audit = await rows<{ actor: string; action: string; subject: string; details: unknown; at: string }>(
    `select actor, action, subject, details, ${instant('created_at')} as at from audit order by id`,
  );
  expect(audit.map(({ at: _, ...row }) => row)).toEqual([
    {
      actor: 'system:migration',
      action: 'connector.header',
      subject: 'connector:intranet',
      details: { to: false, keptBy: 'sharepoint', reason: 'migration' },
    },
  ]);
  // The row that gave it up moved on as a page's change moves one, at the migration's own time; the others stand.
  expect(connectors).toEqual([
    { id: 'finance', holder: false, version: 1, by: 'system:boot', updated: '2026-11-03T08:00:00.000Z' },
    { id: 'intranet', holder: false, version: 5, by: 'system:migration', updated: audit[0]!.at },
    { id: 'sharepoint', holder: true, version: 2, by: 'person:bo', updated: '2026-11-02T08:00:00.000Z' },
  ]);
  // The probe after it altered both tables, so nothing the target wrote was left pending.
  const probed = await rows<{ table: string }>(
    `select table_name as table from information_schema.columns where column_name = 'upgrade_probe' order by table_name`,
  );
  expect(probed.map(row => row.table)).toEqual(['audit', 'connector']);
});

test('after the upgrade the database refuses a second holder of the header', async () => {
  await expect(
    installation.db.execute(sql`update connector set header_holder = true where id = 'intranet'`).then(() => undefined),
  ).rejects.toMatchObject({ cause: { code: '23505' } });
  const holders = await rows<{ id: string }>(`select id from connector where header_holder order by id`);
  expect(holders.map(row => row.id)).toEqual(['sharepoint']);
});
