import { memoryThreadStore } from '../../apps/server/src/threads/adapters/memory';
import { storeContract } from '../store-contract';

storeContract('memory', async () => {
  const store = memoryThreadStore();
  return {
    store,
    people: ['hillevi', 'hassan'],
    auditFor: async subject => store.audit.filter(e => e.subject === subject),
    hasJob: async id => store.jobs.some(j => j.id === id),
    enqueued: async prefix => store.enqueued.filter(s => s.id.startsWith(prefix)),
    cancelled: async () => [...store.cancelled],
  };
});
