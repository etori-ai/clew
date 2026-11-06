import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { Hono } from 'hono';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { openApiDocument, protocolSchema } from '@clew/connectors/protocol';
import { previewManifest } from '@clew/connectors/preview';
import { manifestReference } from '@clew/connectors/reference';
import { manifest as hello } from '../../../../connectors/hello/connector.mjs';
import { manifest as telefonbok } from '../../../../connectors/telefonbok/connector.mjs';
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
/**
 * RapiDoc (MIT) from node_modules, never a CDN: the viewer ships with the image and phones nowhere. Read-only on purpose:
 * its request forms have unlabelled inputs (axe `label`, 2026-11-06), so the page documents and a client of the
 * integrator's choice calls; the primary colour is one that keeps 4.5:1 on white.
 */
const viewer = createRequire(import.meta.url).resolve('rapidoc');
const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Clew connector protocol</title>
<script type="module" src="/api/protocol/viewer.js"></script>
<style>
  /* RapiDoc's host sets min-width 360px; reflow at 320 px (WCAG 1.4.10) needs it off. */
  rapi-doc { min-width: 0; }
  /* RapiDoc's own parts: a path label that wraps at 320 px and reads at 4.5:1; its default is a grey that does not. */
  rapi-doc::part(label-operation-path) { color: #1f2937; display: inline-block; max-width: 100%; white-space: normal; overflow-wrap: anywhere; }
</style>
</head>
<body style="margin:0">
<rapi-doc spec-url="/api/protocol/openapi.json" heading-text="Clew connector protocol" render-style="read" theme="light" primary-color="#0b5cad" load-fonts="false" regular-font="system-ui, sans-serif" mono-font="ui-monospace, monospace"
  show-header="false" show-info="true" allow-spec-url-load="false" allow-spec-file-load="false" allow-spec-file-download="true" allow-search="true" allow-advanced-search="false"
  allow-server-selection="false" allow-try="false" allow-authentication="false" schema-style="table" schema-expand-level="3" schema-description-expanded="true" use-path-in-nav-bar="true" show-method-in-nav-bar="as-colored-text"></rapi-doc>
<script>
  // RapiDoc draws each request body as an example textarea without a label (axe "label"); name each by its operation.
  const label = () => { for (const request of document.querySelector('rapi-doc').shadowRoot.querySelectorAll('api-request')) {
    for (const area of request.shadowRoot?.querySelectorAll('textarea:not([aria-label])') ?? []) area.setAttribute('aria-label', 'Request body example for ' + (request.getAttribute('method') || '').toUpperCase() + ' ' + request.getAttribute('path'));
  } };
  const doc = document.querySelector('rapi-doc');
  doc.addEventListener('spec-loaded', () => { label(); new MutationObserver(label).observe(doc.shadowRoot, { childList: true, subtree: true }); });
</script>
</body>
</html>
`;

/** The manifest field by field, with examples from the repository's two example connectors: public data, never a registered connector's. */
const reference = manifestReference([parseManifest(telefonbok, 'telefonbok'), parseManifest(hello, 'hello')]);
protocolRoutes.get('/', c => c.html(page, 200, cached));
protocolRoutes.get('/manifest-reference.json', c => c.json(reference, 200, cached));
// The page itself is the web app's, drawn with Astryx at /protocol/manifest; the same origin serves both (D60).
protocolRoutes.get('/manifest-reference', c => c.redirect('/protocol/manifest', 302));
protocolRoutes.get('/viewer.js', async c => c.body(await readFile(viewer), 200, { ...cached, 'Content-Type': 'text/javascript; charset=utf-8' }));
protocolRoutes.get('/openapi.json', c => c.json(openApiDocument({ clewUrl: clewUrl(c.req.url) }), 200, cached));
protocolRoutes.get('/connector-protocol.schema.json', c => c.json(protocolSchema(), 200, cached));
protocolRoutes.options('/manifest', c => c.body(null, 204, { ...shared, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }));
protocolRoutes.post('/manifest', async c => {
  const text = await c.req.raw.text();
  if (text.length > 500_000) return c.json({ error: 'The manifest is larger than 500 kB.' }, 413, shared);
  let document: unknown;
  try { document = JSON.parse(text); } catch { return c.json({ error: 'The body is not JSON.' }, 400, shared); }
  const acceptsEmptyInput = (schema: object) => { try { return !!ajv.compile(schema)({}); } catch { return false; } };
  return c.json(previewManifest(document, { id: c.req.query('id'), acceptsEmptyInput }), 200, { ...shared, 'Cache-Control': 'no-store' });
});
