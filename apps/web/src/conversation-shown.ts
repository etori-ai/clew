import type { ViewRef } from '@clew/contracts';
import { ASSISTANT_PARAM } from './conversation-about';

/** A view that has stood beside a conversation, as its address named it. */
export type ShownView = Pick<ViewRef, 'capability' | 'title' | 'input'>;
/**
 * What the person has put beside one conversation, in the order they did: the work items and the views. An answer may
 * name its things only through the rows of a list it draws ("Vilka är försenade?" with Att göra under it), which no
 * message keeps by name; once such a thing has stood beside the transcript it is one the menu on the pane leads back to.
 */
export interface Shown {
  items: string[];
  views: ShownView[];
}
export const NOTHING_SHOWN: Shown = { items: [], views: [] };
/** How many of each kind are kept: a menu is a short list (Astryx: ten to twelve rows), and the oldest go first. */
const KEPT = 8;

const inputOf = (text: string | null): Record<string, unknown> => {
  if (!text) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};
export const viewKey = (v: Pick<ShownView, 'capability' | 'input'>) =>
  v.capability + '|' + JSON.stringify(v.input ?? {});

/** The thing the address puts beside the transcript, where it is a work item or a view; an assistant is not kept here. */
export function shownAt(search: URLSearchParams | string): { item: string } | { view: ShownView } | null {
  const q = new URLSearchParams(search);
  if (q.get(ASSISTANT_PARAM)) return null;
  const card = q.get('card');
  if (card) return { item: card };
  const open = q.get('open');
  if (open)
    return { view: { capability: open, title: q.get('open-title') ?? open, input: inputOf(q.get('open-input')) } };
  return null;
}

/** What has been shown with the address's thing added last, each thing once and the oldest dropped past `KEPT`. */
export function withShown(shown: Shown, search: URLSearchParams | string): Shown {
  const at = shownAt(search);
  if (!at) return shown;
  if ('item' in at) return { ...shown, items: [...shown.items.filter(id => id !== at.item), at.item].slice(-KEPT) };
  const key = viewKey(at.view);
  return { ...shown, views: [...shown.views.filter(v => viewKey(v) !== key), at.view].slice(-KEPT) };
}

const storageKey = (conversationId: string) => `clew:conversation-shown:${conversationId}`;
/**
 * Kept in the tab's own storage: a convenience of this browser, so a reload keeps the menu, and nothing the server or
 * another person sees. A browser that refuses storage keeps nothing, and the menu lists what the messages name.
 */
export function readShown(conversationId: string | null | undefined): Shown {
  if (!conversationId) return NOTHING_SHOWN;
  try {
    const kept: unknown = JSON.parse(sessionStorage.getItem(storageKey(conversationId)) ?? 'null');
    if (!kept || typeof kept !== 'object') return NOTHING_SHOWN;
    const { items, views } = kept as Partial<Shown>;
    return {
      items: Array.isArray(items) ? items.filter((id): id is string => typeof id === 'string') : [],
      views: Array.isArray(views)
        ? views.filter((v): v is ShownView => !!v && typeof v.capability === 'string' && typeof v.title === 'string')
        : [],
    };
  } catch {
    return NOTHING_SHOWN;
  }
}
export function rememberShown(conversationId: string | null | undefined, search: string): void {
  if (!conversationId || !shownAt(search)) return;
  try {
    sessionStorage.setItem(storageKey(conversationId), JSON.stringify(withShown(readShown(conversationId), search)));
  } catch {
    // Without storage the menu still lists what the messages name.
  }
}
