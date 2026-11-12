import { userReadActors, userReadNames, userReadsContract } from '../user-reads-contract';

userReadsContract('memory', async () => {
  const actors = userReadActors('memory-user');
  return {
    actors,
    reads: {
      capabilities: async id => (actors.find(a => a.id === id)?.role === 'manager' ? ['test.read'] : []),
      directory: async unitId =>
        actors.filter(a => a.unitId === unitId).map(({ id, name, role }) => ({ id, name, role })),
      userName: async id => userReadNames(actors)[id] ?? null,
      holders: async (readerId, userNames) => {
        const held = new Map<string, string>();
        if (!(readerId in userReadNames(actors))) return held;
        for (const name of userNames)
          for (const [id, userName] of Object.entries(userReadNames(actors)))
            if (userName !== null && userName.toLowerCase() === name.toLowerCase()) held.set(name, id);
        return held;
      },
      exists: async id => id in userReadNames(actors),
    },
  };
});
