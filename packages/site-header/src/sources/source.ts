import type { SiteMenu, SiteMenuItem } from '../menu';
import { safeHref } from '../menu';

/**
 * Where the shared header's places come from (D87): a content system's own API, read by an adapter that knows that
 * API and nothing else, turned into the header's neutral menu. The header never sees a source's shapes; a new system
 * (Sitevision, WordPress, another) is one more adapter in `sources/` and one more name in `index.ts`.
 *
 * The request carries the caller's audience and nothing else: an adapter adds no credential of its own. Called from the
 * visitor's browser with their session it lists what that visitor may open; called anonymously it lists the public
 * pages; called by the menu script `--as-user` it lists that user's pages.
 */
export type MenuSourceRequest = Readonly<{
  /** The content system's public origin; addresses are resolved against it, so every href is absolute. */
  base: string;
  /** The page whose children are the bar's places, in the source's own id (a Sitevision node id, a WordPress page id). */
  root: string;
  /** Levels under the root: 1 is the bar's places, more is the listing of their subpages. */
  depth: number;
  init?: RequestInit;
  /** A source's own request token where its API needs one beside the session (WordPress's REST nonce). */
  nonce?: string;
}>;

export type MenuSource = Readonly<{
  name: string;
  list: (request: MenuSourceRequest) => Promise<SiteMenuItem[]>;
}>;

/** One page as an adapter reports it: its id in the source, its name and an absolute address. */
export type SourcePage = Readonly<{ id: string; label: string; href: string }>;

/**
 * A source address as an absolute http(s) URL on its own origin or another: a relative path is resolved against the
 * source's base, so a menu read from one site is still right when another site (the portal) draws it.
 */
export function absoluteHref(value: unknown, base: string): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.trim(), base);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return safeHref(url.toString(), 'source');
  } catch {
    return null;
  }
}

/**
 * The tree under `root`, `depth` levels down, from a function that lists one page's children. A level's pages are
 * fetched together; a page met again under itself is not followed.
 */
export async function walkTree(
  children: (id: string) => Promise<readonly SourcePage[]>,
  root: string,
  depth: number,
): Promise<SiteMenuItem[]> {
  const level = async (id: string, left: number, seen: ReadonlySet<string>): Promise<SiteMenuItem[]> => {
    const pages = (await children(id)).filter(page => !seen.has(page.id));
    return Promise.all(
      pages.map(async page => {
        if (left <= 1) return { ...page };
        const below = await level(page.id, left - 1, new Set([...seen, page.id]));
        return below.length ? { ...page, children: below } : { ...page };
      }),
    );
  };
  return level(root, Math.max(1, depth), new Set([root]));
}

/**
 * The menu with a source's listing as its places: the site's name and the `start` item (the place that is not the
 * content system's, Clew's portal) stay from `menu`, everything else is the listing.
 */
export function withListing(menu: SiteMenu, listing: readonly SiteMenuItem[]): SiteMenu {
  const start = menu.items.filter(item => item.id === 'start');
  return { ...menu, items: [...start, ...listing.filter(item => item.id !== 'start')] };
}
