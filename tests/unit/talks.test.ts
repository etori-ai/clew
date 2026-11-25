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
  modelReading,
  placesOf,
  viewProblem,
  type Actor,
  type RegistryOptions,
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
  bookingAsks,
  nextTalk,
  normaliseText,
  openWords,
  orderCommitmentRows,
  overdueWords,
  swedishDayAndMonth,
  swedishShortDay,
  workdaysBefore,
} from '../../apps/server/src/modules/talks/domain';
import {
  TalkError,
  talkInvitations,
  talkUsecases,
  type TalkUsecases,
} from '../../apps/server/src/modules/talks/usecases';
import { Registry, trustingRelations } from '../registry';

/**
 * The talks module's use cases (D96, D132) on the memory adapter, with a clock, ids and a staff port the test owns:
 * every mutation's audit row and that none carries an action point's text or a person's name; the card and the
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
    // As composition answers it: the people on the units the manager manages now, without themselves.
    reports: async managerId =>
      new Set(
        (staff.get(managerId)?.units ?? []).flatMap(u =>
          u.people.filter(p => p.id !== managerId && p.enabled !== false).map(p => p.id),
        ),
      ),
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
const DAN = { start: '2026-11-20T09:00:00.000Z', end: '2026-11-20T10:00:00.000Z' };
/** Dan's talk is booked: the manager registered the time the two agreed on (D132 item 4). */
const bookDan = () => talks.book(boss, 'dan', DAN);
/** The calendar module tells of an invitation, as composition binds it, in a transaction of the talks store. */
const invitations = <T>(fn: (port: ReturnType<typeof talkInvitations>) => Promise<T>) =>
  store.transaction(tx => fn(talkInvitations(tx, { ids: () => 'id-' + ++n })));
const invitation = (invitationId: string, managerId: string, employeeId: string, span = DAN) => ({
  actor: 'system:execution',
  invitationId,
  managerId,
  employeeId,
  ...span,
  at: at(),
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
        details: {
          organisationId: ORG,
          opensOn: '2026-10-01',
          dueOn: '2026-11-28',
          prepareDays: 5,
          closed: null,
          carried: 0,
        },
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
        details: {
          organisationId: ORG,
          opensOn: '2027-03-01',
          dueOn: '2027-05-31',
          prepareDays: 5,
          closed: first,
          carried: 0,
        },
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
    const bad = (input: Partial<{ label: string; opensOn: string; dueOn: string; prepareDays: number }>) =>
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
    // The working days a manager is reminded before a booked talk (D134): a whole number from 0 to 30.
    for (const prepareDays of [-1, 31, 2.5]) await expect(bad({ prepareDays })).rejects.toBeInstanceOf(TalkError);
    expect(store.audit()).toEqual([]);
  });

  test('the manager reads one row per person on the units they manage: each once, without themselves or the deactivated', async () => {
    await open();
    await talks.markHeld(boss, 'anna', { heldOn: '2026-11-03' });
    await bookDan();
    const out = await talks.round(boss);
    expect(checkContract(TalksOutputSchema, out)).toBe(true);
    expect(out.round).toEqual({ label: 'Utvecklingssamtal hösten 2026', opensOn: '2026-10-01', dueOn: '2026-11-28' });
    // Booked is the talk's own record: the read never says it could not tell.
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
        until: '2026-11-20T10:00:00.000Z',
        invited: false,
        own: true,
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

  test('without an open round there is nothing to read; in one, a person nobody has booked is missing', async () => {
    expect(await talks.round(boss)).toEqual({ round: null, rows: [] });
    await open();
    const out = await talks.round(boss);
    expect(out.rows.map(r => r.state)).toEqual(['missing', 'missing', 'missing']);
    expect(checkContract(TalksOutputSchema, out)).toBe(true);
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

describe('the booking (D132)', () => {
  const rowOf = async (manager: AuthenticatedContext, userName: string) =>
    (await talks.round(manager)).rows.find(r => r.userName === userName)!;
  const booked = () => store.audit().filter(a => a.action === 'talks.booked' || a.action === 'talks.booking_removed');
  /** The manager as the people table holds them: an invitation is recorded only between people of one organisation. */
  const known = (id: string, name: string) =>
    store.addPerson({ id, organisationId: ORG, name, userName: id, enabled: true });

  test('a manager registers the time of a talk by hand, changes it and removes it, each with its audit row', async () => {
    await open();
    const first = await talks.book(boss, 'dan', DAN);
    expect(first).toEqual({ id: expect.any(String), ...DAN });
    expect(await rowOf(boss, 'dan.d')).toMatchObject({
      state: 'booked',
      at: DAN.start,
      until: DAN.end,
      invited: false,
    });
    expect(store.state.talks.get(first.id)!.booking).toEqual({
      ...DAN,
      bookedBy: 'boss',
      bookedAt: at(),
      invitationId: null,
      calendar: null,
    });
    // The same time again changes nothing; another time replaces it on the same talk.
    await talks.book(boss, 'dan', DAN);
    const later = { start: '2026-11-24T12:00:00.000Z', end: '2026-11-24T13:00:00.000Z' };
    now = new Date('2026-11-11T09:00:00.000Z');
    expect((await talks.book(boss, 'dan', later)).id).toBe(first.id);
    expect(await rowOf(boss, 'dan.d')).toMatchObject({ state: 'booked', at: later.start, until: later.end });
    await talks.unbook(boss, 'dan');
    await talks.unbook(boss, 'dan');
    expect(await rowOf(boss, 'dan.d')).toEqual({
      ref: 'talk:talks:dan',
      userName: 'dan.d',
      name: 'Dan Dahl',
      state: 'missing',
      openCommitments: 0,
    });
    const roundId = expect.any(String);
    expect(booked()).toEqual([
      {
        actor: 'person:boss',
        action: 'talks.booked',
        subject: 'talk:' + first.id,
        at: '2026-11-10T09:00:00.000Z',
        details: { roundId, employeeId: 'dan', ...DAN, by: 'manager', replaced: false },
      },
      {
        actor: 'person:boss',
        action: 'talks.booked',
        subject: 'talk:' + first.id,
        at: at(),
        details: { roundId, employeeId: 'dan', ...later, by: 'manager', replaced: true },
      },
      {
        actor: 'person:boss',
        action: 'talks.booking_removed',
        subject: 'talk:' + first.id,
        at: at(),
        details: { roundId, employeeId: 'dan', by: 'manager' },
      },
    ]);
    // No name in any of them.
    for (const name of NAMES) expect(auditText()).not.toContain(name);
  });

  test('a time is written as it is stored, and one that is no span of at most a day is refused', async () => {
    await open();
    await talks.book(boss, 'dan', { start: '2026-11-20T10:00:00+01:00', end: '2026-11-20T11:00:00+01:00' });
    expect(await rowOf(boss, 'dan.d')).toMatchObject({ at: DAN.start, until: DAN.end });
    const before = booked().length;
    for (const span of [
      { start: DAN.end, end: DAN.start },
      { start: DAN.start, end: DAN.start },
      { start: DAN.start, end: '2026-11-22T09:00:00.000Z' },
      { start: 'i morgon', end: DAN.end },
    ])
      await expect(talks.book(boss, 'dan', span)).rejects.toBeInstanceOf(TalkError);
    expect(booked()).toHaveLength(before);
  });

  test('only a manager of the person books; not without an open round, and not a talk marked held', async () => {
    await expect(talks.book(boss, 'dan', DAN)).rejects.toThrow('Det finns ingen öppen omgång av utvecklingssamtal.');
    await open();
    await expect(talks.book(other, 'dan', DAN)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(talks.book(asAnna, 'dan', DAN)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(talks.unbook(other, 'dan')).rejects.toBeInstanceOf(ForbiddenError);
    await talks.markHeld(boss, 'dan', { heldOn: '2026-11-03' });
    await expect(talks.book(boss, 'dan', DAN)).rejects.toThrow('Samtalet är redan markerat som hållet.');
    expect(booked()).toEqual([]);
  });

  test('marking a booked talk held keeps when it was booked; undoing the mark shows the booking again', async () => {
    await open();
    const { id } = await bookDan();
    await talks.markHeld(boss, 'dan', { heldOn: '2026-11-09' });
    expect(await rowOf(boss, 'dan.d')).toMatchObject({ state: 'held', at: '2026-11-09' });
    expect(await rowOf(boss, 'dan.d')).not.toHaveProperty('until');
    expect(store.state.talks.get(id)!.booking).toMatchObject(DAN);
    await talks.unmarkHeld(boss, 'dan');
    expect(await rowOf(boss, 'dan.d')).toMatchObject({ state: 'booked', at: DAN.start });
  });

  test('one talk a person a round: every current manager reads the booking with its time, and either changes a time set by hand (Q12)', async () => {
    staff.set('co', { units: [{ unitId: 'u2', unitLabel: 'Enhet 2', people: [dan] }] });
    await open();
    const { id } = await talks.book(co, 'dan', DAN);
    for (const manager of [boss, co])
      expect(await rowOf(manager, 'dan.d')).toMatchObject({ state: 'booked', at: DAN.start, invited: false });
    const moved = { start: '2026-11-23T08:00:00.000Z', end: '2026-11-23T09:00:00.000Z' };
    expect((await talks.book(boss, 'dan', moved)).id).toBe(id);
    expect(store.state.talks.get(id)!.booking).toMatchObject({ ...moved, bookedBy: 'boss' });
    await talks.unbook(co, 'dan');
    expect((await rowOf(boss, 'dan.d')).state).toBe('missing');
  });

  test('a booking counts while the manager whose booking it is manages the person; after that the talk lacks a time and is booked again', async () => {
    staff.set('co', { units: [{ unitId: 'u2', unitLabel: 'Enhet 2', people: [dan] }] });
    await open();
    const { id } = await talks.book(co, 'dan', DAN);
    expect((await rowOf(boss, 'dan.d')).state).toBe('booked');
    // Lena moves to another unit: nothing is written here, and her booking counts for nobody.
    staff.set('co', { units: [{ unitId: 'u3', unitLabel: 'Enhet 3', people: [eve] }] });
    expect(await rowOf(boss, 'dan.d')).toEqual({
      ref: 'talk:talks:dan',
      userName: 'dan.d',
      name: 'Dan Dahl',
      state: 'missing',
      openCommitments: 0,
    });
    expect(store.state.talks.get(id)!.booking).toMatchObject({ bookedBy: 'co' });
    // She comes back: it counts again. She leaves, and Dan's manager books the talk anew.
    staff.set('co', { units: [{ unitId: 'u2', unitLabel: 'Enhet 2', people: [dan] }] });
    expect((await rowOf(boss, 'dan.d')).state).toBe('booked');
    staff.set('co', { units: [] });
    await talks.book(boss, 'dan', DAN);
    expect(store.state.talks.get(id)!.booking).toMatchObject({ bookedBy: 'boss' });
    expect(booked().at(-1)!.details).toMatchObject({ by: 'manager', replaced: true });
  });

  test('an invitation Clew sent books the talk; it is not changed by hand, and ends with the invitation', async () => {
    known('boss', 'Karin Chef');
    await open();
    await invitations(port => port.established(invitation('p1', 'boss', 'dan')));
    const talk = [...store.state.talks.values()].find(t => t.employeeId === 'dan')!;
    expect(talk.booking).toEqual({ ...DAN, bookedBy: 'boss', bookedAt: at(), invitationId: 'p1', calendar: null });
    expect(await rowOf(boss, 'dan.d')).toMatchObject({ state: 'booked', at: DAN.start, until: DAN.end, invited: true });
    // Told again of the same invitation: nothing more is written.
    await invitations(port => port.established(invitation('p1', 'boss', 'dan')));
    const sentence = 'Samtalet är bokat genom en inbjudan från Clew, så tiden kan inte ändras här.';
    await expect(talks.book(boss, 'dan', DAN)).rejects.toThrow(sentence);
    await expect(talks.unbook(boss, 'dan')).rejects.toThrow(sentence);
    // An invitation that carries nothing ends nothing; this one's end takes the booking with it, once.
    await invitations(port =>
      port.ended({ actor: 'assistant:obligation', invitationId: 'p0', why: 'declined', at: at() }),
    );
    await invitations(port =>
      port.ended({ actor: 'assistant:obligation', invitationId: 'p1', why: 'declined', at: at() }),
    );
    await invitations(port =>
      port.ended({ actor: 'assistant:obligation', invitationId: 'p1', why: 'declined', at: at() }),
    );
    expect((await rowOf(boss, 'dan.d')).state).toBe('missing');
    const roundId = expect.any(String);
    expect(booked()).toEqual([
      {
        actor: 'system:execution',
        action: 'talks.booked',
        subject: 'talk:' + talk.id,
        at: at(),
        details: {
          roundId,
          employeeId: 'dan',
          ...DAN,
          by: 'invitation',
          invitationId: 'p1',
          bookedBy: 'boss',
          replaced: false,
        },
      },
      {
        actor: 'assistant:obligation',
        action: 'talks.booking_removed',
        subject: 'talk:' + talk.id,
        at: at(),
        details: { roundId, employeeId: 'dan', by: 'invitation', invitationId: 'p1', why: 'declined' },
      },
    ]);
    // Now a time can be set by hand again.
    await expect(talks.book(boss, 'dan', DAN)).resolves.toMatchObject(DAN);
  });

  test('the invitation read back from the calendar replaces a time set by hand, and a later one the earlier', async () => {
    known('boss', 'Karin Chef');
    await open();
    await bookDan();
    const sent = { start: '2026-11-25T09:00:00.000Z', end: '2026-11-25T10:00:00.000Z' };
    await invitations(port => port.established(invitation('p1', 'boss', 'dan', sent)));
    expect(await rowOf(boss, 'dan.d')).toMatchObject({ at: sent.start, invited: true });
    expect(booked().at(-1)!.details).toMatchObject({ by: 'invitation', replaced: true });
    await invitations(port => port.established(invitation('p2', 'boss', 'dan', DAN)));
    // The first invitation no longer carries the booking, so its end changes nothing.
    await invitations(port => port.ended({ actor: 'system:execution', invitationId: 'p1', why: 'replaced', at: at() }));
    expect(await rowOf(boss, 'dan.d')).toMatchObject({ state: 'booked', at: DAN.start, invited: true });
  });

  test('an invitation books nothing without an open round, for a talk marked held, or for people the directory does not hold together', async () => {
    known('boss', 'Karin Chef');
    await invitations(port => port.established(invitation('p1', 'boss', 'dan')));
    await open();
    await talks.markHeld(boss, 'dan', { heldOn: '2026-11-03' });
    await invitations(port => port.established(invitation('p2', 'boss', 'dan')));
    await invitations(port => port.established(invitation('p3', 'nobody', 'bo')));
    store.addPerson({ id: 'far', organisationId: 'org-2', name: 'Fia Fjärran', userName: 'far', enabled: true });
    await invitations(port => port.established(invitation('p4', 'far', 'bo')));
    await invitations(port => port.established(invitation('p5', 'boss', 'bo', { start: DAN.end, end: DAN.start })));
    expect(booked()).toEqual([]);
    expect([...store.state.talks.values()].filter(t => t.booking)).toEqual([]);
  });

  test('an invitation of a manager who has left the person counts for nobody, and the next manager sets a time over it', async () => {
    known('co', 'Lena Chef');
    staff.set('co', { units: [{ unitId: 'u2', unitLabel: 'Enhet 2', people: [dan] }] });
    await open();
    await invitations(port => port.established(invitation('p1', 'co', 'dan')));
    expect(await rowOf(boss, 'dan.d')).toMatchObject({ state: 'booked', invited: true });
    await expect(talks.book(boss, 'dan', DAN)).rejects.toBeInstanceOf(TalkError);
    staff.set('co', { units: [] });
    expect((await rowOf(boss, 'dan.d')).state).toBe('missing');
    await talks.book(boss, 'dan', DAN);
    expect(await rowOf(boss, 'dan.d')).toMatchObject({ state: 'booked', invited: false });
    // The old invitation's end no longer touches the talk.
    await invitations(port => port.ended({ actor: 'system:execution', invitationId: 'p1', why: 'undone', at: at() }));
    expect((await rowOf(boss, 'dan.d')).state).toBe('booked');
  });

  test('a new round takes over the talks that are booked for a time still to come: the booking, its invitation and its cards move with it', async () => {
    known('boss', 'Karin Chef');
    const first = await open();
    // Dan's invitation is for the 20th; Anna's time was set by hand for the 5th, which has passed; Bo's talk was held.
    await invitations(port => port.established(invitation('p1', 'boss', 'dan')));
    now = new Date('2026-11-04T09:00:00.000Z');
    await talks.book(boss, 'anna', { start: '2026-11-05T09:00:00.000Z', end: '2026-11-05T10:00:00.000Z' });
    await talks.book(boss, 'bo', { start: '2026-11-25T09:00:00.000Z', end: '2026-11-25T10:00:00.000Z' });
    await talks.markHeld(boss, 'bo', { heldOn: '2026-11-04' });
    now = new Date('2026-11-10T09:00:00.000Z');
    const second = await talks.openRound('operator:cli', {
      organisationId: ORG,
      label: 'Nästa omgång',
      opensOn: '2026-11-10',
      dueOn: '2026-12-18',
    });
    // Dan is booked in the round that is open, by the same invitation, with nothing copied.
    expect(await rowOf(boss, 'dan.d')).toMatchObject({ state: 'booked', at: DAN.start, invited: true, own: true });
    const byRound = (roundId: string) =>
      [...store.state.talks.values()].filter(t => t.roundId === roundId).map(t => [t.employeeId, t.booking?.start]);
    expect(byRound(second)).toEqual([['dan', DAN.start]]);
    expect(byRound(first).sort()).toEqual(
      [
        ['anna', '2026-11-05T09:00:00.000Z'],
        ['bo', '2026-11-25T09:00:00.000Z'],
        ['dan', undefined],
      ].sort(),
    );
    // A talk whose time had passed, and one that was held, stay where they were: the new round starts them over.
    expect((await rowOf(boss, 'anna.a')).state).toBe('missing');
    expect((await rowOf(boss, 'bo')).state).toBe('missing');
    expect(store.audit().at(-1)).toMatchObject({
      action: 'talks.round_opened',
      subject: 'round:' + second,
      details: { closed: first, carried: 1 },
    });
    // The invitation still carries the booking: it is not changed by hand, and its end takes the booking off this round's talk.
    await expect(talks.unbook(boss, 'dan')).rejects.toBeInstanceOf(TalkError);
    await invitations(port => port.ended({ actor: 'person:boss', invitationId: 'p1', why: 'undone', at: at() }));
    expect((await rowOf(boss, 'dan.d')).state).toBe('missing');
    expect(byRound(second)).toEqual([['dan', undefined]]);
  });

  test('erasing the manager whose booking it is leaves the talk with the employee, booked by nobody', async () => {
    await open();
    const { id } = await bookDan();
    store.addPerson({ id: 'boss', organisationId: ORG, name: 'Karin Chef', userName: 'boss', enabled: false });
    expect(await talks.erasePerson('operator:cli', 'boss')).toMatchObject({ talks: 0, cleared: 1 });
    expect(store.state.talks.get(id)!.booking).toMatchObject({ ...DAN, bookedBy: null });
    staff.set('co', { units: [{ unitId: 'u2', unitLabel: 'Enhet 2', people: [dan] }] });
    expect((await rowOf(co, 'dan.d')).state).toBe('missing');
  });
});

describe('what the calendar holds against a booking (D133)', () => {
  const rowOf = async (manager: AuthenticatedContext, userName: string) =>
    (await talks.round(manager)).rows.find(r => r.userName === userName)!;
  const calendarAudit = () => store.audit().filter(a => a.action !== 'talks.round_opened');
  const known = (id: string, name: string) =>
    store.addPerson({ id, organisationId: ORG, name, userName: id, enabled: true });
  const MOVED = { start: '2026-11-23T12:00:00.000Z', end: '2026-11-23T13:00:00.000Z' };
  const seen = (invitationId: string, event: { start: string; end: string } | null) =>
    invitations(port => port.observed({ actor: 'assistant:scan', invitationId, event, at: at() }));
  /** Dan's talk is booked by an invitation the manager sent, read back from the calendar. */
  async function invited() {
    known('boss', 'Karin Chef');
    await open();
    await invitations(port => port.established(invitation('p1', 'boss', 'dan')));
    return [...store.state.talks.values()].find(t => t.employeeId === 'dan')!.id;
  }

  test('a meeting moved in the calendar is recorded beside the booking, which stands; the same reading again writes nothing, and agreeing again clears it', async () => {
    const id = await invited();
    // The calendar holds what was booked: nothing to record.
    await seen('p1', DAN);
    expect(store.state.talks.get(id)!.booking!.calendar).toBeNull();
    await seen('p1', { start: '2026-11-23T13:00:00+01:00', end: '2026-11-23T14:00:00+01:00' });
    await seen('p1', MOVED);
    expect(store.state.talks.get(id)!.booking).toMatchObject({ ...DAN, invitationId: 'p1', calendar: MOVED });
    // The talk is still booked at its own time, and the row says what the calendar holds and whose it is to settle.
    expect(await rowOf(boss, 'dan.d')).toMatchObject({
      state: 'booked',
      at: DAN.start,
      until: DAN.end,
      invited: true,
      own: true,
      calendar: MOVED,
    });
    expect(checkContract(TalksOutputSchema, await talks.round(boss))).toBe(true);
    await seen('p1', DAN);
    expect(store.state.talks.get(id)!.booking!.calendar).toBeNull();
    expect(await rowOf(boss, 'dan.d')).not.toHaveProperty('calendar');
    const details = { roundId: expect.any(String), employeeId: 'dan', invitationId: 'p1' };
    expect(calendarAudit().slice(1)).toEqual([
      {
        actor: 'assistant:scan',
        action: 'talks.calendar_differs',
        subject: 'talk:' + id,
        at: at(),
        details: { ...details, calendar: MOVED },
      },
      { actor: 'assistant:scan', action: 'talks.calendar_agrees', subject: 'talk:' + id, at: at(), details },
    ]);
    for (const name of NAMES) expect(auditText()).not.toContain(name);
  });

  test('a meeting gone from the calendar is recorded as gone; a span that cannot be read, an invitation that carries nothing and a held talk record nothing', async () => {
    const id = await invited();
    await seen('p1', { start: DAN.end, end: DAN.start });
    await seen('p0', null);
    expect(store.state.talks.get(id)!.booking!.calendar).toBeNull();
    await seen('p1', null);
    expect(store.state.talks.get(id)!.booking!.calendar).toBe('gone');
    expect(await rowOf(boss, 'dan.d')).toMatchObject({ state: 'booked', at: DAN.start, calendar: { gone: true } });
    expect(checkContract(TalksOutputSchema, await talks.round(boss))).toBe(true);
    expect(calendarAudit().at(-1)).toMatchObject({
      action: 'talks.calendar_differs',
      details: { calendar: { gone: true } },
    });
    // Marked held, the talk has nothing left to settle: the next reading clears what was recorded.
    await talks.markHeld(boss, 'dan', { heldOn: '2026-11-09' });
    expect(await rowOf(boss, 'dan.d')).not.toHaveProperty('calendar');
    await seen('p1', null);
    expect(store.state.talks.get(id)!.booking!.calendar).toBeNull();
    await seen('p1', MOVED);
    expect(store.state.talks.get(id)!.booking!.calendar).toBeNull();
  });

  test('a moved invitation moves the booking with it and settles the difference; told again, nothing more is written', async () => {
    const id = await invited();
    await seen('p1', MOVED);
    const move = { actor: 'person:boss', invitationId: 'p1', ...MOVED, at: at() };
    await invitations(port => port.moved(move));
    await invitations(port => port.moved(move));
    await invitations(port => port.moved({ ...move, invitationId: 'p0' }));
    expect(store.state.talks.get(id)!.booking).toEqual({
      ...MOVED,
      bookedBy: 'boss',
      bookedAt: at(),
      invitationId: 'p1',
      calendar: null,
    });
    expect(await rowOf(boss, 'dan.d')).toMatchObject({ state: 'booked', at: MOVED.start, until: MOVED.end });
    expect(await rowOf(boss, 'dan.d')).not.toHaveProperty('calendar');
    expect(calendarAudit().slice(2)).toEqual([
      {
        actor: 'person:boss',
        action: 'talks.booking_moved',
        subject: 'talk:' + id,
        at: at(),
        details: { roundId: expect.any(String), employeeId: 'dan', invitationId: 'p1', from: DAN, ...MOVED },
      },
    ]);
  });

  test('an invitation whose meeting is gone ends with the time removed, or kept as a time the manager set by hand', async () => {
    const id = await invited();
    await seen('p1', null);
    await invitations(port =>
      port.ended({
        actor: 'person:boss',
        invitationId: 'p1',
        why: 'cancelled',
        at: at(),
        keep: { managerId: 'boss' },
      }),
    );
    expect(store.state.talks.get(id)!.booking).toEqual({
      ...DAN,
      bookedBy: 'boss',
      bookedAt: at(),
      invitationId: null,
      calendar: null,
    });
    // It is a time set by hand now: no invitation carries it, and the manager changes it on the talk.
    expect(await rowOf(boss, 'dan.d')).toMatchObject({ state: 'booked', invited: false, own: true });
    expect(await rowOf(boss, 'dan.d')).not.toHaveProperty('calendar');
    expect(calendarAudit().at(-1)).toEqual({
      actor: 'person:boss',
      action: 'talks.booking_kept',
      subject: 'talk:' + id,
      at: at(),
      details: {
        roundId: expect.any(String),
        employeeId: 'dan',
        by: 'invitation',
        invitationId: 'p1',
        why: 'cancelled',
      },
    });
    await talks.unbook(boss, 'dan');
    // Without `keep`, the talk lacks a time.
    await invitations(port => port.established(invitation('p2', 'boss', 'dan')));
    await invitations(port =>
      port.ended({ actor: 'system:execution', invitationId: 'p2', why: 'cancelled', at: at() }),
    );
    expect((await rowOf(boss, 'dan.d')).state).toBe('missing');
    expect(calendarAudit().at(-1)).toMatchObject({ action: 'talks.booking_removed', details: { why: 'cancelled' } });
  });

  test('another manager of the person reads the difference, and it is not theirs to settle', async () => {
    await invited();
    staff.set('co', { units: [{ unitId: 'u2', unitLabel: 'Enhet 2', people: [dan] }] });
    await seen('p1', MOVED);
    expect(await rowOf(co, 'dan.d')).toMatchObject({ state: 'booked', at: DAN.start, own: false, calendar: MOVED });
  });
});

describe('the cards before and after a booked talk (D134)', () => {
  const personas = new Map([boss, other, co, asAnna].map(p => [p.id, p]));
  const registry = () =>
    new Registry().register(
      talksConnector(talks, async a => {
        const p = personas.get(a.id);
        if (!p) throw new Error('unknown');
        return p;
      }),
    );
  const actor = (p: AuthenticatedContext): Actor => ({
    id: p.id,
    name: p.name,
    unitId: p.unitId,
    unitLabel: p.unitLabel,
    role: p.role,
  });
  const cards = async (p: AuthenticatedContext) => (await registry().scanOne(actor(p), 'talks')).drafts;

  test('working days are Monday to Friday, counted back from the day of the talk', () => {
    // Friday 20 November 2026: five working days before is Friday the 13th, across one weekend.
    expect(workdaysBefore('2026-11-20', 5)).toBe('2026-11-13');
    expect(workdaysBefore('2026-11-20', 1)).toBe('2026-11-19');
    expect(workdaysBefore('2026-11-16', 1)).toBe('2026-11-13');
    expect(workdaysBefore('2026-11-16', 6)).toBe('2026-11-06');
    expect(workdaysBefore('2026-11-20', 0)).toBe('2026-11-20');
  });

  test('a booking asks for preparation in the working days before it, for nothing while it goes on, and whether it was held from the day after', () => {
    const asks = (now: string, prepareDays = 5) => bookingAsks(DAN, prepareDays, now);
    expect(asks('2026-11-12T16:00:00.000Z')).toBeUndefined();
    expect(asks('2026-11-13T05:00:00.000Z')).toBe('prepare');
    expect(asks('2026-11-20T08:59:00.000Z')).toBe('prepare');
    // From its start to the end of that day: neither.
    expect(asks('2026-11-20T09:00:00.000Z')).toBeUndefined();
    expect(asks('2026-11-20T22:59:00.000Z')).toBeUndefined();
    // 23:00 UTC is the next day in Stockholm.
    expect(asks('2026-11-20T23:00:00.000Z')).toBe('held');
    expect(asks('2026-12-20T09:00:00.000Z')).toBe('held');
    // The reminder switched off: nothing before, the question after.
    expect(asks('2026-11-19T09:00:00.000Z', 0)).toBeUndefined();
    expect(asks('2026-11-21T09:00:00.000Z', 0)).toBe('held');
  });

  test('the manager whose booking it is gets one card to prepare, then one that asks whether the talk was held; neither names anyone', async () => {
    const roundId = await open();
    await bookDan();
    // Tuesday 10 November: ten days before the talk, nothing is asked.
    expect(await cards(boss)).toEqual([]);
    now = new Date('2026-11-13T05:00:00.000Z');
    const revision = `${DAN.start}/${DAN.end}`;
    const row = {
      ref: 'talk:talks:dan',
      label: 'Medarbetare',
      detail: 'fre 20 nov kl. 10:00–11:00',
      selectable: false,
      selected: false,
      subject: { entity: 'person' as const, key: 'dan.d' },
    };
    const open_ = {
      id: 'open',
      label: 'Visa samtalet',
      capability: 'talks.person',
      kind: 'read' as const,
      role: 'primary' as const,
      target: 'panel' as const,
      // Clew is the source, so its card names the person by Clew's id, never by the user name (D122).
      input: { keys: ['dan'] },
    };
    expect(await cards(boss)).toEqual([
      {
        topic: `talks:prepare:dan:${roundId}`,
        area: 'talks',
        title: 'Förbered utvecklingssamtalet',
        summary:
          'Ett utvecklingssamtal är bokat fre 20 nov kl. 10:00–11:00. Öppna samtalet för att se åtgärdspunkterna från förra gången.',
        reason: 'Bokat samtal',
        deadline: '2026-11-20',
        items: [row],
        actions: [open_],
        occurrences: [{ key: 'talks:prepare:dan', revision, period: roundId }],
      },
    ]);
    // While the talk goes on and for the rest of that day nothing is asked: the card to prepare is resolved.
    now = new Date('2026-11-20T09:30:00.000Z');
    expect(await cards(boss)).toEqual([]);
    now = new Date('2026-11-21T05:00:00.000Z');
    const after = await cards(boss);
    expect(after).toEqual([
      {
        topic: `talks:held:dan:${roundId}`,
        area: 'talks',
        title: 'Hölls utvecklingssamtalet?',
        summary:
          'Tiden för samtalet var fre 20 nov kl. 10:00–11:00. Markera det som hållet, eller ta bort tiden om det inte blev av.',
        reason: 'Tiden har passerat',
        items: [row],
        actions: [open_],
        occurrences: [{ key: 'talks:held:dan', revision, period: roundId }],
      },
    ]);
    for (const name of NAMES) expect(JSON.stringify(after)).not.toContain(name);
    // Answered either way, nothing is asked any more.
    await talks.markHeld(boss, 'dan', { heldOn: '2026-11-20' });
    expect(await cards(boss)).toEqual([]);
    await talks.unmarkHeld(boss, 'dan');
    expect((await cards(boss)).map(c => c.title)).toEqual(['Hölls utvecklingssamtalet?']);
    await talks.unbook(boss, 'dan');
    expect(await cards(boss)).toEqual([]);
  });

  test('a talk moved to another time is a card that comes back; a round that reminds no days before asks only afterwards', async () => {
    await open();
    await bookDan();
    now = new Date('2026-11-16T08:00:00.000Z');
    const [first] = await cards(boss);
    const later = { start: '2026-11-25T09:00:00.000Z', end: '2026-11-25T10:00:00.000Z' };
    await talks.book(boss, 'dan', later);
    // Wednesday the 25th: five working days before is the 18th, so on the 16th nothing is asked yet.
    expect(await cards(boss)).toEqual([]);
    now = new Date('2026-11-18T08:00:00.000Z');
    const [again] = await cards(boss);
    expect(again!.topic).toBe(first!.topic);
    expect(again!.occurrences![0]!.revision).not.toBe(first!.occurrences![0]!.revision);
    expect(again).toMatchObject({ deadline: '2026-11-25', items: [{ detail: 'ons 25 nov kl. 10:00–11:00' }] });
    // The next round reminds nobody beforehand.
    now = new Date('2026-11-18T09:00:00.000Z');
    await talks.openRound('operator:cli', {
      organisationId: ORG,
      label: 'Utan påminnelse',
      opensOn: '2026-11-18',
      dueOn: '2026-12-18',
      prepareDays: 0,
    });
    await talks.book(boss, 'dan', later);
    now = new Date('2026-11-24T09:00:00.000Z');
    expect(await cards(boss)).toEqual([]);
    now = new Date('2026-11-26T09:00:00.000Z');
    expect((await cards(boss)).map(c => c.title)).toEqual(['Hölls utvecklingssamtalet?']);
  });

  test('only the manager whose booking it is gets the cards, and only while they manage the person', async () => {
    staff.set('co', { units: [{ unitId: 'u2', unitLabel: 'Enhet 2', people: [dan] }] });
    await open();
    await talks.book(co, 'dan', DAN);
    now = new Date('2026-11-21T05:00:00.000Z');
    expect((await cards(co)).map(c => c.title)).toEqual(['Hölls utvecklingssamtalet?']);
    expect(await cards(boss)).toEqual([]);
    expect(await cards(other)).toEqual([]);
    expect(await cards(asAnna)).toEqual([]);
    // Lena leaves Dan: her booking counts for nobody, and nobody is asked about it.
    staff.set('co', { units: [] });
    expect(await cards(co)).toEqual([]);
    expect(await cards(boss)).toEqual([]);
  });

  test('a card about a person without a user name has no subject to link, and opens the round where the talk is found by its time', async () => {
    await open();
    await talks.book(boss, 'bo', DAN);
    now = new Date('2026-11-16T08:00:00.000Z');
    const [card] = await cards(boss);
    expect(card!.items).toEqual([
      {
        ref: 'talk:talks:bo',
        label: 'Medarbetare',
        detail: 'fre 20 nov kl. 10:00–11:00',
        selectable: false,
        selected: false,
      },
    ]);
    expect(card!.actions).toEqual([
      {
        id: 'open',
        label: 'Visa omgången',
        capability: 'talks.talks',
        kind: 'read',
        role: 'primary',
        target: 'panel',
      },
    ]);
    // The read it opens answers without input, and lists the talk with its time.
    const round = await registry().run<{ rows: Array<{ name: string; at?: string }> }>(actor(boss), 'talks.talks', {});
    expect(round.rows.find(r => r.at === DAN.start)?.name).toBe('Bo Berg');
  });

  test('a meeting that was moved in the calendar and a talk that is coming are two cards about one person', async () => {
    store.addPerson({ id: 'boss', organisationId: ORG, name: 'Karin Chef', userName: 'boss', enabled: true });
    await open();
    await invitations(port => port.established(invitation('p1', 'boss', 'dan')));
    await invitations(port =>
      port.observed({
        actor: 'assistant:scan',
        invitationId: 'p1',
        event: { start: '2026-11-23T12:00:00.000Z', end: '2026-11-23T13:00:00.000Z' },
        at: at(),
      }),
    );
    now = new Date('2026-11-16T08:00:00.000Z');
    expect((await cards(boss)).map(c => c.title)).toEqual([
      'Mötet för ett utvecklingssamtal har flyttats i kalendern',
      'Förbered utvecklingssamtalet',
    ]);
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
    // The same generation again has fired already, and a generation never scheduled is stale: nothing is written.
    expect(await talks.commitmentDue(threadId, 1)).toBe(false);
    expect(await talks.commitmentDue(threadId, 2)).toBe(false);
    expect(store.state.timers.get(threadId)).toMatchObject({ generation: 1, state: 'fired' });
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
    // Opened again, the card's timer is at its second generation; it is due the morning after the day.
    now = new Date('2026-12-16T05:00:00.000Z');
    expect(await talks.commitmentDue(store.state.commitments.get(id)!.threadId!, 2)).toBe(true);
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
  const registry = (options: RegistryOptions = {}) =>
    new Registry(options).register(
      talksConnector(talks, async a => {
        const p = personas.get(a.id);
        if (!p) throw new Error('unknown');
        return p;
      }),
    );

  test('it passes the registry validation, only the round is a model tool, and the profile views open without input', () => {
    const connector = talksConnector(talks, async () => boss);
    expect(() => registry()).not.toThrow();
    expect(connector).toMatchObject({ id: 'talks', kind: 'core', source: 'Utvecklingssamtal' });
    const reads = connector.capabilities;
    // The round is opened to the model (D122 item 3, D141 rule 4); the action points never (D96 item 6), nor the reads
    // about an entity (D97 item 7).
    expect(reads.map(c => [c.name, c.kind, c.model])).toEqual([
      ['talks.talks', 'read', true],
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
    // Of the domain the round alone is a tool, for a manager; never the reads about a person or a unit.
    expect(
      registry()
        .tools(actor(boss))
        .map(t => t.name),
    ).toEqual(['talks.talks']);
    expect(
      registry()
        .tools(actor(asAnna))
        .map(t => t.name),
    ).toEqual([]);
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
    await bookDan();
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

  test('a talk another of the person’s managers booked is Bokat with its time, and counts as booked for the unit (Q12, D132)', async () => {
    const r = registry();
    await open();
    // Lena manages Dan too, and it is she who registered the time.
    staff.set('co', { units: [{ unitId: 'u2', unitLabel: 'Enhet 2', people: [dan] }] });
    await talks.book(co, 'dan', DAN);
    const person = await r.run(actor(boss), 'talks.person', { keys: ['dan.d'] });
    expect(checkContract(PersonTalksOutputSchema, person)).toBe(true);
    expect(person).toMatchObject({
      rows: [{ key: 'dan.d', state: 'Bokat', at: DAN.start, next: 'fre 20 nov', open: 'Inga' }],
    });
    expect(await r.run(actor(boss), 'talks.unit', { keys: ['u2'] })).toMatchObject({
      rows: [{ key: 'u2', held: '0 av 2 hållna', booked: '1 bokat', missing: '1 saknas' }],
    });
  });

  test('talks.unit counts held, booked and missing per unit the manager manages; another unit is no row', async () => {
    const r = registry();
    await open();
    await talks.markHeld(boss, 'anna', { heldOn: '2026-11-03' });
    await bookDan();
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

  test('the round is the assistant’s to read for a manager (D122 item 3, D141 rule 4): where each report stands, never what an action point says', async () => {
    const r = registry();
    await open();
    await talks.addCommitment(boss, 'anna', { owner: 'employee', text: 'Läsa boken', dueOn: '2026-12-15' });
    const round = await r.run(actor(boss), 'talks.talks', {});
    const read = JSON.stringify(modelReading(talksView, 'Utvecklingssamtal', round));
    // Each of the manager's people with the state in words and the user name another read takes; nothing of the text,
    // no ref and no link.
    expect(read).toContain('Anna Andersson');
    expect(read).toContain('anna.a');
    expect(read).not.toContain('Läsa boken');
    expect(read).not.toContain('talk:');
    // A manager of another unit reads his own people alone; an employee is refused, and offered nothing of the domain.
    const others = await r.run<{ rows: Array<{ userName: string }> }>(actor(other), 'talks.talks', {});
    expect(others.rows.some(row => row.userName === 'anna.a')).toBe(false);
    await expect(r.run(actor(asAnna), 'talks.talks', {})).rejects.toThrow('Du saknar behörighet för åtgärden.');
    expect(r.views(actor(boss)).find(v => v.capability === 'talks.talks')?.assistant).toBe(true);
    expect(r.views(actor(asAnna)).some(v => v.assistant)).toBe(false);
  });

  test('the scan asks for a card when a meeting was moved or is gone, for the manager whose booking it is; it names nobody and goes when the difference is settled (D133)', async () => {
    const r = registry();
    const scan = async (p: AuthenticatedContext) => r.scanOne(actor(p), 'talks');
    // No round, then nothing that differs: a complete observation of no cards.
    expect(await scan(boss)).toMatchObject({ drafts: [], observation: { completeness: 'complete', exhausted: true } });
    store.addPerson({ id: 'boss', organisationId: ORG, name: 'Karin Chef', userName: 'boss', enabled: true });
    const roundId = await open();
    await invitations(port => port.established(invitation('p1', 'boss', 'dan')));
    expect((await scan(boss)).drafts).toEqual([]);
    const moved = { start: '2026-11-23T12:00:00.000Z', end: '2026-11-23T13:00:00.000Z' };
    const seen = (event: { start: string; end: string } | null) =>
      invitations(port => port.observed({ actor: 'assistant:scan', invitationId: 'p1', event, at: at() }));
    await seen(moved);
    const { drafts, observation } = await scan(boss);
    expect(observation).toMatchObject({ scope: 'u1:manager', completeness: 'complete', exhausted: true });
    expect(drafts).toEqual([
      {
        topic: `talks:calendar:dan:${roundId}`,
        area: 'talks',
        title: 'Mötet för ett utvecklingssamtal har flyttats i kalendern',
        summary:
          'Mötet ligger nu mån 23 nov kl. 13:00–14:00. Samtalet i Clew står kvar på fre 20 nov kl. 10:00–11:00. Öppna samtalet och välj vilken tid som gäller.',
        reason: 'Flyttat i kalendern',
        items: [
          {
            ref: 'talk:talks:dan',
            label: 'Medarbetare',
            detail: 'fre 20 nov kl. 10:00–11:00',
            selectable: false,
            selected: false,
            subject: { entity: 'person', key: 'dan.d' },
          },
        ],
        actions: [
          {
            id: 'open',
            label: 'Visa samtalet',
            capability: 'talks.person',
            kind: 'read',
            role: 'primary',
            target: 'panel',
            input: { keys: ['dan'] },
          },
        ],
        occurrences: [{ key: 'talks:calendar:dan', revision: `${moved.start}/${moved.end}`, period: roundId }],
      },
    ]);
    // Nobody is named on the card: the person is the row's subject, and the action names them by id, not user name.
    for (const name of NAMES) expect(JSON.stringify(drafts)).not.toContain(name);
    expect(JSON.stringify(drafts[0]!.actions)).not.toContain('dan.d');
    // The read the card opens, with the card's own input, answers for Dan: the registry resolves Clew's id as the rule
    // does (D117), to the user name the read is given (`tests/unit/asked-about.test.ts` holds the rule itself).
    const byId = registry({
      relations: async (a, e, keys, admits, options) =>
        (await trustingRelations(a, e, keys, admits)).map(k =>
          options?.ids && k.asked === 'dan' ? { ...k, key: 'dan.d' } : k,
        ),
    });
    expect(await byId.run(actor(boss), 'talks.person', drafts[0]!.actions[0]!.input!)).toMatchObject({
      rows: [{ key: 'dan.d' }],
    });
    // Gone is another card text and another revision of the same occurrence, so a handled card comes back.
    await seen(null);
    const [gone] = (await scan(boss)).drafts;
    expect(gone).toMatchObject({
      topic: `talks:calendar:dan:${roundId}`,
      title: 'Mötet för ett utvecklingssamtal finns inte längre i kalendern',
      summary:
        'Samtalet i Clew står kvar på fre 20 nov kl. 10:00–11:00. Öppna samtalet och välj om tiden ska stå kvar.',
      reason: 'Borttaget i kalendern',
      occurrences: [{ key: 'talks:calendar:dan', revision: 'gone', period: roundId }],
    });
    // Another manager of the person, and a manager of other people, get no card; an employee has none.
    staff.set('co', { units: [{ unitId: 'u2', unitLabel: 'Enhet 2', people: [dan] }] });
    personas.set('co', co);
    expect((await scan(co)).drafts).toEqual([]);
    expect((await scan(other)).drafts).toEqual([]);
    expect((await scan(asAnna)).drafts).toEqual([]);
    // Settled: the cause is gone, so the next scan asks for no card and the platform resolves the open one.
    await invitations(port =>
      port.ended({ actor: 'person:boss', invitationId: 'p1', why: 'cancelled', at: at(), keep: { managerId: 'boss' } }),
    );
    expect((await scan(boss)).drafts).toEqual([]);
  });
});
