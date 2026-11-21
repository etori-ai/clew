import { audiencedActorOf } from '@clew/connectors';
import { registry } from '../connectors/registry';
import { recordActionUsecases } from '../modules/records/actions';
import { STARTED_ACTION } from '../threads/domain';
import { threads } from './index';
import { withFollowedUnits } from './people';
import { clock } from './ambient';

/**
 * Actions about a record (D137), wired: the registry's index from a read to the actions about its records, after the
 * governance is refreshed, so an administrator's switch shows from the next request on; the record's read made as the
 * person exactly as the record's page makes it (`GET /api/cap`: the units they follow up, their own session asking, the
 * session's delegated token, the person's live authority before and after); and the stream's started card, its human
 * decision into the ledger (D45) and its effect read, as an action about a person uses them (`composition/entities.ts`).
 */
export const recordActions = recordActionUsecases({
  records: async (actor, read) => {
    await registry.refreshGovernance();
    const found = registry.allowed(actor, read);
    if (!found || found.capability.kind !== 'read') return undefined;
    return {
      title: found.capability.title,
      ...(found.capability.view ? { view: found.capability.view } : {}),
      actions: registry.recordActions(actor, read),
    };
  },
  read: async (persona, read, input) => {
    const reader = await withFollowedUnits(persona);
    return registry.run(audiencedActorOf(reader), read, input, {
      authorize: () => reader.authorize(),
      ...(reader.delegate ? { delegate: reader.delegate } : {}),
      direct: true,
    });
  },
  start: (persona, capability, input, context) => threads.startCard(persona, capability, input, context),
  // An execute sent from its dialog is decided on its card's one button, the human decision into the ledger (D45).
  decide: (persona, threadId, answers) => threads.act(persona, threadId, STARTED_ACTION, undefined, undefined, answers),
  effect: (persona, capability, input, connector) => threads.effectFor(persona, capability, input, connector),
  clock,
});
