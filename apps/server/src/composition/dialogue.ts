import { withThreadTx, type ThreadStoreOptions } from '../threads/adapters/postgres';
import { dialogueTx } from '../modules/dialogue/adapters/postgres';
import { dialogueUsecases } from '../modules/dialogue/usecases';
import type { DialogueStore, Followed, Sealer } from '../modules/dialogue/model';
import { followedFrom } from '../modules/dialogue/domain';
import { openSecret, sealSecret } from '../auth-crypto';
import { cancelDurable } from '../dbos/start';
import { dialogueWorkItems } from './dialogue-work-items';
import { staff } from './people';
import { clock, ids } from './ambient';
import { ledger } from './durable';

/**
 * The follow-up dialogue's live wiring (D118, D25). Its own file because the registry registers the built-in dialogue
 * connector over what is built here, and `composition/index.ts` builds the stream over the registry: this file imports
 * neither.
 */
/** Free text is sealed at rest under the master key, as an action point's is (D96 item 6). */
const sealer: Sealer = { seal: sealSecret, open: openSecret };
/**
 * One dialogue transaction is one thread-store transaction: the dialogue tables and the owner's card share the physical
 * database transaction, so an activity and its card, timer and workflow start commit or roll back as one (D86).
 */
export function dialogueStoreWithCards(options: ThreadStoreOptions, deps: { clock: () => Date }): DialogueStore {
  return {
    transaction: fn =>
      withThreadTx(options, (tx, thread) =>
        fn(dialogueTx(tx, { sealer, workItems: dialogueWorkItems(tx, thread, { clock: deps.clock }) })),
      ),
  };
}
const dialogueStore = dialogueStoreWithCards({ durable: ledger, cancel: cancelDurable }, { clock });
const followed: Followed = async persona => {
  if (persona.role !== 'manager') return [];
  const reach = await staff.reach(persona);
  // D147: the reader's list also holds units they do not lead, where somebody employed reports to them.
  const led = new Set(reach.units.filter(u => u.role === 'manager').map(u => u.unitId));
  // Someone who also manages the reader is not their report, so what they lead is not followed up through them.
  const reports = reach.managed.map(u => ({ ...u, people: u.people.filter(p => !reach.above.includes(p.id)) }));
  return followedFrom(persona.id, reports, led);
};
export const dialogue = dialogueUsecases({ store: dialogueStore, followed, clock, ids });
/** Erasing cards from the operator CLI leaves their sleeping workflows to observe the missing timers (D86). */
export const dialogueForScripts = dialogueUsecases({
  store: dialogueStoreWithCards({ durable: ledger }, { clock }),
  followed,
  clock,
  ids,
});
