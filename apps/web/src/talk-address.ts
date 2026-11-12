import type { EntityPage } from '@clew/contracts';
import { REVIEW_PARAM } from './review-address';

/**
 * One person's utvecklingssamtal (D96 item 7) lies over the page it was opened on (D111 rule 5): the page's own address
 * with the person's id as `talk`, and everything else in it kept (Personal's lens, a person's section and way back, the
 * card or the cards open in the page's panel). Closing the drawer is the same address without `talk`, so the page is as
 * it was under it. A cold `/staff?talk=<personId>` is Personal with the talk over it.
 *
 * One focused overlay at a time: no control in Clew makes an address that names both a review and a talk. One that
 * arrives with both (typed or edited by hand) draws the review and ignores the talk, since the review may hold a
 * decision on its way: `talkOf` names no talk while `review` is there, and the talk opens once the review has closed.
 */
export const TALK_PARAM = 'talk';

const address = (pathname: string, query: URLSearchParams) => {
  const q = query.toString();
  return q ? `${pathname}?${q}` : pathname;
};

/** The person whose talk the address names, or null when it names none or a review lies over the page instead. */
export function talkOf(search: URLSearchParams | string): string | null {
  const q = new URLSearchParams(search);
  return q.has(REVIEW_PARAM) ? null : q.get(TALK_PARAM) || null;
}
/** The page with this person's talk over it; the rest of the page's address is kept. */
export function withTalk(pathname: string, search: URLSearchParams | string, personId: string): string {
  const q = new URLSearchParams(search);
  q.set(TALK_PARAM, personId);
  return address(pathname, q);
}
/** The page with the talk closed: the address without `talk`. */
export function withoutTalk(pathname: string, search: URLSearchParams | string = ''): string {
  const q = new URLSearchParams(search);
  q.delete(TALK_PARAM);
  return address(pathname, q);
}

/**
 * A source's page in Clew for one entity (D95, D97: an `about.page`), with `{key}` and `{id}` filled in; null when the
 * page needs Clew's id and the entity has none. This is the one filler, wherever the way in is drawn: a row's menu on
 * Personal, a section on a person's page, a unit's page. An href that is a query alone (`?talk={id}`, the talk) is
 * something laid over the page the person is on (D111 rule 5): its parameters join that page's address and everything
 * else in it is kept. An href that is a path is a page of its own; on the page the person is already on, the page's own
 * address (its lens, what its panel holds) is kept under the way in's parameters, as every address over a page keeps the
 * page's (D83).
 */
export function sourcePageHref(
  page: EntityPage,
  entity: { key: string; id?: string | undefined },
  here: { pathname: string; search: string },
): string | null {
  if (page.href.includes('{id}') && !entity.id) return null;
  const filled = page.href
    .replaceAll('{key}', encodeURIComponent(entity.key))
    .replaceAll('{id}', encodeURIComponent(entity.id ?? ''));
  const target = new URL(filled, `http://clew.invalid${here.pathname}`);
  if (target.pathname !== here.pathname) return filled;
  const query = new URLSearchParams(here.search);
  target.searchParams.forEach((value, name) => query.set(name, value));
  return address(target.pathname, query) + target.hash;
}
