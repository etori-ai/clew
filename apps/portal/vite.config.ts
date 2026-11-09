import { resolve } from 'node:path';
import { defineConfig, loadEnv } from 'vite';
import { resolveBranding } from '@clew/ui/branding';
import { siteHeaderDemo } from '../../packages/site-header/demo/plugin';
import { webConfig } from '../web/vite.config';

/**
 * The portal (D67) is the web app's build on its own port, over the same BFF through the same proxy, with the web
 * app's public assets (the municipal logos) served as they are. Nothing here is a second configuration to keep. In
 * development it also serves the intranet's stand-in at `/intranat/…` with the shared header's embed (D87).
 */
export function portalConfig() {
  const web = webConfig();
  return {
    ...web,
    plugins: [...web.plugins, siteHeaderDemo({ startHref: '/' })],
    publicDir: resolve(import.meta.dirname, '../web/public'),
    server: { ...web.server, port: 5174 },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, import.meta.dirname, ['VITE_BRAND_', 'VITE_HEADER_LOGO_']);
  resolveBranding({
    profile: env.VITE_BRAND_PROFILE ?? 'sundsvall',
    accent: env.VITE_BRAND_ACCENT,
    accentMuted: env.VITE_BRAND_ACCENT_MUTED,
    logoDarkSrc: env.VITE_HEADER_LOGO_DARK_SRC,
    logoSrc: env.VITE_HEADER_LOGO_SRC,
    logoAlt: env.VITE_HEADER_LOGO_ALT,
  });
  return portalConfig();
});
