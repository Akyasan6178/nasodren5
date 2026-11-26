import { defineConfig, loadEnv, type Plugin } from 'vite';
import { resolve } from 'node:path';
// @ts-expect-error — düz JS modülü, tip bildirimi yok
import { createApi } from './server/api.mjs';
// @ts-expect-error — düz JS modülü, tip bildirimi yok
import { loadConfig } from './server/config.mjs';

// Geliştirme sunucusunda da aynı soru API'sini çalıştırır; ayrı bir süreç gerekmez.
// Geliştirme modunda ADMIN_PASSWORD verilmezse yalnızca yerel kullanım için varsayılan parola kullanılır.
function apiPlugin(localMode: boolean): Plugin {
  return {
    name: 'siklamen-api',
    configureServer(server) {
      const config = loadConfig(process.env, 'development');
      for (const w of config.warnings) server.config.logger.warn(`Uyarı: ${w}`);
      server.middlewares.use(
        createApi({
          dataDir: resolve(import.meta.dirname, 'data'),
          seedFile: resolve(import.meta.dirname, 'public/data/varsayilan-sorular.json'),
          adminPassword: config.adminPassword,
          trustProxy: config.trustProxy,
          limits: config.limits,
        }),
      );
      server.middlewares.use((req, res, next) => {
        const [path, query = ''] = (req.url ?? '').split('?');
        // Sunucu modunda cevap anahtarını içeren seed dosyası tarayıcıya sunulmaz.
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
  };
}

export default defineConfig(({ mode }) => {
  // VITE_VERI_MODU=yerel: sunucusuz (statik) yerel mod. Varsayılan: sunucu modu.
  const env = loadEnv(mode, import.meta.dirname, 'VITE_');
  const localMode = (process.env.VITE_VERI_MODU ?? env.VITE_VERI_MODU) === 'yerel';
  return {
    base: './',
    plugins: [apiPlugin(localMode)],
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
