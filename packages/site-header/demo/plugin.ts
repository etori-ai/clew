import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';

/**
 * A stand-in for the intranet in the portal's dev server (D87): `/intranat/…` answers with a page Clew does not render,
 * carrying the `<site-header>` embed from source, and `/site-menu.json` answers with the fixture menu. Production has
 * the two sites behind one domain (`/portal` and `/intranat`); here both are the portal's origin, so the header can be
 * compared by clicking between them. `/rest-api/1/1/<id>/headless` answers as Sitevision's Model REST API would, from
 * the demo tree: the public pages to anyone, and the rest to a signed-in visitor. Signed in means signed in to Clew,
 * read from the BFF with the visitor's cookie, as an intranet with single sign-on would know the same person; without
 * a Clew server (the WCAG suite) `/intranat/logga-in` sets a demo cookie for an invented person instead. `/wp-json/wp/v2/pages` answers the same pages as WordPress
 * would, and `/intranat/?source=wordpress` makes the element read them through the WordPress source. Development only (`apply: 'serve'`); nothing of it is in a build. No imports from
 * the package's TypeScript: this file is loaded by the Vite configuration, outside the app's bundler.
 */
export function siteHeaderDemo(options: { startHref?: string; bff?: string } = {}): Plugin {
  const embed = resolve(import.meta.dirname, '../src/embed.tsx');
  const page = resolve(import.meta.dirname, 'index.html');
  const fixture = resolve(import.meta.dirname, '../fixtures/site-menu.json');
  const tree = resolve(import.meta.dirname, '../fixtures/sitevision-tree.json');
  const dist = resolve(import.meta.dirname, '../dist');
  const demoCookie = (cookie: string | undefined) => /(?:^|;\s*)site-header-demo=signed-in(?:;|$)/.test(cookie ?? '');
  /**
   * Who the stand-in's visitor is, the way an intranet with single sign-on would know: the person signed in to Clew
   * (the BFF's own session, asked with the visitor's cookie), as Sitevision or WordPress would know them from the same
   * identity provider. Without a Clew session, the demo cookie's invented person, which is what the WCAG suite uses
   * (it runs no Clew server). Nobody: an anonymous visitor.
   */
  const visitorOf = async (cookie: string | undefined): Promise<{ name: string } | null> => {
    if (cookie) {
      try {
        const response = await fetch(`${options.bff ?? 'http://127.0.0.1:3000'}/api/auth/session`, {
          headers: { cookie },
          signal: AbortSignal.timeout(2000),
        });
        if (response.ok) {
          const name = (await response.json())?.user?.name;
          if (typeof name === 'string' && name.trim()) return { name: name.trim() };
        }
      } catch {
        // No BFF (the WCAG suite) or it is down: fall through to the demo cookie.
      }
    }
    return demoCookie(cookie) ? { name: 'Kim Andersson' } : null;
  };
  return {
    name: 'clew-site-header-demo',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const path = (req.url ?? '/').split('?')[0]!;
        try {
          if (path === '/site-menu.json') {
            const menu = JSON.parse(await readFile(fixture, 'utf8'));
            // A static menu is served to every visitor, so it is the public one: the sections the demo tree marks public.
            const demo = JSON.parse(await readFile(tree, 'utf8'));
            const open = new Set(
              (demo.nodes[demo.root] as Array<{ uri: string; public: boolean }>).filter(n => n.public).map(n => n.uri),
            );
            menu.items = menu.items.filter(
              (item: { id: string; href: string }) => item.id === 'start' || open.has(item.href),
            );
            if (options.startHref) {
              menu.site.href = options.startHref;
              for (const item of menu.items) if (item.id === 'start') item.href = options.startHref;
            }
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify(menu));
            return;
          }
          // The production bundle (`bun run build:site-header`), as an intranet would load it: `/intranat/?built`.
          const built = /^\/shared\/site-header\/([\w.-]+\.js)$/.exec(path);
          if (built) {
            res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
            res.end(await readFile(resolve(dist, built[1]!), 'utf8'));
            return;
          }
          const headless = /^\/rest-api\/1\/1\/([^/]+)\/headless$/.exec(path);
          if (headless) {
            const demo = JSON.parse(await readFile(tree, 'utf8'));
            const id = decodeURIComponent(headless[1]!);
            const listing: Array<{ id: string; label: string; uri: string; public: boolean }> | undefined =
              demo.nodes[id];
            if (!listing && id !== demo.root) {
              res.statusCode = 404;
              res.end();
              return;
            }
            const signedIn = (await visitorOf(req.headers.cookie)) !== null;
            const visible = (listing ?? []).filter(node => node.public || signedIn);
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(
              JSON.stringify({
                properties: {},
                nodes: visible.map(node => ({
                  id: node.id,
                  type: 'sv:page',
                  name: node.label,
                  properties: { displayName: node.label, URI: node.uri, visibleInMenus: true },
                })),
              }),
            );
            return;
          }
          if (path === '/wp-json/wp/v2/pages') {
            // The same demo pages as WordPress's REST API would list them: absolute `link`, HTML `title.rendered`.
            const demo = JSON.parse(await readFile(tree, 'utf8'));
            const parent = new URLSearchParams((req.url ?? '').split('?')[1]).get('parent') ?? '0';
            const listing: Array<{ id: string; label: string; uri: string; public: boolean }> =
              demo.nodes[parent === '0' ? demo.root : parent] ?? [];
            const origin = `http://${req.headers.host ?? 'localhost'}`;
            const signedIn = (await visitorOf(req.headers.cookie)) !== null;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(
              JSON.stringify(
                listing
                  .filter(node => node.public || signedIn)
                  .map(node => ({
                    id: node.id,
                    link: `${origin}${node.uri}/`,
                    title: { rendered: node.label.replace(/&/g, '&amp;') },
                  })),
              ),
            );
            return;
          }
          if (path === '/intranat/logga-in') {
            res.statusCode = 303;
            res.setHeader('Set-Cookie', 'site-header-demo=signed-in; Path=/; SameSite=Lax');
            res.setHeader('Location', '/intranat/');
            res.end();
            return;
          }
          if (path === '/intranat/logga-ut') {
            // A link from another site must not sign the person out: only this site's own pages may.
            const site = req.headers['sec-fetch-site'];
            if (site && site !== 'same-origin' && site !== 'none') {
              res.statusCode = 403;
              res.end();
              return;
            }
            const cookies = ['site-header-demo=gone; Path=/; Max-Age=0; SameSite=Lax'];
            let location = '/intranat/';
            // Signed in through Clew: end that session as an intranet's sign-out ends the shared one, through the BFF's
            // own sign-out with the session's CSRF token, from this origin (a listed front end, D67 item 6).
            const cookie = req.headers.cookie;
            const bff = options.bff ?? 'http://127.0.0.1:3000';
            if (cookie) {
              const session = await fetch(`${bff}/api/auth/session`, { headers: { cookie } }).catch(() => null);
              const csrf = session?.ok ? (await session.json())?.csrfToken : undefined;
              if (typeof csrf === 'string') {
                const ended = await fetch(`${bff}/api/auth/logout`, {
                  method: 'POST',
                  headers: { cookie, origin: `http://${req.headers.host}`, 'x-csrf-token': csrf },
                });
                if (ended.ok) {
                  cookies.push(...ended.headers.getSetCookie());
                  const url = (await ended.json())?.url;
                  if (typeof url === 'string') location = url;
                }
              }
            }
            res.statusCode = 303;
            res.setHeader('Set-Cookie', cookies);
            res.setHeader('Location', location);
            res.end();
            return;
          }
          if (path === '/intranat' || path.startsWith('/intranat/')) {
            const person = await visitorOf(req.headers.cookie);
            const quoted = (text: string) => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
            const visitor = person
              ? `user-name="${quoted(person.name)}" logout-href="/intranat/logga-ut"`
              : 'login-href="/login"';
            const html = (await readFile(page, 'utf8'))
              .replace(
                '%EMBED%',
                new URLSearchParams((req.url ?? '').split('?')[1]).has('built')
                  ? '/shared/site-header/site-header.js'
                  : `/@fs${embed}`,
              )
              .replace('%VISITOR%', visitor)
              .replace(
                'source="sitevision" source-root="%ROOT%"',
                new URLSearchParams((req.url ?? '').split('?')[1]).get('source') === 'wordpress'
                  ? 'source="wordpress" source-root="0"'
                  : `source="sitevision" source-root="${JSON.parse(await readFile(tree, 'utf8')).root}"`,
              );
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.end(await server.transformIndexHtml(req.url ?? path, html));
            return;
          }
        } catch (error) {
          next(error);
          return;
        }
        next();
      });
    },
  };
}
