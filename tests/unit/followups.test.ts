import { memoryFollowupStore } from '../../apps/server/src/modules/calendar/adapters/followup-memory';
import { followupContract, followupFixture } from '../followup-contract';
followupContract('memory follow-up', async ({ answered = false } = {}) => {
  const id = crypto.randomUUID(),
    fixture = followupFixture(id);
  if (answered) fixture.proposals = fixture.proposals.map(p => ({ ...p, status: 'accepted' }));
  const store = memoryFollowupStore(fixture),
    about = (subject: string) => store.audits().filter(a => a.subject === subject);
  return {
    id,
    store,
    deliveries: async () => store.deliveries().length,
    delivered: async () =>
      store
        .deliveries()
        .map(({ id, personId, title, summary, trigger }) => ({ id, personId, title, summary, trigger })),
    async card() {
      const { state, handledAt, waitingOn, summary, updatedAt } = (await store.read(id))!.thread;
      return { state, handledAt, waitingOn, summary, updatedAt };
    },
    audits: async () => about('thread:' + id).map(a => a.action),
    details: async (action, subject = 'thread:' + id) =>
      about(subject)
        .filter(a => a.action === action)
        .map(a => a.details),
  };
});
