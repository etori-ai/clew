import { memoryFollowupStore } from '../../apps/server/src/modules/calendar/adapters/followup-memory';
import { followupContract, followupFixture } from '../followup-contract';
followupContract('memory follow-up', async () => {
  const id = crypto.randomUUID(),
    store = memoryFollowupStore(followupFixture(id));
  return {
    id,
    store,
    deliveries: async () => store.deliveries().length,
    audits: async () => store.audits().map(a => a.action),
    details: async action =>
      store
        .audits()
        .filter(a => a.action === action)
        .map(a => a.details),
  };
});
