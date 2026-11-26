import { defineConfig, loadEnv, type Plugin } from 'vite';
import { resolve } from 'node:path';
import { rmSync } from 'node:fs';

// Sunucu modunda cevap anahtarını içeren seed dosyası frontend'e hiç girmez:
//   * geliştirmede /data/* 404 döner,
//   * build çıktısından dist/data silinir (Cloudflare Pages'e yüklenmez).
// Yerel (statik) mod (VITE_VERI_MODU=yerel) bilinçli seçimdir ve seed'i kullanır.
function seedGuard(localMode: boolean): Plugin {
  return {
    name: 'siklamen-seed-guard',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const [path, query = ''] = (req.url ?? '').split('?');
        if (!localMode && path.startsWith('/data/')) {
          res.statusCode = 404;
          res.end('Bulunamadı');
          return;
        }
        const page = { '/admin': 'admin', '/yonetim': 'admin', '/canli': 'canli', '/cok-oyunculu': 'canli', '/katil': 'katil', '/k': 'katil' }[path];
        if (page) req.url = `/${page}.html${query ? `?${query}` : ''}`;
        next();
      });
    },
    closeBundle() {
      if (!localMode) rmSync(resolve(import.meta.dirname, 'dist', 'data'), { recursive: true, force: true });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, import.meta.dirname, 'VITE_');
  const localMode = (process.env.VITE_VERI_MODU ?? env.VITE_VERI_MODU) === 'yerel';
  // Yerel geliştirme: API, `npm run dev` tarafından başlatılan Worker'dadır (wrangler dev).
  const apiTarget = process.env.WORKER_DEV_URL ?? 'http://127.0.0.1:8787';
  return {
    base: './',
    plugins: [seedGuard(localMode)],
    server: {
      proxy: localMode ? undefined : { '/api': { target: apiTarget, changeOrigin: false } },
    },
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
  };
});
