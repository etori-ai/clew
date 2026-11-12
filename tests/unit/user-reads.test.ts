import {
  USER_READ_ORGANISATION,
  userReadActors,
  userReadNames,
  userReadOthers,
  userReadsContract,
} from '../user-reads-contract';

/** A user name as the people table compares it: without regard to case, in its composed form (NFC). */
const folded = (name: string) => name.normalize('NFC').toLowerCase();

userReadsContract('memory', async () => {
  const actors = userReadActors('memory-user'),
    others = userReadOthers('memory-user');
  // The people table: the actors in one organisation, beside a person of another, a deactivated one of theirs and two
  // of theirs whose user names differ only in how they are composed.
  const people: Array<{ id: string; organisationId: string; userName: string | null }> = [
    ...actors.map(a => ({
      id: a.id,
      organisationId: USER_READ_ORGANISATION,
      userName: userReadNames(actors)[a.id] ?? null,
    })),
    ...others,
  ];
  return {
    actors,
    others,
    reads: {
      capabilities: async id => (actors.find(a => a.id === id)?.role === 'manager' ? ['test.read'] : []),
      directory: async unitId =>
        actors.filter(a => a.unitId === unitId).map(({ id, name, role }) => ({ id, name, role })),
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
