// Test yardımcıları: geçici veri dizininde gerçek bir HTTP sunucusu üzerinde API'yi çalıştırır.
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApi } from '../server/api.mjs';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const SEED_FILE = join(ROOT, 'public', 'data', 'varsayilan-sorular.json');
export const ADMIN_KEY = 'test-sifre';

/** Her test için ayrı geçici dizin. */
export async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), 'n5-test-'));
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

/**
 * API'yi geçici bir portta başlatır. `logs` sunucu tarafı günlük kayıtlarını toplar.
 * @param {{ dataDir: string, seedFile?: string }} opts
 */
export async function startApi({ dataDir, seedFile = SEED_FILE }) {
  const logs = [];
  const api = createApi({ dataDir, seedFile, adminPassword: ADMIN_KEY, log: (...args) => logs.push(args) });
  const server = createServer((req, res) => api(req, res, () => res.writeHead(404).end()));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  async function request(method, path, { body, admin = false } = {}) {
    const res = await fetch(base + path, {
      method,
      headers: { 'content-type': 'application/json', ...(admin ? { 'x-admin-key': ADMIN_KEY } : {}) },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* düz metin */ }
    return { status: res.status, text, json };
  }

  return {
    base,
    logs,
    request,
    close: () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(resolve); }),
  };
}

/** Yanıt gövdesinde iç ayrıntı (dosya yolu, sistem hata kodu, yığın izi) olmadığını doğrular. */
export function leaksInternals(text, ...paths) {
  const needles = ['ENOENT', 'EACCES', 'SyntaxError', '    at ', 'node:internal', ...paths];
  if (/[A-Za-z]:\\\\|[A-Za-z]:\\/.test(text)) return 'Windows yolu';
  for (const n of needles) if (n && text.includes(n)) return n;
  return null;
}
