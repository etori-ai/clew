import type { ViewRef } from '@clew/contracts';
import { REVIEW_KEYS } from './review-address';
import { TALK_PARAM } from './talk-address';
import { DIALOGUE_PARAM } from './dialogue-address';

/**
 * One page per thing (D126 rule 1): a work item, a record, a person each have their own page, and nothing opens over
 * another page any more (rule 3). A pane beside something exists in two places only (rule 2): beside Att göra's queue
 * (`/todo?item=`, `work-items.ts`) and beside a conversation (`/conversations/<id>`), where the address still names the
 * thing the conversation is about the way the panel named it before: `open` is a view (with `open-title` and
 * `open-input`, the names a tool's page uses, D42) and `card` is a work item. On every other page those names are an
 * address from before D126: they lead to the thing's own page (`panelRedirect`), and the functions that put a thing
 * beside a page (`withCard`, `withView`, `cardOverPage`) return that page instead, so their callers navigate there.
 *
 * `open-card` with `open-action` was one of a card's own reads unfolded inside the card (D111, amended 2026-11-11). The
 * unfold is gone (D126 rule 3): a work item's read is a link to the read's own page, and the item leads such an address
 * there itself (`work-item.tsx`), since only it knows what the read is asked with.
 */
/** A card's own read the address unfolded in that card, before D126. */
export interface ReadRef {
  threadId: string;
  actionId: string;
}

/** `via` marked a view opened from another one in the panel, before D116 ended that: dropped wherever a view is. */
const VIEW_KEYS = ['open', 'open-title', 'open-input', 'via'];
const READ_KEYS = ['open-card', 'open-action'];
/**
 * A page's own things beside it: Kalender's entry (D112 item 9), and "Fråga assistenten" from before D126 (`ask=1`), which no
 * longer opens anything and is dropped wherever a page's own address is taken. Anything opened takes their place.
 */
export const ENTRY_PARAM = 'entry';
const ASK_PARAM = 'ask';
const OWN_KEYS = [ENTRY_PARAM, ASK_PARAM];
/** Every name the panel's part of an address uses: what a page drops when it opens its own thing in the panel's place. */
const PANEL_KEYS: readonly string[] = [...VIEW_KEYS, 'card', ...READ_KEYS, ...OWN_KEYS];
/**
 * What lies over the page and the panel and holds the focus (D111 rule 5): one person's talk (`talk-address.ts`), one
 * unit's dialogue (`dialogue-address.ts`, D118), and a card's review as its address named it before the review was a
 * page (`review-address.ts`, which leads such an address to the review's page). Closing one leaves the page's address
 * as it was under it.
 */
const FOCUSED_KEYS: readonly string[] = [...REVIEW_KEYS, TALK_PARAM, DIALOGUE_PARAM];
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

/** The conversation's page, the one page besides Att göra that still holds a thing beside it (D126 rule 2). */
export const besideConversation = (pathname: string): boolean => pathname.startsWith('/conversations/');
/**
 * This page as the way back from a thing's page: its own address with nothing of the panel, nothing over it and never
 * a `from` of its own (the same rule as `wayBack` in `person-address.ts`, which this file cannot import).
 */
const backHere = (pathname: string, search: URLSearchParams | string) =>
  address(pathname, without(search, [...PANEL_KEYS, ...FOCUSED_KEYS, 'from']));
/** A work item's page with `from` as its way back (`itemPageHref` in `work-items.ts` builds the same address). */
const itemAt = (threadId: string, from: string) =>
  `/items/${encodeURIComponent(threadId)}?from=${encodeURIComponent(from)}`;
/** A view's page with `from` as its way back (`viewPageHref` in `view-address.ts` builds the same address). */
const viewAt = (
  view: Pick<ViewRef, 'capability'> & { title?: string | undefined; input?: Record<string, unknown> | undefined },
  from: string,
) => {
  const q = new URLSearchParams();
  if (view.input && Object.keys(view.input).length) q.set('input', JSON.stringify(view.input));
  if (view.title) q.set('title', view.title);
  q.set('from', from);
  return address(`/tools/${encodeURIComponent(view.capability)}`, q);
};

/** The same page with one of its own calendar entries in the panel (D112 item 9), in the place of anything open there. */
export function withEntry(pathname: string, search: URLSearchParams | string, id: string): string {
  const q = without(search, PANEL_KEYS);
  q.set(ENTRY_PARAM, id);
  return address(pathname, q);
}
/** The panel's part of the conversation page's address for a view: the view beside the transcript. */
export function viewSearch(view: Pick<ViewRef, 'capability' | 'title'> & { input?: Record<string, unknown> }): string {
  const q = new URLSearchParams();
  q.set('open', view.capability);
  q.set('open-title', view.title);
  if (view.input && Object.keys(view.input).length) q.set('open-input', JSON.stringify(view.input));
  return `?${q.toString()}`;
}
/** The card's read an address from before D126 unfolded, if it names one. */
export function readOf(search: URLSearchParams): ReadRef | null {
  const threadId = search.get('open-card'),
    actionId = search.get('open-action');
  return threadId && actionId ? { threadId, actionId } : null;
}
/**
 * Where a view opened from a page leads: beside the conversation on its own page, in the place of the view that was
 * there; from any other page, the view's own page with this one as the way back (D126 rule 1).
 */
export function withView(
  pathname: string,
  search: URLSearchParams | string,
  view: Pick<ViewRef, 'capability' | 'title'> & { input?: Record<string, unknown> | undefined },
): string {
  if (!besideConversation(pathname)) return viewAt(view, backHere(pathname, search));
  const q = without(search, [...VIEW_KEYS, ...OWN_KEYS]);
  q.set('open', view.capability);
  q.set('open-title', view.title);
  if (view.input && Object.keys(view.input).length) q.set('open-input', JSON.stringify(view.input));
  return address(pathname, q);
}
/** The same page without the view beside it, everything else kept: the way back from a view's own page (D116). */
export function withoutView(pathname: string, search: URLSearchParams | string): string {
  return address(pathname, without(search, VIEW_KEYS));
}
/** The same page with the card's read folded again. */
export function withoutRead(pathname: string, search: URLSearchParams | string): string {
  return address(pathname, without(search, READ_KEYS));
}
/**
 * Where a work item opened from a page leads (D126 rule 1): its own page, with this page as the way back. On the
 * conversation's page it is the thing beside the transcript, in the place of what was there (rule 2); on its own page
 * it is that page.
 */
export function withCard(pathname: string, search: URLSearchParams | string, threadId: string): string {
  if (pathname === `/items/${encodeURIComponent(threadId)}`) return address(pathname, without(search, FOCUSED_KEYS));
  if (!besideConversation(pathname)) return itemAt(threadId, backHere(pathname, search));
  const q = without(search, [...VIEW_KEYS, ...READ_KEYS, ...OWN_KEYS]);
  q.set('card', threadId);
  return address(pathname, q);
}
/**
 * A work item opened from something that belongs to no page (the bell, a toast, the rail's search): in Att göra's
 * reading pane when the person is in the queue (D126 rule 2), else its own page with the page the person is on as the
 * way back (rule 1). A review or a talk over the page is let go of, so the item asked for is the thing in front.
 */
export function cardOverPage(pathname: string, search: URLSearchParams | string, threadId: string): string {
  if (pathname === '/todo') {
    const q = without(search, [...FOCUSED_KEYS, ...PANEL_KEYS]);
    q.set('item', threadId);
    return address('/todo', q);
  }
  return withCard(pathname, without(search, FOCUSED_KEYS), threadId);
}
/** The page's own address with nothing in its panel and nothing over it: what a way back to the page holds (`from`). */
export function pageOnly(pathname: string, search: URLSearchParams | string): string {
  return address(pathname, without(search, [...PANEL_KEYS, ...FOCUSED_KEYS]));
}
/**
 * The same page with the panel's top layer closed: the view if there is one, else the card with whatever was unfolded
 * in it, else the page's own thing (a calendar entry, the page asked about).
 */
export function withoutPanel(pathname: string, search: URLSearchParams | string): string {
  const q = new URLSearchParams(search);
  if (VIEW_KEYS.some(k => q.has(k))) VIEW_KEYS.forEach(k => q.delete(k));
  else if (q.has('card') || READ_KEYS.some(k => q.has(k))) [...READ_KEYS, 'card'].forEach(k => q.delete(k));
  else OWN_KEYS.forEach(k => q.delete(k));
  return address(pathname, q);
}
/** Only the panel's part of an address, as a query string: what a conversation takes with it from the page it was asked on. */
export function panelSearch(search: URLSearchParams | string): string {
  const from = new URLSearchParams(search),
    q = new URLSearchParams();
  // A page's own thing (a calendar entry, the page asked about) is that page's; the conversation's page has none of it.
  PANEL_KEYS.filter(k => !OWN_KEYS.includes(k)).forEach(k => {
    const v = from.get(k);
    if (v !== null) q.set(k, v);
  });
  const s = q.toString();
  return s ? `?${s}` : '';
}
/**
 * Where an address that opened a thing over a page leads since D126 (rule 3: old addresses keep working by leading to
 * the page): a view (`open`) to the view's own page, a work item (`card`) to its page, with the page it lay over as
 * the way back; on Att göra a work item is the one in the reading pane, and on the item's own page the card is that
 * page. Null where the address carries nothing of the kind, and on the conversation's page, which keeps its thing beside
 * the transcript (rule 2). A calendar entry is Kalender's own (D27) and is left to it.
 */
export function panelRedirect(pathname: string, search: URLSearchParams | string): string | null {
  if (besideConversation(pathname)) return null;
  const q = new URLSearchParams(search);
  const open = q.get('open'),
    card = q.get('card');
  if (open)
    return viewAt(
      { capability: open, title: q.get('open-title') ?? undefined, input: parse(q.get('open-input')) },
      backHere(pathname, q),
    );
  if (!card) return null;
  if (pathname === '/todo') {
    const next = without(q, ['card', ...VIEW_KEYS]);
    next.set('item', card);
    return address('/todo', next);
  }
  if (pathname === `/items/${encodeURIComponent(card)}`) return address(pathname, without(q, ['card', ...VIEW_KEYS]));
  // The card's unfolded read goes along, so the item's page leads on to the read's page (`work-item.tsx`).
  const read = readOf(q);
  const page = itemAt(card, backHere(pathname, q));
  return read?.threadId === card
    ? `${page}&open-card=${encodeURIComponent(read.threadId)}&open-action=${encodeURIComponent(read.actionId)}`
    : page;
}
