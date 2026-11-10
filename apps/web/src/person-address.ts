import type { Subject } from '@clew/contracts';

/**
 * Where a person or a unit is (D97, D43, D83 rule 4): `?person=<key>` on the page that shows the list opens them beside
 * it, with `person-section=<capability>` the section drilled into on a phone; `/people/<key>` is the person as a page,
 * with `section` the source whose fuller view is drawn and `from` the list they were opened from, for the way back;
 * `/units/<id>` is the unit as a page, with `from` the same way.
 */
export const PERSON = 'person';
export const PERSON_SECTION = 'person-section';

const addressOf = (pathname: string, query: URLSearchParams) => {
  const q = query.toString();
  return q ? `${pathname}?${q}` : pathname;
};
/** The page's own address without the person: what closing the person leaves. */
export function withoutPerson(pathname: string, search: URLSearchParams | string): string {
  const q = new URLSearchParams(search);
  q.delete(PERSON);
  q.delete(PERSON_SECTION);
  return addressOf(pathname, q);
}
/** The same page with the person opened beside the list and, on a phone, one section drilled into. */
export function withPersonSection(pathname: string, search: URLSearchParams | string, section: string | null): string {
  const q = new URLSearchParams(search);
  if (section) q.set(PERSON_SECTION, section);
  else q.delete(PERSON_SECTION);
  return addressOf(pathname, q);
}
/** A path inside Clew, never another site: what `from` may hold. */
export const insideClew = (path: string | null): string | null =>
  path && path.startsWith('/') && !path.startsWith('//') && !path.startsWith('/\\') ? path : null;
/** The person as a page, with a section chosen and the list it was opened from. */
export function personPageHref(key: string, options: { section?: string; from?: string | null } = {}): string {
  const q = new URLSearchParams();
  if (options.section) q.set('section', options.section);
  const from = insideClew(options.from ?? null);
  if (from) q.set('from', from);
  return addressOf(`/people/${encodeURIComponent(key)}`, q);
}
/** The unit as a page (D97, artboard E), with the page it was opened from. */
export function unitPageHref(id: string, options: { from?: string | null } = {}): string {
  const q = new URLSearchParams();
  const from = insideClew(options.from ?? null);
  if (from) q.set('from', from);
  return addressOf(`/units/${encodeURIComponent(id)}`, q);
}
/**
 * Where a row that names an entity leads (D97 item 6): a person to their page, a unit to its page, each with the
 * address of the page the row was on as `from`, so the way back returns to it as it was (a card still open beside Hem).
 */
export function entityHref(subject: Subject, from?: string | null): string {
  const options = { from: from ?? null };
  return subject.entity === 'unit' ? unitPageHref(subject.key, options) : personPageHref(subject.key, options);
}
/** The name of a page a person can be opened from, for the way back ("‹ Personal"); null for a page without one. */
export function originLabel(path: string | null): string | null {
  if (!path) return null;
  const pathname = path.split('?')[0]!;
  if (pathname === '/staff') return 'Personal';
  if (pathname === '/') return 'Hem';
  if (pathname === '/calendar') return 'Kalender';
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
