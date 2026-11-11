import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { useLocation } from 'react-router';

/**
 * Where the person is, for what is drawn outside the router: a toast lives in Astryx's layer around every page
 * (`Providers` in `main.tsx`), where `useLocation` has nothing to read, and it stays while the person moves from page to
 * page. The router writes the browser's address before it draws the next page, so the address is read from there; the
 * shell, which every page draws inside the router, says when it has changed.
 */
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const read = () => window.location.pathname + window.location.search;
const split = (address: string) => {
  const at = address.indexOf('?');
  return at < 0 ? { pathname: address, search: '' } : { pathname: address.slice(0, at), search: address.slice(at) };
};

/** In the shell, inside the router: tells what is drawn outside it that the page's address changed. */
export function usePublishPageLocation(): void {
  const { pathname, search } = useLocation();
  useEffect(() => {
    for (const listener of listeners) listener();
  }, [pathname, search]);
}
/** The page the person is on, drawn again when they move to another or its address changes. */
export function usePageLocation(): { pathname: string; search: string } {
  const address = useSyncExternalStore(subscribe, read);
  return useMemo(() => split(address), [address]);
}
/** The page the person is on at this moment: for a control outside the router, read when it is used. */
export const pageLocation = (): { pathname: string; search: string } => split(read());
