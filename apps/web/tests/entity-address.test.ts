import { describe, expect, test } from 'bun:test';
import { entityHref, personPageHref, unitPageHref } from '../src/person-address';

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
