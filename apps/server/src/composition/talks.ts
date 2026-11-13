import type { StaffOverview } from '@clew/contracts';
import { withThreadTx, type ThreadStoreOptions } from '../threads/adapters/postgres';
import { talkTx } from '../modules/talks/adapters/postgres';
import { talkUsecases } from '../modules/talks/usecases';
import type { Manages, Sealer, Staff, TalkDeps, TalkStore } from '../modules/talks/model';
import type { Directory, DirectoryPerson, Holders, Takeovers } from '../modules/talk-seam/model';
import { openSecret, sealSecret } from '../auth-crypto';
import { ForbiddenError } from '../context';
import { cancelDurable } from '../dbos/start';
import { systemContext } from '../system-context';
import { talkWorkItems } from './talk-work-items';
import { staff as staffUsecases, userReads } from './people';
import { calendar } from './calendar';
import { clock, ids } from './ambient';
import { ledger } from './durable';

/**
 * The talks module's live wiring (D96, D25). Its own file because the registry registers the built-in talks connector
 * and the talks seam over what is built here, and `composition/index.ts` builds the stream over the registry: this file
 * imports neither. The calendar comes first (`calendar.ts`), since the round asks it who is booked; the calendar never
 * reads the round back through here (its `samtalBookings` takes the period as input), so there is no loop.
 */
/** An action point's text is sealed at rest under the master key, as approved execution input is (D96 item 6). */
const sealer: Sealer = { seal: sealSecret, open: openSecret };
/**
 * One talks transaction is one thread-store transaction: the talks tables and the owner's card (`talkWorkItems`) share
 * the physical database transaction, so an action point and its card, timer and workflow start commit or roll back as
 * one (D86). `options` names the durable engine's queue: the server's ledger here, a test's own in `tests/db`.
 */
export function talkStoreWithCards(options: ThreadStoreOptions, deps: { clock: () => Date }): TalkStore {
  return {
    transaction: fn =>
      withThreadTx(options, (tx, thread) =>
        fn(talkTx(tx, { sealer, workItems: talkWorkItems(tx, thread, { clock: deps.clock }) })),
      ),
  };
}
export const talkStore = talkStoreWithCards({ durable: ledger, cancel: cancelDurable }, { clock });
const NOBODY: StaffOverview = { units: [] };
/** Personal's overview (D94); the people module's refusal of someone who manages no unit is "nobody" to the talks module. */
const staff: Staff = async persona => {
  try {
    return await staffUsecases.overview(persona);
  } catch (error) {
    if (error instanceof ForbiddenError) return NOBODY;
    throw error;
  }
};
/**
 * Whether the owner of a manager's action point still manages the employee (Q12), as the talks module counts the people
 * a manager has: from the owner's own assignments now, read through a context built from their current grant. Someone
 * without an active grant, deactivated or erased, manages nobody, and nobody manages themselves or a deactivated
 * person. Exported for the Postgres test that runs it over real assignments and grants.
 */
export const talkManages: Manages = async (managerId, employeeId) => {
  if (managerId === employeeId) return false;
  const persona = await systemContext(managerId, 'system:talks');
  if (!persona) return false;
  const overview = await staff(persona);
  return overview.units.some(unit => unit.people.some(p => p.id === employeeId && p.enabled !== false));
};
const talkDeps: Omit<TalkDeps, 'store'> = {
  staff,
  manages: talkManages,
  bookings: (persona, round) => calendar.samtalBookings(persona, round),
  clock,
  ids,
};
export const talks = talkUsecases({ store: talkStore, ...talkDeps });
/**
 * The talks module as the operator's erasure runs it (`scripts/talks-erase.ts`): the same use cases and tables over a
 * store that cancels no workflow. A script never launches the durable engine, so a cancel there could only fail after
 * the commit, and print an error before the script's own answer. The `due` timers of the removed cards go with them,
 * and a workflow still waiting on one wakes at its time, finds no timer and ends without a write: the generation fence
 * covers a cancel that never arrives (D86).
 */
export const talksForScripts = talkUsecases({ store: talkStoreWithCards({ durable: ledger }, { clock }), ...talkDeps });
/**
 * The talks seam's directory (D96 item 8): the reader with their user name, and the people on the units they manage
 * now, read fresh on every call. As the talks module counts them: the reader left out, each person once, a deactivated
 * person left out. Someone without a grant, or who manages nobody, has no staff.
 */
export const talkDirectory: Directory = async actor => {
  const persona = await systemContext(actor.id, 'connector:clew');
  const [userName, overview] = await Promise.all([
    userReads.userName(actor.id),
    persona ? staff(persona) : Promise.resolve(NOBODY),
  ]);
  const people = new Map<string, DirectoryPerson>();
  for (const unit of overview.units)
    for (const p of unit.people)
      if (p.id !== actor.id && p.enabled !== false && !people.has(p.id))
        people.set(p.id, { id: p.id, userName: p.userName });
  return { self: { id: actor.id, userName }, staff: [...people.values()] };
};
/**
 * Who a talks row's key names in the reader's organisation now, asked by the seam for the action points a former manager
 * still owns (M2): the holder of a user name, as the people module compares one (D119), else the person provisioned
 * without one whose id the key is (D96 item 8), read from the people table the talks store reads.
 */
export const talkHolders: Holders = async (actor, keys) => {
  const found = await userReads.holders(actor.id, keys);
  const rest = keys.filter(key => !found.has(key));
  if (!rest.length) return found;
  const persons = await talkStore.transaction(tx => tx.persons([actor.id, ...rest]));
  const organisation = persons.find(p => p.id === actor.id)?.organisationId;
  for (const p of persons)
    if (p.id !== actor.id && p.userName === null && organisation !== undefined && p.organisationId === organisation)
      found.set(p.id, p.id);
  return found;
};
/**
 * Which of a person's action points the reader may take over (Q12), asked by the seam when a manager reads that
 * person's points: the talks module answers with the rule its write enforces, for the reader as their grant is now.
 */
export const talkTakeovers: Takeovers = async (actor, ids) => {
  const persona = await systemContext(actor.id, 'connector:clew');
  return persona ? talks.takeovers(persona, ids) : new Set();
};
