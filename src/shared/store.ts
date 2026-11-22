// Veri katmanı. Sunucu API'si varsa onu kullanır; sayfa statik barındırılıyorsa
// (API yoksa) tarayıcının localStorage'ına düşer.

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
/** secondsPerQuestion = 0 ise süre sınırı yoktur. */
export interface Settings { questionsPerGame: number; endOnWrong: boolean; secondsPerQuestion: number }
export interface Stats {
  games: number;
  finished: number;
  totalCorrect: number;
  perQuestion: Record<string, { asked: number; correct: number }>;
}
export interface AnswerLog { id: string; correct: boolean }

export const DEFAULT_SETTINGS: Settings = { questionsPerGame: 15, endOnWrong: true, secondsPerQuestion: 30 };
const DEFAULT_STATS: Stats = { games: 0, finished: 0, totalCorrect: 0, perQuestion: {} };
const LS = { questions: 'siklamen.sorular', settings: 'siklamen.ayarlar', stats: 'siklamen.istatistik', key: 'siklamen.key' };
const SEED_URL = `${import.meta.env.BASE_URL}data/varsayilan-sorular.json`;

type Mode = 'api' | 'local';
let mode: Promise<Mode> | null = null;
let adminKey = safe(() => sessionStorage.getItem(LS.key), null) ?? '';

function safe<T>(fn: () => T, fallback: T): T {
  try { return fn(); } catch { return fallback; }
}
function lsGet<T>(key: string, fallback: T): T {
  return safe(() => {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : structuredClone(fallback);
  }, structuredClone(fallback));
}
function lsSet(key: string, value: unknown) {
  safe(() => localStorage.setItem(key, JSON.stringify(value)), undefined);
}

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json', 'x-admin-key': adminKey },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `İstek başarısız (${res.status})`), { status: res.status });
  return data as T;
}

export function detectMode(): Promise<Mode> {
  return (mode ??= fetch('/api/oyun', { cache: 'no-store' })
    .then((r) => (r.ok && r.headers.get('content-type')?.includes('json') ? 'api' : 'local') as Mode)
    .catch(() => 'local' as Mode));
}

async function localQuestions(): Promise<Question[]> {
  const saved = lsGet<Question[] | null>(LS.questions, null);
  if (saved) return saved;
  const seed = (await fetch(SEED_URL).then((r) => r.json())) as Question[];
  lsSet(LS.questions, seed);
  return seed;
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

// ---------- oyun ----------

export async function loadGame(): Promise<{ questions: Question[]; settings: Settings }> {
  if ((await detectMode()) === 'api') return call('GET', '/api/oyun');
  return {
    questions: (await localQuestions()).filter((q) => q.aktif !== false),
    settings: { ...DEFAULT_SETTINGS, ...lsGet(LS.settings, {}) },
  };
}

export async function reportResult(answers: AnswerLog[], finished: boolean): Promise<void> {
  try {
    if ((await detectMode()) === 'api') {
      await call('POST', '/api/sonuc', { answers, finished });
      return;
    }
    const stats = lsGet(LS.stats, DEFAULT_STATS);
    stats.games += 1;
    if (finished) stats.finished += 1;
    for (const a of answers) {
      const s = (stats.perQuestion[a.id] ??= { asked: 0, correct: 0 });
      s.asked += 1;
      if (a.correct) { s.correct += 1; stats.totalCorrect += 1; }
    }
    lsSet(LS.stats, stats);
  } catch {
    /* istatistik kaybı oyunu durdurmamalı */
  }
}

// ---------- yönetici ----------

export function setAdminKey(key: string) {
  adminKey = key;
  safe(() => sessionStorage.setItem(LS.key, key), undefined);
}
export function clearAdminKey() {
  adminKey = '';
  safe(() => sessionStorage.removeItem(LS.key), undefined);
}
export const hasAdminKey = () => !!adminKey;

export async function loadAdmin(): Promise<{ questions: Question[]; settings: Settings; stats: Stats }> {
  if ((await detectMode()) === 'api') return call('GET', '/api/admin');
  return {
    questions: await localQuestions(),
    settings: { ...DEFAULT_SETTINGS, ...lsGet(LS.settings, {}) },
    stats: lsGet(LS.stats, DEFAULT_STATS),
  };
}

export async function saveQuestion(q: Question | Omit<Question, 'id'>): Promise<void> {
  const err = validate(q);
  if (err) throw new Error(err);
  const id = 'id' in q ? q.id : '';
  if ((await detectMode()) === 'api') {
    await (id ? call('PUT', `/api/sorular/${id}`, q) : call('POST', '/api/sorular', q));
    return;
  }
  const list = await localQuestions();
  const i = id ? list.findIndex((x) => x.id === id) : -1;
  if (i >= 0) list[i] = { ...list[i], ...q, id };
  else list.push({ ...q, id: crypto.randomUUID(), olusturma: new Date().toISOString() });
  lsSet(LS.questions, list);
}

export async function deleteQuestion(id: string): Promise<void> {
  if ((await detectMode()) === 'api') {
    await call('DELETE', `/api/sorular/${id}`);
    return;
  }
  lsSet(LS.questions, (await localQuestions()).filter((x) => x.id !== id));
}

export async function replaceAll(list: Question[]): Promise<void> {
  if (!Array.isArray(list)) throw new Error('Geçersiz dosya: soru listesi bekleniyor.');
  if ((await detectMode()) === 'api') {
    await call('PUT', '/api/sorular', list);
    return;
  }
  list.forEach((q, i) => {
    const err = validate(q);
    if (err) throw new Error(`${i + 1}. soru: ${err}`);
  });
  lsSet(LS.questions, list.map((q) => ({ aktif: true, ...q, id: q.id || crypto.randomUUID() })));
}

export async function saveSettings(s: Settings): Promise<void> {
  if ((await detectMode()) === 'api') {
    await call('PUT', '/api/ayarlar', s);
    return;
  }
  lsSet(LS.settings, s);
}

export async function resetStats(): Promise<void> {
  if ((await detectMode()) === 'api') {
    await call('DELETE', '/api/istatistik');
    return;
  }
  lsSet(LS.stats, DEFAULT_STATS);
}
