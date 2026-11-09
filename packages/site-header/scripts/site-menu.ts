/**
 * Lists the pages a content system exposes and writes them as the shared header's menu (D87).
 *
 *   bun packages/site-header/scripts/site-menu.ts --source sitevision --base https://intranet.example.org \
 *     --root 4.1a2b3c --start-href /portal/ --out site-menu.json
 *   bun packages/site-header/scripts/site-menu.ts --source wordpress --base https://intranet.example.org --root 0 --list
 *
 * `--source` is a name in `src/sources/index.ts` (`sitevision`, `wordpress`). `--root` is the start page's id in that
 * system (a Sitevision node id; a WordPress page id, `0` for the top level); its children become the places in the
 * bar, and `--depth` levels under it are fetched for the listing. `--list` prints every page with its address instead
 * of writing JSON. Addresses are absolute, resolved against `--base`.
 *
 * Anonymous by default: no credentials are sent, so the system answers with its public pages and the file is the menu
 * any visitor may see. `--as-user` sends SITE_MENU_USER and SITE_MENU_PASSWORD as HTTP Basic (a Sitevision user with
 * read access, a WordPress application password), never as arguments, and lists that user's pages: a file written
 * that way names pages anonymous visitors may not open and must not be served to them.
 */
import { writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { flattenSiteMenu, parseSiteMenu, safeHref, type SiteMenu } from '../src/menu';
import { menuSource, menuSources, withListing } from '../src/sources';

const { values } = parseArgs({
  options: {
    source: { type: 'string' },
    base: { type: 'string' },
    root: { type: 'string' },
    depth: { type: 'string', default: '2' },
    'site-name': { type: 'string', default: 'Startsidan' },
    'site-href': { type: 'string', default: '/portal/' },
    'start-href': { type: 'string' },
    'start-label': { type: 'string', default: 'Start' },
    out: { type: 'string' },
    list: { type: 'boolean', default: false },
    'as-user': { type: 'boolean', default: false },
  },
});

if (!values.source || !values.base || !values.root) {
  console.error(
    `Usage: site-menu.ts --source <${Object.keys(menuSources).join('|')}> --base <origin> --root <start page id> [--depth 2] [--out file | --list] [--as-user]`,
  );
  process.exit(2);
}
const depth = Number(values.depth);
if (!Number.isInteger(depth) || depth < 1 || depth > 6) {
  console.error('--depth must be a whole number from 1 to 6.');
  process.exit(2);
}

const headers: Record<string, string> = {};
if (values['as-user']) {
  const user = process.env.SITE_MENU_USER;
  const password = process.env.SITE_MENU_PASSWORD;
  if (!user || !password) {
    console.error('--as-user needs SITE_MENU_USER and SITE_MENU_PASSWORD in the environment.');
    process.exit(2);
  }
  headers.Authorization = `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
  console.error(
    `Listing as ${user}: the result may name pages that are not public. Do not serve it to anonymous visitors.`,
  );
} else {
  console.error('Listing anonymously: the public pages only.');
}

const listing = await menuSource(values.source).list({
  base: values.base,
  root: values.root,
  depth,
  init: { headers, credentials: 'omit' },
});

const frame: SiteMenu = {
  version: 1,
  site: { name: values['site-name']!, href: safeHref(values['site-href'], '--site-href') },
  items: values['start-href']
    ? [{ id: 'start', label: values['start-label']!, href: safeHref(values['start-href'], '--start-href') }]
    : [],
};
// Parsed back through the same check a host applies, so a file this script writes is one the header will draw.
const menu = parseSiteMenu(withListing(frame, listing));

if (values.list) {
  for (const page of flattenSiteMenu(menu)) console.log([...page.trail, page.label].join(' › '), '\t', page.href);
} else if (values.out) {
  await writeFile(values.out, `${JSON.stringify(menu, null, 2)}\n`);
  console.log(`Wrote ${values.out}: ${menu.items.length} top-level items, ${flattenSiteMenu(menu).length} pages.`);
} else {
  console.log(JSON.stringify(menu, null, 2));
}
