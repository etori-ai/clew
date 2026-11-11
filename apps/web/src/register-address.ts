/**
 * Registering a certificate for one person has an address of its own (D107 item 7, D83): Personal with the person's id
 * as `register`, `/staff?register=<personId>`. The list stays the page and the form is a dialog over it, so closing the
 * dialog is the same page without `register`. Everything else in the address is the page's own and is kept.
 */
export const REGISTER_PARAM = 'register';

const address = (pathname: string, query: URLSearchParams) => {
  const q = query.toString();
  return q ? `${pathname}?${q}` : pathname;
};
/** The person the address names for a registration, or null when it names none. */
export function registerOf(search: URLSearchParams | string): string | null {
  return new URLSearchParams(search).get(REGISTER_PARAM) || null;
}
/** The page with the registration for this person open over it; the rest of the page's address is kept. */
export function registerHref(pathname: string, personId: string, search: URLSearchParams | string = ''): string {
  const q = new URLSearchParams(search);
  q.set(REGISTER_PARAM, personId);
  return address(pathname, q);
}
/** The page with the registration closed: the address without `register`. */
export function withoutRegister(pathname: string, search: URLSearchParams | string = ''): string {
  const q = new URLSearchParams(search);
  q.delete(REGISTER_PARAM);
  return address(pathname, q);
}
