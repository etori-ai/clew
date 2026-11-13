import { randomUUID } from 'node:crypto';
import { memoryBoardingStore } from '../../apps/server/src/modules/boarding/adapters/memory';
import { boardingStoreContract } from '../boarding-store-contract';

/** The boarding store contract on the memory adapter (D124, D25); `tests/db/postgres-boarding-store.test.ts` runs it on Postgres. */
boardingStoreContract('memory', async () => {
  const store = memoryBoardingStore();
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
