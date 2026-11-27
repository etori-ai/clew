import { expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { journal, upgradeDatabase } from './upgrade';

test('the migration to two tables moves who leads a unit, and keeps a leader as one of the unit’s people only where an employment or the unit’s group says so (D149)', async () => {
  const own = await upgradeDatabase();
  try {
    const entries = await journal();
    const target = entries.find(entry => entry.tag === '0003_who_leads_a_unit')!;
    const previous = entries.filter(entry => entry.idx < target.idx);
    await own.migrate(previous);
    // Rut leads the school by its manager group alone and is employed at the office. Hillevi leads it and is employed
    // on it, Karin leads the office and is in its unit group, and Anna is an employee of the school.
    await own.db.execute(sql`
      insert into auth_unit (id, organisation_id, label) values ('school', 'org', 'School'), ('office', 'org', 'Office')`);
    await own.db.execute(sql`
      insert into auth_person (id, organisation_id, name) values
        ('rut', 'org', 'Rut'), ('hillevi', 'org', 'Hillevi'), ('karin', 'org', 'Karin'), ('anna', 'org', 'Anna')`);
    await own.db.execute(sql`
      insert into auth_employment (person_id, position, unit_id) values
        ('rut', 0, 'office'), ('hillevi', 0, 'school'), ('anna', 0, 'school')`);
    await own.db.execute(sql`
      insert into auth_group (id, organisation_id, external_id, label) values ('g-office', 'org', 'unit:office', 'Office')`);
    await own.db.execute(sql`insert into auth_group_member (group_id, person_id) values ('g-office', 'karin')`);
    await own.db.execute(sql`
      insert into auth_assignment (person_id, unit_id, role) values
        ('rut', 'school', 'manager'), ('rut', 'office', 'employee'),
        ('hillevi', 'school', 'manager'), ('karin', 'office', 'manager'), ('anna', 'school', 'employee')`);

    await own.migrate([...previous, target]);

    const pairs = async (table: 'auth_assignment' | 'auth_unit_lead') =>
      (
        await own.db.execute<{ person_id: string; unit_id: string }>(
          sql`select person_id, unit_id from ${sql.identifier(table)} order by person_id, unit_id`,
        )
      ).map(row => row.person_id + ':' + row.unit_id);
    expect(await pairs('auth_unit_lead')).toEqual(['hillevi:school', 'karin:office', 'rut:school']);
    // Rut is no longer one of the school's people; everybody else belongs where they did.
    expect(await pairs('auth_assignment')).toEqual(['anna:school', 'hillevi:school', 'karin:office', 'rut:office']);
    expect(
      await own.db.execute(sql`select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'auth_assignment' and column_name = 'role'`),
    ).toHaveLength(0);
    // The change signals, hand-written as every such trigger is (D46): of the new table, and of the employments, which
    // had none since they became rows.
    expect(
      (
        await own.db.execute<{ tgname: string }>(
          sql`select tgname from pg_trigger where tgname in ('auth_unit_lead_changed', 'auth_employment_changed') and not tgisinternal order by tgname`,
        )
      ).map(row => row.tgname),
    ).toEqual(['auth_employment_changed', 'auth_unit_lead_changed']);
  } finally {
    await own.drop();
  }
}, 60_000);
