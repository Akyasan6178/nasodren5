// Çok oyunculu güvenlik: gerçek HTTP + SSE bağlantılarıyla erken sızıntı ve hız sınırı testleri.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { answerKey, fakeClock, openStream, startApi, tempDir } from './helpers.mjs';

const LIMITS = (roomCreate = { max: 1000, windowMs: 60_000 }) => ({
  adminLogin: { max: 10, windowMs: 60_000 },
  roomCreate,
  gameStart: { max: 1000, windowMs: 60_000 },
});

async function withApi(t, opts = {}) {
  const tmp = await tempDir();
  const dataDir = join(tmp.dir, 'data');
  const api = await startApi({ dataDir, limits: LIMITS(), liveTiming: { readyMs: 50 }, ...opts });
  const streams = [];
  t.after(async () => { for (const s of streams) s.close(); await api.close(); await tmp.cleanup(); });
  assert.equal((await api.request('GET', '/api/oyun')).status, 200);
  return { ...api, dataDir, key: await answerKey(dataDir), track: (s) => (streams.push(s), s) };
}

test('soru açıkken cevaplar, puanlar ve doğru şık hiçbir ekrana sızmaz', async (t) => {
  const api = await withApi(t);
  const room = (await api.request('POST', '/api/canli/oda')).json;
  const host = api.track(await openStream(`${api.base}/api/canli/oda/${room.code}/akis?host=${room.hostToken}`));
  await host.next((v) => v.phase === 'lobi');

  const players = [];
  for (const name of ['Ayşe', 'Mehmet', 'Zeynep', 'Kerem']) {
    const j = await api.request('POST', `/api/canli/oda/${room.code}/katil`, { body: { name } });
    assert.equal(j.status, 201);
    const stream = api.track(await openStream(`${api.base}/api/canli/oda/${room.code}/akis?oyuncu=${j.json.token}`));
    players.push({ name, ...j.json, stream });
    await stream.next((v) => v.phase === 'lobi');
  }

  const startCmd = await api.request('POST', `/api/canli/oda/${room.code}/komut`, { body: { hostToken: room.hostToken, type: 'basla', count: 2, seconds: 30 } });
  assert.equal(startCmd.status, 200);
  const open = await host.next((v) => v.phase === 'soru' && v.index === 0);
  const q = api.key.get(open.question.soru);
  const right = open.question.choices.indexOf(q.dogru);
  const wrong = open.question.choices.findIndex((c) => c !== q.dogru);
  const hostBefore = host.messages.length;
  const playerBefore = players.map((p) => p.stream.messages.length);

  // Üç oyuncu cevaplar (ikisi doğru, biri yanlış); dördüncü henüz cevaplamadı → soru hâlâ açık.
  for (const [p, choice] of [[players[0], right], [players[1], wrong], [players[2], right]]) {
    const r = await api.request('POST', `/api/canli/oda/${room.code}/cevap`, { body: { token: p.token, choice } });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json, { ok: true }, 'cevap yanıtı doğru/yanlış bilgisi içermemeli');
  }
  await host.next((v) => v.phase === 'soru' && v.answered === 3);

  const during = (msgs) => msgs.filter((v) => v.phase === 'soru' || v.phase === 'hazir');
  const hostDuring = during(host.messages.slice(hostBefore));
  assert.ok(hostDuring.length > 0);
  for (const v of hostDuring) {
    assert.equal(v.question.correct, undefined, 'doğru şık açıklanmamalı');
    assert.equal(v.question.why, undefined);
    assert.equal(v.question.whys, undefined);
    assert.equal(v.question.counts, undefined, 'cevap dağılımı açıklanmamalı');
    for (const p of v.players) {
      assert.equal(p.score, 0, `${p.name} puanı erken değişti`);
      assert.equal(p.gained, 0, `${p.name} kazancı erken göründü`);
      assert.equal(p.streak, 0, `${p.name} serisi erken değişti`);
    }
  }
  for (const [i, p] of players.entries()) {
    for (const v of during(p.stream.messages.slice(playerBefore[i]))) {
      assert.equal(v.question.correct, undefined);
      assert.equal(v.question.whys, undefined);
      assert.equal(v.me.score, 0);
      assert.equal(v.me.streak, 0);
      assert.deepEqual(Object.keys(v.answer ?? {}).filter((k) => k !== 'choice'), [], 'cevap yalnızca seçilen şıkkı içermeli');
      // Bir oyuncunun cevabı başka bir oyuncuya gönderilmez
      if (v.answer) assert.equal(v.answer.choice, [right, wrong, right][i]);
    }
  }
  assert.ok(!JSON.stringify(hostDuring).includes(q.aciklama), 'açıklama erken gönderildi');

  // Son oyuncu da cevaplayınca sonuç açıklanır: doğru şık, açıklamalar ve puanlar gelir.
  await api.request('POST', `/api/canli/oda/${room.code}/cevap`, { body: { token: players[3].token, choice: wrong } });
  const result = await host.next((v) => v.phase === 'sonuc' && v.index === 0);
  assert.equal(result.question.correct, right);
  assert.deepEqual(result.question.counts.reduce((a, b) => a + b, 0), 4);
  const scores = Object.fromEntries(result.players.map((p) => [p.name, p.score]));
  assert.ok(scores.Ayşe >= 500 && scores.Zeynep >= 500);
  assert.equal(scores.Mehmet, 0);
  assert.equal(scores.Kerem, 0);
  const ayse = await players[0].stream.next((v) => v.phase === 'sonuc');
  assert.equal(ayse.answer.correct, true);
  assert.ok(ayse.me.score >= 500);

  // Tablo → ikinci soru: puanlar yine soru boyunca sabit kalır (önceki puanlar görünür).
  await api.request('POST', `/api/canli/oda/${room.code}/komut`, { body: { hostToken: room.hostToken, type: 'sonraki' } });
  const open2 = await host.next((v) => v.phase === 'soru' && v.index === 1);
  const q2 = api.key.get(open2.question.soru);
  await api.request('POST', `/api/canli/oda/${room.code}/cevap`, { body: { token: players[1].token, choice: open2.question.choices.indexOf(q2.dogru) } });
  const mid = await host.next((v) => v.phase === 'soru' && v.index === 1 && v.answered === 1);
  assert.equal(mid.players.find((p) => p.name === 'Mehmet').score, 0, 'ikinci sorudaki doğru cevap erken görünmemeli');
  assert.equal(mid.question.correct, undefined);

  // Süreyi bitir → son soru → kürsü
  await api.request('POST', `/api/canli/oda/${room.code}/komut`, { body: { hostToken: room.hostToken, type: 'bitir-sure' } });
  const res2 = await host.next((v) => v.phase === 'sonuc' && v.index === 1);
  assert.ok(res2.players.find((p) => p.name === 'Mehmet').score >= 500);
  await api.request('POST', `/api/canli/oda/${room.code}/komut`, { body: { hostToken: room.hostToken, type: 'sonraki' } });
  const final = await players[0].stream.next((v) => v.phase === 'bitti');
  assert.equal(final.podium.length, 3);
});

test('yetkisiz host komutu ve sahte oyuncu cevabı reddedilir', async (t) => {
  const api = await withApi(t);
  const room = (await api.request('POST', '/api/canli/oda')).json;
  assert.equal((await api.request('POST', `/api/canli/oda/${room.code}/komut`, { body: { hostToken: 'sahte', type: 'basla' } })).status, 403);
  assert.equal((await api.request('POST', `/api/canli/oda/${room.code}/cevap`, { body: { token: 'sahte', choice: 0 } })).status, 403);
});

test('oda açma hız sınırı 429 döndürür; sınırın altındaki odalar normal açılır', async (t) => {
  const now = fakeClock();
  const api = await withApi(t, { now, limits: LIMITS({ max: 3, windowMs: 120_000 }) });
  for (let i = 0; i < 3; i++) assert.equal((await api.request('POST', '/api/canli/oda')).status, 201);
  const limited = await api.request('POST', '/api/canli/oda');
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('retry-after'), '120');
  assert.match(limited.json.error, /Çok fazla istek/);
  now.advance(120_001);
  assert.equal((await api.request('POST', '/api/canli/oda')).status, 201);
});

test('hız sınırı ile "çok fazla oda" sınırı çakışmaz: kapasite dolunca 503, mesaj korunur', async (t) => {
  const api = await withApi(t);
  for (let i = 0; i < 200; i++) assert.equal((await api.request('POST', '/api/canli/oda')).status, 201);
  const full = await api.request('POST', '/api/canli/oda');
  assert.equal(full.status, 503);
  assert.equal(full.json.error, 'Şu anda çok fazla açık oda var, biraz sonra deneyin.');
});
