// Saf oyun motorları (Worker ve Durable Object'lerin kullandığı kod): zaman dışarıdan verildiği için
// süre dolumu, alarm ve hız sınırı penceresi deterministik test edilir.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../worker/src/engine/oturum.mjs';
import * as R from '../worker/src/engine/oda.mjs';
import { applyHit, checkBucket } from '../worker/src/engine/limit.mjs';
import { maskText } from '../worker/src/engine/ortak.mjs';
import { answerKey, correctChoice, findAnswerLeak, seed as loadSeed, wrongChoice } from './helpers.mjs';

const seed = loadSeed();
const key = answerKey(seed);
const settings = { questionsPerGame: 15, endOnWrong: true, secondsPerQuestion: 30 };
const T0 = 1_800_000_000_000;

test('oturum: başlangıç yanıtı (public DTO) cevap anahtarı içermez; durum (sunucu) içerir', () => {
  const { state, response } = S.newSession({ questions: seed, settings, now: T0 });
  assert.equal(findAnswerLeak(JSON.stringify(response)), null);
  assert.deepEqual(Object.keys(response).sort(), ['ayarlar', 'olcu', 'sorular', 'token']);
  assert.ok(state.rounds.every((r) => r.options.filter((o) => o.correct).length === 1));
  assert.notEqual(state.gameId, state.token, 'istatistik anahtarı oturum anahtarından ayrı');
  for (const a of response.olcu.aciklamalar) assert.equal(a, maskText(a), 'açıklamalar maskeli olmalı');
});

test('oturum: doğru/yanlış, tekrar gönderim, sıra dışı soru ve kayıt', () => {
  const { state, response } = S.newSession({ questions: seed, settings, now: T0 });
  const ok = S.answer(state, { index: 0, secim: correctChoice(key, response.sorular[0]) });
  assert.equal(ok.sonuc, 'dogru');
  assert.equal(S.pendingRecord(state), null, 'oyun bitmeden kayıt yok');
  assert.deepEqual(S.answer(state, { index: 0, secim: correctChoice(key, response.sorular[0]) }), ok, 'yeniden gönderim aynı sonuç');
  assert.throws(() => S.answer(state, { index: 0, secim: wrongChoice(key, response.sorular[0]) }), { status: 409 });
  assert.throws(() => S.answer(state, { index: 2, secim: 0 }), { status: 409 });
  const bad = S.answer(state, { index: 1, secim: wrongChoice(key, response.sorular[1]) });
  assert.equal(bad.sonuc, 'yanlis');
  assert.equal(bad.bitti, true);
  const rec = S.pendingRecord(state);
  assert.equal(rec.gameId, state.gameId);
  assert.equal(rec.finished, false);
  assert.deepEqual(rec.answers.map((a) => a.correct), [true, false]);
});

test('oturum: jokerler bir kez kullanılır, yeniden gönderim aynı sonucu verir', () => {
  const { state, response } = S.newSession({ questions: seed, settings, now: T0 });
  const f = S.lifeline(state, { index: 0, tur: 'fifty' });
  assert.equal(f.elenen.length, 2);
  assert.ok(!f.elenen.includes(correctChoice(key, response.sorular[0])));
  assert.deepEqual(S.lifeline(state, { index: 0, tur: 'fifty' }), f);
  assert.throws(() => S.answer(state, { index: 0, secim: f.elenen[0] }), { status: 400 });
  S.answer(state, { index: 0, secim: correctChoice(key, response.sorular[0]) });
  assert.throws(() => S.lifeline(state, { index: 1, tur: 'fifty' }), { status: 409 });
  // çift cevap
  assert.deepEqual(S.lifeline(state, { index: 1, tur: 'double' }), { ok: true });
  const w = wrongChoice(key, response.sorular[1]);
  const t = S.answer(state, { index: 1, secim: w });
  assert.equal(t.sonuc, 'tekrar');
  assert.ok(!('dogruSik' in t));
  assert.equal(S.answer(state, { index: 1, secim: correctChoice(key, response.sorular[1]) }).sonuc, 'dogru');
});

test('oturum: geçersiz değerler reddedilir', () => {
  const { state } = S.newSession({ questions: seed, settings, now: T0 });
  for (const body of [{}, { index: 0 }, { index: -1, secim: 0 }, { index: 0, secim: 4 }, { index: 0, secim: 1.5 }, { index: 0, secim: '1' },
    { index: 0, secim: Infinity }, { index: 0, secim: Number.NaN }, { index: 1e20, secim: 0 }, { index: 0, secim: 0, games: 5 }, null, [], 'x']) {
    assert.throws(() => S.answer(state, body), { status: 400 }, JSON.stringify(body));
  }
});

test('oturum: işlem yapılmayan oturumun süresi dolar', () => {
  const { state } = S.newSession({ questions: seed, settings, now: T0 });
  assert.equal(S.isExpired(state, T0 + S.SESSION_TTL_MS), false);
  assert.equal(S.isExpired(state, T0 + S.SESSION_TTL_MS + 1), true);
});

test('oda: soru açıkken puan, seri, sıra ve kazanç gizli; açıklamada görünür', () => {
  const room = R.newRoom({ code: '123456', settings, now: T0 });
  const a = R.join(room, 'Ayşe', T0);
  const b = R.join(room, 'Mehmet', T0 + 1);
  const online = () => true;
  assert.equal(R.start(room, { count: 2, seconds: 30, readyMs: 10 }, seed, T0), null);
  R.onTimer(room, T0 + 10); // soru açılır
  assert.equal(room.phase, 'soru');
  const r0 = room.rounds[0];
  const right = r0.options.findIndex((o) => o.correct);
  assert.equal(R.answer(room, a, right, T0 + 1000, online), null);
  const hv = R.hostView(room, T0 + 1000, online);
  assert.equal(hv.question.correct, undefined);
  for (const p of hv.players) { assert.equal(p.score, 0); assert.equal(p.gained, 0); assert.equal(p.streak, 0); }
  assert.equal(R.playerView(room, a, T0 + 1000).me.score, 0);
  assert.deepEqual(Object.keys(R.playerView(room, a, T0 + 1000).answer), ['choice']);
  // Herkes cevaplayınca erken kapanış zamanlanır
  assert.equal(R.answer(room, b, (right + 1) % 4, T0 + 1500, online), null);
  assert.equal(room.timer.action, 'close');
  R.onTimer(room, room.timer.at);
  assert.equal(room.phase, 'sonuc');
  const after = R.hostView(room, room.timer?.at ?? T0 + 3000, online);
  assert.equal(after.question.correct, right);
  assert.ok(after.players.find((p) => p.name === 'Ayşe').score >= 500);
});

test('oda: süre dolumu (boşta ve sunucu ekranı kapalı) ve alarm zamanı', () => {
  const room = R.newRoom({ code: '123456', settings, now: T0 });
  assert.equal(R.expired(room, T0 + R.ROOM_TTL_MS, true), false);
  assert.equal(R.expired(room, T0 + R.ROOM_TTL_MS + 1, true), true);
  assert.equal(R.expired(room, T0 + R.HOSTLESS_TTL_MS + 1, false), true, 'sunucu ekranı kapalıysa 30 dk');
  assert.equal(R.expired(room, T0 + R.HOSTLESS_TTL_MS + 1, true), false);
  assert.equal(R.nextAlarm(room, false), T0 + R.HOSTLESS_TTL_MS + 1);
  R.join(room, 'Ayşe', T0);
  R.start(room, { count: 1, seconds: 30, readyMs: 3500 }, seed, T0);
  assert.equal(R.nextAlarm(room, true), T0 + 3500, 'faz geçişi süre dolumundan önce');
});

test('oda: istemci zamanlama alanı gönderemez; bilinmeyen komut reddedilir', () => {
  const room = R.newRoom({ code: '123456', settings, now: T0 });
  assert.deepEqual(R.command(room, 'hile', {}, T0, () => true), { error: 'Bilinmeyen komut.' });
  assert.throws(() => R.join(room, 'A', T0), { status: 400 });
  R.join(room, 'Ayşe', T0);
  assert.throws(() => R.join(room, 'ayşe', T0), { status: 409 });
});

test('hız sınırı penceresi: sınır, Retry-After ve pencere sonunda sıfırlanma', () => {
  let b = null;
  for (let i = 0; i < 3; i++) {
    const r = applyHit(b, T0, 3, 10_000);
    assert.equal(r.limited, false);
    b = r.bucket;
  }
  assert.deepEqual(applyHit(b, T0, 3, 10_000), { bucket: b, limited: true, retryAfter: 10 });
  assert.deepEqual(checkBucket(b, T0 + 4000, 3), { limited: true, retryAfter: 6 });
  assert.equal(applyHit(b, T0 + 10_000, 3, 10_000).limited, false, 'pencere dolunca yeniden izin');
  assert.deepEqual(checkBucket(null, T0, 3), { limited: false });
});
