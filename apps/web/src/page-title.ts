import { useEffect } from 'react';
import { useAnnounce } from '@clew/ui';

/** The title on screen, kept across pages: a change of page by a link is one component giving way to another, and that is still one view giving way to the next. */
let previous: string | null = null;
/** What the page names, under whatever lies over it (`useOverlayTitle`). */
let page: string | null = null;
/** What the focused overlay over the page names while it is open (D107 rule 5), or null. */
let overlay: string | null = null;
const show = (title: string) => {
  document.title = `${title} · Startsidan`;
};

/**
 * Names the view in the browser tab (2.4.2) and speaks a client-side change of view (4.1.3), which a screen reader
 * otherwise never hears because the document does not reload. `spoken` is false where focus moves and says it anyway.
 * The first title is not spoken: the browser reads a loaded page by itself. Null waits for the data that holds the name.
 * The last title is held outside the hook, so Hem giving way to the calendar is spoken like one tab giving way to another.
 * While a focused overlay lies over the page its name stays in the tab, and the page's comes back when it closes.
 */
export function usePageTitle(title: string | null, spoken: string | false = title ?? false) {
  const announce = useAnnounce();
  useEffect(() => {
    if (title === null) return;
    page = title;
    if (overlay === null) show(title);
    if (previous !== null && previous !== title && spoken) announce(spoken);
    previous = title;
  }, [title, spoken, announce]);
}

/**
 * Names a focused overlay in the tab while it is open (D107 rule 5: a card's review, one person's talk, over whichever
 * page they were opened on), and gives the tab back to the page's own name when it closes or names nothing. Never
 * spoken: the overlay says its name itself when the focus enters it, and closing it is not a change of page. Null while
 * the overlay is closed or has nothing to name yet.
 */
export function useOverlayTitle(title: string | null) {
  useEffect(() => {
    if (title === null) return;
    overlay = title;
    show(title);
    return () => {
      overlay = null;
      if (page !== null) show(page);
    };
  }, [title]);
}
