import { describe, expect, test } from 'bun:test';
import {
  cardOverPage,
  cardsOf,
  keepingPanel,
  pageOnly,
  panelSearch,
  reviewOverCard,
  withCard,
  withCards,
  withoutPanel,
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
    expect(cardOverPage('/staff', '?show=clew.talkPeople&cards=johan&cards-kind=act', 'ledighet')).toBe(
      '/staff?show=clew.talkPeople&cards=johan&cards-kind=act&card=ledighet',
    );
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

describe('one person’s cards as a list beside Personal (D107 answer 6)', () => {
  test('the list takes the place of what the panel held, and keeps the page’s lens', () => {
    expect(withCards('/staff', '?show=clew.talkPeople', 'johan', 'act')).toBe(
      '/staff?show=clew.talkPeople&cards=johan&cards-kind=act',
    );
    expect(withCards('/staff', '?show=x&card=t1&open=a.b&open-title=A', 'johan', 'proposal')).toBe(
      '/staff?show=x&cards=johan&cards-kind=proposal',
    );
    expect(withCards('/staff', '', 'johan')).toBe('/staff?cards=johan');
    expect(cardsOf(new URLSearchParams('?show=x&cards=johan&cards-kind=act'))).toEqual({ key: 'johan', kind: 'act' });
    expect(cardsOf(new URLSearchParams('?cards=johan&cards-kind=fyi'))).toEqual({ key: 'johan', kind: undefined });
    expect(cardsOf(new URLSearchParams('?show=x'))).toBeNull();
  });
  test('a card opened from the list lies over it, and closing peels the card, then the list', () => {
    const list = '?show=x&cards=johan&cards-kind=act';
    const card = withCard('/staff', list, 't1');
    expect(card).toBe('/staff?show=x&cards=johan&cards-kind=act&card=t1');
    const read = '?show=x&cards=johan&cards-kind=act&card=t1&open-card=t1&open-action=pattern';
    expect(withoutPanel('/staff', read)).toBe(card);
    expect(withoutPanel('/staff', card.slice('/staff'.length))).toBe(`/staff${list}`);
    expect(withoutPanel('/staff', list)).toBe('/staff?show=x');
  });
  test('the page’s own address drops the list; a conversation does not take it along', () => {
    expect(pageOnly('/staff', '?show=x&cards=johan&cards-kind=act&card=t1')).toBe('/staff?show=x');
    expect(pageOnly('', '?cards=johan')).toBe('');
    // A way back holds nothing that lay over the page either.
    expect(pageOnly('/', '?tab=done&card=f&review=f&step=2')).toBe('/?tab=done');
    expect(pageOnly('/staff', '?show=x&talk=anna')).toBe('/staff?show=x');
    expect(panelSearch('?show=x&cards=johan&cards-kind=act&card=t1')).toBe('?card=t1');
    expect(keepingPanel('/staff?show=y', '?show=x&cards=johan&cards-kind=act')).toBe(
      '/staff?show=y&cards=johan&cards-kind=act',
    );
  });
});
