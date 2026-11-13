import { withThreadTx, type ThreadStoreOptions } from '../threads/adapters/postgres';
import { boardingTx, postgresBoardingDirectory } from '../modules/boarding/adapters/postgres';
import { boardingUsecases } from '../modules/boarding/usecases';
import type { BoardingStore, Report, Sealer, Staff } from '../modules/boarding/model';
import { reportsByUnit } from '../modules/entities/domain';
import { openSecret, sealSecret } from '../auth-crypto';
import { cancelDurable } from '../dbos/start';
import { logPort } from '../logging';
import { boardingWorkItems } from './boarding-work-items';
import { staff as staffUsecases } from './people';
import { clock, ids } from './ambient';
import { ledger } from './durable';

/**
 * The boarding module's live wiring (D124, D25). Its own file because the registry registers the built-in boarding
 * connector over what is built here, and `composition/index.ts` builds the stream over the registry: this file imports
 * neither.
 */
/** A title a manager typed for one plan is sealed at rest under the master key, as approved execution input is. */
const sealer: Sealer = { seal: sealSecret, open: openSecret };
/**
 * One boarding transaction is one thread-store transaction: the boarding tables and the owners' cards
 * (`boardingWorkItems`) share the physical database transaction, so a plan, its items and their cards, timers and
 * workflow starts commit or roll back as one (D86). `options` names the durable engine's queue: the server's ledger
 * here, a test's own in `tests/db`.
 */
export function boardingStoreWithCards(options: ThreadStoreOptions, deps: { clock: () => Date }): BoardingStore {
  return {
    transaction: fn =>
      withThreadTx(options, (tx, thread) =>
        fn(boardingTx(tx, { sealer, workItems: boardingWorkItems(tx, thread, { clock: deps.clock }) })),
      ),
  };
}
export const boardingStore = boardingStoreWithCards({ durable: ledger, cancel: cancelDurable }, { clock });
const directory = postgresBoardingDirectory();
/**
 * The reader's reports (D99 item 4) as the module's `Staff` port has them: exactly the people the `managed` relation
 * names (D117, `reportsByUnit`), never a co-manager whose line runs elsewhere nor the reader's own manager, though
 * Personal lists them; each with what the layers match on, read from the directory's tables on every call, and the
 * organisation's tree. Someone who manages no unit has no reports.
 */
const staff: Staff = async persona => {
  const reach = await staffUsecases.reach(persona);
  const units = reportsByUnit(reach);
  const people = new Map<string, Omit<Report, 'unitIds' | 'positionCodes' | 'employments'>>();
  for (const unit of units)
    for (const p of unit.people)
      if (!people.has(p.id)) people.set(p.id, { id: p.id, name: p.name, userName: p.userName, enabled: p.enabled });
  // Someone with no reports (most people, on every scan) needs neither read.
  const [facts, tree] = people.size
    ? await Promise.all([
        directory.facts(persona.organisationId, [...people.keys()]),
        directory.tree(persona.organisationId),
      ])
    : [new Map<string, Pick<Report, 'unitIds' | 'positionCodes' | 'employments'>>(), []];
  return {
    manages: units.length > 0,
    reports: [...people.values()].map(p => ({
      ...p,
      ...(facts.get(p.id) ?? { unitIds: [], positionCodes: [], employments: [] }),
    })),
    tree,
  };
};
export const boarding = boardingUsecases({
  store: boardingStore,
  staff,
  clock,
  ids,
  log: logPort('boarding', 'warn'),
});
