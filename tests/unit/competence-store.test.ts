import { randomUUID } from 'node:crypto';
import { memoryCompetenceStore } from '../../apps/server/src/modules/competence/adapters/memory';
import { competenceStoreContract } from '../competence-store-contract';

/** The competence store contract on the memory adapter (D108, D25); `tests/db/postgres-competence-store.test.ts` runs it on Postgres. */
competenceStoreContract('memory', async () => {
  const store = memoryCompetenceStore();
  return {
    store,
    prefix: 'm-' + randomUUID().slice(0, 8),
    async seedPerson(person) {
      store.addPerson(person);
    },
    async deactivate(personId) {
      store.deactivate(personId);
    },
    // The memory store keeps no connector rows: what refers to one is held to nothing here.
    async seedConnector() {},
    async seedCard(id, personId, connector) {
      store.addCard(id, { personId, connector });
    },
    async cardsOf(personId) {
      return [...store.state.cards]
        .filter(([, card]) => card.personId === personId)
        .map(([id]) => id)
        .sort();
    },
    async auditFor(subject) {
      return store
        .audit()
        .filter(a => a.subject === subject)
        .map(a => ({ actor: a.actor, action: a.action }));
    },
    async enqueued() {
      return store.state.enqueued.map(s => s.id);
    },
  };
});
