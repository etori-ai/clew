import { postgresCompetenceStore } from '../modules/competence/adapters/postgres';
import { competenceUsecases } from '../modules/competence/usecases';
import { reportsByUnit } from '../modules/entities/domain';
import type { HoldingsPort, Staff } from '../modules/competence/model';
import { logPort, logger } from '../logging';
import { staff as staffUsecases } from './people';
import { clock, ids } from './ambient';
import { ledger } from './durable';

/**
 * The competence module's live wiring (D108, D25). Its own file because the registry registers the built-in competence
 * connector over what is built here, and `composition/index.ts` builds the stream over the registry: this file imports
 * neither. The store starts the copy's workflow inside its own transaction (D86).
 */
export const competenceStore = postgresCompetenceStore(ledger);
/**
 * The reader's reports (D99 item 4) as the module's `Staff` port has them: the units they manage, each with exactly the
 * people the `managed` relation names (D117, `reportsByUnit`), read from the people module's directory on every call.
 * Personal's list is wider: it holds a co-manager of the unit and the reader's own manager when they are placed on it,
 * and neither is anyone whose competence the reader may read or write. Someone who manages no unit has no units.
 */
const staff: Staff = async persona => ({ units: reportsByUnit(await staffUsecases.reach(persona)) });
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
export const competence = competenceUsecases({
  store: competenceStore,
  staff,
  clock,
  ids,
  holdings: {
    switchedOn: () => holdingsPort.switchedOn(),
    holdingsSources: () => holdingsPort.holdingsSources(),
    readHoldings: (connectorId, cursor, options) => holdingsPort.readHoldings(connectorId, cursor, options),
    admitted: (connectorId, personIds) => holdingsPort.admitted(connectorId, personIds),
    reaches: (connectorId, organisationId) => holdingsPort.reaches(connectorId, organisationId),
  },
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
