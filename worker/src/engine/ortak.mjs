// Ortak yardımcılar: kontrollü HTTP hatası, Web Crypto tabanlı rastgelelik, soru/ayar doğrulama.
// Platformdan bağımsızdır (Cloudflare Workers ve Node testleri aynı kodu çalıştırır).

/**
 * İstemciye gösterilebilecek hata. Mesaj kullanıcıya yöneliktir; dosya yolu, sistem hatası,
 * veritabanı ayrıntısı ya da yığın izi içermez. Diğer tüm hatalar genel bir mesajla yanıtlanır.
 */
export class HttpError extends Error {
  constructor(status, message, headers) {
    super(message);
    this.status = status;
    this.expose = true;
    this.headers = headers;
  }
}

export const GENERIC_ERROR = 'Sunucu hatası. Lütfen biraz sonra tekrar deneyin.';

/** 0 ≤ n < max, eşit dağılımlı (Web Crypto). */
export function randomInt(max) {
  if (!Number.isInteger(max) || max <= 0) throw new RangeError('max');
  const limit = Math.floor(0x1_0000_0000 / max) * max;
  const buf = new Uint32Array(1);
  do crypto.getRandomValues(buf); while (buf[0] >= limit);
  return buf[0] % max;
}

export function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export const uuid = () => crypto.randomUUID();
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Soru doğrulama ve temizleme (src/shared/store-core.ts içindeki validate ile aynı kurallar). */
export function cleanQuestion(input, existing) {
  input = input && typeof input === 'object' ? input : {};
  const q = {
    id: existing?.id ?? uuid(),
    soru: str(input.soru, 300),
    dogru: str(input.dogru, 120),
    yanlislar: Array.isArray(input.yanlislar) ? input.yanlislar.map((y) => str(y, 120)) : [],
    kategori: str(input.kategori, 60),
    ipucu: str(input.ipucu, 300),
    aciklama: str(input.aciklama, 400),
    yanlisAciklamalar: [0, 1, 2].map((i) => str(Array.isArray(input.yanlisAciklamalar) ? input.yanlisAciklamalar[i] : '', 300)),
    aktif: input.aktif !== false,
  };
  if (existing?.olusturma) q.olusturma = existing.olusturma;
  if (!q.soru) return { error: 'Soru metni boş olamaz.' };
  if (!q.kategori) return { error: 'Kategori boş olamaz.' };
  if (!q.dogru) return { error: 'Doğru cevap boş olamaz.' };
  if (!q.aciklama) return { error: 'Doğru cevabın neden doğru olduğunu yazın.' };
  if (q.yanlislar.length !== 3 || q.yanlislar.some((y) => !y)) return { error: 'Üç yanlış cevap girilmelidir.' };
  if (q.yanlisAciklamalar.some((y) => !y)) return { error: 'Her yanlış cevabın neden yanlış olduğunu yazın.' };
  if (!q.ipucu) return { error: 'İpucu boş olamaz.' };
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(q.id)) return { error: 'Geçersiz soru kimliği.' };
  const all = [q.dogru, ...q.yanlislar].map((s) => s.toLocaleLowerCase('tr'));
  if (new Set(all).size !== 4) return { error: 'Cevap şıkları birbirinden farklı olmalıdır.' };
  return { q };
}

export const DEFAULT_SETTINGS = { questionsPerGame: 15, endOnWrong: true, secondsPerQuestion: 30 };

export function cleanSettings(input) {
  input = input && typeof input === 'object' ? input : {};
  const n = Math.round(Number(input.questionsPerGame));
  const sec = Math.round(Number(input.secondsPerQuestion));
  return {
    questionsPerGame: Number.isFinite(n) ? Math.min(50, Math.max(1, n)) : DEFAULT_SETTINGS.questionsPerGame,
    endOnWrong: input.endOnWrong !== false,
    secondsPerQuestion: Number.isFinite(sec) ? Math.min(180, Math.max(0, sec)) : DEFAULT_SETTINGS.secondsPerQuestion,
  };
}

/**
 * Açıklama metinlerinin harfleri maskelenmiş kopyası: istemci yazı boyutunu metnin uzunluğuna ve
 * kelime yapısına göre seçebilir, ama içerik (dolayısıyla cevap) okunamaz.
 */
export function maskText(s) {
  return s.replace(/\p{Lu}/gu, 'N').replace(/\p{Ll}/gu, 'n');
}

/** Gövdede yalnızca izin verilen alanlar olmalı. */
export function onlyKeys(body, allowed) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
  return Object.keys(body).every((k) => allowed.includes(k));
}

export const isIndex = (v, len) => Number.isInteger(v) && v >= 0 && v < len;
