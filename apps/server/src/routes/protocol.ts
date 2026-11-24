import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import { MAX_MANIFEST_BYTES, openApiDocument, protocolSchema } from '@clew/connectors/protocol';
import { previewManifest } from '@clew/connectors/preview';
import { manifestReference } from '@clew/connectors/reference';
import { manifest as hello } from '../../../../connectors/hello/connector.mjs';
import { manifest as phonebook } from '../../../../connectors/phonebook/connector.mjs';
import { parseManifest } from '@clew/connectors/remote';
import { schemaCompiler } from '@clew/connectors';
import { clewLicence } from '@clew/notices';
import { servedViewerNotices, type Log } from '@clew/notices/viewer';
import { boundedText } from '../bounded-body';

/**
 * The connector protocol as this instance speaks it (D60): the JSON Schema bundle, an OpenAPI document, a page that
 * draws it, and a dry run of a manifest. Public and without a session: a contract holds no data, and an integrator
 * reads it before anything is registered. Mounted before the readiness guard, so it answers while the database is
 * still coming up. Everything here is generated from the same objects the loader validates with; nothing is a copy.
 */
const shared = { 'Access-Control-Allow-Origin': '*', 'X-Content-Type-Options': 'nosniff' };
const cached = { ...shared, 'Cache-Control': 'public, max-age=300' };
/** The installation's public URL when the operator set one; else the origin the request came in on. */
const clewUrl = (requestUrl: string) => (process.env.PUBLIC_URL ?? new URL(requestUrl).origin).replace(/\/+$/, '');
// The browser bundle is self-contained and ships next to the package's JS entry point.
const viewer = new URL('./browser/standalone.js', import.meta.resolve('@scalar/api-reference'));
export const VIEWER_SCRIPT = fileURLToPath(viewer);
const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Clew connector protocol</title>
</head>
<body>
<div id="reference"></div>
<script src="/api/protocol/scalar.js"></script>
<script src="/api/protocol/viewer.js"></script>
</body>
</html>
`;
/** Starts the viewer once its script has loaded: a file of its own, so the page's policy runs no inline script. */
const start = `Scalar.createApiReference('#reference', {
  url: '/api/protocol/openapi.json',
  withDefaultFonts: false,
  hideTestRequestButton: true,
  hideClientButton: true,
  showDeveloperTools: 'never',
  agent: { disabled: true },
});
`;
/**
 * The page's own security headers (D145). The web image's headers are never sent with an address Clew's server answers,
 * so this page, public and without a session, sends its own, as strict as the web app's: scripts and connections from
 * this origin only and nothing inline but styles, which the viewer writes as it draws; no page may frame it. The
 * viewer's validation library asks once whether it may compile code from a string; the policy says no, the browser's
 * console says so, and the library validates without.
 */
export const PROTOCOL_PAGE_HEADERS = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
};
const script = { ...cached, 'Content-Type': 'text/javascript; charset=utf-8' };
const plain = { ...cached, 'Content-Type': 'text/plain; charset=utf-8' };

/** The manifest field by field, with examples from the repository's two example connectors: public data, never a registered connector's. */
const reference = manifestReference([parseManifest(phonebook, 'phonebook'), parseManifest(hello, 'hello')]);

/**
 * The protocol's routes. What they serve from the install is read once, when first asked for, and kept, a failure as
 * well: the viewer's script (5 MB), its third-party notices (`@clew/notices/viewer`, which logs through `log` what keeps
 * them from being whole) and Clew's licence.
 */
export function protocolRoutes({ log }: { log: Log }) {
  const routes = new Hono();
  const notices = servedViewerNotices(VIEWER_SCRIPT, log);
  let bundle: Promise<Buffer<ArrayBuffer>> | undefined;
  let licence: string | undefined;
  routes.get('/', c => c.html(page, 200, { ...cached, ...PROTOCOL_PAGE_HEADERS }));
  routes.get('/manifest-reference.json', c => c.json(reference, 200, cached));
  // The page itself is the web app's, drawn with Astryx at /protocol/manifest; the same origin serves both (D60).
  routes.get('/manifest-reference', c => c.redirect('/protocol/manifest', 302));
  routes.get('/scalar.js', async c => c.body(await (bundle ??= readFile(viewer)), 200, script));
  routes.get('/viewer.js', c => c.body(start, 200, script));
  // Beside the script, as every browser build of Clew's writes them beside its files (D143 item 3).
  routes.get('/third-party-notices.txt', c => {
    const served = notices();
    return 'text' in served
      ? c.body(served.text, 200, plain)
      : c.body(served.failure, 500, {
          ...shared,
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-store',
        });
  });
  routes.get('/LICENSE.txt', c => c.body((licence ??= clewLicence()), 200, plain));
  routes.get('/openapi.json', c => c.json(openApiDocument({ clewUrl: clewUrl(c.req.url) }), 200, cached));
  routes.get('/connector-protocol.schema.json', c => c.json(protocolSchema(), 200, cached));
  routes.options('/manifest', c =>
    c.body(null, 204, {
      ...shared,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    }),
  );
  routes.post('/manifest', async c => {
    // The loader's own limit, read no further than it: the route is public, and a body is measured before it is held.
    const text = await boundedText(c.req.raw, MAX_MANIFEST_BYTES);
    if (text === undefined) return c.json({ error: 'The manifest is larger than 500 kB.' }, 413, shared);
    let document: unknown;
    try {
      document = JSON.parse(text);
    } catch {
      return c.json({ error: 'The body is not JSON.' }, 400, shared);
    }
    // A compiler of this request's own (CB-6), made as the loader makes its own: Ajv keeps every schema it compiles, so
    // one compiler for the module grew with every request and never let go. It compiles each schema once, for the rules
    // and for whether `{}` is a valid input alike, and the manifest's capabilities are capped by the protocol.
    return c.json(previewManifest(document, { id: c.req.query('id'), compile: schemaCompiler() }), 200, {
      ...shared,
      'Cache-Control': 'no-store',
    });
  });
  return routes;
}

/**
 * Mounts the protocol at `/api/protocol`, before the session guard. The page is asked for with a trailing slash too,
 * which the mounted routes do not match: that address would fall through to the guard and answer as an expired session,
 * so it is sent to the page, permanently but cached for five minutes like the page, so a browser asks again later.
 */
export function mountProtocol(app: Hono, deps: { log: Log }) {
  app.get('/api/protocol/', c => c.body(null, 308, { Location: '/api/protocol', 'Cache-Control': 'max-age=300' }));
  app.route('/api/protocol', protocolRoutes(deps));
}
