import { useQuery } from '@tanstack/react-query';
import { parseSiteMenu, withHref, type SiteMenu } from '@clew/site-header';
import fixture from '@clew/site-header/fixtures/site-menu.json';

/**
 * The shared header's menu in the portal (D87). An installation points `VITE_SITE_MENU_SRC` at the menu the intranet
 * serves (generated from its content system by `packages/site-header/scripts/site-menu.ts`), the same file the
 * intranet's `<site-header>` reads. Without it the portal draws the fixture, the proof of concept's sections, with
 * Start and the site's name pointing at the portal's own root wherever it is served.
 */
const src = import.meta.env.VITE_SITE_MENU_SRC?.trim() || null;
const base = import.meta.env.BASE_URL;
const local: SiteMenu = (() => {
  const menu = withHref(parseSiteMenu(fixture), 'start', base);
  return { ...menu, site: { ...menu.site, href: base } };
})();
/** Until the installation's menu has arrived: the site's name and Start, so the bar keeps its height and heading. */
const pending: SiteMenu = { ...local, items: local.items.filter(item => item.id === 'start') };

export function useSiteMenu(): SiteMenu {
  const query = useQuery({
    queryKey: ['site-menu', src],
    enabled: src !== null,
    staleTime: Infinity,
    queryFn: async ({ signal }) => {
      const response = await fetch(src!, { signal, credentials: 'same-origin' });
      if (!response.ok) throw new Error(`The site menu at ${src} answered ${response.status}.`);
      return parseSiteMenu(await response.json());
    },
  });
  if (src === null) return local;
  return query.data ?? pending;
}
