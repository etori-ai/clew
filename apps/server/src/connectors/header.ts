import type { AuthenticatedContext, SiteHeaderView } from '@clew/contracts';
import { actorOf } from '@clew/connectors';
import { registry } from './registry';
import { clock } from '../composition/ambient';
import { clewsStart, withClewsStart } from './header-start';

/**
 * The shared header for a signed-in person (D88): the answer of the connector an administrator chose to give it
 * (`Registry.header`), or Clew's default, the site's name and Start, when no connector gives the person one. Platform
 * code beside the registry, like the menu and the tools: no module owns the header, a connector does, except Start and
 * the row under it, which are Clew's own pages for the person (D116, `header-start.ts`).
 *
 * The header never blocks a page. The browser draws the default band at once and fills the places in when this
 * answers; here the connector gets a short budget (`HEADER_TIMEOUT_MS`), a failure or a refusal is the default, and the
 * last good answer per person is kept for a while (`HEADER_FRESH_MS`) and served again while a fresh one is fetched in
 * the background, so a slow or down intranet costs one page load a moment, not every page load. The cache is keyed by
 * the person and their authorization version, so a changed grant is a new read; it lives in this process only.
 */
export const DEFAULT_HEADER: SiteHeaderView = {
  menu: { version: 1, site: { name: 'Startsidan', href: '/' }, items: [{ id: 'start', label: 'Start', href: '/' }] },
  logo: null,
  source: null,
};
export const HEADER_TIMEOUT_MS = 3000;
export const HEADER_FRESH_MS = 60_000;
const cache = new Map<string, { view: SiteHeaderView; at: number; refreshing: boolean }>();

async function fetchSiteHeader(persona: AuthenticatedContext): Promise<SiteHeaderView> {
  const found = await registry.header(actorOf(persona), {
    signal: AbortSignal.timeout(HEADER_TIMEOUT_MS),
    ...(persona.delegate ? { delegate: persona.delegate } : {}),
  });
  if (!found) return DEFAULT_HEADER;
  return {
    menu: {
      version: 1,
      site: found.output.site,
      items: withClewsStart(found.output.items, clewsStart(persona.role)),
    },
    logo: found.output.logo ?? null,
    source: { id: found.connector.id, label: found.connector.source },
  };
}
export async function readSiteHeader(persona: AuthenticatedContext): Promise<SiteHeaderView> {
  await persona.authorize();
  const key = `${persona.id}:${persona.authorizationVersion}`;
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
export const forgetSiteHeaders = () => cache.clear();
