import { describe, expect, test } from 'bun:test';
import { STAFF_PATH, TALK_PARAM, talkHref, talkOf, withoutTalk } from '../src/talk-address';

describe("a person's talk has an address over Personal (D96 item 7, D83)", () => {
  test('the drawer is Personal with the person as `talk`', () => {
    expect(STAFF_PATH).toBe('/staff');
    expect(TALK_PARAM).toBe('talk');
    expect(talkHref('anna')).toBe('/staff?talk=anna');
    expect(talkHref('a b/c')).toBe('/staff?talk=a+b%2Fc');
  });
  test('the address names the person, or none', () => {
    expect(talkOf(new URLSearchParams('talk=anna'))).toBe('anna');
    expect(talkOf('?talk=anna&open=x')).toBe('anna');
    expect(talkOf(new URLSearchParams(''))).toBeNull();
    expect(talkOf('talk=')).toBeNull();
    expect(talkOf(new URLSearchParams(talkHref('a b/c').split('?')[1]))).toBe('a b/c');
  });
  test("opening another person's talk replaces the first; the page's own address is kept", () => {
    expect(talkHref('erik', '?talk=anna&open=hr.person')).toBe('/staff?talk=erik&open=hr.person');
  });
  test('closing leaves the list as it was', () => {
    expect(withoutTalk('?talk=anna')).toBe('/staff');
    expect(withoutTalk(new URLSearchParams('open=hr.person&talk=anna'))).toBe('/staff?open=hr.person');
    expect(withoutTalk()).toBe('/staff');
  });
});
