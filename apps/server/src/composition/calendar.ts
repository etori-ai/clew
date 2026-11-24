import type { AuthenticatedContext } from '@clew/contracts';
import { bindCalendar } from '@clew/calendar/accounts';
import { postgresProposalStore } from '../modules/calendar/adapters/postgres';
import { calendarBinder } from '../modules/calendar/adapters/binder';
import { durableObligations } from '../dbos/obligations';
import type { Notifier, People, RoundReader, Team } from '../modules/calendar/model';
import { teamFromStaff } from '../modules/calendar/domain';
import { ForbiddenError } from '../context';
import { staff, userReads } from './people';
import { systemContext } from '../system-context';
import { calendarUsecases } from '../modules/calendar/usecases/samtal';
import { eventUsecases } from '../modules/calendar/usecases/events';
import type { CalendarBinder } from '../modules/calendar/model';
import { clock, ids } from './ambient';
import {
  calendarDecisions,
  calendarExecutionSource,
  type CalendarDecisionDeps,
} from '../modules/calendar/usecases/decisions';
import { bookedElsewhere } from '../modules/calendar/usecases/booked';
import { followupUsecases } from '../modules/calendar/usecases/followups';
import { invitationUsecases } from '../modules/calendar/usecases/invitations';
import { postgresFollowupStore } from './followup-store';
import { ledger } from './durable';
import { cancelDurable } from '../dbos/start';
import { talkInvitationsOn } from './talk-invitations';

/**
 * The calendar's live wiring (D25). It is its own file because the registry registers the calendar connector over
 * these use cases, and `composition/index.ts` builds the stream over the registry: this file must not import either.
 */
/**
 * The person's calendar as Clew's directory holds them (DE-M8): their address is read on every call, and provider
 * discovery is kept only while that address and the person's access scope are unchanged (`calendarBinder`).
 */
const bind: CalendarBinder = calendarBinder({ email: id => userReads.email(id), bindCalendar });
/**
 * The people a manager plans for and may invite (D96 item 3): everyone provisioned on the units they manage, read
 * through Personal's overview (D94) on every call, so a person who joins or leaves a unit counts at once. Not cached by
 * authorization version as the binding is: a colleague joining the unit does not change the manager's version. A person
 * who manages no unit has no team.
 */
const team: Team = async persona => {
  try {
    return teamFromStaff(await staff.overview(persona), persona.id);
  } catch (error) {
    if (error instanceof ForbiddenError) return [];
    throw error;
  }
};
/**
 * The open round, a slot like `notifier`: `index.ts` sets `planningRound.read` to read `clew.talks` through the registry
 * (D96 items 1-3), and a read that fails rejects. Until it does, there is no round, and the planner plans nothing.
 */
export const planningRound: { read: RoundReader } = { read: async () => null };
const round: RoundReader = persona => planningRound.read(persona);
/** The follow-up card goes into an invitee's stream through the threads module, which is built after this file: `index.ts` fills the slot. */
export const notifier: { push: Notifier } = { push: async () => undefined };
/** An invitation's fate reaches the talk whose booking it carries in the proposal store's own transaction (D132 item 3). */
const store = postgresProposalStore(ledger, { invitations: talkInvitationsOn });
/** Who owns a thread, or booked a person, as a system identity with the grant they have now. */
const people: People = { personaFor: id => systemContext(id, 'system:obligation') };
export const calendarApproval: Pick<CalendarDecisionDeps, 'approve' | 'previous'> = {
  approve: async () => {
    throw new Error('Calendar execution boundary not initialized');
  },
  previous: async () => undefined,
};
const decisions = calendarDecisions({
  store,
  bind,
  team,
  round,
  people,
  clock,
  ids,
  approve: (p, input) => calendarApproval.approve(p, input),
  previous: (p, id) => calendarApproval.previous(p, id),
});
/**
 * An approved invitation is checked once more just before it is sent (M1, Q12): a person another of their current
 * managers booked after the confirmation was checked, in the round the confirmation was approved in, gets no second
 * talk.
 */
export const calendarSource = calendarExecutionSource(bind, team, bookedElsewhere({ store, team, people }));
const core = calendarUsecases({
  store,
  bind,
  team,
  round,
  clock,
  ids,
  people,
  notify: (personId, draft) => notifier.push(personId, draft),
  obligations: durableObligations(),
});
/**
 * A sent invitation is followed by its event's id (D133): the scan reads it back and tells the talks module what the
 * calendar holds, and the manager's decision on a difference is carried out here.
 */
export const invitations = invitationUsecases({ store, bind, team, clock });
export const calendarAuthority: { current: (id: string) => Promise<AuthenticatedContext | undefined> } = {
  current: async () => undefined,
};
export const followups = followupUsecases({
  store: postgresFollowupStore({ durable: ledger, cancel: cancelDurable }),
  team,
  clock,
  current: id => calendarAuthority.current(id),
  readReplies: core.readReplies,
});
export const calendar = {
  ...core,
  confirm: decisions.confirm,
  undo: decisions.undo,
  remindInvitees: async (id: string, actor: AuthenticatedContext | 'assistant:obligation', _only?: string[]) => {
    if (actor === 'assistant:obligation') return; // Existing histories retire; modern delivery owns the policy and ordinal.
    return followups.remindNow(actor, id);
  },
  obligationCheck: async (
    _id: string,
  ): Promise<{
    action: 'return' | 'wait' | 'remind';
    why: 'answered' | 'deadline' | 'waiting' | 'overdue';
    next: string;
    due: string[];
  }> => ({ action: 'return', why: 'answered', next: clock().toISOString(), due: [] }),
  returnObligation: async (_id: string, _why: 'answered' | 'deadline') => {},
};
/** A person's own bookings and proposal moves (D28), over the same store and bindings. */
export const events = {
  ...eventUsecases({ store, bind, team, clock, ids }),
  createEvent: decisions.createEvent,
  rescheduleEvent: decisions.rescheduleEvent,
  cancelEvent: decisions.cancelEvent,
};
