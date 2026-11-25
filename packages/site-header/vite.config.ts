import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { thirdPartyNotices } from '@clew/notices';

/**
 * The embed (D87) as one ES module with React and Astryx inside, for a page Clew does not build: the intranet loads
 * `dist/site-header.js` with a script tag and gets `<site-header>`. Library mode leaves `process.env.NODE_ENV` to the
 * consumer, and a browser page has none, so it is set here. `third-party-notices.txt` and `LICENSE.txt` are written
 * beside it.
 */
export default defineConfig({
  // The embed carries React, Astryx and the typeface to a page Clew does not build, so their notices go with it (D146).
  plugins: [react(), thirdPartyNotices().plugin],
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    outDir: resolve(import.meta.dirname, 'dist'),
    emptyOutDir: true,
    lib: { entry: resolve(import.meta.dirname, 'src/embed.tsx'), formats: ['es'], fileName: () => 'site-header.js' },
  },
});
