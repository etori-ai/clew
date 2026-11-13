import type { AuthenticatedContext, ProposalStatus, Thread, ThreadAction, ThreadItem } from '@clew/contracts';
import type { CalendarBinding } from '@clew/calendar/accounts';

/**
 * The ports of the calendar module (D25). The provider port is `CalendarProvider` in `@clew/calendar/model` (D11);
 * this file adds what the use cases need from Clew's own records: the proposal thread, its proposals, the audit row
 * and the undo timer, inside one transaction. `adapters/postgres.ts` runs in the server, `adapters/memory.ts` in the
 * tests, both held to `tests/proposal-store-contract.ts`. Every instant is an ISO string the use case hands in.
 */
/**
 * Whom a proposal invites (N3): the person by Clew's key, their id, which finds them in the team, the round and the
 * reminders whatever their address is now; and the address and name the proposal was drawn with, which the invitation
 * goes to and the replies are matched on.
 */
export interface ProposalParticipant {
  personId: string;
  email: string;
  name: string;
}
export interface ProposalRecord {
  id: string;
  threadId: string;
  /** The manager who owns the thread and the proposal. */
  personId: string;
  status: ProposalStatus;
  participant: ProposalParticipant;
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
/** A thread's patch; `trigger` is counted again when drawn times leave an open card (M1). */
export type ProposalThreadPatch = Partial<
  Pick<
    Thread,
    'title' | 'week' | 'state' | 'handledAt' | 'updatedAt' | 'summary' | 'deadline' | 'waitingOn' | 'trigger'
  >
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
  /**
   * The proposals that book these people, whoever owns them (M1): confirmed, final or accepted, across threads, by the
   * participant's person id. A manager learns from them that a co-manager booked the person, never when.
   */
  bookedProposals(participantIds: readonly string[]): Promise<ProposalRecord[]>;
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
/**
 * The open round for this person's organisation, or null when none is open or no system answers for them: then nothing
 * is planned. Rejects when the round cannot be read now; the planner takes that as no round, while a confirmation,
 * which must tell whether the person already has a talk in it (M1), approves nothing.
 */
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
/**
 * Who a thread belongs to, as a system identity, for the timers that know only the thread; and whether another manager
 * who booked a person still manages them (M1), through the team that identity has now.
 */
export interface People {
  personaFor(id: string): Promise<AuthenticatedContext | undefined>;
}
/** The follow-up workflow per obligation (D30): started at confirm, cancelled by undo. The durable engine runs it (D85); the memory adapter records it. */
export interface ObligationTimers {
  start(input: { threadId: string; personId: string }): Promise<void>;
  cancel(threadId: string): Promise<void>;
}
