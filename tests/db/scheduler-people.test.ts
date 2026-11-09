import { afterAll, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { inArray } from 'drizzle-orm';
import { database, schema } from '../../packages/db/src/index';
import { postgresPeople } from '../../apps/server/src/scheduler/adapters/postgres';

/**
 * Who the nightly scan runs for (D68, narrowed 2026-11-09): enabled people with a grant who can sign in. Run with
 * `bun run test:db` inside the devcontainer.
 */
if (!process.env.DATABASE_URL)
  throw new Error('DATABASE_URL is not set. Run `bun run test:db` inside the devcontainer.');
const prefix = 'test-scan-' + randomUUID(),
  bound = prefix + '-bound',
  unbound = prefix + '-unbound',
  disabled = prefix + '-disabled',
  issuer = 'https://idp.test/' + prefix,
  ids = [bound, unbound, disabled];
afterAll(async () => {
  await database().delete(schema.identityBindings).where(inArray(schema.identityBindings.personId, ids));
  await database().delete(schema.accessGrants).where(inArray(schema.accessGrants.personId, ids));
  await database().delete(schema.people).where(inArray(schema.people.id, ids));
});
test('granted() names enabled people with a grant and a binding, nobody else', async () => {
  await database().transaction(async tx => {
    await tx.insert(schema.people).values([
      { id: bound, organisationId: 'test', name: 'Bound' },
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
      { issuer, subject: 'bound', personId: bound },
      { issuer, subject: 'disabled', personId: disabled },
    ]);
  });
  const granted = await postgresPeople().granted();
  expect(granted).toContain(bound);
  expect(granted).not.toContain(unbound);
  expect(granted).not.toContain(disabled);
});
