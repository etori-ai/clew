import { describe, expect, test } from 'bun:test';
import type { View, ViewEntry } from '@clew/contracts';
import {
  declaredPage,
  lensesOpening,
  openedAsPage,
  opensAsPage,
  peopleReadHref,
  type PeopleReads,
  readInput,
  readPageHref,
  searchKeyOf,
  viewInputChange,
  viewOpenHref,
  viewPageHref,
  withSearchWords,
  withViewInput,
} from '../src/view-address';

/** What `/api/areas` lists as the reads the person may open (D116). */
const views: ViewEntry[] = [
  { capability: 'talks.talks', title: 'Utvecklingssamtal', kind: 'table' },
  { capability: 'incidents.deviations', title: 'Avvikelser och tillbud', kind: 'list' },
  { capability: 'finance.budget', title: 'Budget mot prognos', kind: 'detail' },
  { capability: 'finance.record', title: 'Faktura och underlag', kind: 'record' },
  { capability: 'calendar.today', title: 'Dagens möten' },
];

describe('every view has an address: its own page (D116)', () => {
  test('the page carries the input, the name it was opened under and the way back', () => {
    expect(viewPageHref({ capability: 'talks.talks' })).toBe('/tools/talks.talks');
    expect(
      viewPageHref({ capability: 'finance.record', title: 'Faktura 4471', input: { ref: 'inv-4471' } }, '/?card=f'),
    ).toBe('/tools/finance.record?input=%7B%22ref%22%3A%22inv-4471%22%7D&title=Faktura+4471&from=%2F%3Fcard%3Df');
    // An empty input says nothing; a way back holds no way back of its own, and never leads out of Clew.
    expect(viewPageHref({ capability: 'talks.talks', input: {} }, '/tools/a.b?from=%2F')).toBe(
      '/tools/talks.talks?from=%2Ftools%2Fa.b',
    );
    expect(viewPageHref({ capability: 'talks.talks' }, 'https://elsewhere.example/')).toBe('/tools/talks.talks');
    expect(viewPageHref({ capability: 'talks.talks' }, '//elsewhere.example/')).toBe('/tools/talks.talks');
  });
  test("the page's own search keeps its name and its way back, and lets go of what lay beside it", () => {
    expect(
      withViewInput('/tools/talks.talks', '?title=Samtal&from=%2F&open=a.b&open-title=A&input=%7B%7D', { q: 'anna' }),
    ).toBe('/tools/talks.talks?input=%7B%22q%22%3A%22anna%22%7D&title=Samtal&from=%2F');
    expect(withViewInput('/tools/talks.talks', '?input=%7B%22q%22%3A%22x%22%7D', {})).toBe('/tools/talks.talks');
  });
});

/**
 * What a person types into a view's search field is a name as often as not, and an address is kept by every access log
 * on the way and by the browser's history (WD-M4 of the web review of 2026-11-23; D100 item 5): the words go to the read
 * and never into the address, while a choice is still written there.
 */
describe('what is typed into a view never enters its address', () => {
  const table = { kind: 'table', input: { query: { key: 'query' } } };
  test("the search field's key is a table's or a list's declared one, and nothing else's", () => {
    expect(searchKeyOf(table)).toBe('query');
    expect(searchKeyOf({ kind: 'list', input: { query: { key: 'q' } } })).toBe('q');
    expect(searchKeyOf({ kind: 'table' })).toBeNull();
    expect(searchKeyOf({ kind: 'detail', input: { query: { key: 'query' } } })).toBeNull();
    expect(searchKeyOf(undefined)).toBeNull();
  });
  test('the words are kept apart and the choices are written, with the name and the way back', () => {
    const search = '?input=%7B%22scope%22%3A%22all%22%7D&title=Telefonbok&from=%2F';
    const change = viewInputChange('/tools/phonebook.directory', search, { scope: 'unit', query: 'Anna' }, 'query');
    expect(change).toEqual({
      href: '/tools/phonebook.directory?input=%7B%22scope%22%3A%22unit%22%7D&title=Telefonbok&from=%2F',
      at: '{"scope":"unit"}',
      words: 'Anna',
    });
    expect(change.href).not.toContain('Anna');
    // Words a link put in the address go as soon as the person types; with nothing chosen there is no input at all.
    expect(
      viewInputChange(
        '/tools/phonebook.directory',
        '?input=%7B%22query%22%3A%22Bo%22%7D',
        { query: 'Bertil' },
        'query',
      ),
    ).toEqual({ href: '/tools/phonebook.directory', at: null, words: 'Bertil' });
    // A view without a search field writes its whole input, as before.
    expect(viewInputChange('/tools/a.b', '', { scope: 'unit' }, null)).toEqual({
      href: '/tools/a.b?input=%7B%22scope%22%3A%22unit%22%7D',
      at: '{"scope":"unit"}',
      words: '',
    });
  });
  test("the read takes the address's input with the words typed in place of the address's own", () => {
    expect(withSearchWords('{"scope":"unit"}', 'query', 'Anna')).toBe('{"scope":"unit","query":"Anna"}');
    expect(withSearchWords('{"scope":"unit","query":"Bo"}', 'query', 'Anna')).toBe('{"scope":"unit","query":"Anna"}');
    expect(withSearchWords('{"query":"Bo"}', 'query', '')).toBeNull();
    expect(withSearchWords(null, 'query', 'Anna')).toBe('{"query":"Anna"}');
    expect(withSearchWords('{broken', 'query', '')).toBeNull();
  });
});

describe('a list, a table and one thing are pages (D116, D126)', () => {
  test('what the person may open says which', () => {
    expect(opensAsPage(views, 'talks.talks')).toBe(true);
    expect(opensAsPage(views, 'incidents.deviations')).toBe(true);
    expect(opensAsPage(views, 'finance.budget')).toBe(false);
    expect(opensAsPage(views, 'finance.record')).toBe(false);
    // A read without a declared view, an unknown one and no list at all: beside the page, which sends rows on.
    expect(opensAsPage(views, 'calendar.today')).toBe(false);
    expect(opensAsPage(views, 'hr.secret')).toBe(false);
    expect(opensAsPage(undefined, 'talks.talks')).toBe(false);
  });
  test('a tile on Hem leads to the list’s page with Hem, as it was, as the way back', () => {
    expect(viewOpenHref(views, '/', '', { capability: 'talks.talks', title: 'Utvecklingssamtal' })).toBe(
      '/tools/talks.talks?title=Utvecklingssamtal&from=%2F',
    );
    expect(viewOpenHref(views, '/', '?card=t1', { capability: 'talks.talks', title: 'Utvecklingssamtal' })).toBe(
      '/tools/talks.talks?title=Utvecklingssamtal&from=%2F%3Fcard%3Dt1',
    );
    // From a person's page, which keeps its own way back for when the person comes back to it.
    expect(
      viewOpenHref(views, '/people/anna', '?from=%2Fstaff&open=x.y&open-title=Y', {
        capability: 'incidents.deviations',
        title: 'Avvikelser',
        input: { person: 'anna' },
      }),
    ).toBe('/tools/incidents.deviations?input=%7B%22person%22%3A%22anna%22%7D&title=Avvikelser&from=%2Fpeople%2Fanna');
  });
  test('one thing is its own page too (D126 rule 1), with the page it was opened from as the way back', () => {
    expect(viewOpenHref(views, '/', '?card=t1', { capability: 'finance.budget', title: 'Budget mot prognos' })).toBe(
      '/tools/finance.budget?title=Budget+mot+prognos&from=%2F',
    );
    expect(
      viewOpenHref(views, '/tools/finance.invoices', '?from=%2F&open=a.b&open-title=A', {
        capability: 'finance.record',
        title: 'Faktura',
        input: { ref: 'inv-1' },
      }),
    ).toBe('/tools/finance.record?input=%7B%22ref%22%3A%22inv-1%22%7D&title=Faktura&from=%2Ftools%2Ffinance.invoices');
  });
  test('beside a conversation one thing stands beside the transcript, in the place of what lay there (rule 2)', () => {
    expect(
      viewOpenHref(views, '/conversations/c1', '?card=t1', {
        capability: 'finance.budget',
        title: 'Budget mot prognos',
      }),
    ).toBe('/conversations/c1?card=t1&open=finance.budget&open-title=Budget+mot+prognos');
  });
});

describe('an address that opened a list beside the page leads to its page (D116)', () => {
  test('the view’s name and input go along, and the page it lay beside is the way back', () => {
    expect(
      openedAsPage(
        '/',
        '?card=t1&open=talks.talks&open-title=Utvecklingssamtal&open-input=%7B%22round%22%3A%222026%22%7D&via=1',
      ),
    ).toBe('/tools/talks.talks?input=%7B%22round%22%3A%222026%22%7D&title=Utvecklingssamtal&from=%2F%3Fcard%3Dt1');
    expect(openedAsPage('/conversations/c1', '?open=clew.search&open-title=K%C3%A4llor')).toBe(
      '/tools/clew.search?title=K%C3%A4llor&from=%2Fconversations%2Fc1',
    );
  });
  test('an address that opens no view leads nowhere else, and a broken input is no input', () => {
    expect(openedAsPage('/', '?card=t1')).toBeNull();
    expect(openedAsPage('/', '?open=talks.talks&open-input=%7Bnot-json')).toBe('/tools/talks.talks?from=%2F');
  });
});

describe("a work item's read that answers with rows leads to the read's page (D116)", () => {
  const thread = {
    items: [
      { ref: 'b', selected: true },
      { ref: 'a', selected: true },
      { ref: 'c', selected: false },
    ],
  } as Parameters<typeof readInput>[0];
  test('read with the action’s own input, and the chosen rows when it takes them', () => {
    expect(readInput(thread, {})).toEqual({});
    expect(readInput(thread, { input: { status: 'open' } })).toEqual({ status: 'open' });
    expect(readInput(thread, { input: { status: 'open' }, usesItems: true })).toEqual({
      status: 'open',
      refs: ['a', 'b'],
    });
  });
  test('under the read’s own title, with the page the item is on as the way back', () => {
    expect(readPageHref(thread, { capability: 'hr.leaveRequests' }, '/?card=ledighet')).toBe(
      '/tools/hr.leaveRequests?from=%2F%3Fcard%3Dledighet',
    );
  });
});

describe('a read of Clew’s own that declares the page its rows are worked on leads there (D116)', () => {
  const declared: ViewEntry[] = [
    ...views,
    {
      capability: 'competence.attention',
      title: 'Krav som inte uppfylls',
      kind: 'table',
      page: '/competence/matrix?only=attention',
    },
  ];
  const thread = { items: [] } as Parameters<typeof readInput>[0];
  test('the figure on Hem, an answer’s list and the manager’s card lead to the matrix narrowed, not to the read’s page', () => {
    expect(declaredPage(declared, 'competence.attention')).toBe('/competence/matrix?only=attention');
    expect(
      viewOpenHref(declared, '/', '', { capability: 'competence.attention', title: 'Krav som inte uppfylls' }),
    ).toBe('/competence/matrix?only=attention');
    expect(readPageHref(thread, { capability: 'competence.attention' }, '/?card=kompetens', declared)).toBe(
      '/competence/matrix?only=attention',
    );
    // Read with an input it is the read's own page; any other read keeps its page; without the list, its page.
    expect(declaredPage(declared, 'competence.attention', { person: 'anna' })).toBeUndefined();
    expect(declaredPage(declared, 'talks.talks')).toBeUndefined();
    expect(readPageHref(thread, { capability: 'competence.attention' }, '/')).toBe(
      '/tools/competence.attention?from=%2F',
    );
  });
  test('only a path inside Clew is followed', () => {
    for (const page of ['//evil.example/x', 'https://evil.example', 'javascript:alert(1)'])
      expect(declaredPage([{ capability: 'x.y', title: 'X', page }], 'x.y')).toBeUndefined();
  });
});

describe('a read about the reader’s people is Personal’s tab or the person’s page (D126 rules 1 and 8)', () => {
  const presence: View = {
    kind: 'list',
    title: 'presence',
    fields: [{ key: 'presence', label: 'Närvaro' }],
    open: { capability: 'sys.pattern', title: 'Mönster', params: { ref: 'ref' } },
  };
  const reads = (rows?: Array<Record<string, unknown>>): PeopleReads => ({
    lenses: [{ capability: 'sys.person', view: presence, overviews: ['sys.overview'] }],
    people: [
      { key: 'p-anna', sourceKey: 'anna' },
      { key: 'p-erik', sourceKey: 'erik' },
    ],
    rows: capability => (capability === 'sys.person' ? rows : undefined),
  });
  const rows = [
    { key: 'Anna', ref: 'emp:1', presence: 'I tjänst' },
    { key: 'erik', ref: 'emp:2', presence: 'Sjuk' },
  ];
  test('a lens is Personal’s tab for it, which names no way back', () => {
    expect(peopleReadHref({ capability: 'sys.person' }, reads(rows), '/')).toBe('/staff?show=sys.person');
  });
  test('a lens’s fuller read about one person is that person’s page at the lens’s tab, found by the row it opens from', () => {
    expect(
      peopleReadHref({ capability: 'sys.pattern', input: { ref: 'emp:1' } }, reads(rows), '/tools/x?from=%2F'),
    ).toBe('/people/p-anna?section=sys.person&from=%2Ftools%2Fx');
    expect(peopleReadHref({ capability: 'sys.pattern', input: { ref: 'emp:2' } }, reads(rows))).toBe(
      '/people/p-erik?section=sys.person',
    );
  });
  test('a read that answers the lens’s rows without keys (byKey, D127) is the lens’s tab too: Hem’s “Frånvaro per person”', () => {
    expect(peopleReadHref({ capability: 'sys.overview' }, reads(rows), '/')).toBe('/staff?show=sys.person');
    expect(peopleReadHref({ capability: 'sys.overview', input: {} }, reads(undefined))).toBe('/staff?show=sys.person');
    // Read with an input it is its own page; without the lens offered, its own page too.
    expect(peopleReadHref({ capability: 'sys.overview', input: { q: 'anna' } }, reads(rows))).toBeNull();
    expect(peopleReadHref({ capability: 'sys.overview' }, { ...reads(rows), lenses: [] })).toBeNull();
  });
  test('the whole path: the tile’s read is Personal’s tab, and a row’s fuller read from there is the person’s tab', () => {
    // Hem's tile names the overview; from Personal's tab a person's fuller read is their page at the lens's tab.
    const tab = peopleReadHref({ capability: 'sys.overview', title: 'Frånvaro per person' }, reads(rows), '/');
    expect(tab).toBe('/staff?show=sys.person');
    expect(lensesOpening(reads(rows), 'sys.pattern').map(l => l.capability)).toEqual(['sys.person']);
    expect(peopleReadHref({ capability: 'sys.pattern', input: { ref: 'emp:2' } }, reads(rows), tab)).toBe(
      '/people/p-erik?section=sys.person&from=%2Fstaff%3Fshow%3Dsys.person',
    );
  });
  test('while the lens’s rows are on their way it is not known yet; a row nobody here is, and any other read, keep their page', () => {
    expect(peopleReadHref({ capability: 'sys.pattern', input: { ref: 'emp:1' } }, reads(undefined))).toBeUndefined();
    expect(peopleReadHref({ capability: 'sys.pattern', input: { ref: 'emp:9' } }, reads(rows))).toBeNull();
    expect(peopleReadHref({ capability: 'sys.other' }, reads(rows))).toBeNull();
  });
});
