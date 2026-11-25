import { readFile } from 'node:fs/promises';
import { Hono } from 'hono';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { openApiDocument, protocolSchema } from '@clew/connectors/protocol';
import { previewManifest } from '@clew/connectors/preview';
import { manifestReference } from '@clew/connectors/reference';
import { manifest as hello } from '../../../../connectors/hello/connector.mjs';
import { manifest as phonebook } from '../../../../connectors/phonebook/connector.mjs';
import { parseManifest } from '@clew/connectors/remote';

/**
 * The connector protocol as this instance speaks it (D60): the JSON Schema bundle, an OpenAPI document, a page that
 * draws it, and a dry run of a manifest. Public and without a session: a contract holds no data, and an integrator
 * reads it before anything is registered. Mounted before the readiness guard, so it answers while the database is
 * still coming up. Everything here is generated from the same objects the loader validates with; nothing is a copy.
 */
export const protocolRoutes = new Hono();
const shared = { 'Access-Control-Allow-Origin': '*', 'X-Content-Type-Options': 'nosniff' };
const cached = { ...shared, 'Cache-Control': 'public, max-age=300' };
const ajv = addFormats(new Ajv({ strict: false }));
/** The installation's public URL when the operator set one; else the origin the request came in on. */
const clewUrl = (requestUrl: string) => (process.env.PUBLIC_URL ?? new URL(requestUrl).origin).replace(/\/+$/, '');
// The browser bundle is self-contained and ships next to the package's JS entry point.
const viewer = new URL('./browser/standalone.js', import.meta.resolve('@scalar/api-reference'));
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

/** The manifest field by field, with examples from the repository's two example connectors: public data, never a registered connector's. */
const reference = manifestReference([parseManifest(phonebook, 'phonebook'), parseManifest(hello, 'hello')]);
protocolRoutes.get('/', c => c.html(page, 200, { ...cached, ...PROTOCOL_PAGE_HEADERS }));
protocolRoutes.get('/manifest-reference.json', c => c.json(reference, 200, cached));
// The page itself is the web app's, drawn with Astryx at /protocol/manifest; the same origin serves both (D60).
protocolRoutes.get('/manifest-reference', c => c.redirect('/protocol/manifest', 302));
protocolRoutes.get('/scalar.js', async c => c.body(await readFile(viewer), 200, script));
protocolRoutes.get('/viewer.js', c => c.body(start, 200, script));
protocolRoutes.get('/openapi.json', c => c.json(openApiDocument({ clewUrl: clewUrl(c.req.url) }), 200, cached));
protocolRoutes.get('/connector-protocol.schema.json', c => c.json(protocolSchema(), 200, cached));
protocolRoutes.options('/manifest', c =>
  c.body(null, 204, {
    ...shared,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }),
);
protocolRoutes.post('/manifest', async c => {
  const text = await c.req.raw.text();
  if (text.length > 500_000) return c.json({ error: 'The manifest is larger than 500 kB.' }, 413, shared);
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch {
    return c.json({ error: 'The body is not JSON.' }, 400, shared);
  }
  const acceptsEmptyInput = (schema: object) => {
    try {
      return !!ajv.compile(schema)({});
    } catch {
      return false;
    }
  };
  return c.json(previewManifest(document, { id: c.req.query('id'), acceptsEmptyInput }), 200, {
    ...shared,
    'Cache-Control': 'no-store',
  });
});
