import { describe, expect, test } from 'bun:test';
import type { ViewEntry } from '@clew/contracts';
import {
  declaredPage,
  openedAsPage,
  opensAsPage,
  readInput,
  readPageHref,
  viewOpenHref,
  viewPageHref,
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

describe('a list or a table is a page; one thing is a peek beside the page (D116)', () => {
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
  test('one thing opens beside the page it was opened from, in the place of what lay there', () => {
    expect(viewOpenHref(views, '/', '?card=t1', { capability: 'finance.budget', title: 'Budget mot prognos' })).toBe(
      '/?card=t1&open=finance.budget&open-title=Budget+mot+prognos',
    );
    expect(
      viewOpenHref(views, '/tools/finance.invoices', '?from=%2F&open=a.b&open-title=A', {
        capability: 'finance.record',
        title: 'Faktura',
        input: { ref: 'inv-1' },
      }),
    ).toBe(
      '/tools/finance.invoices?from=%2F&open=finance.record&open-title=Faktura&open-input=%7B%22ref%22%3A%22inv-1%22%7D',
    );
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
