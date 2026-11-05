import { memoryModelStore } from '../../apps/server/src/assistant/adapters/memory';
import { modelStoreContract } from '../model-store-contract';

let n = 0;
modelStoreContract('memory', async () => ({ store: memoryModelStore(), fresh: () => `m${++n}`, person: async () => `person-${++n}` }));
