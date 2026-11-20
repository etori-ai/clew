import { afterAll, beforeAll, expect, test } from 'bun:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { inArray } from 'drizzle-orm';
import { database, schema } from '../../packages/db/src/index';
import { systemContext } from '../../apps/server/src/system-context';

/**
 * D135: the context background work acts with carries every assignment of a person who holds more than one, read from
 * the grant in the same read as the rest of their authority, and none for a person with one.
 */
const people: string[] = [];
beforeAll(() => {
  process.env.MASTER_KEY ??= randomBytes(32).toString('base64');
});
afterAll(async () => {
  if (!people.length) return;
  await database().delete(schema.accessGrants).where(inArray(schema.accessGrants.personId, people));
  await database().delete(schema.people).where(inArray(schema.people.id, people));
  // The rows the change signal wrote for them, so a run leaves nothing behind in a shared database.
  await database().delete(schema.personChanges).where(inArray(schema.personChanges.personId, people));
});
async function person(assignments: Array<{ unitId: string; unitLabel: string; role: 'manager' | 'employee' }>) {
  const id = 'context-assignments-' + randomUUID();
  people.push(id);
  await database().insert(schema.people).values({ id, organisationId: 'test', name: 'Synthetic context test' });
  await database()
    .insert(schema.accessGrants)
    .values({ personId: id, unitId: 'u-b', unitLabel: 'Enhet B', role: 'manager', capabilities: [], assignments });
  return id;
}

test('a person with two units acts with both on the context, in unit id order; one with a unit has none', async () => {
  const two = await person([
    { unitId: 'u-b', unitLabel: 'Enhet B', role: 'manager' },
    { unitId: 'u-a', unitLabel: 'Enhet A', role: 'employee' },
  ]);
  const one = await person([]);
  const both = await systemContext(two);
  expect(both).toMatchObject({ unitId: 'u-b', role: 'manager' });
  expect(both?.assignments).toEqual([
    { unitId: 'u-a', unitLabel: 'Enhet A', role: 'employee' },
    { unitId: 'u-b', unitLabel: 'Enhet B', role: 'manager' },
  ]);
  const single = await systemContext(one);
  expect(single).toMatchObject({ unitId: 'u-b', role: 'manager' });
  expect(single && 'assignments' in single).toBe(false);
  // The units are authority: the same primary unit and role, but not the same value.
  expect(both?.authorizationVersion).not.toBe(single?.authorizationVersion);
});
