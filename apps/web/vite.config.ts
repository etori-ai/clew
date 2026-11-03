import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Published Astryx packages are pre-compiled; the plain CSS path needs no StyleX plugin (astryx docs styling-overview plain).
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0', port: 5173, strictPort: true,
    // Same origin for the browser: the BFF is reached through this proxy, so cookies and the OIDC callback share PUBLIC_URL.
    proxy: { '/api': { target: 'http://127.0.0.1:3000', changeOrigin: false } },
    allowedHosts: ['localhost', 'host.docker.internal'],
  },
});
