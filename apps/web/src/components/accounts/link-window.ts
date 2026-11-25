import { LINK_WINDOW, linkWindowFeatures } from '../../linked-accounts';

/**
 * The window a person signs in to a system in (D147 item 6): one at a time for the whole page, whichever button
 * opened it. The window is opened by the press itself, before anything is awaited, because a browser lets only that
 * through; what it then shows is set once the server has answered where the system's sign-in is.
 *
 * A link's id outlives its window here: a system's sign-in may cut the window off from this page, which then reads as
 * closed at once, and what the return page says still names the link this page started.
 */
export interface LinkStarted {
  id: string;
  /** Sends the window on to the system's sign-in; false when the person has closed it meanwhile. */
  go(url: string): boolean;
  /** The link could not be started: the window goes, and nothing is under way. */
  abandon(): void;
}
interface UnderWay {
  id: string;
  connectorId: string;
  window: Window;
}
/** What a link started here was pressed from: the element that takes the focus if its button is gone afterwards. */
export interface LinkOrigin {
  connectorId: string;
  focus: string | undefined;
}
let underWay: UnderWay | null = null;
let watch: number | undefined;
const started = new Map<string, LinkOrigin>();
const listeners = new Set<() => void>();
const closedListeners = new Set<(origin: LinkOrigin) => void>();
const tell = () => listeners.forEach(listener => listener());

function settle() {
  window.clearInterval(watch);
  watch = undefined;
  underWay = null;
  tell();
}
function newId() {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

export const linkWindow = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  },
  /** The system a link is under way for in its window, or null. */
  connector: () => underWay?.connectorId ?? null,
  /** The window was closed with nothing said: the person closed it, or the system's sign-in cut it off. */
  onClosed(listener: (origin: LinkOrigin) => void) {
    closedListeners.add(listener);
    return () => void closedListeners.delete(listener);
  },
  /** A link is under way: its window comes forward, and no second one opens. */
  show(): boolean {
    if (!underWay || underWay.window.closed) return false;
    underWay.window.focus();
    return true;
  },
  /** Opens the window for a link to this system. Null when the browser will not open one. */
  open(connectorId: string, focus?: string): LinkStarted | null {
    let opened: Window | null = null;
    try {
      opened = window.open('', LINK_WINDOW, linkWindowFeatures(window));
    } catch {
      opened = null;
    }
    if (!opened || opened.closed) return null;
    const id = newId();
    const mine: UnderWay = { id, connectorId, window: opened };
    window.clearInterval(watch);
    underWay = mine;
    started.set(id, { connectorId, focus });
    watch = window.setInterval(() => {
      if (underWay !== mine || !opened.closed) return;
      settle();
      const origin = started.get(id);
      if (origin) closedListeners.forEach(listener => listener(origin));
    }, 400);
    tell();
    return {
      id,
      go(url) {
        if (underWay !== mine || opened.closed) return false;
        opened.location.replace(url);
        return true;
      },
      abandon() {
        started.delete(id);
        if (underWay !== mine) return;
        opened.close();
        settle();
      },
    };
  },
  /**
   * What the return page said: the origin of the link if this page started it, once. A return that names no link is
   * taken by the page that has one under way.
   */
  take(linkId: string | null): LinkOrigin | null {
    const id = linkId ?? underWay?.id ?? null;
    const origin = id ? (started.get(id) ?? null) : null;
    if (!id || !origin) return null;
    started.delete(id);
    if (underWay?.id === id) settle();
    return origin;
  },
};
