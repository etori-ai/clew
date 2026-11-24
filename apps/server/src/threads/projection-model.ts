import type { InvitationOnItsWay } from '../modules/calendar/usecases/booked';
import type { InvitationsTx, ProposalPatch, ProposalRecord } from '../modules/calendar/model';
import type { FollowupPolicy } from '../modules/calendar/usecases/followups';
import type { ThreadTx } from './model';

/**
 * The port of the ledger's projection onto the stream (D45): what `usecases/projection.ts` reads and writes inside the
 * ledger's own transaction when an execution is approved or changes state. The Postgres adapter
 * (`adapters/projection-postgres.ts`) is what the server runs, bound by `composition/execution-projection.ts`; the memory
 * adapter (`adapters/projection-memory.ts`) is what the unit tests run, and `tests/projection-contract.ts` holds both to
 * the same behaviour. The rules (which approval may land on a card, the check of each confirmed proposal, the fixed
 * follow-up policy, one talk a round, what a result does to the card and the audit rows) are the use case's, never an
 * adapter's.
 */
export type ProjectionStage = 'approval' | 'update';
/** Another manager's approved invitation to an invitee, as the lock finds it: whom it invites and where its sending stands. */
export interface InvitationElsewhere extends InvitationOnItsWay {
  personId: string;
}
/** A job row the projection starts with its workflow (D86): a receipt turning final, or an undo's window closing. */
export interface ProjectionJob {
  id: string;
  kind: string;
  runAt: string;
  payload: Record<string, unknown>;
}
/** The calendar's own rows the projection checks and settles: the proposals on a card and their follow-up policy. */
export interface ProposalProjectionTx {
  /** The person's proposal, locked until the transaction ends; with `threadId`, only one on that card. */
  lockProposal(personId: string, proposalId: string, threadId?: string): Promise<ProposalRecord | undefined>;
  /** The person's proposal in a booked status whose calendar event is `eventRef`, locked (D133: by the event, never the title). */
  lockBooked(personId: string, eventRef: string): Promise<ProposalRecord | undefined>;
  /** The person's proposal takes the patch; false when the person has no proposal by that id. */
  updateProposal(personId: string, proposalId: string, patch: ProposalPatch): Promise<boolean>;
  /**
   * Hold these invitees against every other approval until the transaction ends (one lock per invitee, taken in the order
   * given), then read the invitations to them that managers other than `personId` have approved and not yet seen sent:
   * proposals still `proposed` whose execution is pending, running or unknown (M1).
   */
  lockInvitees(personId: string, invitees: readonly string[]): Promise<InvitationElsewhere[]>;
  /** These proposals are taken by the approved execution (M1): its state is what holds their invitees. */
  takeProposals(proposalIds: readonly string[], executionId: string): Promise<void>;
  /** The card's follow-up policy (D30), if it has one. */
  policy(threadId: string): Promise<FollowupPolicy | undefined>;
  /** Insert or replace the card's policy. */
  savePolicy(policy: FollowupPolicy): Promise<void>;
}
export interface ProjectionTx {
  /** The card, its obligation timer with its workflow start, and the audit rows: the stream's own port, in this transaction. */
  cards: Pick<
    ThreadTx,
    'insertThread' | 'lockThread' | 'updateThread' | 'scheduleTimer' | 'cancelTimer' | 'enqueue' | 'writeAudit'
  >;
  proposals: ProposalProjectionTx;
  /** A job row with its workflow start, once by id; true when this call inserted it. The use case writes its `job.scheduled` row. */
  insertJob(job: ProjectionJob): Promise<boolean>;
  /** The talks domain, told when an invitation is established, moved or ended (D132 item 3). */
  invitations: InvitationsTx;
}
