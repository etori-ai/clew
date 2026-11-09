import { afterAll, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { eq, inArray, like } from 'drizzle-orm';
import { database, schema } from '../../packages/db/src/index';
import { postgresUnits } from '../../apps/server/src/connectors/adapters/postgres';

/**
 * The provisioned identity tables (D68, D85) on Postgres: units, several assignments per person, groups with members,
 * the capability mapping, and the person's provisioning columns. Run with `bun run test:db` inside the devcontainer.
 */
if (!process.env.DATABASE_URL)
  throw new Error('DATABASE_URL is not set. Run `bun run test:db` inside the devcontainer.');
const prefix = 'test-idm-' + randomUUID(),
  lena = prefix + '-lena',
  group = prefix + ':group',
  unitIds = [prefix + '-one', prefix + '-two'];
afterAll(async () => {
  await database()
    .delete(schema.groupCapabilities)
    .where(like(schema.groupCapabilities.groupExternalId, prefix + '%'));
  await database()
    .delete(schema.groups)
    .where(like(schema.groups.externalId, prefix + '%'));
  await database().delete(schema.assignments).where(eq(schema.assignments.personId, lena));
  await database().delete(schema.units).where(inArray(schema.units.id, unitIds));
  await database().delete(schema.people).where(eq(schema.people.id, lena));
});
test('a person holds several assignments, the units are listed by label, and a group maps to a capability', async () => {
  await database().transaction(async tx => {
    await tx.insert(schema.people).values({
      id: lena,
      organisationId: 'test',
      name: 'Lena',
      externalId: prefix + ':ext',
      userName: prefix + ':lena',
      email: 'lena@example.test',
    });
    await tx.insert(schema.units).values([
      { id: unitIds[0]!, organisationId: 'test', label: 'Zebra' },
      { id: unitIds[1]!, organisationId: 'test', label: 'Alpha' },
    ]);
    await tx.insert(schema.assignments).values([
      { personId: lena, unitId: unitIds[0]!, role: 'employee' },
      { personId: lena, unitId: unitIds[1]!, role: 'manager' },
    ]);
    await tx
      .insert(schema.groups)
      .values({ id: group, organisationId: 'test', externalId: group, label: 'Any directory group' });
    await tx.insert(schema.groupMembers).values({ groupId: group, personId: lena });
    await tx.insert(schema.groupCapabilities).values({ groupExternalId: group, capability: 'admin.users' });
  });
  const held = await database().select().from(schema.assignments).where(eq(schema.assignments.personId, lena));
  expect(held.map(a => a.role).sort()).toEqual(['employee', 'manager']);
  const listed = (await postgresUnits().list()).filter(u => unitIds.includes(u.id));
  expect(listed.map(u => u.label)).toEqual(['Alpha', 'Zebra']);
  // A second assignment to the same unit is the same row, not a second one.
  await expect(
    database().insert(schema.assignments).values({ personId: lena, unitId: unitIds[0]!, role: 'manager' }).execute(),
  ).rejects.toThrow();
  // Removing a group removes its memberships; the group-capability row stays for the group's return (D85).
  await database().delete(schema.groups).where(eq(schema.groups.id, group));
  expect(await database().select().from(schema.groupMembers).where(eq(schema.groupMembers.personId, lena))).toEqual([]);
  expect(
    await database().select().from(schema.groupCapabilities).where(eq(schema.groupCapabilities.groupExternalId, group)),
  ).toHaveLength(1);
});
test('user names and external ids are unique, and rows from before provisioning may leave them empty', async () => {
  const other = prefix + '-other';
  try {
    await database().insert(schema.people).values({ id: other, organisationId: 'test', name: 'Legacy' });
    await expect(
      database()
        .insert(schema.people)
        .values({ id: other + '-2', organisationId: 'test', name: 'Twin', userName: prefix + ':lena' })
        .execute(),
    ).rejects.toThrow();
  } finally {
    await database()
      .delete(schema.people)
      .where(inArray(schema.people.id, [other, other + '-2']));
  }
});
