import { describe, expect, test } from 'bun:test';
import type { EntityPage } from '@clew/contracts';
import { TALK_PARAM, sourcePageHref, talkOf, withTalk, withoutTalk } from '../src/talk-address';

describe("a person's talk lies over the page it was opened on (D96 item 7, D107 rule 5)", () => {
  test('the talk is the page with the person as `talk`, everything else in its address kept', () => {
    expect(TALK_PARAM).toBe('talk');
    expect(withTalk('/staff', '', 'anna')).toBe('/staff?talk=anna');
    expect(withTalk('/staff', '', 'a b/c')).toBe('/staff?talk=a+b%2Fc');
    expect(withTalk('/staff', '?show=clew.talkPeople&cards=johan&card=t1', 'anna')).toBe(
      '/staff?show=clew.talkPeople&cards=johan&card=t1&talk=anna',
    );
    expect(withTalk('/people/karin', '?section=clew.talkPeople&from=%2Fstaff', 'karin')).toBe(
      '/people/karin?section=clew.talkPeople&from=%2Fstaff&talk=karin',
    );
  });
  test('the address names the person, or none', () => {
    expect(talkOf(new URLSearchParams('talk=anna'))).toBe('anna');
    expect(talkOf('?talk=anna&open=x')).toBe('anna');
    expect(talkOf(new URLSearchParams(''))).toBeNull();
    expect(talkOf('talk=')).toBeNull();
    expect(talkOf(new URLSearchParams(withTalk('/staff', '', 'a b/c').split('?')[1]))).toBe('a b/c');
  });
  test('one focused overlay at a time: with a review in the address too, the review is drawn and the talk is not', () => {
    expect(talkOf('?talk=anna&review=fakturor')).toBeNull();
    expect(talkOf('?review=fakturor&step=2&talk=anna')).toBeNull();
  });
  test("opening another person's talk replaces the first; the page's own address is kept", () => {
    expect(withTalk('/staff', '?talk=anna&open=hr.person', 'erik')).toBe('/staff?talk=erik&open=hr.person');
  });
  test('closing leaves the page as it was: its lens, its section and way back, what its panel holds', () => {
    expect(withoutTalk('/staff', '?talk=anna')).toBe('/staff');
    expect(withoutTalk('/staff', new URLSearchParams('open=hr.person&talk=anna'))).toBe('/staff?open=hr.person');
    expect(withoutTalk('/people/karin', '?section=clew.talkPeople&from=%2Fstaff&talk=karin&card=t1')).toBe(
      '/people/karin?section=clew.talkPeople&from=%2Fstaff&card=t1',
    );
    expect(withoutTalk('/staff')).toBe('/staff');
  });
});

describe("a source's page in Clew is filled in by one function, wherever its way in is drawn (D97, D107 rule 5)", () => {
  const talk: EntityPage = { title: 'Öppna samtalet', href: '?talk={id}' };
  const karin = { key: 'karin', id: 'p-karin' };
  test('a query alone lies over the page the person is on, with everything in its address kept', () => {
    expect(sourcePageHref(talk, karin, { pathname: '/staff', search: '' })).toBe('/staff?talk=p-karin');
    expect(sourcePageHref(talk, karin, { pathname: '/staff', search: '?show=hr.person&talk=old' })).toBe(
      '/staff?show=hr.person&talk=p-karin',
    );
    expect(sourcePageHref(talk, karin, { pathname: '/staff', search: '?cards=karin&cards-kind=act&card=t1' })).toBe(
      '/staff?cards=karin&cards-kind=act&card=t1&talk=p-karin',
    );
    // On the person's page: the section and the way back stay, and the talk closes to them (Öppna samtalet, D96).
    expect(
      sourcePageHref(talk, karin, { pathname: '/people/karin', search: '?section=clew.talkPeople&from=%2Fstaff' }),
    ).toBe('/people/karin?section=clew.talkPeople&from=%2Fstaff&talk=p-karin');
  });
  test('a path is a page of its own, which keeps the page’s address only when it is that page', () => {
    const lens: EntityPage = { title: 'Visa i Personal', href: '/staff?show=talks.person' };
    expect(sourcePageHref(lens, { key: 'unit-skola', id: 'u1' }, { pathname: '/units/u1', search: '?from=%2F' })).toBe(
      '/staff?show=talks.person',
    );
    expect(sourcePageHref(lens, { key: 'unit-skola' }, { pathname: '/staff', search: '?card=t1' })).toBe(
      '/staff?card=t1&show=talks.person',
    );
    expect(
      sourcePageHref({ title: 'Öppna', href: '/people/{key}' }, { key: 'k å' }, { pathname: '/', search: '' }),
    ).toBe('/people/k%20%C3%A5');
  });
  test('a page that needs Clew’s id is no way in for an entity without one', () => {
    expect(sourcePageHref(talk, { key: 'karin' }, { pathname: '/staff', search: '' })).toBeNull();
  });
});
