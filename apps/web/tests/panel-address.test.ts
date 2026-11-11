import { describe, expect, test } from 'bun:test';
import { cardOverPage, keepingPanel, withCard, withoutPanel } from '../src/panel-address';

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
    expect(cardOverPage('/staff', '?show=clew.talkPeople&person=johan', 'ledighet')).toBe(
      '/staff?show=clew.talkPeople&person=johan&card=ledighet',
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
