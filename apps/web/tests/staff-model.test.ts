import { describe, expect, test } from 'bun:test';
import type { EntityList, EntityRef, EntityRows, EntitySource, View, ViewField } from '@clew/contracts';
import {
  answerOf,
  byNeed,
  lensNeed,
  markText,
  marksFor,
  pageHref,
  peopleLine,
  rowOf,
  silentOf,
  silentText,
  sourcesRead,
  valueCounts,
  type Answer,
} from '../src/pages/staff-model';

/** Personal (D97): a lens over five people, as the talks module declares its read about a person. */
const [state, next, open, overdue, risk]: ViewField[] = [
  { key: 'state', label: 'Samtal', format: 'status', tones: { Saknas: 'warn', Bokat: 'none', Hållet: 'ok' } },
  { key: 'next', label: 'Nästa samtal', format: 'status', tones: { 'Inte bokat': 'warn' } },
  { key: 'open', label: 'Åtgärdspunkter' },
  { key: 'overdue', label: 'Försenade', format: 'status', tones: { '*': 'warn' } },
  { key: 'risk', label: 'Risk', format: 'status', tones: { Hög: 'alert' } },
];
const view: View = { kind: 'list', title: 'state', fields: [state!, next!, open!, overdue!, risk!] };
const presenceField: ViewField = {
  key: 'presence',
  label: 'Närvaro',
  format: 'status',
  tones: { 'Sjuk · dag 1': 'none' },
};
const lens: EntitySource = {
  capability: 'talks.person',
  connector: 'talks',
  source: 'Utvecklingssamtal',
  title: 'Utvecklingssamtal',
  view,
  page: { title: 'Öppna samtalet', href: '/staff?talk={id}' },
};
const presence: EntitySource = {
  capability: 'hr.person',
  connector: 'hr',
  source: 'Personalsystemet',
  title: 'Frånvaro',
  view: { kind: 'list', title: 'presence', fields: [presenceField] },
};
const person = (key: string, id?: string): EntityRef => ({ kind: 'person', key, name: key, ...(id ? { id } : {}) });
const people = ['anna', 'erik', 'johan', 'karin', 'maria', 'omar'].map(k => person(k, k));
const rows: EntityRows = {
  capability: lens.capability,
  status: 'ok',
  heading: 'Utvecklingssamtal 2026',
  rows: [
    { key: 'Anna', state: 'Bokat', next: 'mån 16 nov', open: 'Inga' },
    { key: 'erik', state: 'Bokat', next: 'tis 17 nov', open: '1 öppen', risk: 'Hög' },
    { key: 'johan', state: 'Bokat', next: 'tors 12 nov', open: '3 öppna', overdue: '2 försenade' },
    { key: 'karin', state: 'Saknas', next: 'Inte bokat', open: 'Inga' },
    { key: 'maria', state: 'Hållet', next: 'Hållet 4 nov', open: '2 öppna' },
  ],
};
const list: EntityList = {
  kind: 'person',
  groups: [{ id: 'unit-skola', label: 'Bergsåkers skola', entities: people }],
  columns: [
    { capability: presence.capability, source: presence.source, title: presence.title, field: presenceField },
    { capability: lens.capability, source: lens.source, title: lens.title, field: next! },
  ],
  lenses: [lens, presence],
  actions: [],
};
const answers = (talks: Answer, hr: Answer = answerOf({ capability: 'hr.person', status: 'ok', rows: [] }, false)) =>
  new Map<string, Answer>([
    [lens.capability, talks],
    [presence.capability, hr],
  ]);

describe('Personal (D97)', () => {
  test('a row is found by its key without regard to case, and a source that did not answer has none', () => {
    const answer = answerOf(rows, false);
    expect(rowOf(answer, 'anna')?.state).toBe('Bokat');
    expect(rowOf(answer, 'ANNA')?.state).toBe('Bokat');
    expect(rowOf(answerOf({ capability: 'x', status: 'timeout', rows: [] }, false), 'anna')).toBeUndefined();
    expect(answerOf(undefined, true).status).toBe('failed');
    expect(answerOf(undefined, false).status).toBe('pending');
  });
  test('the page reads every lens and every column once, lenses first', () => {
    expect(sourcesRead(list)).toEqual(['talks.person', 'hr.person']);
  });
  test('under a lens alert comes first, then warn, then the rest, then nobody the source knows, each in order', () => {
    expect(byNeed(people, lens, answerOf(rows, false)).map(p => p.key)).toEqual([
      'erik',
      'johan',
      'karin',
      'anna',
      'maria',
      'omar',
    ]);
  });
  test('the Visa menu counts the rows that need the reader, in the strongest tone, and nothing when none do', () => {
    expect(lensNeed(lens, answerOf(rows, false))).toEqual({ count: 3, tone: 'alert' });
    const calm = { ...rows, rows: rows.rows.filter(r => r.key === 'maria') };
    expect(lensNeed(lens, answerOf(calm, false))).toBeNull();
    expect(lensNeed(lens, answerOf({ ...rows, status: 'unavailable', rows: [] }, false))).toBeNull();
    expect(lensNeed(lens, undefined)).toBeNull();
  });
  test('the counts per state follow the order of the tones and leave out what no row has', () => {
    expect(valueCounts(view, rows.rows)).toBe('1 saknas, 3 bokat, 1 hållet');
    expect(
      valueCounts(
        view,
        rows.rows.filter(r => r.state === 'Bokat'),
      ),
    ).toBe('3 bokat');
    expect(valueCounts(presence.view, [{ key: 'a', presence: 'I tjänst' }])).toBe('1 i tjänst');
  });
  test('a mark of the title field carries its label; any other is the source’s words', () => {
    expect(markText(view, state!, 'Saknas')).toBe('Samtal saknas');
    expect(markText(view, overdue!, '2 försenade')).toBe('2 försenade');
  });
  test('marks are the fields that need the reader and are not a column already', () => {
    const marks = marksFor(list, answers(answerOf(rows, false)), 'karin');
    // "Inte bokat" is the column Nästa samtal; the missing talk is a mark.
    expect(marks.map(m => m.text)).toEqual(['Samtal saknas']);
    expect(marksFor(list, answers(answerOf(rows, false)), 'johan').map(m => m.text)).toEqual(['2 försenade']);
    expect(marksFor(list, answers(answerOf(rows, false)), 'erik')).toEqual([
      { id: 'talks.person:risk', tone: 'alert', text: 'Hög' },
    ]);
    expect(marksFor(list, answers({ status: 'unavailable' }), 'karin')).toEqual([]);
  });
  test("a source's page fills in the key and the id, and on the same page keeps the page's own address", () => {
    const karin = person('karin', 'p-karin');
    expect(pageHref(lens.page!, karin, { pathname: '/staff', search: '' })).toBe('/staff?talk=p-karin');
    expect(pageHref(lens.page!, karin, { pathname: '/staff', search: '?show=hr.person&talk=old' })).toBe(
      '/staff?show=hr.person&talk=p-karin',
    );
    expect(pageHref(lens.page!, karin, { pathname: '/people/karin', search: '?section=x' })).toBe(
      '/staff?talk=p-karin',
    );
    expect(pageHref({ title: 'Öppna', href: '/people/{key}' }, person('k å'), { pathname: '/', search: '' })).toBe(
      '/people/k%20%C3%A5',
    );
    expect(pageHref(lens.page!, person('karin'), { pathname: '/staff', search: '' })).toBeNull();
  });
  test('the systems that did not answer are named once, in one sentence, a late one said as late', () => {
    expect(silentText([])).toBe('');
    expect(silentText([{ source: 'Personalsystemet', status: 'unavailable' }])).toBe('Personalsystemet svarade inte.');
    expect(
      silentText([
        { source: 'A', status: 'failed' },
        { source: 'B', status: 'unavailable' },
        { source: 'C', status: 'unavailable' },
        { source: 'D', status: 'timeout' },
      ]),
    ).toBe('A, B och C svarade inte. D svarade inte i tid.');
    const silent = silentOf(list, answers({ status: 'timeout' }, { status: 'unavailable' }), sourcesRead(list));
    expect(silent).toEqual([
      { source: 'Utvecklingssamtal', status: 'timeout' },
      { source: 'Personalsystemet', status: 'unavailable' },
    ]);
    expect(silentOf(list, answers({ status: 'pending' }), sourcesRead(list))).toEqual([]);
  });
  test('the count line names the unit, or how many units there are', () => {
    expect(peopleLine(list.groups)).toBe('6 medarbetare på Bergsåkers skola');
    expect(peopleLine([...list.groups, { id: 'u2', label: 'Fritids', entities: [person('lena')] }])).toBe(
      '7 medarbetare på 2 enheter',
    );
  });
});
