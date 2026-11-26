// "Kim Nefes Almak İster?" çok oyunculu oda — saf durum makinesi.
// Durum düz JSON'dur ve odanın tek yetkili koordinatörü olan Durable Object'te saklanır.
// Zamanlanmış geçişler `state.timer` içinde tutulur (DO bunu alarm olarak kurar); bağlantı durumu
// (kimin akışı açık) dışarıdan `online(playerId)` ile verilir.
// Süre, puan ve doğru cevap yalnızca burada tutulur: oyuncuya doğru şık cevaplar açıklanınca gider.
import { HttpError, shuffle, uuid } from './ortak.mjs';

export const MAX_PLAYERS = 120;
const NAME_MAX = 16;
export const READY_MS = 3500; // soru metni önce tek başına görünür, şıklar sonra açılır
const GRACE_MS = 600; // ağ gecikmesi payı
const EARLY_CLOSE_MS = 700; // herkes cevaplayınca sonuç bu kadar sonra açılır
export const ROOM_TTL_MS = 3 * 60 * 60 * 1000; // hiç işlem olmazsa oda silinir
export const HOSTLESS_TTL_MS = 30 * 60 * 1000; // sunucu ekranı kapalı kalırsa oda silinir
const LIMITS = { count: [1, 50], seconds: [5, 120] };

const clamp = (v, [lo, hi], d) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};

/** Kahoot tarzı puan: doğru cevap 500–1000 arası, hızlı olan çok alır; art arda doğrularda seri bonusu. */
export function scoreFor(elapsedMs, limitMs, streak) {
  const speed = 1 - Math.min(1, Math.max(0, elapsedMs / limitMs)) / 2;
  const bonus = Math.min(500, Math.max(0, streak - 1) * 100);
  return { base: Math.round(1000 * speed), bonus };
}

export function newRoom({ code, settings, now }) {
  return {
    v: 1,
    code,
    hostToken: uuid(),
    created: now,
    touched: now,
    hostSeen: now,
    phase: 'lobi',
    options: {
      count: clamp(settings.questionsPerGame, LIMITS.count, 10),
      seconds: clamp(settings.secondsPerQuestion || 20, LIMITS.seconds, 20),
    },
    rounds: [],
    index: -1,
    startedAt: 0,
    deadline: 0,
    timer: null, // { at, action: 'open' | 'close' }
    players: [],
    gameId: null,
    log: [],
    starting: false,
  };
}

// ---------- görünümler ----------

const round = (room) => room.rounds[room.index];
// Soru açıkken (hazir/soru) herkes sorunun başındaki puanı, seriyi ve sırayı görür: bir oyuncunun
// cevabının doğru olup olmadığı açıklama anına kadar hiçbir ekrana — büyük ekran dahil — gönderilmez.
const hidden = (room) => room.phase === 'hazir' || room.phase === 'soru';
const shownScore = (room, p) => (hidden(room) ? p.baseScore : p.score);
const shownStreak = (room, p) => (hidden(room) ? p.baseStreak : p.streak);

export function ranking(room) {
  return [...room.players].sort((a, b) => shownScore(room, b) - shownScore(room, a) || a.joined - b.joined);
}

function answerCounts(room) {
  const counts = [0, 0, 0, 0];
  for (const p of room.players) if (p.answer) counts[p.answer.choice]++;
  return counts;
}

export function hostView(room, now, online) {
  const r = round(room);
  const reveal = room.phase === 'sonuc' || room.phase === 'tablo' || room.phase === 'bitti';
  const ranked = ranking(room);
  const v = {
    phase: room.phase,
    code: room.code,
    options: room.options,
    index: room.index,
    total: room.rounds.length,
    players: ranked.map((p, i) => ({
      id: p.id,
      name: p.name,
      score: shownScore(room, p),
      streak: shownStreak(room, p),
      online: online(p.id),
      rank: i + 1,
      prevRank: p.prevRank,
      gained: hidden(room) ? 0 : p.answer?.points ?? 0,
      answered: !!p.answer,
    })),
    answered: room.players.filter((p) => p.answer).length,
  };
  if (r && room.phase !== 'lobi') {
    v.question = { soru: r.q.soru, kategori: r.q.kategori ?? '', choices: room.phase === 'hazir' ? [] : r.options.map((o) => o.text) };
    if (hidden(room)) v.remainingMs = Math.max(0, room.deadline - now);
    if (reveal) {
      v.question.correct = r.options.findIndex((o) => o.correct);
      v.question.why = r.options.find((o) => o.correct)?.why ?? '';
      v.question.whys = r.options.map((o) => o.why); // her şık neden doğru / neden yanlış
      v.question.counts = answerCounts(room);
    }
  }
  return v;
}

export function playerView(room, p, now) {
  const r = round(room);
  const ranked = ranking(room);
  const v = {
    phase: room.phase,
    code: room.code,
    me: { id: p.id, name: p.name, score: shownScore(room, p), streak: shownStreak(room, p), rank: ranked.indexOf(p) + 1 },
    playerCount: room.players.length,
    seconds: room.options.seconds,
    index: room.index,
    total: room.rounds.length,
  };
  if (r && room.phase !== 'lobi') {
    v.question = { soru: r.q.soru, kategori: r.q.kategori ?? '', choices: room.phase === 'hazir' ? [] : r.options.map((o) => o.text) };
    if (hidden(room)) v.remainingMs = Math.max(0, room.deadline - now);
    v.answer = p.answer ? { choice: p.answer.choice } : null;
    if (room.phase === 'sonuc' || room.phase === 'tablo') {
      const c = r.options.findIndex((o) => o.correct);
      v.question.correct = c;
      v.question.why = r.options[c].why;
      v.question.whys = r.options.map((o) => o.why);
      v.answer = p.answer ? { ...p.answer } : null;
    }
  }
  if (room.phase === 'bitti') v.podium = ranked.slice(0, 3).map((x) => ({ name: x.name, score: x.score }));
  return v;
}

// ---------- oyuncular ----------

export const findByToken = (room, token) => (typeof token === 'string' ? room.players.find((p) => p.token === token) : undefined);
export const findById = (room, id) => room.players.find((p) => p.id === String(id));

export function join(room, rawName, now) {
  const name = String(rawName ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
  if (name.length < 2) throw new HttpError(400, 'Adınız en az 2 karakter olmalı.');
  if (room.phase === 'bitti') throw new HttpError(409, 'Bu oyun bitti. Yeni oyunun PIN’ini bekleyin.');
  if (room.players.length >= MAX_PLAYERS) throw new HttpError(409, 'Oda dolu.');
  const key = name.toLocaleLowerCase('tr');
  if (room.players.some((p) => p.name.toLocaleLowerCase('tr') === key)) {
    throw new HttpError(409, 'Bu ad başka bir oyuncuda. Farklı bir ad seçin.');
  }
  const p = {
    id: uuid().slice(0, 8),
    token: uuid(),
    name,
    joined: now,
    score: 0,
    streak: 0,
    baseScore: 0,
    baseStreak: 0,
    correctCount: 0,
    answer: null,
    prevRank: 0,
  };
  room.players.push(p);
  room.touched = now;
  return p;
}

const waitingFor = (room, online) => room.players.some((x) => !x.answer && online(x.id));

/** Oyuncuyu çıkarır. Kalanların hepsi cevapladıysa soruyu beklemeden kapatır. */
export function removePlayer(room, id, now, online) {
  room.players = room.players.filter((p) => p.id !== id);
  room.touched = now;
  if (room.phase === 'soru' && !waitingFor(room, online)) closeAnswers(room, now);
}

// ---------- oyun akışı ----------

/** Oyunu başlatır (sorular dışarıdan, veri katmanından gelir). Hata mesajı ya da null döndürür. */
export function start(room, opts, questions, now) {
  if (room.phase !== 'lobi') return 'Oyun zaten başladı.';
  if (!room.players.length) return 'Henüz katılan oyuncu yok.';
  room.options = {
    count: clamp(opts.count, LIMITS.count, room.options.count),
    seconds: clamp(opts.seconds, LIMITS.seconds, room.options.seconds),
  };
  const pool = shuffle(questions.filter((q) => q.aktif !== false && q.soru && q.dogru && q.yanlislar?.length === 3));
  if (!pool.length) return 'Oyunda gösterilecek soru yok. Yönetici panelinden soru ekleyin.';
  room.rounds = pool.slice(0, room.options.count).map((q) => ({
    q: { id: q.id, soru: q.soru, kategori: q.kategori ?? '' },
    options: shuffle([
      { text: q.dogru, correct: true, why: q.aciklama?.trim() ?? '' },
      ...q.yanlislar.map((text, i) => ({ text, correct: false, why: q.yanlisAciklamalar?.[i]?.trim() ?? '' })),
    ]),
  }));
  room.index = -1;
  room.log = [];
  room.gameId = uuid(); // istatistik idempotency anahtarı
  for (const p of room.players) Object.assign(p, { score: 0, streak: 0, baseScore: 0, baseStreak: 0, answer: null, prevRank: 0, correctCount: 0 });
  return nextQuestion(room, now, opts.readyMs ?? READY_MS);
}

/** Sıradaki soru ya da oyun sonu. Oyun bittiyse kaydedilecek sonucu döndürür. */
export function nextQuestion(room, now, readyMs = READY_MS) {
  room.timer = null;
  room.touched = now;
  if (room.index >= room.rounds.length - 1) return finish(room, now);
  ranking(room).forEach((p, i) => { p.prevRank = i + 1; p.answer = null; p.baseScore = p.score; p.baseStreak = p.streak; });
  room.index++;
  room.phase = 'hazir';
  room.deadline = now + readyMs;
  room.timer = { at: room.deadline, action: 'open' };
  return null;
}

function openAnswers(room, now) {
  room.phase = 'soru';
  room.startedAt = now;
  room.deadline = now + room.options.seconds * 1000;
  room.timer = { at: room.deadline + GRACE_MS, action: 'close' };
}

export function closeAnswers(room, now) {
  if (room.phase !== 'soru') return;
  room.timer = null;
  room.touched = now;
  const r = round(room);
  for (const p of room.players) {
    if (p.answer) continue;
    p.streak = 0;
    p.answer = null;
    room.log.push({ id: r.q.id, correct: false });
  }
  room.phase = 'sonuc';
}

/** Oyuncu cevabı. Hata mesajı ya da null döndürür. */
export function answer(room, p, choice, now, online) {
  if (room.phase !== 'soru') return 'Şu anda cevap verilemez.';
  if (p.answer) return 'Bu soruyu zaten cevapladınız.';
  const r = round(room);
  if (!Number.isInteger(choice) || choice < 0 || choice >= r.options.length) return 'Geçersiz şık.';
  if (now > room.deadline + GRACE_MS) return 'Süre doldu.';
  const ms = Math.min(now - room.startedAt, room.options.seconds * 1000);
  const correct = r.options[choice].correct;
  p.streak = correct ? p.streak + 1 : 0;
  const { base, bonus } = correct ? scoreFor(ms, room.options.seconds * 1000, p.streak) : { base: 0, bonus: 0 };
  p.answer = { choice, correct, ms, points: base + bonus, bonus };
  p.score += base + bonus;
  if (correct) p.correctCount++;
  room.log.push({ id: r.q.id, correct });
  room.touched = now;
  // bağlı herkes cevapladıysa beklemeye gerek yok
  if (!waitingFor(room, online)) room.timer = { at: now + EARLY_CLOSE_MS, action: 'close' };
  return null;
}

function finish(room, now) {
  room.timer = null;
  room.phase = 'bitti';
  room.touched = now;
  const record = room.log.length && room.gameId ? { gameId: room.gameId, answers: room.log } : null;
  room.log = [];
  return record;
}

/** Host komutu (start hariç). Kaydedilecek oyun sonucu varsa döndürür. */
export function command(room, type, body, now, online) {
  switch (type) {
    case 'bitir-sure':
      if (room.phase === 'soru') closeAnswers(room, now);
      return { record: null };
    case 'tablo':
      if (room.phase === 'sonuc') { room.phase = 'tablo'; room.touched = now; }
      return { record: null };
    case 'sonraki':
      if (room.phase === 'sonuc' || room.phase === 'tablo') return { record: nextQuestion(room, now, body.readyMs) };
      return { record: null };
    case 'bitir':
      if (room.phase !== 'lobi' && room.phase !== 'bitti') return { record: finish(room, now) };
      return { record: null };
    case 'lobi':
      room.timer = null;
      room.phase = 'lobi';
      room.rounds = [];
      room.index = -1;
      room.touched = now;
      for (const p of room.players) Object.assign(p, { score: 0, streak: 0, baseScore: 0, baseStreak: 0, answer: null, prevRank: 0, correctCount: 0 });
      return { record: null };
    case 'at': {
      const p = findById(room, body.id);
      if (p) removePlayer(room, p.id, now, online);
      return { record: null, kicked: p ?? null };
    }
    default:
      return { error: 'Bilinmeyen komut.' };
  }
}

/** Zamanı gelen geçişi uygular. Kaydedilecek oyun sonucu yoksa null döndürür. */
export function onTimer(room, now) {
  const t = room.timer;
  if (!t || t.at > now) return null;
  room.timer = null;
  if (t.action === 'open' && room.phase === 'hazir') openAnswers(room, now);
  else if (t.action === 'close') closeAnswers(room, now);
  return null;
}

/** Oda silinmeli mi? (uzun süre işlem yok ya da sunucu ekranı uzun süredir kapalı) */
export function expired(room, now, hostOnline, ttl = { idle: ROOM_TTL_MS, hostless: HOSTLESS_TTL_MS }) {
  return now - room.touched > ttl.idle || (!hostOnline && now - room.hostSeen > ttl.hostless);
}

/** Bir sonraki alarm zamanı: zamanlanmış geçiş ya da süre dolumu (hangisi önceyse). */
export function nextAlarm(room, hostOnline, ttl = { idle: ROOM_TTL_MS, hostless: HOSTLESS_TTL_MS }) {
  const times = [room.touched + ttl.idle + 1];
  if (!hostOnline) times.push(room.hostSeen + ttl.hostless + 1);
  if (room.timer) times.push(room.timer.at);
  return Math.min(...times);
}
