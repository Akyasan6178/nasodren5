import { defineConfig, type Plugin } from 'vite';
import { resolve } from 'node:path';
// @ts-expect-error — düz JS modülü, tip bildirimi yok
import { createApi } from './server/api.mjs';

// Geliştirme sunucusunda da aynı soru API'sini çalıştırır; ayrı bir süreç gerekmez.
function apiPlugin(): Plugin {
  return {
    name: 'siklamen-api',
    configureServer(server) {
      server.middlewares.use(
        createApi({
          dataDir: resolve(import.meta.dirname, 'data'),
          seedFile: resolve(import.meta.dirname, 'public/data/varsayilan-sorular.json'),
          adminPassword: process.env.ADMIN_PASSWORD || 'siklamen',
        }),
      );
      server.middlewares.use((req, _res, next) => {
        const [path, query = ''] = (req.url ?? '').split('?');
        const page = { '/admin': 'admin', '/yonetim': 'admin', '/canli': 'canli', '/cok-oyunculu': 'canli', '/katil': 'katil', '/k': 'katil' }[path];
        if (page) req.url = `/${page}.html${query ? `?${query}` : ''}`;
        next();
      });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [apiPlugin()],
  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        oyun: resolve(import.meta.dirname, 'index.html'),
        admin: resolve(import.meta.dirname, 'admin.html'),
        canli: resolve(import.meta.dirname, 'canli.html'),
        katil: resolve(import.meta.dirname, 'katil.html'),
      },
    },
  },
});
