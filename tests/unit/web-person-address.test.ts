import { describe, expect, test } from 'bun:test';
import { entityHref, pageSubject, personPageHref, unitPageHref } from '../../apps/web/src/person-address';

describe('the way back to the page a person or a unit was opened from', () => {
  test('`from` holds the page with its own search, never that page’s own `from`', () => {
    expect(personPageHref('anna', { from: '/people/johan?section=needs-you&from=%2Fstaff&card=c1' })).toBe(
      '/people/anna?from=%2Fpeople%2Fjohan%3Fsection%3Dneeds-you%26card%3Dc1',
    );
    expect(unitPageHref('unit-skola', { from: '/people/johan?from=%2Fstaff' })).toBe(
      '/units/unit-skola?from=%2Fpeople%2Fjohan',
    );
  });

  test('a page without a `from` of its own is kept as it was written', () => {
    expect(personPageHref('johan', { from: '/staff?show=talks.person&card=c1' })).toBe(
      '/people/johan?from=%2Fstaff%3Fshow%3Dtalks.person%26card%3Dc1',
    );
    expect(personPageHref('johan', { section: 'needs-you', from: '/staff' })).toBe(
      '/people/johan?section=needs-you&from=%2Fstaff',
    );
    expect(personPageHref('johan', { from: 'https://example.org/' })).toBe('/people/johan');
  });
});

describe('a row that names the entity whose page it is on', () => {
  test('the page names its person or unit', () => {
    expect(pageSubject('/people/johan')).toEqual({ entity: 'person', key: 'johan' });
    expect(pageSubject('/people/anna%20l')).toEqual({ entity: 'person', key: 'anna l' });
    expect(pageSubject('/units/unit-skola')).toEqual({ entity: 'unit', key: 'unit-skola' });
    expect(pageSubject('/staff')).toBeNull();
    expect(pageSubject('/people/johan/more')).toBeNull();
  });

  test('leads nowhere on that page, and to the entity from any other page', () => {
    const johan = { entity: 'person' as const, key: 'johan' };
    expect(entityHref(johan, '/people/johan?section=needs-you&from=%2Fstaff&card=c1')).toBeNull();
    // A person's key is their id, compared exactly (D122): another spelling is another person, with a page of their own.
    expect(entityHref({ entity: 'person', key: 'Johan' }, '/people/johan')).toBe(
      '/people/Johan?from=%2Fpeople%2Fjohan',
    );
    expect(entityHref({ entity: 'unit', key: 'unit-skola' }, '/units/unit-skola?card=c1')).toBeNull();
    expect(entityHref(johan, '/people/anna?card=c1')).toBe('/people/johan?from=%2Fpeople%2Fanna%3Fcard%3Dc1');
    expect(entityHref(johan, '/units/johan')).toBe('/people/johan?from=%2Funits%2Fjohan');
    expect(entityHref(johan, '/?card=c1')).toBe('/people/johan?from=%2F%3Fcard%3Dc1');
    expect(entityHref(johan)).toBe('/people/johan');
  });
});
