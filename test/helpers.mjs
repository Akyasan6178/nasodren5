// Ortak test yardımcıları.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const SEED_FILE = join(ROOT, 'public', 'data', 'varsayilan-sorular.json');
export const seed = () => JSON.parse(readFileSync(SEED_FILE, 'utf8'));

/** Cevap anahtarı (yalnızca test doğrulaması için): soru metni → soru. */
export const answerKey = (questions = seed()) => new Map(questions.map((q) => [q.soru, q]));
/** Oturumdaki bir sorunun doğru şıkkının sırası. */
export const correctChoice = (key, round) => round.secenekler.indexOf(key.get(round.soru).dogru);
/** Oturumdaki bir sorunun (elenmemiş) yanlış şıklarından birinin sırası. */
export const wrongChoice = (key, round, skip = []) =>
  round.secenekler.findIndex((t, i) => t !== key.get(round.soru).dogru && !skip.includes(i));

/** Yanıt gövdesinde iç ayrıntı (dosya yolu, sistem/veritabanı hata kodu, yığın izi) var mı? */
export function leaksInternals(text, ...secrets) {
  const needles = ['ENOENT', 'SyntaxError', '    at ', 'node:internal', 'permission denied', 'PGRST', 'rest/v1', 'sb_secret', ...secrets];
  if (/[A-Za-z]:\\/.test(text)) return 'Windows yolu';
  for (const n of needles) if (n && text.includes(n)) return n;
  return null;
}

/** Bir metinde cevap anahtarına ait bilgi var mı? (açıklama/ipucu metinleri ya da cevap alanları) */
export function findAnswerLeak(text, questions = seed()) {
  for (const q of questions) {
    if (text.includes(q.aciklama)) return `açıklama: ${q.id}`;
    for (const w of q.yanlisAciklamalar) if (text.includes(w)) return `yanlış açıklaması: ${q.id}`;
    if (text.includes(q.ipucu)) return `ipucu: ${q.id}`;
  }
  for (const k of ['"dogru"', '"aciklama"', '"yanlisAciklamalar"', '"correct"', '"why"', '"whys"', '"dogruSik"', '"ipucu"', '"yanlislar"']) {
    if (text.includes(k)) return `alan ${k}`;
  }
  return null;
}

/**
 * SSE akışını okur: gelen her `data:` mesajını sırayla toplar. `next(pred)` koşula uyan İLK yeni ya da
 * mevcut mesajı bekler — testler zamanlamaya değil, beklenen olay sırasına göre ilerler.
 */
export async function openStream(url, headers = {}) {
  const ctrl = new AbortController();
  const res = await fetch(url, { signal: ctrl.signal, headers });
  const messages = [];
  const waiters = [];
  let raw = '';
  let closed = false;
  (async () => {
    const decoder = new TextDecoder();
    try {
      for await (const chunk of res.body) {
        raw += decoder.decode(chunk, { stream: true });
        let i;
        while ((i = raw.indexOf('\n\n')) >= 0) {
          const block = raw.slice(0, i);
          raw = raw.slice(i + 2);
          const line = block.split('\n').find((l) => l.startsWith('data: '));
          if (!line) continue;
          const msg = JSON.parse(line.slice(6));
          messages.push(msg);
          for (const w of [...waiters]) if (w.pred(msg)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(msg); }
        }
      }
    } catch { /* kapatıldı */ }
    closed = true;
    for (const w of waiters.splice(0)) w.reject(new Error('Akış kapandı'));
  })();
  return {
    status: res.status,
    headers: res.headers,
    messages,
    get closed() { return closed; },
    /** Şu ana kadar gelen mesajları atlar: sonraki `next` yalnızca bundan SONRA gelen mesajlara bakar. */
    mark() { return messages.length; },
    /** `from` sırasından (mark) sonra gelen ve koşula uyan ilk mesaj. */
    after(from, pred, timeoutMs) { return this.next((m) => messages.indexOf(m) >= from && pred(m), timeoutMs); },
    next(pred, timeoutMs = 20_000) {
      const found = messages.find(pred);
      if (found) return Promise.resolve(found);
      if (closed) return Promise.reject(new Error('Akış kapandı'));
      return new Promise((resolve, reject) => {
        const w = { pred, resolve, reject };
        waiters.push(w);
        setTimeout(() => {
          const i = waiters.indexOf(w);
          if (i >= 0) { waiters.splice(i, 1); reject(new Error(`Akış mesajı gelmedi (${messages.length} mesaj: ${JSON.stringify(messages.map((m) => m.phase))})`)); }
        }, timeoutMs).unref?.();
      });
    },
    close: () => ctrl.abort(),
  };
}
