import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { resolveBranding } from '@clew/ui/branding';

// Shared by the application and its isolated browser-test build.
export function webConfig() {
  return {
    plugins: [react()],
    server: {
      host: '0.0.0.0',
      port: 5173,
      strictPort: true,
      // Same origin for the browser: the BFF is reached through this proxy, so cookies and the OIDC callback share PUBLIC_URL.
      proxy: { '/api': { target: 'http://127.0.0.1:3000', changeOrigin: false } },
      allowedHosts: ['localhost', 'host.docker.internal'],
    },
  };
}

// Published Astryx packages are pre-compiled; the plain CSS path needs no StyleX plugin (astryx docs styling-overview plain).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, import.meta.dirname, ['VITE_BRAND_', 'VITE_HEADER_LOGO_']);
  resolveBranding({
    profile: env.VITE_BRAND_PROFILE,
    accent: env.VITE_BRAND_ACCENT,
    accentMuted: env.VITE_BRAND_ACCENT_MUTED,
    logoDarkSrc: env.VITE_HEADER_LOGO_DARK_SRC,
    logoSrc: env.VITE_HEADER_LOGO_SRC,
    logoAlt: env.VITE_HEADER_LOGO_ALT,
  });
  return webConfig();
});
