import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { schema, type Transaction } from '@clew/db';
import { enqueueWorkflow, type DurableQueue } from '@clew/db/durable';
import { jobStart } from '@clew/db/jobs';
import { receipt } from '@clew/connectors';
import { ExecutionError, type Execution } from '../modules/executions/model';
import type { CalendarCommand } from '../modules/calendar/usecases/decisions';
import type { InvitationsTx } from '../modules/calendar/model';
import { invitingSentence, mayStillBeSent } from '../modules/calendar/usecases/booked';
import { talkInvitationsOn } from './talk-invitations';
import { timerTx } from '../threads/adapters/timer-postgres';
import { reminderStart } from '../threads/domain';
import { nextCheck } from '../modules/calendar/usecases/obligation';

type Stage = 'approval' | 'update';
/**
 * The execution, visible card and audit commit through this same physical transaction. Never source I/O here, and no
 * read through another connection. The obligation timer and the receipt jobs it writes start their workflows in the
 * same transaction (D86), in the engine's application and queue named by `durable`; the composition root binds it, a
 * Postgres test binds its own. An invitation that the calendar read back, or that was undone or replaced, reaches the
 * talk whose booking it carries here too (D132 item 3): `invitations` builds the talks module's port on this transaction.
 */
type Invitations = (tx: Transaction) => InvitationsTx;
/** Who the talks domain's audit row is written as when an execution's result settles an invitation. */
const EXECUTION_ACTOR = 'system:execution';
export const projectExecution =
  (durable: DurableQueue, invitations: Invitations = talkInvitationsOn) =>
  (tx: Transaction, e: Execution, stage: Stage) =>
    project(tx, e, stage, durable, invitations);
async function project(tx: Transaction, e: Execution, stage: Stage, durable: DurableQueue, invitations: Invitations) {
  if (!e.presentation) return;
  if (stage === 'approval' && e.presentation.newTitle && e.connector === 'calendar' && !e.compensates) {
    await tx.insert(schema.threads).values({
      id: e.presentation.threadId,
      personId: e.personId,
      sourceAuthorization: e.authorizationVersion,
      kind: 'pushed',
      topic: `calendar-decision:${e.decisionId}`,
      title: e.presentation.newTitle,
      state: 'open',
      connector: 'calendar',
      area: 'calendar',
      summary: 'Beslutet är sparat. Väntar på kalenderns besked.',
      trigger: { reason: 'Du godkände en kalenderändring', source: 'Kalendern', at: e.createdAt },
      createdAt: new Date(e.createdAt),
      updatedAt: new Date(e.createdAt),
    });
  }
  const [thread] = await tx
    .select()
    .from(schema.threads)
    .where(and(eq(schema.threads.id, e.presentation.threadId), eq(schema.threads.personId, e.personId)))
    .for('update');
  if (!thread) throw new ExecutionError('Ärendet finns inte.');
  const previous = thread.execution;
  if (stage === 'approval') {
    if (
      (!e.presentation.newTitle && thread.updatedAt.toISOString() !== e.presentation.version) ||
      thread.connector !== e.connector
    )
      throw new ExecutionError('Ärendet har ändrats. Läs tillbaka det innan du bekräftar.');
    if (previous && ['pending', 'running', 'unknown'].includes(previous.state))
      throw new ExecutionError('Ett tidigare beslut väntar redan på besked.');
    if (e.compensates ? previous?.id !== e.compensates : thread.state !== 'open')
      throw new ExecutionError('Ärendet är redan hanterat.');
  } else if (previous?.id !== e.id) return;
  const execution = {
    id: e.id,
    decisionId: e.decisionId,
    operation: e.operation,
    state: e.state,
    reason: e.reason,
    compensates: e.compensates,
  };
  const confirmed = e.state === 'succeeded';
  const terminal = ['succeeded', 'partial', 'failed'].includes(e.state);
  const result = e.result;
  const projectedReceipt = result ? receipt(result, new Date(e.dispatchedAt ?? e.createdAt)) : null;
  const command = e.connector === 'calendar' ? (e.payload as CalendarCommand) : undefined;
  if (stage === 'approval' && command?.threadId && e.operation === 'calendar.confirmProposals') {
    const selected = command.items.filter(i => i.action === 'create');
    for (const item of selected) {
      const [p] = await tx
        .select()
        .from(schema.proposals)
        .where(
          and(
            eq(schema.proposals.id, item.proposalId!),
            eq(schema.proposals.threadId, thread.id),
            eq(schema.proposals.personId, e.personId),
          ),
        )
        .for('update');
      if (
        !p ||
        p.status !== 'proposed' ||
        item.action !== 'create' ||
        p.start.toISOString() !== item.input.start ||
        p.end.toISOString() !== item.input.end ||
        p.participantId !== item.personId ||
        p.participantEmail.toLowerCase() !== item.input.participants[0]?.toLowerCase()
      )
        throw new ExecutionError('Förslaget har ändrats. Läs om sidan.');
    }
    await refuseInvitedElsewhere(tx, e, command);
    if (!command.followup || command.followup.maxReminders !== 2 || command.followup.afterWorkdays !== 2)
      throw new ExecutionError('Ogiltig uppföljningsplan.');
    const [previousPolicy] = await tx
      .select()
      .from(schema.followupPolicies)
      .where(eq(schema.followupPolicies.threadId, thread.id));
    const policy = {
      threadId: thread.id,
      personId: e.personId,
      unitId: e.unitId,
      authorizationVersion: e.authorizationVersion,
      executionId: e.id,
      proposalIds: [...new Set([...(previousPolicy?.proposalIds ?? []), ...selected.map(i => i.proposalId!)])],
      maxReminders: 2,
      afterWorkdays: 2,
      expiresAt: new Date(command.followup.expiresAt),
      state: 'active' as const,
      reason: null,
    };
    await tx
      .insert(schema.followupPolicies)
      .values(policy)
      .onConflictDoUpdate({ target: schema.followupPolicies.threadId, set: policy });
    const timer = await timerTx(tx).scheduleTimer({
      id: `obligation:${thread.id}`,
      threadId: thread.id,
      personId: e.personId,
      kind: 'obligation',
      unitId: e.unitId,
      authorizationVersion: e.authorizationVersion,
      requestedAt: e.createdAt,
      dueAt: nextCheck(e.createdAt),
    });
    await enqueueWorkflow(tx, durable, reminderStart(timer));
    await tx.insert(schema.audit).values({
      actor: e.principal,
      action: 'obligation.policy_approved',
      subject: `thread:${thread.id}`,
      createdAt: new Date(e.createdAt),
      details: { executionId: e.id, maxReminders: 2, afterWorkdays: 2, expiresAt: command.followup.expiresAt },
    });
  }
  if (stage === 'approval' && command?.threadId && e.compensates) {
    await tx
      .update(schema.followupPolicies)
      .set({ state: 'cancelled', reason: 'compensation-approved' })
      .where(eq(schema.followupPolicies.threadId, thread.id));
    await timerTx(tx).cancelTimer(`obligation:${thread.id}`, e.createdAt);
  }
  if (command?.threadId && result && e.state !== 'running') {
    for (const item of command.items) {
      if (!item.proposalId || !result.rows.some(r => r.ref === item.id && r.outcome === 'done')) continue;
      const evidence = result.rows.find(r => r.ref === item.id)?.source;
      if (item.action === 'create' && evidence) {
        const [p] = await tx
          .select()
          .from(schema.proposals)
          .where(and(eq(schema.proposals.id, item.proposalId), eq(schema.proposals.personId, e.personId)))
          .for('update');
        if (p && p.status === 'proposed') {
          await tx
            .update(schema.proposals)
            .set({
              status: 'confirmed',
              eventUid: evidence.uid,
              eventRef: evidence.ref,
              eventRevision: evidence.revision,
              confirmedAt: new Date(e.dispatchedAt ?? e.createdAt),
              undoUntil: projectedReceipt?.undoUntil ? new Date(projectedReceipt.undoUntil) : null,
            })
            .where(eq(schema.proposals.id, p.id));
          // The calendar holds the invitation, so the talk is booked: the talks domain's own record (D132 item 3).
          await invitations(tx).established({
            actor: EXECUTION_ACTOR,
            invitationId: p.id,
            managerId: p.personId,
            employeeId: p.participantId,
            start: p.start.toISOString(),
            end: p.end.toISOString(),
            at: e.updatedAt,
          });
        }
      } else if (item.action === 'cancel') {
        const replaced = item.id.startsWith('replace:');
        const ended = await tx
          .update(schema.proposals)
          .set({ status: replaced ? 'superseded' : 'undone', undoUntil: null })
          .where(and(eq(schema.proposals.id, item.proposalId), eq(schema.proposals.personId, e.personId)))
          .returning({ id: schema.proposals.id });
        // The invitation is gone from the calendar, so the talk it booked lacks a time again.
        for (const { id } of ended)
          await invitations(tx).ended({
            actor: EXECUTION_ACTOR,
            invitationId: id,
            why: replaced ? 'replaced' : 'undone',
            at: e.updatedAt,
          });
      }
    }
  }
  if (command && !command.threadId && result && e.state !== 'running')
    await followOwnEvents(tx, e, command, result.rows, invitations);
  await tx
    .update(schema.threads)
    .set({
      execution,
      updatedAt: new Date(e.updatedAt),
      ...(stage === 'approval' ? { waitingOn: 'källans besked' } : {}),
      ...(!e.compensates && projectedReceipt && e.state !== 'running' ? { receipt: projectedReceipt } : {}),
      ...(!e.compensates && confirmed
        ? { state: 'handled' as const, handledAt: new Date(e.updatedAt), waitingOn: null }
        : {}),
      ...(['unknown', 'partial', 'failed'].includes(e.state) || e.reason ? { waitingOn: null } : {}),
      ...(e.compensates && confirmed
        ? { state: 'open' as const, handledAt: null, waitingOn: null, receipt: null }
        : {}),
      ...(command?.threadId && !e.compensates && confirmed
        ? { state: 'open' as const, handledAt: null, waitingOn: 'svar från medarbetarna' }
        : {}),
    })
    .where(eq(schema.threads.id, thread.id));
  if (!e.compensates && projectedReceipt?.undoUntil && e.state !== 'running') {
    for (const kind of ['receipt-final', ...(command?.threadId ? ['undo-expiry'] : [])]) {
      const runAt = new Date(projectedReceipt.undoUntil);
      const inserted = await tx
        .insert(schema.jobs)
        .values({ id: `${kind}:${e.id}`, kind, runAt, payload: { threadId: thread.id } })
        .onConflictDoNothing()
        .returning({ id: schema.jobs.id });
      if (inserted.length) await enqueueWorkflow(tx, durable, jobStart(`${kind}:${e.id}`, runAt));
    }
  }
  if (stage === 'approval' || terminal || e.state === 'unknown') {
    await tx.insert(schema.audit).values({
      actor: stage === 'approval' ? e.principal : 'system:execution',
      action: stage === 'approval' ? 'thread.decision_approved' : 'thread.execution_' + e.state,
      subject: 'thread:' + thread.id,
      createdAt: new Date(e.updatedAt),
      details: { executionId: e.id, operation: e.operation, compensates: e.compensates },
    });
  }
}
/**
 * A meeting the person moved or cancelled on the calendar page may be the event of an invitation to a talk (D133). It
 * is found by the event's ref, which the proposal stored when the invitation was read back, never by its title. The
 * move or the cancellation is a decision made in Clew, so the invitation follows it here, in the transaction that
 * records the calendar's answer: the proposal takes the new time, or is undone, and the talks module is told, so the
 * talk's booking never waits for a reading back to say what the person just decided. An undo of a move is a move back
 * and takes the same path.
 */
async function followOwnEvents(
  tx: Transaction,
  e: Execution,
  command: CalendarCommand,
  rows: ReadonlyArray<{ ref: string; outcome: string; source?: { ref: string; revision: string } }>,
  invitations: Invitations,
) {
  for (const item of command.items) {
    if (item.action === 'create' || item.proposalId) continue;
    const row = rows.find(r => r.ref === item.id && r.outcome === 'done');
    if (!row) continue;
    const [p] = await tx
      .select()
      .from(schema.proposals)
      .where(
        and(
          eq(schema.proposals.personId, e.personId),
          eq(schema.proposals.eventRef, item.ref),
          inArray(schema.proposals.status, ['confirmed', 'final', 'accepted']),
        ),
      )
      .for('update');
    if (!p) continue;
    // A check of the same execution reads the result again: what is already as decided is left as it is.
    if (item.action === 'move' && p.start.toISOString() === item.start && p.end.toISOString() === item.end) continue;
    if (item.action === 'move') {
      await tx
        .update(schema.proposals)
        .set({
          start: new Date(item.start),
          end: new Date(item.end),
          ...(row.source ? { eventRef: row.source.ref, eventRevision: row.source.revision } : {}),
        })
        .where(eq(schema.proposals.id, p.id));
      await invitations(tx).moved({
        actor: EXECUTION_ACTOR,
        invitationId: p.id,
        start: item.start,
        end: item.end,
        at: e.updatedAt,
      });
    } else {
      await tx.update(schema.proposals).set({ status: 'undone', undoUntil: null }).where(eq(schema.proposals.id, p.id));
      await invitations(tx).ended({ actor: EXECUTION_ACTOR, invitationId: p.id, why: 'cancelled', at: e.updatedAt });
    }
    await tx.insert(schema.audit).values({
      actor: EXECUTION_ACTOR,
      action: item.action === 'move' ? 'proposals.moved' : 'proposals.cancelled',
      subject: 'thread:' + p.threadId,
      createdAt: new Date(e.updatedAt),
      details:
        item.action === 'move'
          ? { proposal: p.id, start: item.start, end: item.end, by: 'decision', executionId: e.id }
          : { proposal: p.id, kept: false, by: 'decision', executionId: e.id },
    });
  }
}
/**
 * One talk a round, held at the approval (M1, Q12): two managers of one person who confirm at the same moment both pass
 * the check in `confirm`, which sees only settled bookings. Here, under a transaction lock per invitee taken in one
 * order, a confirmation is refused while another manager's approved invitation to the same person may still be sent
 * (`mayStillBeSent`: being sent, waiting to be sent, or sent with its result unknown, inside its approval's 24 hours and
 * the period of this confirmation's round). Team membership can change again before retry, so a temporary loss of
 * membership cannot release a live approval. The proposals are marked with the execution in this transaction. A
 * booking that settled in the meantime is checked again at dispatch.
 */
async function refuseInvitedElsewhere(tx: Transaction, e: Execution, command: CalendarCommand) {
  const selected = command.items.filter(i => i.action === 'create');
  const invitees = [...new Set(selected.flatMap(i => (i.personId === undefined ? [] : [i.personId])))].sort();
  for (const id of invitees)
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${'clew.invitee:' + id}, 0))`);
  const found = invitees.length
    ? await tx
        .select({
          personId: schema.proposals.participantId,
          start: schema.proposals.start,
          state: schema.executions.state,
          reason: schema.executions.reason,
          expiresAt: schema.executions.expiresAt,
        })
        .from(schema.proposals)
        .innerJoin(schema.executions, eq(schema.executions.id, schema.proposals.executionId))
        .where(
          and(
            inArray(schema.proposals.participantId, invitees),
            ne(schema.proposals.personId, e.personId),
            eq(schema.proposals.status, 'proposed'),
            inArray(schema.executions.state, ['pending', 'running', 'unknown']),
          ),
        )
    : [];
  const onItsWay = found.filter(r =>
    mayStillBeSent(
      { start: r.start.toISOString(), state: r.state, reason: r.reason, expiresAt: r.expiresAt.toISOString() },
      e.createdAt,
      command.round,
    ),
  );
  const taken = new Set(onItsWay.map(r => r.personId));
  if (taken.size)
    throw new ExecutionError(
      invitingSentence(selected.filter(i => i.personId !== undefined && taken.has(i.personId)).map(i => i.label)),
    );
  const ids = selected.flatMap(i => (i.proposalId ? [i.proposalId] : []));
  if (ids.length) await tx.update(schema.proposals).set({ executionId: e.id }).where(inArray(schema.proposals.id, ids));
}
