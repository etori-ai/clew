/**
 * One person's talk has an address of its own (D96 item 7, D83): Personal with the person's id as `talk`,
 * `/staff?talk=<personId>`. The list stays the page and the talk is a drawer over it, so closing the drawer is the same
 * page without `talk`. Everything else in the address is the page's own and is kept.
 */
export const STAFF_PATH = '/staff';
export const TALK_PARAM = 'talk';

const address = (query: URLSearchParams) => {
  const q = query.toString();
  return q ? `${STAFF_PATH}?${q}` : STAFF_PATH;
};

/** The person whose talk the address names, or null when it names none. */
export function talkOf(search: URLSearchParams | string): string | null {
  return new URLSearchParams(search).get(TALK_PARAM) || null;
}
/** Personal with this person's talk open over the list; the rest of the page's address is kept. */
export function talkHref(personId: string, search: URLSearchParams | string = ''): string {
  const q = new URLSearchParams(search);
  q.set(TALK_PARAM, personId);
  return address(q);
}
/** Personal with the talk closed: the address without `talk`. */
export function withoutTalk(search: URLSearchParams | string = ''): string {
  const q = new URLSearchParams(search);
  q.delete(TALK_PARAM);
  return address(q);
}
