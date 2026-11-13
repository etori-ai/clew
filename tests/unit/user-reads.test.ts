import { memoryProvisionStore } from '../../apps/server/src/modules/people/adapters/memory';
import { directoryUsecases } from '../../apps/server/src/modules/people/usecases';
import { userRow } from '../scim-store-contract';
import { userReadActors, userReadColleague, userReadNames, userReadsContract } from '../user-reads-contract';

userReadsContract('memory', async () => {
  const actors = userReadActors('memory-user'),
    colleague = userReadColleague(actors),
    store = memoryProvisionStore();
  await store.transaction(async tx => {
    await tx.writeUnits(
      'test',
      actors.map(a => ({ id: a.unitId, label: a.unitLabel })),
    );
    for (const a of actors) {
      await tx.insertUser(userRow(a.id, 'test', { name: a.name, userName: userReadNames(actors)[a.id] }));
      await tx.replaceAssignments(a.id, [{ unitId: a.unitId, role: a.role }]);
    }
    await tx.insertUser(userRow(colleague.id, 'test', { name: colleague.name }));
    await tx.replaceAssignments(colleague.id, colleague.placed);
  });
  return {
    actors,
    reads: {
      capabilities: async id => (actors.find(a => a.id === id)?.role === 'manager' ? ['test.read'] : []),
      userName: async id => userReadNames(actors)[id] ?? null,
      ...directoryUsecases({ store }),
    },
  };
});
