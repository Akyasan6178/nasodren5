// Canlı yarışma: sunucuyla konuşan ortak katman (worker/src/engine/oda.mjs ile aynı veri biçimi).

export type Phase = 'lobi' | 'hazir' | 'soru' | 'sonuc' | 'tablo' | 'bitti' | 'yok' | 'atildi';

export const GAME_NAME = 'Kim Nefes Almak İster?';
export const LETTERS = ['A', 'B', 'C', 'D'];
export const SHAPES = ['▲', '◆', '●', '■'];

export interface LiveQuestion {
  soru: string;
  kategori: string;
  choices: string[];
  /** Yalnızca cevaplar açıklandıktan sonra gelir. */
  correct?: number;
  why?: string;
  /** Her şıkkın açıklaması (doğruysa neden doğru, yanlışsa neden yanlış); şık sırasıyla. */
  whys?: string[];
  counts?: number[];
}

export interface HostPlayer {
  id: string;
  name: string;
  score: number;
  streak: number;
  online: boolean;
  rank: number;
  prevRank: number;
  gained: number;
  answered: boolean;
}

export interface HostView {
  phase: Phase;
  mesaj?: string;
  code: string;
  options: { count: number; seconds: number };
  index: number;
  total: number;
  players: HostPlayer[];
  answered: number;
  question?: LiveQuestion;
  remainingMs?: number;
}

export interface PlayerView {
  phase: Phase;
  mesaj?: string;
  code: string;
  me: { id: string; name: string; score: number; streak: number; rank: number };
  playerCount: number;
  seconds: number;
  index: number;
  total: number;
  question?: LiveQuestion;
  remainingMs?: number;
  answer?: { choice: number; correct?: boolean; ms?: number; points?: number; bonus?: number } | null;
  podium?: { name: string; score: number }[];
}

const NETWORK_ERROR = 'Sunucuya ulaşılamadı. Bağlantınızı kontrol edip tekrar deneyin.';

/** fetch; ağ hatasında kullanıcıya gösterilebilir bir mesajla hata fırlatır. */
async function request(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch {
    throw new Error(NETWORK_ERROR);
  }
}

export async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `İstek başarısız (${res.status})`), { status: res.status });
  return data as T;
}

export async function get<T>(url: string): Promise<T> {
  const res = await request(url, { cache: 'no-store' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `İstek başarısız (${res.status})`), { status: res.status });
  return data as T;
}

/**
 * Çok oyunculu mod yalnızca sunucu modunda çalışır. Mod derlemede seçilir (VITE_VERI_MODU=yerel ise
 * sunucusuz statik barındırma); çalışma anında tahmin edilmez. Sunucuya ulaşılamazsa sonraki istekler
 * hata mesajı ve "Tekrar dene" ile bildirilir.
 */
export async function serverAvailable(): Promise<boolean> {
  return import.meta.env.VITE_VERI_MODU !== 'yerel';
}

/**
 * Sunucudan canlı durum akışı. Bağlantı koparsa tarayıcı kendisi yeniden bağlanır;
 * `onLink` bağlantı durumunu bildirir. Oda kapandıysa ya da oyuncu çıkarıldıysa akış kapanır.
 */
export function stream<T extends { phase: Phase }>(url: string, onView: (v: T) => void, onLink: (ok: boolean) => void): () => void {
  const es = new EventSource(url);
  es.onopen = () => onLink(true);
  es.onerror = () => onLink(false);
  es.onmessage = (e) => {
    let v: T;
    try { v = JSON.parse(e.data) as T; } catch { return; }
    if (v.phase === 'yok' || v.phase === 'atildi') es.close();
    onView(v);
  };
  return () => es.close();
}

/** Sunucunun bildirdiği kalan süreyi yerel saate çevirir (saat farkı sorun olmaz). */
export const deadlineFrom = (remainingMs = 0) => performance.now() + remainingMs;

export function storage<T>(key: string, area: 'local' | 'session' = 'local') {
  const s = () => (area === 'local' ? localStorage : sessionStorage);
  return {
    get(): T | null {
      try { const v = s().getItem(key); return v ? (JSON.parse(v) as T) : null; } catch { return null; }
    },
    set(v: T) { try { s().setItem(key, JSON.stringify(v)); } catch { /* yoksay */ } },
    clear() { try { s().removeItem(key); } catch { /* yoksay */ } },
  };
}

/** Küçük DOM yardımcısı: h('div.kart', {onclick}, 'metin', çocuk). Metinler her zaman textContent ile yazılır. */
type TagOf<T extends string> = T extends `${infer N}.${string}` ? N : T;
type El<T extends string> = TagOf<T> extends keyof HTMLElementTagNameMap ? HTMLElementTagNameMap[TagOf<T>] : HTMLElement;

export function h<T extends string>(
  tag: T,
  attrs: Record<string, unknown> | null = null,
  ...children: (Node | string | number | null | undefined | false)[]
): El<T> {
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name);
  if (classes.length) el.className = classes.join(' ');
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k in el && k !== 'list') (el as unknown as Record<string, unknown>)[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el as El<T>;
}

/** Puanı 0'dan hedefe sayarak yazar. */
export function countUp(el: HTMLElement, from: number, to: number, ms = 900) {
  const t0 = performance.now();
  const fmt = (n: number) => Math.round(n).toLocaleString('tr-TR');
  const step = (t: number) => {
    const k = Math.min(1, (t - t0) / ms);
    el.textContent = fmt(from + (to - from) * (1 - (1 - k) ** 3));
    if (k < 1) requestAnimationFrame(step);
  };
  if (from === to) el.textContent = fmt(to);
  else requestAnimationFrame(step);
}

export const fmtScore = (n: number) => n.toLocaleString('tr-TR');
