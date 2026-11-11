import { describe, expect, test } from 'bun:test';
import {
  cardOverPage,
  cardsOf,
  keepingPanel,
  pageOnly,
  panelSearch,
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
  test('from the bell, a toast or the search: over the page, except a review, which is still Hem’s (D73)', () => {
    expect(cardOverPage('/admin/connectors', '', 'ledighet')).toBe('/admin/connectors?card=ledighet');
    expect(cardOverPage('/staff', '?show=clew.talkPeople&cards=johan&cards-kind=act', 'ledighet')).toBe(
      '/staff?show=clew.talkPeople&cards=johan&cards-kind=act&card=ledighet',
    );
    expect(cardOverPage('/cards/fakturor/review', '?step=2', 'ledighet')).toBe('/?card=ledighet');
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
    expect(panelSearch('?show=x&cards=johan&cards-kind=act&card=t1')).toBe('?card=t1');
    expect(keepingPanel('/staff?show=y', '?show=x&cards=johan&cards-kind=act')).toBe(
      '/staff?show=y&cards=johan&cards-kind=act',
    );
  });
});
