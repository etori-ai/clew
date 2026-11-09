// The intranet connector (D88): the one connector of the development stack that gives Clew its shared header. It stands
// in for the content system an installation lists its sections from (Sitevision, SharePoint, WordPress): the header
// capability answers the site's name, the places in the band with their own pages, and the logo, as data, from the
// menu file beside it. Clew draws the header; the connector never sends markup. No dependencies beyond Node. Keep the
// companion verification.mjs and menu.json when copying.
import { readFileSync } from 'node:fs';
import { createVerifier } from './verification.mjs';

const CONNECTOR = 'intranet';
const Empty = { type: 'object', properties: {}, additionalProperties: false };
const link = {
  type: 'object',
  properties: { id: { type: 'string' }, label: { type: 'string' }, href: { type: 'string' } },
  required: ['id', 'label', 'href'],
};
const place = { ...link, properties: { ...link.properties, children: { type: 'array', items: link } } };

export const manifest = {
  protocol: 2,
  id: CONNECTOR,
  kind: 'passthrough',
  source: 'Intranätet',
  areas: [],
  capabilities: [
    {
      name: 'intranet.header',
      kind: 'read',
      title: 'Sidhuvudets platser',
      description: 'Intranätets sektioner och startsidans egna sidor, som Clew ritar i sidhuvudet på varje sida.',
      input: Empty,
      output: {
        type: 'object',
        properties: {
          site: {
            type: 'object',
            properties: { name: { type: 'string' }, href: { type: 'string' } },
            required: ['name', 'href'],
          },
          items: { type: 'array', items: place },
          logo: {
            type: 'object',
            properties: { src: { type: 'string' }, alt: { type: 'string' } },
            required: ['src', 'alt'],
          },
        },
        required: ['site', 'items'],
      },
      model: false,
      scope: {},
    },
  ],
  header: { capability: 'intranet.header' },
  scan: false,
};

/**
 * The menu the connector answers comes from a file, not from code (D88): `menu.json` beside this module, or the file
 * INTRANET_MENU_FILE names. Its shape is the protocol's SiteHeaderOutput (site, items with children, optional logo),
 * with one addition the connector resolves before answering: a place or a page with `roles` is listed to those roles
 * only, as a content system lists a visitor what they may read (D87 item 6). The shipped file is the stand-in's tree
 * (`packages/site-header/fixtures/sitevision-tree.json`), so the header reads the same on Clew's pages and on the
 * intranet's. Read once at start; restart the service after editing the file.
 */
export function loadMenu(path = process.env.INTRANET_MENU_FILE || new URL('./menu.json', import.meta.url)) {
  const menu = JSON.parse(readFileSync(path, 'utf8'));
  if (!menu || typeof menu !== 'object' || !menu.site || !Array.isArray(menu.items))
    throw new Error(`The intranet menu at ${path} must have "site" and "items".`);
  return menu;
}
/** The header for the acting person: the file's places and pages their role may see, `roles` left out of the answer. */
export function headerFor(actor, menu = loadMenu()) {
  if (!actor || typeof actor.id !== 'string') throw new Error('headerFor needs the acting person');
  const allowed = item => !Array.isArray(item.roles) || item.roles.includes(actor.role);
  const strip = ({ roles: _roles, ...item }) => item;
  return {
    site: menu.site,
    ...(menu.logo ? { logo: menu.logo } : {}),
    items: menu.items
      .filter(allowed)
      .map(item => ({
        ...strip(item),
        ...(Array.isArray(item.children) ? { children: item.children.filter(allowed).map(strip) } : {}),
      }))
      .map(item => (item.children && item.children.length === 0 ? (({ children: _c, ...rest }) => rest)(item) : item)),
  };
}

/** Build the service. `jwks` and `clewUrl` are how it verifies Clew's assertions; both are injectable for tests. */
export function createConnector({
  jwks,
  secret,
  clewUrl = process.env.CLEW_URL ?? '',
  fetch: fetchImpl = globalThis.fetch,
  // The menu file, read once at start (`INTRANET_MENU_FILE` or menu.json beside this module); a test may hand one in.
  menu = loadMenu(),
} = {}) {
  const verify = createVerifier({ secret, jwks, clewUrl, fetch: fetchImpl }, CONNECTOR);
  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fail = (code, message, status) => json({ error: { code, message } }, status);

  async function handle(request) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/clew/manifest') return json(manifest);
    if (request.method !== 'POST' || !url.pathname.startsWith('/clew/')) return fail('not-found', 'Okänd adress.', 404);
    // The actor is the verified assertion's, never the body's: Clew signed who is asking.
    const token = (request.headers.get('authorization') ?? '').replace(/^Bearer /, '');
    const actor = await verify(token, request.headers.get('x-clew-connector-key'));
    if (!actor) return fail('denied', 'Ogiltigt behörighetsbevis.', 401);
    try {
      await request.json();
    } catch {
      return fail('invalid', 'Ogiltig förfrågan.', 400);
    }
    if (url.pathname === '/clew/capabilities/intranet.header') return json({ output: headerFor(actor, menu) });
    return fail('not-found', 'Okänd förmåga.', 404);
  }
  return { manifest, handle };
}
