import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { schema, type Transaction } from '@clew/db';
import { enqueueWorkflow, type DurableQueue } from '@clew/db/durable';
import { jobStart } from '@clew/db/jobs';
import type { InvitationsTx, ProposalPatch, ProposalRecord } from '../../modules/calendar/model';
import { BOOKED } from '../../modules/calendar/usecases/booked';
import type { ProjectionTx } from '../projection-model';
import { threadTx } from './postgres';

const { proposals, followupPolicies, executions, jobs } = schema;
const proposalOf = (r: typeof proposals.$inferSelect): ProposalRecord => ({
  id: r.id,
  threadId: r.threadId,
  personId: r.personId,
  status: r.status,
  participant: { personId: r.participantId, email: r.participantEmail, name: r.participantName },
  start: r.start.toISOString(),
  end: r.end.toISOString(),
  eventUid: r.eventUid,
  eventRef: r.eventRef,
  eventRevision: r.eventRevision,
  confirmedAt: r.confirmedAt?.toISOString() ?? null,
  undoUntil: r.undoUntil?.toISOString() ?? null,
  reminders: r.reminders,
  remindedAt: r.remindedAt?.toISOString() ?? null,
});
const instant = (at: string | null | undefined) => (at === undefined ? undefined : at === null ? null : new Date(at));
const proposalRow = ({ start, end, confirmedAt, undoUntil, remindedAt, ...rest }: ProposalPatch) => ({
  ...rest,
  ...(start !== undefined ? { start: new Date(start) } : {}),
  ...(end !== undefined ? { end: new Date(end) } : {}),
  ...(confirmedAt !== undefined ? { confirmedAt: instant(confirmedAt) } : {}),
  ...(undoUntil !== undefined ? { undoUntil: instant(undoUntil) } : {}),
  ...(remindedAt !== undefined ? { remindedAt: instant(remindedAt) } : {}),
});
/**
 * The projection's port over the ledger's own transaction (D45): the card through the thread store's own transaction
 * adapter, the proposals and the follow-up policy in SQL, and the talks domain through `invitations`, which the
 * composition root builds on the same transaction (D132 item 3). The obligation timer and the receipt jobs start their
 * workflows in this transaction (D86), in the engine's application and queue named by `durable`.
 */
export function postgresProjectionTx(
  tx: Transaction,
  durable: DurableQueue,
  invitations: (tx: Transaction) => InvitationsTx,
): ProjectionTx {
  return {
    cards: threadTx(tx, { durable }),
    proposals: {
      async lockProposal(personId, proposalId, threadId) {
        const [p] = await tx
          .select()
          .from(proposals)
          .where(
            and(
              eq(proposals.id, proposalId),
              eq(proposals.personId, personId),
              threadId === undefined ? undefined : eq(proposals.threadId, threadId),
            ),
          )
          .for('update');
        return p ? proposalOf(p) : undefined;
      },
      async lockBooked(personId, eventRef) {
        const [p] = await tx
          .select()
          .from(proposals)
          .where(
            and(
              eq(proposals.personId, personId),
              eq(proposals.eventRef, eventRef),
              inArray(proposals.status, [...BOOKED]),
            ),
          )
          .for('update');
        return p ? proposalOf(p) : undefined;
      },
      async updateProposal(personId, proposalId, patch) {
        const changed = await tx
          .update(proposals)
          .set(proposalRow(patch))
          .where(and(eq(proposals.id, proposalId), eq(proposals.personId, personId)))
          .returning({ id: proposals.id });
        return changed.length > 0;
      },
      async lockInvitees(personId, invitees) {
        for (const id of invitees)
          await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${'clew.invitee:' + id}, 0))`);
        if (!invitees.length) return [];
        const found = await tx
          .select({
            personId: proposals.participantId,
            start: proposals.start,
            state: executions.state,
            reason: executions.reason,
            expiresAt: executions.expiresAt,
          })
          .from(proposals)
          .innerJoin(executions, eq(executions.id, proposals.executionId))
          .where(
            and(
              inArray(proposals.participantId, [...invitees]),
              ne(proposals.personId, personId),
              eq(proposals.status, 'proposed'),
              inArray(executions.state, ['pending', 'running', 'unknown']),
            ),
          );
        return found.map(r => ({ ...r, start: r.start.toISOString(), expiresAt: r.expiresAt.toISOString() }));
      },
      async takeProposals(proposalIds, executionId) {
        if (proposalIds.length)
          await tx
            .update(proposals)
            .set({ executionId })
            .where(inArray(proposals.id, [...proposalIds]));
      },
      async policy(threadId) {
        const [p] = await tx.select().from(followupPolicies).where(eq(followupPolicies.threadId, threadId));
        return p ? { ...p, expiresAt: p.expiresAt.toISOString() } : undefined;
      },
      async savePolicy(policy) {
        const row = { ...policy, expiresAt: new Date(policy.expiresAt) };
        await tx
          .insert(followupPolicies)
          .values(row)
          .onConflictDoUpdate({ target: followupPolicies.threadId, set: row });
      },
    },
    async insertJob(job) {
      const runAt = new Date(job.runAt);
      const inserted = await tx
        .insert(jobs)
        .values({ id: job.id, kind: job.kind, runAt, payload: job.payload })
        .onConflictDoNothing()
        .returning({ id: jobs.id });
      if (inserted.length) await enqueueWorkflow(tx, durable, jobStart(job.id, runAt));
      return inserted.length > 0;
    },
    invitations: invitations(tx),
  };
}
