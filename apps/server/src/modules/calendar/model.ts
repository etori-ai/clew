import type { AuthenticatedContext, ProposalStatus, Thread, ThreadAction, ThreadItem } from '@clew/contracts';
import type { CalendarBinding } from '@clew/calendar/accounts';

/**
 * The ports of the calendar module (D25). The provider port is `CalendarProvider` in `@clew/calendar/model` (D11);
 * this file adds what the use cases need from Clew's own records: the proposal thread, its proposals, the audit row
 * and the undo timer, inside one transaction. `adapters/postgres.ts` runs in the server, `adapters/memory.ts` in the
 * tests, both held to `tests/proposal-store-contract.ts`. Every instant is an ISO string the use case hands in.
 */
export interface ProposalRecord {
  id: string;
  threadId: string;
  personId: string;
  status: ProposalStatus;
  participant: { email: string; name: string };
  start: string;
  end: string;
  eventUid: string | null;
  eventRef: string | null;
  eventRevision: string | null;
  confirmedAt: string | null;
  undoUntil: string | null;
  /** Follow-ups to the invitee (D30). */
  reminders: number;
  remindedAt: string | null;
}
export type ProposalPatch = Partial<
  Pick<
    ProposalRecord,
    | 'status'
    | 'start'
    | 'end'
    | 'eventUid'
    | 'eventRef'
    | 'eventRevision'
    | 'confirmedAt'
    | 'undoUntil'
    | 'reminders'
    | 'remindedAt'
  >
>;
/** The thread as the contract shows it (superseded proposals left out) plus every proposal record the module holds. */
export interface ProposalThread {
  thread: Thread;
  proposals: ProposalRecord[];
}
export interface NewProposalThread {
  id: string;
  personId: string;
  topic: string;
  title: string;
  week: string;
  area: string;
  summary: string;
  trigger: Thread['trigger'];
  createdAt: string;
  updatedAt: string;
}
export type ProposalThreadPatch = Partial<
  Pick<Thread, 'title' | 'week' | 'state' | 'handledAt' | 'updatedAt' | 'summary' | 'deadline' | 'waitingOn'>
> & { items?: ThreadItem[] };
export interface AuditEntry {
  actor: string;
  action: string;
  subject: string;
  at: string;
  details?: Record<string, unknown>;
}
export interface JobInput {
  id: string;
  kind: string;
  runAt: string;
  payload?: Record<string, unknown>;
}

export interface ProposalTx {
  lockThread(personId: string, id: string): Promise<ProposalThread | undefined>;
  /** False when the person already has an open pushed thread on the topic. */
  insertThread(thread: NewProposalThread): Promise<boolean>;
  updateThread(id: string, patch: ProposalThreadPatch): Promise<void>;
  addMessage(threadId: string, message: { role: 'assistant' | 'user'; body: string; at: string }): Promise<void>;
  insertProposals(rows: ProposalRecord[]): Promise<void>;
  updateProposals(ids: string[], patch: ProposalPatch): Promise<void>;
  /** Every proposal of the thread in status `from` takes the patch; returns the ids it changed. */
  transition(threadId: string, from: ProposalStatus, patch: ProposalPatch): Promise<string[]>;
  writeAudit(entry: AuditEntry): Promise<void>;
  scheduleJob(job: JobInput): Promise<void>;
}
export interface ProposalStore {
  readThread(personId: string, id: string): Promise<ProposalThread | undefined>;
  /** For timers that know only the thread. */
  readThreadById(id: string): Promise<ProposalThread | undefined>;
  latestThread(personId: string, topic: string): Promise<ProposalThread | undefined>;
  openThread(personId: string, topic: string): Promise<ProposalThread | undefined>;
  /** Proposed, confirmed and final proposals of a person, across threads. */
  activeProposals(personId: string): Promise<ProposalRecord[]>;
  transaction<T>(fn: (tx: ProposalTx) => Promise<T>): Promise<T>;
}
/** A person's calendar: the provider (D11). The live one caches per authorization version. */
export type CalendarBinder = (persona: AuthenticatedContext) => CalendarBinding;
/**
 * A person the manager plans for and may invite (D96 item 3): who they are in Clew, the address their calendar answers
 * to, and the ref free-busy results are matched on.
 */
export interface UnitMember {
  personId: string;
  ref: string;
  email: string;
  name: string;
}
/**
 * The people a manager plans for, from the assignments (D68) on the units they manage, never the manager. Empty for a
 * person who manages no unit. Composition fills it from the people module; the calendar never imports that module.
 */
export type Team = (persona: AuthenticatedContext) => Promise<UnitMember[]>;
/**
 * The round of development talks the planner works towards (D96 items 1-3): dates are `YYYY-MM-DD`, `held` the person
 * ids whose talk is recorded as held. The calendar's own small shape; composition maps whatever owns the round to it.
 */
export interface PlanningRound {
  label: string;
  opensOn: string;
  dueOn: string;
  held: readonly string[];
}
/** The open round for this person's organisation, or null when none is open: then nothing is planned. */
export type RoundReader = (persona: AuthenticatedContext) => Promise<PlanningRound | null>;
/** A card for someone else's stream (D30): the follow-up an invitee gets. The threads module pushes it; the calendar never imports it. */
export interface NotifyDraft {
  topic: string;
  area: string;
  title: string;
  summary: string;
  reason: string;
  actions: ThreadAction[];
  deadline?: string | null;
}
export type Notifier = (personId: string, draft: NotifyDraft) => Promise<string | undefined>;
/** Who a thread belongs to, as a system identity, for the timers that know only the thread. */
export interface People {
  personaFor(id: string): Promise<AuthenticatedContext | undefined>;
}
/** The follow-up workflow per obligation (D30): started at confirm, cancelled by undo. Temporal runs it; the memory adapter records it. */
export interface ObligationTimers {
  start(input: { threadId: string; personId: string }): Promise<void>;
  cancel(threadId: string): Promise<void>;
}
