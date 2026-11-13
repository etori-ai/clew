import { actorOf } from '@clew/connectors';
import { registry } from '../connectors/registry';
import { logPort } from '../logging';
import { entityUsecases } from '../modules/entities/usecases';
import { entityActionUsecases } from '../modules/entities/actions';
import { threads } from './index';
import { staff, withFollowedUnits } from './people';
import { subjectCards } from '../threads/usecases/subjects';
import { subjectStore } from './subjects';
import { clock } from './ambient';

/**
 * The entities module's live wiring (D97, D25). The directory is the people module's: where the reader stands and a
 * colleague by user name, read on every call. The sources are the registry's reads and actions that declare `about`,
 * listed after the governance is refreshed, so an administrator's lens or column shows from the next read on. A source
 * is read through the registry's own call path as the person (scope, input and output checked, the session's delegated
 * token carried), with the module's signal. The cards about an entity are the reader's own cards whose rows name it,
 * found through the thread store's index from entity to cards, under the stream's own rules of what is theirs to see.
 */
const cardsAbout = subjectCards({ store: subjectStore, registry, clock });
export const entities = entityUsecases({
  directory: staff,
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
  // As the person with the units they follow up (D117), so a source can answer for a unit below them and refuse the rest.
  read: async (persona, capability, input, signal) =>
    registry
      .clewFor(actorOf(await withFollowedUnits(persona)), {
        signal,
        ...(persona.delegate ? { delegate: persona.delegate } : {}),
      })
      .call(capability, input),
  // The reader's cards about an entity (D97 items 5 and 6): the thread store's index from entity to cards.
  cards: async (persona, subject) =>
    (await cardsAbout.cardsNaming(persona, [subject])).map(({ subjects: _, ...card }) => card),
  cardsNaming: (persona, subjects) => cardsAbout.cardsNaming(persona, subjects),
  log: logPort('entities', 'warn'),
});
/**
 * An action from an entity's menu (D97, D8): the opened entity says whether the reader may start it on that key, and the
 * stream's started card is what it becomes, a propose's draft or an execute behind its human decision. What it would
 * write (D112) is the stream's effect read, before any card exists.
 */
export const entityActions = entityActionUsecases({
  open: (persona, kind, key) => entities.detail(persona, kind, key),
  start: (persona, capability, input, context) => threads.startCard(persona, capability, input, context),
  effect: (persona, capability, input, connector) => threads.effectFor(persona, capability, input, connector),
  clock,
});
