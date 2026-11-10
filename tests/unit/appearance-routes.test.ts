import { describe, expect, test } from 'bun:test';
import { parseThemeFile, themeFileOf, themeFromAccent, type AuthenticatedContext } from '@clew/contracts';
import { memoryAppearanceStore } from '../../apps/server/src/modules/appearance/adapters/memory';
import { appearanceUsecases } from '../../apps/server/src/modules/appearance/usecases';
import { appearanceRoutes } from '../../apps/server/src/routes/appearance';

/**
 * The public appearance routes (D98) over the memory store: what a browser that has not signed in is answered, and
 * the headers a stored logo is served under.
 */
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8"/></svg>';
const admin = {
  id: 'mikael',
  name: 'Mikael Lund',
  capabilities: ['admin.appearance'],
  authorize: async () => ({ version: 'v' }),
} as unknown as AuthenticatedContext;
function stack() {
  const usecases = appearanceUsecases({
    store: memoryAppearanceStore(),
    clock: () => new Date('2026-11-10T08:00:00.000Z'),
  });
  const routes = appearanceRoutes(usecases);
  return { usecases, get: (path: string) => routes.request('http://clew.local' + path) };
}

describe('public appearance routes', () => {
  test('anyone, from any origin, reads the appearance, and is asked to check again on every visit', async () => {
    const { usecases, get } = stack();
    const empty = await get('/');
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual({ revision: 0, theme: null, logo: null });
    expect(empty.headers.get('access-control-allow-origin')).toBe('*');
    expect(empty.headers.get('cache-control')).toBe('no-cache');
    const theme = themeFromAccent('#005595', '#daeff1', 'Exempelkommunen');
    await usecases.setTheme(admin, themeFileOf(theme));
    expect(await (await get('/')).json()).toEqual({ revision: 1, theme, logo: null });
  });

  test('the theme file is a download: a template that is itself a valid theme, then the saved theme', async () => {
    const { usecases, get } = stack();
    const template = await get('/theme-file');
    expect(template.headers.get('content-type')).toBe('application/design-tokens+json; charset=utf-8');
    expect(template.headers.get('content-disposition')).toBe('attachment; filename="clew-theme.tokens.json"');
    expect(parseThemeFile(await template.json()).ok).toBe(true);
    const theme = themeFromAccent('#5b1f78', '#d7dbf2', 'Exempelkommunen');
    await usecases.setTheme(admin, themeFileOf(theme));
    expect(parseThemeFile(await (await get('/theme-file')).json())).toEqual({ ok: true, theme });
  });

  test('a logo is served byte for byte, sandboxed, and cached only under the address of its own revision', async () => {
    const { usecases, get } = stack();
    expect((await get('/logo/light')).status).toBe(404);
    expect((await get('/logo/other')).status).toBe(404);
    await usecases.setLogo(admin, {
      alt: 'Exempelkommunen',
      light: { mediaType: 'image/svg+xml', data: Buffer.from(SVG).toString('base64') },
    });
    const current = await get('/logo/light?v=1');
    expect(current.status).toBe(200);
    expect(await current.text()).toBe(SVG);
    expect(current.headers.get('content-type')).toBe('image/svg+xml');
    expect(current.headers.get('x-content-type-options')).toBe('nosniff');
    expect(current.headers.get('content-security-policy')).toBe(
      "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    );
    expect(current.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    // An address from before the last save, or with no revision, is never kept: it would show the old image.
    expect((await get('/logo/light?v=0')).headers.get('cache-control')).toBe('no-cache');
    expect((await get('/logo/light')).headers.get('cache-control')).toBe('no-cache');
    expect((await get('/logo/dark?v=1')).status).toBe(404);
  });
});
