// Siklamen Bilgi Oyunu — üretim sunucusu (bağımlılıksız).
// Önce `npm run build`, sonra `npm start`. PORT ve ADMIN_PASSWORD ortam değişkenleriyle ayarlanır.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApi } from './server/api.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DIST = join(ROOT, 'dist');
const PORT = Number(process.env.PORT) || 8080;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'siklamen';

const api = createApi({
  dataDir: join(ROOT, 'data'),
  seedFile: join(ROOT, 'public', 'data', 'varsayilan-sorular.json'),
  adminPassword: ADMIN_PASSWORD,
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
  let { pathname } = new URL(req.url, 'http://x');
  if (pathname === '/') pathname = '/index.html';
  if (pathname === '/admin' || pathname === '/yonetim') pathname = '/admin.html';
  if (pathname === '/canli' || pathname === '/cok-oyunculu') pathname = '/canli.html';
  if (pathname === '/katil' || pathname === '/k') pathname = '/katil.html';
  const file = normalize(join(DIST, decodeURIComponent(pathname)));
  if (file !== DIST && !file.startsWith(DIST + sep)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const data = await readFile(file);
    const immutable = file.includes(`${sep}assets${sep}`);
    res.writeHead(200, {
      'content-type': MIME[extname(file)] ?? 'application/octet-stream',
      'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Bulunamadı');
  }
}

createServer((req, res) => api(req, res, () => serveStatic(req, res))).listen(PORT, () => {
  console.log(`Oyun:            http://localhost:${PORT}/`);
  console.log(`Yönetici paneli: http://localhost:${PORT}/admin`);
  console.log(`Çok oyunculu:    http://localhost:${PORT}/canli  (oyuncular: /katil)`);
  if (!process.env.ADMIN_PASSWORD) console.log(`Uyarı: varsayılan yönetici şifresi "${ADMIN_PASSWORD}". ADMIN_PASSWORD ile değiştirin.`);
});
