import { beforeEach, describe, expect, test } from 'bun:test';
import {
  checkContract,
  CommitmentsOutputSchema,
  TalksOutputSchema,
  type AuthenticatedContext,
  type StaffOverview,
  type StaffPerson,
} from '../../packages/contracts/src/index';
import { menuEligible, viewProblem, type Actor } from '../../packages/connectors/src/index';
import { ForbiddenError } from '../../apps/server/src/context';
import { memoryTalkStore, type MemoryTalkStore } from '../../apps/server/src/modules/talks/adapters/memory';
import { talksConnector } from '../../apps/server/src/modules/talks/capabilities';
import { swedishDayAndMonth, normaliseText, orderCommitmentRows } from '../../apps/server/src/modules/talks/domain';
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
const NAMES = ['Anna Andersson', 'Bo Berg', 'Cia Carlsson', 'Dan Dahl', 'Eve Ek', 'Karin Chef', 'Olle Chef'];

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
const asAnna = personaOf('anna', 'employee', 'Anna Andersson');
const asBo = personaOf('bo', 'employee', 'Bo Berg');

let now: Date;
let n: number;
let staff: Map<string, StaffOverview>;
let bookings: ReadonlyMap<string, { at: string }> | undefined;
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
    persons: [anna, bo, cia, dan, eve].map(p => ({
      id: p.id,
      organisationId: ORG,
      name: p.name,
      userName: p.userName,
    })),
  });
  talks = talkUsecases({
    store,
    staff: async persona => staff.get(persona.id) ?? { units: [] },
    bookings: async () => bookings,
    clock: () => now,
    ids: () => 'id-' + ++n,
  });
});
const at = () => now.toISOString();
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
    expect(store.calls()[0]).toEqual({
      op: 'open',
      threadId,
      personId: 'anna',
      commitmentId: forAnna,
      dueOn: '2026-12-15',
      at: at(),
    });
    expect(store.calls()[1]).toMatchObject({ op: 'open', personId: 'boss', commitmentId: forBoss });
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

  test('the owner marks theirs done and the manager opens it again; the card follows; a repeat writes nothing', async () => {
    await open();
    const id = await talks.addCommitment(boss, 'anna', { owner: 'employee', text: 'Läsa boken', dueOn: '2026-12-15' });
    const threadId = store.state.commitments.get(id)!.threadId!;
    now = new Date('2026-11-12T10:00:00.000Z');
    await talks.completeCommitment(asAnna, id);
    await talks.completeCommitment(asAnna, id);
    expect(store.state.commitments.get(id)).toMatchObject({ doneAt: at(), doneBy: 'anna' });
    expect(store.state.cards.get(threadId)?.state).toBe('handled');
    now = new Date('2026-11-13T10:00:00.000Z');
    await talks.reopenCommitment(boss, id);
    await talks.reopenCommitment(boss, id);
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
        actor: 'person:boss',
        action: 'talks.commitment_reopened',
        subject: 'commitment:' + id,
        at: '2026-11-13T10:00:00.000Z',
        details: { roundId: expect.any(String), ownerRole: 'employee', by: 'manager' },
      },
    ]);
  });

  test('someone else is refused; a former manager is refused the day the assignment changes', async () => {
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

  test('the lists: a person by user name or id for their manager, and the reader own ones; open ones carry over into the next round', async () => {
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

    const annasOwn = await talks.commitments(asAnna);
    expect(annasOwn.rows.map(r => [r.ref, r.mine])).toEqual([
      ['commitment:talks:' + annas, true],
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
    await talks.reopenCommitment(boss, id);
    await talks.commitmentDue(store.state.commitments.get(id)!.threadId!, 1);
    await talks.exportDomain('operator:cli', ORG);
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
    const row = (ref: string, carried: boolean, done: boolean, dueOn: string) => ({ ref, carried, done, dueOn });
    expect(
      orderCommitmentRows([
        row('d', false, true, '2026-01-01'),
        row('b', false, false, '2026-12-01'),
        row('a', true, false, '2027-01-01'),
        row('c', false, false, '2026-11-01'),
      ]).map(r => r.ref),
    ).toEqual(['a', 'c', 'b', 'd']);
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

  test('it passes the registry validation, its reads are no model tools, and both views open without input', () => {
    const connector = talksConnector(talks, async () => boss);
    expect(() => registry()).not.toThrow();
    expect(connector).toMatchObject({ id: 'talks', kind: 'core', source: 'Utvecklingssamtal' });
    const reads = connector.capabilities;
    expect(reads.map(c => [c.name, c.kind, c.model])).toEqual([
      ['talks.talks', 'read', false],
      ['talks.commitments', 'read', false],
    ]);
    for (const c of reads) {
      expect(viewProblem(c, reads)).toBeUndefined();
      expect(menuEligible(c)).toBe(true);
    }
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
