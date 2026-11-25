import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigationType } from 'react-router';

/**
 * The way back from a view's page (D116, D126 rule 7): Back, or the page's own way back, returns to the page it was
 * opened from with the focus on the link that opened it (2.4.3), as the organisation tree gives its row the focus again.
 * A link inside Clew is remembered as it is pressed: its address, the page it was pressed on, and which of that page's
 * links to the address it was, so a page with two links to one place (the header's Kalender and I dag's) gives the focus
 * to the one pressed. The view's page holds the address it was opened at, with that link when the last link pressed led
 * there, while it is shown; the page drawn in its place reads it while it is drawn, before the view's page has let go of
 * it. On the page the link was pressed on, that link takes the focus once it is drawn; on any other page, or when the
 * view was reached without a link (a search hit, a button that leads there), a link to the address in the page's own
 * content does, never one in the header or the navigation, and with none the page keeps the focus as any page reached
 * does. Only on the way back: Back or Forward, or the view's own way back (its `from`); a page reached any other way
 * leaves the focus to itself. Nothing is kept anywhere else.
 */
interface Pressed {
  href: string;
  /** The page it was pressed on. */
  at: string;
  /** In the header or the navigation, which are other ways to a page than the page's own content. */
  chrome: boolean;
  /** Which of the page's links to the address, among those in the same part of the page, it was. */
  ordinal: number;
}
let pressed: Pressed | null = null;
let shown: { address: string; link: Pressed | null } | null = null;

const plain = (address: string) => {
  try {
    return decodeURIComponent(address);
  } catch {
    return address;
  }
};
const here = () => plain(location.pathname + location.search);
/** The page a view's page names as its way back. */
const fromOf = (address: string) => {
  const at = address.indexOf('?');
  return at < 0 ? null : new URLSearchParams(address.slice(at)).get('from');
};
/** A link of the header (the site's banner) or of the navigation, not of the page's own content. */
const inChrome = (link: Element) =>
  !!link.closest('nav, [role="navigation"], [role="banner"]') ||
  (!!link.closest('header') && !link.closest('main, [role="main"]'));
/** The page's links to an address in one part of it, in document order. */
const linksTo = (address: string, chrome: boolean) =>
  [...document.querySelectorAll<HTMLAnchorElement>('a[href]')].filter(
    a => plain(a.getAttribute('href') ?? '') === address && inChrome(a) === chrome,
  );

// A link pressed (or activated with Enter, which clicks it) to a page inside Clew, in this tab: one opened elsewhere is
// not followed here.
if (typeof document !== 'undefined')
  document.addEventListener(
    'click',
    event => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
      if (!link || (link.target && link.target !== '_self')) return;
      const href = plain(link.getAttribute('href') ?? '');
      if (!href.startsWith('/') || href.startsWith('//')) return;
      const chrome = inChrome(link);
      pressed = { href, at: here(), chrome, ordinal: linksTo(href, chrome).indexOf(link) };
    },
    true,
  );

/**
 * On a view's page: the address it was opened at, and the link pressed to open it, for the page under it to find its
 * opener by on the way back. A search typed on the page changes its address in place and keeps it; another view taking
 * the page (the rail) is opened anew.
 */
export function useShownForTheWayBack(address: string) {
  const path = address.split('?')[0]!;
  const at = useRef<{ path: string; address: string; link: Pressed | null } | null>(null);
  if (!at.current || at.current.path !== path)
    at.current = { path, address, link: pressed?.href === plain(address) ? pressed : null };
  const opened = at.current;
  useEffect(() => {
    const record = { address: opened.address, link: opened.link };
    shown = record;
    return () => {
      if (shown === record) shown = null;
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
    const back = fromOf(left.address);
    const page = plain(pathname + search);
    if (kind !== 'POP' && (back === null || plain(back) !== page)) return null;
    // The link pressed here, else the first link to the address in this page's own content.
    const link = left.link?.at === page ? left.link : null;
    return { address: plain(left.address), chrome: link?.chrome ?? false, ordinal: link?.ordinal ?? 0 };
  });
  useEffect(() => {
    if (!target) return;
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
      const link = linksTo(target.address, target.chrome)[target.ordinal];
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
