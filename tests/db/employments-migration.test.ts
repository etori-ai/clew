import { expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { employments } from '../../packages/db/src/schema';
import { journal, upgradeDatabase } from './upgrade';

test('the employment migration preserves each person’s ordered jobs and omits unreadable details', async () => {
  const own = await upgradeDatabase();
  try {
    const entries = await journal();
    const target = entries.find(entry => entry.tag === '0001_employments_as_rows')!;
    const previous = entries.filter(entry => entry.idx < target.idx);
    await own.migrate(previous);
    await own.db.execute(sql`
      insert into auth_person (id, organisation_id, name, employments) values
        ('anna', 'org', 'Anna', '[
          {"unitId":"school","title":"Teacher","employmentType":"Permanent","startDate":"2024-02-29","employmentPercentage":62.5},
          {"unitId":"office","title":"Tutor","startDate":"0000-01-01","employmentPercentage":"50%"},
          {"unitId":"school","startDate":"2025-02-29","employmentPercentage":101},
          {"title":"No unit"}
        ]'),
        ('bo', 'org', 'Bo', '[{"unitId":"library","startDate":"0001-01-01","employmentPercentage":0}]'),
        ('eva', 'org', 'Eva', '[]')`);

    const probe = { ...target, idx: target.idx + 1, when: target.when + 1, tag: 'probe_employment_tables' };
    await own.migrate([...previous, target, probe], {
      [probe.tag]:
        'ALTER TABLE auth_employment ADD COLUMN probe boolean;\n--> statement-breakpoint\nALTER TABLE auth_person ADD COLUMN probe boolean;',
    });

    const rows = await own.db.select().from(employments).orderBy(employments.personId, employments.position);
    const emptyDetails = {
      managerId: null,
      title: null,
      employmentType: null,
      startDate: null,
      employmentPercentage: null,
    };
    expect(rows).toEqual([
      {
        ...emptyDetails,
        personId: 'anna',
        position: 0,
        unitId: 'school',
        title: 'Teacher',
        employmentType: 'Permanent',
        startDate: '2024-02-29',
        employmentPercentage: 62.5,
      },
      { ...emptyDetails, personId: 'anna', position: 1, unitId: 'office', title: 'Tutor' },
      { ...emptyDetails, personId: 'anna', position: 2, unitId: 'school' },
      {
        ...emptyDetails,
        personId: 'bo',
        position: 0,
        unitId: 'library',
        startDate: '0001-01-01',
        employmentPercentage: 0,
      },
    ]);
    expect(
      await own.db.execute(sql`select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'auth_person' and column_name = 'employments'`),
    ).toHaveLength(0);
  } finally {
    await own.drop();
  }
}, 60_000);
