import { describe, expect, test } from 'bun:test';
import type { Thread } from '../packages/contracts/src';
import type { Execution, ExecutionStore } from '../apps/server/src/modules/executions/model';
import type { ProposalRecord } from '../apps/server/src/modules/calendar/model';
import type { CalendarCommand, CalendarItem } from '../apps/server/src/modules/calendar/usecases/decisions';
import type { FollowupPolicy } from '../apps/server/src/modules/calendar/usecases/followups';
import { invitingSentence } from '../apps/server/src/modules/calendar/usecases/booked';
import { nextCheck } from '../apps/server/src/modules/calendar/usecases/obligation';
import type { TimerIntent } from '../apps/server/src/threads/model';
import type { ProjectionJob } from '../apps/server/src/threads/projection-model';
import type { InvitationCall } from '../apps/server/src/threads/adapters/projection-memory';
import { executionRecord } from './execution-store-contract';

/**
 * The ledger's projection onto the stream (D45, DE-M4): `threads/usecases/projection.ts` over its memory port
 * (`tests/unit/projection.test.ts`) and its Postgres port (`tests/db/postgres-projection.test.ts`), each behind the ledger
 * store it is bound to, as composition binds the Postgres one. Every case goes through `ExecutionTx.insert` and
 * `ExecutionTx.update`, where the ledger calls the projection.
 */
export interface ProjectionHarness {
  /** The manager whose decisions these are. */
  personId: string;
  /** Another manager, with their own proposals and ledger (M1). */
  otherId: string;
  /** Every id the harness writes starts with it. */
  prefix: string;
  store: ExecutionStore;
  /** A card as a scan or the planner left it. */
  seedCard(card: { id: string; personId: string; connector: string; state?: Thread['state'] }): Promise<void>;
  /** A proposal as the planner stored it, taken by an approved execution or not. */
  seedProposal(proposal: ProposalRecord, executionId?: string | null): Promise<void>;
  card(id: string): Promise<Thread | undefined>;
  proposal(id: string): Promise<(ProposalRecord & { executionId: string | null }) | undefined>;
  policy(threadId: string): Promise<FollowupPolicy | undefined>;
  timer(id: string): Promise<TimerIntent | undefined>;
  /** The job rows whose ids start with `prefix`, by id. */
  jobs(prefix: string): Promise<ProjectionJob[]>;
  /** The audit rows about `subject`, in the order written. */
  audit(subject: string): Promise<Array<{ actor: string; action: string; details: unknown }>>;
  /** What the talks domain was told, in order. */
  told(): Promise<InvitationCall[]>;
}
export const projectionAt = '2099-11-05T10:00:00.000Z';
const later = '2099-11-05T10:05:00.000Z';
const dispatched = '2099-11-05T10:01:00.000Z';

export function projectionContract(name: string, make: () => Promise<ProjectionHarness>) {
  describe(`${name} projection of the ledger onto the stream`, () => {
    let n = 0;
    /** An execution on a card, as the ledger approves it. */
    const on = (
      h: ProjectionHarness,
      threadId: string,
      extra: Partial<Execution> & { version?: string; newTitle?: string } = {},
    ): Execution => {
      const id = `${h.prefix}-e${++n}`;
      const { version = projectionAt, newTitle, ...rest } = extra;
      return {
        ...executionRecord(h.personId, id),
        decisionId: `decision:${id}`,
        createdAt: projectionAt,
        updatedAt: projectionAt,
        expiresAt: '2099-11-06T10:00:00.000Z',
        presentation: { threadId, version, actionId: 'approve', ...(newTitle ? { newTitle } : {}) },
        ...rest,
      };
    };
    const approve = (h: ProjectionHarness, e: Execution) => h.store.transaction(tx => tx.insert(e));
    const settle = (h: ProjectionHarness, e: Execution, patch: Partial<Execution>) =>
      h.store.transaction(tx => tx.update({ ...e, updatedAt: later, ...patch }));
    const done = (ref: string, source?: { ref: string; revision: string; uid?: string; icalUid?: string }) => ({
      headline: 'Klart',
      rows: [{ ref, label: 'Rad', outcome: 'done' as const, detail: 'Läst tillbaka', ...(source ? { source } : {}) }],
      undoCapability: 'reference.undo',
      undoMinutes: 10,
    });

    test('an approval lands only on the card as it was shown, of its own system, with nothing waiting and the card open; a refusal writes nothing', async () => {
      const h = await make(),
        card = `${h.prefix}-card`;
      await h.seedCard({ id: card, personId: h.personId, connector: 'reference' });
      const stale = on(h, card, { version: '2000-01-01T00:00:00.000Z' });
      await expect(approve(h, stale)).rejects.toThrow('Ärendet har ändrats. Läs tillbaka det innan du bekräftar.');
      const elsewhere = on(h, card, { connector: 'hr' });
      await expect(approve(h, elsewhere)).rejects.toThrow('Ärendet har ändrats.');
      // Someone else's card is not found as theirs.
      await expect(approve(h, on(h, card, { personId: h.otherId }))).rejects.toThrow('Ärendet finns inte.');
      expect(await h.store.read(stale.id)).toBeUndefined();
      expect(await h.audit('thread:' + card)).toEqual([]);
      expect((await h.card(card))?.execution ?? null).toBeNull();

      const e = on(h, card);
      await approve(h, e);
      expect(await h.card(card)).toMatchObject({
        state: 'open',
        waitingOn: 'källans besked',
        updatedAt: projectionAt,
        execution: { id: e.id, decisionId: e.decisionId, operation: e.operation, state: 'pending', reason: null },
      });
      expect(await h.audit('thread:' + card)).toEqual([
        {
          actor: e.principal,
          action: 'thread.decision_approved',
          details: { executionId: e.id, operation: e.operation, compensates: null },
        },
      ]);
      // A second decision while the first waits for its answer.
      await expect(approve(h, on(h, card))).rejects.toThrow('Ett tidigare beslut väntar redan på besked.');
    });

    test('a result lands on the card of its own execution only: succeeded is handled with its receipt and one receipt job; running and a stranger leave it', async () => {
      const h = await make(),
        card = `${h.prefix}-card`;
      await h.seedCard({ id: card, personId: h.personId, connector: 'reference' });
      const e = on(h, card);
      await approve(h, e);
      await settle(h, e, { state: 'running', dispatchedAt: dispatched });
      expect(await h.card(card)).toMatchObject({ waitingOn: 'källans besked', execution: { state: 'running' } });
      const result = done('item:1');
      await settle(h, e, { state: 'succeeded', dispatchedAt: dispatched, result });
      const undoUntil = '2099-11-05T10:11:00.000Z';
      expect(await h.card(card)).toMatchObject({
        state: 'handled',
        handledAt: later,
        waitingOn: null,
        updatedAt: later,
        execution: { id: e.id, state: 'succeeded' },
        receipt: { at: dispatched, headline: 'Klart', undoUntil, undoCapability: 'reference.undo' },
      });
      // A check of the same execution reads it again: one job, the same receipt.
      await settle(h, e, { state: 'succeeded', dispatchedAt: dispatched, result });
      expect(await h.jobs(`receipt-final:${e.id}`)).toEqual([
        { id: `receipt-final:${e.id}`, kind: 'receipt-final', runAt: undoUntil, payload: { threadId: card } },
      ]);
      expect((await h.audit('thread:' + card)).map(a => [a.actor, a.action])).toEqual([
        [e.principal, 'thread.decision_approved'],
        ['system:execution', 'thread.execution_succeeded'],
        ['system:execution', 'thread.execution_succeeded'],
      ]);
      // A handled card takes no new decision.
      const shown = (await h.card(card))!.updatedAt;
      await expect(approve(h, on(h, card, { version: shown }))).rejects.toThrow('Ärendet är redan hanterat.');
      // An execution the card does not carry changes nothing on it.
      const stranger = { ...on(h, card), state: 'failed' as const };
      await h.store.transaction(async tx => {
        await tx.insert({ ...stranger, presentation: null });
        await tx.update({ ...stranger, updatedAt: '2099-11-05T10:09:00.000Z' });
      });
      expect((await h.card(card))?.execution?.id).toBe(e.id);
    });

    test('an undo lands only on the decision it undoes; confirmed, the card is open again without its receipt; unknown keeps the original receipt', async () => {
      const h = await make(),
        card = `${h.prefix}-card`;
      await h.seedCard({ id: card, personId: h.personId, connector: 'reference' });
      const e = on(h, card);
      await approve(h, e);
      await settle(h, e, { state: 'succeeded', dispatchedAt: dispatched, result: done('item:1') });
      const original = (await h.card(card))!.receipt;
      const shown = (await h.card(card))!.updatedAt;
      await expect(approve(h, on(h, card, { version: shown, compensates: `${h.prefix}-nothing` }))).rejects.toThrow(
        'Ärendet är redan hanterat.',
      );
      const uncertain = on(h, card, { version: shown, compensates: e.id, operation: 'reference.undo' });
      await approve(h, uncertain);
      await settle(h, uncertain, { state: 'unknown', reason: 'lookup-failed' });
      expect(await h.card(card)).toMatchObject({
        state: 'handled',
        waitingOn: null,
        receipt: original,
        execution: { id: uncertain.id, state: 'unknown', compensates: e.id },
      });
      expect((await h.audit('thread:' + card)).at(-1)).toMatchObject({
        actor: 'system:execution',
        action: 'thread.execution_unknown',
        details: { executionId: uncertain.id, compensates: e.id },
      });
      // On another card, a confirmed undo opens the card again without the receipt.
      const other = `${h.prefix}-other`;
      await h.seedCard({ id: other, personId: h.personId, connector: 'reference' });
      const first = on(h, other);
      await approve(h, first);
      await settle(h, first, { state: 'succeeded', dispatchedAt: dispatched, result: done('item:2') });
      const undo = on(h, other, { version: (await h.card(other))!.updatedAt, compensates: first.id });
      await approve(h, undo);
      await settle(h, undo, { state: 'succeeded', dispatchedAt: dispatched, result: done('item:2') });
      expect(await h.card(other)).toMatchObject({
        state: 'open',
        handledAt: null,
        waitingOn: null,
        receipt: null,
        execution: { id: undo.id, state: 'succeeded', compensates: first.id },
      });
      // An undo writes no receipt job of its own.
      expect(await h.jobs(`receipt-final:${undo.id}`)).toEqual([]);
    });

    /** A planning card with two drawn times, one to each invitee. */
    async function planning(h: ProjectionHarness) {
      const card = `${h.prefix}-plan`;
      await h.seedCard({ id: card, personId: h.personId, connector: 'calendar' });
      const drawn = (i: number): ProposalRecord => ({
        id: `${h.prefix}-p${i}`,
        threadId: card,
        personId: h.personId,
        status: 'proposed',
        participant: { personId: `${h.prefix}-guest${i}`, email: `guest${i}@example.test`, name: `Gäst ${i}` },
        start: `2099-11-1${i}T09:00:00.000Z`,
        end: `2099-11-1${i}T10:00:00.000Z`,
        eventUid: null,
        eventRef: null,
        eventRevision: null,
        eventIcalUid: null,
        confirmedAt: null,
        undoUntil: null,
        reminders: 0,
        remindedAt: null,
      });
      const [p1, p2] = [drawn(1), drawn(2)];
      await h.seedProposal(p1);
      await h.seedProposal(p2);
      /** The confirmation of `p` as the page draws it; `input` is what changed since it was drawn. */
      const create = (
        p: ProposalRecord,
        input: Partial<{ start: string; end: string; email: string; personId: string }> = {},
      ): CalendarItem => ({
        id: 'create:' + p.id,
        proposalId: p.id,
        personId: input.personId ?? p.participant.personId,
        label: p.participant.name,
        action: 'create',
        input: {
          title: 'Utvecklingssamtal',
          start: input.start ?? p.start,
          end: input.end ?? p.end,
          participants: [input.email ?? p.participant.email.toUpperCase()],
        },
      });
      const followup = { afterWorkdays: 2, maxReminders: 2, expiresAt: '2099-12-01T00:00:00.000Z' };
      const confirm = (items: CalendarItem[], extra: Partial<CalendarCommand> = {}) =>
        on(h, card, {
          connector: 'calendar',
          operation: 'calendar.confirmProposals',
          payload: { threadId: card, items, followup, ...extra } satisfies CalendarCommand,
        });
      return { card, p1, p2, create, confirm, followup };
    }

    test('a confirmation of drawn times is checked against each proposal and the fixed follow-up, and holds an invitee another manager is inviting (M1); each refusal writes nothing', async () => {
      const h = await make();
      const { card, p1, p2, create, confirm } = await planning(h);
      await expect(approve(h, confirm([create(p1, { start: '2099-11-11T09:30:00.000Z' })]))).rejects.toThrow(
        'Förslaget har ändrats. Läs om sidan.',
      );
      await expect(approve(h, confirm([create(p1, { email: 'someone@example.test' })]))).rejects.toThrow(
        'Förslaget har ändrats. Läs om sidan.',
      );
      await expect(
        approve(h, confirm([create(p1)], { followup: { afterWorkdays: 2, maxReminders: 3, expiresAt: later } })),
      ).rejects.toThrow('Ogiltig uppföljningsplan.');
      // Another manager's invitation to the second invitee, approved and still on its way.
      const theirs = `${h.prefix}-theirs`;
      await h.seedCard({ id: theirs, personId: h.otherId, connector: 'calendar' });
      const sending: Execution = {
        ...executionRecord(h.otherId, `${h.prefix}-sending`),
        decisionId: `decision:${h.prefix}-sending`,
        state: 'pending',
        createdAt: projectionAt,
        updatedAt: projectionAt,
        expiresAt: '2099-11-06T10:00:00.000Z',
      };
      await h.store.transaction(tx => tx.insert(sending));
      await h.seedProposal(
        { ...p2, id: `${h.prefix}-q2`, threadId: theirs, personId: h.otherId, participant: p2.participant },
        sending.id,
      );
      await expect(approve(h, confirm([create(p1), create(p2)]))).rejects.toThrow(invitingSentence(['Gäst 2']));
      expect((await h.proposal(p1.id))?.executionId).toBeNull();
      expect(await h.policy(card)).toBeUndefined();
      expect(await h.timer('obligation:' + card)).toBeUndefined();
      expect(await h.audit('thread:' + card)).toEqual([]);
      // Once theirs has failed, the invitee is free.
      await h.store.transaction(async tx => tx.update({ ...sending, state: 'failed', updatedAt: later }));
      const e = confirm([create(p1), create(p2)]);
      await approve(h, e);
      expect((await h.proposal(p1.id))?.executionId).toBe(e.id);
      expect((await h.proposal(p2.id))?.executionId).toBe(e.id);
    });

    test('each confirmed proposal must still be proposed, on this card, at the approved start and end and for the approved invitee; each refusal writes nothing', async () => {
      const h = await make();
      const { card, p1, create, confirm } = await planning(h);
      // Already booked, or given way to a replacement, since the page drew it.
      for (const status of ['confirmed', 'superseded'] as const) {
        const settled = { ...p1, id: `${h.prefix}-${status}`, status };
        await h.seedProposal(settled);
        await expect(approve(h, confirm([create(settled)]))).rejects.toThrow('Förslaget har ändrats. Läs om sidan.');
      }
      // Another invitee than the one it was drawn for, the same address.
      await expect(approve(h, confirm([create(p1, { personId: `${h.prefix}-guest9` })]))).rejects.toThrow(
        'Förslaget har ändrats. Läs om sidan.',
      );
      // Its time moved since the page drew it: the start, and the end alone.
      await expect(approve(h, confirm([create(p1, { start: '2099-11-11T08:30:00.000Z' })]))).rejects.toThrow(
        'Förslaget har ändrats. Läs om sidan.',
      );
      await expect(approve(h, confirm([create(p1, { end: '2099-11-11T10:30:00.000Z' })]))).rejects.toThrow(
        'Förslaget har ändrats. Läs om sidan.',
      );
      // The manager's own proposal, drawn on another of their cards.
      const elsewhere = `${h.prefix}-plan-2`;
      await h.seedCard({ id: elsewhere, personId: h.personId, connector: 'calendar' });
      const theirs = { ...p1, id: `${h.prefix}-elsewhere`, threadId: elsewhere };
      await h.seedProposal(theirs);
      await expect(approve(h, confirm([create(theirs)]))).rejects.toThrow('Förslaget har ändrats. Läs om sidan.');
      expect((await h.card(card))?.execution ?? null).toBeNull();
      for (const id of [p1.id, `${h.prefix}-confirmed`, `${h.prefix}-superseded`, theirs.id])
        expect((await h.proposal(id))?.executionId).toBeNull();
      expect(await h.policy(card)).toBeUndefined();
      expect(await h.timer('obligation:' + card)).toBeUndefined();
      expect(await h.audit('thread:' + card)).toEqual([]);
      // As drawn, the same confirmation lands.
      await approve(h, confirm([create(p1)]));
      expect((await h.card(card))?.execution?.state).toBe('pending');
    });

    test('a result read again settles each invitation once: the proposal stays as booked and the talks domain is told once', async () => {
      const h = await make();
      const { p1, create, confirm } = await planning(h);
      const e = confirm([create(p1)]);
      await approve(h, e);
      const result = done('create:' + p1.id, { ref: 'event-1', revision: 'r1', uid: 'uid-1' });
      await settle(h, e, { state: 'succeeded', dispatchedAt: dispatched, result });
      const booked = await h.proposal(p1.id);
      expect(booked).toMatchObject({ status: 'confirmed', eventRef: 'event-1', confirmedAt: dispatched });
      // A check of the same execution reads the same answer later.
      await settle(h, e, {
        state: 'succeeded',
        dispatchedAt: '2099-11-05T10:02:00.000Z',
        updatedAt: '2099-11-05T10:07:00.000Z',
        result,
      });
      expect(await h.proposal(p1.id)).toEqual(booked);
      expect((await h.told()).map(t => [t.kind, t.notice.invitationId])).toEqual([['established', p1.id]]);
    });

    test('an approved confirmation starts the fixed follow-up with its obligation timer; its result books the invitations, and an approved undo ends the follow-up and makes them proposed times again', async () => {
      const h = await make();
      const { card, p1, create, confirm, followup } = await planning(h);
      const e = confirm([create(p1)]);
      await approve(h, e);
      expect(await h.policy(card)).toEqual({
        threadId: card,
        personId: h.personId,
        unitId: e.unitId,
        authorizationVersion: e.authorizationVersion,
        executionId: e.id,
        proposalIds: [p1.id],
        maxReminders: 2,
        afterWorkdays: 2,
        expiresAt: followup.expiresAt,
        state: 'active',
        reason: null,
      });
      expect(await h.timer('obligation:' + card)).toMatchObject({
        kind: 'obligation',
        personId: h.personId,
        threadId: card,
        generation: 1,
        state: 'active',
      });
      expect(Date.parse((await h.timer('obligation:' + card))!.dueAt)).toBe(Date.parse(nextCheck(projectionAt)));
      expect((await h.audit('thread:' + card)).map(a => a.action)).toEqual([
        'obligation.policy_approved',
        'thread.decision_approved',
      ]);
      expect((await h.audit('thread:' + card))[0]).toEqual({
        actor: e.principal,
        action: 'obligation.policy_approved',
        details: { executionId: e.id, maxReminders: 2, afterWorkdays: 2, expiresAt: followup.expiresAt },
      });
      const source = { ref: 'event-1', revision: 'r1', uid: 'uid-1', icalUid: 'ical-1' };
      await settle(h, e, { state: 'succeeded', dispatchedAt: dispatched, result: done('create:' + p1.id, source) });
      const undoUntil = '2099-11-05T10:11:00.000Z';
      expect(await h.proposal(p1.id)).toMatchObject({
        status: 'confirmed',
        eventUid: 'uid-1',
        eventRef: 'event-1',
        eventRevision: 'r1',
        eventIcalUid: 'ical-1',
        confirmedAt: dispatched,
        undoUntil,
      });
      expect(await h.card(card)).toMatchObject({
        state: 'open',
        handledAt: null,
        waitingOn: 'svar från medarbetarna',
        execution: { id: e.id, state: 'succeeded' },
      });
      expect((await h.jobs(`receipt-final:${e.id}`)).map(j => j.id)).toEqual([`receipt-final:${e.id}`]);
      expect((await h.jobs(`undo-expiry:${e.id}`)).map(j => [j.id, j.runAt])).toEqual([
        [`undo-expiry:${e.id}`, undoUntil],
      ]);
      expect(await h.told()).toEqual([
        {
          kind: 'established',
          notice: {
            actor: 'system:execution',
            invitationId: p1.id,
            managerId: h.personId,
            employeeId: p1.participant.personId,
            start: p1.start,
            end: p1.end,
            at: later,
          },
        },
      ]);

      const undo = on(h, card, {
        version: (await h.card(card))!.updatedAt,
        connector: 'calendar',
        operation: 'calendar.cancelEvent',
        compensates: e.id,
        payload: {
          threadId: card,
          items: [
            {
              id: 'cancel:' + p1.id,
              proposalId: p1.id,
              label: 'Gäst 1',
              action: 'cancel',
              ref: 'event-1',
              revision: 'r1',
            },
          ],
        } satisfies CalendarCommand,
      });
      await approve(h, undo);
      expect(await h.policy(card)).toMatchObject({ state: 'cancelled', reason: 'compensation-approved' });
      expect(await h.timer('obligation:' + card)).toMatchObject({ state: 'cancelled', generation: 1 });
      await settle(h, undo, { state: 'succeeded', dispatchedAt: later, result: done('cancel:' + p1.id) });
      expect(await h.proposal(p1.id)).toMatchObject({
        status: 'proposed',
        eventUid: null,
        eventRef: null,
        eventRevision: null,
        eventIcalUid: null,
        confirmedAt: null,
        undoUntil: null,
      });
      expect((await h.told()).at(-1)).toEqual({
        kind: 'ended',
        notice: { actor: 'system:execution', invitationId: p1.id, why: 'undone', at: later },
      });
      expect(await h.card(card)).toMatchObject({ state: 'open', receipt: null, waitingOn: null });
    });

    test('a calendar decision makes its own card; a meeting it moves or cancels takes the talk invitation found by its event along (D133)', async () => {
      const h = await make();
      const { card, p1 } = await planning(h);
      await h.seedProposal({
        ...p1,
        id: `${h.prefix}-booked`,
        status: 'confirmed',
        eventRef: 'event-9',
        eventRevision: 'r1',
      });
      const decision = `${h.prefix}-decision`;
      const move: CalendarItem = {
        id: 'move:1',
        label: 'Utvecklingssamtal',
        action: 'move',
        ref: 'event-9',
        revision: 'r1',
        start: '2099-11-11T13:00:00Z',
        end: '2099-11-11T14:00:00Z',
        before: { start: p1.start, end: p1.end },
      };
      const e = on(h, decision, {
        connector: 'calendar',
        operation: 'calendar.rescheduleEvent',
        newTitle: 'Flytta utvecklingssamtal',
        payload: { items: [move] } satisfies CalendarCommand,
      });
      await approve(h, e);
      expect(await h.card(decision)).toMatchObject({
        kind: 'pushed',
        topic: `calendar-decision:${e.decisionId}`,
        title: 'Flytta utvecklingssamtal',
        state: 'open',
        connector: 'calendar',
        area: 'calendar',
        summary: 'Beslutet är sparat. Väntar på kalenderns besked.',
        waitingOn: 'källans besked',
        sourceAuthorization: e.authorizationVersion,
        execution: { id: e.id, state: 'pending' },
      });
      await settle(h, e, {
        state: 'succeeded',
        dispatchedAt: dispatched,
        result: {
          headline: 'Flyttad',
          rows: [
            {
              ref: 'move:1',
              label: 'Möte',
              outcome: 'done',
              detail: 'Flyttad',
              source: { ref: 'event-9b', revision: 'r2' },
            },
          ],
        },
      });
      expect(await h.proposal(`${h.prefix}-booked`)).toMatchObject({
        status: 'confirmed',
        start: '2099-11-11T13:00:00.000Z',
        end: '2099-11-11T14:00:00.000Z',
        eventRef: 'event-9b',
        eventRevision: 'r2',
      });
      expect(await h.audit('thread:' + card)).toEqual([
        {
          actor: 'system:execution',
          action: 'proposals.moved',
          details: {
            proposal: `${h.prefix}-booked`,
            start: move.start,
            end: move.end,
            by: 'decision',
            executionId: e.id,
          },
        },
      ]);
      // Read again, the move is already as decided: nothing more is written.
      await settle(h, e, {
        state: 'succeeded',
        dispatchedAt: dispatched,
        result: { headline: 'Flyttad', rows: [{ ref: 'move:1', label: 'Möte', outcome: 'done', detail: 'Flyttad' }] },
      });
      expect(await h.audit('thread:' + card)).toHaveLength(1);
      expect(await h.card(decision)).toMatchObject({ state: 'handled', execution: { state: 'succeeded' } });

      const cancel = on(h, `${h.prefix}-decision-2`, {
        connector: 'calendar',
        operation: 'calendar.cancelEvent',
        newTitle: 'Ställ in utvecklingssamtal',
        payload: { items: [{ id: 'cancel:1', label: 'Möte', action: 'cancel', ref: 'event-9b', revision: 'r2' }] },
      });
      await approve(h, cancel);
      await settle(h, cancel, {
        state: 'succeeded',
        dispatchedAt: dispatched,
        result: {
          headline: 'Inställt',
          rows: [{ ref: 'cancel:1', label: 'Möte', outcome: 'done', detail: 'Inställt' }],
        },
      });
      expect(await h.proposal(`${h.prefix}-booked`)).toMatchObject({ status: 'undone', undoUntil: null });
      expect((await h.audit('thread:' + card)).at(-1)).toEqual({
        actor: 'system:execution',
        action: 'proposals.cancelled',
        details: { proposal: `${h.prefix}-booked`, kept: false, by: 'decision', executionId: cancel.id },
      });
      expect((await h.told()).map(t => [t.kind, t.notice.invitationId])).toEqual([
        ['moved', `${h.prefix}-booked`],
        ['ended', `${h.prefix}-booked`],
      ]);
    });

    test('a calendar decision whose card id is taken already is refused, and nothing is written on the card there', async () => {
      const h = await make();
      const taken = `${h.prefix}-decision`;
      await h.seedCard({ id: taken, personId: h.personId, connector: 'calendar' });
      const e = on(h, taken, {
        connector: 'calendar',
        operation: 'calendar.cancelEvent',
        newTitle: 'Ställ in mötet',
        payload: { items: [{ id: 'cancel:1', label: 'Möte', action: 'cancel', ref: 'event-1', revision: 'r1' }] },
      });
      await expect(approve(h, e)).rejects.toThrow(`The calendar decision card ${taken} already exists.`);
      expect(await h.store.read(e.id)).toBeUndefined();
      expect(await h.card(taken)).toMatchObject({ title: 'Synthetic card', state: 'open', waitingOn: null });
      expect((await h.card(taken))?.execution ?? null).toBeNull();
      expect(await h.audit('thread:' + taken)).toEqual([]);
    });

    test('a throw after the projection in the ledger’s transaction rolls the card, the policy, the timer and the audit rows back with the execution', async () => {
      const h = await make();
      const { card, p1, create, confirm } = await planning(h);
      const e = confirm([create(p1)]);
      await expect(
        h.store.transaction(async tx => {
          await tx.insert(e);
          throw new Error('crash');
        }),
      ).rejects.toThrow('crash');
      expect(await h.store.read(e.id)).toBeUndefined();
      expect((await h.card(card))?.execution ?? null).toBeNull();
      expect((await h.proposal(p1.id))?.executionId).toBeNull();
      expect(await h.policy(card)).toBeUndefined();
      expect(await h.timer('obligation:' + card)).toBeUndefined();
      expect(await h.audit('thread:' + card)).toEqual([]);
    });
  });
}
