// Yönetici oturumu: parola yalnızca girişte gönderilir; sonra kısa ömürlü, sunucuda doğrulanan,
// HMAC-SHA256 imzalı bir cookie kullanılır. Tarayıcı JavaScript'i cookie'yi okuyamaz (HttpOnly),
// başka sitelerden gelen isteklerde gönderilmez (SameSite=Strict), yalnızca HTTPS'te gider (Secure)
// ve yalnızca /api yolunda geçerlidir.
//
// İmza anahtarı ADMIN_PASSWORD'dur: parola değiştirilince (secret rotation) tüm oturumlar geçersiz olur.
// Oturum durumsuzdur: çıkış cookie'yi siler; çalınmış bir cookie en fazla SESSION_TTL_S boyunca geçerlidir.

export const COOKIE = 'n5_admin';
export const SESSION_TTL_S = 2 * 60 * 60;

const enc = new TextEncoder();
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

const hmacKey = (secret) => crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
const sha256 = async (s) => new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s)));

/** Parola karşılaştırması: önce özetlenir (uzunluk sızmaz), sonra sabit sürede karşılaştırılır. */
export async function passwordMatches(input, expected) {
  if (typeof input !== 'string' || typeof expected !== 'string') return false;
  const [a, b] = await Promise.all([sha256(input), sha256(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

const cookieAttrs = (maxAge) => `Path=/api; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;

/** Yeni oturum için Set-Cookie değeri. */
export async function createSessionCookie(secret, nowMs) {
  const exp = Math.floor(nowMs / 1000) + SESSION_TTL_S;
  const nonce = b64url(crypto.getRandomValues(new Uint8Array(16)));
  const payload = `v1.${exp}.${nonce}`;
  const sig = b64url(await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(payload)));
  return `${COOKIE}=${payload}.${sig}; ${cookieAttrs(SESSION_TTL_S)}`;
}

export const clearSessionCookie = () => `${COOKIE}=; ${cookieAttrs(0)}`;

function readCookie(request) {
  const header = request.headers.get('cookie') ?? '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === COOKIE) return v.join('=');
  }
  return null;
}

/** İstekteki oturum cookie'si geçerli mi? (imza sabit sürede doğrulanır) */
export async function verifySession(request, secret, nowMs) {
  const token = readCookie(request);
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') return false;
  const exp = Number(parts[1]);
  const nowS = nowMs / 1000;
  if (!Number.isInteger(exp) || exp <= nowS || exp - nowS > SESSION_TTL_S + 5) return false;
  let sig;
  try {
    sig = fromB64url(parts[3]);
  } catch {
    return false;
  }
  return crypto.subtle.verify('HMAC', await hmacKey(secret), sig, enc.encode(parts.slice(0, 3).join('.')));
}
