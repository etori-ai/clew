import { afterAll } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { inArray, like } from 'drizzle-orm';
import { database, schema } from '../../packages/db/src/index';
import { postgresBoardingDirectory } from '../../apps/server/src/modules/boarding/adapters/postgres';
import { boardingDirectoryContract } from '../boarding-directory-contract';

/**
 * The boarding directory contract on Clew's directory tables (D124): people, their employments with the manager each
 * names (D147), units, assignments, `unit:` groups and positions, written as provisioning writes them. Run with
 * `bun run test:db` inside the devcontainer, never against the shared development database.
 */
if (!process.env.DATABASE_URL)
  throw new Error('DATABASE_URL is not set. Run `bun run test:db` inside the devcontainer.');
const prefixes: string[] = [];
afterAll(async () => {
  const db = database();
  for (const p of prefixes) {
    const people = (
      await db
        .select({ id: schema.people.id })
        .from(schema.people)
        .where(like(schema.people.id, p + '%'))
    ).map(r => r.id);
    if (people.length) {
      // Before the people go: a row names its manager, and every row that names one of these people is one of theirs.
      await db.delete(schema.employments).where(inArray(schema.employments.personId, people));
      await db.delete(schema.personPositions).where(inArray(schema.personPositions.personId, people));
      await db.delete(schema.assignments).where(inArray(schema.assignments.personId, people));
      await db.delete(schema.unitLeads).where(inArray(schema.unitLeads.personId, people));
    }
    await db.delete(schema.positions).where(like(schema.positions.id, p + '%'));
    await db.delete(schema.groups).where(like(schema.groups.id, p + '%'));
    await db.delete(schema.units).where(like(schema.units.id, p + '%'));
    await db.delete(schema.people).where(like(schema.people.id, p + '%'));
  }
});

boardingDirectoryContract('postgres', async () => {
  const prefix = 'test-bdir-' + randomUUID().slice(0, 8);
  prefixes.push(prefix);
  const db = database();
  return {
    directory: postgresBoardingDirectory(),
    prefix,
    async seedUnit(unit) {
      await db.insert(schema.units).values({ id: unit.id, organisationId: unit.organisationId, label: unit.label });
      await db.insert(schema.groups).values({
        id: prefix + '-group-' + unit.id,
        organisationId: unit.organisationId,
        externalId: 'unit:' + unit.id,
        label: unit.label,
        parentUnitId: unit.parentId,
      });
    },
    async seedPerson(person) {
      await db.insert(schema.people).values({
        id: person.id,
        organisationId: person.organisationId,
        name: person.name,
        enabled: person.enabled,
      });
      // One row per employment, with the manager it names: the suite seeds that manager first, as the reference from
      // `manager_id` to a person needs. The seed's employments carry no unit, so each row takes the first assignment's.
      if (person.employments.length)
        await db.insert(schema.employments).values(
          person.employments.map(({ managerId, ...job }, position) => ({
            personId: person.id,
            position,
            unitId: person.assignments[0]?.unitId ?? '',
            ...job,
            // The table refuses a row that names its own person (`auth_employment_not_own_manager`), so what the suite
            // seeds for that case cannot be held here: the row is written without a manager.
            managerId: managerId !== undefined && managerId !== person.id ? managerId : null,
          })),
        );
      // D149: the seed's row says the person is on the unit, and leads it where the role is `manager`. Where a
      // person belongs and what they lead are two tables.
      if (person.assignments.length)
        await db
          .insert(schema.assignments)
          .values(person.assignments.map(a => ({ personId: person.id, unitId: a.unitId })));
      const led = person.assignments.filter(a => a.role === 'manager');
      if (led.length)
        await db.insert(schema.unitLeads).values(led.map(a => ({ personId: person.id, unitId: a.unitId })));
      for (const code of person.positionCodes) {
        const id = prefix + '-position-' + code;
        await db
          .insert(schema.positions)
          .values({ id, organisationId: person.organisationId, code, label: code })
          .onConflictDoNothing();
        await db.insert(schema.personPositions).values({ personId: person.id, positionId: id });
      }
    },
  };
});
