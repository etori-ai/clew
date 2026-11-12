/**
 * Registering a certificate for one person has an address of its own (D108 item 7, D83): the page with the person's id
 * as `register`, `/staff?register=<personId>` on Personal and `/competence/matrix?register=<personId>` on the matrix.
 * The page stays and the form is a dialog over it, so closing the dialog is the same page without `register`.
 * `competence` names the type the form starts on, as a cell of the matrix opens it (D108 item 11); the catalogue's own
 * dialog uses `type`, so this is a name of its own. Everything else in the address is the page's own and is kept.
 */
export const REGISTER_PARAM = 'register';
export const COMPETENCE_PARAM = 'competence';

const address = (pathname: string, query: URLSearchParams) => {
  const q = query.toString();
  return q ? `${pathname}?${q}` : pathname;
};
/** The person the address names for a registration, or null when it names none. */
export function registerOf(search: URLSearchParams | string): string | null {
  return new URLSearchParams(search).get(REGISTER_PARAM) || null;
}
/** The competence type the registration starts on, or null when the address names none. */
export function registerTypeOf(search: URLSearchParams | string): string | null {
  return new URLSearchParams(search).get(COMPETENCE_PARAM) || null;
}
/**
 * The page with the registration for this person open over it, starting on `typeId` when one is given; the rest of the
 * page's address is kept.
 */
export function registerHref(
  pathname: string,
  personId: string,
  search: URLSearchParams | string = '',
  typeId?: string,
): string {
  const q = new URLSearchParams(search);
  q.set(REGISTER_PARAM, personId);
  if (typeId) q.set(COMPETENCE_PARAM, typeId);
  else q.delete(COMPETENCE_PARAM);
  return address(pathname, q);
}
/** The page with the registration closed: the address without `register` and `competence`. */
export function withoutRegister(pathname: string, search: URLSearchParams | string = ''): string {
  const q = new URLSearchParams(search);
  q.delete(REGISTER_PARAM);
  q.delete(COMPETENCE_PARAM);
  return address(pathname, q);
}
