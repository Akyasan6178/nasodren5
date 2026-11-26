// HTTP yardımcıları: JSON yanıtı, güvenlik başlıkları, sınırlı gövde okuma.
import { HttpError } from './engine/ortak.mjs';

export const SECURITY_HEADERS = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
};

export function json(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...SECURITY_HEADERS, ...headers },
  });
}

const MAX_BODY = 2_000_000;

/** JSON gövdesini okur. Boş gövde {} sayılır; bozuk JSON 400, çok büyük gövde 413. */
export async function readJson(request) {
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > MAX_BODY) throw new HttpError(413, 'İstek çok büyük.');
  const reader = request.body?.getReader();
  if (!reader) return {};
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY) {
      await reader.cancel().catch(() => undefined);
      throw new HttpError(413, 'İstek çok büyük.');
    }
    chunks.push(value);
  }
  if (!size) return {};
  const bytes = new Uint8Array(size);
  let off = 0;
  for (const c of chunks) { bytes.set(c, off); off += c.byteLength; }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new HttpError(400, 'İstek gövdesi geçerli bir JSON değil.');
  }
}

export const tooMany = (retryAfter) =>
  new HttpError(429, 'Çok fazla istek gönderildi. Lütfen biraz bekleyip tekrar deneyin.', { 'retry-after': String(retryAfter) });

/** Günlük için yol: oturum ve benzeri kimlikler maskelenir. */
export const safePath = (p) => p.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':token');
