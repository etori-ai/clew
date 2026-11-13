import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { schema, type Transaction } from '@clew/db';
import { enqueueWorkflow, type DurableQueue } from '@clew/db/durable';
import { jobStart } from '@clew/db/jobs';
import { receipt } from '@clew/connectors';
import { ExecutionError, type Execution } from '../modules/executions/model';
import type { CalendarCommand } from '../modules/calendar/usecases/decisions';
import { invitingSentence } from '../modules/calendar/usecases/booked';
import { timerTx } from '../threads/adapters/timer-postgres';
import { reminderStart } from '../threads/domain';
import { nextCheck } from '../modules/calendar/usecases/obligation';

type Stage = 'approval' | 'update';
/**
 * The execution, visible card and audit commit through this same physical transaction. Never source I/O here. The
 * obligation timer and the receipt jobs it writes start their workflows in the same transaction (D86), in the engine's
 * application and queue named by `durable`; the composition root binds it, a Postgres test binds its own.
 */
export const projectExecution = (durable: DurableQueue) => (tx: Transaction, e: Execution, stage: Stage) =>
  project(tx, e, stage, durable);
async function project(tx: Transaction, e: Execution, stage: Stage, durable: DurableQueue) {
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
    await refuseInvitedElsewhere(tx, e, selected);
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
        if (p && p.status === 'proposed')
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
      } else if (item.action === 'cancel')
        await tx
          .update(schema.proposals)
          .set({ status: item.id.startsWith('replace:') ? 'superseded' : 'undone', undoUntil: null })
          .where(and(eq(schema.proposals.id, item.proposalId), eq(schema.proposals.personId, e.personId)));
    }
  }
  await tx
    .update(schema.threads)
    .set({
      execution,
      updatedAt: new Date(e.updatedAt),
      ...(stage === 'approval' ? { waitingOn: 'Väntar på källans besked' } : {}),
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
 * One talk a round, held at the approval (M1, Q12): two managers of one person who confirm at the same moment both pass
 * the check in `confirm`, which sees only settled bookings. Here, under a transaction lock per invitee taken in one
 * order, a confirmation is refused while another manager's approved invitation to the same person may be on its way
 * (its execution pending, running or unknown), and the proposals it takes are marked with its execution, so that the
 * confirmation after it sees it. A booking that settled in the meantime is caught when the invitation is sent.
 */
async function refuseInvitedElsewhere(tx: Transaction, e: Execution, selected: CalendarCommand['items']) {
  const invitees = [...new Set(selected.flatMap(i => (i.personId === undefined ? [] : [i.personId])))].sort();
  for (const id of invitees)
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${'clew.invitee:' + id}, 0))`);
  const rivals = invitees.length
    ? await tx
        .select({ personId: schema.proposals.participantId })
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
  const taken = new Set(rivals.map(r => r.personId));
  if (taken.size)
    throw new ExecutionError(
      invitingSentence(selected.filter(i => i.personId !== undefined && taken.has(i.personId)).map(i => i.label)),
    );
  const ids = selected.flatMap(i => (i.proposalId ? [i.proposalId] : []));
  if (ids.length) await tx.update(schema.proposals).set({ executionId: e.id }).where(inArray(schema.proposals.id, ids));
}
