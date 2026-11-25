import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { siteHeaderDemo } from '../../packages/site-header/demo/plugin';
import { thirdPartyNotices } from '@clew/notices';

// Shared by the application and its isolated browser-test build. The intranet stand-in (`/intranat/…`, D87) is served
// by the dev server only (`apply: 'serve'`); nothing of it is in a build.
export function webConfig() {
  // The notices of everything the build passes on, the workbook worker's bundle included (D146 item 3).
  const notices = thirdPartyNotices();
  return {
    plugins: [react(), siteHeaderDemo({ startHref: '/' }), notices.plugin],
    worker: { plugins: () => [notices.worker] },
    server: {
      host: '0.0.0.0',
      port: 5173,
      strictPort: true,
      // Same origin for the browser: the BFF is reached through this proxy, so cookies and the OIDC callback share PUBLIC_URL.
      // `/scim` too: the address the key dialog hands a provisioner (D107) is PUBLIC_URL's, which is this server's.
      proxy: {
        '/api': { target: 'http://127.0.0.1:3000', changeOrigin: false },
        '/scim': { target: 'http://127.0.0.1:3000', changeOrigin: false },
      },
      // The browser's own name for it. Keycloak's back-channel logout reaches the BFF on the compose network (app:3000),
      // never this server.
      allowedHosts: ['localhost'],
    },
  };
}

// Published Astryx packages are pre-compiled; the plain CSS path needs no StyleX plugin (astryx docs styling-overview plain).
// The build carries no branding: the theme and the logo are the installation's, read from Clew at run time (D98).
export default defineConfig(() => webConfig());
