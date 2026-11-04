import type { AuthenticatedContext, ProposalStatus, Thread, ThreadItem } from '@clew/contracts';
import type { CalendarBinding } from '@clew/calendar/accounts';

/**
 * The ports of the calendar module (D25). The provider port is `CalendarProvider` in `@clew/calendar/model` (D11);
 * this file adds what the use cases need from Clew's own records: the proposal thread, its proposals, the audit row
 * and the undo timer, inside one transaction. `adapters/postgres.ts` runs in the server, `adapters/memory.ts` in the
 * tests, both held to `tests/proposal-store-contract.ts`. Every instant is an ISO string the use case hands in.
 */
export interface ProposalRecord {
  id: string; threadId: string; personId: string; status: ProposalStatus;
  participant: { email: string; name: string };
  start: string; end: string;
  eventUid: string | null; eventRef: string | null; eventRevision: string | null;
  confirmedAt: string | null; undoUntil: string | null;
}
export type ProposalPatch = Partial<Pick<ProposalRecord, 'status' | 'eventUid' | 'eventRef' | 'eventRevision' | 'confirmedAt' | 'undoUntil'>>;
/** The thread as the contract shows it (superseded proposals left out) plus every proposal record the module holds. */
export interface ProposalThread { thread: Thread; proposals: ProposalRecord[] }
export interface NewProposalThread {
  id: string; personId: string; topic: string; title: string; week: string; area: string; summary: string;
  trigger: Thread['trigger']; createdAt: string; updatedAt: string;
}
export type ProposalThreadPatch = Partial<Pick<Thread, 'title' | 'week' | 'state' | 'handledAt' | 'updatedAt'>> & { items?: ThreadItem[] };
export interface AuditEntry { actor: string; action: string; subject: string; at: string; details?: Record<string, unknown> }
export interface JobInput { id: string; kind: string; runAt: string; payload?: Record<string, unknown> }

export interface ProposalTx {
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
  openThread(personId: string, topic: string): Promise<ProposalThread | undefined>;
  /** Proposed, confirmed and final proposals of a person, across threads. */
  activeProposals(personId: string): Promise<ProposalRecord[]>;
  transaction<T>(fn: (tx: ProposalTx) => Promise<T>): Promise<T>;
}
/** A person's calendar and unit: the provider (D11) plus the members a manager plans for. The live one caches per authorization version. */
export type CalendarBinder = (persona: AuthenticatedContext) => CalendarBinding;
