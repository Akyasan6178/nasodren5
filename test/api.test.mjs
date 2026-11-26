// API entegrasyon testleri: başlatma, eşzamanlı yazma, güvenli hata yanıtları.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, copyFile, stat, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { SEED_FILE, leaksInternals, startApi, tempDir } from './helpers.mjs';

const seed = JSON.parse(await readFile(SEED_FILE, 'utf8'));
const exists = (p) => stat(p).then(() => true, () => false);
const readJson = async (p) => JSON.parse(await readFile(p, 'utf8'));

const validQuestion = (n) => ({
  soru: `Test sorusu ${n}?`,
  dogru: `Doğru ${n}`,
  yanlislar: [`Yanlış A ${n}`, `Yanlış B ${n}`, `Yanlış C ${n}`],
  kategori: 'Test',
  ipucu: 'İpucu',
  aciklama: 'Açıklama',
  yanlisAciklamalar: ['a', 'b', 'c'],
});

/** Geçici dizin + sunucu kurar, testten sonra temizler. */
async function withApi(t, setup = async () => ({})) {
  const tmp = await tempDir();
  const dataDir = join(tmp.dir, 'data');
  const extra = await setup(tmp.dir, dataDir);
  const api = await startApi({ dataDir, ...extra });
  t.after(async () => { await api.close(); await tmp.cleanup(); });
  return { ...api, dataDir, tmpDir: tmp.dir, ...extra };
}

// ---------- başlatma ----------

test('taze kurulum: soru dosyası seed\'den oluşturulur ve oyun soruları döner', async (t) => {
  const api = await withApi(t);
  const r = await api.request('GET', '/api/oyun');
  assert.equal(r.status, 200);
  assert.equal(r.json.questions.length, seed.filter((q) => q.aktif !== false).length);
  assert.deepEqual(r.json.questions.map((q) => q.id), seed.map((q) => q.id));
  assert.deepEqual(await readJson(join(api.dataDir, 'questions.json')), seed);

  const admin = await api.request('GET', '/api/admin', { admin: true });
  assert.equal(admin.status, 200);
  assert.equal(admin.json.questions.length, seed.length);
});

test('başarılı başlatma bir kez yapılır; mevcut veri yeniden seed\'lenmez', async (t) => {
  const api = await withApi(t, async (dir) => {
    const seedFile = join(dir, 'seed.json');
    await copyFile(SEED_FILE, seedFile);
    return { seedFile };
  });
  assert.equal((await api.request('GET', '/api/oyun')).status, 200);
  const file = join(api.dataDir, 'questions.json');
  const before = (await stat(file)).mtimeMs;
  await rm(api.seedFile); // seed kaybolsa bile çalışan süreç etkilenmemeli
  for (let i = 0; i < 3; i++) assert.equal((await api.request('GET', '/api/oyun')).status, 200);
  assert.equal((await stat(file)).mtimeMs, before, 'soru dosyası yeniden yazıldı');
});

test('seed yoksa başlatma güvenli hata verir, önbellekte kalmaz ve dosya gelince düzelir', async (t) => {
  const api = await withApi(t, async (dir) => ({ seedFile: join(dir, 'yok', 'seed.json') }));
  const first = await api.request('GET', '/api/oyun');
  assert.equal(first.status, 500);
  assert.equal(leaksInternals(first.text, api.tmpDir, api.seedFile), null, `iç ayrıntı sızdı: ${first.text}`);
  assert.ok(first.json?.error, 'genel bir hata mesajı olmalı');
  assert.ok(api.logs.some((l) => String(l.at(-1)?.message ?? l).includes('seed.json')), 'ayrıntı sunucu günlüğüne yazılmalı');
  assert.equal(await exists(join(api.dataDir, 'questions.json')), false, 'boş soru dosyası oluşturulmamalı');

  // Sunucu yeniden başlatılmadan düzelir
  await mkdir(join(api.tmpDir, 'yok'), { recursive: true });
  await copyFile(SEED_FILE, api.seedFile);
  const second = await api.request('GET', '/api/oyun');
  assert.equal(second.status, 200);
  assert.equal(second.json.questions.length, seed.length);
});

test('bozuk seed JSON: hata verir, soru dosyası oluşturulmaz', async (t) => {
  const api = await withApi(t, async (dir) => {
    const seedFile = join(dir, 'seed.json');
    await writeFile(seedFile, '[{"id": "bozuk"');
    return { seedFile };
  });
  const r = await api.request('GET', '/api/oyun');
  assert.equal(r.status, 500);
  assert.equal(leaksInternals(r.text, api.tmpDir), null, `iç ayrıntı sızdı: ${r.text}`);
  assert.equal(await exists(join(api.dataDir, 'questions.json')), false);
});

test('bozuk soru dosyası: boş veriyle değiştirilmez, yazma işlemleri dosyayı ezmez', async (t) => {
  const corrupt = '[{"id": "gercek-veri", "soru": "yarım kalmış';
  const api = await withApi(t, async (_dir, dataDir) => {
    await mkdir(dataDir, { recursive: true });
    await writeFile(join(dataDir, 'questions.json'), corrupt);
    return {};
  });
  const file = join(api.dataDir, 'questions.json');
  const get = await api.request('GET', '/api/oyun');
  assert.equal(get.status, 500);
  assert.equal(leaksInternals(get.text, api.tmpDir), null);
  const post = await api.request('POST', '/api/sorular', { admin: true, body: validQuestion(1) });
  assert.equal(post.status, 500);
  assert.equal(await readFile(file, 'utf8'), corrupt, 'bozuk dosya üzerine yazıldı');
  assert.ok(api.logs.length > 0, 'hata sunucu günlüğüne yazılmalı');
});

// ---------- eşzamanlı yazma ----------

test('30 paralel sonuç isteğinin tamamı istatistiğe yansır', async (t) => {
  const api = await withApi(t);
  const statsFile = join(api.dataDir, 'stats.json');
  assert.equal((await api.request('GET', '/api/oyun')).status, 200);
  const ids = seed.slice(0, 3).map((q) => q.id);
  const N = 30;
  const results = await Promise.all(Array.from({ length: N }, (_, i) =>
    api.request('POST', '/api/sonuc', {
      body: { finished: i % 2 === 0, answers: [{ id: ids[0], correct: true }, { id: ids[1], correct: i % 3 === 0 }, { id: ids[2], correct: false }] },
    })));
  const ok = results.filter((r) => r.status === 200).length;
  assert.equal(ok, N, 'tüm istekler başarılı olmalı');
  const stats = await readJson(statsFile); // geçerli JSON olmalı
  assert.equal(stats.games, N);
  assert.equal(stats.finished, N / 2);
  assert.deepEqual(stats.perQuestion[ids[0]], { asked: N, correct: N });
  assert.deepEqual(stats.perQuestion[ids[1]], { asked: N, correct: 10 });
  assert.deepEqual(stats.perQuestion[ids[2]], { asked: N, correct: 0 });
  assert.equal(stats.totalCorrect, N + 10);
  assert.equal(await exists(`${statsFile}.tmp`), false, 'geçici dosya kalmamalı');
});

test('soru, ayar ve istatistik yazmaları karışık ve paralel çalışınca veri kaybolmaz', async (t) => {
  const api = await withApi(t);
  assert.equal((await api.request('GET', '/api/oyun')).status, 200);
  const jobs = [];
  for (let i = 0; i < 20; i++) jobs.push(api.request('POST', '/api/sorular', { admin: true, body: validQuestion(i) }));
  for (let i = 0; i < 10; i++) jobs.push(api.request('PUT', '/api/ayarlar', { admin: true, body: { questionsPerGame: 10 + i, secondsPerQuestion: 20, endOnWrong: true } }));
  for (let i = 0; i < 10; i++) jobs.push(api.request('POST', '/api/sonuc', { body: { finished: true, answers: [] } }));
  // Var olan bir soruyu da aynı anda düzenle
  const target = seed[0];
  jobs.push(api.request('PUT', `/api/sorular/${target.id}`, { admin: true, body: { ...target, ipucu: 'Güncellenmiş ipucu' } }));
  const results = await Promise.all(jobs);
  assert.ok(results.every((r) => r.status < 300), `başarısız istek: ${results.filter((r) => r.status >= 300).map((r) => r.text)}`);

  const questions = await readJson(join(api.dataDir, 'questions.json'));
  assert.equal(questions.length, seed.length + 20);
  for (let i = 0; i < 20; i++) assert.ok(questions.some((q) => q.soru === `Test sorusu ${i}?`), `soru ${i} kayboldu`);
  assert.equal(questions.find((q) => q.id === target.id).ipucu, 'Güncellenmiş ipucu');
  const settings = await readJson(join(api.dataDir, 'settings.json'));
  assert.ok(settings.questionsPerGame >= 10 && settings.questionsPerGame <= 19);
  assert.equal((await readJson(join(api.dataDir, 'stats.json'))).games, 10);
});

test('başarısız bir işlem kuyruğu kilitlemez', async (t) => {
  const api = await withApi(t);
  assert.equal((await api.request('GET', '/api/oyun')).status, 200);
  const [missing, invalid, created] = await Promise.all([
    api.request('PUT', '/api/sorular/olmayan-id', { admin: true, body: validQuestion(1) }),
    api.request('PUT', `/api/sorular/${seed[0].id}`, { admin: true, body: { soru: '' } }),
    api.request('POST', '/api/sorular', { admin: true, body: validQuestion(2) }),
  ]);
  assert.equal(missing.status, 404);
  assert.equal(missing.json.error, 'Soru bulunamadı.');
  assert.equal(invalid.status, 400);
  assert.equal(created.status, 201);
  const del = await api.request('DELETE', `/api/sorular/${created.json.id}`, { admin: true });
  assert.equal(del.status, 200);
  assert.equal((await readJson(join(api.dataDir, 'questions.json'))).length, seed.length);
});

// ---------- güvenli hata yanıtları ----------

test('geçersiz JSON gövdesi 400 ve kullanıcıya yönelik mesaj döner', async (t) => {
  const api = await withApi(t);
  const r = await api.request('POST', '/api/sonuc', { body: '{bozuk' });
  assert.equal(r.status, 400);
  assert.equal(r.json.error, 'İstek gövdesi geçerli bir JSON değil.');
  assert.equal(leaksInternals(r.text, api.tmpDir), null);
});

test('doğrulama hataları açıklayıcı kalır, yetki hatası 401 döner', async (t) => {
  const api = await withApi(t);
  const bad = await api.request('POST', '/api/sorular', { admin: true, body: { ...validQuestion(1), ipucu: '' } });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.error, 'İpucu boş olamaz.');
  const unauth = await api.request('GET', '/api/admin');
  assert.equal(unauth.status, 401);
});

test('çok oyunculu oda seed ile açılır', async (t) => {
  const api = await withApi(t);
  const r = await api.request('POST', '/api/canli/oda');
  assert.equal(r.status, 201);
  assert.match(r.json.code, /^\d{6}$/);
});
