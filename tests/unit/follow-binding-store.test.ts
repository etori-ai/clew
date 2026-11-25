import { randomUUID } from 'node:crypto';
import { memoryFollowBindingStore } from '../../apps/server/src/modules/jobs/adapters/memory';
import { followBindingStoreContract } from '../follow-binding-store-contract';

/** The follow binding store contract on the memory adapter (D55, D25); `tests/db` runs it on Postgres. */
followBindingStoreContract('memory', async () => {
  const store = memoryFollowBindingStore();
  return {
    store,
    prefix: 'm-' + randomUUID().slice(0, 8),
    async auditFor(subject) {
      return store
        .audit()
        .filter(a => a.subject === subject)
        .map(a => ({ actor: a.actor, action: a.action, details: a.details ?? {} }));
    },
  };
});
