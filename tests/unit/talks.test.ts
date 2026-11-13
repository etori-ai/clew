import { beforeEach, describe, expect, test } from 'bun:test';
import {
  checkContract,
  CommitmentsOutputSchema,
  EntityPageSchema,
  TalksOutputSchema,
  type AuthenticatedContext,
  type StaffOverview,
  type StaffPerson,
} from '../../packages/contracts/src/index';
import {
  fieldTone,
  markFields,
  menuEligible,
  placesOf,
  viewProblem,
  type Actor,
} from '../../packages/connectors/src/index';
import { ForbiddenError } from '../../apps/server/src/context';
import { memoryTalkStore, type MemoryTalkStore } from '../../apps/server/src/modules/talks/adapters/memory';
import {
  PersonTalksOutputSchema,
  UnitTalksOutputSchema,
  commitmentsView,
  personTalksView,
  talksConnector,
  talksView,
} from '../../apps/server/src/modules/talks/capabilities';
import {
  nextTalk,
  normaliseText,
  openWords,
  orderCommitmentRows,
  overdueWords,
  swedishDayAndMonth,
  swedishShortDay,
} from '../../apps/server/src/modules/talks/domain';
import { TalkError, talkUsecases, type TalkUsecases } from '../../apps/server/src/modules/talks/usecases';
import { Registry } from '../registry';

/**
 * The talks module's use cases (D96) on the memory adapter, with a clock, ids, a staff port and a calendar the test
 * owns: every mutation's audit row and that none carries an action point's text or a person's name; the card and the
 * action point roll back together; the reach of a manager is computed now, so a former manager reaches nothing; the
 * round carries open action points over; and the built-in connector answers through the registry.
 */
const ORG = 'org-1';
const person = (id: string, name: string, userName: string | null, enabled = true): StaffPerson => ({
  id,
  name,
  userName,
  email: null,
  role: 'employee',
  enabled,
});
const anna = person('anna', 'Anna Andersson', 'anna.a');
const bo = person('bo', 'Bo Berg', null); // provisioned without a user name: keyed on his id
const cia = person('cia', 'Cia Carlsson', 'cia.c', false); // deactivated
const dan = person('dan', 'Dan Dahl', 'dan.d');
const eve = person('eve', 'Eve Ek', 'eve.e');
const NAMES = [
  'Anna Andersson',
  'Bo Berg',
  'Cia Carlsson',
  'Dan Dahl',
  'Eve Ek',
  'Karin Chef',
  'Olle Chef',
  'Lena Chef',
];

function personaOf(id: string, role: 'manager' | 'employee', name = id): AuthenticatedContext {
  return {
    id,
    name,
    unitId: 'u1',
    unitLabel: 'Enhet 1',
    role,
    organisationId: ORG,
    principal: { id: 'person:' + id, kind: 'person' },
    capabilities: [],
    authorizationVersion: 'v1',
    sessionBinding: 'test',
    expiresAt: '2026-12-31T00:00:00.000Z',
    authorize: async () => ({ version: 'v1' }),
  };
}
const boss = personaOf('boss', 'manager', 'Karin Chef');
const other = personaOf('other', 'manager', 'Olle Chef');
/** A second manager of unit 1, given people by the tests that need two managers of one person (Q12). */
const co = personaOf('co', 'manager', 'Lena Chef');
const asAnna = personaOf('anna', 'employee', 'Anna Andersson');
const asBo = personaOf('bo', 'employee', 'Bo Berg');

let now: Date;
let n: number;
let staff: Map<string, StaffOverview>;
let bookings: ReadonlyMap<string, { at?: string }> | undefined;
let store: MemoryTalkStore;
let talks: TalkUsecases;
beforeEach(() => {
  now = new Date('2026-11-10T09:00:00.000Z');
  n = 0;
  // The manager has Anna on two units, Bo and the deactivated Cia on one, Dan on the other; and is on a unit too.
  staff = new Map([
    [
      'boss',
      {
        units: [
          { unitId: 'u1', unitLabel: 'Enhet 1', people: [anna, bo, cia, { ...person('boss', 'Karin Chef', 'boss') }] },
          { unitId: 'u2', unitLabel: 'Enhet 2', people: [{ ...anna, role: 'employee' }, dan] },
        ],
      },
    ],
    ['other', { units: [{ unitId: 'u3', unitLabel: 'Enhet 3', people: [eve] }] }],
  ]);
  bookings = new Map([['dan', { at: '2026-11-20T09:00:00.000Z' }]]);
  store = memoryTalkStore({
    persons: [...[anna, bo, cia, dan, eve], person('co', 'Lena Chef', 'lena.c')].map(p => ({
      id: p.id,
      organisationId: ORG,
      name: p.name,
      userName: p.userName,
      enabled: p.enabled !== false,
    })),
  });
  talks = talkUsecases({
    store,
    staff: async persona => staff.get(persona.id) ?? { units: [] },
    // As composition asks it: the employee is among the people on the units the manager manages now.
    manages: async (managerId, employeeId) =>
      managerId !== employeeId &&
      (staff.get(managerId)?.units ?? []).some(u => u.people.some(p => p.id === employeeId && p.enabled !== false)),
    bookings: async () => bookings,
    clock: () => now,
    ids: () => 'id-' + ++n,
  });
});
const at = () => now.toISOString();
/** The source deactivates the person: only then does an operator erase them (D123 item 3). */
const deactivate = (id: string) => store.addPerson({ ...store.state.persons.get(id)!, enabled: false });
const open = () =>
  talks.openRound('operator:cli', {
    organisationId: ORG,
    label: 'Utvecklingssamtal hösten 2026',
    opensOn: '2026-10-01',
    dueOn: '2026-11-28',
  });
/** Every audit row's text, so a test can say no text and no name is in any of them. */
const auditText = () => JSON.stringify(store.audit());

describe('the round', () => {
  test('an operator opens a round; opening the next closes it, each with its audit row', async () => {
    const first = await open();
    expect(store.audit()).toEqual([
      {
        actor: 'operator:cli',
        action: 'talks.round_opened',
        subject: 'round:' + first,
        at: at(),
        details: { organisationId: ORG, opensOn: '2026-10-01', dueOn: '2026-11-28', closed: null },
      },
    ]);
    now = new Date('2027-03-01T08:00:00.000Z');
    const second = await talks.openRound('operator:cli', {
      organisationId: ORG,
      label: '  Våren   2027 ',
      opensOn: '2027-03-01',
      dueOn: '2027-05-31',
    });
    expect(store.audit().slice(1)).toEqual([
      {
        actor: 'operator:cli',
        action: 'talks.round_closed',
        subject: 'round:' + first,
        at: at(),
        details: { organisationId: ORG },
      },
      {
        actor: 'operator:cli',
        action: 'talks.round_opened',
        subject: 'round:' + second,
        at: at(),
        details: { organisationId: ORG, opensOn: '2027-03-01', dueOn: '2027-05-31', closed: first },
      },
    ]);
    expect(store.state.rounds.get(first)?.closedAt).toBe(at());
    expect(store.state.rounds.get(second)).toMatchObject({
      label: 'Våren 2027',
      closedAt: null,
      createdBy: 'operator:cli',
    });
  });

  test('a round needs a label and a period that ends after it starts', async () => {
    const bad = (input: Partial<{ label: string; opensOn: string; dueOn: string }>) =>
      talks.openRound('operator:cli', {
        organisationId: ORG,
        label: 'Hösten',
        opensOn: '2026-10-01',
        dueOn: '2026-11-28',
        ...input,
      });
    await expect(bad({ label: '   ' })).rejects.toBeInstanceOf(TalkError);
    await expect(bad({ dueOn: '2026-02-30' })).rejects.toBeInstanceOf(TalkError);
    await expect(bad({ dueOn: '2026-09-30' })).rejects.toBeInstanceOf(TalkError);
    expect(store.audit()).toEqual([]);
  });

  test('the manager reads one row per person on the units they manage: each once, without themselves or the deactivated', async () => {
    await open();
    await talks.markHeld(boss, 'anna', { heldOn: '2026-11-03' });
    const out = await talks.round(boss);
    expect(checkContract(TalksOutputSchema, out)).toBe(true);
    expect(out.round).toEqual({ label: 'Utvecklingssamtal hösten 2026', opensOn: '2026-10-01', dueOn: '2026-11-28' });
    expect(out.bookedUnknown).toBeUndefined();
    // Missing, then booked, then held; by name within a state.
    expect(out.rows).toEqual([
      { ref: 'talk:talks:bo', userName: 'bo', name: 'Bo Berg', state: 'missing', openCommitments: 0 },
      {
        ref: 'talk:talks:dan',
        userName: 'dan.d',
        name: 'Dan Dahl',
        state: 'booked',
        at: '2026-11-20T09:00:00.000Z',
        openCommitments: 0,
      },
      {
        ref: 'talk:talks:anna',
        userName: 'anna.a',
        name: 'Anna Andersson',
        state: 'held',
        at: '2026-11-03',
        openCommitments: 0,
      },
    ]);
  });

  test('when the calendar does not answer the read says so; without an open round there is nothing to read', async () => {
    expect(await talks.round(boss)).toEqual({ round: null, rows: [] });
    await open();
    bookings = undefined;
    const out = await talks.round(boss);
    expect(out.bookedUnknown).toBe(true);
    expect(out.rows.map(r => r.state)).toEqual(['missing', 'missing', 'missing']);
    expect(checkContract(TalksOutputSchema, out)).toBe(true);
  });

  test('a talk another of the person’s managers booked reads as booked, without its time (Q12)', async () => {
    await open();
    bookings = new Map([
      ['bo', {}],
      ['dan', { at: '2026-11-20T09:00:00.000Z' }],
    ]);
    const out = await talks.round(boss);
    expect(checkContract(TalksOutputSchema, out)).toBe(true);
    expect(out.rows.map(r => [r.userName, r.state, r.at])).toEqual([
      ['anna.a', 'missing', undefined],
      ['bo', 'booked', undefined],
      ['dan.d', 'booked', '2026-11-20T09:00:00.000Z'],
    ]);
    expect(out.rows.find(r => r.userName === 'bo')).not.toHaveProperty('at');
  });

  test('an employee is refused the round; a manager of another unit sees only their own people', async () => {
    await open();
    await expect(talks.round(asAnna)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await talks.round(other)).rows.map(r => r.userName)).toEqual(['eve.e']);
  });
});

describe('held', () => {
  test('marking held writes the talk and its audit row; today is the day in Swedish time; undo clears it', async () => {
    await open();
    // 23:30 UTC on the 10th is already the 11th in Stockholm.
    now = new Date('2026-11-10T23:30:00.000Z');
    const held = await talks.markHeld(boss, 'bo');
    expect(held.heldOn).toBe('2026-11-11');
    const audit = store.audit().filter(a => a.action.startsWith('talks.held'));
    expect(audit).toEqual([
      {
        actor: 'person:boss',
        action: 'talks.held',
        subject: 'talk:' + held.id,
        at: at(),
        details: { roundId: expect.any(String), employeeId: 'bo', heldOn: '2026-11-11' },
      },
    ]);
    // The same day again changes nothing.
    await talks.markHeld(boss, 'bo', { heldOn: '2026-11-11' });
    expect(store.audit().filter(a => a.action === 'talks.held')).toHaveLength(1);
    await talks.unmarkHeld(boss, 'bo');
    await talks.unmarkHeld(boss, 'bo');
    const undone = store.audit().filter(a => a.action === 'talks.held_undone');
    expect(undone).toEqual([
      {
        actor: 'person:boss',
        action: 'talks.held_undone',
        subject: 'talk:' + held.id,
        at: at(),
        details: { roundId: expect.any(String), employeeId: 'bo' },
      },
    ]);
    const row = (await talks.round(boss)).rows.find(r => r.userName === 'bo')!;
    expect(row.state).toBe('missing');
    // Marked again, the talk keeps its id.
    expect((await talks.markHeld(boss, 'bo', { heldOn: '2026-11-09' })).id).toBe(held.id);
  });

  test('every current manager of the person marks the one talk held, moves its day and undoes it; the audit row names who (Q12)', async () => {
    staff.set('co', { units: [{ unitId: 'u1', unitLabel: 'Enhet 1', people: [anna, bo] }] });
    await open();
    const held = await talks.markHeld(co, 'anna', { heldOn: '2026-11-03' });
    expect((await talks.markHeld(boss, 'anna', { heldOn: '2026-11-04' })).id).toBe(held.id);
    expect(store.state.talks.get(held.id)).toMatchObject({ heldOn: '2026-11-04', heldBy: 'boss' });
    // One record per person per round: both managers read the same talk.
    for (const manager of [boss, co])
      expect((await talks.round(manager)).rows.find(r => r.userName === 'anna.a')).toMatchObject({
        state: 'held',
        at: '2026-11-04',
      });
    await talks.unmarkHeld(co, 'anna');
    expect(store.state.talks.size).toBe(1);
    const details = { roundId: expect.any(String), employeeId: 'anna' };
    expect(store.audit().filter(a => a.action.startsWith('talks.held'))).toEqual([
      {
        actor: 'person:co',
        action: 'talks.held',
        subject: 'talk:' + held.id,
        at: at(),
        details: { ...details, heldOn: '2026-11-03' },
      },
      {
        actor: 'person:boss',
        action: 'talks.held',
        subject: 'talk:' + held.id,
        at: at(),
        details: { ...details, heldOn: '2026-11-04' },
      },
      { actor: 'person:co', action: 'talks.held_undone', subject: 'talk:' + held.id, at: at(), details },
    ]);
  });

  test('a day that has not come is refused, as is a talk without an open round or with someone not yours', async () => {
    await expect(talks.markHeld(boss, 'anna')).rejects.toThrow('Det finns ingen öppen omgång av utvecklingssamtal.');
    await open();
    await expect(talks.markHeld(boss, 'anna', { heldOn: '2026-11-11' })).rejects.toBeInstanceOf(TalkError);
    await expect(talks.markHeld(boss, 'eve')).rejects.toBeInstanceOf(ForbiddenError);
    await expect(talks.markHeld(boss, 'cia')).rejects.toBeInstanceOf(ForbiddenError);
    await expect(talks.markHeld(asAnna, 'bo')).rejects.toBeInstanceOf(ForbiddenError);
    await expect(talks.unmarkHeld(other, 'anna')).rejects.toBeInstanceOf(ForbiddenError);
    expect(store.audit().filter(a => a.action.startsWith('talks.held'))).toEqual([]);
  });
});

describe('action points', () => {
  test('adding one opens the owner card first, writes the row and an audit row with no text and no name', async () => {
    const round = await open();
    const forAnna = await talks.addCommitment(boss, 'anna', {
      owner: 'employee',
      text: '  Gå kursen i\nretorik  ',
      dueOn: '2026-12-15',
    });
    const forBoss = await talks.addCommitment(boss, 'anna', {
      owner: 'manager',
      text: 'Ordna en mentor',
      dueOn: '2027-01-15',
    });
    expect(store.state.commitments.get(forAnna)).toMatchObject({
      roundId: round,
      employeeId: 'anna',
      ownerRole: 'employee',
      ownerId: 'anna',
      text: 'Gå kursen i retorik',
      createdBy: 'boss',
      doneAt: null,
    });
    expect(store.state.commitments.get(forBoss)).toMatchObject({ ownerRole: 'manager', ownerId: 'boss' });
    const threadId = store.state.commitments.get(forAnna)!.threadId!;
    // Either card is about the employee of the talk, by Clew's key, their id (D97 item 6, D122), whoever owns it.
    expect(store.calls()[0]).toEqual({
      op: 'open',
      threadId,
      personId: 'anna',
      commitmentId: forAnna,
      dueOn: '2026-12-15',
      at: at(),
      subject: { entity: 'person', key: 'anna' },
    });
    expect(store.calls()[1]).toMatchObject({
      op: 'open',
      personId: 'boss',
      commitmentId: forBoss,
      subject: { entity: 'person', key: 'anna' },
    });
    expect(store.audit().filter(a => a.action === 'talks.commitment_added')).toEqual([
      {
        actor: 'person:boss',
        action: 'talks.commitment_added',
        subject: 'commitment:' + forAnna,
        at: at(),
        details: { roundId: round, ownerRole: 'employee', dueOn: '2026-12-15' },
      },
      {
        actor: 'person:boss',
        action: 'talks.commitment_added',
        subject: 'commitment:' + forBoss,
        at: at(),
        details: { roundId: round, ownerRole: 'manager', dueOn: '2027-01-15' },
      },
    ]);
    expect((await talks.round(boss)).rows.find(r => r.userName === 'anna.a')?.openCommitments).toBe(2);
    // Someone provisioned without a user name is still named by id (D122): no read about a person asks a source about
    // them, but the card is theirs.
    await talks.addCommitment(boss, 'bo', { owner: 'manager', text: 'Boka ett möte', dueOn: '2027-01-15' });
    expect(store.calls()[2]).toMatchObject({ op: 'open', personId: 'boss', subject: { entity: 'person', key: 'bo' } });
  });

  test('a blank or too long text, no round, an employee and a manager of another unit are refused, and nothing is written', async () => {
    const body = { owner: 'employee' as const, text: 'Läsa boken', dueOn: '2026-12-15' };
    await expect(talks.addCommitment(boss, 'anna', body)).rejects.toBeInstanceOf(TalkError);
    await open();
    await expect(talks.addCommitment(boss, 'anna', { ...body, text: ' \n ' })).rejects.toBeInstanceOf(TalkError);
    await expect(talks.addCommitment(boss, 'anna', { ...body, text: 'x'.repeat(281) })).rejects.toBeInstanceOf(
      TalkError,
    );
    await expect(talks.addCommitment(asAnna, 'anna', body)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(talks.addCommitment(other, 'anna', body)).rejects.toBeInstanceOf(ForbiddenError);
    expect(store.state.commitments.size).toBe(0);
    expect(store.calls()).toEqual([]);
  });

  test('when the card sink throws, neither the action point nor its card nor the audit row is left', async () => {
    await open();
    const audited = store.audit().length;
    store.sink.throwOn = 'open';
    await expect(
      talks.addCommitment(boss, 'anna', { owner: 'employee', text: 'Läsa boken', dueOn: '2026-12-15' }),
    ).rejects.toThrow('card sink failed on open');
    expect(store.state.commitments.size).toBe(0);
    expect(store.state.cards.size).toBe(0);
    expect(store.audit()).toHaveLength(audited);
    // A failing close leaves the action point open and unaudited.
    store.sink.throwOn = undefined;
    const id = await talks.addCommitment(boss, 'anna', { owner: 'employee', text: 'Läsa boken', dueOn: '2026-12-15' });
    store.sink.throwOn = 'close';
    await expect(talks.completeCommitment(asAnna, id)).rejects.toThrow('card sink failed on close');
    expect(store.state.commitments.get(id)?.doneAt).toBeNull();
    expect(store.audit().some(a => a.action === 'talks.commitment_done')).toBe(false);
  });

  test('the owner marks theirs done and opens it again; the card follows; a repeat writes nothing', async () => {
    await open();
    const id = await talks.addCommitment(boss, 'anna', { owner: 'employee', text: 'Läsa boken', dueOn: '2026-12-15' });
    const threadId = store.state.commitments.get(id)!.threadId!;
    now = new Date('2026-11-12T10:00:00.000Z');
    await talks.completeCommitment(asAnna, id);
    await talks.completeCommitment(asAnna, id);
    expect(store.state.commitments.get(id)).toMatchObject({ doneAt: at(), doneBy: 'anna' });
    expect(store.state.cards.get(threadId)?.state).toBe('handled');
    now = new Date('2026-11-13T10:00:00.000Z');
    // The employee's own point is hers: her manager may not open it again (Q12).
    await expect(talks.reopenCommitment(boss, id)).rejects.toBeInstanceOf(ForbiddenError);
    await talks.reopenCommitment(asAnna, id);
    await talks.reopenCommitment(asAnna, id);
    expect(store.state.commitments.get(id)).toMatchObject({ doneAt: null, doneBy: null });
    expect(store.calls().filter(c => c.op !== 'open')).toEqual([
      { op: 'close', threadId, at: '2026-11-12T10:00:00.000Z' },
      { op: 'reopen', threadId, dueOn: '2026-12-15', at: '2026-11-13T10:00:00.000Z' },
    ]);
    expect(
      store.audit().filter(a => a.subject === 'commitment:' + id && a.action !== 'talks.commitment_added'),
    ).toEqual([
      {
        actor: 'person:anna',
        action: 'talks.commitment_done',
        subject: 'commitment:' + id,
        at: '2026-11-12T10:00:00.000Z',
        details: { roundId: expect.any(String), ownerRole: 'employee', by: 'owner' },
      },
      {
        actor: 'person:anna',
        action: 'talks.commitment_reopened',
        subject: 'commitment:' + id,
        at: '2026-11-13T10:00:00.000Z',
        details: { roundId: expect.any(String), ownerRole: 'employee', by: 'owner' },
      },
    ]);
  });

  test('someone else is refused; a former manager reaches nothing about the person the day the assignment changes', async () => {
    await open();
    const id = await talks.addCommitment(boss, 'anna', { owner: 'employee', text: 'Läsa boken', dueOn: '2026-12-15' });
    await expect(talks.completeCommitment(asBo, id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(talks.completeCommitment(other, id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(talks.completeCommitment(asBo, 'no-such-id')).rejects.toBeInstanceOf(ForbiddenError);
    staff.set('boss', { units: [{ unitId: 'u2', unitLabel: 'Enhet 2', people: [dan] }] });
    await expect(talks.completeCommitment(boss, id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(talks.commitments(boss, { person: 'anna.a' })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(talks.markHeld(boss, 'anna')).rejects.toBeInstanceOf(ForbiddenError);
    expect((await talks.round(boss)).rows.map(r => r.userName)).toEqual(['dan.d']);
    expect(store.state.commitments.get(id)?.doneAt).toBeNull();
  });

  test('a manager ticks off only their own points: a co-manager’s and the employee’s own are left to their owners (Q12)', async () => {
    // Anna has two current managers: Karin (boss) and Lena (co), both of unit 1.
    staff.set('co', { units: [{ unitId: 'u1', unitLabel: 'Enhet 1', people: [anna, bo] }] });
    await open();
    const karins = await talks.addCommitment(boss, 'anna', {
      owner: 'manager',
      text: 'Ordna en mentor',
      dueOn: '2026-12-15',
    });
    const lenas = await talks.addCommitment(co, 'anna', {
      owner: 'manager',
      text: 'Boka en kurs',
      dueOn: '2026-12-20',
    });
    const annas = await talks.addCommitment(boss, 'anna', {
      owner: 'employee',
      text: 'Läsa boken',
      dueOn: '2026-12-01',
    });
    const audited = store.audit().length;
    for (const [persona, id] of [
      [co, karins],
      [co, annas],
      [boss, lenas],
      [boss, annas],
    ] as const) {
      await expect(talks.completeCommitment(persona, id)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(talks.reopenCommitment(persona, id)).rejects.toBeInstanceOf(ForbiddenError);
    }
    expect(store.audit()).toHaveLength(audited);
    expect([karins, lenas, annas].map(id => store.state.commitments.get(id)?.doneAt)).toEqual([null, null, null]);
    // So neither is offered the other's point, nor the employee's, to take over.
    expect(await talks.takeovers(co, [karins, annas])).toEqual(new Set());
    expect(await talks.takeovers(boss, [lenas, annas])).toEqual(new Set());
    // Each owner ticks off their own; the audit row names who, as the owner.
    await talks.completeCommitment(boss, karins);
    await talks.completeCommitment(co, lenas);
    await talks.completeCommitment(asAnna, annas);
    expect(store.audit().slice(audited)).toEqual(
      (
        [
          ['person:boss', karins, 'manager'],
          ['person:co', lenas, 'manager'],
          ['person:anna', annas, 'employee'],
        ] as const
      ).map(([actor, id, ownerRole]) => ({
        actor,
        action: 'talks.commitment_done',
        subject: 'commitment:' + id,
        at: at(),
        details: { roundId: expect.any(String), ownerRole, by: 'owner' },
      })),
    );
  });

  test('a point whose owner no longer manages the person is a current manager’s to tick off; the former manager keeps their own (Q12, M2)', async () => {
    staff.set('co', { units: [{ unitId: 'u1', unitLabel: 'Enhet 1', people: [anna, bo] }] });
    await open();
    const lenas = await talks.addCommitment(co, 'anna', {
      owner: 'manager',
      text: 'Boka en kurs',
      dueOn: '2026-12-20',
    });
    const later = await talks.addCommitment(co, 'anna', { owner: 'manager', text: 'Följa upp', dueOn: '2027-01-20' });
    // Lena moves to another unit: she manages Eve now, not Anna.
    staff.set('co', { units: [{ unitId: 'u3', unitLabel: 'Enhet 3', people: [eve] }] });
    await expect(talks.markHeld(co, 'anna')).rejects.toBeInstanceOf(ForbiddenError);
    await expect(talks.commitments(co, { person: 'anna.a' })).rejects.toBeInstanceOf(ForbiddenError);
    // Her own points stay hers, on her own list, until they are done.
    expect((await talks.commitments(co)).rows.map(r => [r.ref, r.mine, r.userName])).toEqual([
      ['commitment:talks:' + lenas, true, 'anna.a'],
      ['commitment:talks:' + later, true, 'anna.a'],
    ]);
    // What the page is offered (Q12): Anna's current manager may take over the point, a manager of another unit and an
    // employee may not, and an unknown id is nobody's; Lena's own is hers as its owner, never a takeover.
    expect(await talks.takeovers(boss, [lenas, 'missing'])).toEqual(new Set([lenas]));
    expect(await talks.takeovers(other, [lenas])).toEqual(new Set());
    expect(await talks.takeovers(asAnna, [lenas])).toEqual(new Set());
    expect(await talks.takeovers(co, [lenas])).toEqual(new Set());
    const audited = store.audit().length;
    now = new Date('2026-11-12T10:00:00.000Z');
    await talks.completeCommitment(co, later);
    // Anna's current manager may tick off the point nobody who manages her owns, and open it again; a manager of
    // another unit may not.
    await expect(talks.completeCommitment(other, lenas)).rejects.toBeInstanceOf(ForbiddenError);
    await talks.completeCommitment(boss, lenas);
    expect(store.state.commitments.get(lenas)).toMatchObject({ ownerId: 'co', doneAt: at(), doneBy: 'boss' });
    expect(store.state.cards.get(store.state.commitments.get(lenas)!.threadId!)?.state).toBe('handled');
    now = new Date('2026-11-13T10:00:00.000Z');
    await talks.reopenCommitment(boss, lenas);
    expect(store.audit().slice(audited)).toEqual([
      {
        actor: 'person:co',
        action: 'talks.commitment_done',
        subject: 'commitment:' + later,
        at: '2026-11-12T10:00:00.000Z',
        details: { roundId: expect.any(String), ownerRole: 'manager', by: 'owner' },
      },
      {
        actor: 'person:boss',
        action: 'talks.commitment_done',
        subject: 'commitment:' + lenas,
        at: '2026-11-12T10:00:00.000Z',
        details: { roundId: expect.any(String), ownerRole: 'manager', by: 'manager' },
      },
      {
        actor: 'person:boss',
        action: 'talks.commitment_reopened',
        subject: 'commitment:' + lenas,
        at: '2026-11-13T10:00:00.000Z',
        details: { roundId: expect.any(String), ownerRole: 'manager', by: 'manager' },
      },
    ]);
    // Lena is Anna's manager again: the point is hers to tick off once more, not Karin's.
    staff.set('co', { units: [{ unitId: 'u1', unitLabel: 'Enhet 1', people: [anna, bo] }] });
    await expect(talks.completeCommitment(boss, lenas)).rejects.toBeInstanceOf(ForbiddenError);
    await talks.completeCommitment(co, lenas);
    expect(store.state.commitments.get(lenas)).toMatchObject({ doneBy: 'co' });
  });

  test('a manager’s point whose owner was erased is a current manager’s to tick off (Q12)', async () => {
    staff.set('co', { units: [{ unitId: 'u1', unitLabel: 'Enhet 1', people: [anna, bo] }] });
    await open();
    const lenas = await talks.addCommitment(co, 'anna', {
      owner: 'manager',
      text: 'Boka en kurs',
      dueOn: '2026-12-20',
    });
    deactivate('co');
    await talks.erasePerson('operator:cli', 'co');
    expect(store.state.commitments.get(lenas)).toMatchObject({ ownerId: null });
    expect(await talks.takeovers(boss, [lenas])).toEqual(new Set([lenas]));
    await talks.completeCommitment(boss, lenas);
    expect(store.state.commitments.get(lenas)).toMatchObject({ doneAt: at(), doneBy: 'boss' });
    expect(store.audit().at(-1)).toEqual({
      actor: 'person:boss',
      action: 'talks.commitment_done',
      subject: 'commitment:' + lenas,
      at: at(),
      details: { roundId: expect.any(String), ownerRole: 'manager', by: 'manager' },
    });
    // An employee's own point stays theirs even so: her manager is refused it and nothing is written.
    const annas = await talks.addCommitment(boss, 'anna', {
      owner: 'employee',
      text: 'Läsa boken',
      dueOn: '2026-12-01',
    });
    const audited = store.audit().length;
    await expect(talks.completeCommitment(boss, annas)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(talks.reopenCommitment(boss, annas)).rejects.toBeInstanceOf(ForbiddenError);
    expect(store.state.commitments.get(annas)).toMatchObject({ doneAt: null, doneBy: null });
    expect(store.audit()).toHaveLength(audited);
    // Erasing the employee removes her own points with her: there is nobody's point left to take over.
    deactivate('anna');
    await talks.erasePerson('operator:cli', 'anna');
    expect(store.state.commitments.get(annas)).toBeUndefined();
  });

  test('the lists: a person by user name or id for their manager, and the reader’s own; open ones carry over into the next round', async () => {
    await open();
    const mine = await talks.addCommitment(boss, 'anna', {
      owner: 'manager',
      text: 'Ordna en mentor',
      dueOn: '2027-01-15',
    });
    const annas = await talks.addCommitment(boss, 'anna', {
      owner: 'employee',
      text: 'Läsa boken',
      dueOn: '2026-12-15',
    });
    const done = await talks.addCommitment(boss, 'anna', { owner: 'employee', text: 'Boka kurs', dueOn: '2026-11-30' });
    await talks.addCommitment(boss, 'bo', { owner: 'employee', text: 'Uppdatera rutinen', dueOn: '2026-12-01' });
    await talks.completeCommitment(asAnna, done);

    const aboutAnna = await talks.commitments(boss, { person: 'anna.a' });
    expect(checkContract(CommitmentsOutputSchema, aboutAnna)).toBe(true);
    expect(aboutAnna.rows.map(r => [r.ref, r.mine, r.done, r.carried])).toEqual([
      ['commitment:talks:' + annas, false, false, false],
      ['commitment:talks:' + mine, true, false, false],
      ['commitment:talks:' + done, false, true, false],
    ]);
    expect(aboutAnna.rows[0]).toMatchObject({ userName: 'anna.a', name: 'Anna Andersson', owner: 'employee' });
    expect(aboutAnna.rows[2]?.doneAt).toBe(at());
    // Bo has no user name: his key is his id.
    expect((await talks.commitments(boss, { person: 'bo' })).rows.map(r => r.userName)).toEqual(['bo']);
    await expect(talks.commitments(boss, { person: 'eve.e' })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(talks.commitments(asAnna, { person: 'anna.a' })).rejects.toBeInstanceOf(ForbiddenError);

    // Anna reads hers and the one her manager took on in her talk; the manager reads only the one they own.
    const annasOwn = await talks.commitments(asAnna);
    expect(annasOwn.rows.map(r => [r.ref, r.mine])).toEqual([
      ['commitment:talks:' + annas, true],
      ['commitment:talks:' + mine, false],
      ['commitment:talks:' + done, true],
    ]);
    expect((await talks.commitments(boss)).rows.map(r => r.ref)).toEqual(['commitment:talks:' + mine]);

    // The next round: the open ones are carried over and listed first, the done one is gone.
    now = new Date('2027-03-01T08:00:00.000Z');
    await talks.openRound('operator:cli', {
      organisationId: ORG,
      label: 'Våren',
      opensOn: '2027-03-01',
      dueOn: '2027-05-31',
    });
    const fresh = await talks.addCommitment(boss, 'anna', { owner: 'employee', text: 'Ny punkt', dueOn: '2027-02-01' });
    const next = await talks.commitments(boss, { person: 'anna.a' });
    expect(next.rows.map(r => [r.ref, r.carried])).toEqual([
      ['commitment:talks:' + annas, true],
      ['commitment:talks:' + mine, true],
      ['commitment:talks:' + fresh, false],
    ]);
    expect((await talks.round(boss)).rows.find(r => r.userName === 'anna.a')?.openCommitments).toBe(3);
  });

  test('without person the reader gets what they own and what is about them, each once: an employee sees their manager’s point in their talk', async () => {
    await open();
    const hers = await talks.addCommitment(boss, 'anna', {
      owner: 'employee',
      text: 'Läsa boken',
      dueOn: '2026-12-15',
    });
    const bosses = await talks.addCommitment(boss, 'anna', {
      owner: 'manager',
      text: 'Ordna en mentor',
      dueOn: '2026-12-01',
    });
    await talks.addCommitment(boss, 'dan', { owner: 'employee', text: 'Uppdatera rutinen', dueOn: '2026-12-01' });
    const out = await talks.commitments(asAnna);
    expect(checkContract(CommitmentsOutputSchema, out)).toBe(true);
    // Her own first even though the manager's is due earlier; she both owns and is the subject of hers, listed once.
    expect(out.rows.map(r => [r.ref, r.owner, r.mine, r.userName])).toEqual([
      ['commitment:talks:' + hers, 'employee', true, 'anna.a'],
      ['commitment:talks:' + bosses, 'manager', false, 'anna.a'],
    ]);
    expect(new Set(out.rows.map(r => r.ref)).size).toBe(out.rows.length);
  });

  test('a manager’s own list has the points they own about several employees and none that those employees own', async () => {
    await open();
    const aboutAnna = await talks.addCommitment(boss, 'anna', {
      owner: 'manager',
      text: 'Ordna en mentor',
      dueOn: '2026-12-20',
    });
    const aboutDan = await talks.addCommitment(boss, 'dan', {
      owner: 'manager',
      text: 'Boka en genomgång',
      dueOn: '2026-12-10',
    });
    await talks.addCommitment(boss, 'anna', { owner: 'employee', text: 'Läsa boken', dueOn: '2026-12-15' });
    await talks.addCommitment(boss, 'dan', { owner: 'employee', text: 'Uppdatera rutinen', dueOn: '2026-12-01' });
    const out = await talks.commitments(boss);
    expect(checkContract(CommitmentsOutputSchema, out)).toBe(true);
    expect(out.rows.map(r => [r.ref, r.mine, r.userName])).toEqual([
      ['commitment:talks:' + aboutDan, true, 'dan.d'],
      ['commitment:talks:' + aboutAnna, true, 'anna.a'],
    ]);
  });

  test('the due timer brings an open card back once, and does nothing for a done one or a stale generation', async () => {
    await open();
    const id = await talks.addCommitment(boss, 'anna', { owner: 'employee', text: 'Läsa boken', dueOn: '2026-12-15' });
    const threadId = store.state.commitments.get(id)!.threadId!;
    now = new Date('2026-12-16T05:00:00.000Z');
    expect(await talks.commitmentDue(threadId, 1)).toBe(true);
    expect(store.audit().filter(a => a.action === 'talks.commitment_due')).toEqual([
      {
        actor: 'system:scheduler',
        action: 'talks.commitment_due',
        subject: 'commitment:' + id,
        at: at(),
        details: { roundId: expect.any(String), dueOn: '2026-12-15', generation: 1 },
      },
    ]);
    store.sink.fires = (_, generation) => generation === 2;
    expect(await talks.commitmentDue(threadId, 1)).toBe(false);
    expect(store.audit().filter(a => a.action === 'talks.commitment_due')).toHaveLength(1);
    await talks.completeCommitment(asAnna, id);
    const fired = store.calls().filter(c => c.op === 'fire').length;
    expect(await talks.commitmentDue(threadId, 2)).toBe(false);
    expect(await talks.commitmentDue('unknown-thread', 1)).toBe(false);
    expect(store.calls().filter(c => c.op === 'fire')).toHaveLength(fired);
  });
});

describe('erasure and export', () => {
  test('erasing a person removes their records and cards and audits the counts only', async () => {
    await open();
    await talks.markHeld(boss, 'anna', { heldOn: '2026-11-03' });
    const a1 = await talks.addCommitment(boss, 'anna', { owner: 'employee', text: 'Läsa boken', dueOn: '2026-12-15' });
    const a2 = await talks.addCommitment(boss, 'anna', {
      owner: 'manager',
      text: 'Ordna en mentor',
      dueOn: '2027-01-15',
    });
    const cards = [a1, a2].map(id => store.state.commitments.get(id)!.threadId!);
    deactivate('anna');
    const counts = await talks.erasePerson('operator:cli', 'anna');
    expect(counts).toEqual({ talks: 1, commitments: 2, cleared: 0, cards: 2 });
    expect(store.calls().at(-1)).toEqual({ op: 'remove', threadIds: [...cards].sort() });
    expect(store.state.cards.size).toBe(0);
    expect(store.state.commitments.size).toBe(0);
    expect(store.audit().at(-1)).toEqual({
      actor: 'operator:cli',
      action: 'talks.person_erased',
      subject: 'person:anna',
      at: at(),
      details: counts,
    });
  });

  test('an id the people table does not hold, a user name among them, erases nothing and writes no audit row (R1)', async () => {
    await open();
    await talks.markHeld(boss, 'anna', { heldOn: '2026-11-03' });
    const id = await talks.addCommitment(boss, 'anna', { owner: 'employee', text: 'Läsa boken', dueOn: '2026-12-15' });
    const audit = store.audit().length,
      calls = store.calls().length;
    for (const key of ['nobody', 'anna.a', 'Anna.A'])
      expect(await talks.erasePerson('operator:cli', key)).toEqual({ refused: 'unknown' });
    expect(store.audit()).toHaveLength(audit);
    expect(store.calls()).toHaveLength(calls);
    expect(store.state.commitments.get(id)).toMatchObject({ employeeId: 'anna' });
  });

  test('a person who is still active is refused: nothing is erased and no audit row is written (D123 item 3)', async () => {
    await open();
    await talks.markHeld(boss, 'anna', { heldOn: '2026-11-03' });
    const id = await talks.addCommitment(boss, 'anna', { owner: 'employee', text: 'Läsa boken', dueOn: '2026-12-15' });
    // Lena owns a point about Bo: her id on it stays as well.
    staff.set('co', { units: [{ unitId: 'u1', unitLabel: 'Enhet 1', people: [anna, bo] }] });
    const lenas = await talks.addCommitment(co, 'bo', { owner: 'manager', text: 'Boka en kurs', dueOn: '2026-12-20' });
    const audit = store.audit().length,
      calls = store.calls().length,
      cards = store.state.cards.size;
    for (const key of ['anna', 'co'])
      expect(await talks.erasePerson('operator:cli', key)).toEqual({ refused: 'active' });
    expect(store.audit()).toHaveLength(audit);
    expect(store.calls()).toHaveLength(calls);
    expect(store.state.cards.size).toBe(cards);
    expect(store.state.commitments.get(id)).toMatchObject({ employeeId: 'anna' });
    expect(store.state.commitments.get(lenas)).toMatchObject({ ownerId: 'co', createdBy: 'co' });
    expect([...store.state.talks.values()].map(t => t.employeeId)).toEqual(['anna']);
    // Once the source has deactivated her, the same call erases her.
    deactivate('anna');
    expect(await talks.erasePerson('operator:cli', 'anna')).toEqual({ talks: 1, commitments: 1, cleared: 0, cards: 1 });
  });

  test('the export is one versioned document with the text, and its audit row has counts', async () => {
    const round = await open();
    await talks.markHeld(boss, 'bo', { heldOn: '2026-11-03' });
    await talks.addCommitment(boss, 'bo', { owner: 'employee', text: 'Uppdatera rutinen', dueOn: '2026-12-01' });
    const doc = await talks.exportDomain('operator:cli', ORG);
    expect(doc).toMatchObject({ format: 'clew.talks/1', exportedAt: at(), organisationId: ORG });
    expect(doc.rounds.map(r => r.id)).toEqual([round]);
    expect(doc.talks.map(t => t.employeeId)).toEqual(['bo']);
    expect(doc.commitments.map(c => c.text)).toEqual(['Uppdatera rutinen']);
    expect(store.audit().at(-1)).toEqual({
      actor: 'operator:cli',
      action: 'talks.exported',
      subject: 'organisation:' + ORG,
      at: at(),
      details: { rounds: 1, talks: 1, commitments: 1 },
    });
  });

  test('no audit row carries an action point text or a person name', async () => {
    await open();
    await talks.markHeld(boss, 'anna', { heldOn: '2026-11-03' });
    await talks.unmarkHeld(boss, 'anna');
    const id = await talks.addCommitment(boss, 'anna', {
      owner: 'employee',
      text: 'Hemlig text om Anna',
      dueOn: '2026-12-15',
    });
    await talks.completeCommitment(asAnna, id);
    await talks.reopenCommitment(asAnna, id);
    await talks.commitmentDue(store.state.commitments.get(id)!.threadId!, 1);
    await talks.exportDomain('operator:cli', ORG);
    deactivate('anna');
    await talks.erasePerson('operator:cli', 'anna');
    const text = auditText();
    expect(store.audit().length).toBeGreaterThanOrEqual(9);
    expect(text).not.toContain('Hemlig');
    for (const name of NAMES) expect(text).not.toContain(name);
  });
});

describe('domain', () => {
  test('text is one trimmed line of at most 280 characters; dates read in Swedish; done ones sort last', () => {
    expect(normaliseText('  a\n\tb  ')).toBe('a b');
    expect(normaliseText('å'.repeat(280))).toHaveLength(280);
    expect(normaliseText('å'.repeat(281))).toBeUndefined();
    expect(swedishDayAndMonth('2026-11-28')).toBe('28 november');
    // The words of a list about people (D97): a day without the month's full stop, the next talk, the counts.
    expect(swedishShortDay('2026-11-28')).toBe('lör 28 nov');
    expect(swedishShortDay('2026-05-04', false)).toBe('4 maj');
    expect(nextTalk('booked', '2026-11-15T23:30:00.000Z')).toBe('mån 16 nov');
    // Booked by another of the person's managers, whose time the reader does not see (Q12).
    expect(nextTalk('booked', undefined)).toBe('Bokat');
    expect(nextTalk('held', '2026-11-04')).toBe('Hållet 4 nov');
    expect(nextTalk('missing', undefined)).toBe('Inte bokat');
    expect([0, 1, 3].map(openWords)).toEqual(['Inga', '1 öppen', '3 öppna']);
    expect([0, 1, 2].map(overdueWords)).toEqual([undefined, '1 försenad', '2 försenade']);
    const row = (ref: string, carried: boolean, done: boolean, dueOn: string, mine = true) => ({
      ref,
      carried,
      done,
      dueOn,
      mine,
    });
    expect(
      orderCommitmentRows([
        row('d', false, true, '2026-01-01'),
        row('b', false, false, '2026-12-01'),
        row('a', true, false, '2027-01-01'),
        row('c', false, false, '2026-11-01'),
      ]).map(r => r.ref),
    ).toEqual(['a', 'c', 'b', 'd']);
    // The reader's own list: their own first (carried, then open by date), then the others the same way, done last.
    expect(
      orderCommitmentRows(
        [
          row('done', false, true, '2026-01-01'),
          row('other-open', false, false, '2026-10-01', false),
          row('other-carried', true, false, '2026-09-01', false),
          row('mine-open', false, false, '2026-12-01'),
          row('mine-carried', true, false, '2027-01-01'),
        ],
        { mineFirst: true },
      ).map(r => r.ref),
    ).toEqual(['mine-carried', 'mine-open', 'other-carried', 'other-open', 'done']);
  });
});

describe('the built-in connector', () => {
  const actor = (p: AuthenticatedContext): Actor => ({
    id: p.id,
    name: p.name,
    unitId: p.unitId,
    unitLabel: p.unitLabel,
    role: p.role,
  });
  const personas = new Map([boss, other, asAnna, asBo].map(p => [p.id, p]));
  const registry = () =>
    new Registry().register(
      talksConnector(talks, async a => {
        const p = personas.get(a.id);
        if (!p) throw new Error('unknown');
        return p;
      }),
    );

  test('it passes the registry validation, its reads are no model tools, and the profile views open without input', () => {
    const connector = talksConnector(talks, async () => boss);
    expect(() => registry()).not.toThrow();
    expect(connector).toMatchObject({ id: 'talks', kind: 'core', source: 'Utvecklingssamtal' });
    const reads = connector.capabilities;
    expect(reads.map(c => [c.name, c.kind, c.model])).toEqual([
      ['talks.talks', 'read', false],
      ['talks.commitments', 'read', false],
      ['talks.person', 'read', false],
      ['talks.unit', 'read', false],
    ]);
    for (const c of reads) {
      expect(viewProblem(c, reads)).toBeUndefined();
      // No row can be added to a conversation as a chip: the text never reaches a model (D96 item 6).
      expect(c.view && 'ref' in c.view).toBe(false);
    }
    // The profile reads open from the menu without a question; the reads about an entity take their keys (D97).
    expect(reads.map(c => [c.name, menuEligible(c)])).toEqual([
      ['talks.talks', true],
      ['talks.commitments', true],
      ['talks.person', false],
      ['talks.unit', false],
    ]);
    expect('ref' in talksView || 'ref' in commitmentsView).toBe(false);
  });

  test('the reads about a person and a unit declare about (D97), the page where the talk is written, and are never tools', () => {
    const connector = talksConnector(talks, async () => boss);
    const about = Object.fromEntries(connector.capabilities.map(c => [c.name, c.about]));
    expect(about).toEqual({
      'talks.talks': undefined,
      'talks.commitments': undefined,
      'talks.person': { entity: 'person', page: { title: 'Öppna samtalet', href: '?talk={id}' } },
      'talks.unit': { entity: 'unit', page: { title: 'Visa i Personal', href: '/staff?show=talks.person' } },
    });
    // The talk is a query alone, laid over the page its way in is on (D111 rule 5); Personal is a destination, a path.
    for (const name of ['talks.person', 'talks.unit'])
      expect(checkContract(EntityPageSchema, connector.capabilities.find(c => c.name === name)!.about!.page)).toBe(
        true,
      );
    expect(checkContract(EntityPageSchema, { title: 'Öppna', href: 'staff?talk={id}' })).toBe(false);
    const person = connector.capabilities.find(c => c.name === 'talks.person')!;
    expect(placesOf(person)).toEqual(['lens', 'mark', 'section']);
    expect(markFields(person.view).map(f => f.key)).toEqual(['state', 'next', 'overdue']);
    const state = personTalksView.kind === 'list' ? personTalksView.fields[0]! : undefined;
    expect([fieldTone(state!, 'Saknas'), fieldTone(state!, 'Bokat'), fieldTone(state!, 'Hållet')]).toEqual([
      'warn',
      'none',
      'ok',
    ]);
    expect(placesOf(connector.capabilities.find(c => c.name === 'talks.unit')!)).toEqual(['lens', 'mark', 'section']);
    expect(registry().tools(actor(boss))).toEqual([]);
    // Where the whole row is drawn (a lens, a section) it is two cells, "Samtal" with its time and "Åtgärdspunkter" with
    // the late ones; the next talk is the row in one value, for a column or a one-line summary (D97, artboards A2 and B).
    const fields = personTalksView.kind === 'list' ? personTalksView.fields : [];
    expect(fields.filter(f => f.beside).map(f => f.key)).toEqual(['at', 'overdue']);
    expect(fields.filter(f => f.compact).map(f => f.key)).toEqual(['next']);
    expect(viewProblem({ ...person, view: personTalksView }, connector.capabilities)).toBeUndefined();
  });

  test('talks.person answers one row per person the manager plans a talk with, keyed as asked; anyone else is no row', async () => {
    const r = registry();
    // No open round: nothing to say about anyone, and no heading.
    expect(await r.run(actor(boss), 'talks.person', { keys: ['anna.a'] })).toEqual({ rows: [] });
    await open();
    await talks.markHeld(boss, 'anna', { heldOn: '2026-11-03' });
    await talks.addCommitment(boss, 'anna', { owner: 'employee', text: 'Läsa boken', dueOn: '2026-11-05' });
    await talks.addCommitment(boss, 'anna', { owner: 'manager', text: 'Boka kursen', dueOn: '2026-12-15' });
    const done = await talks.addCommitment(boss, 'anna', { owner: 'manager', text: 'Ringa', dueOn: '2026-11-01' });
    await talks.completeCommitment(boss, done);
    const output = await r.run(actor(boss), 'talks.person', {
      // A key in other case, a booked person, a person without a user name (keyed on nothing), another manager's
      // person, an unknown key, and the first person again in its own case.
      keys: ['ANNA.A', 'dan.d', 'bo', 'eve.e', 'nobody', 'anna.a'],
    });
    expect(checkContract(PersonTalksOutputSchema, output)).toBe(true);
    expect(output).toEqual({
      heading: 'Utvecklingssamtal hösten 2026',
      note: 'Senast lör 28 nov',
      rows: [
        {
          key: 'ANNA.A',
          state: 'Hållet',
          at: '2026-11-03',
          next: 'Hållet 3 nov',
          open: '2 öppna',
          overdue: '1 försenad',
        },
        { key: 'dan.d', state: 'Bokat', at: '2026-11-20T09:00:00.000Z', next: 'fre 20 nov', open: 'Inga' },
      ],
    });
    // Another manager is answered nothing about them, and an employee may not call it at all.
    expect(await r.run(actor(other), 'talks.person', { keys: ['anna.a', 'dan.d', 'eve.e'] })).toMatchObject({
      rows: [{ key: 'eve.e', state: 'Saknas', next: 'Inte bokat', open: 'Inga' }],
    });
    await expect(r.run(actor(asAnna), 'talks.person', { keys: ['anna.a'] })).rejects.toThrow(
      'Du saknar behörighet för åtgärden.',
    );
    // The row opens the person's action points with its key as asked.
    const points = await r.run<{ rows: Array<{ userName: string }> }>(actor(boss), 'talks.commitments', {
      person: 'ANNA.A',
    });
    expect(points.rows.map(p => p.userName)).toEqual(['anna.a', 'anna.a', 'anna.a']);
    // More keys than a batch holds are refused by the input schema.
    await expect(
      r.run(actor(boss), 'talks.person', { keys: Array.from({ length: 201 }, (_, i) => 'k' + i) }),
    ).rejects.toThrow('Ogiltig förfrågan');
  });

  test('a talk another of the person’s managers booked is Bokat without a time, and counts as booked for the unit (Q12)', async () => {
    const r = registry();
    await open();
    bookings = new Map([['dan', {}]]);
    const person = await r.run(actor(boss), 'talks.person', { keys: ['dan.d'] });
    expect(checkContract(PersonTalksOutputSchema, person)).toBe(true);
    expect(person).toMatchObject({ rows: [{ key: 'dan.d', state: 'Bokat', next: 'Bokat', open: 'Inga' }] });
    expect((person as { rows: Array<Record<string, string>> }).rows[0]).not.toHaveProperty('at');
    expect(await r.run(actor(boss), 'talks.unit', { keys: ['u2'] })).toMatchObject({
      rows: [{ key: 'u2', held: '0 av 2 hållna', booked: '1 bokat', missing: '1 saknas' }],
    });
  });

  test('when the calendar does not answer, the note says so and a booked talk reads as missing', async () => {
    const r = registry();
    await open();
    bookings = undefined;
    const output = await r.run<{ note?: string; rows: Array<Record<string, string>> }>(actor(boss), 'talks.person', {
      keys: ['dan.d'],
    });
    expect(output.note).toBe('Senast lör 28 nov · kalendern svarade inte, så bokade samtal kan saknas');
    expect(output.rows).toEqual([{ key: 'dan.d', state: 'Saknas', next: 'Inte bokat', open: 'Inga' }]);
  });

  test('talks.unit counts held, booked and missing per unit the manager manages; another unit is no row', async () => {
    const r = registry();
    await open();
    await talks.markHeld(boss, 'anna', { heldOn: '2026-11-03' });
    const output = await r.run(actor(boss), 'talks.unit', { keys: ['u1', 'u2', 'u3', 'nope'] });
    expect(checkContract(UnitTalksOutputSchema, output)).toBe(true);
    // u1: Anna held, Bo missing (Cia is deactivated, the manager is not due one); u2: Anna held, Dan booked.
    expect(output).toEqual({
      heading: 'Utvecklingssamtal hösten 2026',
      note: 'Senast lör 28 nov',
      rows: [
        { key: 'u1', held: '1 av 2 hållna', missing: '1 saknas' },
        { key: 'u2', held: '1 av 2 hållna', booked: '1 bokat' },
      ],
    });
    expect(await r.run(actor(other), 'talks.unit', { keys: ['u1', 'u2'] })).toMatchObject({ rows: [] });
  });

  test('the figure counts held out of everyone due and opens the round; nothing for an employee or without a round', async () => {
    const r = registry();
    const figureOf = async (p: AuthenticatedContext) =>
      (await r.areas(actor(p))).find(a => a.id === 'talks')?.figure ?? null;
    expect(await figureOf(boss)).toBeNull();
    await open();
    await talks.markHeld(boss, 'anna', { heldOn: '2026-11-03' });
    expect(await figureOf(boss)).toEqual({
      label: 'Utvecklingssamtal hållna',
      value: '1 av 3',
      comparison: 'senast 28 november',
      progress: { value: 1, max: 3 },
      tone: 'none',
      opens: { capability: 'talks.talks', title: 'Utvecklingssamtal' },
    });
    expect(await figureOf(asAnna)).toBeNull();
    // A manager whose unit has nobody due a talk has no figure either.
    staff.set('other', { units: [{ unitId: 'u3', unitLabel: 'Enhet 3', people: [] }] });
    expect(await figureOf(other)).toBeNull();
  });

  test('both reads answer through the registry with outputs that pass the profile shapes; the round is for managers only', async () => {
    const r = registry();
    await open();
    await talks.addCommitment(boss, 'anna', { owner: 'employee', text: 'Läsa boken', dueOn: '2026-12-15' });
    const round = await r.run(actor(boss), 'talks.talks', {});
    expect(checkContract(TalksOutputSchema, round)).toBe(true);
    const own = await r.run<{ rows: unknown[] }>(actor(asAnna), 'talks.commitments', {});
    expect(checkContract(CommitmentsOutputSchema, own)).toBe(true);
    expect(own.rows).toHaveLength(1);
    const about = await r.run(actor(boss), 'talks.commitments', { person: 'anna.a' });
    expect(checkContract(CommitmentsOutputSchema, about)).toBe(true);
    await expect(r.run(actor(asAnna), 'talks.talks', {})).rejects.toThrow('Du saknar behörighet för åtgärden.');
  });
});
