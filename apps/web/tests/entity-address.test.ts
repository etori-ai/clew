import { describe, expect, test } from 'bun:test';
import type { PanelViewSpec } from '@clew/contracts';
import {
  entityHref,
  fromCardsBeside,
  fromPersonBeside,
  personPageFrom,
  personPageHref,
  recordSubject,
  unitPageHref,
} from '../src/person-address';

describe('a row that names an entity leads to it (D97 item 6, D83 rule 4)', () => {
  test('a unit is a page of its own, with the page it was opened from', () => {
    expect(unitPageHref('unit-skola')).toBe('/units/unit-skola');
    expect(unitPageHref('unit-skola', { from: '/' })).toBe('/units/unit-skola?from=%2F');
    expect(unitPageHref('a b/c', { from: '/?card=fakturor' })).toBe('/units/a%20b%2Fc?from=%2F%3Fcard%3Dfakturor');
  });
  test('the way back is a path inside Clew, never another site', () => {
    expect(unitPageHref('unit-skola', { from: 'https://example.com/' })).toBe('/units/unit-skola');
    expect(unitPageHref('unit-skola', { from: '//example.com/' })).toBe('/units/unit-skola');
    expect(unitPageHref('unit-skola', { from: null })).toBe('/units/unit-skola');
  });
  test('a person leads to their page and a unit to its page, the key as the source wrote it', () => {
    expect(entityHref({ entity: 'person', key: 'Johan' }, '/')).toBe(personPageHref('Johan', { from: '/' }));
    expect(entityHref({ entity: 'person', key: 'johan' })).toBe('/people/johan');
    expect(entityHref({ entity: 'unit', key: 'unit-skola' }, '/tools/talks.talks')).toBe(
      '/units/unit-skola?from=%2Ftools%2Ftalks.talks',
    );
  });
});

describe('a person is a page only (D111 rule 3)', () => {
  test('a name in a list leads to the page, with the list as it stands and nothing of its panel as the way back', () => {
    expect(personPageFrom('/staff', '?show=clew.talkPeople&card=t1&open-card=t1&open-action=pattern', 'johan')).toBe(
      '/people/johan?from=%2Fstaff%3Fshow%3Dclew.talkPeople',
    );
    expect(personPageFrom('/staff', '', 'johan')).toBe('/people/johan?from=%2Fstaff');
  });
  test('an address that drew the person beside the list leads to their page, its section and card kept', () => {
    expect(fromPersonBeside('/staff', '?person=johan')).toBe('/people/johan?from=%2Fstaff');
    expect(fromPersonBeside('/staff', '?show=clew.talkPeople&person=johan&person-section=directory.contact')).toBe(
      '/people/johan?section=directory.contact&from=%2Fstaff%3Fshow%3Dclew.talkPeople',
    );
    expect(fromPersonBeside('/staff', '?show=x&person=johan&card=samtal-svar')).toBe(
      '/people/johan?from=%2Fstaff%3Fshow%3Dx&card=samtal-svar',
    );
    expect(fromPersonBeside('/staff', '?show=x')).toBeNull();
    expect(fromPersonBeside('/staff', '?person=')).toBeNull();
  });
  test('an address that listed the person’s cards beside the list leads to their page at Behöver dig, a card kept', () => {
    expect(fromCardsBeside('/staff', '?cards=johan')).toBe('/people/johan?section=needs-you&from=%2Fstaff');
    expect(fromCardsBeside('/staff', '?show=clew.talkPeople&cards=johan&cards-kind=act')).toBe(
      '/people/johan?section=needs-you&from=%2Fstaff%3Fshow%3Dclew.talkPeople',
    );
    expect(fromCardsBeside('/staff', '?show=x&cards=johan&cards-kind=proposal&card=samtal-svar')).toBe(
      '/people/johan?section=needs-you&from=%2Fstaff%3Fshow%3Dx&card=samtal-svar',
    );
    expect(fromCardsBeside('/staff', '?show=x&person=johan')).toBeNull();
    expect(fromCardsBeside('/staff', '?cards=')).toBeNull();
  });
});

describe("the entity a record names, by Clew's key (D97 item 6, D122)", () => {
  const view = (
    subject?: { entity: 'person' | 'unit'; key: string },
    people?: Record<string, string>,
  ): PanelViewSpec => ({
    kind: 'table',
    title: 'name',
    fields: [{ key: 'name', label: 'Namn' }],
    ...(subject ? { subject } : {}),
    capability: 'hr.list',
    connector: 'hr',
    source: 'Personalsystemet',
    chip: false,
    ...(people ? { people } : {}),
  });
  test("a person by the id the server found for the record's user name; a name nobody holds now names nobody", () => {
    const people = view({ entity: 'person', key: 'user' }, { 'Anna.L': 'p-anna' });
    expect(recordSubject(people, 'Anna.L')).toEqual({ entity: 'person', key: 'p-anna' });
    expect(recordSubject(people, 'anna.l')).toBeUndefined();
    expect(recordSubject(people, 'erik')).toBeUndefined();
    // A name that is a property of every object is still only a name.
    for (const name of ['constructor', '__proto__', 'toString', 'hasOwnProperty'])
      expect([name, recordSubject(people, name)]).toEqual([name, undefined]);
    expect(recordSubject(view({ entity: 'person', key: 'user' }), 'Anna.L')).toBeUndefined();
    expect(recordSubject(people, '')).toBeUndefined();
    expect(recordSubject(people, 42)).toBeUndefined();
  });
  test('a unit by the id the record holds; a view without a subject names nothing', () => {
    expect(recordSubject(view({ entity: 'unit', key: 'unit' }), 'unit-skola')).toEqual({
      entity: 'unit',
      key: 'unit-skola',
    });
    expect(recordSubject(view(), 'unit-skola')).toBeUndefined();
    expect(recordSubject(view(undefined, { 'unit-skola': 'p-1' }), 'unit-skola')).toBeUndefined();
  });
});
