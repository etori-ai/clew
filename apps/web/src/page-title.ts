import { useEffect, useRef } from 'react';
import { useAnnounce } from '@clew/ui';

/**
 * Names the view in the browser tab (2.4.2) and speaks a client-side change of view (4.1.3), which a screen reader
 * otherwise never hears because the document does not reload. `spoken` is false where focus moves and says it anyway.
 * The first title is not spoken: the browser reads a loaded page by itself. Null waits for the data that holds the name.
 */
export function usePageTitle(title: string | null, spoken: string | false = title ?? false) {
  const announce = useAnnounce();
  const previous = useRef<string | null>(null);
  useEffect(() => {
    if (title === null) return;
    document.title = `${title} · Startsidan`;
    if (previous.current !== null && previous.current !== title && spoken) announce(spoken);
    previous.current = title;
  }, [title, spoken, announce]);
}
