import { userReadActors, userReadsContract } from '../user-reads-contract';

userReadsContract('memory', async () => {
  const actors = userReadActors('memory-user');
  return {
    actors,
    reads: {
      capabilities: async id => (actors.find(a => a.id === id)?.role === 'manager' ? ['test.read'] : []),
      directory: async unitId =>
        actors.filter(a => a.unitId === unitId).map(({ id, name, role }) => ({ id, name, role })),
    },
  };
});
