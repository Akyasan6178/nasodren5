// Tek oyunculu oyun oturumu — saf durum makinesi. Durum düz JSON'dur (Durable Object deposunda saklanır).
// Cevap anahtarı yalnızca bu durumdadır: istemci soruları ve karışık şıkları (hangisinin doğru olduğu
// belirtilmeden) alır; doğru şık ve açıklamalar yalnızca o sorunun cevabı kesinleşince döner.
import { HttpError, isIndex, maskText, onlyKeys, randomInt, shuffle, uuid } from './ortak.mjs';

export const SESSION_TTL_MS = 2 * 60 * 60 * 1000; // işlem yapılmayan oturum silinir
const LIFELINES = ['fifty', 'hint', 'double'];

const bad = (msg = 'Geçersiz istek.') => new HttpError(400, msg);
const conflict = (msg) => new HttpError(409, msg);

/**
 * Yeni oturum. `questions`: aktif sorular (tam veri), `settings`: oyun ayarları.
 * @returns {{ state: object, response: object }}
 */
export function newSession({ questions, settings, now, token = uuid() }) {
  const pool = questions.filter((q) => q.aktif !== false && q.soru && q.dogru && q.yanlislar?.length === 3);
  if (!pool.length) throw new HttpError(409, 'Henüz soru eklenmemiş. Yönetici panelinden soru ekleyin.');
  const picked = shuffle([...pool]).slice(0, Math.max(1, Math.min(settings.questionsPerGame, pool.length)));
  const state = {
    v: 1,
    token,
    gameId: uuid(), // istatistik idempotency anahtarı (oturum anahtarından ayrı)
    created: now,
    touched: now,
    settings: {
      questionsPerGame: settings.questionsPerGame,
      endOnWrong: settings.endOnWrong !== false,
      secondsPerQuestion: settings.secondsPerQuestion,
    },
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
  // Yazı boyutu seçimi için tüm aktif havuzun metinleri: soru ve şıklar kaynağından bağımsız sıralanır
  // (hangi şıkkın hangi soruya ait ve doğru olduğu çıkarılamaz), açıklamalar maskelenir.
  const tr = (a, b) => a.localeCompare(b, 'tr');
  const response = {
    token,
    ayarlar: state.settings,
    sorular: state.rounds.map((r) => ({ soru: r.soru, kategori: r.kategori, secenekler: r.options.map((o) => o.text) })),
    olcu: {
      sorular: pool.map((q) => q.soru).sort(tr),
      secenekler: pool.flatMap((q) => [q.dogru, ...q.yanlislar]).sort(tr),
      aciklamalar: pool.flatMap((q) => [q.aciklama ?? '', ...(q.yanlisAciklamalar ?? [])]).map((t) => t.trim()).filter(Boolean).map(maskText),
    },
  };
  return { state, response };
}

export const isExpired = (state, now) => now - state.touched > SESSION_TTL_MS;

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

function settle(s, r, correct, timeout, choice) {
  r.result = { correct, timeout, choice: timeout ? null : choice };
  s.log.push({ id: r.id, correct });
  if (correct) s.correct += 1;
  const last = s.index >= s.rounds.length - 1;
  if ((!correct && s.settings.endOnWrong) || last) {
    s.over = true;
    s.lost = !correct && s.settings.endOnWrong;
  } else {
    s.index += 1;
  }
}

/** Oyun bittiyse ve henüz kaydedilmediyse kaydedilecek sonuç (aksi hâlde null). */
export function pendingRecord(s) {
  return s.over && !s.recorded ? { gameId: s.gameId, answers: s.log, finished: !s.lost } : null;
}

/**
 * Cevap: { index, secim } ya da süre dolduysa { index, sureDoldu: true }.
 * Durumu yerinde değiştirir ve yanıt gövdesini döndürür. Hatalarda HttpError fırlatır (durum değişmez).
 */
export function answer(s, body) {
  if (!onlyKeys(body, ['index', 'secim', 'sureDoldu'])) throw bad();
  const timeout = body.sureDoldu === true;
  if (body.sureDoldu !== undefined && body.sureDoldu !== true) throw bad();
  if (timeout === (body.secim !== undefined)) throw bad('Bir şık seçin ya da süre dolduğunu bildirin.');
  if (!isIndex(body.index, s.rounds.length)) throw bad('Geçersiz soru.');
  if (!timeout && !isIndex(body.secim, 4)) throw bad('Geçersiz şık.');
  const r = s.rounds[body.index];

  // Aynı cevabın yeniden gönderimi (ör. ağ hatasından sonra) aynı sonucu döndürür, hiçbir şeyi değiştirmez.
  if (r.result) {
    const same = timeout ? r.result.timeout : r.result.choice === body.secim;
    if (same) return verdict(s, r);
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
    settle(s, r, false, true, null);
    return verdict(s, r);
  }
  const o = r.options[body.secim];
  if (!o.correct && s.doubleArmed) {
    // Çift cevap: ilk yanlış şık elenir, doğru şık açıklanmaz.
    s.doubleArmed = false;
    o.removed = true;
    r.retried = body.secim;
    return { sonuc: 'tekrar', elenen: body.secim, aciklama: o.why };
  }
  s.doubleArmed = false;
  settle(s, r, o.correct, false, body.secim);
  return verdict(s, r);
}

/** Joker: { index, tur: 'fifty' | 'hint' | 'double' }. */
export function lifeline(s, body) {
  if (!onlyKeys(body, ['index', 'tur'])) throw bad();
  if (!LIFELINES.includes(body.tur)) throw bad('Geçersiz joker.');
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
