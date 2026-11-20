import { expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { postgresProvisionStore } from '../../apps/server/src/modules/people/adapters/postgres';
import { provisioningUsecases } from '../../apps/server/src/modules/people/usecases';
import { journal, position, upgradeDatabase } from './upgrade';

/**
 * D135: the migration that puts every assignment on the grant of a person who holds more than one. It fills the column
 * from the assignment and unit tables, writes nothing for a person with one, and leaves each grant as the derivation
 * would write it, so the first reconciliation after it writes no audit row.
 */
test('the grant assignments upgrade fills the grants of people with several units and nothing else', async () => {
  const installation = await upgradeDatabase();
  try {
    const entries = await journal(),
      at = position(entries, 'grant_assignments');
    await installation.migrate(entries.slice(0, at));
    const db = installation.db;
    await db.execute(sql`insert into auth_person (id, organisation_id, name, external_id, user_name, updated_at)
      values ('p-one', 'org', 'One Unit', 'src-one', 'one', '2025-01-01'),
             ('p-two', 'org', 'Two Units', 'src-two', 'two', '2025-01-01'),
             ('p-head', 'org', 'Head Without Group', 'src-head', 'head', '2025-01-01')`);
    // `u-c` has no `unit:` group: the head who leads it is named by the unit table alone.
    await db.execute(sql`insert into auth_unit (id, organisation_id, label)
      values ('u-a', 'org', 'Avdelning A'), ('u-b', 'org', 'Avdelning B'), ('u-c', 'org', 'Avdelning C')`);
    await db.execute(sql`insert into auth_group (id, organisation_id, external_id, label)
      values ('g-a', 'org', 'unit:u-a', 'Avdelning A'), ('g-b', 'org', 'unit:u-b', 'Avdelning B'),
             ('g-bm', 'org', 'unit-manager:u-b', 'Chefer B'), ('g-cm', 'org', 'unit-manager:u-c', 'Chefer C')`);
    await db.execute(sql`insert into auth_group_member (group_id, person_id)
      values ('g-a', 'p-one'), ('g-a', 'p-two'), ('g-bm', 'p-two'), ('g-a', 'p-head'), ('g-cm', 'p-head')`);
    await db.execute(sql`insert into auth_assignment (person_id, unit_id, role)
      values ('p-one', 'u-a', 'employee'), ('p-two', 'u-a', 'employee'), ('p-two', 'u-b', 'manager'),
             ('p-head', 'u-a', 'employee'), ('p-head', 'u-c', 'manager')`);
    await db.execute(sql`insert into auth_access_grant (person_id, unit_id, unit_label, role, capabilities)
      values ('p-one', 'u-a', 'Avdelning A', 'employee', '[]'::jsonb),
             ('p-two', 'u-b', 'Avdelning B', 'manager', '[]'::jsonb),
             ('p-head', 'u-c', 'Avdelning C', 'manager', '[]'::jsonb)`);
    const changes = async () =>
      Object.fromEntries(
        [
          ...(await db.execute<{ person_id: string; policy: string }>(
            sql`select person_id, policy::text as policy from person_change order by person_id`,
          )),
        ].map(r => [r.person_id, r.policy]),
      );
    const before = await changes();

    await installation.migrate();

    const grants = [
      ...(await db.execute<{ person_id: string; assignments: unknown }>(
        sql`select person_id, assignments from auth_access_grant order by person_id`,
      )),
    ];
    expect(Object.fromEntries(grants.map(g => [g.person_id, g.assignments]))).toEqual({
      'p-head': [
        { unitId: 'u-a', unitLabel: 'Avdelning A', role: 'employee' },
        { unitId: 'u-c', unitLabel: 'Avdelning C', role: 'manager' },
      ],
      'p-one': [],
      'p-two': [
        { unitId: 'u-a', unitLabel: 'Avdelning A', role: 'employee' },
        { unitId: 'u-b', unitLabel: 'Avdelning B', role: 'manager' },
      ],
    });
    // Only the grants the migration wrote tell a browser of a change.
    const after = await changes();
    expect(after['p-one']).toBe(before['p-one']);
    expect(after['p-two']).not.toBe(before['p-two']);

    // The first reconciliation derives every person again and finds nothing to write.
    const derivation = provisioningUsecases({ store: postgresProvisionStore({ db: () => db }) });
    for (const id of ['p-one', 'p-two', 'p-head']) await derivation.derivePerson('test:reconcile', id);
    const audited = [
      ...(await db.execute<{ action: string }>(sql`select action from audit where actor = 'test:reconcile'`)),
    ];
    expect(audited).toEqual([]);
  } finally {
    await installation.drop();
  }
}, 60_000);
