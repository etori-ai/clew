import { memoryConnectorStore } from '../../apps/server/src/connectors/adapters/memory';
import { connectorStoreContract } from '../connector-store-contract';

let n = 0;
connectorStoreContract('memory', async () => {
  const store = memoryConnectorStore();
  return {
    store, fresh: () => `c${++n}`,
    async openCardFrom(connector) { const id = `card-${connector}`; store.threads.push({ id, connector, state: 'open', handledAt: null }); return id; },
    async cardState(threadId) { return store.threads.find(t => t.id === threadId)?.state; },
  };
});
