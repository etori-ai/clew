import { afterAll, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { inArray } from 'drizzle-orm';
import { database, schema } from '../../packages/db/src/index';
import { postgresPeople } from '../../apps/server/src/scheduler/adapters/postgres';

/**
 * Who the nightly scan runs for (D68, narrowed 2026-11-09): enabled people with a grant who can sign in, read a page at
 * a time in id order, each page after the last id of the one before. Run with `bun run test:db` inside the
 * devcontainer.
 */
if (!process.env.DATABASE_URL)
  throw new Error('DATABASE_URL is not set. Run `bun run test:db` inside the devcontainer.');
const prefix = 'test-scan-' + randomUUID(),
  bound = [prefix + '-1', prefix + '-2', prefix + '-3'],
  unbound = prefix + '-unbound',
  disabled = prefix + '-disabled',
  issuer = 'https://idp.test/' + prefix,
  ids = [...bound, unbound, disabled];
afterAll(async () => {
  await database().delete(schema.identityBindings).where(inArray(schema.identityBindings.personId, ids));
  await database().delete(schema.accessGrants).where(inArray(schema.accessGrants.personId, ids));
  await database().delete(schema.people).where(inArray(schema.people.id, ids));
});
test('granted() names enabled people with a grant and a binding, nobody else, a page at a time in id order', async () => {
  await database().transaction(async tx => {
    await tx
      .insert(schema.people)
      .values([
        ...bound.map(id => ({ id, organisationId: 'test', name: 'Bound' })),
        { id: unbound, organisationId: 'test', name: 'Provisioned, never signed in' },
        { id: disabled, organisationId: 'test', name: 'Disabled', enabled: false },
      ]);
    await tx.insert(schema.accessGrants).values(
      ids.map(id => ({
        personId: id,
        unitId: 'unit-test',
        unitLabel: 'Test',
        role: 'employee' as const,
        capabilities: [],
      })),
    );
    await tx.insert(schema.identityBindings).values([
      ...bound.map(id => ({ issuer, subject: id, personId: id })),
      // Bound under a second issuer too: still one person on the page.
      { issuer: issuer + '/second', subject: bound[0]!, personId: bound[0]! },
      { issuer, subject: 'disabled', personId: disabled },
    ]);
  });
  const people = postgresPeople();
  // A page of two after the prefix holds the first two of ours, and the next page goes on after the last of them.
  const first = await people.granted({ after: prefix, limit: 2 });
  expect(first).toEqual([bound[0]!, bound[1]!]);
  expect((await people.granted({ after: first[1], limit: 2 }))[0]).toBe(bound[2]!);
  // Every page of the whole table, as the nightly scan reads them: each person once, ours among them, nobody else.
  const everyone: string[] = [];
  for (let page = await people.granted({ limit: 100 }); page.length;) {
    everyone.push(...page);
    if (page.length < 100) break;
    page = await people.granted({ after: page[page.length - 1], limit: 100 });
  }
  expect(new Set(everyone).size).toBe(everyone.length);
  expect(everyone.filter(id => id.startsWith(prefix))).toEqual(bound);
});
