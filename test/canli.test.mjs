// Çok oyunculu: gerçek SSE bağlantılarıyla (Worker → oda Durable Object'i) erken sızıntı, PIN deneme
// koruması, hız sınırları, yeniden bağlanma, oda temizliği ve yeniden başlatma testleri.
// Testler zamanlamaya değil, beklenen olay sırasına göre ilerler (her adımda ilgili mesaj beklenir).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startStack } from './support/stack.mjs';
import { answerKey, openStream } from './helpers.mjs';
import { startSupabaseEmulator } from '../scripts/lib/supabase-emulator.mjs';

const key = answerKey();
let s;
let ipSeq = 0;
const freshIp = () => `198.18.0.${++ipSeq}`;
const streams = [];

before(async () => { s = await startStack({ vars: { ROOM_CREATE_MAX: 1000, JOIN_MAX: 1000, STREAM_MAX: 10000, ACTION_MAX: 100000 } }); });
after(async () => { for (const x of streams) x.close(); await s?.close(); });

const stream = async (stack, path, ip) => {
  const st = await openStream(stack.base + path, { 'cf-connecting-ip': ip ?? freshIp() });
  streams.push(st);
  return st;
};
async function newRoom(stack = s, ip = freshIp()) {
  const r = await stack.request('POST', '/api/canli/oda', { ip });
  assert.equal(r.status, 201, r.text);
  return r.json;
}
async function joinPlayer(stack, code, name, ip = freshIp()) {
  const j = await stack.request('POST', `/api/canli/oda/${code}/katil`, { body: { name }, ip });
  assert.equal(j.status, 201, j.text);
  const st = await stream(stack, `/api/canli/oda/${code}/akis?oyuncu=${j.json.token}`, ip);
  await st.next((v) => v.phase === 'lobi');
  return { name, ...j.json, stream: st, ip };
}
const cmd = (stack, room, body) => stack.request('POST', `/api/canli/oda/${room.code}/komut`, { body: { hostToken: room.hostToken, ...body } });

test('1 host + 4 oyuncu: soru açıkken puan, seri ve doğru şık hiçbir ekrana sızmaz', async () => {
  const room = await newRoom();
  const host = await stream(s, `/api/canli/oda/${room.code}/akis?host=${room.hostToken}`);
  await host.next((v) => v.phase === 'lobi');
  const players = [];
  for (const name of ['Ayşe', 'Mehmet', 'Zeynep', 'Kerem']) players.push(await joinPlayer(s, room.code, name));
  await host.next((v) => v.phase === 'lobi' && v.players.length === 4 && v.players.every((p) => p.online));

  assert.equal((await cmd(s, room, { type: 'basla', count: 2, seconds: 30 })).status, 200);
  const open = await host.next((v) => v.phase === 'soru' && v.index === 0);
  const q = key.get(open.question.soru);
  const right = open.question.choices.indexOf(q.dogru);
  const wrong = open.question.choices.findIndex((c) => c !== q.dogru);
  const hostBefore = host.messages.length;
  const playerBefore = players.map((p) => p.stream.messages.length);

  // Üç oyuncu aynı anda cevaplar (ikisi doğru, biri yanlış); dördüncü henüz cevaplamadı → soru açık.
  const res = await Promise.all([[players[0], right], [players[1], wrong], [players[2], right]].map(([p, choice]) =>
    s.request('POST', `/api/canli/oda/${room.code}/cevap`, { body: { token: p.token, choice }, ip: p.ip })));
  for (const r of res) { assert.equal(r.status, 200); assert.deepEqual(r.json, { ok: true }); }
  await host.next((v) => v.phase === 'soru' && v.answered === 3);

  const during = (msgs) => msgs.filter((v) => v.phase === 'soru' || v.phase === 'hazir');
  const hostDuring = during(host.messages.slice(hostBefore));
  assert.ok(hostDuring.length > 0);
  for (const v of hostDuring) {
    assert.equal(v.question.correct, undefined, 'doğru şık açıklanmamalı');
    assert.equal(v.question.whys, undefined);
    assert.equal(v.question.counts, undefined, 'cevap dağılımı açıklanmamalı');
    for (const p of v.players) { assert.equal(p.score, 0); assert.equal(p.gained, 0); assert.equal(p.streak, 0); }
  }
  assert.ok(!JSON.stringify(hostDuring).includes(q.aciklama));
  for (const [i, p] of players.entries()) {
    for (const v of during(p.stream.messages.slice(playerBefore[i]))) {
      assert.equal(v.question.correct, undefined);
      assert.equal(v.me.score, 0);
      assert.equal(v.me.streak, 0);
      assert.deepEqual(Object.keys(v.answer ?? {}).filter((k) => k !== 'choice'), []);
      if (v.answer) assert.equal(v.answer.choice, [right, wrong, right][i], 'başka oyuncunun cevabı gelmemeli');
    }
  }

  // Son oyuncu da cevaplayınca sonuç açıklanır
  await s.request('POST', `/api/canli/oda/${room.code}/cevap`, { body: { token: players[3].token, choice: wrong } });
  const result = await host.next((v) => v.phase === 'sonuc' && v.index === 0);
  assert.equal(result.question.correct, right);
  assert.equal(result.question.counts.reduce((a, b) => a + b, 0), 4);
  const scores = Object.fromEntries(result.players.map((p) => [p.name, p.score]));
  assert.ok(scores.Ayşe >= 500 && scores.Zeynep >= 500);
  assert.equal(scores.Mehmet, 0);
  const ayse = await players[0].stream.next((v) => v.phase === 'sonuc');
  assert.equal(ayse.answer.correct, true);

  // İkinci soru: önceki puanlar görünür, yeni doğru cevap açıklamaya kadar görünmez
  await cmd(s, room, { type: 'sonraki' });
  const open2 = await host.next((v) => v.phase === 'soru' && v.index === 1);
  const q2 = key.get(open2.question.soru);
  await s.request('POST', `/api/canli/oda/${room.code}/cevap`, { body: { token: players[1].token, choice: open2.question.choices.indexOf(q2.dogru) } });
  const mid = await host.next((v) => v.phase === 'soru' && v.index === 1 && v.answered === 1);
  assert.equal(mid.players.find((p) => p.name === 'Mehmet').score, 0);
  assert.equal(mid.players.find((p) => p.name === 'Ayşe').score, scores.Ayşe);

  await cmd(s, room, { type: 'bitir-sure' });
  const res2 = await host.next((v) => v.phase === 'sonuc' && v.index === 1);
  assert.ok(res2.players.find((p) => p.name === 'Mehmet').score >= 500);
  await cmd(s, room, { type: 'sonraki' });
  const final = await players[0].stream.next((v) => v.phase === 'bitti');
  assert.equal(final.podium.length, 3);
  // Oyun sonucu Supabase'e (soru başarısı) yazılır
  await host.next((v) => v.phase === 'bitti');
  for (let i = 0; i < 50; i++) {
    if ((await s.db.query(`select count(*)::int c from public.n5_game_results where tur = 'canli'`)).rows[0].c) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal((await s.db.query(`select count(*)::int c from public.n5_game_results where tur = 'canli'`)).rows[0].c, 1);
});

test('yetkisiz host komutu ve sahte oyuncu cevabı reddedilir; istemci zamanlamayı değiştiremez', async () => {
  const room = await newRoom();
  assert.equal((await s.request('POST', `/api/canli/oda/${room.code}/komut`, { body: { hostToken: 'sahte', type: 'basla' } })).status, 403);
  assert.equal((await s.request('POST', `/api/canli/oda/${room.code}/cevap`, { body: { token: 'sahte', choice: 0 } })).status, 403);
  assert.equal((await cmd(s, room, { type: 'bilinmeyen' })).status, 409);
});

test('yeniden bağlanma: oyuncu akışı kopup gelince kaldığı yerden devam eder; host çevrimdışı görür', async () => {
  const room = await newRoom();
  const host = await stream(s, `/api/canli/oda/${room.code}/akis?host=${room.hostToken}`);
  const p = await joinPlayer(s, room.code, 'Deniz');
  await host.next((v) => v.players.some((x) => x.name === 'Deniz' && x.online));
  // Olay sırası: kopma → host "çevrimdışı" görür → yeniden bağlanma → host "çevrimiçi" görür.
  const beforeDrop = host.mark();
  p.stream.close();
  await host.after(beforeDrop, (v) => v.players.some((x) => x.name === 'Deniz' && !x.online));
  const beforeBack = host.mark();
  const again = await stream(s, `/api/canli/oda/${room.code}/akis?oyuncu=${p.token}`, p.ip);
  const v = await again.next((m) => m.phase === 'lobi');
  assert.equal(v.me.name, 'Deniz');
  await host.after(beforeBack, (m) => m.players.some((x) => x.name === 'Deniz' && x.online));
});

test('PIN deneme koruması: bulunamayan PIN\'ler sayılır, sınırda doğru PIN de 429 alır', async () => {
  const p = await startStack({ vars: { PIN_FAIL_MAX: 5, ROOM_CREATE_MAX: 100 } });
  try {
    const room = await newRoom(p, '192.0.2.90');
    const ip = '192.0.2.91';
    const pins = ['111111', '222222', '333333', '444444', '555555'].filter((x) => x !== room.code);
    let n = 0;
    for (const pin of pins.slice(0, 5)) {
      const ops = [
        () => p.request('GET', `/api/canli/oda/${pin}`, { ip }),
        () => p.request('POST', `/api/canli/oda/${pin}/katil`, { body: { name: 'Deneme' }, ip }),
        () => p.request('POST', `/api/canli/oda/${pin}/cevap`, { body: { token: 'x', choice: 0 }, ip }),
      ];
      const r = await ops[n++ % ops.length]();
      assert.equal(r.status, 404, pin);
    }
    const blocked = await p.request('GET', `/api/canli/oda/${room.code}`, { ip });
    assert.equal(blocked.status, 429, 'doğru PIN de beklemeli');
    assert.ok(blocked.headers.get('retry-after'));
    const sse = await p.request('GET', `/api/canli/oda/${room.code}/akis?oyuncu=x`, { ip });
    assert.equal(sse.status, 429);
    assert.equal((await p.request('GET', `/api/canli/oda/${room.code}`, { ip: '192.0.2.92' })).status, 200, 'başka adres etkilenmez');
    // Var olan odada yanlış token, PIN'in varlığını "404 yerine 403" ile ele vermez mi? → 403 sayılmaz ama
    // sınırlanmış adres zaten hiçbir oda isteği yapamaz.
  } finally {
    await p.close();
  }
});

test('oda açma ve katılma hız sınırları; "oda dolu" ve isim kuralları korunur', async () => {
  const p = await startStack({ vars: { ROOM_CREATE_MAX: 2, JOIN_MAX: 3 } });
  try {
    const ip = '192.0.2.100';
    const room = await newRoom(p, ip);
    await newRoom(p, ip);
    const limited = await p.request('POST', '/api/canli/oda', { ip });
    assert.equal(limited.status, 429);
    assert.match(limited.json.error, /Çok fazla istek/);
    const jip = '192.0.2.101';
    assert.equal((await p.request('POST', `/api/canli/oda/${room.code}/katil`, { body: { name: 'A' }, ip: jip })).status, 400);
    assert.equal((await p.request('POST', `/api/canli/oda/${room.code}/katil`, { body: { name: 'Ayla' }, ip: jip })).status, 201);
    assert.equal((await p.request('POST', `/api/canli/oda/${room.code}/katil`, { body: { name: 'ayla' }, ip: jip })).status, 409);
    assert.equal((await p.request('POST', `/api/canli/oda/${room.code}/katil`, { body: { name: 'Bora' }, ip: jip })).status, 429);
  } finally {
    await p.close();
  }
});

test('oda temizliği: sunucu ekranı kapalı kalan oda alarmla silinir; oyuncuya "kapandı" gider', async () => {
  const p = await startStack({ vars: { ODA_SUNUCUSUZ_SANIYE: 1, ODA_BOSTA_SANIYE: 3600 } });
  try {
    const room = await newRoom(p);
    const host = await stream(p, `/api/canli/oda/${room.code}/akis?host=${room.hostToken}`);
    await host.next((v) => v.phase === 'lobi');
    const pl = await joinPlayer(p, room.code, 'Ece');
    host.close();
    const closed = await pl.stream.next((v) => v.phase === 'yok', 15_000);
    assert.equal(closed.mesaj, 'Oda kapandı.');
    assert.equal((await p.request('GET', `/api/canli/oda/${room.code}`)).status, 404);
  } finally {
    await p.close();
  }
});

test('oda temizliği: hiç işlem olmayan oda (host bağlı olsa da) alarmla silinir', async () => {
  const p = await startStack({ vars: { ODA_BOSTA_SANIYE: 1 } });
  try {
    const room = await newRoom(p);
    const host = await stream(p, `/api/canli/oda/${room.code}/akis?host=${room.hostToken}`);
    await host.next((v) => v.phase === 'lobi');
    const closed = await host.next((v) => v.phase === 'yok', 15_000);
    assert.equal(closed.mesaj, 'Oda kapandı.');
  } finally {
    await p.close();
  }
});

test('Worker yeniden başlatılınca (deploy) oda ve oyuncular Durable Object deposundan devam eder', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'n5-oda-'));
  const db = await startSupabaseEmulator();
  try {
    const a = await startStack({ db, persist: dir });
    const room = await newRoom(a);
    const j = await a.request('POST', `/api/canli/oda/${room.code}/katil`, { body: { name: 'Kalıcı' } });
    assert.equal(j.status, 201);
    await a.close();
    const b = await startStack({ db, persist: dir });
    const info = await b.request('GET', `/api/canli/oda/${room.code}`);
    assert.equal(info.status, 200);
    assert.equal(info.json.players, 1);
    const st = await openStream(`${b.base}/api/canli/oda/${room.code}/akis?oyuncu=${j.json.token}`);
    const v = await st.next((m) => m.phase === 'lobi');
    assert.equal(v.me.name, 'Kalıcı');
    st.close();
    await b.close();
  } finally {
    await db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
