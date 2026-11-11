import type { EntityCard, ViewRef } from '@clew/contracts';

/**
 * What the panel holds is named in the address (D50), the same way on every page (`usePagePanel`, the shell's drawer):
 * `open` is a view (with `open-title`, `open-input` and `via`, the names a tool's page already uses, D42), `open-card`
 * and `open-action` are a card's own read, and `card` is a card. A view lies over a card: closing the view leaves the
 * card, closing the card leaves the page. Everything else in the address is the page's own and is kept.
 *
 * Under them all may lie one person's cards as a list (`cards=<key>`, with `cards-kind` the kind "Just nu" counted,
 * D107 answer 6): Personal draws it, a card opened from it lies over it, and closing peels the card first, then the list.
 */
export type PanelRef =
  | { kind: 'view'; capability: string; title: string; input: Record<string, unknown>; via: boolean }
  | { kind: 'action'; threadId: string; actionId: string }
  | { kind: 'card'; threadId: string };

const VIEW_KEYS = ['open', 'open-title', 'open-input', 'via', 'open-card', 'open-action'];
const CARDS_KEYS = ['cards', 'cards-kind'];
/** Every name the panel's part of an address uses: what a page drops when it opens its own thing in the panel's place. */
export const PANEL_KEYS: readonly string[] = [...VIEW_KEYS, 'card', ...CARDS_KEYS];
/** The kinds of card "Just nu" counts on Personal: those waiting for the reader's decision, and Clew's proposals. */
export type CountedKind = Exclude<EntityCard['kind'], 'fyi'>;
/** One person's cards as a list in the panel: whose, and of which kind; without a kind, all of them. */
export interface CardsRef {
  key: string;
  kind: CountedKind | undefined;
}
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
const without = (search: URLSearchParams | string, keys: string[]) => {
  const q = new URLSearchParams(search);
  keys.forEach(k => q.delete(k));
  return q;
};

/** What the address says the panel holds; a view first, then a card's read, then the card. */
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
  const threadId = search.get('open-card'),
    actionId = search.get('open-action');
  if (threadId && actionId) return { kind: 'action', threadId, actionId };
  const card = search.get('card');
  return card ? { kind: 'card', threadId: card } : null;
}
/** The same page with a view in the panel. `via` marks a view opened from another one, which then offers the way back. */
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
/** The same page with a card's own read in the panel. */
export function withAction(
  pathname: string,
  search: URLSearchParams | string,
  threadId: string,
  actionId: string,
): string {
  const q = without(search, VIEW_KEYS);
  q.set('open-card', threadId);
  q.set('open-action', actionId);
  return address(pathname, q);
}
/** The same page with a card in the panel, and nothing over it. */
export function withCard(pathname: string, search: URLSearchParams | string, threadId: string): string {
  const q = without(search, VIEW_KEYS);
  q.set('card', threadId);
  return address(pathname, q);
}
/**
 * A card opened from something that belongs to no page (the bell, a toast, the rail's search), over the page the person
 * is on (D107 rule 2): that page's address with the card in its panel. A card's review is the one page that is not
 * yet its own address (D73: Hem with the card beside it and the review over both), so from there it is Hem's card.
 */
export function cardOverPage(pathname: string, search: URLSearchParams | string, threadId: string): string {
  return /^\/cards\/[^/]+\/review$/.test(pathname) ? withCard('/', '', threadId) : withCard(pathname, search, threadId);
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
/** The page's own address with nothing in its panel: what a way back to the page holds (`from`). */
export function pageOnly(pathname: string, search: URLSearchParams | string): string {
  return address(pathname, without(search, [...PANEL_KEYS]));
}
/** The person's cards the address lists in the panel, under whatever is opened over them. */
export function cardsOf(search: URLSearchParams): CardsRef | null {
  const key = search.get('cards');
  if (!key) return null;
  const kind = search.get('cards-kind');
  return { key, kind: kind === 'act' || kind === 'proposal' ? kind : undefined };
}
/**
 * The same page with one person's cards listed in the panel and nothing over them. What the panel held is let go of:
 * the list is opened from the page, and takes the place of what was open (one thing at a time on Personal).
 */
export function withCards(
  pathname: string,
  search: URLSearchParams | string,
  key: string,
  kind?: CountedKind | undefined,
): string {
  const q = without(search, [...PANEL_KEYS]);
  q.set('cards', key);
  if (kind) q.set('cards-kind', kind);
  return address(pathname, q);
}
/** The same page with the panel's top layer closed: the view if there is one, else the card, else a person's cards. */
export function withoutPanel(pathname: string, search: URLSearchParams | string): string {
  const q = new URLSearchParams(search);
  if (VIEW_KEYS.some(k => q.has(k))) VIEW_KEYS.forEach(k => q.delete(k));
  else if (q.has('card')) q.delete('card');
  else CARDS_KEYS.forEach(k => q.delete(k));
  return address(pathname, q);
}
/**
 * Only the panel's part of an address, as a query string: what a conversation takes with it from the page it was asked
 * on. A person's cards are left behind: the list is Personal's own, and the conversation's page does not draw it.
 */
export function panelSearch(search: URLSearchParams | string): string {
  const from = new URLSearchParams(search),
    q = new URLSearchParams();
  [...VIEW_KEYS, 'card'].forEach(k => {
    const v = from.get(k);
    if (v !== null) q.set(k, v);
  });
  const s = q.toString();
  return s ? `?${s}` : '';
}
