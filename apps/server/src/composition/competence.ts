import { and, eq } from 'drizzle-orm';
import type { StaffOverview } from '@clew/contracts';
import { COMPETENCE_CONNECTOR } from '@clew/connectors';
import { schema, type Transaction } from '@clew/db';
import { competenceTx } from '../modules/competence/adapters/postgres';
import { competenceUsecases } from '../modules/competence/usecases';
import type { CompetenceCardsTx, CompetenceStore, Staff } from '../modules/competence/model';
import { withThreadTx, type ThreadStoreOptions } from '../threads/adapters/postgres';
import type { ThreadTx } from '../threads/model';
import { cancelDurable } from '../dbos/start';
import { ForbiddenError } from '../context';
import { staff as staffUsecases } from './people';
import { removeCards } from './card-removal';
import { clock, ids } from './ambient';
import { ledger } from './durable';

/**
 * The competence module's live wiring (D108, D25). Its own file because the registry registers the built-in competence
 * connector over what is built here, and `composition/index.ts` builds the stream over the registry: this file imports
 * neither.
 */
/** A person's own competence cards (D108 item 12), over the thread store's transaction that the competence one shares. */
export const competenceCards = (tx: Transaction, thread: ThreadTx): CompetenceCardsTx => ({
  async removeOwn(personId, actor, at) {
    const own = and(eq(schema.threads.personId, personId), eq(schema.threads.connector, COMPETENCE_CONNECTOR));
    return (await removeCards(tx, thread, own, actor, at)).length;
  },
});
/**
 * One competence transaction is one thread-store transaction: the holdings and the person's competence cards go
 * together in an erasure, or neither does (D86). `options` names the durable engine's queue: the server's ledger here,
 * a test's own in `tests/db`.
 */
export function competenceStoreWithCards(options: ThreadStoreOptions): CompetenceStore {
  return {
    transaction: fn => withThreadTx(options, (tx, thread) => fn(competenceTx(tx, competenceCards(tx, thread)))),
  };
}
export const competenceStore = competenceStoreWithCards({ durable: ledger, cancel: cancelDurable });
const NOBODY: StaffOverview = { units: [] };
/** Personal's overview (D94, D99): the people module's refusal of someone who manages no unit is "nobody" to this module. */
const staff: Staff = async persona => {
  try {
    return await staffUsecases.overview(persona);
  } catch (error) {
    if (error instanceof ForbiddenError) return NOBODY;
    throw error;
  }
};
export const competence = competenceUsecases({ store: competenceStore, staff, clock, ids });
/**
 * The competence module as the operator's erasure runs it (`scripts/competence-erase.ts`): the same use cases and tables
 * over a store that cancels no workflow. A script never launches the durable engine, so a cancel there could only fail
 * after the commit, and print an error before the script's own answer. The timers of the removed cards go with them,
 * and a workflow still waiting on one, a reminder or a snooze, wakes at its time, finds no timer and ends without a
 * write: the generation fence covers a cancel that never arrives (D86).
 */
export const competenceForScripts = competenceUsecases({
  store: competenceStoreWithCards({ durable: ledger }),
  staff,
  clock,
  ids,
});
