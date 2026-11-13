import { expect, test } from 'bun:test';
import type { AuthenticatedContext } from '../packages/contracts/src';
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
type Harness = { id: string; store: FollowupStore; deliveries(): Promise<number>; audits(): Promise<string[]> };
export function followupContract(name: string, make: () => Promise<Harness>) {
  const build = (h: Harness, version = 'v1', at = followupAt, email = 'invitee@example.test') => {
    const actor = {
      id: h.id,
      name: 'Sender',
      unitId: 'test',
      authorizationVersion: version,
      principal: { id: 'person:' + h.id },
      authorize: async () => ({ version }),
    } as AuthenticatedContext;
    const team: Team = async () => [
      {
        personId: h.id + ':invitee',
        ref: 'mailto:' + email,
        email,
        name: 'Invitee',
      },
    ];
    return {
      actor,
      uc: followupUsecases({
        store: h.store,
        current: async () => actor,
        team,
        clock: () => new Date(at),
        readReplies: async () => {},
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
}
