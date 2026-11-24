import { useEffect } from 'react';
import { tabTitle, useAnnounce } from '@clew/ui';
import { useBranding } from './branding';

/** The title on screen, kept across pages: a change of page by a link is one component giving way to another, and that is still one view giving way to the next. */
let previous: string | null = null;

/**
 * Names the view in the browser tab (2.4.2) and speaks a client-side change of view (4.1.3), which a screen reader
 * otherwise never hears because the document does not reload. `spoken` is false where focus moves and says it anyway.
 * The first title is not spoken: the browser reads a loaded page by itself. Null waits for the data that holds the name.
 * The last title is held outside the hook, so Hem giving way to the calendar is spoken like one tab giving way to another.
 * The tab ends with the installation's name (D98), and a name an administrator saves re-titles the tab at once.
 */
export function usePageTitle(title: string | null, spoken: string | false = title ?? false) {
  const announce = useAnnounce();
  const site = useBranding().name;
  useEffect(() => {
    if (title === null) return;
    document.title = tabTitle(title, site);
    if (previous !== null && previous !== title && spoken) announce(spoken);
    previous = title;
  }, [title, spoken, announce, site]);
}
