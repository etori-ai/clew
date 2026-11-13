import { memoryProvisionStore } from '../../apps/server/src/modules/people/adapters/memory';
import { directoryUsecases } from '../../apps/server/src/modules/people/usecases';
import { userRow } from '../scim-store-contract';
import {
  USER_READ_ORGANISATION,
  userReadActors,
  userReadColleague,
  userReadNames,
  userReadOthers,
  userReadsContract,
} from '../user-reads-contract';

/** A user name as the people table compares it: without regard to case, in its composed form (NFC). */
const folded = (name: string) => name.normalize('NFC').toLowerCase();

userReadsContract('memory', async () => {
  const actors = userReadActors('memory-user'),
    colleague = userReadColleague(actors),
    others = userReadOthers('memory-user'),
    store = memoryProvisionStore();
  await store.transaction(async tx => {
    await tx.writeUnits(
      USER_READ_ORGANISATION,
      actors.map(a => ({ id: a.unitId, label: a.unitLabel })),
    );
    for (const a of actors) {
      await tx.insertUser(
        userRow(a.id, USER_READ_ORGANISATION, { name: a.name, userName: userReadNames(actors)[a.id] }),
      );
      await tx.replaceAssignments(a.id, [{ unitId: a.unitId, role: a.role }]);
    }
    await tx.insertUser(userRow(colleague.id, USER_READ_ORGANISATION, { name: colleague.name }));
    await tx.replaceAssignments(colleague.id, colleague.placed);
  });
  // The people table: the actors and their colleague in one organisation, beside a person of another, a deactivated
  // one of theirs and two of theirs whose user names differ only in how they are composed.
  const people: Array<{ id: string; organisationId: string; userName: string | null }> = [
    ...actors.map(a => ({
      id: a.id,
      organisationId: USER_READ_ORGANISATION,
      userName: userReadNames(actors)[a.id] ?? null,
    })),
    { id: colleague.id, organisationId: USER_READ_ORGANISATION, userName: null },
    ...others,
  ];
  return {
    actors,
    others,
    reads: {
      capabilities: async id => (actors.find(a => a.id === id)?.role === 'manager' ? ['test.read'] : []),
      ...directoryUsecases({ store }),
      userName: async id => people.find(p => p.id === id)?.userName ?? null,
      holders: async (readerId, userNames) => {
        const held = new Map<string, string>();
        const reader = people.find(p => p.id === readerId);
        if (!reader) return held;
        for (const name of userNames) {
          const ids = people
            .filter(
              p =>
                p.organisationId === reader.organisationId &&
                p.userName !== null &&
                folded(p.userName) === folded(name),
            )
            .map(p => p.id);
          // Two holders of spellings that compare alike leave the name naming nobody.
          if (ids.length === 1) held.set(name, ids[0]!);
        }
        return held;
      },
      exists: async id => people.some(p => p.id === id),
    },
  };
});
