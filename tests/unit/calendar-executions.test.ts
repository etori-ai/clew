import { expect, test } from 'bun:test';
import type { AuthenticatedContext } from '../../packages/contracts/src';
import { memoryCalendar, occurrence } from '../../packages/calendar/src/memory';
import {
  calendarExecutionSource,
  type CalendarCommand,
} from '../../apps/server/src/modules/calendar/usecases/decisions';
import type { UnitMember } from '../../apps/server/src/modules/calendar/model';
import type { BookedInRound } from '../../apps/server/src/modules/calendar/usecases/booked';
import { memoryExecutionStore } from '../../apps/server/src/modules/executions/adapters/memory';
import { executionUsecases } from '../../apps/server/src/modules/executions/usecases';
import { createHash } from 'node:crypto';

const at = '2026-11-05T12:00:00.000Z';
const person: AuthenticatedContext = {
  id: 'a',
  name: 'A',
  role: 'manager',
  unitId: 'unit',
  unitLabel: 'Unit',
  organisationId: 'org',
  principal: { id: 'person:a', kind: 'person' },
  capabilities: [],
  authorizationVersion: '1',
  sessionBinding: 'test',
  expiresAt: '2099-01-01T00:00:00.000Z',
  async authorize() {
    return { version: '1' };
  },
};
const input = {
  title: 'Samtal',
  start: '2026-11-10T10:00:00.000Z',
  end: '2026-11-10T11:00:00.000Z',
  participants: ['guest@clew.test'],
};
const command = (): CalendarCommand => ({
  items: [{ id: 'p1', proposalId: 'p1', label: 'Guest', action: 'create', input }],
});
const guest: UnitMember = { ref: 'guest', personId: 'guest', email: 'guest@clew.test', name: 'Guest' };
function world(team: UnitMember[] = [guest], booked: BookedInRound = async () => new Set()) {
  let n = 0,
    now = Date.parse(at);
  const provider = memoryCalendar({ ref: 'a', email: 'a@clew.test', name: 'A' });
  const source = {
    ...calendarExecutionSource(
      () => ({ provider }),
      async () => team,
      booked,
    ),
    current: async () => person,
  };
  const store = memoryExecutionStore();
  const uc = executionUsecases({
    store,
    source,
    clock: () => new Date(now),
    ids: () => `e${++n}`,
    digest: x => createHash('sha256').update(JSON.stringify(x)).digest('hex'),
  });
  return {
    provider,
    store,
    source,
    uc,
    advance: (ms: number) => {
      now += ms;
    },
    approve: (payload = command()) =>
      uc.approve(person, { decisionId: 'confirm', operation: 'calendar.confirmProposals', payload }),
  };
}
test('approval and audit are durable before any invitation is sent; duplicate approvals share one key', async () => {
  const w = world();
  const [a, b] = await Promise.all([w.approve(), w.approve()]);
  expect(a.id).toBe(b.id);
  expect(w.provider.events).toEqual([]);
  expect(w.store.audit().map(x => x.action)).toEqual(['execution.approved']);
  await w.uc.progress(a.id);
  await w.uc.progress(b.id);
  expect(w.provider.events).toHaveLength(1);
  expect(w.provider.events[0]?.uid).toBe('clew-exec-e1-p1');
  expect(await w.uc.read(person, a.id)).toMatchObject({
    state: 'succeeded',
    result: { rows: [{ ref: 'p1', outcome: 'done' }] },
  });
});
test('a reply lost after commit is read back with its exact cancellation revision', async () => {
  const w = world(),
    create = w.provider.create.bind(w.provider);
  w.provider.create = async (uid, value) => {
    await create(uid, value);
    throw new Error('lost');
  };
  const e = await w.approve();
  await w.uc.progress(e.id);
  expect(await w.uc.read(person, e.id)).toMatchObject({
    state: 'succeeded',
    result: { undoInput: { items: [{ ref: 'memory:clew-exec-e1-p1', revision: 'r1' }] } },
  });
  expect(w.provider.events).toHaveLength(1);
});
test('partial source failure retains each item and never marks an unknown invitation confirmed', async () => {
  const w = world(),
    create = w.provider.create.bind(w.provider);
  w.provider.create = async (uid, value) => {
    if (uid.endsWith('p2')) throw new Error('away');
    return create(uid, value);
  };
  const payload = command();
  payload.items.push({
    ...payload.items[0]!,
    id: 'p2',
    proposalId: 'p2',
    label: 'Other',
    action: 'create',
    input: { ...input, start: '2026-11-10T13:00:00.000Z', end: '2026-11-10T14:00:00.000Z' },
  });
  const e = await w.approve(payload);
  await w.uc.progress(e.id);
  expect(await w.uc.read(person, e.id)).toMatchObject({
    state: 'unknown',
    result: { rows: [{ outcome: 'done' }, { outcome: 'unknown' }] },
  });
  await w.uc.progress(e.id);
  expect(w.provider.events).toHaveLength(1);
});
test('missing availability evidence does not authorize an invitation', async () => {
  const w = world();
  w.provider.freeBusy = async () => [];
  const e = await w.approve();
  await w.uc.progress(e.id);
  expect(w.provider.events).toEqual([]);
  expect(await w.uc.read(person, e.id)).toMatchObject({ state: 'unknown' });
  expect(w.store.audit().some(a => a.action === 'execution.approved')).toBe(true);
});
test('a proposal whose invitee changed address since the draw is authorized and checked by id, and sent to the address it was drawn with (N3)', async () => {
  // The directory has Guest at a new address now; the approved command keeps the one the proposal was drawn with.
  const w = world([{ ...guest, ref: 'guest-new', email: 'guest.new@clew.test' }]);
  const asked: string[] = [];
  const freeBusy = w.provider.freeBusy.bind(w.provider);
  w.provider.freeBusy = async (start, end, targets) => {
    asked.push(...targets.map(t => t.ref));
    return freeBusy(start, end, targets);
  };
  const confirm = (decisionId: string, item: Partial<CalendarCommand['items'][number]>) =>
    w.uc.approve(person, {
      decisionId,
      operation: 'calendar.confirmProposals',
      payload: { items: [{ ...command().items[0]!, ...item } as CalendarCommand['items'][number]] },
    });
  // By address alone the old address is nobody on the team now; by id it is Guest.
  await expect(confirm('by-address', {})).rejects.toThrow('Deltagarna måste tillhöra din enhet.');
  await expect(confirm('somebody-else', { personId: 'stranger' })).rejects.toThrow(
    'Deltagarna måste tillhöra din enhet.',
  );
  const e = await confirm('by-id', { personId: 'guest' });
  await w.uc.progress(e.id);
  expect(await w.uc.read(person, e.id)).toMatchObject({
    state: 'succeeded',
    result: { rows: [{ ref: 'p1', outcome: 'done' }], undoInput: { items: [{ personId: 'guest' }] } },
  });
  expect(asked).toEqual(['guest-new']);
  expect(w.provider.events[0]?.participants.map(p => p.email)).toEqual(['guest@clew.test']);
});
test('a declined invitation is retired only once the new one for the same person is established, not for a namesake (N3)', async () => {
  const w = world([guest, { ...guest, personId: 'namesake', ref: 'namesake', email: 'namesake@clew.test' }]);
  const old = occurrence(
    { uid: 'old', title: 'Utvecklingssamtal · Guest', start: input.start, end: input.end },
    w.provider.account,
  );
  w.provider.events.push(old);
  // Two people share a name: the namesake's invitation is established, and Guest's old one stays until Guest's is.
  const payload: CalendarCommand = {
    items: [
      {
        id: 'p2',
        proposalId: 'p2',
        personId: 'namesake',
        label: 'Guest',
        action: 'create',
        input: {
          ...input,
          start: '2026-11-11T10:00:00.000Z',
          end: '2026-11-11T11:00:00.000Z',
          participants: ['namesake@clew.test'],
        },
      },
      {
        id: 'replace:p0',
        proposalId: 'p0',
        personId: 'guest',
        label: 'Guest',
        action: 'cancel',
        ref: old.ref,
        revision: old.revision,
      },
    ],
  };
  const e = await w.approve(payload);
  await w.uc.progress(e.id);
  expect((await w.uc.read(person, e.id))?.result?.rows.map(r => [r.ref, r.outcome])).toEqual([
    ['p2', 'done'],
    ['replace:p0', 'skipped'],
  ]);
  expect(w.provider.events.map(x => x.uid).sort()).toEqual(['clew-exec-e1-p2', 'old']);
});
test('an invitation to a person another manager booked after the approval is not sent, and a later check keeps it unsent (M1, Q12)', async () => {
  const other: UnitMember = { personId: 'other', ref: 'other', email: 'other@clew.test', name: 'Other' };
  const asked: string[][] = [];
  const w = world([guest, other], async (_p, ids) => {
    asked.push([...ids]);
    return new Set(['guest']);
  });
  const create = w.provider.create.bind(w.provider);
  w.provider.create = async (uid, value) => {
    if (uid.endsWith('p2')) throw new Error('away');
    return create(uid, value);
  };
  const e = await w.approve({
    items: [
      { ...command().items[0]!, personId: 'guest' },
      {
        id: 'p2',
        proposalId: 'p2',
        personId: 'other',
        label: 'Other',
        action: 'create',
        input: {
          ...input,
          start: '2026-11-10T13:00:00.000Z',
          end: '2026-11-10T14:00:00.000Z',
          participants: ['other@clew.test'],
        },
      },
    ],
  });
  await w.uc.progress(e.id);
  // Asked once, for everyone the command invites, right before sending; Guest's invitation is never sent.
  expect(asked).toEqual([['guest', 'other']]);
  expect(w.provider.events).toEqual([]);
  expect(await w.uc.read(person, e.id)).toMatchObject({
    state: 'unknown',
    result: {
      rows: [
        { ref: 'p1', outcome: 'skipped', detail: 'Guest har redan ett utvecklingssamtal bokat med en annan chef.' },
        { ref: 'p2', outcome: 'unknown' },
      ],
    },
  });
  // Checking the unknown one again reads back and keeps Guest's row as it was: it neither sends it nor calls it unknown.
  await w.uc.progress(e.id);
  expect(w.provider.events).toEqual([]);
  expect((await w.uc.read(person, e.id))?.result?.rows.map(r => [r.ref, r.outcome])).toEqual([
    ['p1', 'skipped'],
    ['p2', 'unknown'],
  ]);
  expect(asked).toHaveLength(1);
  // A booking that invites nobody by id, an ordinary meeting, is never asked about.
  const plain = await w.uc.approve(person, {
    decisionId: 'plain',
    operation: 'calendar.createEvent',
    payload: command(),
  });
  await w.uc.progress(plain.id);
  expect(asked).toHaveLength(1);
  expect(w.provider.events).toHaveLength(1);
});
test('an invitation is not sent when it cannot be told whether another manager booked the person (M1)', async () => {
  const w = world([guest], async () => {
    throw new Error('round unavailable');
  });
  const e = await w.approve({ items: [{ ...command().items[0]!, personId: 'guest' }] });
  await w.uc.progress(e.id);
  expect(w.provider.events).toEqual([]);
  expect(await w.uc.read(person, e.id)).toMatchObject({
    state: 'failed',
    result: {
      rows: [
        {
          outcome: 'skipped',
          detail: 'Inbjudan skickades inte: det gick inte att se om Guest redan har ett utvecklingssamtal bokat.',
        },
      ],
    },
  });
});
test('a process crash after sending is recovered with reads only, even if some approved items never reached the source', async () => {
  const w = world(),
    e = await w.approve();
  await w.store.transaction(async tx => {
    const current = (await tx.lock(e.id))!;
    await tx.update({ ...current, state: 'running', attempt: 1, dispatchedAt: at, leaseUntil: at });
  });
  await w.uc.progress(e.id);
  expect(w.provider.events).toEqual([]);
  expect(await w.uc.read(person, e.id)).toMatchObject({ state: 'unknown' });
});
test('undo is another approved execution and refuses a changed payload or source revision', async () => {
  const w = world(),
    e = await w.approve();
  await w.uc.progress(e.id);
  const done = (await w.store.read(e.id))!,
    payload = done.result!.undoInput!;
  await expect(
    w.uc.approve(person, {
      decisionId: 'bad-undo',
      operation: 'calendar.undoProposals',
      payload: command(),
      compensates: e.id,
    }),
  ).rejects.toThrow('exakt');
  const undo = await w.uc.approve(person, {
    decisionId: 'undo',
    operation: 'calendar.undoProposals',
    payload,
    compensates: e.id,
  });
  w.provider.events[0]!.revision = 'external-change';
  await w.uc.progress(undo.id);
  expect(w.provider.events).toHaveLength(1);
  expect(await w.uc.read(person, undo.id)).toMatchObject({ state: 'unknown' });
  expect((await w.store.read(e.id))?.result).toEqual(done.result);
});
test('a lost move response is investigated, and a cancel is confirmed only by absence', async () => {
  const w = world();
  const event = occurrence({ uid: 'old', title: input.title, start: input.start, end: input.end }, w.provider.account);
  w.provider.events.push(event);
  const move = w.provider.reschedule.bind(w.provider);
  w.provider.reschedule = async (...args) => {
    await move(...args);
    throw new Error('lost');
  };
  const e = await w.uc.approve(person, {
    decisionId: 'move',
    operation: 'calendar.rescheduleEvent',
    payload: {
      items: [
        {
          id: 'old',
          label: 'Old',
          action: 'move',
          ref: event.ref,
          revision: event.revision,
          start: '2026-11-10T12:00:00.000Z',
          end: '2026-11-10T13:00:00.000Z',
          before: { start: input.start, end: input.end },
        },
      ],
    },
  });
  await w.uc.progress(e.id);
  expect(await w.uc.read(person, e.id)).toMatchObject({ state: 'succeeded' });
  const undo = await w.uc.approve(person, {
    decisionId: 'cancel',
    operation: 'calendar.cancelEvent',
    payload: { items: [{ id: 'old', label: 'Old', action: 'cancel', ref: event.ref, revision: 'r1+' }] },
  });
  await w.uc.progress(undo.id);
  expect(w.provider.events).toEqual([]);
  expect(await w.uc.read(person, undo.id)).toMatchObject({ state: 'succeeded' });
});
