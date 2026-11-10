import { memoryAppearanceStore } from '../../apps/server/src/modules/appearance/adapters/memory';
import { appearanceStoreContract } from '../appearance-store-contract';

appearanceStoreContract('memory', async () => {
  const store = memoryAppearanceStore();
  return { store, audit: async () => store.audit, subject: 'installation:appearance' };
});
