import { sameSubject, type Subject } from '@clew/contracts';
import { pageOnly } from './panel-address';

/**
 * Where a person or a unit is (D97, D43, D83 rule 4, D111 rule 3): `/people/<key>` is the person as a page, with
 * `section` the source whose fuller view is drawn and `from` the page they were opened from, for the way back;
 * `/units/<id>` is the unit as a page, with `from` the same way. A person is a page only: nothing draws them beside a
 * list, and the address that once did (`?person=`) leads to their page (`fromPersonBeside`).
 */
/** The value Behöver dig takes in the address (`?section=`): never a capability's name, which always has a dot. */
export const NEEDS_YOU = 'needs-you';
const addressOf = (pathname: string, query: URLSearchParams) => {
  const q = query.toString();
  return q ? `${pathname}?${q}` : pathname;
};
/** A path inside Clew, never another site: what `from` may hold. */
export const insideClew = (path: string | null): string | null =>
  path && path.startsWith('/') && !path.startsWith('//') && !path.startsWith('/\\') ? path : null;
/**
 * The page a person or a unit was opened from, as `from` holds it: a path inside Clew with its own search, never the
 * `from` of that page, so a way back never holds another way back (`/people/anna?from=/staff` names `/people/anna`).
 * The trail and the rail name `from` by its path alone (`originOf`: Hem, Personal, Kalender or a tool, never a person
 * or a unit), and the trail leads back to it with its own search (a card still open beside it), so the nested one was
 * never read.
 */
export const wayBack = (path: string | null | undefined): string | null => {
  const inside = insideClew(path ?? null);
  const at = inside ? inside.indexOf('?') : -1;
  if (!inside || at < 0) return inside;
  const q = new URLSearchParams(inside.slice(at + 1));
  if (!q.has('from')) return inside;
  q.delete('from');
  return addressOf(inside.slice(0, at), q);
};
/** The person as a page, with a section chosen and the list it was opened from. */
export function personPageHref(key: string, options: { section?: string; from?: string | null } = {}): string {
  const q = new URLSearchParams();
  if (options.section) q.set('section', options.section);
  const from = wayBack(options.from);
  if (from) q.set('from', from);
  return addressOf(`/people/${encodeURIComponent(key)}`, q);
}
/**
 * The person's page as a name in a list leads to it (the product owner, 2026-11-11: the name opens the page), with the
 * list as its way back: the list's own address, its lens kept and nothing of its panel.
 */
export const personPageFrom = (pathname: string, search: URLSearchParams | string, key: string): string =>
  personPageHref(key, { from: pageOnly(pathname, search) });
/**
 * Where an address that drew a person beside a list now leads (D111 answer 1): `?person=<key>` on the list, kept in
 * bookmarks and sent links, is the person's page with the list as its way back. The section drilled into on a phone
 * (`person-section`) is the page's `section`, and a card open over the person stays open beside the page. Null for any
 * other address.
 */
export function fromPersonBeside(pathname: string, search: URLSearchParams | string): string | null {
  const q = new URLSearchParams(search);
  const key = q.get('person');
  if (!key) return null;
  const section = q.get('person-section') || undefined;
  const card = q.get('card');
  q.delete('person');
  q.delete('person-section');
  const page = personPageHref(key, { ...(section ? { section } : {}), from: pageOnly(pathname, q) });
  return card ? `${page}${page.includes('?') ? '&' : '?'}card=${encodeURIComponent(card)}` : page;
}
/**
 * Where an address that listed a person's cards beside Personal now leads (D111, amended 2026-11-11: the panel holds one
 * opened thing): `?cards=<key>`, with `cards-kind`, is the person's page at Behöver dig with the list as its way back,
 * and a card open over that list stays open beside the page. Null for any other address.
 */
export function fromCardsBeside(pathname: string, search: URLSearchParams | string): string | null {
  const q = new URLSearchParams(search);
  const key = q.get('cards');
  if (!key) return null;
  const card = q.get('card');
  q.delete('cards');
  q.delete('cards-kind');
  const page = personPageHref(key, { section: NEEDS_YOU, from: pageOnly(pathname, q) });
  return card ? `${page}&card=${encodeURIComponent(card)}` : page;
}
/** The unit as a page (D97, artboard E), with the page it was opened from. */
export function unitPageHref(id: string, options: { from?: string | null } = {}): string {
  const q = new URLSearchParams();
  const from = wayBack(options.from);
  if (from) q.set('from', from);
  return addressOf(`/units/${encodeURIComponent(id)}`, q);
}
/** The person or unit whose page `pathname` is (`/people/<key>`, `/units/<id>`), or null on any other page. */
export function pageSubject(pathname: string): Subject | null {
  const match = /^\/(people|units)\/([^/]+)\/?$/.exec(pathname);
  if (!match) return null;
  try {
    return { entity: match[1] === 'units' ? 'unit' : 'person', key: decodeURIComponent(match[2]!) };
  } catch {
    return null;
  }
}
/**
 * Where a row that names an entity leads (D97 item 6): a person to their page, a unit to its page, each with the
 * address of the page the row was on as `from`, so the way back returns to it as it was (a work item still open in Att
 * göra's reading pane).
 * Null on the entity's own page: a row there that names the person or unit the page is about would lead to the page the
 * reader is already on, out of the card it stands in, so its name is plain text (the product owner, 2026-11-11).
 */
export function entityHref(subject: Subject, from?: string | null): string | null {
  const here = from ? pageSubject(from.split('?')[0]!) : null;
  if (here && sameSubject(here, subject)) return null;
  const options = { from: from ?? null };
  return subject.entity === 'unit' ? unitPageHref(subject.key, options) : personPageHref(subject.key, options);
}
/** The name of a page a person can be opened from, for the way back ("‹ Personal"); null for a page without one. */
export function originLabel(path: string | null): string | null {
  if (!path) return null;
  const pathname = path.split('?')[0]!;
  if (pathname === '/admin/users') return 'Användare';
  // A unit's page under Organisation, when the page that knows the unit's name has not given it (`person.tsx`).
  if (pathname === '/admin/organisation' || pathname.startsWith('/admin/organisation/')) return 'Organisation';
  if (pathname === '/staff') return 'Personal';
  if (pathname === '/') return 'Hem';
  if (pathname === '/todo') return 'Att göra';
  if (pathname === '/calendar') return 'Kalender';
  // D121: a person's holdings opened from a hit of the registrar's search.
  if (pathname === '/competence/search') return 'Kompetenssökning';
  // D124: a plan opened from the list (item 12), and a person opened from their plan's "Tillhör".
  if (pathname === '/boarding' || pathname.startsWith('/boarding/')) return 'Introduktion och avslut';
  return null;
}
/** The tool a page was opened from (`/tools/<capability>`), or null. */
export function toolOf(path: string | null): string | null {
  const tool = path ? /^\/tools\/([^/?]+)/.exec(path)?.[1] : undefined;
  if (!tool) return null;
  try {
    return decodeURIComponent(tool);
  } catch {
    return null;
  }
}
/** Where a page was opened from, as the way back names it: a page Clew names, or a tool's page by its row in the menu. */
export function originOf(
  from: string | null,
  menu: ReadonlyArray<{ capability: string; label: string }> = [],
): { label: string; href: string } | null {
  if (!from) return null;
  const tool = toolOf(from);
  const label = originLabel(from) ?? (tool ? menu.find(m => m.capability === tool)?.label : undefined);
  return label ? { label, href: from } : null;
}
