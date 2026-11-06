import { memoryProposalStore } from '../../apps/server/src/modules/calendar/adapters/memory';
import { proposalStoreContract } from '../proposal-store-contract';

proposalStoreContract('memory', async () => {
  const store = memoryProposalStore();
  return {
    store,
    people: ['hillevi', 'hassan'],
    auditFor: async subject => store.audit.filter(e => e.subject === subject),
    hasJob: async id => store.jobs.some(j => j.id === id),
  };
});
