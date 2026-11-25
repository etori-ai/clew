import { memoryProposalStore } from '../../apps/server/src/modules/calendar/adapters/memory';
import { proposalStoreContract } from '../proposal-store-contract';

proposalStoreContract('memory', async () => {
  const store = memoryProposalStore();
  return {
    store,
    people: ['hillevi', 'hassan'],
    auditFor: async subject => store.audit.filter(e => e.subject === subject),
    hasJob: async id => store.jobs.some(j => j.id === id),
    told: async id => store.invitations.filter(i => i.invitationId === id).map(i => i.op),
    // The memory store holds only the threads it made: another connector's card is an id it never saw.
    foreignThread: async () => `foreign-${Math.random().toString(36).slice(2, 10)}`,
    foreignState: async () => undefined,
  };
});
