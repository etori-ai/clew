import type { AuthenticatedContext, SiteHeaderView } from '@clew/contracts';
import { audiencedActorOf, type HeaderAnswer, type Registry } from '@clew/connectors';
import { CLEWS_START, withClewsStart } from '../header-start';

/**
 * The shared header for a signed-in person (D88): the answer of the connector an administrator chose to give it
 * (`Registry.header`), or Clew's default, the site's name and Start, when no connector gives the person one. Platform
 * code beside the registry, like the menu and the tools. The connector gives the shared places. Clew adds its own
 * Start link first (D116, `header-start.ts`).
 *
 * The header never blocks a page. The browser draws the default band at once and fills the places in when this
 * answers; here the connector gets a short budget (`HEADER_TIMEOUT_MS`), and what it answered per person is kept and
 * served again, so a slow or down intranet costs one page load a moment, not every page load. A minute after the
 * connector was last asked (`HEADER_FRESH_MS`) the next read asks it again in the background and serves the kept answer
 * meanwhile. A connector that refuses the person (the protocol's `denied`, with its 403) has answered that it lists
 * nothing for them: the default takes the place of what was kept and is kept like any answer, so a content system takes
 * a person's places away as fast as it narrows them. A connector that fails, its 401 for Clew's key or assertion
 * included, does not answer in time or answers out of shape leaves the last good answer in place for at most
 * `HEADER_STALE_MS` after it was given, or the default when it has given none, and is asked again at the next refresh,
 * a minute later: a content system that is down is asked once a minute per person.
 * An answer is kept whatever was kept while it was asked, and a failure never takes anything's place, so of two reads at
 * once the one that failed cannot undo the one that was answered.
 *
 * Who may have the header is never kept. Every read asks the registry which connector gives this person the header now
 * (`Registry.headerHolder`, without asking the connector), and a kept answer from another connector or from none is
 * dropped before anything is served: the holder switched off or another chosen, its audience narrowed, the connector or
 * its header capability switched off. A refusal by the registry while the holder is asked drops it too and is never
 * kept, so a person let in gets the header at the next read; a failure is kept only for the holder that failed. The
 * cache is keyed by the person, their authorization version and their provisioned groups (`headerScope`), so a changed
 * grant or a changed membership is a new read: the holder's audience may name a group (D68), and a change in a group
 * that gives no unit, role or capability moves neither the grant nor its version (D88 as amended 2026-11-12). It lives
 * in this process only.
 */
export const DEFAULT_HEADER: SiteHeaderView = {
  menu: { version: 1, site: { name: 'Startsidan', href: '/' }, items: [CLEWS_START] },
  logo: null,
  source: null,
};
export const HEADER_TIMEOUT_MS = 3000;
export const HEADER_FRESH_MS = 60_000;
/**
 * How long a last good header is served while its connector fails (D88, amended 2026-11-13): an hour after the connector
 * gave it. A stale menu is harmless, and in a large organisation an hour carries everyone's menu through a restart or
 * an ordinary outage of the content system, which is then asked once a minute per person rather than on every page
 * load. After the hour the band says what is true, the default. Who may have the header is not bound by this: it is
 * decided on every read.
 */
export const HEADER_STALE_MS = 60 * 60_000;

export interface SiteHeaderDeps {
  registry: Pick<Registry, 'header' | 'headerHolder'>;
  clock(): Date;
}
/** Whom a kept header was read for: the person, their authority and their groups, in whatever order they came. */
export const headerScope = (persona: AuthenticatedContext) =>
  JSON.stringify([persona.id, persona.authorizationVersion, [...(persona.groups ?? [])].sort()]);

/**
 * A header kept for one key: the connector's last answer and the connector that gave it, which is the default when it
 * refused the person or failed before it gave one; when it was kept, which the bound counts from, and when the
 * connector was last asked.
 */
interface Kept {
  view: SiteHeaderView;
  holder: string;
  at: number;
  asked: number;
  refreshing: boolean;
}
/** The holder's answer as the band draws it, with Clew's Start first. */
const viewOf = (found: Extract<HeaderAnswer, { status: 'answered' }>): SiteHeaderView => ({
  menu: { version: 1, site: found.output.site, items: withClewsStart(found.output.items) },
  logo: found.output.logo ?? null,
  source: { id: found.connector.id, label: found.connector.source },
});

export function siteHeaders({ registry, clock }: SiteHeaderDeps) {
  const cache = new Map<string, Kept>();
  const ask = (persona: AuthenticatedContext) =>
    registry.header(audiencedActorOf(persona), {
      signal: AbortSignal.timeout(HEADER_TIMEOUT_MS),
      authorize: () => persona.authorize(),
      delegate: persona.delegate,
    });
  const keep = (key: string, view: SiteHeaderView, holder: string) => {
    const now = clock().getTime();
    cache.set(key, { view, holder, at: now, asked: now, refreshing: false });
    return view;
  };
  /**
   * What one call to the holder leaves kept for a key, and what the read that made it serves: `over` is the entry a
   * background refresh was started for, none for a read that found nothing kept. The holder's answer, or the default for
   * its refusal of the person, is kept whatever was kept meanwhile: the registry judged after the call that the person
   * may have this holder's header, and every read judges it again before it serves anything. A refusal by the registry
   * drops the entry the call refreshed and keeps nothing. A failure takes nothing's place: the entry it refreshed stays,
   * asked again a minute later, and when nothing is kept at all the default is kept for the holder until then.
   */
  function settle(key: string, answer: HeaderAnswer, over?: Kept): SiteHeaderView {
    if (answer.status === 'answered') return keep(key, viewOf(answer), answer.connector.id);
    if (answer.status === 'denied') return keep(key, DEFAULT_HEADER, answer.connector.id);
    const kept = cache.get(key);
    if (over && kept === over) {
      if (answer.status === 'refused') cache.delete(key);
      else {
        over.asked = clock().getTime();
        over.refreshing = false;
      }
    } else if (!kept && answer.status === 'failed') keep(key, DEFAULT_HEADER, answer.connector.id);
    return DEFAULT_HEADER;
  }
  let swept = 0;
  /** At most once a minute, every kept header past the bound leaves the process: none of them can be served again. */
  function sweep(now: number) {
    if (now - swept < HEADER_FRESH_MS) return;
    swept = now;
    for (const [key, kept] of cache) if (now - kept.at >= HEADER_STALE_MS) cache.delete(key);
  }
  async function read(persona: AuthenticatedContext): Promise<SiteHeaderView> {
    const key = headerScope(persona);
    const holder = await registry.headerHolder(audiencedActorOf(persona));
    await persona.authorize();
    const now = clock().getTime();
    sweep(now);
    let kept = cache.get(key);
    // Who may have the header is decided here, on every read: a kept answer from another connector than the one that
    // gives this person the header now, or from none, is never served, nor one older than the bound.
    if (kept && (kept.holder !== holder?.id || now - kept.at >= HEADER_STALE_MS)) {
      cache.delete(key);
      kept = undefined;
    }
    if (!holder) return DEFAULT_HEADER;
    if (kept) {
      if (!kept.refreshing && now - kept.asked >= HEADER_FRESH_MS) {
        const over = kept;
        over.refreshing = true;
        void ask(persona).then(
          answer => settle(key, answer, over),
          () => {
            if (cache.get(key) === over) cache.delete(key);
          },
        );
      }
      return kept.view;
    }
    return settle(key, await ask(persona));
  }
  /** How many headers the process keeps: for tests. */
  const kept = () => cache.size;
  return { read, kept };
}
