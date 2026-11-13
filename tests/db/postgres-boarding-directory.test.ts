import { afterAll } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { inArray, like } from 'drizzle-orm';
import { database, schema } from '../../packages/db/src/index';
import { postgresBoardingDirectory } from '../../apps/server/src/modules/boarding/adapters/postgres';
import { boardingDirectoryContract } from '../boarding-directory-contract';

/**
 * The boarding directory contract on Clew's directory tables (D124): people, units, assignments, `unit:` groups and
 * positions, written as provisioning writes them. Run with `bun run test:db` inside the devcontainer, never against the
 * shared development database.
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
      await db.delete(schema.personPositions).where(inArray(schema.personPositions.personId, people));
      await db.delete(schema.assignments).where(inArray(schema.assignments.personId, people));
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
        employments: person.employments.map(e => ({ unitId: person.assignments[0]?.unitId ?? '', ...e })),
      });
      if (person.assignments.length)
        await db.insert(schema.assignments).values(person.assignments.map(a => ({ personId: person.id, ...a })));
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
