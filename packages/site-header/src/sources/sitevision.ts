import { absoluteHref, walkTree, type MenuSource, type SourcePage } from './source';

/**
 * Sitevision's Model REST API as a menu source (D87). The `headless` endpoint answers a node with its child `nodes`,
 * each with the properties asked for: `displayName`, `URI` (the page's path, relative), `URL` (absolute) and
 * `visibleInMenus`. The path is preferred and resolved against the site's public origin, because `URL` is the address
 * Sitevision knows itself by, which behind a proxy may not be the one people use. Shapes from developer.sitevision.se
 * (the headless endpoint and the `sv:page` node type), read 2026-11-09; not yet run against a live installation.
 */
export type SitevisionNode = Readonly<{
  id: string;
  type: string;
  name?: string;
  properties?: Readonly<Record<string, unknown>>;
}>;
export type SitevisionHeadless = Readonly<{ nodes?: readonly SitevisionNode[] }>;

export const SITEVISION_MENU_PROPERTIES = ['displayName', 'URI', 'URL', 'visibleInMenus'] as const;
/** Pages a person can open from a menu. Articles are news, folders are not pages. */
export const SITEVISION_PAGE_TYPES = ['sv:page', 'sv:structurePage'] as const;

/** The headless address of a node in the online model (1), asking only for the menu's properties. */
export function sitevisionHeadlessUrl(base: string, nodeId: string): string {
  const url = new URL(`/rest-api/1/1/${encodeURIComponent(nodeId)}/headless`, base);
  url.searchParams.set('properties', JSON.stringify(SITEVISION_MENU_PROPERTIES));
  url.searchParams.set('includes', JSON.stringify(SITEVISION_PAGE_TYPES));
  return url.toString();
}

/** A headless answer's children as pages: hidden, non-page and unaddressed nodes left out. Pure. */
export function sitevisionPages(answer: SitevisionHeadless, base: string): SourcePage[] {
  return (answer.nodes ?? []).flatMap(node => {
    if (!(SITEVISION_PAGE_TYPES as readonly string[]).includes(node.type)) return [];
    const p = node.properties ?? {};
    if (p.visibleInMenus === false) return [];
    const label = typeof p.displayName === 'string' && p.displayName.trim() ? p.displayName.trim() : node.name?.trim();
    const href = absoluteHref(p.URI, base) ?? absoluteHref(p.URL, base);
    return label && href ? [{ id: node.id, label, href }] : [];
  });
}

export const sitevisionSource: MenuSource = {
  name: 'sitevision',
  list: request =>
    walkTree(
      async id => {
        const url = sitevisionHeadlessUrl(request.base, id);
        const response = await fetch(url, {
          ...request.init,
          headers: { Accept: 'application/json', ...request.init?.headers },
        });
        if (!response.ok) throw new Error(`GET ${url} answered ${response.status}.`);
        return sitevisionPages((await response.json()) as SitevisionHeadless, request.base);
      },
      request.root,
      request.depth,
    ),
};
