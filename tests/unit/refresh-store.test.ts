import { refreshStoreContract } from '../refresh-store-contract';
import { memoryRefreshStore } from '../../apps/server/src/threads/adapters/refresh-memory';

let id = 0;
refreshStoreContract('memory', async () => {
  const store = memoryRefreshStore();
  return {
    store,
    personId: 'refresh-store-' + ++id,
    requested: async request =>
      store.threads.audit
        .filter(a => a.action === 'refresh.requested' && a.subject === 'refresh:' + request)
        .map(a => a.details ?? {}),
  };
});
