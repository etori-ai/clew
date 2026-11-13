import { randomUUID } from 'node:crypto';
import { memoryDialogueStore } from '../../apps/server/src/modules/dialogue/adapters/memory';
import { dialogueStoreContract } from '../dialogue-store-contract';

/** The dialogue store contract on the memory adapter (D118, D25); `tests/db/postgres-dialogue-store.test.ts` runs it on Postgres. */
dialogueStoreContract('memory', async () => {
  const store = memoryDialogueStore();
  return {
    store,
    prefix: 'm-' + randomUUID().slice(0, 8),
    async seedPerson(id, _organisationId, name) {
      store.addPerson(id, name);
    },
    async seedUnit(id, _organisationId, label) {
      store.addUnit(id, label);
    },
    async auditFor(subject) {
      return store
        .audit()
        .filter(a => a.subject === subject)
        .map(a => ({ actor: a.actor, action: a.action }));
    },
  };
});
