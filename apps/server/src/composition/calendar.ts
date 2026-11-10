import type { AuthenticatedContext } from '@clew/contracts';
import { bindCalendar, type CalendarBinding } from '@clew/calendar/accounts';
import { postgresProposalStore } from '../modules/calendar/adapters/postgres';
import { durableObligations } from '../dbos/obligations';
import type { Notifier, PlanningRound, RoundReader, Team } from '../modules/calendar/model';
import { teamFromStaff } from '../modules/calendar/domain';
import { ForbiddenError } from '../context';
import { staff } from './people';
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
import { followupUsecases } from '../modules/calendar/usecases/followups';
import { postgresFollowupStore } from './followup-store';
import { ledger } from './durable';
import { cancelDurable } from '../dbos/start';

/**
 * The calendar's live wiring (D25). It is its own file because the registry registers the calendar connector over
 * these use cases, and `composition/index.ts` builds the stream over the registry: this file must not import either.
 */
// Provider discovery is cached only while the person's access scope is unchanged.
const bindings = new Map<string, { version: string; binding: CalendarBinding }>();
const bind: CalendarBinder = (persona: AuthenticatedContext) => {
  let cached = bindings.get(persona.id);
  if (!cached || cached.version !== persona.authorizationVersion) {
    cached = { version: persona.authorizationVersion, binding: bindCalendar(persona) };
    bindings.set(persona.id, cached);
  }
  return cached.binding;
};
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
 * TEMPORARY: the round of talks the planner works towards until the talks module (D96) owns it. It reproduces the
 * planner's earlier fixed deadline, so with it the product behaves as before. Remove once `index.ts` fills the slot.
 */
export const TEMPORARY_ROUND: PlanningRound = {
  label: 'Utvecklingssamtal 2026',
  opensOn: '2026-09-01',
  dueOn: '2026-11-28',
  held: [],
};
/** The open round, a slot like `notifier`: `index.ts` sets `planningRound.read` to the talks module's reader. */
export const planningRound: { read: RoundReader } = { read: async () => TEMPORARY_ROUND };
const round: RoundReader = persona => planningRound.read(persona);
/** The follow-up card goes into an invitee's stream through the threads module, which is built after this file: `index.ts` fills the slot. */
export const notifier: { push: Notifier } = { push: async () => undefined };
const store = postgresProposalStore(ledger);
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
  clock,
  ids,
  approve: (p, input) => calendarApproval.approve(p, input),
  previous: (p, id) => calendarApproval.previous(p, id),
});
export const calendarSource = calendarExecutionSource(bind, team);
const core = calendarUsecases({
  store,
  bind,
  team,
  round,
  clock,
  ids,
  people: { personaFor: id => systemContext(id, 'system:obligation') },
  notify: (personId, draft) => notifier.push(personId, draft),
  obligations: durableObligations(),
});
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
