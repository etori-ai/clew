/**
 * A second instance for the erasure's runtime test (D108 item 14): it asks for one person's erasure, as the sweep
 * would, through a store whose transaction holds still once the erasure's work is done and before it commits, says so,
 * and waits to be killed. Its transaction dies with it, so the parent finds the person as they were.
 */
import type { CompetenceStore } from '../../src/modules/competence/model';
import { competenceStoreWithCards } from '../../src/composition/competence';
import { competenceUsecases } from '../../src/modules/competence/usecases';

const store = competenceStoreWithCards({ durable: { application: 'clew-test-erasure-child', queue: 'unused' } });
const hanging: CompetenceStore = {
  transaction: fn =>
    store.transaction(async tx => {
      const result = await fn(tx);
      console.log('erasing');
      await new Promise(() => {});
      return result;
    }),
};
const competence = competenceUsecases({
  store: hanging,
  staff: async () => ({ units: [] }),
  clock: () => new Date(),
  ids: () => crypto.randomUUID(),
});
await competence.eraseDue(process.env.ERASE_PERSON!, 1);
