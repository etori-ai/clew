import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The embed (D87) as one ES module with React and Astryx inside, for a page Clew does not build: the intranet loads
 * `dist/site-header.js` with a script tag and gets `<site-header>`. Library mode leaves `process.env.NODE_ENV` to the
 * consumer, and a browser page has none, so it is set here.
 */
export default defineConfig({
  plugins: [react()],
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    outDir: resolve(import.meta.dirname, 'dist'),
    emptyOutDir: true,
    lib: { entry: resolve(import.meta.dirname, 'src/embed.tsx'), formats: ['es'], fileName: () => 'site-header.js' },
  },
});
