// Tek oyunculu oyun oturumları. Cevap anahtarı yalnızca sunucuda durur:
// istemci soruları ve karışık şıkları (hangisinin doğru olduğu belirtilmeden) alır, seçtiği şıkkın
// sırasını gönderir; doğru şık ve açıklamalar yalnızca o sorunun cevabı kesinleşince döner.
// İstatistik, oyun bittiğinde sunucunun doğruladığı cevaplardan bir kez yazılır.
import { randomInt, randomUUID } from 'node:crypto';

const SESSION_TTL_MS = 2 * 60 * 60 * 1000; // işlem yapılmayan oturum silinir
const MAX_SESSIONS = 5000;
const LIFELINES = new Set(['fifty', 'hint', 'double']);
const TOKEN_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Açıklama metinlerinin harfleri maskelenmiş kopyası: istemci yazı boyutunu metnin uzunluğuna ve
 * kelime yapısına göre seçebilir, ama içerik (dolayısıyla cevap) okunamaz.
 */
export function maskText(s) {
  return s.replace(/\p{Lu}/gu, 'N').replace(/\p{Ll}/gu, 'n');
}

const isIndex = (v, len) => Number.isInteger(v) && v >= 0 && v < len;

/** Gövdede yalnızca izin verilen alanlar olmalı. */
function onlyKeys(body, allowed) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
  return Object.keys(body).every((k) => allowed.includes(k));
}

/**
 * @param {{
 *   getGame: () => Promise<{ questions: any[], settings: any }>,
 *   recordGame: (answers: { id: string, correct: boolean }[], finished: boolean) => Promise<void>,
 *   HttpError: new (status: number, message: string) => Error,
 *   now?: () => number,
 * }} deps
 */
export function createSessions({ getGame, recordGame, HttpError, now = Date.now }) {
  /** @type {Map<string, any>} */
  const sessions = new Map();
  const bad = (msg = 'Geçersiz istek.') => new HttpError(400, msg);
  const conflict = (msg) => new HttpError(409, msg);

  function sweep() {
    const t = now();
    for (const [k, s] of sessions) if (t - s.touched > SESSION_TTL_MS) sessions.delete(k);
  }
  setInterval(sweep, 10 * 60 * 1000).unref?.();

  function find(token) {
    const s = typeof token === 'string' && TOKEN_RE.test(token) ? sessions.get(token) : undefined;
    if (!s || now() - s.touched > SESSION_TTL_MS) {
      if (s) sessions.delete(token);
      throw new HttpError(404, 'Oyun bulunamadı ya da süresi doldu. Yeni oyun başlatın.');
    }
    s.touched = now();
    return s;
  }

  /** Doğru şıkkı ve tüm açıklamaları içeren, cevap kesinleştikten sonraki yanıt. */
  function verdict(s, r) {
    return {
      sonuc: r.result.timeout ? 'sure' : r.result.correct ? 'dogru' : 'yanlis',
      dogruSik: r.options.findIndex((o) => o.correct),
      aciklamalar: r.options.map((o) => o.why),
      bitti: s.over,
      dogruSayisi: s.correct,
    };
  }

  async function finishIfOver(s) {
    if (!s.over || s.recorded) return;
    s.recorded = true; // aynı oyun ikinci kez yazılmaz
    try {
      await recordGame(s.log, !s.lost);
    } catch (err) {
      s.recorded = false;
      throw err;
    }
  }

  function settle(s, r, correct, timeout) {
    r.result = { correct, timeout, choice: timeout ? null : r.choice };
    s.log.push({ id: r.id, correct });
    if (correct) s.correct += 1;
    const last = s.index >= s.rounds.length - 1;
    if ((!correct && s.settings.endOnWrong) || last) {
      s.over = true;
      s.lost = !correct && s.settings.endOnWrong;
    }
  }

  /** Oturum açar. */
  async function start() {
    if (sessions.size >= MAX_SESSIONS) sweep();
    if (sessions.size >= MAX_SESSIONS) throw new HttpError(503, 'Şu anda çok fazla aktif oyun var, biraz sonra deneyin.');
    const { questions, settings } = await getGame();
    const pool = questions.filter((q) => q.aktif !== false && q.soru && q.dogru && q.yanlislar?.length === 3);
    if (!pool.length) throw new HttpError(409, 'Henüz soru eklenmemiş. Yönetici panelinden soru ekleyin.');
    const picked = shuffle([...pool]).slice(0, Math.max(1, Math.min(settings.questionsPerGame, pool.length)));
    const s = {
      token: randomUUID(),
      touched: now(),
      settings: { questionsPerGame: settings.questionsPerGame, endOnWrong: settings.endOnWrong !== false, secondsPerQuestion: settings.secondsPerQuestion },
      rounds: picked.map((q) => ({
        id: q.id,
        soru: q.soru,
        kategori: q.kategori ?? '',
        ipucu: q.ipucu?.trim() ?? '',
        options: shuffle([
          { text: q.dogru, correct: true, why: q.aciklama?.trim() ?? '', removed: false },
          ...q.yanlislar.map((text, i) => ({ text, correct: false, why: q.yanlisAciklamalar?.[i]?.trim() ?? '', removed: false })),
        ]),
        result: null,
        retried: null,
        lifelines: {},
      })),
      index: 0,
      correct: 0,
      log: [],
      lifelines: { fifty: true, hint: true, double: true },
      doubleArmed: false,
      over: false,
      lost: false,
      recorded: false,
    };
    sessions.set(s.token, s);

    // Yazı boyutu seçimi için tüm aktif havuzun metinleri: soru ve şıklar kaynağından bağımsız sıralanır
    // (hangi şıkkın hangi soruya ait ve doğru olduğu çıkarılamaz), açıklamalar maskelenir.
    const tr = (a, b) => a.localeCompare(b, 'tr');
    const olcu = {
      sorular: pool.map((q) => q.soru).sort(tr),
      secenekler: pool.flatMap((q) => [q.dogru, ...q.yanlislar]).sort(tr),
      aciklamalar: pool.flatMap((q) => [q.aciklama ?? '', ...(q.yanlisAciklamalar ?? [])]).map((t) => t.trim()).filter(Boolean).map(maskText),
    };
    return {
      token: s.token,
      ayarlar: s.settings,
      sorular: s.rounds.map((r) => ({ soru: r.soru, kategori: r.kategori, secenekler: r.options.map((o) => o.text) })),
      olcu,
    };
  }

  /** Cevap: { index, secim } ya da süre dolduysa { index, sureDoldu: true }. */
  async function answer(token, body) {
    if (!onlyKeys(body, ['index', 'secim', 'sureDoldu'])) throw bad();
    const s = find(token);
    const timeout = body.sureDoldu === true;
    if (body.sureDoldu !== undefined && body.sureDoldu !== true) throw bad();
    if (timeout === (body.secim !== undefined)) throw bad('Bir şık seçin ya da süre dolduğunu bildirin.');
    if (!isIndex(body.index, s.rounds.length)) throw bad('Geçersiz soru.');
    if (!timeout && !isIndex(body.secim, 4)) throw bad('Geçersiz şık.');
    const r = s.rounds[body.index];

    // Aynı cevabın yeniden gönderimi (ör. ağ hatasından sonra) aynı sonucu döndürür, hiçbir şeyi değiştirmez.
    if (r.result) {
      const same = timeout ? r.result.timeout : r.result.choice === body.secim;
      if (same) {
        await finishIfOver(s);
        return verdict(s, r);
      }
      throw conflict('Bu soru zaten cevaplandı.');
    }
    if (s.over || body.index !== s.index) throw conflict('Bu soru şu anda cevaplanamaz.');
    if (!timeout && r.options[body.secim].removed) {
      // Çift cevaptaki ilk yanlışın yeniden gönderimi
      if (r.retried === body.secim) return { sonuc: 'tekrar', elenen: body.secim, aciklama: r.options[body.secim].why };
      throw bad('Bu şık elendi.');
    }

    if (timeout) {
      s.doubleArmed = false;
      settle(s, r, false, true);
    } else {
      const o = r.options[body.secim];
      if (!o.correct && s.doubleArmed) {
        // Çift cevap: ilk yanlış şık elenir, doğru şık açıklanmaz.
        s.doubleArmed = false;
        o.removed = true;
        r.retried = body.secim;
        return { sonuc: 'tekrar', elenen: body.secim, aciklama: o.why };
      }
      s.doubleArmed = false;
      r.choice = body.secim;
      settle(s, r, o.correct, false);
    }
    await finishIfOver(s);
    return verdict(s, r);
  }

  /** Joker: { index, tur: 'fifty' | 'hint' | 'double' }. */
  function lifeline(token, body) {
    if (!onlyKeys(body, ['index', 'tur'])) throw bad();
    const s = find(token);
    if (!LIFELINES.has(body.tur)) throw bad('Geçersiz joker.');
    if (!isIndex(body.index, s.rounds.length)) throw bad('Geçersiz soru.');
    const r = s.rounds[body.index];
    if (r.lifelines[body.tur]) return r.lifelines[body.tur]; // yeniden gönderim
    if (s.over || r.result || body.index !== s.index) throw conflict('Joker şu anda kullanılamaz.');
    if (!s.lifelines[body.tur]) throw conflict('Bu joker zaten kullanıldı.');
    s.lifelines[body.tur] = false;

    let res;
    const wrong = () => r.options.map((o, i) => (!o.correct && !o.removed ? i : -1)).filter((i) => i >= 0);
    if (body.tur === 'fifty') {
      const w = wrong();
      const removed = shuffle(w).slice(0, Math.max(0, w.length - 1)).slice(0, 2);
      for (const i of removed) r.options[i].removed = true;
      res = { elenen: removed };
    } else if (body.tur === 'hint') {
      if (r.ipucu) res = { ipucu: r.ipucu, elenen: [] };
      else {
        const w = wrong();
        const i = w.length > 1 ? w[randomInt(w.length)] : -1;
        if (i >= 0) r.options[i].removed = true;
        res = { ipucu: 'Bu soru için ipucu yok, bir yanlış şık elendi.', elenen: i >= 0 ? [i] : [] };
      }
    } else {
      s.doubleArmed = true;
      res = { ok: true };
    }
    r.lifelines[body.tur] = res;
    return res;
  }

  /** Sıradaki soruya geçiş: önceki soru cevaplanmış olmalı. */
  function advance(s) {
    const r = s.rounds[s.index];
    if (r?.result && !s.over && s.index < s.rounds.length - 1) s.index += 1;
  }

  return {
    start,
    async answer(token, body) {
      const res = await answer(token, body);
      const s = sessions.get(token);
      if (s && res.sonuc !== 'tekrar') advance(s);
      return res;
    },
    lifeline,
    get size() {
      return sessions.size;
    },
  };
}
