/**
 * Where a person is (D97, D43, D83 rule 4): `?person=<key>` on the page that shows the list opens them beside it, with
 * `person-section=<capability>` the section drilled into on a phone; `/people/<key>` is the person as a page, with
 * `section` the source whose fuller view is drawn and `from` the list they were opened from, for the way back.
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
/** The name of a page a person can be opened from, for the way back ("‹ Personal"); null for a page without one. */
export function originLabel(path: string | null): string | null {
  if (!path) return null;
  const pathname = path.split('?')[0]!;
  if (pathname === '/staff') return 'Personal';
  if (pathname === '/') return 'Hem';
  if (pathname === '/calendar') return 'Kalender';
  return null;
}
