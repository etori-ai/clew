/**
 * The shared header's menu (D87): the site's name, then the places in the top bar in order. Every host draws the same
 * menu, so the header looks the same whether the person is in Clew's portal or in the intranet. The data is plain JSON
 * so that the intranet can serve it, a script can generate it from Sitevision (`sitevision.ts`), and the fixture can
 * stand in for both during development. Pure: no I/O, no DOM.
 */
export type SiteMenuItem = Readonly<{
  /** Stable key a host uses to mark the item as the current one or to point it somewhere else (`withHref`). */
  id: string;
  label: string;
  /** A root-relative path (`/intranat/organisation`) or an absolute http(s) address. */
  href: string;
  /** Pages under this one, as the intranet lists them. The header draws the top level only; the rest is the listing. */
  children?: readonly SiteMenuItem[];
}>;

export type SiteMenu = Readonly<{
  version: 1;
  /** The name beside the logo and where it leads ("Startsidan"). */
  site: Readonly<{ name: string; href: string }>;
  items: readonly SiteMenuItem[];
}>;

const fail = (path: string, problem: string): never => {
  throw new Error(`Invalid site menu at ${path}: ${problem}.`);
};

const text = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || value.trim() === '') return fail(path, 'expected a non-empty string');
  return value.trim();
};

/** A root-relative path or an absolute http(s) address; never `javascript:`, a protocol-relative `//host` or a bare word. */
export function safeHref(value: unknown, path: string): string {
  const href = text(value, path);
  if (/[\u0000-\u001f\u007f\\]/.test(href)) return fail(path, 'contains a control character or a backslash');
  if (href.startsWith('/') && !href.startsWith('//')) return href;
  try {
    const url = new URL(href);
    if (url.protocol === 'https:' || url.protocol === 'http:') return url.toString();
  } catch {
    // fall through
  }
  return fail(path, 'expected a path starting with one slash or an http(s) address');
}

function parseItem(value: unknown, path: string, depth: number): SiteMenuItem {
  if (depth > 8) return fail(path, 'nested deeper than eight levels');
  if (typeof value !== 'object' || value === null) return fail(path, 'expected an object');
  const item = value as Record<string, unknown>;
  const children = item.children;
  if (children !== undefined && !Array.isArray(children)) return fail(`${path}.children`, 'expected an array');
  return {
    id: text(item.id, `${path}.id`),
    label: text(item.label, `${path}.label`),
    href: safeHref(item.href, `${path}.href`),
    ...(children?.length
      ? { children: children.map((child, index) => parseItem(child, `${path}.children[${index}]`, depth + 1)) }
      : {}),
  };
}

/** Reads a menu from untrusted JSON (a fetched file, an inline script) and refuses anything it cannot draw safely. */
export function parseSiteMenu(value: unknown): SiteMenu {
  if (typeof value !== 'object' || value === null) return fail('$', 'expected an object');
  const menu = value as Record<string, unknown>;
  if (menu.version !== 1) return fail('$.version', 'expected 1');
  if (typeof menu.site !== 'object' || menu.site === null) return fail('$.site', 'expected an object');
  const site = menu.site as Record<string, unknown>;
  if (!Array.isArray(menu.items) || menu.items.length === 0) return fail('$.items', 'expected a non-empty array');
  const items = menu.items.map((item, index) => parseItem(item, `$.items[${index}]`, 0));
  const ids = new Set<string>();
  for (const item of items) {
    if (ids.has(item.id)) fail('$.items', `the id "${item.id}" appears twice`);
    ids.add(item.id);
  }
  return {
    version: 1,
    site: { name: text(site.name, '$.site.name'), href: safeHref(site.href, '$.site.href') },
    items,
  };
}

/** The same menu with one top-level item pointing elsewhere: the portal's Start is its own root wherever it is served. */
export function withHref(menu: SiteMenu, id: string, href: string): SiteMenu {
  const safe = safeHref(href, `withHref(${id})`);
  return { ...menu, items: menu.items.map(item => (item.id === id ? { ...item, href: safe } : item)) };
}

/**
 * The top-level item the page at `location` belongs to: the longest href that is the page's path or a parent of it,
 * on the same origin. `/intranat/ekonomi-styrning/budget` belongs to `/intranat/ekonomi-styrning`; `/intranat/` to
 * nothing unless an item points there.
 */
export function selectedItem(menu: SiteMenu, location: string | URL): string | null {
  const here = new URL(location);
  // `/organisation` and `/organisation/` are one page: WordPress writes the slash, Sitevision does not.
  const trim = (path: string) => (path.length > 1 ? path.replace(/\/+$/, '') : path);
  const page = trim(here.pathname);
  let best: { id: string; length: number } | null = null;
  for (const item of menu.items) {
    const target = new URL(item.href, here);
    if (target.origin !== here.origin) continue;
    const path = trim(target.pathname);
    const matches = page === path || page.startsWith(path === '/' ? '/' : `${path}/`);
    if (matches && (best === null || path.length > best.length)) best = { id: item.id, length: path.length };
  }
  return best?.id ?? null;
}

/** Every page in the menu, depth first, with the labels above it: the listing of what the intranet exposes. */
export function flattenSiteMenu(
  menu: SiteMenu,
): Array<{ id: string; label: string; href: string; trail: readonly string[] }> {
  const out: Array<{ id: string; label: string; href: string; trail: readonly string[] }> = [];
  const walk = (items: readonly SiteMenuItem[], trail: readonly string[]) => {
    for (const item of items) {
      out.push({ id: item.id, label: item.label, href: item.href, trail });
      if (item.children) walk(item.children, [...trail, item.label]);
    }
  };
  walk(menu.items, []);
  return out;
}
