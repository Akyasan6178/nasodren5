// Test yığını: Supabase emülatörü (PGlite + PostgREST RPC taklidi) + gerçek Worker (workerd, Durable Objects)
process.env.CLOUDFLARE_CF_FETCH_ENABLED ??= 'false'; // workerd: Request.cf nesnesini internetten indirme
// worker/wrangler.toml yapılandırmasıyla. Her çağrı bağımsız, bellekte bir yığın kurar.
import { join } from 'node:path';
import { unstable_startWorker } from 'wrangler';
import { startSupabaseEmulator } from '../../scripts/lib/supabase-emulator.mjs';
import { ROOT } from '../helpers.mjs';

export const WORKER_CONFIG = join(ROOT, 'worker', 'wrangler.toml');
// Yalnızca test yığınlarında kullanılan, her çalıştırmada üretilen parola (gerçek kimlik bilgisi değildir).
export const ADMIN_PASSWORD = `Tst-${crypto.randomUUID()}`;

const text = (value) => ({ type: 'plain_text', value: String(value) });
const secret = (value) => ({ type: 'secret_text', value: String(value) });

/**
 * @param {{ vars?: Record<string, string|number>, secrets?: Record<string, string|null>, db?: object, persist?: string }} opts
 *   secrets değeri null ise o secret hiç tanımlanmaz (eksik secret testi).
 */
export async function startStack({ vars = {}, secrets = {}, db, persist } = {}) {
  const supabase = db ?? (await startSupabaseEmulator());
  const allSecrets = { ADMIN_PASSWORD, SUPABASE_URL: supabase.url, SUPABASE_SERVICE_KEY: supabase.serviceKey, ...secrets };
  const bindings = { ORTAM: text('development'), CANLI_HAZIR_MS: text(50), CANLI_PING_MS: text(300) };
  for (const [k, v] of Object.entries(vars)) bindings[k] = text(v);
  for (const [k, v] of Object.entries(allSecrets)) if (v !== null) bindings[k] = secret(v);

  const worker = await unstable_startWorker({
    config: WORKER_CONFIG,
    bindings,
    dev: {
      server: { hostname: '127.0.0.1', port: 0 },
      inspector: false,
      persist: persist ?? false,
      logLevel: 'none',
      watch: false,
    },
  });
  const base = String(await worker.url).replace(/\/$/, '');

  /** API isteği. `ip` CF-Connecting-IP olarak gider (yerel workerd başlığı olduğu gibi iletir). */
  async function request(method, path, { body, ip = '198.51.100.1', headers = {}, cookie } = {}) {
    const res = await fetch(base + path, {
      method,
      headers: {
        'content-type': 'application/json',
        'cf-connecting-ip': ip,
        ...(cookie ? { cookie } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    const raw = await res.text();
    let json = null;
    try { json = JSON.parse(raw); } catch { /* düz metin */ }
    return { status: res.status, headers: res.headers, text: raw, json };
  }

  /** Yönetici girişi: oturum cookie'sini döndürür. */
  async function login(password = ADMIN_PASSWORD, ip) {
    const r = await request('POST', '/api/admin/oturum', { body: { parola: password }, ip });
    const set = r.headers.get('set-cookie') ?? '';
    return { ...r, cookie: set.split(';')[0], setCookie: set };
  }

  return {
    base,
    db: supabase,
    request,
    login,
    worker,
    async close({ keepDb = false } = {}) {
      await worker.dispose();
      if (!keepDb && !db) await supabase.close();
    },
  };
}
