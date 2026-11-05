import { executionStoreContract } from '../execution-store-contract';
import { memoryExecutionStore } from '../../apps/server/src/modules/executions/adapters/memory';
let id = 0;
executionStoreContract('memory', async () => { const store = memoryExecutionStore(); return { store, personId: 'test-' + ++id, auditCount: async () => store.audit().length }; });
