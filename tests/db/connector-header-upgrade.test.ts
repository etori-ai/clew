import { expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { journal, position, upgradeDatabase } from './upgrade';

/**
 * The one holder of the shared header (D88, DE-M5): an installation upgraded with two rows holding it keeps the one
 * changed last, and from then on the database refuses a second holder.
 */
test('the upgrade keeps the header with the holder changed last, and the index then refuses a second holder', async () => {
  const installation = await upgradeDatabase();
  try {
    const entries = await journal();
    await installation.migrate(entries.slice(0, position(entries, 'connector_header_holder_one')));
    const db = installation.db;
    await db.execute(sql`insert into connector (id, bundled, state, created_by, updated_by, header_holder, updated_at)
      values ('intranet', true, 'enabled', 'system:boot', 'system:boot', true, '2026-11-01'),
             ('sharepoint', true, 'enabled', 'system:boot', 'system:boot', true, '2026-11-02'),
             ('finance', true, 'enabled', 'system:boot', 'system:boot', false, '2026-11-03')`);
    await installation.migrate();
    const holders = async () =>
      [...(await db.execute<{ id: string }>(sql`select id from connector where header_holder order by id`))].map(
        row => row.id,
      );
    expect(await holders()).toEqual(['sharepoint']);
    await expect(
      db.execute(sql`update connector set header_holder = true where id = 'intranet'`).then(() => undefined),
    ).rejects.toMatchObject({ cause: { code: '23505' } });
    expect(await holders()).toEqual(['sharepoint']);
  } finally {
    await installation.drop();
  }
}, 60_000);
