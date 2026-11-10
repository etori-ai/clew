import { Hono } from 'hono';
import type { AppearanceUsecases } from '../modules/appearance/usecases';

/**
 * The installation's appearance (D97), public: the sign-in page is drawn with it, and so is the shared header on
 * another site, which is why any origin may read it. It carries colours, a name and the logo's address, nothing about
 * a person, and the browser asks again on every visit (`no-cache`) so a change by an administrator is seen at once.
 */
const open = { 'Access-Control-Allow-Origin': '*', 'X-Content-Type-Options': 'nosniff' };
export function appearanceRoutes(appearance: Pick<AppearanceUsecases, 'read' | 'logo' | 'themeFile'>) {
  const routes = new Hono();
  routes.get('/', async c => c.json(await appearance.read(), 200, { ...open, 'Cache-Control': 'no-cache' }));
  /** The saved theme as a `.tokens.json` file to keep or change, or a template when none is saved. */
  routes.get('/theme-file', async c =>
    c.body(JSON.stringify(await appearance.themeFile(), null, 2) + '\n', 200, {
      ...open,
      'Content-Type': 'application/design-tokens+json; charset=utf-8',
      'Content-Disposition': 'attachment; filename="clew-theme.tokens.json"',
      'Cache-Control': 'no-cache',
    }),
  );
  /**
   * One image of the logo. Its address carries the revision, so that address may be kept for a year; any other is asked
   * for again. An SVG opened on its own is a document, so it is served sandboxed with nothing allowed to load or run:
   * the header draws it through `img`, where it could not anyway, and the upload refused anything active (`domain.ts`).
   */
  routes.get('/logo/:variant', async c => {
    const variant = c.req.param('variant');
    const image = variant === 'light' || variant === 'dark' ? await appearance.logo(variant) : null;
    if (!image) return c.json({ error: 'Logotypen finns inte.' }, 404, open);
    return c.body(new Uint8Array(image.bytes).buffer, 200, {
      ...open,
      'Content-Type': image.mediaType,
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      'Cache-Control': c.req.query('v') === String(image.revision) ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
  });
  return routes;
}
