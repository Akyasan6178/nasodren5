// Veri katmanının çekirdeği. Tarayıcı ve Vite'a bağımlı değildir (fetch ve depolama dışarıdan verilir),
// bu yüzden Node testleriyle doğrudan çalıştırılabilir.
//
// İki mod vardır ve çalışma anında tahmin edilmez; yapılandırmayla seçilir (VITE_VERI_MODU):
//   sunucu (varsayılan) — tüm veri API'den gelir. API hatası (ağ, zaman aşımı, 5xx, bozuk yanıt) kullanıcıya
//                         hata olarak bildirilir; yerel veriye ASLA düşülmez ve yerel veriye yazılmaz.
//   yerel               — sunucusuz, statik barındırma. Sorular seed dosyasından okunur ve bu tarayıcının
//                         localStorage'ında tutulur.

export interface Question {
  id: string;
  soru: string;
  dogru: string;
  yanlislar: string[];
  kategori?: string;
  ipucu?: string;
  /** Doğru cevabın neden doğru olduğu (cevaptan sonra gösterilir). */
  aciklama?: string;
  /** Her yanlış şıkkın neden yanlış olduğu; `yanlislar` ile aynı sırada. */
  yanlisAciklamalar?: string[];
  aktif?: boolean;
  olusturma?: string;
}
/** secondsPerQuestion = 0 ise süre sınırı yoktur. surum: sunucudaki ayarların sürümü (eşzamanlı yazma koruması). */
export interface Settings { questionsPerGame: number; endOnWrong: boolean; secondsPerQuestion: number; surum?: number }
export interface Stats {
  games: number;
  finished: number;
  totalCorrect: number;
  perQuestion: Record<string, { asked: number; correct: number }>;
}
export interface AnswerLog { id: string; correct: boolean }
export type DataMode = 'sunucu' | 'yerel';

/** Oyuncuya gönderilen soru: hangi şıkkın doğru olduğu yoktur. */
export interface PublicRound { soru: string; kategori: string; secenekler: string[] }
/** Cevap kesinleşince gelen sonuç: doğru şık ve dört şıkkın açıklaması. */
export interface Verdict { sonuc: 'dogru' | 'yanlis' | 'sure'; dogruSik: number; aciklamalar: string[]; bitti: boolean; dogruSayisi: number }
/** Çift cevap jokerinde ilk yanlış: şık elenir, doğru şık açıklanmaz. */
export interface Retry { sonuc: 'tekrar'; elenen: number; aciklama: string }
export type AnswerResult = Verdict | Retry;
export type LifelineKind = 'fifty' | 'hint' | 'double';
export interface LifelineResult { elenen?: number[]; ipucu?: string; ok?: boolean }
/** Cevapları değerlendiren taraf (sunucu ya da yerel mod). */
export interface Judge {
  answer(index: number, secim: number): Promise<AnswerResult>;
  timeout(index: number): Promise<Verdict>;
  lifeline(index: number, tur: LifelineKind): Promise<LifelineResult>;
}
/** Yazı boyutu seçimi için havuzdaki metinler (açıklamalar maskelenmiş olabilir). */
export interface TextSample { sorular: string[]; secenekler: string[]; aciklamalar: string[] }
export interface GameStart { ayarlar: Settings; sorular: PublicRound[]; olcu: TextSample; judge: Judge }

export const DEFAULT_SETTINGS: Settings = { questionsPerGame: 15, endOnWrong: true, secondsPerQuestion: 30 };
const DEFAULT_STATS: Stats = { games: 0, finished: 0, totalCorrect: 0, perQuestion: {} };
const LS = { questions: 'siklamen.sorular', settings: 'siklamen.ayarlar', stats: 'siklamen.istatistik' };

export const MESSAGES = {
  network: 'Sunucuya ulaşılamadı. Bağlantınızı kontrol edip tekrar deneyin.',
  timeout: 'Sunucu zamanında yanıt vermedi. Lütfen tekrar deneyin.',
  invalid: 'Sunucudan geçersiz bir yanıt alındı. Lütfen tekrar deneyin.',
  server: 'Sunucu hatası. Lütfen biraz sonra tekrar deneyin.',
};

export type ApiErrorKind = 'network' | 'timeout' | 'invalid' | 'server' | 'http';
export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number;
  constructor(kind: ApiErrorKind, message: string, status = 0) {
    super(message);
    this.kind = kind;
    this.status = status;
  }
}

/** Yalnızca açıkça "yerel" yazılırsa yerel mod; aksi hâlde sunucu modu. */
export function resolveMode(value: unknown): DataMode {
  return value === 'yerel' ? 'yerel' : 'sunucu';
}

export interface KeyValueStorage { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }
type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; cache?: string; credentials?: string; signal?: AbortSignal }) => Promise<{
  ok: boolean; status: number; headers: { get(name: string): string | null }; text(): Promise<string>;
}>;

export interface StoreDeps {
  mode: DataMode;
  fetch: FetchLike;
  /** Yerel mod verisi (localStorage). Sunucu modunda soru/ayar/istatistik için kullanılmaz. */
  storage?: KeyValueStorage | null;
  seedUrl: string;
  timeoutMs?: number;
  rng?: () => number;
}

function safe<T>(fn: () => T, fallback: T): T {
  try { return fn(); } catch { return fallback; }
}

function shuffle<T>(arr: T[], rng: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Tüm alanlar zorunludur; sunucudaki cleanQuestion ile aynı kurallar. */
export function validate(q: Pick<Question, 'soru' | 'dogru' | 'yanlislar' | 'kategori' | 'ipucu' | 'aciklama' | 'yanlisAciklamalar'>): string | null {
  const empty = (s?: string) => !s?.trim();
  if (empty(q.soru)) return 'Soru metni boş olamaz.';
  if (empty(q.kategori)) return 'Kategori boş olamaz.';
  if (empty(q.dogru)) return 'Doğru cevap boş olamaz.';
  if (empty(q.aciklama)) return 'Doğru cevabın neden doğru olduğunu yazın.';
  if (!Array.isArray(q.yanlislar) || q.yanlislar.length !== 3 || q.yanlislar.some(empty)) return 'Üç yanlış cevap girilmelidir.';
  if (!Array.isArray(q.yanlisAciklamalar) || q.yanlisAciklamalar.length !== 3 || q.yanlisAciklamalar.some(empty)) return 'Her yanlış cevabın neden yanlış olduğunu yazın.';
  if (empty(q.ipucu)) return 'İpucu boş olamaz.';
  const all = [q.dogru, ...q.yanlislar].map((s) => s.trim().toLocaleLowerCase('tr'));
  if (new Set(all).size !== 4) return 'Cevap şıkları birbirinden farklı olmalıdır.';
  return null;
}

/**
 * Yerel mod oyunu: sunucudaki oturumla aynı kurallar, ama cevap anahtarı tarayıcıdadır
 * (sunucusuz barındırmada kaçınılmaz). Yalnızca açıkça seçilen yerel modda kullanılır.
 */
export function createLocalGame(
  pool: Question[],
  settings: Settings,
  onOver: (log: AnswerLog[], finished: boolean) => void,
  rng: () => number = Math.random,
): GameStart {
  const picked = shuffle([...pool], rng).slice(0, Math.max(1, Math.min(settings.questionsPerGame, pool.length)));
  const rounds = picked.map((q) => ({
    id: q.id,
    ipucu: q.ipucu?.trim() ?? '',
    soru: q.soru,
    kategori: q.kategori ?? '',
    options: shuffle([
      { text: q.dogru, correct: true, why: q.aciklama?.trim() ?? '', removed: false },
      ...q.yanlislar.map((text, i) => ({ text, correct: false, why: q.yanlisAciklamalar?.[i]?.trim() ?? '', removed: false })),
    ], rng),
    done: null as Verdict | null,
  }));
  let index = 0;
  let correct = 0;
  let over = false;
  let doubleArmed = false;
  const used: Record<LifelineKind, boolean> = { fifty: false, hint: false, double: false };
  const log: AnswerLog[] = [];

  const settle = (i: number, ok: boolean, timedOut: boolean): Verdict => {
    const r = rounds[i];
    log.push({ id: r.id, correct: ok });
    if (ok) correct++;
    const lost = !ok && settings.endOnWrong;
    over = lost || i >= rounds.length - 1;
    r.done = {
      sonuc: timedOut ? 'sure' : ok ? 'dogru' : 'yanlis',
      dogruSik: r.options.findIndex((o) => o.correct),
      aciklamalar: r.options.map((o) => o.why),
      bitti: over,
      dogruSayisi: correct,
    };
    if (over) onOver(log, !lost);
    else index = i + 1;
    return r.done;
  };
  const check = (i: number) => {
    if (!Number.isInteger(i) || i !== index || over) throw new ApiError('http', 'Bu soru şu anda cevaplanamaz.', 409);
  };

  const judge: Judge = {
    async answer(i, secim) {
      if (rounds[i]?.done) return rounds[i].done!;
      check(i);
      const o = rounds[i].options[secim];
      if (!o || o.removed) throw new ApiError('http', 'Geçersiz şık.', 400);
      if (!o.correct && doubleArmed) {
        doubleArmed = false;
        o.removed = true;
        return { sonuc: 'tekrar', elenen: secim, aciklama: o.why };
      }
      doubleArmed = false;
      return settle(i, o.correct, false);
    },
    async timeout(i) {
      if (rounds[i]?.done) return rounds[i].done!;
      check(i);
      doubleArmed = false;
      return settle(i, false, true);
    },
    async lifeline(i, tur) {
      check(i);
      if (used[tur]) throw new ApiError('http', 'Bu joker zaten kullanıldı.', 409);
      used[tur] = true;
      const r = rounds[i];
      const wrong = () => r.options.map((o, k) => (!o.correct && !o.removed ? k : -1)).filter((k) => k >= 0);
      if (tur === 'fifty') {
        const w = wrong();
        const removed = shuffle(w, rng).slice(0, Math.max(0, w.length - 1)).slice(0, 2);
        for (const k of removed) r.options[k].removed = true;
        return { elenen: removed };
      }
      if (tur === 'hint') {
        if (r.ipucu) return { ipucu: r.ipucu, elenen: [] };
        const w = wrong();
        const k = w.length > 1 ? w[Math.floor(rng() * w.length)] : -1;
        if (k >= 0) r.options[k].removed = true;
        return { ipucu: 'Bu soru için ipucu yok, bir yanlış şık elendi.', elenen: k >= 0 ? [k] : [] };
      }
      doubleArmed = true;
      return { ok: true };
    },
  };

  return {
    ayarlar: settings,
    sorular: rounds.map((r) => ({ soru: r.soru, kategori: r.kategori, secenekler: r.options.map((o) => o.text) })),
    olcu: {
      sorular: pool.map((q) => q.soru),
      secenekler: pool.flatMap((q) => [q.dogru, ...q.yanlislar]),
      aciklamalar: pool.flatMap((q) => [q.aciklama ?? '', ...(q.yanlisAciklamalar ?? [])]).map((t) => t.trim()).filter(Boolean),
    },
    judge,
  };
}

export function createStore(deps: StoreDeps) {
  const { mode, seedUrl, timeoutMs = 15_000, rng = Math.random } = deps;
  const storage = deps.storage ?? null;

  function lsGet<T>(key: string, fallback: T): T {
    return safe(() => {
      const v = storage?.getItem(key);
      return v ? (JSON.parse(v) as T) : structuredClone(fallback);
    }, structuredClone(fallback));
  }
  function lsSet(key: string, value: unknown) {
    if (mode !== 'yerel') throw new Error('Sunucu modunda yerel veri yazılmaz.');
    safe(() => storage?.setItem(key, JSON.stringify(value)), undefined);
  }

  /** API çağrısı. Her hata türü ApiError olarak, kullanıcıya gösterilebilir mesajla fırlatılır. */
  async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; ctrl?.abort(); }, timeoutMs);
    let res: Awaited<ReturnType<FetchLike>>;
    let text: string;
    try {
      // Yönetici oturumu HttpOnly cookie'dedir: tarayıcı onu aynı origin isteklerine kendisi ekler;
      // JavaScript parolayı ya da oturum anahtarını hiçbir yerde saklamaz.
      res = await deps.fetch(url, {
        method,
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ctrl?.signal,
      });
      text = await res.text();
    } catch {
      throw new ApiError(timedOut ? 'timeout' : 'network', timedOut ? MESSAGES.timeout : MESSAGES.network);
    } finally {
      clearTimeout(timer);
    }
    let data: unknown;
    const isJson = res.headers.get('content-type')?.includes('application/json');
    try {
      data = isJson ? JSON.parse(text) : undefined;
    } catch {
      data = undefined;
    }
    const msg = (data as { error?: unknown } | undefined)?.error;
    if (!res.ok) {
      if (res.status >= 500) throw new ApiError('server', typeof msg === 'string' ? msg : MESSAGES.server, res.status);
      throw new ApiError('http', typeof msg === 'string' ? msg : `İstek başarısız (${res.status}).`, res.status);
    }
    if (data === undefined || data === null || typeof data !== 'object') throw new ApiError('invalid', MESSAGES.invalid, res.status);
    return data as T;
  }

  async function localQuestions(): Promise<Question[]> {
    const saved = lsGet<Question[] | null>(LS.questions, null);
    if (saved) return saved;
    let seed: unknown;
    try {
      const r = await deps.fetch(seedUrl, { cache: 'no-store' });
      seed = r.ok ? JSON.parse(await r.text()) : null;
    } catch {
      seed = null;
    }
    if (!Array.isArray(seed)) throw new ApiError('invalid', 'Varsayılan sorular yüklenemedi.');
    lsSet(LS.questions, seed);
    return seed as Question[];
  }

  /** Sunucu oturumu: cevaplar sunucuda değerlendirilir. */
  function remoteJudge(token: string): Judge {
    const base = `/api/oyun/oturum/${encodeURIComponent(token)}`;
    return {
      answer: (index, secim) => call<AnswerResult>('POST', `${base}/cevap`, { index, secim }),
      timeout: (index) => call<Verdict>('POST', `${base}/cevap`, { index, sureDoldu: true }),
      lifeline: (index, tur) => call<LifelineResult>('POST', `${base}/joker`, { index, tur }),
    };
  }

  function recordLocal(log: AnswerLog[], finished: boolean) {
    const stats = lsGet(LS.stats, DEFAULT_STATS);
    stats.games += 1;
    if (finished) stats.finished += 1;
    for (const a of log) {
      const s = (stats.perQuestion[a.id] ??= { asked: 0, correct: 0 });
      s.asked += 1;
      if (a.correct) { s.correct += 1; stats.totalCorrect += 1; }
    }
    lsSet(LS.stats, stats);
  }

  return {
    mode,

    async detectMode(): Promise<DataMode> {
      return mode;
    },

    /** Yeni oyun: sunucu modunda sunucuda oturum açılır. Soru yoksa 409 hatası gelir. */
    async startGame(): Promise<GameStart> {
      if (mode === 'sunucu') {
        const r = await call<{ token: string; ayarlar: Settings; sorular: PublicRound[]; olcu: TextSample }>('POST', '/api/oyun/oturum');
        if (typeof r.token !== 'string' || !Array.isArray(r.sorular)) throw new ApiError('invalid', MESSAGES.invalid);
        return { ayarlar: { ...DEFAULT_SETTINGS, ...r.ayarlar }, sorular: r.sorular, olcu: r.olcu ?? { sorular: [], secenekler: [], aciklamalar: [] }, judge: remoteJudge(r.token) };
      }
      const pool = (await localQuestions()).filter((q) => q.aktif !== false);
      if (!pool.length) throw new ApiError('http', 'Henüz soru eklenmemiş. Yönetici panelinden soru ekleyin.', 409);
      const settings = { ...DEFAULT_SETTINGS, ...lsGet(LS.settings, {}) };
      return createLocalGame(pool, settings, recordLocal, rng);
    },

    // ---------- yönetici ----------

    /** Yönetici girişi: başarılıysa sunucu kısa ömürlü HttpOnly oturum cookie'si verir. */
    async login(parola: string): Promise<void> {
      if (mode !== 'sunucu') return;
      await call('POST', '/api/admin/oturum', { parola });
    },
    /** Çıkış: oturum cookie'si silinir. */
    async logout(): Promise<void> {
      if (mode !== 'sunucu') return;
      await call('DELETE', '/api/admin/oturum');
    },

    async loadAdmin(): Promise<{ questions: Question[]; settings: Settings; stats: Stats }> {
      if (mode === 'sunucu') return call('GET', '/api/admin');
      return {
        questions: await localQuestions(),
        settings: { ...DEFAULT_SETTINGS, ...lsGet(LS.settings, {}) },
        stats: lsGet(LS.stats, DEFAULT_STATS),
      };
    },

    async saveQuestion(q: Question | Omit<Question, 'id'>): Promise<void> {
      const err = validate(q);
      if (err) throw new Error(err);
      const id = 'id' in q ? q.id : '';
      if (mode === 'sunucu') {
        await (id ? call('PUT', `/api/sorular/${encodeURIComponent(id)}`, q) : call('POST', '/api/sorular', q));
        return;
      }
      const list = await localQuestions();
      const i = id ? list.findIndex((x) => x.id === id) : -1;
      if (i >= 0) list[i] = { ...list[i], ...q, id };
      else list.push({ ...q, id: crypto.randomUUID(), olusturma: new Date().toISOString() });
      lsSet(LS.questions, list);
    },

    async deleteQuestion(id: string): Promise<void> {
      if (mode === 'sunucu') {
        await call('DELETE', `/api/sorular/${encodeURIComponent(id)}`);
        return;
      }
      lsSet(LS.questions, (await localQuestions()).filter((x) => x.id !== id));
    },

    async replaceAll(list: Question[]): Promise<void> {
      if (!Array.isArray(list)) throw new Error('Geçersiz dosya: soru listesi bekleniyor.');
      if (mode === 'sunucu') {
        await call('PUT', '/api/sorular', list);
        return;
      }
      list.forEach((q, i) => {
        const err = validate(q);
        if (err) throw new Error(`${i + 1}. soru: ${err}`);
      });
      lsSet(LS.questions, list.map((q) => ({ aktif: true, ...q, id: q.id || crypto.randomUUID() })));
    },

    async saveSettings(s: Settings): Promise<void> {
      if (mode === 'sunucu') {
        await call('PUT', '/api/ayarlar', s);
        return;
      }
      lsSet(LS.settings, s);
    },

    async resetStats(): Promise<void> {
      if (mode === 'sunucu') {
        await call('DELETE', '/api/istatistik');
        return;
      }
      lsSet(LS.stats, DEFAULT_STATS);
    },
  };
}
