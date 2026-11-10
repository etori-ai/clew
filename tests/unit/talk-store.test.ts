import { randomUUID } from 'node:crypto';
import { memoryTalkStore } from '../../apps/server/src/modules/talks/adapters/memory';
import { talkStoreContract } from '../talk-store-contract';

/** The talk store contract on the memory adapter (D96, D25); `tests/db/postgres-talk-store.test.ts` runs it on Postgres. */
talkStoreContract('memory', async () => {
  const store = memoryTalkStore();
  return {
    store,
    prefix: 'm-' + randomUUID().slice(0, 8),
    async seedPerson(person) {
      store.addPerson(person);
    },
    async auditFor(subject) {
      return store
        .audit()
        .filter(a => a.subject === subject)
        .map(a => ({ actor: a.actor, action: a.action }));
    },
  };
});
