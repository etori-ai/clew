import { describe, expect, test } from 'bun:test';
import type { OrganisationUnit, StaffPerson } from '@clew/contracts';
import {
  ancestorsOf,
  childrenOf,
  fromUnitOverlay,
  groupsOf,
  leadingUnitOf,
  marksOf,
  organisationUnitOf,
  organisationUnitPath,
  pageOf,
  pagingOf,
  placedLine,
  shownOf,
  wordsOf,
} from '../src/pages/admin/organisation-model';
import { originLabel } from '../src/person-address';

const unit = (unitId: string, parentId: string | null, extra: Partial<OrganisationUnit> = {}): OrganisationUnit => ({
  unitId,
  unitLabel: unitId,
  parentId,
  managers: [],
  placed: 1,
  branch: 1,
  line: 'own',
  pushed: true,
  ...extra,
});
const person = (id: string, name: string, extra: Partial<StaffPerson> = {}): StaffPerson => ({
  id,
  name,
  userName: id,
  email: `${id}@clew.test`,
  role: 'employee',
  enabled: true,
  ...extra,
});

describe('a unit is a page of its own under Organisation (D99, the product owner 2026-11-12)', () => {
  test('its address is English and holds the catalogue id as it is', () => {
    expect(organisationUnitPath('unit-skola')).toBe('/admin/organisation/unit-skola');
    expect(organisationUnitPath('a b/c')).toBe('/admin/organisation/a%20b%2Fc');
    expect(organisationUnitOf('/admin/organisation/a%20b%2Fc')).toBe('a b/c');
    expect(organisationUnitOf('/admin/organisation/unit-skola/')).toBe('unit-skola');
    expect(organisationUnitOf('/admin/organisation')).toBeNull();
    expect(organisationUnitOf('/admin/organisation/a/b')).toBeNull();
    expect(organisationUnitOf('/admin/organisation/%E0%A4%A')).toBeNull();
  });
  test('the overlay address leads to the page, and nothing else does', () => {
    expect(fromUnitOverlay('?unit=unit-skola')).toBe('/admin/organisation/unit-skola');
    expect(fromUnitOverlay(new URLSearchParams({ unit: 'a b' }))).toBe('/admin/organisation/a%20b');
    expect(fromUnitOverlay('')).toBeNull();
    expect(fromUnitOverlay('?unit=')).toBeNull();
    expect(fromUnitOverlay('?status=no-access')).toBeNull();
  });
  test('a person opened from a unit page has a way back named Organisation until the unit name is known', () => {
    expect(originLabel('/admin/organisation/unit-skola?employees-page=2')).toBe('Organisation');
    expect(originLabel('/admin/organisation')).toBe('Organisation');
  });
});

describe('where a unit stands in the tree', () => {
  const tree = [
    unit('kommun', null, { managers: [{ id: 'y', name: 'Yusuf' }] }),
    unit('omsorg', 'kommun', { managers: [] }),
    unit('hemtjanst', 'omsorg', { line: 'above', placed: 0, branch: 4 }),
    unit('centrum', 'hemtjanst'),
    unit('norr', 'hemtjanst'),
  ];
  const byId = new Map(tree.map(u => [u.unitId, u]));
  test('the units above, nearest first, and the ones directly below', () => {
    expect(ancestorsOf(byId, 'hemtjanst').map(u => u.unitId)).toEqual(['omsorg', 'kommun']);
    expect(ancestorsOf(byId, 'kommun')).toEqual([]);
    expect(childrenOf(tree, 'hemtjanst').map(u => u.unitId)).toEqual(['centrum', 'norr']);
    expect(childrenOf(tree, 'centrum')).toEqual([]);
  });
  test('a unit led from above is led by the nearest unit above that has a manager', () => {
    expect(leadingUnitOf(byId, 'hemtjanst')?.unitId).toBe('kommun');
    expect(leadingUnitOf(byId, 'kommun')).toBeNull();
  });
  test('a ring in the stored chain ends the walk', () => {
    const ring = new Map([
      ['a', unit('a', 'b')],
      ['b', unit('b', 'a')],
    ]);
    expect(ancestorsOf(ring, 'a').length).toBeLessThanOrEqual(2);
  });
  test('the marks are the tree marks, in its words', () => {
    expect(marksOf(unit('x', null, { pushed: false }), false).map(m => m.label)).toEqual(['Saknar enhetsgrupp']);
    expect(marksOf(unit('x', null, { line: 'none', placed: 2 }), false).map(m => m.label)).toEqual(['Saknar chef']);
    expect(marksOf(unit('x', null, { placed: 0, line: 'none' }), false).map(m => m.label)).toEqual(['Tom']);
    // A unit with units under it may well be empty.
    expect(marksOf(unit('x', null, { placed: 0 }), true)).toEqual([]);
  });
});

describe("a unit's people in three groups, searched and paged on the page", () => {
  const hillevi = person('hillevi', 'Hillevi Berg', { role: 'manager' }),
    anna = person('anna', 'Anna Lindqvist'),
    vera = person('vera', 'Vera Öst', { enabled: false, email: null }),
    omar = person('omar', 'Omar Hosseini', {
      below: [{ unitId: 'unit-hagaskolan', unitLabel: 'Hagaskolan', role: 'employee' }],
    }),
    karin = person('karin', 'Karin Åberg', {
      role: 'manager',
      below: [{ unitId: 'unit-skola', unitLabel: 'Bergsåkers skola', role: 'manager' }],
    });
  const read = { people: [anna, hillevi, vera], reports: [karin, omar] };
  test('who leads the unit, then the others on it, then who reports from below, named by those who lead it', () => {
    const groups = groupsOf(read, []);
    expect(groups.map(g => [g.key, g.heading, g.all.map(p => p.id)])).toEqual([
      ['managers', 'Chef', ['hillevi']],
      ['employees', 'Medarbetare', ['anna', 'vera']],
      ['reports', 'Rapporterar till Hillevi Berg', ['karin', 'omar']],
    ]);
    expect(groups[2]!.note).toContain('Från enheterna under');
    expect(
      groupsOf({ people: [hillevi, { ...karin, below: undefined } as StaffPerson], reports: [] }, [])[0]!.heading,
    ).toBe('Chefer');
  });
  test('a group nobody is in is left out', () => {
    expect(groupsOf({ people: [anna], reports: [] }, []).map(g => g.key)).toEqual(['employees']);
    expect(groupsOf({ people: [], reports: [] }, [])).toEqual([]);
  });
  test('the search finds by name, user name, role and e-mail, every word anywhere, in any case', () => {
    const found = (typed: string) => groupsOf(read, wordsOf(typed)).flatMap(g => g.shown.map(p => p.id));
    expect(found('')).toEqual(['hillevi', 'anna', 'vera', 'karin', 'omar']);
    expect(found('  LINDQVIST  ')).toEqual(['anna']);
    expect(found('vera')).toEqual(['vera']);
    expect(found('omar@clew')).toEqual(['omar']);
    // The role as the page says it: "Chef för Bergsåkers skola", "Medarbetare på Hagaskolan".
    expect(found('chef för bergsåkers')).toEqual(['karin']);
    expect(found('hagaskolan')).toEqual(['omar']);
    expect(found('åberg karin')).toEqual(['karin']);
    expect(found('nobody')).toEqual([]);
    // A group the search finds nobody in keeps its place, with nobody shown.
    expect(groupsOf(read, wordsOf('anna')).map(g => [g.key, g.shown.length])).toEqual([
      ['managers', 0],
      ['employees', 1],
      ['reports', 0],
    ]);
  });
  test('the count is said as the tree counts, deactivated people beside it', () => {
    expect(placedLine(2, 1)).toBe('2 personer på enheten, 1 avstängd');
    expect(placedLine(1, 0)).toBe('1 person på enheten');
    expect(placedLine(0, 2)).toBe('0 personer på enheten, 2 avstängda');
    expect(shownOf(3, 3)).toBe('3 personer');
    expect(shownOf(2, 1412)).toBe('2 av 1 412 personer');
  });
});

describe('the pages of a long group', () => {
  test('the address names a page per group and one page size, and anything else is the first page', () => {
    expect(pagingOf(new URLSearchParams())).toEqual({
      size: 25,
      pages: { managers: 1, employees: 1, reports: 1 },
    });
    expect(pagingOf(new URLSearchParams('employees-page=3&reports-page=2&size=50'))).toEqual({
      size: 50,
      pages: { managers: 1, employees: 3, reports: 2 },
    });
    expect(pagingOf(new URLSearchParams('employees-page=-1&managers-page=x&size=7'))).toEqual({
      size: 25,
      pages: { managers: 1, employees: 1, reports: 1 },
    });
  });
  test('a page past the last is the last, and the rows know where they start', () => {
    const rows = Array.from({ length: 412 }, (_, i) => i + 1);
    expect(pageOf(rows, 1, 25)).toEqual({ page: 1, rows: rows.slice(0, 25), first: 1 });
    const last = pageOf(rows, 99, 25);
    expect(last.page).toBe(17);
    expect(last.first).toBe(401);
    expect(last.rows).toEqual(rows.slice(400));
    expect(pageOf([], 3, 25)).toEqual({ page: 1, rows: [], first: 1 });
  });
});
