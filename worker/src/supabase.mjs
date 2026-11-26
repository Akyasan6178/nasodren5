// Supabase erişim katmanı (yalnızca Worker). Tüm veri işlemleri PostgREST RPC'si ile
// public.n5_* fonksiyonlarına gider; tablolar doğrudan okunmaz ya da yazılmaz.
//
// Güvenlik:
//   * Anahtar yalnızca istek başlığında kullanılır; hiçbir hata mesajına ya da günlüğe yazılmaz.
//   * Veritabanı hata ayrıntıları istemciye gitmez. Yalnızca fonksiyonların bilerek fırlattığı
//     'PTxyz' hataları (kullanıcıya yönelik Türkçe mesajlar) HttpError olarak geçirilir.
//   * Yalnızca okuma (idempotent) çağrıları geçici hatada bir kez yeniden denenir; yazmalar asla
//     körlemesine tekrarlanmaz.
import { HttpError } from './engine/ortak.mjs';

const TIMEOUT_MS = 8000;

/**
 * @param {{ url: string, key: string, fetch?: typeof fetch, timeoutMs?: number }} opts
 */
export function createSupabase({ url, key, fetch: doFetch = (...a) => fetch(...a), timeoutMs = TIMEOUT_MS }) {
  // Yeni "sb_secret_..." anahtarları yalnızca apikey başlığıyla; eski JWT service_role anahtarı
  // ayrıca Authorization: Bearer ile gönderilir.
  const headers = {
    apikey: key,
    'content-type': 'application/json',
    accept: 'application/json',
    ...(key.startsWith('sb_') ? {} : { authorization: `Bearer ${key}` }),
  };

  async function once(fn, args) {
    let res;
    try {
      res = await doFetch(`${url}/rest/v1/rpc/${fn}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(args),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const e = new Error(`Supabase RPC ${fn}: ${err?.name === 'TimeoutError' ? 'zaman aşımı' : 'bağlantı hatası'}`);
      e.retryable = true;
      throw e;
    }
    const text = await res.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = null; }
    if (res.ok) return body;
    const code = typeof body?.code === 'string' ? body.code : '';
    if (/^PT4\d\d$/.test(code) && typeof body.message === 'string') throw new HttpError(Number(code.slice(2)), body.message);
    const e = new Error(`Supabase RPC ${fn}: HTTP ${res.status}${code ? ` (${code})` : ''}`);
    e.retryable = res.status >= 500;
    throw e;
  }

  return {
    /**
     * @param {string} fn n5_* fonksiyon adı
     * @param {object} args p_* parametreleri
     * @param {{ idempotent?: boolean }} opts yalnızca okuma çağrıları idempotent işaretlenmeli
     */
    async rpc(fn, args = {}, { idempotent = false } = {}) {
      try {
        return await once(fn, args);
      } catch (err) {
        if (!idempotent || !err.retryable) throw err;
        return once(fn, args);
      }
    },
  };
}
