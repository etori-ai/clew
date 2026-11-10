import type { StaffOverview } from '@clew/contracts';
import { withThreadTx, type ThreadStoreOptions } from '../threads/adapters/postgres';
import { talkTx } from '../modules/talks/adapters/postgres';
import { talkUsecases } from '../modules/talks/usecases';
import type { Sealer, Staff, TalkStore } from '../modules/talks/model';
import type { Directory, DirectoryPerson } from '../modules/talk-seam/model';
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
export const talks = talkUsecases({
  store: talkStore,
  staff,
  bookings: (persona, round) => calendar.samtalBookings(persona, round),
  clock,
  ids,
});
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
