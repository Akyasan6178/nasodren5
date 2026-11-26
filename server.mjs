// Siklamen Bilgi Oyunu — üretim sunucusu (bağımlılıksız).
// Önce `npm run build`, sonra `npm start`. Yapılandırma ortam değişkenleriyle yapılır (README "Production").
// ADMIN_PASSWORD zorunludur: eksik, boş, kısa ya da bilinen bir varsayılan ise sunucu başlamaz.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApi } from './server/api.mjs';
import { ConfigError, loadConfig } from './server/config.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DIST = join(ROOT, 'dist');

let config;
try {
  config = loadConfig(process.env, 'production');
} catch (err) {
  if (err instanceof ConfigError) {
    console.error(`Başlatma durduruldu: ${err.message}`);
    process.exit(1);
  }
  throw err;
}
for (const w of config.warnings) console.warn(`Uyarı: ${w}`);

const api = createApi({
  dataDir: join(ROOT, 'data'),
  seedFile: join(ROOT, 'public', 'data', 'varsayilan-sorular.json'),
  adminPassword: config.adminPassword,
  trustProxy: config.trustProxy,
  limits: config.limits,
});

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
};

async function serveStatic(req, res) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }).end('Geçersiz adres');
    return;
  }
  if (pathname === '/') pathname = '/index.html';
  if (pathname === '/admin' || pathname === '/yonetim') pathname = '/admin.html';
  if (pathname === '/canli' || pathname === '/cok-oyunculu') pathname = '/canli.html';
  if (pathname === '/katil' || pathname === '/k') pathname = '/katil.html';
  const file = normalize(join(DIST, pathname));
  if (file !== DIST && !file.startsWith(DIST + sep)) {
    res.writeHead(403).end();
    return;
  }
  // Seed dosyası (cevap anahtarı dahil) yalnızca açıkça seçilen yerel (statik) mod içindir;
  // sunucu modunda herkese açık sunulmaz.
  if (file.startsWith(join(DIST, 'data') + sep)) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Bulunamadı');
    return;
  }
  try {
    const data = await readFile(file);
    const immutable = file.includes(`${sep}assets${sep}`);
    res.writeHead(200, {
      'content-type': MIME[extname(file)] ?? 'application/octet-stream',
      'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
      'x-content-type-options': 'nosniff',
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Bulunamadı');
  }
}

const server = createServer((req, res) => {
  api(req, res, () => serveStatic(req, res)).catch((err) => {
    console.error('[sunucu] beklenmeyen hata:', err);
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end();
  });
});
server.listen(config.port, () => {
  const { port } = server.address();
  console.log(`Oyun:            http://localhost:${port}/`);
  console.log(`Yönetici paneli: http://localhost:${port}/admin`);
  console.log(`Çok oyunculu:    http://localhost:${port}/canli  (oyuncular: /katil)`);
});
