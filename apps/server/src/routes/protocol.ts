import { readFile } from 'node:fs/promises';
import { Hono } from 'hono';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { MAX_MANIFEST_BYTES, openApiDocument, protocolSchema } from '@clew/connectors/protocol';
import { previewManifest } from '@clew/connectors/preview';
import { manifestReference } from '@clew/connectors/reference';
import { manifest as hello } from '../../../../connectors/hello/connector.mjs';
import { manifest as phonebook } from '../../../../connectors/phonebook/connector.mjs';
import { parseManifest } from '@clew/connectors/remote';
import { boundedText } from './bounded-body';

/**
 * The connector protocol as this instance speaks it (D60): the JSON Schema bundle, an OpenAPI document, a page that
 * draws it, and a dry run of a manifest. Public and without a session: a contract holds no data, and an integrator
 * reads it before anything is registered. Mounted before the readiness guard, so it answers while the database is
 * still coming up. Everything here is generated from the same objects the loader validates with; nothing is a copy.
 */
export const protocolRoutes = new Hono();
const shared = { 'Access-Control-Allow-Origin': '*', 'X-Content-Type-Options': 'nosniff' };
const cached = { ...shared, 'Cache-Control': 'public, max-age=300' };
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
<script>
  Scalar.createApiReference('#reference', {
    url: '/api/protocol/openapi.json',
    withDefaultFonts: false,
    hideTestRequestButton: true,
    hideClientButton: true,
    showDeveloperTools: 'never',
    agent: { disabled: true },
  });
</script>
</body>
</html>
`;

/** The manifest field by field, with examples from the repository's two example connectors: public data, never a registered connector's. */
const reference = manifestReference([parseManifest(phonebook, 'phonebook'), parseManifest(hello, 'hello')]);
protocolRoutes.get('/', c => c.html(page, 200, cached));
protocolRoutes.get('/manifest-reference.json', c => c.json(reference, 200, cached));
// The page itself is the web app's, drawn with Astryx at /protocol/manifest; the same origin serves both (D60).
protocolRoutes.get('/manifest-reference', c => c.redirect('/protocol/manifest', 302));
protocolRoutes.get('/scalar.js', async c =>
  c.body(await readFile(viewer), 200, { ...cached, 'Content-Type': 'text/javascript; charset=utf-8' }),
);
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
  // The loader's own limit, read no further than it: the route is public, and a body is measured before it is held.
  const text = await boundedText(c.req.raw, MAX_MANIFEST_BYTES);
  if (text === undefined) return c.json({ error: 'The manifest is larger than 500 kB.' }, 413, shared);
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch {
    return c.json({ error: 'The body is not JSON.' }, 400, shared);
  }
  // A compiler of this request's own (CB-6): Ajv keeps every schema it compiles, keyed by the object, and each request
  // brings new objects, so one compiler for the module grew with every request and never let go. The loader's compiler
  // is made per call the same way (`packages/connectors/src/validation.ts`).
  const ajv = addFormats(new Ajv({ strict: false }));
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
