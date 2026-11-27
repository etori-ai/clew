import { memoryProvisionStore } from '../../apps/server/src/modules/people/adapters/memory';
import { directoryUsecases } from '../../apps/server/src/modules/people/usecases';
import { memoryPersonKeys } from '../person-keys';
import { userRow } from '../scim-store-contract';
import {
  USER_READ_ORGANISATION,
  userReadActors,
  userReadAddresses,
  userReadColleague,
  userReadNames,
  userReadOthers,
  userReadsContract,
} from '../user-reads-contract';

/**
 * The user reads on memory: the directory over the memory provisioning store, and whose a user name is through
 * `memoryPersonKeys`, the helper every unit suite binds where the server binds the people module's user reads (DE-M7),
 * so the rules it keeps (the reader's organisation, case and composition, a name two people hold) are the contract's.
 */
userReadsContract('memory', async () => {
  const actors = userReadActors('memory-user'),
    colleague = userReadColleague(actors),
    others = userReadOthers('memory-user'),
    store = memoryProvisionStore();
  // The people table: the actors and their colleague in one organisation, beside a person of another, a deactivated
  // one of theirs and two of theirs whose user names differ only in how they are composed.
  await store.transaction(async tx => {
    await tx.writeUnits(
      USER_READ_ORGANISATION,
      actors.map(a => ({ id: a.unitId, label: a.unitLabel })),
    );
    for (const a of actors) {
      await tx.insertUser(
        userRow(a.id, USER_READ_ORGANISATION, {
          name: a.name,
          userName: userReadNames(actors)[a.id],
          email: userReadAddresses(actors)[a.id] ?? null,
        }),
      );
      await tx.replaceUnits(a.id, { belongs: [a.unitId], leads: a.role === 'manager' ? [a.unitId] : [] });
    }
    await tx.insertUser(userRow(colleague.id, USER_READ_ORGANISATION, { name: colleague.name, userName: null }));
    await tx.replaceUnits(colleague.id, {
      belongs: colleague.placed.map(placed => placed.unitId),
      leads: colleague.placed.filter(placed => placed.role === 'manager').map(placed => placed.unitId),
    });
    for (const other of others)
      await tx.insertUser(
        userRow(other.id, other.organisationId, { name: other.name, userName: other.userName, enabled: other.enabled }),
      );
  });
  const keys = memoryPersonKeys(store.state);
  return {
    actors,
    others,
    reads: {
      capabilities: async id => (actors.find(a => a.id === id)?.role === 'manager' ? ['test.read'] : []),
      ...directoryUsecases({ store }),
      userName: keys.userName,
      email: keys.email,
      holders: keys.holders,
      enabled: keys.enabled,
    },
  };
});
