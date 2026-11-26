// Cloudflare Worker entegrasyon testleri: gerçek workerd çalışma ortamı + Durable Objects
// (worker/wrangler.toml) ve gerçek PostgreSQL (PGlite) üzerinde Supabase RPC emülatörü.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ADMIN_PASSWORD, startStack } from './support/stack.mjs';
import { answerKey, correctChoice, findAnswerLeak, leaksInternals, seed as loadSeed, wrongChoice } from './helpers.mjs';
import { createSessionCookie } from '../worker/src/admin-auth.mjs';
import { startSupabaseEmulator } from '../scripts/lib/supabase-emulator.mjs';

const seed = loadSeed();
const key = answerKey(seed);
let s; // paylaşılan yığın (development modu, geniş sınırlar)
let ipSeq = 0;
const freshIp = () => `203.0.113.${++ipSeq}`;

before(async () => {
  s = await startStack({ vars: { GAME_START_MAX: 1000, ACTION_MAX: 100000 } });
});
after(async () => { await s?.close(); });

const start = async (ip = freshIp()) => {
  const r = await s.request('POST', '/api/oyun/oturum', { ip });
  assert.equal(r.status, 201, r.text);
  return r.json;
};
const answer = (g, body, opts = {}) => s.request('POST', `/api/oyun/oturum/${g.token}/cevap`, { body, ...opts });
const stats = async () => (await s.db.query('select games::int, finished::int, total_correct::int from public.stats_totals')).rows[0];

// ---------- yapılandırma / fail-closed ----------

test('production: eksik secret\'larla Worker fail-closed çalışır; sağlık yalnızca adları bildirir', async () => {
  const p = await startStack({ vars: { ORTAM: 'production' }, secrets: { ADMIN_PASSWORD: null, SUPABASE_SERVICE_KEY: null } });
  try {
    const h = await p.request('GET', '/api/saglik');
    assert.equal(h.status, 503);
    assert.equal(h.json.kontroller.yapilandirma, 'eksik');
    assert.ok(h.json.eksik.some((m) => m.includes('ADMIN_PASSWORD')));
    assert.ok(h.json.eksik.some((m) => m.includes('SUPABASE_SERVICE_KEY')));
    assert.ok(h.json.eksik.some((m) => m.includes('SUPABASE_URL https')), 'production http Supabase adresini kabul etmez');
    assert.equal(leaksInternals(h.text, p.db.serviceKey, p.db.url), null);
    for (const [m, path] of [['GET', '/api/oyun'], ['POST', '/api/oyun/oturum'], ['POST', '/api/canli/oda'], ['POST', '/api/admin/oturum']]) {
      const r = await p.request(m, path, { body: m === 'POST' ? {} : undefined });
      assert.equal(r.status, 503, path);
      assert.equal(leaksInternals(r.text), null);
    }
  } finally {
    await p.close();
  }
});

test('production ve preview: zayıf ya da varsayılan yönetici parolası reddedilir (değer sızmaz)', async () => {
  for (const [ORTAM, pw] of [['production', 'siklamen'], ['preview', 'kisa-parola'], ['bilinmeyen', 'admin']]) {
    const p = await startStack({ vars: { ORTAM }, secrets: { ADMIN_PASSWORD: pw } });
    try {
      const h = await p.request('GET', '/api/saglik');
      assert.equal(h.status, 503, ORTAM);
      assert.ok(h.json.eksik.some((m) => m.includes('ADMIN_PASSWORD')));
      assert.ok(!h.text.includes(`"${pw}"`) && !h.text.includes(` ${pw} `), 'parola yanıtta geçmemeli');
      assert.equal((await p.request('POST', '/api/admin/oturum', { body: { parola: pw } })).status, 503);
    } finally {
      await p.close();
    }
  }
});

test('sağlık kontrolü: yapılandırma ve veritabanı; veritabanı erişilemezse 503', async () => {
  const h = await s.request('GET', '/api/saglik');
  assert.equal(h.status, 200);
  assert.deepEqual(h.json.kontroller, { yapilandirma: 'ok', veritabani: 'ok' });
  assert.equal((await s.request('GET', '/api/health')).status, 200);
  s.db.failNext(2); // okuma bir kez yeniden denenir
  const down = await s.request('GET', '/api/saglik');
  assert.equal(down.status, 503);
  assert.equal(down.json.kontroller.veritabani, 'hata');
  assert.equal(leaksInternals(down.text, s.db.url), null);
});

// ---------- açık oyun API'si ----------

test('GET /api/oyun yalnızca ayarlar ve soru sayısı; oturum başlangıcı cevap anahtarı içermez', async () => {
  const r = await s.request('GET', '/api/oyun');
  assert.deepEqual(Object.keys(r.json).sort(), ['aktifSoru', 'ayarlar']);
  assert.equal(r.json.aktifSoru, 30);
  assert.equal(findAnswerLeak(r.text), null);
  const raw = await s.request('POST', '/api/oyun/oturum', { ip: freshIp() });
  assert.equal(findAnswerLeak(raw.text), null, findAnswerLeak(raw.text));
  for (const q of raw.json.sorular) assert.deepEqual(Object.keys(q).sort(), ['kategori', 'secenekler', 'soru']);
  // Doğru şık her konumda görülebilir (sıra cevabı belli etmez)
  const pos = new Set();
  for (let i = 0; i < 8; i++) for (const q of (await start()).sorular) pos.add(correctChoice(key, q));
  assert.deepEqual([...pos].sort(), [0, 1, 2, 3]);
});

test('sunucu doğru/yanlış ayırır; geçersiz alan ve değerler 400, sıra dışı 409, bilinmeyen oturum 404', async () => {
  const g = await start();
  for (const body of [{}, { index: 0, secim: -1 }, { index: 0, secim: 4 }, { index: '0', secim: 0 }, { index: 0, secim: 1e309 }, { index: 0, secim: 0, dogru: true }]) {
    assert.equal((await answer(g, body)).status, 400, JSON.stringify(body));
  }
  assert.equal((await s.request('POST', `/api/oyun/oturum/${g.token}/cevap`, { body: '{"index":0,"secim":NaN}' })).status, 400);
  assert.equal((await answer(g, { index: 1, secim: 0 })).status, 409);
  const right = await answer(g, { index: 0, secim: correctChoice(key, g.sorular[0]) });
  assert.equal(right.json.sonuc, 'dogru');
  assert.equal(right.json.aciklamalar[right.json.dogruSik], key.get(g.sorular[0].soru).aciklama);
  assert.ok(!right.text.includes(key.get(g.sorular[1].soru).aciklama), 'başka sorunun açıklaması gelmemeli');
  for (const t of ['00000000-0000-4000-8000-000000000000', 'abc', '..%2Fadmin']) {
    assert.equal((await s.request('POST', `/api/oyun/oturum/${t}/cevap`, { body: { index: 0, secim: 0 } })).status, 404, t);
  }
  assert.equal((await s.request('POST', '/api/sonuc', { body: { answers: [], finished: true } })).status, 410);
});

test('eşzamanlı cevap yarışı: aynı soruya gelen paralel cevaplardan yalnızca biri kabul edilir', async () => {
  const before = await stats();
  const g = await start();
  const w = wrongChoice(key, g.sorular[0]);
  const c = correctChoice(key, g.sorular[0]);
  // yarısı doğru, yarısı yanlış şıkla aynı anda
  const results = await Promise.all(Array.from({ length: 20 }, (_, i) => answer(g, { index: 0, secim: i % 2 ? w : c })));
  const accepted = results.filter((r) => r.status === 200);
  const rejected = results.filter((r) => r.status === 409);
  assert.equal(accepted.length + rejected.length, 20);
  assert.equal(new Set(accepted.map((r) => r.json.sonuc)).size, 1, 'kabul edilen tüm yanıtlar aynı sonucu taşımalı');
  assert.equal(accepted.length, 10, 'yalnızca ilk kabul edilen şıkla aynı istekler 200 alır');
  const after = await stats();
  const ended = accepted[0].json.bitti;
  assert.equal(after.games - before.games, ended ? 1 : 0, 'oyun en fazla bir kez sayılır');
});

test('istatistik: yalnızca biten oyundan, bir kez; 30 paralel oyun kayıpsız', async () => {
  const before = await stats();
  const play = async () => {
    const g = await start();
    await answer(g, { index: 0, secim: correctChoice(key, g.sorular[0]) });
    const last = { index: 1, secim: wrongChoice(key, g.sorular[1]) };
    const r = await answer(g, last);
    assert.equal(r.json.bitti, true);
    for (let i = 0; i < 3; i++) assert.equal((await answer(g, last)).status, 200); // yeniden gönderim
  };
  await Promise.all(Array.from({ length: 30 }, play));
  const after = await stats();
  assert.equal(after.games - before.games, 30);
  assert.equal(after.total_correct - before.total_correct, 30);
  assert.equal(after.finished - before.finished, 0);
});

test('veritabanı geçici hatası: cevap kabul edilir, istatistik yeniden gönderimde bir kez yazılır', async () => {
  const before = await stats();
  const g = await start();
  s.db.failNext(2); // kayıt + tek yeniden deneme başarısız
  const r = await answer(g, { index: 0, sureDoldu: true });
  assert.equal(r.status, 500);
  assert.equal(leaksInternals(r.text, s.db.url), null);
  assert.equal((await stats()).games, before.games, 'henüz kaydedilmedi');
  const again = await answer(g, { index: 0, sureDoldu: true });
  assert.equal(again.status, 200);
  assert.equal(again.json.sonuc, 'sure');
  await answer(g, { index: 0, sureDoldu: true });
  assert.equal((await stats()).games, before.games + 1);
});

test('jokerler sunucuda: 50:50 doğru şıkkı elemez, tekrar kullanılamaz; ipucu yalnızca istenince gelir', async () => {
  const g = await start();
  const joker = (body) => s.request('POST', `/api/oyun/oturum/${g.token}/joker`, { body });
  const f = await joker({ index: 0, tur: 'fifty' });
  assert.equal(f.json.elenen.length, 2);
  assert.ok(!f.json.elenen.includes(correctChoice(key, g.sorular[0])));
  assert.deepEqual((await joker({ index: 0, tur: 'fifty' })).json, f.json);
  assert.equal((await joker({ index: 0, tur: 'hint' })).json.ipucu, key.get(g.sorular[0].soru).ipucu);
  await answer(g, { index: 0, secim: correctChoice(key, g.sorular[0]) });
  assert.equal((await joker({ index: 1, tur: 'fifty' })).status, 409);
  assert.equal((await joker({ index: 1, tur: 'yok' })).status, 400);
});

test('Worker yeniden başlatılınca (deploy) oturum Durable Object deposundan devam eder', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'n5-persist-'));
  const db = await startSupabaseEmulator();
  try {
    const a = await startStack({ db, persist: dir });
    const g = (await a.request('POST', '/api/oyun/oturum')).json;
    assert.equal((await a.request('POST', `/api/oyun/oturum/${g.token}/cevap`, { body: { index: 0, secim: correctChoice(key, g.sorular[0]) } })).json.sonuc, 'dogru');
    await a.close();
    const b = await startStack({ db, persist: dir });
    const r = await b.request('POST', `/api/oyun/oturum/${g.token}/cevap`, { body: { index: 1, sureDoldu: true } });
    assert.equal(r.status, 200);
    assert.equal(r.json.dogruSayisi, 1, 'önceki cevap korunmuş olmalı');
    assert.equal((await db.query('select games::int from public.stats_totals')).rows[0].games, 1);
    await b.close();
  } finally {
    await db.close();
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------- yönetici ----------

test('yönetici: yanlış parola genel 401; doğru parola güvenli cookie; cookie olmadan 401', async () => {
  const ip = freshIp();
  const bad = await s.request('POST', '/api/admin/oturum', { body: { parola: 'yanlis' }, ip });
  assert.equal(bad.status, 401);
  assert.deepEqual(bad.json, { error: 'Şifre hatalı.' });
  assert.equal(bad.headers.get('set-cookie'), null);
  const ok = await s.login(ADMIN_PASSWORD, ip);
  assert.equal(ok.status, 200);
  for (const attr of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/api', 'Max-Age=7200']) assert.ok(ok.setCookie.includes(attr), attr);
  assert.ok(!ok.setCookie.includes(ADMIN_PASSWORD), 'cookie parolayı içermemeli');
  assert.equal((await s.request('GET', '/api/admin')).status, 401);
  assert.equal((await s.request('GET', '/api/admin', { headers: { 'x-admin-key': ADMIN_PASSWORD } })).status, 401, 'eski başlık yöntemi kapalı');
  const data = await s.request('GET', '/api/admin', { cookie: ok.cookie });
  assert.equal(data.status, 200);
  assert.deepEqual(Object.keys(data.json.questions[0]).sort(), ['aciklama', 'aktif', 'dogru', 'id', 'ipucu', 'kategori', 'olusturma', 'soru', 'yanlisAciklamalar', 'yanlislar']);
  // Çıkış cookie'yi siler
  const out = await s.request('DELETE', '/api/admin/oturum', { cookie: ok.cookie });
  assert.match(out.headers.get('set-cookie'), /Max-Age=0/);
});

test('yönetici: değiştirilmiş, başka parolayla imzalanmış ya da süresi dolmuş cookie reddedilir', async () => {
  const { cookie } = await s.login(ADMIN_PASSWORD, freshIp());
  const tampered = cookie.replace(/v1\.(\d+)\./, (_, e) => `v1.${Number(e) + 1000}.`);
  const other = (await createSessionCookie('baska-bir-parola-123', Date.now())).split(';')[0];
  const expired = (await createSessionCookie(ADMIN_PASSWORD, Date.now() - 3 * 60 * 60 * 1000)).split(';')[0];
  for (const c of [tampered, other, expired, 'n5_admin=v1.1.2.3', 'n5_admin=']) {
    assert.equal((await s.request('GET', '/api/admin', { cookie: c })).status, 401, c.slice(0, 40));
  }
});

test('yönetici girişi hız sınırı: başarısız denemeler 429 + Retry-After; kilitte doğru parola da bekler', async () => {
  const p = await startStack({ vars: { ADMIN_LOGIN_MAX_FAILURES: 3 } });
  try {
    const ip = '192.0.2.10';
    for (let i = 0; i < 3; i++) assert.equal((await p.request('POST', '/api/admin/oturum', { body: { parola: `x${i}` }, ip })).status, 401);
    const locked = await p.request('POST', '/api/admin/oturum', { body: { parola: 'x' }, ip });
    assert.equal(locked.status, 429);
    assert.equal(locked.headers.get('retry-after'), '900');
    assert.equal((await p.request('POST', '/api/admin/oturum', { body: { parola: ADMIN_PASSWORD }, ip })).status, 429);
    // İstemcinin gönderdiği X-Forwarded-For sınırı atlatamaz; sayım Cloudflare'in CF-Connecting-IP'sine göre
    assert.equal((await p.request('POST', '/api/admin/oturum', { body: { parola: ADMIN_PASSWORD }, ip, headers: { 'x-forwarded-for': '9.9.9.9' } })).status, 429);
    assert.equal((await p.login(ADMIN_PASSWORD, '192.0.2.11')).status, 200, 'başka adres etkilenmez');
    // Başarılı giriş o adresin sayacını sıfırlar
    const ip2 = '192.0.2.12';
    for (let i = 0; i < 2; i++) await p.request('POST', '/api/admin/oturum', { body: { parola: 'y' }, ip: ip2 });
    assert.equal((await p.login(ADMIN_PASSWORD, ip2)).status, 200);
    for (let i = 0; i < 3; i++) assert.equal((await p.request('POST', '/api/admin/oturum', { body: { parola: 'y' }, ip: ip2 })).status, 401);
  } finally {
    await p.close();
  }
});

test('yönetici değişiklikleri Supabase\'de kalıcı; ayarlarda eski sürüm 409', async () => {
  const { cookie } = await s.login(ADMIN_PASSWORD, freshIp());
  const q = { ...seed[3], ipucu: 'Panelden güncellendi' };
  assert.equal((await s.request('PUT', `/api/sorular/${q.id}`, { body: q, cookie })).status, 200);
  assert.equal((await s.db.query('select ipucu from public.questions where id = $1', [q.id])).rows[0].ipucu, 'Panelden güncellendi');
  const added = await s.request('POST', '/api/sorular', { body: { ...seed[4], id: undefined, soru: 'Test sorusu?' }, cookie });
  assert.equal(added.status, 201);
  assert.equal((await s.request('DELETE', `/api/sorular/${added.json.id}`, { cookie })).status, 200);
  assert.equal((await s.request('DELETE', '/api/sorular/olmayan', { cookie })).status, 404);
  assert.equal((await s.request('POST', '/api/sorular', { body: { ...seed[4], ipucu: '' }, cookie })).json.error, 'İpucu boş olamaz.');

  const { settings } = (await s.request('GET', '/api/admin', { cookie })).json;
  const next = { questionsPerGame: 15, endOnWrong: true, secondsPerQuestion: 25, surum: settings.surum };
  const saved = await s.request('PUT', '/api/ayarlar', { body: next, cookie });
  assert.equal(saved.status, 200);
  assert.equal(saved.json.surum, settings.surum + 1);
  const stale = await s.request('PUT', '/api/ayarlar', { body: { ...next, secondsPerQuestion: 10 }, cookie });
  assert.equal(stale.status, 409);
  assert.match(stale.json.error, /başka bir oturumda/);
  assert.equal((await s.request('PUT', '/api/ayarlar', { body: { ...next, surum: undefined }, cookie })).status, 400);
  await s.request('PUT', '/api/ayarlar', { body: { ...next, secondsPerQuestion: 30, surum: saved.json.surum }, cookie });
});

// ---------- güvenlik başlıkları, CORS, CSRF, hatalar ----------

test('CSRF ve CORS: yabancı origin\'den durum değiştiren istek 403; CORS başlığı verilmez', async () => {
  const evil = { origin: 'https://kotu.example' };
  const { cookie } = await s.login(ADMIN_PASSWORD, freshIp());
  const r = await s.request('PUT', '/api/ayarlar', { body: { questionsPerGame: 1, endOnWrong: true, secondsPerQuestion: 5, surum: 1 }, cookie, headers: evil });
  assert.equal(r.status, 403);
  assert.equal((await s.request('POST', '/api/oyun/oturum', { headers: evil })).status, 403);
  assert.equal((await s.request('POST', '/api/admin/oturum', { body: { parola: ADMIN_PASSWORD }, headers: evil })).status, 403);
  const get = await s.request('GET', '/api/oyun', { headers: evil });
  assert.equal(get.status, 200);
  assert.equal(get.headers.get('access-control-allow-origin'), null);
  assert.equal((await s.request('POST', '/api/oyun/oturum', { headers: { origin: s.base } })).status, 201, 'aynı origin izinli');
  for (const h of ['x-content-type-options', 'cache-control', 'referrer-policy', 'x-frame-options']) assert.ok(get.headers.get(h), h);
});

test('ALLOWED_ORIGINS yalnızca açıkça listelenen origin\'e izin verir; * kabul edilmez', async () => {
  const p = await startStack({ vars: { ALLOWED_ORIGINS: 'https://oyun.example, *' } });
  try {
    assert.equal((await p.request('POST', '/api/oyun/oturum', { headers: { origin: 'https://oyun.example' } })).status, 201);
    assert.equal((await p.request('POST', '/api/oyun/oturum', { headers: { origin: 'https://baska.example' } })).status, 403);
  } finally {
    await p.close();
  }
});

test('bozuk URL ve JSON 400, bilinmeyen yol 404; beklenmeyen hata genel mesaj', async () => {
  assert.equal((await s.request('GET', '/api/%E0%A4%A')).status, 400);
  const badJson = await s.request('POST', '/api/oyun/oturum/00000000-0000-4000-8000-000000000000/cevap', { body: '{bozuk' });
  assert.equal(badJson.status, 400);
  assert.equal(badJson.json.error, 'İstek gövdesi geçerli bir JSON değil.');
  assert.equal((await s.request('GET', '/api/yok')).status, 404);
  assert.equal((await s.request('GET', '/index.html')).status, 404, 'Worker statik dosya sunmaz');
  assert.equal((await s.request('GET', '/data/varsayilan-sorular.json')).status, 404);
  s.db.failNext(2);
  const err = await s.request('GET', '/api/oyun');
  assert.equal(err.status, 500);
  assert.deepEqual(err.json, { error: 'Sunucu hatası. Lütfen biraz sonra tekrar deneyin.' });
  assert.equal(leaksInternals(err.text, s.db.url, s.db.serviceKey), null);
});

test('oyun başlatma hız sınırı: 429 ve Retry-After; diğer adresler etkilenmez', async () => {
  const p = await startStack({ vars: { GAME_START_MAX: 3 } });
  try {
    for (let i = 0; i < 3; i++) assert.equal((await p.request('POST', '/api/oyun/oturum', { ip: '192.0.2.50' })).status, 201);
    const r = await p.request('POST', '/api/oyun/oturum', { ip: '192.0.2.50' });
    assert.equal(r.status, 429);
    assert.equal(r.headers.get('retry-after'), '900');
    assert.equal((await p.request('POST', '/api/oyun/oturum', { ip: '192.0.2.51' })).status, 201);
  } finally {
    await p.close();
  }
});
