import { memoryLinkStore } from '../../apps/server/src/modules/linked-accounts/adapters/memory';
import { linkStoreContract } from '../linked-account-store-contract';

linkStoreContract('memory', async () => {
  const store = memoryLinkStore();
  return { store, audit: async () => store.audit, prefix: '' };
});
