import { afterAll } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { inArray } from 'drizzle-orm';
import { database, schema } from '../../packages/db/src/index';
import { postgresProvisionStore, postgresUserReads } from '../../apps/server/src/modules/people/adapters/postgres';
import { directoryUsecases } from '../../apps/server/src/modules/people/usecases';
import { userReadActors, userReadColleague, userReadNames, userReadsContract } from '../user-reads-contract';

const actors = userReadActors('test-users-' + randomUUID());
const colleague = userReadColleague(actors);
const ids = [...actors.map(a => a.id), colleague.id];
afterAll(async () => {
  await database().delete(schema.assignments).where(inArray(schema.assignments.personId, ids));
  await database().delete(schema.accessGrants).where(inArray(schema.accessGrants.personId, ids));
  await database().delete(schema.people).where(inArray(schema.people.id, ids));
  await database()
    .delete(schema.units)
    .where(
      inArray(
        schema.units.id,
        actors.map(a => a.unitId),
      ),
    );
});
const reads = () => ({ ...postgresUserReads(), ...directoryUsecases({ store: postgresProvisionStore() }) });
let prepared = false;
userReadsContract('postgres', async () => {
  // The contract has two cases; the rows are written once.
  if (prepared) return { actors, reads: reads() };
  prepared = true;
  await database().transaction(async tx => {
    await tx
      .insert(schema.people)
      .values([
        ...actors.map(a => ({ id: a.id, name: a.name, organisationId: 'test', userName: userReadNames(actors)[a.id] })),
        { id: colleague.id, name: colleague.name, organisationId: 'test' },
      ]);
    await tx
      .insert(schema.units)
      .values(actors.map(a => ({ id: a.unitId, organisationId: 'test', label: a.unitLabel })));
    await tx
      .insert(schema.assignments)
      .values([
        ...actors.map(a => ({ personId: a.id, unitId: a.unitId, role: a.role })),
        ...colleague.placed.map(p => ({ personId: colleague.id, ...p })),
      ]);
    // The colleague's grant names the unit they lead, as the derivation writes it.
    await tx.insert(schema.accessGrants).values([
      ...actors.map(a => ({
        personId: a.id,
        unitId: a.unitId,
        unitLabel: a.unitLabel,
        role: a.role,
        capabilities: a.role === 'manager' ? ['test.read'] : [],
      })),
      {
        personId: colleague.id,
        unitId: actors[0].unitId,
        unitLabel: actors[0].unitLabel,
        role: 'manager' as const,
        capabilities: [],
      },
    ]);
  });
  return { actors, reads: reads() };
});
