import { executionStoreContract } from '../execution-store-contract';
import { memoryExecutionStore } from '../../apps/server/src/modules/executions/adapters/memory';
let id = 0;
executionStoreContract('memory', async () => {
  const store = memoryExecutionStore();
  return {
    store,
    personId: 'test-' + ++id,
    auditCount: async (action = 'execution.approved') => store.audit().filter(e => e.action === action).length,
    enqueued: async prefix => store.enqueued().filter(s => s.id.startsWith(prefix)),
    watches: async jobId => store.watches().filter(w => w.jobId === jobId),
  };
});
