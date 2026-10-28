import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the build can be dropped under any sub-path (e.g. /oyun/).
  base: './',
  build: {
    target: 'es2020',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1200,
  },
});
