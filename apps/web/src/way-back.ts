import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigationType } from 'react-router';

/**
 * The way back from a view's page (D116): Back, or the page's own way back, returns to the page it was opened from with
 * the focus on the link that opened it (2.4.3), as the organisation tree gives its row the focus again. The view's page
 * holds the address it was opened at while it is shown; the page drawn in its place reads it while it is drawn, before
 * the view's page has let go of it, and gives the focus to the link with that address once it is on the page. Only on
 * the way back: Back or Forward, or the view's own way back (its `from`); a page reached any other way leaves the focus
 * to itself. Nothing is kept anywhere else.
 */
let shown: string | null = null;

const plain = (address: string) => {
  try {
    return decodeURIComponent(address);
  } catch {
    return address;
  }
};
/** The page a view's page names as its way back. */
const fromOf = (address: string) => {
  const at = address.indexOf('?');
  return at < 0 ? null : new URLSearchParams(address.slice(at)).get('from');
};

/**
 * On a view's page: the address it was opened at, for the page under it to find its opener by on the way back. A search
 * typed on the page changes its address in place and keeps it; another view taking the page (the rail) is opened anew.
 */
export function useShownForTheWayBack(address: string) {
  const path = address.split('?')[0]!;
  const at = useRef<{ path: string; address: string } | null>(null);
  if (!at.current || at.current.path !== path) at.current = { path, address };
  const opened = at.current.address;
  useEffect(() => {
    shown = opened;
    return () => {
      if (shown === opened) shown = null;
    };
  }, [opened]);
}

/** How long a page may take to draw the link that opened the view (its rows read again) before the focus stays put. */
const PATIENCE = 4000;
/**
 * How long the link keeps the focus against the page's own first moves of it once it has it: a panel opening with the
 * page moves the focus to its heading as it opens, which is not the person's doing.
 */
const SETTLE = 400;

/** On every page: the link that opened the view the person comes back from takes the focus once it is drawn. */
export function useFocusOnTheWayBack() {
  const { pathname, search } = useLocation();
  const kind = useNavigationType();
  const [target] = useState(() => {
    const left = shown;
    if (!left) return null;
    const back = fromOf(left);
    return kind === 'POP' || (back !== null && plain(back) === plain(pathname + search)) ? left : null;
  });
  useEffect(() => {
    if (!target) return;
    const wanted = plain(target);
    // Whatever the person does first is theirs: from then on the focus is left where they put it.
    let acted = false;
    const act = () => {
      acted = true;
    };
    document.addEventListener('pointerdown', act, true);
    document.addEventListener('keydown', act, true);
    const started = Date.now();
    let found: number | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      const now = Date.now();
      if (acted || now - started > PATIENCE || (found !== null && now - found > SETTLE)) return;
      const link = [...document.querySelectorAll<HTMLElement>('a[href]')].find(
        a => plain(a.getAttribute('href') ?? '') === wanted,
      );
      if (link) {
        found ??= now;
        if (document.activeElement !== link) link.focus();
      }
      timer = setTimeout(tick, 50);
    };
    tick();
    return () => {
      clearTimeout(timer);
      document.removeEventListener('pointerdown', act, true);
      document.removeEventListener('keydown', act, true);
    };
  }, [target]);
}
