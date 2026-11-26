// Nasodren 5 API Worker'ı. Cloudflare Pages, /api/* isteklerini service binding ile buraya iletir
// (aynı origin; Worker'ın herkese açık bir adresi yoktur). Supabase ile konuşan tek katman budur.
import { HttpError, GENERIC_ERROR, UUID_RE, cleanQuestion, cleanSettings, randomInt, uuid } from './engine/ortak.mjs';
import { newSession } from './engine/oturum.mjs';
import { loadConfig } from './config.mjs';
import { createRepo } from './repo.mjs';
import { json, readJson, safePath, tooMany } from './http.mjs';
import { clearSessionCookie, createSessionCookie, passwordMatches, verifySession } from './admin-auth.mjs';

export { GameSession } from './do/game-session.mjs';
export { Room } from './do/room.mjs';
export { RateLimiter } from './do/rate-limiter.mjs';

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** İstemci IP'si: Cloudflare'in kendisinin koyduğu CF-Connecting-IP. X-Forwarded-For'a güvenilmez. */
const clientIp = (request) => request.headers.get('cf-connecting-ip') || 'bilinmiyor';

function limiter(env, bucket, key) {
  return env.RATE_LIMITER.get(env.RATE_LIMITER.idFromName(`${bucket}:${key}`));
}

/** Olayı sayar; sınır aşıldıysa 429 fırlatır. */
async function limit(env, cfg, bucket, key) {
  const { max, windowMs } = cfg.limits[bucket];
  const r = await limiter(env, bucket, key).hit(max, windowMs);
  if (r.limited) throw tooMany(r.retryAfter);
}

/** Sınır aşılmışsa 429 fırlatır (saymaz). */
async function blocked(env, cfg, bucket, key) {
  const r = await limiter(env, bucket, key).check(cfg.limits[bucket].max);
  if (r.limited) throw tooMany(r.retryAfter);
}

/**
 * CSRF / origin koruması: durum değiştiren isteklerde Origin başlığı varsa ya isteğin kendi origin'i
 * ya da ALLOWED_ORIGINS içinde olmalıdır. (Tarayıcılar POST/PUT/DELETE'te Origin gönderir.)
 */
function originAllowed(request, url, cfg) {
  if (!UNSAFE.has(request.method)) return true;
  const origin = request.headers.get('origin');
  if (!origin) return true;
  return origin === url.origin || cfg.allowedOrigins.includes(origin);
}

const roomStub = (env, code) => env.ROOM.get(env.ROOM.idFromName(code));
const sessionStub = (env, token) => env.GAME_SESSION.get(env.GAME_SESSION.idFromName(token));

/** DO'ya iç istek (yalnızca gerekli alanlar iletilir). */
function roomFetch(env, code, op, { method = 'POST', body, search = '' } = {}) {
  return roomStub(env, code).fetch(`https://oda.internal/${op}${search}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function health(env, cfg) {
  const out = { durum: 'ok', ortam: cfg.ortam, surum: cfg.commit, kontroller: { yapilandirma: cfg.ok ? 'ok' : 'eksik', veritabani: 'denenmedi' } };
  if (!cfg.ok) {
    out.durum = 'hata';
    out.eksik = cfg.problems; // yalnızca değişken adları ve kural, değer yok
    return json(503, out);
  }
  try {
    await createRepo(cfg.supabase).genelDurum();
    out.kontroller.veritabani = 'ok';
  } catch (err) {
    console.error('[saglik] veritabanı erişilemiyor:', err?.message ?? err);
    out.kontroller.veritabani = 'hata';
    out.durum = 'hata';
    return json(503, out);
  }
  return json(200, out);
}

async function route(request, env, url, pathname, cfg) {
  const method = request.method;
  const ip = clientIp(request);
  const repo = createRepo(cfg.supabase);

  // ---------- herkese açık oyun ----------

  if (method === 'GET' && pathname === '/api/oyun') return json(200, await repo.genelDurum());

  if (method === 'POST' && pathname === '/api/oyun/oturum') {
    await limit(env, cfg, 'gameStart', ip);
    const { questions, settings } = await repo.oyunVerisi();
    const { state, response } = newSession({ questions, settings, now: Date.now() });
    const r = await sessionStub(env, state.token).create(state);
    if (r.status !== 201) throw new Error('Oturum oluşturulamadı.');
    return json(201, response);
  }

  const og = pathname.match(/^\/api\/oyun\/oturum\/([^/]+)\/(cevap|joker)$/);
  if (og && method === 'POST') {
    await limit(env, cfg, 'action', ip);
    const body = await readJson(request);
    if (!UUID_RE.test(og[1])) return json(404, { error: 'Oyun bulunamadı ya da süresi doldu. Yeni oyun başlatın.' });
    const stub = sessionStub(env, og[1]);
    const r = og[2] === 'cevap' ? await stub.answer(body) : await stub.lifeline(body);
    return json(r.status, r.body);
  }

  // İstemci beyanına dayanan eski istatistik ucu: istatistik artık sunucuda, doğrulanmış oyunlardan üretilir.
  if (pathname === '/api/sonuc') return json(410, { error: 'Bu işlem artık desteklenmiyor.' });

  // ---------- çok oyunculu ----------

  if (pathname.startsWith('/api/canli/')) {
    if (method === 'POST' && pathname === '/api/canli/oda') {
      await limit(env, cfg, 'roomCreate', ip);
      const { settings } = await repo.genelDurum().then((d) => ({ settings: d.ayarlar }));
      for (let i = 0; i < 10; i++) {
        const code = String(100000 + randomInt(900000));
        const res = await roomFetch(env, code, 'create', { body: { code, settings } });
        if (res.status === 201) return json(201, await res.json());
      }
      throw new HttpError(503, 'Şu anda yeni oda açılamıyor, biraz sonra deneyin.');
    }
    const m = pathname.match(/^\/api\/canli\/oda\/(\d{6})(?:\/(akis|katil|cevap|ayril|komut))?$/);
    if (!m) return json(404, { error: 'Bulunamadı' });
    const [, code, action] = m;

    // PIN tahmini koruması: oda kodu içeren her uçta bulunamayan PIN'ler sayılır (404 / 403 farkıyla
    // oda varlığı yoklanamasın diye cevap/ayrıl/komut dahil); sınır aşılınca o adresten oda isteği yapılamaz.
    await blocked(env, cfg, 'pinFail', ip);
    const missed = async (res) => {
      if (res.status === 404 || res.headers.get('x-oda-yok')) await limit(env, cfg, 'pinFail', ip).catch(() => undefined);
      return res;
    };

    if (method === 'GET' && action === 'akis') {
      await limit(env, cfg, 'stream', ip);
      const host = url.searchParams.get('host');
      const oyuncu = url.searchParams.get('oyuncu');
      const search = host ? `?host=${encodeURIComponent(host)}` : `?oyuncu=${encodeURIComponent(oyuncu ?? '')}`;
      const res = await roomStub(env, code).fetch(`https://oda.internal/stream${search}`);
      await missed(res);
      const headers = new Headers(res.headers);
      headers.delete('x-oda-yok');
      return new Response(res.body, { status: res.status, headers });
    }
    if (method === 'GET' && !action) return missed(await roomFetch(env, code, 'info', { method: 'GET' }));
    if (method !== 'POST' || !action) return json(404, { error: 'Bulunamadı' });

    const body = await readJson(request);
    if (action === 'katil') {
      await limit(env, cfg, 'join', ip);
      return missed(await roomFetch(env, code, 'join', { body: { name: body.name } }));
    }
    await limit(env, cfg, 'action', ip);
    if (action === 'cevap') return missed(await roomFetch(env, code, 'answer', { body: { token: body.token, choice: body.choice } }));
    if (action === 'ayril') return missed(await roomFetch(env, code, 'leave', { body: { token: body.token } }));
    return missed(await roomFetch(env, code, 'command', {
      body: { hostToken: body.hostToken, type: body.type, count: body.count, seconds: body.seconds, id: body.id },
    }));
  }

  // ---------- yönetici ----------

  if (pathname === '/api/admin/oturum') {
    if (method === 'DELETE') return json(200, { ok: true }, { 'set-cookie': clearSessionCookie() });
    if (method !== 'POST') return json(404, { error: 'Bulunamadı' });
    // Yalnızca başarısız denemeler sayılır; sınır aşılınca doğru parola da pencere dolana kadar 429 alır.
    await blocked(env, cfg, 'adminLogin', ip);
    const body = await readJson(request);
    if (!(await passwordMatches(body?.parola, cfg.adminPassword))) {
      await limit(env, cfg, 'adminLogin', ip).catch(() => undefined);
      return json(401, { error: 'Şifre hatalı.' });
    }
    await limiter(env, 'adminLogin', ip).reset();
    return json(200, { ok: true }, { 'set-cookie': await createSessionCookie(cfg.adminPassword, Date.now()) });
  }

  const adminPaths = pathname === '/api/admin' || pathname === '/api/ayarlar' || pathname === '/api/istatistik' || pathname.startsWith('/api/sorular');
  if (!adminPaths) return json(404, { error: 'Bulunamadı' });
  if (!(await verifySession(request, cfg.adminPassword, Date.now()))) return json(401, { error: 'Yönetici oturumu gerekli.' });

  if (method === 'GET' && pathname === '/api/admin') return json(200, await repo.adminVerisi());
  if (method === 'POST' && pathname === '/api/sorular') {
    const { q, error } = cleanQuestion(await readJson(request));
    if (error) return json(400, { error });
    return json(201, await repo.soruEkle(q));
  }
  const sm = pathname.match(/^\/api\/sorular\/([\w-]+)$/);
  if (sm && method === 'PUT') {
    const { q, error } = cleanQuestion(await readJson(request), { id: sm[1] });
    if (error) return json(400, { error });
    await repo.soruGuncelle(sm[1], q);
    return json(200, { ok: true });
  }
  if (sm && method === 'DELETE') {
    await repo.soruSil(sm[1]);
    return json(200, { ok: true });
  }
  if (method === 'PUT' && pathname === '/api/sorular') {
    const body = await readJson(request);
    if (!Array.isArray(body)) return json(400, { error: 'Geçersiz dosya: soru listesi bekleniyor.' });
    const out = [];
    for (const [i, item] of body.entries()) {
      const keep = item?.id ? { id: String(item.id) } : { id: uuid() };
      const { q, error } = cleanQuestion(item ?? {}, keep);
      if (error) return json(400, { error: `${i + 1}. soru: ${error}` });
      out.push(q);
    }
    const r = await repo.sorulariDegistir(out);
    return json(200, { ok: true, count: r.count });
  }
  if (method === 'PUT' && pathname === '/api/ayarlar') {
    const body = await readJson(request);
    const surum = Number(body?.surum);
    if (!Number.isInteger(surum) || surum < 1) return json(400, { error: 'Ayar sürümü eksik. Sayfayı yenileyip tekrar deneyin.' });
    return json(200, await repo.ayarlariGuncelle(cleanSettings(body), surum));
  }
  if (method === 'DELETE' && pathname === '/api/istatistik') {
    await repo.istatistikSifirla();
    return json(200, { ok: true });
  }
  return json(404, { error: 'Bulunamadı' });
}

export default {
  async fetch(request, env) {
    let url;
    let pathname;
    try {
      url = new URL(request.url);
      pathname = decodeURIComponent(url.pathname);
    } catch {
      return json(400, { error: 'Geçersiz adres.' });
    }
    if (!pathname.startsWith('/api/')) return json(404, { error: 'Bulunamadı' });

    const cfg = loadConfig(env);
    if (pathname === '/api/saglik' || pathname === '/api/health') return health(env, cfg);
    // Fail-closed: secret'lar eksik ya da zayıfsa hiçbir API işlemi yapılmaz.
    if (!cfg.ok) return json(503, { error: 'Sunucu yapılandırması eksik. Yönetici bilgilendirildi.' });
    if (!originAllowed(request, url, cfg)) return json(403, { error: 'Bu kaynaktan gelen isteğe izin verilmiyor.' });

    try {
      return await route(request, env, url, pathname, cfg);
    } catch (err) {
      if (err instanceof HttpError) return json(err.status, { error: err.message }, err.headers);
      // Ayrıntı yalnızca sunucu günlüğüne; istek gövdesi, başlıklar ve secret'lar yazılmaz.
      console.error(`[api] ${request.method} ${safePath(pathname)} başarısız:`, err?.message ?? err);
      return json(500, { error: GENERIC_ERROR });
    }
  },
};
