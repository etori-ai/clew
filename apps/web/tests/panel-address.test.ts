import { describe, expect, test } from 'bun:test';
import {
  cardOverPage,
  cardWithRead,
  keepingPanel,
  pageOnly,
  panelOf,
  panelSearch,
  readOf,
  reviewOverCard,
  withCard,
  withRead,
  withView,
  withoutPanel,
  withoutRead,
} from '../src/panel-address';

describe('a card opens over the page the person is on (D107 rule 2)', () => {
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
  test('from the bell, a toast or the search: over the page, letting go of a review or a talk over it (D107 rule 5)', () => {
    expect(cardOverPage('/admin/connectors', '', 'ledighet')).toBe('/admin/connectors?card=ledighet');
    expect(
      cardOverPage('/staff', '?show=clew.talkPeople&card=samtal&open-card=samtal&open-action=pattern', 'ledighet'),
    ).toBe('/staff?show=clew.talkPeople&card=ledighet');
    expect(cardOverPage('/', '?tab=done&card=fakturor&review=fakturor&step=2', 'ledighet')).toBe(
      '/?tab=done&card=ledighet',
    );
    expect(cardOverPage('/people/karin', '?from=%2Fstaff&talk=karin', 'ledighet')).toBe(
      '/people/karin?from=%2Fstaff&card=ledighet',
    );
  });
});

describe("a row's Granska N opens its card beside the page and the review over it (D107 rule 5)", () => {
  test('the card in the panel, as the row’s title opens it, and the review of that card', () => {
    expect(reviewOverCard('/', '', 'fakturor')).toBe('/?card=fakturor&review=fakturor');
    expect(reviewOverCard('/', '?tab=done&area=ekonomi', 'fakturor')).toBe(
      '/?tab=done&area=ekonomi&card=fakturor&review=fakturor',
    );
    expect(reviewOverCard('/', '?open=hr.whoIsOn&open-title=Bemanning&card=other', 'fakturor')).toBe(
      '/?card=fakturor&review=fakturor',
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

describe('a card’s own read unfolds inside the card (D107, amended 2026-11-11)', () => {
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
    const view = withView('/staff', unfolded, { capability: 'directory.contact', title: 'Kontakt' }, true);
    expect(view).toBe(
      '/staff?card=t1&open-card=t1&open-action=pattern&open=directory.contact&open-title=Kontakt&via=1',
    );
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
    expect(reviewOverCard('/', '?card=t1&open-card=t1&open-action=pattern', 't2')).toBe('/?card=t2&review=t2');
  });
});
