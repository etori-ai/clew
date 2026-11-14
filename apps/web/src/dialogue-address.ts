import { REVIEW_PARAM } from './review-address';
import { TALK_PARAM } from './talk-address';

/**
 * One unit's follow-up dialogue (D118) lay over the unit's page as a drawer until D126 (rule 3): the page's own address
 * with the unit's key as `dialog`. The dialogue is the unit's page's tab now (`person-address.ts`, `sourceTab`); `dialog`
 * remains as an address from before, which leads to that tab (`overlayRedirect`), and as the name the dialogue module's
 * way in still declares (`?dialog={key}`).
 *
 * One focused overlay at a time: an address that also names a review or a talk draws that one and ignores the dialogue.
 */
export const DIALOGUE_PARAM = 'dialog';

const address = (pathname: string, query: URLSearchParams) => {
  const q = query.toString();
  return q ? `${pathname}?${q}` : pathname;
};
/** The unit whose dialogue the address names, or null when it names none or another overlay lies over the page. */
export function dialogueOf(search: URLSearchParams | string): string | null {
  const q = new URLSearchParams(search);
  return q.has(REVIEW_PARAM) || q.has(TALK_PARAM) ? null : q.get(DIALOGUE_PARAM) || null;
}
/** The page with this unit's dialogue over it; the rest of the page's address is kept. */
export function withDialogue(pathname: string, search: URLSearchParams | string, unitId: string): string {
  const q = new URLSearchParams(search);
  q.set(DIALOGUE_PARAM, unitId);
  return address(pathname, q);
}
/** The page with the dialogue closed: the address without `dialog`. */
export function withoutDialogue(pathname: string, search: URLSearchParams | string = ''): string {
  const q = new URLSearchParams(search);
  q.delete(DIALOGUE_PARAM);
  return address(pathname, q);
}
