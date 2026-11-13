import { and, eq } from 'drizzle-orm';
import type { StaffOverview } from '@clew/contracts';
import { COMPETENCE_CONNECTOR } from '@clew/connectors';
import { schema, type Transaction } from '@clew/db';
import { competenceTx } from '../modules/competence/adapters/postgres';
import { competenceUsecases } from '../modules/competence/usecases';
import type { CompetenceCardsTx, CompetenceStore, HoldingsPort, Staff } from '../modules/competence/model';
import { withThreadTx, type ThreadStoreOptions } from '../threads/adapters/postgres';
import type { ThreadTx } from '../threads/model';
import { cancelDurable } from '../dbos/start';
import { ForbiddenError } from '../context';
import { logPort, logger } from '../logging';
import { staff as staffUsecases } from './people';
import { removeCards } from './card-removal';
import { clock, ids } from './ambient';
import { ledger } from './durable';

/**
 * The competence module's live wiring (D108, D25). Its own file because the registry registers the built-in competence
 * connector over what is built here, and `composition/index.ts` builds the stream over the registry: this file imports
 * neither. The store starts the copy's workflow inside its own transaction (D86).
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
 * together in an erasure, or neither does, and the copy's workflow starts with the transaction that decides it (D86).
 * `options` names the durable engine's queue: the server's ledger here, a test's own in `tests/db`.
 */
export function competenceStoreWithCards(options: ThreadStoreOptions): CompetenceStore {
  return {
    transaction: fn =>
      withThreadTx(options, (tx, thread) => fn(competenceTx(tx, options.durable, competenceCards(tx, thread)))),
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
/**
 * What the copy of D108 item 9 reads: the module's switch and the installation's read of the holdings profile (D119,
 * `holdingsReader`). The registry is built over the module this file builds, so the slot is filled in
 * `composition/index.ts` once the registry exists, as `answerCards` and `planningRound` are; until then the module is
 * off and no source answers, so nothing is read.
 */
export const holdingsPort: HoldingsPort = {
  switchedOn: async () => false,
  holdingsSources: async () => [],
  readHoldings: async () => ({ rows: [], withdrawalsReported: false }),
  admitted: async () => new Set(),
  reaches: async () => false,
};
const holdings: HoldingsPort = {
  switchedOn: () => holdingsPort.switchedOn(),
  holdingsSources: () => holdingsPort.holdingsSources(),
  readHoldings: (connectorId, cursor, options) => holdingsPort.readHoldings(connectorId, cursor, options),
  admitted: (connectorId, personIds) => holdingsPort.admitted(connectorId, personIds),
  reaches: (connectorId, organisationId) => holdingsPort.reaches(connectorId, organisationId),
};
export const competence = competenceUsecases({
  store: competenceStore,
  staff,
  clock,
  ids,
  holdings,
  pause: ms => new Promise(resolve => setTimeout(resolve, ms)),
  log: logPort('competence', 'warn'),
});
const RETRY_MS = 5000;
const GUARD_MS = 60 * 60_000;
/**
 * The daily copy (D108 item 9) is asked for at boot and every hour after, idempotent by its day, and each daily run asks
 * for the next one before it reads. The retry is only for a database that is not reachable yet.
 */
export function startCompetenceCopy() {
  // One attempt at a time: the hourly guard does not start a second retry beside one still waiting.
  let retrying = false;
  const ask = async (retry = false) => {
    if (retrying && !retry) return;
    try {
      await competence.scheduleCopy();
      retrying = false;
    } catch (error) {
      retrying = true;
      logger.error({ scope: 'competence', error }, 'the daily copy could not be scheduled, retrying');
      setTimeout(() => void ask(true), RETRY_MS).unref();
    }
  };
  void ask();
  // The chain heals itself: a daily run that could not ask for the next one (its step failed after its retries), or a
  // day with no instance running at 04:00, is asked for again within the hour. Idempotent by the day's id.
  setInterval(() => void ask(), GUARD_MS).unref();
}
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
  holdings,
  log: logPort('competence', 'warn'),
});
