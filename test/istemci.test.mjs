// İstemci veri katmanı (src/shared/store-core.ts): sunucu modunda API hatalarında yerel veriye
// sessizce düşülmemesi ve yerel veriye yazılmaması; açıkça seçilmiş yerel modun çalışması.
// Node'un yerleşik TypeScript tip silme desteğiyle çalışır (npm test bunu etkinleştirir).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ApiError, MESSAGES, createStore, resolveMode } from '../src/shared/store-core.ts';
import { SEED_FILE } from './helpers.mjs';

const seed = JSON.parse(await readFile(SEED_FILE, 'utf8'));

/** Her çağrıyı kaydeden sahte depolama. */
function spyStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  const writes = [];
  return {
    writes,
    data,
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { writes.push(k); data.set(k, v); },
    removeItem: (k) => { writes.push(`-${k}`); data.delete(k); },
  };
}

const jsonResponse = (status, body, type = 'application/json; charset=utf-8') => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (n) => (n.toLowerCase() === 'content-type' ? type : null) },
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});

/** Sırayla verilen davranışları uygulayan sahte fetch; çağrılan adresleri kaydeder. */
function fakeFetch(...behaviors) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? 'GET', headers: init.headers ?? {}, credentials: init.credentials, body: init.body });
    const b = behaviors.length > 1 ? behaviors.shift() : behaviors[0];
    return b(url, init);
  };
  fn.calls = calls;
  return fn;
}

const serverStore = (fetch, extra = {}) => {
  const storage = spyStorage();
  const store = createStore({ mode: 'sunucu', fetch, storage, seedUrl: '/data/varsayilan-sorular.json', timeoutMs: 50, ...extra });
  return { store, storage };
};

const startOk = () => jsonResponse(201, {
  token: '00000000-0000-4000-8000-000000000000',
  ayarlar: { questionsPerGame: 1, endOnWrong: true, secondsPerQuestion: 30 },
  sorular: [{ soru: 'S?', kategori: 'K', secenekler: ['a', 'b', 'c', 'd'] }],
  olcu: { sorular: ['S?'], secenekler: ['a', 'b', 'c', 'd'], aciklamalar: ['Nnn'] },
});

test('mod yalnızca açıkça "yerel" seçilirse yereldir', () => {
  assert.equal(resolveMode('yerel'), 'yerel');
  for (const v of [undefined, '', 'sunucu', 'local', 'YEREL', true, 1]) assert.equal(resolveMode(v), 'sunucu');
});

test('API 500 döndürdüğünde yerel moda geçilmez ve yerel veri okunup yazılmaz', async () => {
  const fetch = fakeFetch(() => jsonResponse(500, { error: 'Sunucu hatası. Lütfen biraz sonra tekrar deneyin.' }));
  const { store, storage } = serverStore(fetch);
  await assert.rejects(store.startGame(), (e) => e instanceof ApiError && e.kind === 'server' && e.status === 500);
  await assert.rejects(store.loadAdmin(), (e) => e.kind === 'server');
  assert.equal(await store.detectMode(), 'sunucu', 'hata sonrası mod değişmez');
  assert.deepEqual(storage.writes, []);
  assert.ok(fetch.calls.every((c) => c.url.startsWith('/api/')), 'seed dosyası ya da yerel kaynak istenmemeli');
});

test('ağ hatasında işlem başarılı gösterilmez; yönetici değişikliği yerel depoya yazılmaz', async () => {
  const fetch = fakeFetch(() => { throw new TypeError('Failed to fetch'); });
  const { store, storage } = serverStore(fetch);
  const q = { ...seed[0] };
  for (const op of [
    () => store.saveQuestion(q),
    () => store.saveQuestion({ ...q, id: undefined }),
    () => store.deleteQuestion(q.id),
    () => store.replaceAll(seed),
    () => store.saveSettings({ questionsPerGame: 5, endOnWrong: true, secondsPerQuestion: 20 }),
    () => store.resetStats(),
    () => store.startGame(),
  ]) {
    await assert.rejects(op(), (e) => e instanceof ApiError && e.kind === 'network' && e.message === MESSAGES.network);
  }
  assert.deepEqual(storage.writes, [], 'sunucu modunda yerel depoya hiçbir şey yazılmamalı');
});

test('zaman aşımı, bozuk JSON ve JSON olmayan yanıt ayrı ve genel hatalarla bildirilir', async () => {
  const hang = fakeFetch((_u, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')))));
  await assert.rejects(serverStore(hang).store.startGame(), (e) => e.kind === 'timeout' && e.message === MESSAGES.timeout);

  const broken = fakeFetch(() => jsonResponse(200, '{bozuk'));
  await assert.rejects(serverStore(broken).store.loadAdmin(), (e) => e.kind === 'invalid');

  // Statik barındırmadaki HTML sayfası gibi JSON olmayan yanıt
  const html = fakeFetch(() => jsonResponse(200, '<!doctype html>', 'text/html'));
  const { store, storage } = serverStore(html);
  await assert.rejects(store.startGame(), (e) => e.kind === 'invalid');
  assert.deepEqual(storage.writes, []);

  // 5xx gövdesi bozuksa genel sunucu mesajı
  await assert.rejects(serverStore(fakeFetch(() => jsonResponse(502, 'Bad Gateway', 'text/plain'))).store.startGame(),
    (e) => e.kind === 'server' && e.message === MESSAGES.server);
});

test('4xx mesajları korunur (ör. 429 hız sınırı, 401)', async () => {
  const fetch = fakeFetch(
    () => jsonResponse(429, { error: 'Çok fazla istek gönderildi. Lütfen biraz bekleyip tekrar deneyin.' }),
    () => jsonResponse(401, { error: 'Şifre hatalı.' }),
  );
  const { store } = serverStore(fetch);
  await assert.rejects(store.startGame(), (e) => e.status === 429 && /Çok fazla istek/.test(e.message));
  await assert.rejects(store.loadAdmin(), (e) => e.status === 401 && e.message === 'Şifre hatalı.');
});

test('yeniden deneme başarılı olunca sunucu modu normal devam eder', async () => {
  let fail = true;
  const fetch = fakeFetch((url) => {
    if (fail) throw new TypeError('Failed to fetch');
    if (url.endsWith('/cevap')) return jsonResponse(200, { sonuc: 'dogru', dogruSik: 2, aciklamalar: ['a', 'b', 'c', 'd'], bitti: true, dogruSayisi: 1 });
    return startOk();
  });
  const { store, storage } = serverStore(fetch);
  await assert.rejects(store.startGame());
  fail = false;
  const game = await store.startGame();
  assert.equal(game.sorular.length, 1);
  const verdict = await game.judge.answer(0, 2);
  assert.equal(verdict.sonuc, 'dogru');
  assert.ok(fetch.calls.at(-1).url.startsWith('/api/oyun/oturum/00000000-0000-4000-8000-000000000000/cevap'));
  assert.deepEqual(storage.writes, []);
});

test('yönetici girişi: parola yalnızca giriş isteğinde gider, hiçbir tarayıcı deposuna yazılmaz; istekler cookie ile', async () => {
  const fetch = fakeFetch(() => jsonResponse(200, { ok: true, questions: [], settings: {}, stats: {} }));
  const { store, storage } = serverStore(fetch);
  await store.login('gizli-parola-123');
  await store.loadAdmin();
  await store.logout();
  assert.deepEqual(fetch.calls.map((c) => `${c.method} ${c.url}`), ['POST /api/admin/oturum', 'GET /api/admin', 'DELETE /api/admin/oturum']);
  assert.equal(JSON.parse(fetch.calls[0].body).parola, 'gizli-parola-123');
  for (const c of fetch.calls) {
    assert.equal(c.credentials, 'same-origin', 'HttpOnly oturum çerezi aynı origin isteklerinde gider');
    assert.equal(c.headers['x-admin-key'], undefined, 'parola başlıkta taşınmaz');
  }
  assert.ok(!JSON.stringify(fetch.calls.slice(1)).includes('gizli-parola-123'), 'parola sonraki isteklerde yok');
  assert.deepEqual(storage.writes, []);
});

test('ayar kaydında okunan sürüm gönderilir; 409 hatası kullanıcıya iletilir', async () => {
  const fetch = fakeFetch(() => jsonResponse(409, { error: 'Ayarlar başka bir oturumda değiştirildi. Güncel ayarlar yüklendi; tekrar kaydedin.' }));
  const { store } = serverStore(fetch);
  await assert.rejects(store.saveSettings({ questionsPerGame: 5, endOnWrong: true, secondsPerQuestion: 20, surum: 3 }), (e) => e.status === 409 && /başka bir oturumda/.test(e.message));
  assert.equal(JSON.parse(fetch.calls[0].body).surum, 3);
});

test('açıkça seçilmiş yerel mod: seed yüklenir, oyun oynanır, yönetici değişikliği yerel depoya yazılır', async () => {
  const fetch = fakeFetch((url) => {
    assert.equal(url, '/data/varsayilan-sorular.json', 'yerel mod API çağırmaz');
    return jsonResponse(200, seed);
  });
  const storage = spyStorage();
  let i = 0;
  const store = createStore({ mode: 'yerel', fetch, storage, seedUrl: '/data/varsayilan-sorular.json', rng: () => ((i++ * 0.37) % 1) });
  const game = await store.startGame();
  assert.equal(game.sorular.length, 15);
  const first = seed.find((q) => q.soru === game.sorular[0].soru);
  const right = game.sorular[0].secenekler.indexOf(first.dogru);
  const v = await game.judge.answer(0, right);
  assert.equal(v.sonuc, 'dogru');
  assert.equal(v.dogruSik, right);
  assert.ok(storage.writes.includes('siklamen.sorular'));

  await store.saveSettings({ questionsPerGame: 3, endOnWrong: false, secondsPerQuestion: 0 });
  assert.ok(storage.writes.includes('siklamen.ayarlar'));
  assert.ok(fetch.calls.every((c) => !c.url.startsWith('/api/')));
});
