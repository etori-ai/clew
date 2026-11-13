import { expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { postgresProvisionStore } from '../../apps/server/src/modules/people/adapters/postgres';
import { scimUsecases } from '../../apps/server/src/modules/people/usecases';
import { journal, position, upgradeDatabase } from './upgrade';

test('the user name upgrade refuses ambiguous people, then preserves the owner for SCIM lookups and duplicate creates', async () => {
  const installation = await upgradeDatabase();
  try {
    const entries = await journal(),
      at = position(entries, 'normalize_stored_user_names');
    await installation.migrate(entries.slice(0, at));
    const db = installation.db,
      asa = 'Åsa'.normalize('NFD'),
      bo = 'Börje'.normalize('NFD');
    await db.execute(sql`insert into auth_person (id, organisation_id, name, external_id, user_name, updated_at)
      values ('p-asa', 'org', 'Åsa', 'source-1', ${asa}, '2025-01-01'),
             ('p-other', 'other-org', 'Another person', 'source-2', 'åsa', '2025-01-01'),
             ('p-bo', 'org', 'Börje', 'source-3', ${bo}, '2025-01-01')`);

    const names = () =>
      db.execute<{ id: string; user_name: string }>(sql`select id, user_name from auth_person order by id`);
    const audited = () =>
      db.execute<{ subject: string }>(sql`select subject from audit
      where actor = 'system:migration' and action = 'person.user_name_normalized' order by subject`);
    const original = [...(await names())];
    await expect(installation.migrate()).rejects.toMatchObject({
      cause: { code: '23505', message: 'Multiple people hold the same normalized SCIM user name.' },
    });
    expect([...(await names())]).toEqual(original);
    expect(await audited()).toHaveLength(0);

    // The source owner resolved the collision by person id. Re-running the ordinary migrator now succeeds.
    await db.execute(sql`update auth_person set user_name = 'other-account' where id = 'p-other'`);
    await installation.migrate();
    const scim = scimUsecases({
      store: postgresProvisionStore({ db: () => db }),
      clock: () => new Date(),
      ids: () => 'p-new',
      digest: token => token,
    });
    const provisioner = { id: 'directory', organisationId: 'org', label: 'Directory' },
      base = 'https://clew.test/scim/v2';
    for (const requested of [asa, 'Åsa', 'åsa']) {
      const { Resources } = await scim.listUsers(provisioner, { filter: `userName eq "${requested}"` }, base);
      expect(Resources.map(({ id, externalId, userName }) => ({ id, externalId, userName }))).toEqual([
        { id: 'p-asa', externalId: 'source-1', userName: 'Åsa' },
      ]);
      expect(Date.parse(Resources[0]!.meta.lastModified)).toBeGreaterThan(Date.parse('2025-01-01'));
    }
    await expect(
      scim.createUser(
        provisioner,
        {
          userName: 'Åsa',
          externalId: 'distinct-source-id',
          displayName: 'New person',
          emails: [{ value: 'new@example.test' }],
        },
        base,
      ),
    ).rejects.toMatchObject({ status: 409, scimType: 'uniqueness' });
    expect([...(await names())]).toEqual([
      { id: 'p-asa', user_name: 'Åsa' },
      { id: 'p-bo', user_name: 'Börje' },
      { id: 'p-other', user_name: 'other-account' },
    ]);
    await installation.migrate();
    expect((await audited()).map(row => row.subject)).toEqual(['person:p-asa', 'person:p-bo']);
  } finally {
    await installation.drop();
  }
}, 60_000);
