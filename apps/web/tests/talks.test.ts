import { describe, expect, test } from 'bun:test';
import type { CommitmentsResult, StaffUnit, TalksResult } from '@clew/contracts';
import { ApiError } from '../src/api-error';
import { refused, unlessRefused } from '../src/query-policy';
import {
  commitmentCounts,
  dueText,
  groupCommitments,
  isOverdue,
  personKey,
  splitMine,
  talkAtText,
  talkCounts,
  talkFor,
  talkStateTone,
  talkStateWord,
  talkStatus,
  talksByPerson,
  unitTalks,
} from '../src/talks';

const unit: StaffUnit = {
  unitId: 'unit-skola',
  unitLabel: 'Skönsmons skola',
  people: [
    { id: 'anna', name: 'Anna Lindqvist', userName: 'anna.lindqvist', email: null, role: 'employee', enabled: true },
    { id: 'erik', name: 'Erik Nyström', userName: null, email: null, role: 'employee', enabled: true },
    { id: 'sara', name: 'Sara Pettersson', userName: 'sara.pettersson', email: null, role: 'employee', enabled: false },
  ],
};
const talkRow = (personId: string, state: 'missing' | 'booked' | 'held', change: object = {}) => ({
  ref: `talk:talks:${personId}`,
  userName: personId,
  name: personId,
  personId,
  state,
  openCommitments: 0,
  ...change,
});
const round: TalksResult = {
  round: { label: 'Utvecklingssamtal hösten 2026', opensOn: '2026-09-01', dueOn: '2026-11-30' },
  rows: [
    talkRow('erik', 'booked', { at: '2026-11-11T08:00:00.000Z', openCommitments: 1 }),
    talkRow('anna', 'held', { at: '2026-11-03', openCommitments: 2 }),
    talkRow('lena', 'missing'),
  ],
  writable: true,
  source: 'Utvecklingssamtal',
};
type Row = CommitmentsResult['rows'][number];
const point = (id: string, change: Partial<Row>): Row => ({
  ref: `commitment:talks:${id}`,
  userName: 'anna.lindqvist',
  name: 'Anna Lindqvist',
  personId: 'anna',
  id,
  owner: 'employee',
  mine: false,
  text: id,
  dueOn: '2026-12-01',
  done: false,
  carried: false,
  ...change,
});

describe('the round on Personal (D96 item 7)', () => {
  test("each person on a unit gets their row by id, in the unit's order; one the round does not list gets null", () => {
    expect(unitTalks(unit, round).map(({ person, talk }) => [person.id, talk?.state ?? null])).toEqual([
      ['anna', 'held'],
      ['erik', 'booked'],
      ['sara', null],
    ]);
    expect(talkFor('erik', round)?.openCommitments).toBe(1);
    expect(talkFor('nobody', round)).toBeNull();
    expect([...talksByPerson(round).keys()]).toEqual(['erik', 'anna', 'lena']);
  });
  test('no talks system (null) and a read not yet answered both join to nothing', () => {
    expect(unitTalks(unit, null).every(({ talk }) => talk === null)).toBe(true);
    expect(talksByPerson(undefined).size).toBe(0);
    expect(talkFor('anna', null)).toBeNull();
  });
  test('the action points of a person are asked for by user name, else id', () => {
    expect(personKey(unit.people[0]!)).toBe('anna.lindqvist');
    expect(personKey(unit.people[1]!)).toBe('erik');
  });
});

describe('the words of a talk (D96 item 2)', () => {
  test('each state has its Swedish word and tone', () => {
    expect(talkStateWord).toEqual({ missing: 'Saknas', booked: 'Bokat', held: 'Hållet' });
    expect(talkStateTone).toEqual({ missing: 'warning', booked: 'neutral', held: 'success' });
    expect(talkStatus('held')).toEqual({ label: 'Hållet', variant: 'success' });
  });
  test('a booked time and a held day read in Swedish time; a missing talk has no time', () => {
    expect(talkAtText({ at: '2026-11-11T08:00:00.000Z' })).toBe('ons 11 nov. kl. 09:00');
    expect(talkAtText({ at: '2026-11-03' })).toBe('tis 3 nov.');
    expect(talkAtText({})).toBeNull();
    expect(dueText({ dueOn: '2026-11-20' })).toBe('fre 20 nov.');
  });
  test('the counts a header may show: per state, the people listed and the open action points', () => {
    expect(talkCounts(round)).toEqual({ missing: 1, booked: 1, held: 1, total: 3, openCommitments: 3 });
    expect(talkCounts(null)).toEqual({ missing: 0, booked: 0, held: 0, total: 0, openCommitments: 0 });
  });
});

describe('action points (D96 item 4)', () => {
  const rows = [
    point('done-1', { done: true, doneAt: '2026-11-02T10:00:00.000Z' }),
    point('open-1', { dueOn: '2026-11-01', mine: true }),
    point('carried-1', { carried: true, dueOn: '2026-06-30' }),
    point('open-2', { owner: 'manager', mine: true }),
    point('carried-2', { carried: true, mine: true }),
  ];
  test('carried over first, then this round, then done, each in the order the server gave', () => {
    const { carried, open, done } = groupCommitments(rows);
    expect(carried.map(r => r.id)).toEqual(['carried-1', 'carried-2']);
    expect(open.map(r => r.id)).toEqual(['open-1', 'open-2']);
    expect(done.map(r => r.id)).toEqual(['done-1']);
  });
  test("the reader's own list splits into theirs and the other party's", () => {
    const { mine, theirs } = splitMine(rows);
    expect(mine.map(r => r.id)).toEqual(['open-1', 'open-2', 'carried-2']);
    expect(theirs.map(r => r.id)).toEqual(['done-1', 'carried-1']);
  });
  test('an open action point past its day is overdue; a done one never is', () => {
    expect(isOverdue({ done: false, dueOn: '2026-11-03' }, '2026-11-04')).toBe(true);
    expect(isOverdue({ done: false, dueOn: '2026-11-04' }, '2026-11-04')).toBe(false);
    expect(isOverdue({ done: true, dueOn: '2026-11-03' }, '2026-11-04')).toBe(false);
    expect(commitmentCounts(rows, '2026-11-04')).toEqual({ open: 4, carried: 2, overdue: 2, done: 1 });
  });
});

describe('a refused read is nothing to show (D96 item 9)', () => {
  test('the registry refusing the capability is a refusal; a source that failed is not', () => {
    expect(refused(new ApiError(400, 'Du saknar behörighet för åtgärden.'))).toBe(true);
    expect(refused(new ApiError(400, 'Inget system för utvecklingssamtal är anslutet just nu.'))).toBe(true);
    // A talks read switched off, or of a connector that leaves the person out, answers as an unknown one (D23).
    expect(refused(new ApiError(404, 'Okänd förmåga.'))).toBe(true);
    expect(refused(new ApiError(403, 'Sidan Personal är för den som är chef för en enhet.'))).toBe(true);
    expect(refused(new ApiError(400, 'Utvecklingssamtal svarade inte som väntat.'))).toBe(false);
    expect(refused(new ApiError(503, 'Något gick fel. Försök igen.'))).toBe(false);
    expect(refused(new Error('Session unavailable'))).toBe(false);
  });
  test('a refusal resolves to null, any other failure still rejects', async () => {
    expect(await unlessRefused(Promise.resolve(round))).toBe(round);
    expect(await unlessRefused(Promise.reject(new ApiError(400, 'Du saknar behörighet för åtgärden.')))).toBeNull();
    const failure = new ApiError(400, 'Utvecklingssamtal svarade inte som väntat.');
    await expect(unlessRefused(Promise.reject(failure))).rejects.toBe(failure);
  });
});
