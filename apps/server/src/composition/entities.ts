import { actorOf } from '@clew/connectors';
import { registry } from '../connectors/registry';
import { logPort } from '../logging';
import { entityUsecases } from '../modules/entities/usecases';
import { staff } from './people';

/**
 * The entities module's live wiring (D97, D25). The directory is the people module's: where the reader stands and a
 * colleague by user name, read on every call. The sources are the registry's reads and actions that declare `about`,
 * listed after the governance is refreshed, so an administrator's lens or column shows from the next read on. A source
 * is read through the registry's own call path as the person (scope, input and output checked, the session's delegated
 * token carried), with the module's signal. The cards about an entity are a later slice's: none yet.
 */
export const entities = entityUsecases({
  directory: { reach: persona => staff.reach(persona), colleague: (persona, key) => staff.colleague(persona, key) },
  sources: {
    reads: async (actor, kind) => {
      await registry.refreshGovernance();
      return registry.aboutReads(actor, kind);
    },
    actions: async (actor, kind) => {
      await registry.refreshGovernance();
      return registry.aboutActions(actor, kind);
    },
  },
  read: (persona, capability, input, signal) =>
    registry
      .clewFor(actorOf(persona), { signal, ...(persona.delegate ? { delegate: persona.delegate } : {}) })
      .call(capability, input),
  cards: async () => [],
  log: logPort('entities', 'warn'),
});
