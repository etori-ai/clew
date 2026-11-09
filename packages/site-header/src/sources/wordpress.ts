import { absoluteHref, walkTree, type MenuSource, type SourcePage } from './source';

/**
 * WordPress's REST API as a menu source (D87): `/wp-json/wp/v2/pages?parent=<id>`, the children of a page in menu
 * order, `0` for the top level. Each page has `link`, its absolute address, and `title.rendered`, HTML. Anonymous
 * callers get published pages; WordPress accepts a signed-in visitor's cookie only with its REST nonce (`X-WP-Nonce`,
 * `wp_create_nonce('wp_rest')`), which the page passes as `nonce`. One page of 100 children per parent; a site without
 * pretty permalinks answers at `/?rest_route=/wp/v2/pages` instead, not handled. Not run against a live site.
 */
export type WordpressPage = Readonly<{
  id: number;
  link?: string;
  title?: Readonly<{ rendered?: string }>;
}>;

export function wordpressPagesUrl(base: string, parent: string): string {
  const url = new URL('/wp-json/wp/v2/pages', base);
  url.searchParams.set('parent', parent);
  url.searchParams.set('per_page', '100');
  url.searchParams.set('orderby', 'menu_order');
  url.searchParams.set('order', 'asc');
  url.searchParams.set('_fields', 'id,link,title');
  return url.toString();
}

const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
/** `title.rendered` as text: tags dropped, entities decoded (WordPress writes `&#8211;`, `&amp;` and the like). Pure. */
export function plainTitle(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
      if (code[0] === '#') {
        const n = code[1]?.toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole;
      }
      return named[code.toLowerCase()] ?? whole;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

/** WordPress pages as menu pages: untitled or unaddressed pages left out. Pure. */
export function wordpressPages(pages: readonly WordpressPage[], base: string): SourcePage[] {
  return pages.flatMap(page => {
    const label = plainTitle(page.title?.rendered ?? '');
    const href = absoluteHref(page.link, base);
    return label && href ? [{ id: String(page.id), label, href }] : [];
  });
}

export const wordpressSource: MenuSource = {
  name: 'wordpress',
  list: request =>
    walkTree(
      async id => {
        const url = wordpressPagesUrl(request.base, id);
        const response = await fetch(url, {
          ...request.init,
          headers: {
            Accept: 'application/json',
            ...(request.nonce ? { 'X-WP-Nonce': request.nonce } : {}),
            ...request.init?.headers,
          },
        });
        if (!response.ok) throw new Error(`GET ${url} answered ${response.status}.`);
        return wordpressPages((await response.json()) as WordpressPage[], request.base);
      },
      request.root,
      request.depth,
    ),
};
