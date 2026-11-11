import { describe, expect, test } from 'bun:test';
import type { EntityCard, EntityList, EntityRef, EntityRows, EntitySource, View, ViewField } from '@clew/contracts';
import {
  answerOf,
  byNeed,
  cardLinkTexts,
  cardsListed,
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
import { compactField, groupFields, rowGroups, wholeRow } from '../src/view-fields';

/**
 * Personal (D97): a lens over five people, as the talks module declares its read about a person: the next talk is the
 * row in one value, the overdue points stand beside the open ones.
 */
const [state, next, open, overdue, risk]: ViewField[] = [
  { key: 'state', label: 'Samtal', format: 'status', tones: { Saknas: 'warn', Bokat: 'none', Hållet: 'ok' } },
  { key: 'next', label: 'Nästa samtal', format: 'status', tones: { 'Inte bokat': 'warn' }, compact: true },
  { key: 'open', label: 'Åtgärdspunkter' },
  { key: 'overdue', label: 'Försenade', format: 'status', tones: { '*': 'warn' }, beside: true },
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
  attention: [],
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
  test('under a lens a state that needs the reader comes first, then another field that does, then the rest, then nobody the source knows', () => {
    // Karin's talk is missing; Erik's risk and Johan's late points need the reader in another field; directory order within.
    expect(byNeed(people, lens, answerOf(rows, false)).map(p => p.key)).toEqual([
      'karin',
      'erik',
      'johan',
      'anna',
      'maria',
      'omar',
    ]);
    // An alert in the state goes before a warning in it.
    const alarmed: View = {
      ...view,
      fields: [{ ...state!, tones: { ...state!.tones, Akut: 'alert' } }, ...view.fields.slice(1)],
    };
    const akut = { ...rows, rows: [...rows.rows.filter(r => r.key !== 'maria'), { key: 'maria', state: 'Akut' }] };
    expect(
      byNeed(people, { ...lens, view: alarmed }, answerOf(akut, false))
        .map(p => p.key)
        .slice(0, 2),
    ).toEqual(['maria', 'karin']);
    // The compact field is not drawn under the lens, so it does not sort a row up by itself.
    const onlyNext = {
      ...rows,
      rows: [
        { key: 'anna', state: 'Bokat', next: 'Inte bokat' },
        { key: 'erik', state: 'Bokat' },
      ],
    };
    expect(byNeed(people.slice(0, 2), lens, answerOf(onlyNext, false)).map(p => p.key)).toEqual(['anna', 'erik']);
  });
  test('the Visa menu counts the rows that need the reader, in the strongest tone, and nothing when none do', () => {
    expect(lensNeed(lens, answerOf(rows, false))).toEqual({ count: 3, tone: 'alert' });
    const calm = { ...rows, rows: rows.rows.filter(r => r.key === 'maria') };
    expect(lensNeed(lens, answerOf(calm, false))).toBeNull();
    expect(lensNeed(lens, answerOf({ ...rows, status: 'unavailable', rows: [] }, false))).toBeNull();
    expect(lensNeed(lens, undefined)).toBeNull();
  });
  test('the counts per state put what is done first, then the plain, then what needs the reader, and leave out what no row has', () => {
    expect(valueCounts(view, rows.rows)).toBe('1 hållet, 3 bokat, 1 saknas');
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
    // "Inte bokat" in the column Nästa samtal already says it for the talk: no "Samtal saknas" beside it.
    expect(marksFor(list, answers(answerOf(rows, false)), 'karin')).toEqual([]);
    // Without that column the missing talk is a mark.
    const noColumn = { ...list, columns: list.columns.filter(c => c.capability !== lens.capability) };
    expect(marksFor(noColumn, answers(answerOf(rows, false)), 'karin').map(m => m.text)).toEqual([
      'Samtal saknas',
      'Inte bokat',
    ]);
    // A plain value in the column ("tors 12 nov") leaves the late points as a mark.
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
  test('"Just nu" links the cards that wait for the reader and the proposals, to the one card when there is one', () => {
    const withCards: EntityList = {
      ...list,
      attention: [
        { key: 'erik', act: 1, proposals: 0, threadId: 't-erik' },
        { key: 'johan', act: 2, proposals: 1 },
        { key: 'karin', act: 0, proposals: 1, threadId: 't-karin' },
      ],
    };
    expect(cardLinkTexts(withCards, 'ERIK')).toEqual([{ kind: 'act', text: '1 att agera på', threadId: 't-erik' }]);
    expect(cardLinkTexts(withCards, 'johan')).toEqual([
      { kind: 'act', text: '2 att agera på' },
      { kind: 'proposal', text: '1 förslag' },
    ]);
    expect(cardLinkTexts(withCards, 'karin')).toEqual([{ kind: 'proposal', text: '1 förslag', threadId: 't-karin' }]);
    expect(cardLinkTexts(withCards, 'anna')).toEqual([]);
  });
  test('several cards are listed beside Personal: those of the kind the link counted, headed with its words', () => {
    const card = (threadId: string, kind: EntityCard['kind']): EntityCard => ({
      threadId,
      title: threadId,
      source: 'Clew',
      kind,
    });
    const cards = [card('a1', 'act'), card('p1', 'proposal'), card('a2', 'act'), card('f1', 'fyi')];
    expect(cardsListed(cards, 'act')).toEqual({
      cards: [card('a1', 'act'), card('a2', 'act')],
      heading: '2 att agera på',
      empty: 'Inget att agera på',
    });
    expect(cardsListed(cards, 'proposal')).toEqual({
      cards: [card('p1', 'proposal')],
      heading: '1 förslag',
      empty: 'Inga förslag',
    });
    // Every one was decided meanwhile: the list says so in its place.
    expect(cardsListed([card('f1', 'fyi')], 'act').cards).toEqual([]);
    // An address without a kind lists every card about the person, as Behöver dig on their page does.
    expect(cardsListed(cards, undefined)).toEqual({ cards, heading: 'Behöver dig', empty: 'Inga kort' });
  });
  test('the count line names the unit, or how many units there are', () => {
    expect(peopleLine(list.groups)).toBe('6 medarbetare på Bergsåkers skola');
    expect(peopleLine([...list.groups, { id: 'u2', label: 'Fritids', entities: [person('lena')] }])).toBe(
      '7 medarbetare på 2 enheter',
    );
  });
});

describe('the whole row and the row in one value (D97)', () => {
  test('a field beside another shares its cell, the compact one is left out, and the first of each cell names it', () => {
    const groups = rowGroups(view.kind === 'list' ? view.fields : []);
    expect(groups.map(g => groupFields(g).map(f => f.key))).toEqual([['state'], ['open', 'overdue'], ['risk']]);
    expect(groups.map(g => g.lead.label)).toEqual(['Samtal', 'Åtgärdspunkter', 'Risk']);
    expect(compactField(view.kind === 'list' ? view.fields : [])?.key).toBe('next');
    expect(wholeRow(view.kind === 'list' ? view.fields : []).map(f => f.key)).toEqual([
      'state',
      'open',
      'overdue',
      'risk',
    ]);
  });
  test('a field beside one that is left out starts its own cell, and a declared title is always its own cell', () => {
    const [a, b, c] = [
      { key: 'a', label: 'A', compact: true as const },
      { key: 'b', label: 'B', beside: true as const },
      { key: 'c', label: 'C', beside: true as const },
    ];
    expect(rowGroups([a, b, c]).map(g => groupFields(g).map(f => f.key))).toEqual([['b', 'c']]);
    const title = { key: 't', label: 'T' };
    expect(
      rowGroups([{ key: 'x', label: 'X' }, { ...title, beside: true as const }, c], { lead: 't' }).map(g =>
        groupFields(g).map(f => f.key),
      ),
    ).toEqual([['x'], ['t', 'c']]);
  });
});
