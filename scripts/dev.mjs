// Yerel geliştirme: tek komutla veritabanı + API Worker'ı + Vite.
//   npm run dev
//
// * worker/.dev.vars YOKSA: yerel Supabase emülatörü (PGlite, veriler .wrangler/dev-db içinde kalır)
//   başlatılır ve Worker ona bağlanır. Docker gerekmez. Yönetici parolası: ADMIN_PASSWORD ortam
//   değişkeni ya da geliştirme varsayılanı.
// * worker/.dev.vars VARSA: Worker oradaki SUPABASE_URL / SUPABASE_SERVICE_KEY / ADMIN_PASSWORD ile
//   çalışır (ör. yerel `supabase start` ya da ayrı bir geliştirme projesi). Production verisine bağlamayın.
//
// Adresler: oyun http://localhost:5173  ·  Worker http://127.0.0.1:8787  ·  DB emülatörü http://127.0.0.1:54321
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startSupabaseEmulator } from './lib/supabase-emulator.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const bin = (pkg, file) => join(ROOT, 'node_modules', pkg, file);
process.env.CLOUDFLARE_CF_FETCH_ENABLED ??= 'false';

const children = [];
const run = (name, args, env = {}) => {
  const child = spawn(process.execPath, args, { cwd: ROOT, stdio: 'inherit', env: { ...process.env, ...env } });
  child.on('exit', (code) => {
    console.log(`[dev] ${name} kapandı (${code}).`);
    shutdown(code ?? 0);
  });
  children.push(child);
};

let db = null;
async function shutdown(code) {
  for (const c of children) if (c.exitCode === null) c.kill();
  await db?.close().catch(() => undefined);
  process.exit(code);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

const workerArgs = [bin('wrangler', 'bin/wrangler.js'), 'dev', '-c', 'worker/wrangler.toml', '--port', '8787', '--ip', '127.0.0.1'];
const vars = { ORTAM: 'development', ALLOWED_ORIGINS: 'http://localhost:5173,http://127.0.0.1:5173' };

if (existsSync(join(ROOT, 'worker', '.dev.vars'))) {
  console.log('[dev] worker/.dev.vars bulundu: Worker oradaki Supabase ayarlarıyla çalışacak.');
} else {
  const dataDir = join(ROOT, '.wrangler', 'dev-db');
  mkdirSync(dataDir, { recursive: true });
  db = await startSupabaseEmulator({ port: 54321, dataDir });
  console.log(`[dev] Yerel veritabanı (PGlite) hazır: ${db.url}  (veriler: .wrangler/dev-db)`);
  Object.assign(vars, { SUPABASE_URL: db.url, SUPABASE_SERVICE_KEY: db.serviceKey });
  if (process.env.ADMIN_PASSWORD) vars.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
}
for (const [k, v] of Object.entries(vars)) workerArgs.push('--var', `${k}:${v}`);

run('worker', workerArgs);
run('vite', [bin('vite', 'bin/vite.js'), '--host'], { WORKER_DEV_URL: 'http://127.0.0.1:8787' });
