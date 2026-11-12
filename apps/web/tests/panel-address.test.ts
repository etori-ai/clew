import { describe, expect, test } from 'bun:test';
import {
  cardOverPage,
  cardWithRead,
  keepingPanel,
  pageOnly,
  panelOf,
  panelSearch,
  readOf,
  viewSearch,
  withAsk,
  withCard,
  withEntry,
  withRead,
  withView,
  withoutPanel,
  withoutRead,
  withoutView,
} from '../src/panel-address';

describe('a card opens over the page the person is on (D111 rule 2)', () => {
  test('the page keeps its own address, and the card is added to it', () => {
    expect(withCard('/people/johan', '?section=needs-you&from=%2Fstaff', 'samtal-svar')).toBe(
      '/people/johan?section=needs-you&from=%2Fstaff&card=samtal-svar',
    );
    expect(withCard('/calendar', '', 'ledighet')).toBe('/calendar?card=ledighet');
    expect(withCard('/', '?tab=done&area=budget', 'ledighet')).toBe('/?tab=done&area=budget&card=ledighet');
  });
  test('a new card takes the place of what the panel held, a view or another card, and closing leaves the page', () => {
    const viewOpen = '?section=x&open=hr.whoIsOn&open-title=Bemanning&via=1';
    expect(withCard('/people/johan', viewOpen, 'ledighet')).toBe('/people/johan?section=x&card=ledighet');
    const readOpen = '?card=fakturor&open-card=fakturor&open-action=pattern';
    expect(withCard('/calendar', readOpen, 'ledighet')).toBe('/calendar?card=ledighet');
    expect(withoutPanel('/people/johan', '?section=x&from=%2Fstaff&card=ledighet')).toBe(
      '/people/johan?section=x&from=%2Fstaff',
    );
  });
  test('from the bell, a toast or the search: over the page, letting go of a review or a talk over it (D111 rule 5, D112)', () => {
    expect(cardOverPage('/admin/connectors', '', 'ledighet')).toBe('/admin/connectors?card=ledighet');
    expect(
      cardOverPage('/staff', '?show=clew.talkPeople&card=samtal&open-card=samtal&open-action=pattern', 'ledighet'),
    ).toBe('/staff?show=clew.talkPeople&card=ledighet');
    // On Hem the item is beside Hem in its panel (D112, amended 2026-11-12), in the place of what was open there; on
    // Att göra it takes the reading pane.
    expect(cardOverPage('/', '', 'ledighet')).toBe('/?card=ledighet');
    expect(
      cardOverPage('/', '?open=hr.whoIsOn&open-title=Bemanning&card=fakturor&review=fakturor&step=2', 'ledighet'),
    ).toBe('/?card=ledighet');
    expect(cardOverPage('/todo', '?tab=waiting&item=fakturor&review=fakturor&step=2', 'ledighet')).toBe(
      '/todo?tab=waiting&item=ledighet',
    );
    expect(cardOverPage('/items/ledighet', '?from=%2Fstaff&review=ledighet', 'ledighet')).toBe(
      '/items/ledighet?from=%2Fstaff',
    );
    expect(cardOverPage('/items/fakturor', '?from=%2Ftodo', 'ledighet')).toBe(
      '/items/fakturor?from=%2Ftodo&card=ledighet',
    );
    expect(cardOverPage('/people/karin', '?from=%2Fstaff&talk=karin', 'ledighet')).toBe(
      '/people/karin?from=%2Fstaff&card=ledighet',
    );
  });
});

describe('a move within the page keeps what is open beside it', () => {
  test('another section of the person keeps the card, the view and a card’s read', () => {
    expect(keepingPanel('/people/johan?section=directory.contact&from=%2Fstaff', '?from=%2Fstaff&card=t1')).toBe(
      '/people/johan?section=directory.contact&from=%2Fstaff&card=t1',
    );
    expect(keepingPanel('/people/johan', '?open=a.b&open-title=A&open-card=t1&open-action=x')).toBe(
      '/people/johan?open=a.b&open-title=A&open-card=t1&open-action=x',
    );
  });
  test('with nothing open the address is the one asked for', () => {
    expect(keepingPanel('/people/johan?from=%2Fstaff', '?section=needs-you&from=%2Fstaff')).toBe(
      '/people/johan?from=%2Fstaff',
    );
    expect(keepingPanel('/people/johan', '')).toBe('/people/johan');
  });
});

describe('a card’s own read unfolds inside the card (D111, amended 2026-11-11)', () => {
  test('the read is the card’s state, not a thing in the panel: the panel still holds the card', () => {
    const q = new URLSearchParams('?show=x&card=t1&open-card=t1&open-action=pattern');
    expect(panelOf(q)).toEqual({ kind: 'card', threadId: 't1' });
    expect(readOf(q)).toEqual({ threadId: 't1', actionId: 'pattern' });
    expect(readOf(new URLSearchParams('?card=t1&open-card=t1'))).toBeNull();
    // A card in a conversation's answer unfolds its read with nothing in the panel.
    expect(panelOf(new URLSearchParams('?open-card=t1&open-action=pattern'))).toBeNull();
  });
  test('unfolding and folding keep everything else, and unfold one read at a time', () => {
    expect(withRead('/staff', '?show=x&card=t1', 't1', 'pattern')).toBe(
      '/staff?show=x&card=t1&open-card=t1&open-action=pattern',
    );
    expect(withRead('/', '?card=t1&open-card=t1&open-action=pattern', 't1', 'state')).toBe(
      '/?card=t1&open-card=t1&open-action=state',
    );
    expect(withoutRead('/staff', '?show=x&card=t1&open-card=t1&open-action=pattern')).toBe('/staff?show=x&card=t1');
  });
  test('a row’s read opens its card with the read unfolded, in place of what the panel held', () => {
    expect(cardWithRead('/', '?tab=done&open=a.b&open-title=A&card=other', 't1', 'pattern')).toBe(
      '/?tab=done&card=t1&open-card=t1&open-action=pattern',
    );
  });
  test('a row’s own view in the read lies over the card, which keeps its read; ✕ peels the view, then the card', () => {
    const unfolded = '?card=t1&open-card=t1&open-action=pattern';
    const view = withView('/staff', unfolded, { capability: 'directory.contact', title: 'Kontakt' });
    expect(view).toBe('/staff?card=t1&open-card=t1&open-action=pattern&open=directory.contact&open-title=Kontakt');
    expect(panelOf(new URLSearchParams(view.slice('/staff'.length)))?.kind).toBe('view');
    expect(withoutPanel('/staff', view.slice('/staff'.length))).toBe(`/staff${unfolded}`);
    expect(withoutPanel('/staff', unfolded)).toBe('/staff');
    // Another card lets go of the read of the one before.
    expect(withCard('/staff', unfolded, 't2')).toBe('/staff?card=t2');
  });
  test('the page’s own address drops the read; a conversation takes it along with the card', () => {
    expect(pageOnly('/staff', '?show=x&card=t1&open-card=t1&open-action=pattern')).toBe('/staff?show=x');
    // A way back holds nothing that lay over the page either.
    expect(pageOnly('/', '?tab=done&card=f&review=f&step=2')).toBe('/?tab=done');
    expect(pageOnly('/staff', '?show=x&talk=anna')).toBe('/staff?show=x');
    expect(panelSearch('?show=x&card=t1&open-card=t1&open-action=pattern')).toBe(
      '?card=t1&open-card=t1&open-action=pattern',
    );
  });
});

describe("a page's own thing in the panel (D112 items 7 and 9)", () => {
  test('Fråga Clew makes the page the thing: it takes the place of what the panel held and lets go of what lay over it', () => {
    expect(withAsk('/items/omtanke', '?from=%2Ftodo')).toBe('/items/omtanke?from=%2Ftodo&ask=1');
    expect(withAsk('/staff', '?show=talks&card=c1&open-card=c1&open-action=pattern&review=c1')).toBe(
      '/staff?show=talks&ask=1',
    );
    expect(panelOf(new URLSearchParams('?ask=1'))).toEqual({ kind: 'page' });
  });
  test("Kalender's entry is the page's thing too; a card or a view opened over the page takes its place", () => {
    expect(withEntry('/calendar', '?date=2026-11-09&view=week&ask=1', 'p1')).toBe(
      '/calendar?date=2026-11-09&view=week&entry=p1',
    );
    expect(panelOf(new URLSearchParams('?entry=p1'))).toEqual({ kind: 'entry', id: 'p1' });
    expect(withCard('/calendar', '?date=2026-11-09&entry=p1', 'ledighet')).toBe(
      '/calendar?date=2026-11-09&card=ledighet',
    );
    expect(withView('/calendar', '?ask=1', { capability: 'calendar.rooms', title: 'Mötesrum' })).toBe(
      '/calendar?open=calendar.rooms&open-title=M%C3%B6tesrum',
    );
    expect(panelOf(new URLSearchParams('?entry=p1&card=c1'))).toEqual({ kind: 'card', threadId: 'c1' });
  });
  test('closing lets go of the page’s own thing last, and the conversation’s page does not take it along', () => {
    expect(withoutPanel('/calendar', '?date=2026-11-09&entry=p1')).toBe('/calendar?date=2026-11-09');
    expect(withoutPanel('/tools/phonebook.directory', '?input=%7B%7D&ask=1')).toBe(
      '/tools/phonebook.directory?input=%7B%7D',
    );
    expect(pageOnly('/calendar', '?date=2026-11-09&entry=p1&ask=1')).toBe('/calendar?date=2026-11-09');
    expect(panelSearch('?entry=p1&ask=1&card=c1')).toBe('?card=c1');
  });
  test("a view's part of the conversation page's address: the view beside the transcript", () => {
    expect(viewSearch({ capability: 'calendar.week', title: 'Vecka 45', input: { from: '2026-11-02' } })).toBe(
      '?open=calendar.week&open-title=Vecka+45&open-input=%7B%22from%22%3A%222026-11-02%22%7D',
    );
  });
});

describe('the panel holds one thing to peek at, never a drill into a list (D116)', () => {
  test('a view opened over another takes its place, and an old drill-in mark is let go of', () => {
    const drilled = '?open=phonebook.directory&open-title=Telefonbok&via=1';
    expect(withView('/', drilled, { capability: 'phonebook.person', title: 'Kontaktkort', input: { ref: 'p1' } })).toBe(
      '/?open=phonebook.person&open-title=Kontaktkort&open-input=%7B%22ref%22%3A%22p1%22%7D',
    );
    expect(panelOf(new URLSearchParams(drilled))).toEqual({
      kind: 'view',
      capability: 'phonebook.directory',
      title: 'Telefonbok',
      input: {},
    });
  });
  test('without the view the page keeps everything else, the card in its panel too', () => {
    expect(withoutView('/', '?card=t1&open=a.b&open-title=A&open-input=%7B%7D&via=1')).toBe('/?card=t1');
    expect(withoutView('/people/anna', '?from=%2Fstaff')).toBe('/people/anna?from=%2Fstaff');
  });
});
