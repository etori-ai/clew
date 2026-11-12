import type { AuthenticatedContext, SiteHeaderView } from '@clew/contracts';
import { audiencedActorOf, type Registry } from '@clew/connectors';

/**
 * The shared header for a signed-in person (D88): the answer of the connector an administrator chose to give it
 * (`Registry.header`), or Clew's default, the site's name and Start, when no connector gives the person one. Platform
 * code beside the registry, like the menu and the tools: no module owns the header, a connector does.
 *
 * The header never blocks a page. The browser draws the default band at once and fills the places in when this
 * answers; here the connector gets a short budget (`HEADER_TIMEOUT_MS`), a failure or a refusal is the default, and the
 * last good answer per person is kept for a while (`HEADER_FRESH_MS`) and served again while a fresh one is fetched in
 * the background, so a slow or down intranet costs one page load a moment, not every page load. The cache is keyed by
 * the person, their authorization version and their provisioned groups (`headerScope`), so a changed grant or a changed
 * membership is a new read: the holder's audience may name a group (D68), and a membership the provisioner removes moves
 * neither the grant nor its version. It lives in this process only.
 */
export const DEFAULT_HEADER: SiteHeaderView = {
  menu: { version: 1, site: { name: 'Startsidan', href: '/' }, items: [{ id: 'start', label: 'Start', href: '/' }] },
  logo: null,
  source: null,
};
export const HEADER_TIMEOUT_MS = 3000;
export const HEADER_FRESH_MS = 60_000;

export interface SiteHeaderDeps {
  registry: Pick<Registry, 'header'>;
  clock(): Date;
}
/** Whom a kept header was read for: the person, their authority and their groups, in whatever order they came. */
export const headerScope = (persona: AuthenticatedContext) =>
  JSON.stringify([persona.id, persona.authorizationVersion, [...(persona.groups ?? [])].sort()]);

export function siteHeaders({ registry, clock }: SiteHeaderDeps) {
  const cache = new Map<string, { view: SiteHeaderView; at: number; refreshing: boolean }>();
  async function fetchSiteHeader(persona: AuthenticatedContext): Promise<SiteHeaderView> {
    const found = await registry.header(audiencedActorOf(persona), {
      signal: AbortSignal.timeout(HEADER_TIMEOUT_MS),
      ...(persona.delegate ? { delegate: persona.delegate } : {}),
    });
    if (!found) return DEFAULT_HEADER;
    return {
      menu: { version: 1, site: found.output.site, items: found.output.items },
      logo: found.output.logo ?? null,
      source: { id: found.connector.id, label: found.connector.source },
    };
  }
  async function read(persona: AuthenticatedContext): Promise<SiteHeaderView> {
    await persona.authorize();
    const key = headerScope(persona);
    const now = clock().getTime();
    const kept = cache.get(key);
    if (kept && now - kept.at < HEADER_FRESH_MS) return kept.view;
    if (kept && !kept.refreshing) {
      // Stale: answer with the last good header now and fetch a fresh one once in the background.
      kept.refreshing = true;
      void fetchSiteHeader(persona)
        .then(view => cache.set(key, { view, at: clock().getTime(), refreshing: false }))
        .catch(() => {
          kept.refreshing = false;
        });
      return kept.view;
    }
    const view = await fetchSiteHeader(persona);
    // Only a connector's answer is worth keeping: the default costs nothing to compute, and a connector that recovers is asked next time.
    if (view.source) cache.set(key, { view, at: now, refreshing: false });
    return view;
  }
  /** For tests and for an administrator's change of holder: the next read asks the connector again. */
  const forget = () => cache.clear();
  return { read, forget };
}
