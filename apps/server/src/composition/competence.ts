import { withThreadTx, type ThreadStoreOptions } from '../threads/adapters/postgres';
import { competenceTx } from '../modules/competence/adapters/postgres';
import { competenceUsecases } from '../modules/competence/usecases';
import { reportsByUnit } from '../modules/entities/domain';
import type { Above, CompetenceStore, HoldingsPort, Staff } from '../modules/competence/model';
import { createHash } from 'node:crypto';
import { cancelWhereRunning } from '../dbos/start';
import { systemContext } from '../system-context';
import { logPort, logger } from '../logging';
import { competenceWorkItems } from './competence-work-items';
import { staff as staffUsecases } from './people';
import { clock, ids } from './ambient';
import { ledger } from './durable';

/**
 * The competence module's live wiring (D108, D25). Its own file because the registry registers the built-in competence
 * connector over what is built here, and `composition/index.ts` builds the stream over the registry: this file imports
 * neither. The store starts the copy's workflow inside its own transaction (D86).
 */
/**
 * One competence transaction is one thread-store transaction (D108 item 7): the competence tables and the approvals'
 * cards (`competenceWorkItems`) share the physical database transaction, so a person's own registration, its cards in
 * the managers' streams, their audit rows and anything enqueued commit or roll back as one, as talks' action points do.
 * `options` names the durable engine's queue: the server's ledger here, a test's own in `tests/db`. A wait the
 * competence transaction ends (an erasure intent cancelled or re-timed, D108 item 14) is cancelled after the commit
 * with `options.cancel`, best effort, as the thread store cancels its timers: the generation fence covers one that
 * fails or never arrives, so a failure is logged and never raised.
 */
export function competenceStoreWithCards(options: ThreadStoreOptions, deps: { clock: () => Date }): CompetenceStore {
  return {
    async transaction(fn) {
      const ended: string[] = [];
      const result = await withThreadTx(options, (tx, thread) =>
        fn(competenceTx(tx, options.durable, competenceWorkItems(tx, thread, { clock: deps.clock }), ended)),
      );
      for (const id of ended)
        await options
          .cancel?.(id)
          .catch(error => logger.error({ scope: 'competence', workflow: id, error }, 'durable cancel failed'));
      return result;
    },
  };
}
/**
 * The server's competence store. A wait ended by a script's transaction (a period changed with
 * `scripts/competence-retention.ts`, an erasure by hand) is not cancelled from the script, which runs no engine: the
 * generation fence refuses it when it wakes.
 */
export const competenceStore = competenceStoreWithCards({ durable: ledger, cancel: cancelWhereRunning }, { clock });
/**
 * The reader's reports (D99 item 4) as the module's `Staff` port has them: the units they manage, each with exactly the
 * people the `managed` relation names (D117, `reportsByUnit`), read from the people module's directory on every call.
 * Personal's list is wider: it holds a co-manager of the unit and the reader's own manager when they are placed on it,
 * and neither is anyone whose competence the reader may read or write. Someone who manages no unit has no units.
 */
const staff: Staff = async persona => ({ units: reportsByUnit(await staffUsecases.reach(persona)) });
/**
 * Whom the reader reports to (D99 item 4, D117's line), as the people module's reach answers it: whoever leads the
 * nearest unit above the reader that somebody leads, active, read on every call. A person's own registration goes to
 * them (D108 item 7).
 */
const above: Above = async persona => (await staffUsecases.reach(persona)).above.filter(id => id !== persona.id);
/**
 * A person as the use cases take one, from their current grant (D108 item 7): to count a manager's reports as the
 * manager does, and to tell whether a person who registered is active. Undefined for someone deactivated or without access.
 */
const personaOf = (personId: string) => systemContext(personId, 'system:competence');
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
  above,
  personaOf,
  digest: text => createHash('sha256').update(text).digest('hex'),
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
