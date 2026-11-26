// Yerel Supabase emülatörü — YALNIZCA test ve yerel geliştirme içindir, production'da kullanılmaz.
//
// PGlite (WASM ile çalışan gerçek PostgreSQL) üzerinde supabase/migrations dosyalarını uygular ve
// Worker'ın kullandığı PostgREST uçlarının küçük bir alt kümesini taklit eder:
//   POST /rest/v1/rpc/<fonksiyon>   (apikey başlığına göre service_role ya da anon rolüyle)
//   GET  /rest/v1/<tablo>           (yalnızca erişim kısıtı testleri için)
// Supabase'in rolleri (anon, authenticated, service_role) ve public şemadaki varsayılan yetkileri
// kurulur; böylece migration'daki REVOKE / RLS ayarları gerçek PostgreSQL motorunda doğrulanır.
import { createServer } from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const MIGRATIONS_DIR = join(ROOT, 'supabase', 'migrations');

const BOOTSTRAP = `
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
end $$;
grant usage on schema public to anon, authenticated, service_role;
-- Supabase'in varsayılanı: public şemada yeni tablo/fonksiyon/dizilere herkes erişebilir.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`;

/** Migration dosyaları (ad sırasıyla). */
export const migrationFiles = () => readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();

/**
 * PGlite veritabanı açar, Supabase rollerini kurar ve uygulanmamış migration'ları uygular.
 * `setup`: migration'lardan ÖNCE çalışan SQL (ör. ortak projedeki diğer oyunları taklit eden nesneler).
 */
export async function openDatabase({ dataDir, migrations = true, setup } = {}) {
  const db = dataDir ? new PGlite(dataDir) : new PGlite();
  await db.exec(BOOTSTRAP);
  if (setup) await db.exec(setup);
  if (migrations) await applyMigrations(db);
  return db;
}

/** Uygulanmış sürümler: migration'ların kendilerinin yazdığı public.n5_migrations tablosundan. */
async function appliedVersions(db) {
  const exists = (await db.query(`select to_regclass('public.n5_migrations') is not null as e`)).rows[0].e;
  return new Set(exists ? (await db.query('select surum from public.n5_migrations')).rows.map((r) => r.surum) : []);
}

/** Uygulanmamış migration'ları sırayla çalıştırır. Her dosya kendi begin/commit'iyle tek işlemdir. */
export async function applyMigrations(db) {
  const applied = await appliedVersions(db);
  const ran = [];
  for (const name of migrationFiles()) {
    if (applied.has(name.slice(0, 14))) continue;
    await db.exec(readFileSync(join(MIGRATIONS_DIR, name), 'utf8'));
    ran.push(name);
  }
  return ran;
}

/** PostgREST'in hata eşlemesinin bu proje için gereken kısmı. */
function httpStatus(code) {
  if (/^PT\d{3}$/.test(code)) return Number(code.slice(2));
  if (code === '42501') return 401; // yetki yok (anon)
  if (code === '42883' || code === '42P01') return 404;
  if (code === '23505' || code === '23503') return 409;
  if (/^2[23]/.test(code) || code === 'P0001') return 400;
  return 500;
}

const param = (v) => (v === null || v === undefined ? null : typeof v === 'object' ? JSON.stringify(v) : String(v));

/**
 * @param {{ port?: number, dataDir?: string, serviceKey?: string, anonKey?: string, delayMs?: number }} opts
 */
export async function startSupabaseEmulator({ port = 0, dataDir, serviceKey, anonKey, delayMs = 0 } = {}) {
  const db = await openDatabase({ dataDir });
  const keys = {
    [serviceKey ?? `sb_secret_emulator_${randomBytes(12).toString('hex')}`]: 'service_role',
    [anonKey ?? `sb_publishable_emulator_${randomBytes(12).toString('hex')}`]: 'anon',
  };
  const [service, anon] = Object.keys(keys);
  const calls = [];
  let failNext = 0;
  let queue = Promise.resolve();
  // PGlite tek bağlantılıdır: istekler sıraya alınır (gerçek Supabase'de satır kilitleri bu işi görür).
  const serial = (fn) => {
    const run = queue.then(fn);
    queue = run.catch(() => undefined);
    return run;
  };

  const server = createServer(async (req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
      res.end(body === undefined ? '' : JSON.stringify(body));
    };
    const url = new URL(req.url, 'http://x');
    const role = keys[req.headers.apikey];
    if (!role) return send(401, { message: 'Invalid API key' });
    let raw = '';
    for await (const c of req) raw += c;
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    if (failNext > 0) {
      failNext -= 1;
      return send(503, { message: 'emülatör: geçici hata' });
    }

    const rpc = url.pathname.match(/^\/rest\/v1\/rpc\/([a-z0-9_]+)$/);
    const table = url.pathname.match(/^\/rest\/v1\/([a-z0-9_]+)$/);
    try {
      if (rpc && req.method === 'POST') {
        const args = raw ? JSON.parse(raw) : {};
        calls.push({ fn: rpc[1], role, args });
        const names = Object.keys(args);
        if (names.some((n) => !/^p_[a-z0-9_]+$/.test(n))) return send(400, { code: 'PGRST', message: 'Geçersiz parametre' });
        const sql = `select public.${rpc[1]}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')}) as r`;
        const result = await serial(() => db.transaction(async (tx) => {
          await tx.exec(`set local role ${role}`);
          return tx.query(sql, names.map((n) => param(args[n])));
        }));
        return send(200, result.rows[0]?.r ?? null);
      }
      if (table && req.method === 'GET') {
        const result = await serial(() => db.transaction(async (tx) => {
          await tx.exec(`set local role ${role}`);
          return tx.query(`select * from public.${table[1]}`);
        }));
        return send(200, result.rows);
      }
      return send(404, { message: 'Bulunamadı' });
    } catch (err) {
      const code = err?.code ?? '';
      return send(httpStatus(code), { code, message: err?.message ?? 'hata', details: null, hint: null });
    }
  });
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    serviceKey: service,
    anonKey: anon,
    db,
    calls,
    /** Sonraki n isteğe 503 döndürür (geçici hata simülasyonu). */
    failNext(n = 1) { failNext = n; },
    /** Doğrudan SQL (service_role değil, sahip olarak) — yalnızca test doğrulaması için. */
    query: (sql, params) => serial(() => db.query(sql, params)),
    close: async () => {
      await new Promise((resolve) => { server.closeAllConnections?.(); server.close(resolve); });
      await db.close();
    },
  };
}
