import { expect, test } from 'bun:test';
import type { AuthenticatedContext, Thread } from '../packages/contracts/src';
import type { Team } from '../apps/server/src/modules/calendar/model';
import {
  followupUsecases,
  type FollowupSnapshot,
  type FollowupStore,
  type FollowupTx,
} from '../apps/server/src/modules/calendar/usecases/followups';

export const followupAt = '2026-11-04T09:00:00.000Z';
export function followupFixture(id: string): FollowupSnapshot {
  return {
    thread: {
      id,
      kind: 'pushed',
      topic: id,
      connector: 'calendar',
      area: 'calendar',
      title: 'Test',
      state: 'open',
      week: '2026-11-02',
      summary: '',
      trigger: { reason: '', source: 'calendar', at: followupAt },
      items: [],
      actions: [],
      messages: [],
      proposals: [],
      waitingOn: 'svar',
      deadline: null,
      receipt: null,
      createdAt: followupAt,
      updatedAt: followupAt,
      handledAt: null,
      snoozedUntil: null,
      remindedAt: null,
    },
    policy: {
      threadId: id,
      personId: id,
      unitId: 'test',
      authorizationVersion: 'v1',
      executionId: id,
      proposalIds: [id + ':proposal'],
      maxReminders: 2,
      afterWorkdays: 2,
      expiresAt: '2026-12-01T00:00:00.000Z',
      state: 'active',
      reason: null,
    },
    timer: { generation: 1, dueAt: followupAt, state: 'active' },
    proposals: [
      {
        id: id + ':proposal',
        threadId: id,
        personId: id,
        status: 'final',
        participant: { personId: id + ':invitee', email: 'invitee@example.test', name: 'Invitee' },
        start: '2026-11-09T10:00:00Z',
        end: '2026-11-09T11:00:00Z',
        eventRef: 'test',
        eventRevision: 'v1',
        eventUid: 'test',
        confirmedAt: '2026-11-02T08:00:00.000Z',
        undoUntil: null,
        reminders: 0,
        remindedAt: null,
      },
    ],
  };
}
type Harness = {
  id: string;
  store: FollowupStore;
  deliveries(): Promise<number>;
  /** The reminder cards in the invitees' streams: whose, and what they say. */
  delivered(): Promise<Array<{ id: string; personId: string; title: string; summary: string; trigger: unknown }>>;
  /** The manager's card as stored. */
  card(): Promise<Pick<Thread, 'state' | 'handledAt' | 'waitingOn' | 'summary' | 'updatedAt'>>;
  audits(): Promise<string[]>;
  /** The details of the audit rows of one action about `subject` (the thread by default), oldest first. */
  details(action: string, subject?: string): Promise<unknown[]>;
};
/** `answered`: the invitee has accepted, so nobody is waiting. */
export function followupContract(name: string, make: (options?: { answered?: boolean }) => Promise<Harness>) {
  const build = (
    h: Harness,
    version = 'v1',
    at = followupAt,
    email = 'invitee@example.test',
    unreadable: { replies?: boolean; team?: boolean } = {},
  ) => {
    const actor = {
      id: h.id,
      name: 'Sender',
      unitId: 'test',
      authorizationVersion: version,
      principal: { id: 'person:' + h.id },
      authorize: async () => ({ version }),
    } as AuthenticatedContext;
    const team: Team = async () => {
      if (unreadable.team) throw new Error('directory unavailable');
      return [
        {
          personId: h.id + ':invitee',
          ref: 'mailto:' + email,
          email,
          name: 'Invitee',
        },
      ];
    };
    return {
      actor,
      uc: followupUsecases({
        store: h.store,
        current: async () => actor,
        team,
        clock: () => new Date(at),
        readReplies: async () => {
          if (unreadable.replies) throw new Error('calendar unavailable');
        },
      }),
    };
  };
  test(name + ': concurrent fires commit one invitee card, ordinal, next timer and audit', async () => {
    const h = await make(),
      { uc } = build(h);
    await Promise.all([uc.fire(h.id, 1), uc.fire(h.id, 1)]);
    expect(await h.deliveries()).toBe(1);
    expect((await h.store.read(h.id))?.proposals[0]?.reminders).toBe(1);
    expect((await h.store.read(h.id))?.timer).toMatchObject({ generation: 2, state: 'active' });
    expect((await h.audits()).filter(x => x === 'obligation.checked')).toHaveLength(1);
  });
  test(name + ': audit failure rolls back invitee delivery, ordinal and timer', async () => {
    const h = await make(),
      faulty = {
        ...h,
        store: {
          ...h.store,
          transaction: <T>(fn: (tx: FollowupTx) => Promise<T>) =>
            h.store.transaction(tx =>
              fn({
                ...tx,
                async audit() {
                  throw new Error('audit unavailable');
                },
              }),
            ),
        },
      };
    await expect(build(faulty).uc.fire(h.id, 1)).rejects.toThrow('audit unavailable');
    expect(await h.deliveries()).toBe(0);
    expect((await h.store.read(h.id))?.proposals[0]?.reminders).toBe(0);
    expect((await h.store.read(h.id))?.timer?.generation).toBe(1);
  });
  test(name + ': authority removal blocks automatic delivery and cancelled policies stay cancelled', async () => {
    const h = await make();
    await build(h, 'v2').uc.fire(h.id, 1);
    expect((await h.store.read(h.id))?.policy).toMatchObject({ state: 'blocked', reason: 'authority-revoked' });
    expect(await h.deliveries()).toBe(0);
    await h.store.transaction(async tx => {
      const s = (await tx.load(h.id))!;
      await tx.save({ ...s.policy!, state: 'cancelled' });
    });
    await expect(build(h).uc.remindNow(build(h).actor, h.id)).rejects.toThrow();
    expect(await h.deliveries()).toBe(0);
  });
  test(name + ': an invitee whose address changed since the invitation is reminded, found by id (N3)', async () => {
    const h = await make(),
      moved = 'invitee.new@example.test';
    await build(h, 'v1', followupAt, moved).uc.fire(h.id, 1);
    expect(await h.deliveries()).toBe(1);
    expect((await h.store.read(h.id))?.proposals[0]).toMatchObject({
      reminders: 1,
      participant: { personId: h.id + ':invitee', email: 'invitee@example.test' },
    });
    const { uc, actor } = build(h, 'v1', followupAt, moved);
    await uc.remindNow(actor, h.id);
    expect(await h.deliveries()).toBe(2);
    expect((await h.audits()).filter(x => x === 'obligation.reminded')).toHaveLength(1);
  });
  test(
    name +
      ': a check that cannot read the replies or the team schedules the next one and still returns the thread at its end (DE-L1)',
    async () => {
      const h = await make();
      // Neither can be read: no reminder is sent, and the follow-up goes on to its next check instead of ending here.
      await build(h, 'v1', followupAt, undefined, { replies: true, team: true }).uc.fire(h.id, 1);
      expect(await h.deliveries()).toBe(0);
      expect((await h.store.read(h.id))?.timer).toMatchObject({ generation: 2, state: 'active' });
      expect(await h.details('obligation.checked')).toEqual([
        expect.objectContaining({ generation: 1, delivered: [], unread: ['replies', 'team'] }),
      ]);
      // The replies cannot be read at the policy's end either: the thread still comes back to the manager.
      await build(h, 'v1', '2026-12-02T09:00:00.000Z', undefined, { replies: true }).uc.fire(h.id, 2);
      expect((await h.store.read(h.id))?.policy).toMatchObject({ state: 'finished', reason: 'expired' });
    },
  );
  test(name + ': the bound applies to manual reminders too; expiry cannot loop behind an unknown outcome', async () => {
    const h = await make(),
      { uc, actor } = build(h);
    await uc.remindNow(actor, h.id);
    await uc.remindNow(actor, h.id);
    await expect(uc.remindNow(actor, h.id)).rejects.toThrow();
    expect(await h.deliveries()).toBe(2);
    await build(h, 'v1', '2026-12-02T09:00:00.000Z').uc.fire(h.id, 1);
    expect((await h.store.read(h.id))?.policy).toMatchObject({ state: 'finished', reason: 'expired' });
  });
  test(
    name + ': a reminder is the invitee’s own card, once per proposal and ordinal, with its thread.pushed row',
    async () => {
      const h = await make();
      await build(h).uc.fire(h.id, 1);
      const card = `followup:${h.id}:proposal:1`;
      expect(await h.delivered()).toEqual([
        {
          id: card,
          personId: h.id + ':invitee',
          title: 'Svara på inbjudan till utvecklingssamtal',
          summary: 'Sender väntar på ditt svar om utvecklingssamtalet. Svara i din kalender.',
          trigger: { reason: 'Inbjudan väntar på svar · påminnelse 1 av 2', source: 'Kalendern', at: followupAt },
        },
      ]);
      expect(await h.details('thread.pushed', 'thread:' + card)).toEqual([
        { proposal: h.id + ':proposal', ordinal: 1, owner: h.id + ':invitee' },
      ]);
    },
  );
  test(
    name +
      ': a return writes the manager’s card and stops the timer: lost authority and the policy’s end bring it back open with why',
    async () => {
      const h = await make();
      await build(h, 'v2').uc.fire(h.id, 1);
      expect(await h.card()).toEqual({
        state: 'open',
        handledAt: null,
        waitingOn: null,
        updatedAt: followupAt,
        summary: 'Uppföljningen behöver din bedömning. Den godkända planen är avslutad.',
      });
      expect((await h.store.read(h.id))?.timer).toMatchObject({ generation: 1, state: 'cancelled' });
      const ended = await make(),
        end = '2026-12-02T09:00:00.000Z';
      await build(ended, 'v1', end).uc.fire(ended.id, 1);
      expect(await ended.card()).toMatchObject({ state: 'open', handledAt: null, waitingOn: null, updatedAt: end });
      expect((await ended.store.read(ended.id))?.timer?.state).toBe('cancelled');
    },
  );
  test(name + ': with every invitation answered, the return hands the card back handled', async () => {
    const h = await make({ answered: true });
    await build(h).uc.fire(h.id, 1);
    expect(await h.card()).toEqual({
      state: 'handled',
      handledAt: followupAt,
      waitingOn: null,
      updatedAt: followupAt,
      summary: 'Alla inbjudningar har besvarats.',
    });
    expect((await h.store.read(h.id))?.policy).toMatchObject({ state: 'finished' });
    expect((await h.store.read(h.id))?.timer?.state).toBe('cancelled');
    expect(await h.details('obligation.returned')).toEqual([{ generation: 1, waiting: 0 }]);
    expect(await h.deliveries()).toBe(0);
  });
}
