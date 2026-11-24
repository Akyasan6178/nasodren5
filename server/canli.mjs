// "Kim Nefes Almak İster?" — çok oyunculu canlı yarışma (Kahoot tarzı).
// Odalar bellekte tutulur. Sunucu → tarayıcı yönü Server-Sent Events (SSE), tarayıcı → sunucu
// yönü düz POST istekleridir; ek bağımlılık gerekmez, hem Vite hem üretim sunucusunda çalışır.
// Süre, puan ve doğru cevap yalnızca sunucuda tutulur: oyuncuya doğru şık cevaplar açıklanınca gider.
import { randomUUID, randomInt } from 'node:crypto';
import { networkInterfaces } from 'node:os';

const MAX_ROOMS = 200;
const MAX_PLAYERS = 120;
const NAME_MAX = 16;
const READY_MS = 3500; // soru metni önce tek başına görünür, şıklar sonra açılır
const GRACE_MS = 600; // ağ gecikmesi payı
const ROOM_TTL_MS = 3 * 60 * 60 * 1000; // hiç işlem olmazsa oda silinir
const HOSTLESS_TTL_MS = 30 * 60 * 1000; // sunucu ekranı kapalı kalırsa oda silinir
const PING_MS = 20_000;
const LIMITS = { count: [1, 50], seconds: [5, 120] };

const clamp = (v, [lo, hi], d) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Aynı ağdaki telefonların bağlanabileceği IPv4 adresleri (sunucu "localhost" üzerinden açıldıysa gerekir). */
function lanAddresses() {
  const out = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  }
  // ev/ofis ağları önce
  return out.sort((a, b) => Number(!/^(192\.168|10\.|172\.)/.test(a)) - Number(!/^(192\.168|10\.|172\.)/.test(b)));
}

/** Kahoot tarzı puan: doğru cevap 500–1000 arası, hızlı olan çok alır; art arda doğrularda seri bonusu. */
function scoreFor(elapsedMs, limitMs, streak) {
  const speed = 1 - Math.min(1, Math.max(0, elapsedMs / limitMs)) / 2;
  const bonus = Math.min(500, Math.max(0, streak - 1) * 100);
  return { base: Math.round(1000 * speed), bonus };
}

/**
 * @param {{ getGame: () => Promise<{questions: any[], settings: any}>, recordAnswers: (a: {id: string, correct: boolean}[]) => Promise<void> }} deps
 */
export function createLive({ getGame, recordAnswers }) {
  /** @type {Map<string, any>} */
  const rooms = new Map();

  // ---------- oda yaşam döngüsü ----------

  function newCode() {
    for (let i = 0; i < 1000; i++) {
      const code = String(randomInt(100000, 1000000));
      if (!rooms.has(code)) return code;
    }
    throw new Error('Boş oda kodu bulunamadı.');
  }

  function createRoom(settings) {
    if (rooms.size >= MAX_ROOMS) sweep(true);
    if (rooms.size >= MAX_ROOMS) throw Object.assign(new Error('Şu anda çok fazla açık oda var, biraz sonra deneyin.'), { status: 503 });
    const room = {
      code: newCode(),
      hostToken: randomUUID(),
      touched: Date.now(),
      hostSeen: Date.now(),
      phase: 'lobi',
      options: {
        count: clamp(settings.questionsPerGame, LIMITS.count, 10),
        seconds: clamp(settings.secondsPerQuestion || 20, LIMITS.seconds, 20),
      },
      rounds: [],
      index: -1,
      startedAt: 0,
      deadline: 0,
      timer: null,
      players: new Map(),
      hosts: new Set(),
    };
    rooms.set(room.code, room);
    return room;
  }

  function closeRoom(room, reason) {
    clearTimeout(room.timer);
    for (const res of room.hosts) end(res, { phase: 'yok', mesaj: reason });
    for (const p of room.players.values()) for (const res of p.streams) end(res, { phase: 'yok', mesaj: reason });
    rooms.delete(room.code);
  }

  function sweep(force = false) {
    const now = Date.now();
    for (const room of rooms.values()) {
      const idle = now - room.touched > ROOM_TTL_MS;
      const hostless = !room.hosts.size && now - room.hostSeen > (force ? 5 * 60 * 1000 : HOSTLESS_TTL_MS);
      if (idle || hostless) closeRoom(room, 'Oda kapandı.');
    }
  }
  setInterval(sweep, 60_000).unref?.();

  // ---------- akış (SSE) ----------

  function write(res, data) {
    if (!res || res.writableEnded) return;
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  }
  function end(res, data) {
    if (!res || res.writableEnded) return;
    write(res, data);
    res.end();
  }

  function openStream(req, res) {
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no', // nginx arkasında tamponlamayı kapat
    });
    res.write('retry: 1500\n\n');
    const ping = setInterval(() => res.write(': ping\n\n'), PING_MS);
    req.on('close', () => clearInterval(ping));
  }

  // ---------- görünümler ----------

  const round = (room) => room.rounds[room.index];
  const remaining = (room) => Math.max(0, room.deadline - Date.now());

  function ranking(room) {
    return [...room.players.values()].sort((a, b) => b.score - a.score || a.joined - b.joined);
  }

  function answerCounts(room) {
    const counts = [0, 0, 0, 0];
    for (const p of room.players.values()) if (p.answer) counts[p.answer.choice]++;
    return counts;
  }

  function hostView(room) {
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
        score: p.score,
        streak: p.streak,
        online: p.streams.size > 0,
        rank: i + 1,
        prevRank: p.prevRank,
        gained: p.answer?.points ?? 0,
        answered: !!p.answer,
      })),
      answered: [...room.players.values()].filter((p) => p.answer).length,
    };
    if (r && room.phase !== 'lobi') {
      v.question = {
        soru: r.q.soru,
        kategori: r.q.kategori ?? '',
        choices: room.phase === 'hazir' ? [] : r.options.map((o) => o.text),
      };
      if (room.phase === 'hazir' || room.phase === 'soru') v.remainingMs = room.phase === 'hazir' ? room.deadline - Date.now() : remaining(room);
      if (reveal) {
        v.question.correct = r.options.findIndex((o) => o.correct);
        v.question.why = r.options.find((o) => o.correct)?.why ?? '';
        v.question.whys = r.options.map((o) => o.why); // her şık neden doğru / neden yanlış
        v.question.counts = answerCounts(room);
      }
    }
    return v;
  }

  function playerView(room, p) {
    const r = round(room);
    const ranked = ranking(room);
    const v = {
      phase: room.phase,
      code: room.code,
      me: { id: p.id, name: p.name, score: p.score, streak: p.streak, rank: ranked.indexOf(p) + 1 },
      playerCount: room.players.size,
      seconds: room.options.seconds,
      index: room.index,
      total: room.rounds.length,
    };
    if (r && room.phase !== 'lobi') {
      v.question = { soru: r.q.soru, kategori: r.q.kategori ?? '', choices: room.phase === 'hazir' ? [] : r.options.map((o) => o.text) };
      if (room.phase === 'hazir' || room.phase === 'soru') v.remainingMs = room.phase === 'hazir' ? room.deadline - Date.now() : remaining(room);
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

  /** Değişikliği ilgili ekranlara gönderir. `only` verilirse oyunculardan yalnız ona gönderilir. */
  function push(room, only) {
    room.touched = Date.now();
    const hv = hostView(room);
    for (const res of room.hosts) write(res, hv);
    const targets = only ? [only] : room.players.values();
    for (const p of targets) {
      if (!p.streams.size) continue;
      const pv = playerView(room, p);
      for (const res of p.streams) write(res, pv);
    }
  }

  // ---------- oyun akışı ----------

  async function start(room, opts) {
    if (room.phase !== 'lobi' || room.starting) return 'Oyun zaten başladı.';
    if (!room.players.size) return 'Henüz katılan oyuncu yok.';
    room.starting = true;
    try {
      return await prepare(room, opts);
    } finally {
      room.starting = false;
    }
  }

  async function prepare(room, opts) {
    room.options = {
      count: clamp(opts.count, LIMITS.count, room.options.count),
      seconds: clamp(opts.seconds, LIMITS.seconds, room.options.seconds),
    };
    const { questions } = await getGame();
    const pool = shuffle(questions.filter((q) => q.aktif !== false && q.soru && q.dogru && q.yanlislar?.length === 3));
    if (!pool.length) return 'Oyunda gösterilecek soru yok. Yönetici panelinden soru ekleyin.';
    room.rounds = pool.slice(0, room.options.count).map((q) => ({
      q,
      options: shuffle([
        { text: q.dogru, correct: true, why: q.aciklama?.trim() ?? '' },
        ...q.yanlislar.map((text, i) => ({ text, correct: false, why: q.yanlisAciklamalar?.[i]?.trim() ?? '' })),
      ]),
    }));
    room.index = -1;
    room.log = [];
    for (const p of room.players.values()) Object.assign(p, { score: 0, streak: 0, answer: null, prevRank: 0, correctCount: 0 });
    nextQuestion(room);
    return null;
  }

  function nextQuestion(room) {
    clearTimeout(room.timer);
    if (room.index >= room.rounds.length - 1) return finish(room);
    const ranked = ranking(room);
    ranked.forEach((p, i) => { p.prevRank = i + 1; p.answer = null; });
    room.index++;
    room.phase = 'hazir';
    room.deadline = Date.now() + READY_MS;
    room.timer = setTimeout(() => openAnswers(room), READY_MS);
    push(room);
  }

  function openAnswers(room) {
    room.phase = 'soru';
    room.startedAt = Date.now();
    room.deadline = room.startedAt + room.options.seconds * 1000;
    clearTimeout(room.timer);
    room.timer = setTimeout(() => closeAnswers(room), room.options.seconds * 1000 + GRACE_MS);
    push(room);
  }

  function closeAnswers(room) {
    if (room.phase !== 'soru') return;
    clearTimeout(room.timer);
    const r = round(room);
    for (const p of room.players.values()) {
      if (p.answer) continue;
      p.streak = 0;
      p.answer = null;
      room.log.push({ id: r.q.id, correct: false });
    }
    room.phase = 'sonuc';
    push(room);
  }

  function answer(room, p, choice) {
    if (room.phase !== 'soru') return 'Şu anda cevap verilemez.';
    if (p.answer) return 'Bu soruyu zaten cevapladınız.';
    const r = round(room);
    if (!Number.isInteger(choice) || choice < 0 || choice >= r.options.length) return 'Geçersiz şık.';
    const now = Date.now();
    if (now > room.deadline + GRACE_MS) return 'Süre doldu.';
    const ms = Math.min(now - room.startedAt, room.options.seconds * 1000);
    const correct = r.options[choice].correct;
    p.streak = correct ? p.streak + 1 : 0;
    const { base, bonus } = correct ? scoreFor(ms, room.options.seconds * 1000, p.streak) : { base: 0, bonus: 0 };
    p.answer = { choice, correct, ms, points: base + bonus, bonus };
    p.score += base + bonus;
    if (correct) p.correctCount++;
    room.log.push({ id: r.q.id, correct });
    // bağlı herkes cevapladıysa beklemeye gerek yok
    const waiting = [...room.players.values()].some((x) => !x.answer && x.streams.size);
    if (!waiting) {
      clearTimeout(room.timer);
      room.timer = setTimeout(() => closeAnswers(room), 700);
    }
    push(room, p);
    return null;
  }

  function finish(room) {
    clearTimeout(room.timer);
    room.phase = 'bitti';
    push(room);
    if (room.log?.length) void recordAnswers(room.log).catch(() => undefined);
    room.log = [];
  }

  function backToLobby(room) {
    clearTimeout(room.timer);
    room.phase = 'lobi';
    room.rounds = [];
    room.index = -1;
    for (const p of room.players.values()) Object.assign(p, { score: 0, streak: 0, answer: null, prevRank: 0, correctCount: 0 });
    push(room);
  }

  function removePlayer(room, p, reason) {
    room.players.delete(p.id);
    for (const s of p.streams) end(s, { phase: 'atildi', mesaj: reason });
    push(room);
    // kalanların hepsi cevapladıysa soruyu beklemeden kapat
    if (room.phase === 'soru' && ![...room.players.values()].some((x) => !x.answer && x.streams.size)) closeAnswers(room);
  }

  // ---------- HTTP ----------

  function findRoom(code) {
    return rooms.get(String(code ?? '').replace(/\D/g, ''));
  }

  /**
   * /api/canli/... isteklerini karşılar. Akış uçları yanıtı açık tutar.
   * @returns {Promise<boolean>} istek karşılandıysa true
   */
  return async function handle(req, res, pathname, query, { send, readBody }) {
    const method = req.method;

    // Yeni oda (sunucu ekranı)
    if (method === 'POST' && pathname === '/api/canli/oda') {
      const { settings } = await getGame();
      const room = createRoom(settings ?? {});
      send(res, 201, { code: room.code, hostToken: room.hostToken, options: room.options, lan: lanAddresses() });
      return true;
    }

    const m = pathname.match(/^\/api\/canli\/oda\/(\d{6})(?:\/(akis|katil|cevap|ayril|komut))?$/);
    if (!m) return false;
    const room = rooms.get(m[1]);
    const action = m[2];

    // Akış: hem sunucu ekranı (?host=...) hem oyuncular (?oyuncu=...)
    if (method === 'GET' && action === 'akis') {
      openStream(req, res);
      if (!room) return end(res, { phase: 'yok', mesaj: 'Bu PIN ile açık bir oyun bulunamadı.' }), true;
      const hostToken = query.get('host');
      if (hostToken) {
        if (hostToken !== room.hostToken) return end(res, { phase: 'yok', mesaj: 'Bu odayı yönetme izniniz yok.' }), true;
        room.hosts.add(res);
        room.hostSeen = Date.now();
        req.on('close', () => { room.hosts.delete(res); room.hostSeen = Date.now(); });
        write(res, hostView(room));
        return true;
      }
      const p = [...room.players.values()].find((x) => x.token === query.get('oyuncu'));
      if (!p) return end(res, { phase: 'atildi', mesaj: 'Oyunda kaydınız bulunamadı. Yeniden katılın.' }), true;
      const wasOffline = !p.streams.size;
      p.streams.add(res);
      req.on('close', () => {
        p.streams.delete(res);
        if (!p.streams.size && rooms.has(room.code)) push(room, p); // sunucu ekranında "çevrimdışı" görünsün
      });
      if (wasOffline) push(room, p);
      else write(res, playerView(room, p));
      return true;
    }

    // Oda var mı? (katılma ekranı kodu doğrular)
    if (method === 'GET' && !action) {
      if (!room) return send(res, 404, { error: 'Bu PIN ile açık bir oyun bulunamadı.' }), true;
      send(res, 200, { code: room.code, phase: room.phase, players: room.players.size, lan: lanAddresses() });
      return true;
    }

    if (method !== 'POST') return false;
    if (!room) return send(res, 404, { error: 'Bu PIN ile açık bir oyun bulunamadı.' }), true;
    const body = await readBody(req);

    if (action === 'katil') {
      const name = String(body.name ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
      if (name.length < 2) return send(res, 400, { error: 'Adınız en az 2 karakter olmalı.' }), true;
      if (room.phase === 'bitti') return send(res, 409, { error: 'Bu oyun bitti. Yeni oyunun PIN’ini bekleyin.' }), true;
      if (room.players.size >= MAX_PLAYERS) return send(res, 409, { error: 'Oda dolu.' }), true;
      const key = name.toLocaleLowerCase('tr');
      if ([...room.players.values()].some((p) => p.name.toLocaleLowerCase('tr') === key)) {
        return send(res, 409, { error: 'Bu ad başka bir oyuncuda. Farklı bir ad seçin.' }), true;
      }
      const p = {
        id: randomUUID().slice(0, 8),
        token: randomUUID(),
        name,
        joined: Date.now(),
        score: 0,
        streak: 0,
        correctCount: 0,
        answer: null,
        prevRank: 0,
        streams: new Set(),
      };
      room.players.set(p.id, p);
      push(room);
      send(res, 201, { token: p.token, id: p.id, name: p.name });
      return true;
    }

    if (action === 'cevap') {
      const p = [...room.players.values()].find((x) => x.token === body.token);
      if (!p) return send(res, 403, { error: 'Oyunda kaydınız bulunamadı.' }), true;
      const err = answer(room, p, body.choice);
      send(res, err ? 409 : 200, err ? { error: err } : { ok: true });
      return true;
    }

    // Oyuncu kendi isteğiyle ayrılır
    if (action === 'ayril') {
      const p = [...room.players.values()].find((x) => x.token === body.token);
      if (p) removePlayer(room, p, 'Oyundan ayrıldın.');
      send(res, 200, { ok: true });
      return true;
    }

    if (action === 'komut') {
      if (body.hostToken !== room.hostToken) return send(res, 403, { error: 'Bu odayı yönetme izniniz yok.' }), true;
      let err = null;
      switch (body.type) {
        case 'basla': err = await start(room, body); break;
        case 'bitir-sure': if (room.phase === 'soru') closeAnswers(room); break;
        case 'tablo': if (room.phase === 'sonuc') { room.phase = 'tablo'; push(room); } break;
        case 'sonraki': if (room.phase === 'sonuc' || room.phase === 'tablo') nextQuestion(room); break;
        case 'bitir': if (room.phase !== 'lobi' && room.phase !== 'bitti') finish(room); break;
        case 'lobi': backToLobby(room); break;
        case 'at': {
          const p = room.players.get(String(body.id));
          if (p) removePlayer(room, p, 'Oyundan çıkarıldınız.');
          break;
        }
        case 'kapat': closeRoom(room, 'Sunucu oyunu kapattı.'); break;
        default: err = 'Bilinmeyen komut.';
      }
      send(res, err ? 409 : 200, err ? { error: err } : { ok: true });
      return true;
    }
    return false;
  };
}
