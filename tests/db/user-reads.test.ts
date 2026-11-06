import { afterAll } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { inArray } from 'drizzle-orm';
import { database, schema } from '../../packages/db/src/index';
import { postgresUserReads } from '../../apps/server/src/modules/people/adapters/postgres';
import { userReadActors, userReadsContract } from '../user-reads-contract';

const actors = userReadActors('test-users-' + randomUUID());
const ids = actors.map(a => a.id);
afterAll(async () => {
  await database().delete(schema.accessGrants).where(inArray(schema.accessGrants.personId, ids));
  await database().delete(schema.people).where(inArray(schema.people.id, ids));
});
userReadsContract('postgres', async () => {
  await database().transaction(async tx => {
    await tx.insert(schema.people).values(actors.map(a => ({ id: a.id, name: a.name, organisationId: 'test' })));
    await tx.insert(schema.accessGrants).values(
      actors.map(a => ({
        personId: a.id,
        unitId: a.unitId,
        unitLabel: a.unitLabel,
        role: a.role,
        capabilities: a.role === 'manager' ? ['test.read'] : [],
      })),
    );
  });
  return { actors, reads: postgresUserReads() };
});
