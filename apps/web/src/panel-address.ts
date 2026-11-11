import type { ViewRef } from '@clew/contracts';
import { REVIEW_KEYS, withReview } from './review-address';
import { TALK_PARAM } from './talk-address';

/**
 * What the panel holds is named in the address (D50), the same way on every page (`usePagePanel`, the shell's drawer):
 * `open` is a view (with `open-title`, `open-input` and `via`, the names a tool's page already uses, D42) and `card` is
 * a card. A view lies over a card: closing the view leaves the card, closing the card leaves the page. The panel holds
 * one opened thing (D110, amended 2026-11-11). Everything else in the address is the page's own and is kept.
 *
 * `open-card` with `open-action` is one of a card's own reads unfolded inside that card (D110, amended 2026-11-11),
 * wherever the card is drawn: beside the page, in Hem's sheet, in a conversation's answer. It is the card's state, not
 * a thing in the panel: it stays under a view opened from one of its rows, and goes when the card goes.
 */
export type PanelRef =
  | { kind: 'view'; capability: string; title: string; input: Record<string, unknown>; via: boolean }
  | { kind: 'card'; threadId: string };
/** A card's own read the address unfolds in that card. */
export interface ReadRef {
  threadId: string;
  actionId: string;
}

const VIEW_KEYS = ['open', 'open-title', 'open-input', 'via'];
const READ_KEYS = ['open-card', 'open-action'];
/** Every name the panel's part of an address uses: what a page drops when it opens its own thing in the panel's place. */
const PANEL_KEYS: readonly string[] = [...VIEW_KEYS, 'card', ...READ_KEYS];
/**
 * What lies over the page and the panel and holds the focus (D110 rule 5): a card's review (`review-address.ts`) and
 * one person's talk (`talk-address.ts`). Closing one leaves the page's address as it was under it.
 */
const FOCUSED_KEYS: readonly string[] = [...REVIEW_KEYS, TALK_PARAM];
const parse = (json: string | null): Record<string, unknown> => {
  try {
    const v: unknown = json ? JSON.parse(json) : {};
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};
const address = (pathname: string, query: URLSearchParams) => {
  const q = query.toString();
  return q ? `${pathname}?${q}` : pathname;
};
const without = (search: URLSearchParams | string, keys: readonly string[]) => {
  const q = new URLSearchParams(search);
  keys.forEach(k => q.delete(k));
  return q;
};

/** What the address says the panel holds: a view first, then the card. */
export function panelOf(search: URLSearchParams): PanelRef | null {
  const open = search.get('open');
  if (open)
    return {
      kind: 'view',
      capability: open,
      title: search.get('open-title') ?? open,
      input: parse(search.get('open-input')),
      via: search.get('via') === '1',
    };
  const card = search.get('card');
  return card ? { kind: 'card', threadId: card } : null;
}
/** The card's read the address unfolds, if it names one. */
export function readOf(search: URLSearchParams): ReadRef | null {
  const threadId = search.get('open-card'),
    actionId = search.get('open-action');
  return threadId && actionId ? { threadId, actionId } : null;
}
/**
 * The same page with a view in the panel. `via` marks a view opened from another one, or from a card's read, which
 * then offers the way back. A card's unfolded read stays: closing the view shows the card as it was.
 */
export function withView(
  pathname: string,
  search: URLSearchParams | string,
  view: Pick<ViewRef, 'capability' | 'title'> & { input?: Record<string, unknown> | undefined },
  via = false,
): string {
  const q = without(search, VIEW_KEYS);
  q.set('open', view.capability);
  q.set('open-title', view.title);
  if (view.input && Object.keys(view.input).length) q.set('open-input', JSON.stringify(view.input));
  if (via) q.set('via', '1');
  return address(pathname, q);
}
/** The same page with one of a card's reads unfolded in the card; any other read of any card folds. */
export function withRead(
  pathname: string,
  search: URLSearchParams | string,
  threadId: string,
  actionId: string,
): string {
  const q = new URLSearchParams(search);
  q.set('open-card', threadId);
  q.set('open-action', actionId);
  return address(pathname, q);
}
/** A row's own read (a row has no room to unfold one): its card in the panel, with the read unfolded in it. */
export function cardWithRead(
  pathname: string,
  search: URLSearchParams | string,
  threadId: string,
  actionId: string,
): string {
  const q = without(search, [...VIEW_KEYS, ...READ_KEYS]);
  q.set('card', threadId);
  q.set('open-card', threadId);
  q.set('open-action', actionId);
  return address(pathname, q);
}
/** The same page with the card's read folded again. */
export function withoutRead(pathname: string, search: URLSearchParams | string): string {
  return address(pathname, without(search, READ_KEYS));
}
/** The same page with a card in the panel, and nothing over it or unfolded in it. */
export function withCard(pathname: string, search: URLSearchParams | string, threadId: string): string {
  const q = without(search, [...VIEW_KEYS, ...READ_KEYS]);
  q.set('card', threadId);
  return address(pathname, q);
}
/**
 * A card opened from something that belongs to no page (the bell, a toast, the rail's search), over the page the person
 * is on (D110 rule 2): that page's address with the card in its panel. A review or a talk lying over the page is let go
 * of, so the card asked for is the thing in front.
 */
export function cardOverPage(pathname: string, search: URLSearchParams | string, threadId: string): string {
  return withCard(pathname, without(search, FOCUSED_KEYS), threadId);
}
/**
 * Where a row's "Granska N" leads (D110 rule 5): the row's card in the page's panel, as the row's title opens it, and the
 * card's review over the page. The review hands its decisions back to the card and its receipt shows there, so a review
 * opened from a row closes to that card beside the page, as one opened from the card itself does.
 */
export function reviewOverCard(pathname: string, search: URLSearchParams | string, threadId: string): string {
  const q = without(search, [...VIEW_KEYS, ...READ_KEYS]);
  q.set('card', threadId);
  return withReview(pathname, q, threadId);
}
/**
 * `target`, another address of the same page, with what the panel holds in `search` kept: a move within the page (a
 * person's section) leaves what is open beside it open.
 */
export function keepingPanel(target: string, search: URLSearchParams | string): string {
  const at = target.indexOf('?');
  const q = new URLSearchParams(at < 0 ? '' : target.slice(at));
  const from = new URLSearchParams(search);
  PANEL_KEYS.forEach(k => {
    const v = from.get(k);
    if (v !== null) q.set(k, v);
  });
  return address(at < 0 ? target : target.slice(0, at), q);
}
/** The page's own address with nothing in its panel and nothing over it: what a way back to the page holds (`from`). */
export function pageOnly(pathname: string, search: URLSearchParams | string): string {
  return address(pathname, without(search, [...PANEL_KEYS, ...FOCUSED_KEYS]));
}
/**
 * The same page with the panel's top layer closed: the view if there is one, else the card with whatever was unfolded
 * in it. A read unfolded in a card that is not in the panel (in a conversation's answer) folds with nothing else open.
 */
export function withoutPanel(pathname: string, search: URLSearchParams | string): string {
  const q = new URLSearchParams(search);
  if (VIEW_KEYS.some(k => q.has(k))) VIEW_KEYS.forEach(k => q.delete(k));
  else [...READ_KEYS, 'card'].forEach(k => q.delete(k));
  return address(pathname, q);
}
/** Only the panel's part of an address, as a query string: what a conversation takes with it from the page it was asked on. */
export function panelSearch(search: URLSearchParams | string): string {
  const from = new URLSearchParams(search),
    q = new URLSearchParams();
  PANEL_KEYS.forEach(k => {
    const v = from.get(k);
    if (v !== null) q.set(k, v);
  });
  const s = q.toString();
  return s ? `?${s}` : '';
}
