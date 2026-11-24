import { receipt, type ExecuteResult } from '@clew/connectors';
import { ExecutionError, type Execution } from '../../modules/executions/model';
import type { CalendarCommand } from '../../modules/calendar/usecases/decisions';
import { BOOKED, invitingSentence, mayStillBeSent } from '../../modules/calendar/usecases/booked';
import { nextCheck } from '../../modules/calendar/usecases/obligation';
import type { ThreadPatch } from '../model';
import { reminderStart } from '../domain';
import type { ProjectionStage, ProjectionTx } from '../projection-model';

/** Who the talks domain's audit row is written as when an execution's result settles an invitation. */
const EXECUTION_ACTOR = 'system:execution';
/**
 * The ledger's projection of an execution onto its card (D45), run inside the ledger's own transaction on `insert`
 * (`approval`) and on every `update`: the execution, the card and their audit rows commit together. Never source I/O
 * here. An approval lands on a card only as the card was shown, with no earlier decision still waiting and the card
 * still open (or, for an undo, on the decision it undoes). A confirmation of drawn talk times checks each proposal
 * against what was approved, holds one talk a round against other managers' invitations on their way (M1), and starts
 * the fixed follow-up policy (D30) with its obligation timer. An invitation the calendar read back, or that was undone
 * or replaced, reaches the talk whose booking it carries (D132 item 3).
 */
export async function projectOntoCard(tx: ProjectionTx, e: Execution, stage: ProjectionStage) {
  if (!e.presentation) return;
  const { cards } = tx;
  if (stage === 'approval' && e.presentation.newTitle && e.connector === 'calendar' && !e.compensates)
    await cards.insertThread({
      id: e.presentation.threadId,
      personId: e.personId,
      sourceAuthorization: e.authorizationVersion,
      kind: 'pushed',
      topic: `calendar-decision:${e.decisionId}`,
      title: e.presentation.newTitle,
      state: 'open',
      week: null,
      connector: 'calendar',
      area: 'calendar',
      summary: 'Beslutet är sparat. Väntar på kalenderns besked.',
      items: [],
      actions: [],
      waitingOn: null,
      deadline: null,
      trigger: { reason: 'Du godkände en kalenderändring', source: 'Kalendern', at: e.createdAt },
      createdAt: e.createdAt,
      updatedAt: e.createdAt,
    });
  const thread = await cards.lockThread(e.personId, e.presentation.threadId);
  if (!thread) throw new ExecutionError('Ärendet finns inte.');
  const previous = thread.execution;
  if (stage === 'approval') {
    if ((!e.presentation.newTitle && thread.updatedAt !== e.presentation.version) || thread.connector !== e.connector)
      throw new ExecutionError('Ärendet har ändrats. Läs tillbaka det innan du bekräftar.');
    if (previous && ['pending', 'running', 'unknown'].includes(previous.state))
      throw new ExecutionError('Ett tidigare beslut väntar redan på besked.');
    if (e.compensates ? previous?.id !== e.compensates : thread.state !== 'open')
      throw new ExecutionError('Ärendet är redan hanterat.');
  } else if (previous?.id !== e.id) return;
  const confirmed = e.state === 'succeeded';
  const terminal = ['succeeded', 'partial', 'failed'].includes(e.state);
  const result = e.result;
  const projectedReceipt = result ? receipt(result, new Date(e.dispatchedAt ?? e.createdAt)) : null;
  const command = e.connector === 'calendar' ? (e.payload as CalendarCommand) : undefined;
  if (stage === 'approval' && command?.threadId && e.operation === 'calendar.confirmProposals')
    await approveInvitations(tx, e, thread.id, command);
  if (stage === 'approval' && command?.threadId && e.compensates) {
    // An approved undo ends the follow-up the confirmation started.
    const policy = await tx.proposals.policy(thread.id);
    if (policy) await tx.proposals.savePolicy({ ...policy, state: 'cancelled', reason: 'compensation-approved' });
    await cards.cancelTimer(`obligation:${thread.id}`, e.createdAt);
  }
  if (command?.threadId && result && e.state !== 'running')
    await settleInvitations(tx, e, command, result, projectedReceipt?.undoUntil ?? null);
  if (command && !command.threadId && result && e.state !== 'running')
    await followOwnEvents(tx, e, command, result.rows);
  const patch: ThreadPatch = {
    execution: {
      id: e.id,
      decisionId: e.decisionId,
      operation: e.operation,
      state: e.state,
      reason: e.reason,
      compensates: e.compensates,
    },
    updatedAt: e.updatedAt,
    ...(stage === 'approval' ? { waitingOn: 'källans besked' } : {}),
    ...(!e.compensates && projectedReceipt && e.state !== 'running' ? { receipt: projectedReceipt } : {}),
    ...(!e.compensates && confirmed ? { state: 'handled' as const, handledAt: e.updatedAt, waitingOn: null } : {}),
    ...(['unknown', 'partial', 'failed'].includes(e.state) || e.reason ? { waitingOn: null } : {}),
    ...(e.compensates && confirmed ? { state: 'open' as const, handledAt: null, waitingOn: null, receipt: null } : {}),
    ...(command?.threadId && !e.compensates && confirmed
      ? { state: 'open' as const, handledAt: null, waitingOn: 'svar från medarbetarna' }
      : {}),
  };
  await cards.updateThread(thread.id, patch);
  if (!e.compensates && projectedReceipt?.undoUntil && e.state !== 'running')
    for (const kind of ['receipt-final', ...(command?.threadId ? ['undo-expiry'] : [])])
      await tx.insertJob({
        id: `${kind}:${e.id}`,
        kind,
        runAt: projectedReceipt.undoUntil,
        payload: { threadId: thread.id },
      });
  if (stage === 'approval' || terminal || e.state === 'unknown')
    await cards.writeAudit({
      actor: stage === 'approval' ? e.principal : EXECUTION_ACTOR,
      action: stage === 'approval' ? 'thread.decision_approved' : 'thread.execution_' + e.state,
      subject: 'thread:' + thread.id,
      at: e.updatedAt,
      details: { executionId: e.id, operation: e.operation, compensates: e.compensates },
    });
}
/**
 * The approval of drawn talk times: each selected proposal is still proposed, on this card, at the approved time and for
 * the approved invitee and address; no other manager's invitation to the same person is on its way (M1); and the
 * follow-up is the fixed policy of two reminders two workdays apart (D30), whose obligation timer starts here.
 */
async function approveInvitations(tx: ProjectionTx, e: Execution, threadId: string, command: CalendarCommand) {
  const selected = command.items.filter(i => i.action === 'create');
  for (const item of selected) {
    const p = await tx.proposals.lockProposal(e.personId, item.proposalId!, threadId);
    if (
      !p ||
      p.status !== 'proposed' ||
      item.action !== 'create' ||
      Date.parse(p.start) !== Date.parse(item.input.start) ||
      Date.parse(p.end) !== Date.parse(item.input.end) ||
      p.participant.personId !== item.personId ||
      p.participant.email.toLowerCase() !== item.input.participants[0]?.toLowerCase()
    )
      throw new ExecutionError('Förslaget har ändrats. Läs om sidan.');
  }
  await refuseInvitedElsewhere(tx, e, command);
  if (!command.followup || command.followup.maxReminders !== 2 || command.followup.afterWorkdays !== 2)
    throw new ExecutionError('Ogiltig uppföljningsplan.');
  const previousPolicy = await tx.proposals.policy(threadId);
  await tx.proposals.savePolicy({
    threadId,
    personId: e.personId,
    unitId: e.unitId,
    authorizationVersion: e.authorizationVersion,
    executionId: e.id,
    proposalIds: [...new Set([...(previousPolicy?.proposalIds ?? []), ...selected.map(i => i.proposalId!)])],
    maxReminders: 2,
    afterWorkdays: 2,
    expiresAt: command.followup.expiresAt,
    state: 'active',
    reason: null,
  });
  const timer = await tx.cards.scheduleTimer({
    id: `obligation:${threadId}`,
    threadId,
    personId: e.personId,
    kind: 'obligation',
    unitId: e.unitId,
    authorizationVersion: e.authorizationVersion,
    requestedAt: e.createdAt,
    dueAt: nextCheck(e.createdAt),
  });
  await tx.cards.enqueue(reminderStart(timer));
  await tx.cards.writeAudit({
    actor: e.principal,
    action: 'obligation.policy_approved',
    subject: `thread:${threadId}`,
    at: e.createdAt,
    details: { executionId: e.id, maxReminders: 2, afterWorkdays: 2, expiresAt: command.followup.expiresAt },
  });
}
/**
 * One talk a round, held at the approval (M1, Q12): two managers of one person who confirm at the same moment both pass
 * the check in `confirm`, which sees only settled bookings. Here, under a lock per invitee taken in one order, a
 * confirmation is refused while another manager's approved invitation to the same person may still be sent
 * (`mayStillBeSent`: being sent, waiting to be sent, or sent with its result unknown, inside its approval's 24 hours and
 * the period of this confirmation's round). Team membership can change again before retry, so a temporary loss of
 * membership cannot release a live approval. The proposals are marked with the execution in this transaction. A booking
 * that settled in the meantime is checked again at dispatch.
 */
async function refuseInvitedElsewhere(tx: ProjectionTx, e: Execution, command: CalendarCommand) {
  const selected = command.items.filter(i => i.action === 'create');
  const invitees = [...new Set(selected.flatMap(i => (i.personId === undefined ? [] : [i.personId])))].sort();
  const found = invitees.length ? await tx.proposals.lockInvitees(e.personId, invitees) : [];
  const taken = new Set(found.filter(r => mayStillBeSent(r, e.createdAt, command.round)).map(r => r.personId));
  if (taken.size)
    throw new ExecutionError(
      invitingSentence(selected.filter(i => i.personId !== undefined && taken.has(i.personId)).map(i => i.label)),
    );
  const ids = selected.flatMap(i => (i.proposalId ? [i.proposalId] : []));
  if (ids.length) await tx.proposals.takeProposals(ids, e.id);
}
/**
 * A result on a planning card: an invitation the calendar read back is sent (the talk is booked, D132 item 3); an undone
 * one is a proposed time again (DE-L17), so the card is open again; a replaced one gave way to its replacement.
 */
async function settleInvitations(
  tx: ProjectionTx,
  e: Execution,
  command: CalendarCommand,
  result: ExecuteResult,
  undoUntil: string | null,
) {
  for (const item of command.items) {
    if (!item.proposalId || !result.rows.some(r => r.ref === item.id && r.outcome === 'done')) continue;
    const evidence = result.rows.find(r => r.ref === item.id)?.source;
    if (item.action === 'create' && evidence) {
      const p = await tx.proposals.lockProposal(e.personId, item.proposalId);
      if (!p || p.status !== 'proposed') continue;
      await tx.proposals.updateProposal(e.personId, p.id, {
        status: 'confirmed',
        eventUid: evidence.uid,
        eventRef: evidence.ref,
        eventRevision: evidence.revision,
        confirmedAt: e.dispatchedAt ?? e.createdAt,
        undoUntil,
      });
      await tx.invitations.established({
        actor: EXECUTION_ACTOR,
        invitationId: p.id,
        managerId: p.personId,
        employeeId: p.participant.personId,
        start: p.start,
        end: p.end,
        at: e.updatedAt,
      });
    } else if (item.action === 'cancel') {
      const replaced = item.id.startsWith('replace:');
      const ended = await tx.proposals.updateProposal(
        e.personId,
        item.proposalId,
        replaced
          ? { status: 'superseded', undoUntil: null }
          : {
              status: 'proposed',
              undoUntil: null,
              eventUid: null,
              eventRef: null,
              eventRevision: null,
              confirmedAt: null,
            },
      );
      // The invitation is gone from the calendar, so the talk it booked lacks a time again.
      if (ended)
        await tx.invitations.ended({
          actor: EXECUTION_ACTOR,
          invitationId: item.proposalId,
          why: replaced ? 'replaced' : 'undone',
          at: e.updatedAt,
        });
    }
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
async function followOwnEvents(tx: ProjectionTx, e: Execution, command: CalendarCommand, rows: ExecuteResult['rows']) {
  for (const item of command.items) {
    if (item.action === 'create' || item.proposalId) continue;
    const row = rows.find(r => r.ref === item.id && r.outcome === 'done');
    if (!row) continue;
    const p = await tx.proposals.lockBooked(e.personId, item.ref);
    if (!p) continue;
    // A check of the same execution reads the result again: what is already as decided is left as it is. Compared as
    // instants, since the calendar page writes a time without milliseconds and the proposal reads back with them.
    if (
      item.action === 'move' &&
      Date.parse(p.start) === Date.parse(item.start) &&
      Date.parse(p.end) === Date.parse(item.end)
    )
      continue;
    if (item.action === 'move') {
      await tx.proposals.updateProposal(e.personId, p.id, {
        start: item.start,
        end: item.end,
        ...(row.source ? { eventRef: row.source.ref, eventRevision: row.source.revision } : {}),
      });
      await tx.invitations.moved({
        actor: EXECUTION_ACTOR,
        invitationId: p.id,
        start: item.start,
        end: item.end,
        at: e.updatedAt,
      });
    } else {
      await tx.proposals.updateProposal(e.personId, p.id, { status: 'undone', undoUntil: null });
      await tx.invitations.ended({ actor: EXECUTION_ACTOR, invitationId: p.id, why: 'cancelled', at: e.updatedAt });
    }
    await tx.cards.writeAudit({
      actor: EXECUTION_ACTOR,
      action: item.action === 'move' ? 'proposals.moved' : 'proposals.cancelled',
      subject: 'thread:' + p.threadId,
      at: e.updatedAt,
      details:
        item.action === 'move'
          ? { proposal: p.id, start: item.start, end: item.end, by: 'decision', executionId: e.id }
          : { proposal: p.id, kept: false, by: 'decision', executionId: e.id },
    });
  }
}
