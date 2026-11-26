// Tek oyunculu oyun: açık API'de cevap anahtarı sızmaması, sunucu taraflı cevap doğrulama,
// jokerler ve istatistik yazımının korunması.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SEED_FILE, answerKey, correctChoice, fakeClock, startApi, tempDir, wrongChoice } from './helpers.mjs';

const seed = JSON.parse(await readFile(SEED_FILE, 'utf8'));
const readJson = async (p) => JSON.parse(await readFile(p, 'utf8'));
const LIMITS = (gameStart = { max: 1000, windowMs: 60_000 }) => ({
  adminLogin: { max: 10, windowMs: 60_000 },
  roomCreate: { max: 10, windowMs: 60_000 },
  gameStart,
});

async function withApi(t, opts = {}) {
  const tmp = await tempDir();
  const dataDir = join(tmp.dir, 'data');
  const api = await startApi({ dataDir, limits: LIMITS(), ...opts });
  t.after(async () => { await api.close(); await tmp.cleanup(); });
  assert.equal((await api.request('GET', '/api/oyun')).status, 200);
  return { ...api, dataDir, key: await answerKey(dataDir) };
}

const start = async (api) => {
  const r = await api.request('POST', '/api/oyun/oturum');
  assert.equal(r.status, 201);
  return r.json;
};
const answer = (api, g, body) => api.request('POST', `/api/oyun/oturum/${g.token}/cevap`, { body });
const joker = (api, g, body) => api.request('POST', `/api/oyun/oturum/${g.token}/joker`, { body });

/** Bir metinde cevap anahtarına ait bilgi var mı? (doğru şık işareti ya da açıklama metinleri) */
function findLeak(text) {
  for (const q of seed) {
    if (text.includes(q.aciklama)) return `açıklama: ${q.id}`;
    for (const w of q.yanlisAciklamalar) if (text.includes(w)) return `yanlış açıklaması: ${q.id}`;
    if (text.includes(q.ipucu)) return `ipucu: ${q.id}`;
  }
  for (const k of ['"dogru"', '"aciklama"', '"yanlisAciklamalar"', '"correct"', '"why"', '"dogruSik"', '"ipucu"', '"yanlislar"']) {
    if (text.includes(k)) return `alan ${k}`;
  }
  return null;
}

// ---------- açık API ----------

test('GET /api/oyun yalnızca ayarları ve soru sayısını döndürür', async (t) => {
  const api = await withApi(t);
  const r = await api.request('GET', '/api/oyun');
  assert.deepEqual(Object.keys(r.json).sort(), ['aktifSoru', 'ayarlar']);
  assert.deepEqual(Object.keys(r.json.ayarlar).sort(), ['endOnWrong', 'questionsPerGame', 'secondsPerQuestion']);
  assert.equal(findLeak(r.text), null);
});

test('oyun başlangıcı cevap anahtarını, açıklamaları ve bilinmeyen alanları göndermez', async (t) => {
  const api = await withApi(t);
  const r = await api.request('POST', '/api/oyun/oturum');
  assert.equal(r.status, 201);
  assert.equal(findLeak(r.text), null, `sızıntı: ${findLeak(r.text)}`);
  assert.deepEqual(Object.keys(r.json).sort(), ['ayarlar', 'olcu', 'sorular', 'token']);
  for (const q of r.json.sorular) {
    assert.deepEqual(Object.keys(q).sort(), ['kategori', 'secenekler', 'soru']);
    assert.equal(q.secenekler.length, 4);
  }
  // Şık sırası doğru şıkkı belli etmez: çok sayıda oyunda doğru şık her konumda görülür.
  const positions = new Set();
  for (let i = 0; i < 12; i++) {
    const g = (await api.request('POST', '/api/oyun/oturum')).json;
    for (const q of g.sorular) positions.add(correctChoice(api.key, q));
  }
  assert.deepEqual([...positions].sort(), [0, 1, 2, 3]);
  // Yazı ölçüsü için gelen metinler: açıklamalar okunamaz, şıklar hangi soruya ait olduğu belli olmayacak biçimde sıralı.
  const { olcu } = r.json;
  assert.ok(olcu.aciklamalar.length > 0);
  for (const s of olcu.aciklamalar) assert.match(s, /^[Nn\s\d\p{P}\p{S}]*$/u, `maskelenmemiş açıklama: ${s}`);
  const sorted = [...olcu.secenekler].sort((a, b) => a.localeCompare(b, 'tr'));
  assert.deepEqual(olcu.secenekler, sorted);
});

test('seed dosyası API üzerinden okunamaz; yönetici tam veriyi alır', async (t) => {
  const api = await withApi(t);
  assert.equal((await api.request('GET', '/api/admin')).status, 401);
  const admin = await api.request('GET', '/api/admin', { admin: true });
  assert.equal(admin.status, 200);
  const q = admin.json.questions[0];
  for (const k of ['dogru', 'yanlislar', 'aciklama', 'yanlisAciklamalar', 'ipucu']) assert.ok(k in q, `yönetici ${k} alanını almalı`);
});

// ---------- cevap doğrulama ----------

test('sunucu doğru ve yanlış cevabı ayırır; doğru şık yalnızca cevaptan sonra gelir', async (t) => {
  const api = await withApi(t);
  const g = await start(api);
  const right = await answer(api, g, { index: 0, secim: correctChoice(api.key, g.sorular[0]) });
  assert.equal(right.status, 200);
  assert.equal(right.json.sonuc, 'dogru');
  assert.equal(right.json.dogruSik, correctChoice(api.key, g.sorular[0]));
  assert.equal(right.json.aciklamalar.length, 4);
  assert.equal(right.json.aciklamalar[right.json.dogruSik], api.key.get(g.sorular[0].soru).aciklama);
  assert.equal(right.json.bitti, false);
  assert.equal(right.json.dogruSayisi, 1);
  // cevap yanıtı başka bir sorunun cevabını içermez
  assert.ok(!right.text.includes(api.key.get(g.sorular[1].soru).aciklama));

  const wrong = await answer(api, g, { index: 1, secim: wrongChoice(api.key, g.sorular[1]) });
  assert.equal(wrong.json.sonuc, 'yanlis');
  assert.equal(wrong.json.bitti, true, 'varsayılan kural: yanlışta oyun biter');
  assert.equal(wrong.json.dogruSik, correctChoice(api.key, g.sorular[1]));
});

test('geçersiz soru, şık, alan ve değerler reddedilir', async (t) => {
  const api = await withApi(t);
  const g = await start(api);
  const bad = [
    {}, { index: 0 }, { secim: 0 }, { index: -1, secim: 0 }, { index: 0, secim: -1 }, { index: 0, secim: 4 },
    { index: 0, secim: 1.5 }, { index: '0', secim: 0 }, { index: 0, secim: '1' }, { index: 0, secim: 1e309 },
    { index: 1e20, secim: 0 }, { index: 0, secim: null }, { index: 0, secim: [0] }, { index: 0, secim: 0, dogru: true },
    { index: 0, secim: 0, sureDoldu: true }, { index: 0, sureDoldu: 'evet' }, { index: g.sorular.length, secim: 0 },
  ];
  for (const body of bad) {
    const r = await answer(api, g, body);
    assert.equal(r.status, 400, `kabul edilmemeli: ${JSON.stringify(body)}`);
    assert.ok(r.json.error);
  }
  for (const raw of ['[]', '"x"', '123', 'null', '{"index": NaN, "secim": 0}']) {
    const r = await api.request('POST', `/api/oyun/oturum/${g.token}/cevap`, { body: raw });
    assert.equal(r.status, 400, `kabul edilmemeli: ${raw}`);
  }
  // sıradaki olmayan soru: geçersiz oyun durumu
  const ahead = await answer(api, g, { index: 1, secim: 0 });
  assert.equal(ahead.status, 409);
  // bilinmeyen ya da biçimsiz oturum
  for (const token of ['00000000-0000-4000-8000-000000000000', 'abc', '../admin']) {
    const r = await api.request('POST', `/api/oyun/oturum/${encodeURIComponent(token)}/cevap`, { body: { index: 0, secim: 0 } });
    assert.equal(r.status, 404, token);
  }
});

test('aynı cevabın yeniden gönderimi aynı sonucu döndürür; farklı cevap 409 alır', async (t) => {
  const api = await withApi(t);
  const g = await start(api);
  const c = correctChoice(api.key, g.sorular[0]);
  const first = await answer(api, g, { index: 0, secim: c });
  const again = await answer(api, g, { index: 0, secim: c });
  assert.equal(again.status, 200);
  assert.deepEqual(again.json.dogruSik, first.json.dogruSik);
  assert.equal(again.json.dogruSayisi, 1, 'doğru sayısı ikinci kez artmamalı');
  const other = await answer(api, g, { index: 0, secim: wrongChoice(api.key, g.sorular[0]) });
  assert.equal(other.status, 409);
});

test('süre dolması yanlış sayılır ve oyunu bitirir', async (t) => {
  const api = await withApi(t);
  const g = await start(api);
  const r = await answer(api, g, { index: 0, sureDoldu: true });
  assert.equal(r.json.sonuc, 'sure');
  assert.equal(r.json.bitti, true);
  assert.equal(r.json.dogruSik, correctChoice(api.key, g.sorular[0]));
});

// ---------- jokerler ----------

test('50:50 yalnızca yanlış şıkları eler ve bir kez kullanılabilir', async (t) => {
  const api = await withApi(t);
  const g = await start(api);
  const r = await joker(api, g, { index: 0, tur: 'fifty' });
  assert.equal(r.status, 200);
  assert.equal(r.json.elenen.length, 2);
  assert.ok(!r.json.elenen.includes(correctChoice(api.key, g.sorular[0])));
  assert.deepEqual((await joker(api, g, { index: 0, tur: 'fifty' })).json, r.json, 'yeniden gönderim aynı sonucu vermeli');
  const removedPick = await answer(api, g, { index: 0, secim: r.json.elenen[0] });
  assert.equal(removedPick.status, 400, 'elenen şık seçilemez');
  await answer(api, g, { index: 0, secim: correctChoice(api.key, g.sorular[0]) });
  assert.equal((await joker(api, g, { index: 1, tur: 'fifty' })).status, 409, 'ikinci kez kullanılamaz');
  assert.equal((await joker(api, g, { index: 1, tur: 'bilinmeyen' })).status, 400);
});

test('ipucu jokeri ipucunu yalnızca istendiğinde verir', async (t) => {
  const api = await withApi(t);
  const g = await start(api);
  const r = await joker(api, g, { index: 0, tur: 'hint' });
  assert.equal(r.json.ipucu, api.key.get(g.sorular[0].soru).ipucu);
});

test('çift cevap: ilk yanlış şık elenir, doğru şık açıklanmaz; ikinci cevap kesindir', async (t) => {
  const api = await withApi(t);
  const g = await start(api);
  assert.equal((await joker(api, g, { index: 0, tur: 'double' })).status, 200);
  const w = wrongChoice(api.key, g.sorular[0]);
  const first = await answer(api, g, { index: 0, secim: w });
  assert.equal(first.json.sonuc, 'tekrar');
  assert.equal(first.json.elenen, w);
  assert.ok(!('dogruSik' in first.json), 'doğru şık açıklanmamalı');
  assert.equal((await answer(api, g, { index: 0, secim: w })).json.sonuc, 'tekrar', 'yeniden gönderim aynı');
  const second = await answer(api, g, { index: 0, secim: wrongChoice(api.key, g.sorular[0], [w]) });
  assert.equal(second.json.sonuc, 'yanlis');
  assert.equal(second.json.bitti, true);
});

// ---------- istatistik koruması ----------

test('eski istatistik ucu kapalı: istemci toplam ya da sayaç yazamaz', async (t) => {
  const api = await withApi(t);
  const statsFile = join(api.dataDir, 'stats.json');
  for (const body of [
    { answers: [{ id: seed[0].id, correct: true }], finished: true },
    { games: 1e9, totalCorrect: -5 },
    '{"games": NaN}',
  ]) {
    const r = await api.request('POST', '/api/sonuc', { body });
    assert.equal(r.status, 410);
  }
  const stats = await readJson(statsFile).catch(() => null);
  assert.equal(stats, null, 'istatistik dosyası oluşmamalı');
});

test('istatistik yalnızca biten oyunlardan, bir kez ve doğrulanmış cevaplardan yazılır', async (t) => {
  const api = await withApi(t);
  const statsFile = join(api.dataDir, 'stats.json');
  const g = await start(api);
  const q0 = api.key.get(g.sorular[0].soru);
  await answer(api, g, { index: 0, secim: correctChoice(api.key, g.sorular[0]) });
  assert.equal(await readJson(statsFile).catch(() => null), null, 'oyun bitmeden yazılmamalı');
  const q1 = api.key.get(g.sorular[1].soru);
  const last = { index: 1, secim: wrongChoice(api.key, g.sorular[1]) };
  await answer(api, g, last);
  const expected = {
    games: 1, finished: 0, totalCorrect: 1,
    perQuestion: { [q0.id]: { asked: 1, correct: 1 }, [q1.id]: { asked: 1, correct: 0 } },
  };
  assert.deepEqual(await readJson(statsFile), expected);
  // aynı olayın yeniden gönderimi sayaçları değiştirmez
  for (let i = 0; i < 5; i++) assert.equal((await answer(api, g, last)).status, 200);
  assert.equal((await answer(api, g, { index: 0, secim: correctChoice(api.key, g.sorular[0]) })).status, 200);
  assert.deepEqual(await readJson(statsFile), expected);
  // bitmiş oyunda yeni cevap ve joker reddedilir
  assert.equal((await answer(api, g, { index: 2, secim: 0 })).status, 409);
  assert.equal((await joker(api, g, { index: 2, tur: 'fifty' })).status, 409);
});

test('tüm soruları bilen oyun "sonuna kadar oynandı" sayılır', async (t) => {
  const api = await withApi(t);
  await api.request('PUT', '/api/ayarlar', { admin: true, body: { questionsPerGame: 3, secondsPerQuestion: 30, endOnWrong: true } });
  const g = await start(api);
  assert.equal(g.sorular.length, 3);
  let r;
  for (let i = 0; i < 3; i++) r = await answer(api, g, { index: i, secim: correctChoice(api.key, g.sorular[i]) });
  assert.equal(r.json.bitti, true);
  assert.equal(r.json.dogruSayisi, 3);
  const stats = await readJson(join(api.dataDir, 'stats.json'));
  assert.equal(stats.games, 1);
  assert.equal(stats.finished, 1);
  assert.equal(stats.totalCorrect, 3);
});

test('oyun başlatma hız sınırı: aşılınca 429 ve Retry-After, pencere dolunca açılır', async (t) => {
  const now = fakeClock();
  const api = await withApi(t, { now, limits: LIMITS({ max: 3, windowMs: 60_000 }) });
  for (let i = 0; i < 3; i++) assert.equal((await api.request('POST', '/api/oyun/oturum')).status, 201);
  const limited = await api.request('POST', '/api/oyun/oturum');
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('retry-after'), '60');
  assert.ok(limited.json.error);
  now.advance(60_001);
  assert.equal((await api.request('POST', '/api/oyun/oturum')).status, 201);
});

test('oturum süresi dolunca cevap 404 alır', async (t) => {
  const now = fakeClock();
  const api = await withApi(t, { now });
  const g = await start(api);
  now.advance(2 * 60 * 60 * 1000 + 1);
  assert.equal((await answer(api, g, { index: 0, secim: 0 })).status, 404);
});
