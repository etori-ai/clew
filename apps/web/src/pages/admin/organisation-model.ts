import {
  USERS_PAGE_SIZES,
  type OrganisationUnit,
  type OrganisationUnitPeople,
  type StaffPerson,
} from '@clew/contracts';
import { roleText } from './labels';

/**
 * Administration › Organisation (D99) without React: the addresses of the tree and of a unit's page, what an import
 * left wrong on a unit, and a unit's people as the page groups, narrows and pages them.
 *
 * A unit is a page of its own, `/admin/organisation/<unitId>` (the product owner, 2026-11-12: a panel is for peeking or
 * an instant action; a list that can grow gets a full route). The address that opened the unit's people over the tree,
 * `/admin/organisation?unit=<unitId>`, leads to the page. The page's own query holds the page shown of each group and
 * the page size (D43: English names); the words typed into its search box are not in it, as on Användare, because they
 * are a person's name.
 */
export const ORGANISATION_PATH = '/admin/organisation';
const OVERLAY_PARAM = 'unit';
/** A unit's page under Administration. */
export const organisationUnitPath = (unitId: string) => `${ORGANISATION_PATH}/${encodeURIComponent(unitId)}`;
/** The unit whose page `pathname` is, or null on any other page. */
export function organisationUnitOf(pathname: string): string | null {
  const match = /^\/admin\/organisation\/([^/]+)\/?$/.exec(pathname);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]!) || null;
  } catch {
    return null;
  }
}
/** Where the overlay's address (`?unit=<unitId>` on the tree) now leads: the unit's page. Null for any other address. */
export function fromUnitOverlay(search: URLSearchParams | string): string | null {
  const unitId = new URLSearchParams(search).get(OVERLAY_PARAM);
  return unitId ? organisationUnitPath(unitId) : null;
}

const names = new Intl.ListFormat('sv', { type: 'conjunction' });
const count = new Intl.NumberFormat('sv-SE');
/** "1 person", "412 personer". */
export const people = (n: number) => `${count.format(n)} ${n === 1 ? 'person' : 'personer'}`;
/** "3 personer" without a search, "2 av 3 personer" with one. */
export const shownOf = (shown: number, all: number) =>
  shown === all ? people(all) : `${count.format(shown)} av ${people(all)}`;
/** The units above a unit, nearest first; the walk ends at a root, and at the tree's size if a chain were ever a ring. */
export function ancestorsOf(units: ReadonlyMap<string, OrganisationUnit>, unitId: string | null) {
  const above: OrganisationUnit[] = [];
  for (let at = unitId ? units.get(unitId) : undefined; at?.parentId && above.length < units.size;) {
    at = units.get(at.parentId);
    if (at) above.push(at);
  }
  return above;
}
/** The units directly below a unit, in the tree's order (by name, as the server sorts them). */
export const childrenOf = (units: ReadonlyArray<OrganisationUnit>, unitId: string) =>
  units.filter(u => u.parentId === unitId);
/** For a unit led from above (`line: 'above'`): the nearest unit above it that has a manager, whose managers lead it. */
export const leadingUnitOf = (units: ReadonlyMap<string, OrganisationUnit>, unitId: string) =>
  ancestorsOf(units, unitId).find(u => u.managers.length > 0) ?? null;
/** "Chef: Karin Berg · 2 personer, 86 med enheterna under": who leads the unit and how many it holds, as a tree row says it. */
export function describeUnit(u: OrganisationUnit) {
  const led = u.managers.length
    ? `${u.managers.length === 1 ? 'Chef' : 'Chefer'}: ${names.format(u.managers.map(m => m.name))}`
    : u.line === 'above'
      ? 'Leds från enheten ovanför'
      : 'Ingen chef';
  return `${led} · ${people(u.placed)}${u.branch > u.placed ? `, ${u.branch} med enheterna under` : ''}`;
}
export type UnitMark = { label: 'Saknar enhetsgrupp' | 'Saknar chef' | 'Tom'; variant: 'warning' | 'neutral' };
/**
 * What an import left wrong on a unit, as the tree marks it and the unit's page repeats it: people on a unit no unit
 * group names, people with no manager on the unit or above it, and a unit nobody is placed on with nothing under it (a
 * unit with units under it may well be empty).
 */
export const marksOf = (u: OrganisationUnit, hasBelow: boolean): UnitMark[] => [
  ...(!u.pushed ? [{ label: 'Saknar enhetsgrupp' as const, variant: 'warning' as const }] : []),
  ...(u.line === 'none' && u.placed > 0 ? [{ label: 'Saknar chef' as const, variant: 'warning' as const }] : []),
  ...(u.placed === 0 && !hasBelow ? [{ label: 'Tom' as const, variant: 'neutral' as const }] : []),
];

/** The three groups of a unit's people, in the order the page draws them, by their name in the address. */
export const GROUPS = ['managers', 'employees', 'reports'] as const;
export type GroupKey = (typeof GROUPS)[number];
export interface PeopleGroup {
  key: GroupKey;
  heading: string;
  note?: string;
  /** Everyone in the group. */
  all: StaffPerson[];
  /** Those the search's words find, in the same order. */
  shown: StaffPerson[];
}
/**
 * The words a person is found by: their name, user name, role on the unit (or the units below they report from) and
 * e-mail, in lower case. Every word typed has to be among them, in any order.
 */
const haystack = (p: StaffPerson) =>
  [p.name, p.userName ?? '', roleText(p), p.email ?? ''].join(' ').toLocaleLowerCase('sv');
export const wordsOf = (typed: string) => typed.trim().toLocaleLowerCase('sv').split(/\s+/).filter(Boolean);
export const finds = (p: StaffPerson, words: readonly string[]) => {
  if (!words.length) return true;
  const text = haystack(p);
  return words.every(w => text.includes(w));
};
/**
 * A unit's people as the page groups them (D99 item 6): who leads the unit first, then the others placed on it, then
 * who reports to its managers from the units below, named after the managers who lead it now. A group nobody is in is
 * left out; one the words find nobody in keeps its place with nobody shown, so the page can say so.
 */
export function groupsOf(read: Pick<OrganisationUnitPeople, 'people' | 'reports'>, words: readonly string[]) {
  const leaders = read.people.filter(p => p.role === 'manager'),
    others = read.people.filter(p => p.role !== 'manager'),
    leading = leaders.filter(p => p.enabled).map(p => p.name);
  const groups: Array<Omit<PeopleGroup, 'shown'>> = [
    { key: 'managers', heading: leaders.length === 1 ? 'Chef' : 'Chefer', all: leaders },
    { key: 'employees', heading: 'Medarbetare', all: others },
    {
      key: 'reports',
      heading: leading.length ? `Rapporterar till ${names.format(leading)}` : 'Rapporterar från enheterna under',
      note: 'Från enheterna under: cheferna närmast under, och de som är placerade på en enhet som ingen leder.',
      all: read.reports,
    },
  ];
  return groups.filter(g => g.all.length > 0).map(g => ({ ...g, shown: g.all.filter(p => finds(p, words)) }));
}
/**
 * "3 personer på enheten, 1 avstängd": the people placed on the unit as the tree's row counts them (deactivated people
 * are counted nowhere there), and the deactivated ones the unit's read lists beside them.
 */
export const placedLine = (placed: number, off: number) =>
  `${people(placed)} på enheten${off ? `, ${off} ${off === 1 ? 'avstängd' : 'avstängda'}` : ''}`;

/** The address's name for the page a group shows. */
export const pageParam = (key: GroupKey) => `${key}-page`;
/** Which page of each group the address asks for, and how many rows a page holds. Anything it cannot mean is page 1. */
export function pagingOf(params: URLSearchParams) {
  const size = Number(params.get('size'));
  const pages = Object.fromEntries(
    GROUPS.map(key => {
      const page = Number(params.get(pageParam(key)));
      return [key, Number.isInteger(page) && page > 1 ? page : 1];
    }),
  ) as Record<GroupKey, number>;
  return { size: USERS_PAGE_SIZES.find(n => n === size) ?? USERS_PAGE_SIZES[0], pages };
}
/** The rows of one page, the page held inside the pages there are (a search can leave fewer than the address names). */
export function pageOf<T>(rows: readonly T[], page: number, size: number) {
  const last = Math.max(1, Math.ceil(rows.length / size)),
    at = Math.min(Math.max(1, page), last);
  return { page: at, rows: rows.slice((at - 1) * size, at * size), first: (at - 1) * size + 1 };
}
