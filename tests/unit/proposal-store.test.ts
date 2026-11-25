import { memoryProposalStore } from '../../apps/server/src/modules/calendar/adapters/memory';
import { proposalStoreContract } from '../proposal-store-contract';

proposalStoreContract('memory', async () => {
  // The invitations port as the contract binds it: a record of its own that commits on its own, as the talks module's
  // memory store does, so what it keeps is what the binding was told by a change that committed (DE-M7).
  const kept: Array<{ invitationId: string; op: string }> = [];
  const keep =
    (op: string) =>
    async (call: { invitationId: string }): Promise<void> => {
      kept.push({ invitationId: call.invitationId, op });
    };
  const store = memoryProposalStore({
    invitations: {
      established: keep('established'),
      observed: keep('observed'),
      moved: keep('moved'),
      ended: keep('ended'),
    },
  });
  return {
    store,
    people: ['hillevi', 'hassan'],
    auditFor: async subject => store.audit.filter(e => e.subject === subject),
    hasJob: async id => store.jobs.some(j => j.id === id),
    told: async id => kept.filter(i => i.invitationId === id).map(i => i.op),
    // The memory store holds only the threads it made: another connector's card is an id it never saw.
    foreignThread: async () => `foreign-${Math.random().toString(36).slice(2, 10)}`,
    foreignState: async () => undefined,
  };
});
