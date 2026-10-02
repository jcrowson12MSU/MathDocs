import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths so the same build works from FastAPI and from GitHub Pages.
  base: './',
  resolve: {
    alias: {
      // jsxgraph's package.json doesn't export its stylesheet.
      'jsxgraph-css': fileURLToPath(new URL('./node_modules/jsxgraph/distrib/jsxgraph.css', import.meta.url)),
    },
  },
  server: {
    proxy: { '/api': 'http://127.0.0.1:8642' },
  },
  build: {
    chunkSizeWarningLimit: 4000,
  },
});
