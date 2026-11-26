// Test yardımcıları: geçici veri dizininde gerçek bir HTTP sunucusu üzerinde API'yi çalıştırır.
import { createServer } from 'node:http';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApi } from '../server/api.mjs';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const SEED_FILE = join(ROOT, 'public', 'data', 'varsayilan-sorular.json');
// Yalnızca testlerde, geçici sunucular için üretilen parola (gerçek bir kimlik bilgisi değildir).
export const ADMIN_KEY = `test-${Math.random().toString(36).slice(2)}-${Date.now()}`;

/** Her test için ayrı geçici dizin. */
export async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), 'n5-test-'));
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

/** Elle ilerletilen saat: hız sınırı ve süre dolumu testleri gerçek beklemeye bağlı olmaz. */
export function fakeClock(start = 1_800_000_000_000) {
  let t = start;
  const now = () => t;
  now.advance = (ms) => { t += ms; };
  return now;
}

/**
 * API'yi geçici bir portta başlatır. `logs` sunucu tarafı günlük kayıtlarını toplar.
 * @param {{ dataDir: string, seedFile?: string, limits?: object, now?: () => number, trustProxy?: number, liveTiming?: object }} opts
 */
export async function startApi({ dataDir, seedFile = SEED_FILE, ...extra }) {
  const logs = [];
  const api = createApi({ dataDir, seedFile, adminPassword: ADMIN_KEY, log: (...args) => logs.push(args), ...extra });
  const server = createServer((req, res) => api(req, res, () => res.writeHead(404).end()));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  async function request(method, path, { body, admin = false, key, headers = {} } = {}) {
    const res = await fetch(base + path, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(admin ? { 'x-admin-key': ADMIN_KEY } : {}),
        ...(key !== undefined ? { 'x-admin-key': key } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* düz metin */ }
    return { status: res.status, headers: res.headers, text, json };
  }

  return {
    base,
    logs,
    request,
    close: () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(resolve); }),
  };
}

/** Yanıt gövdesinde iç ayrıntı (dosya yolu, sistem hata kodu, yığın izi) olmadığını doğrular. */
export function leaksInternals(text, ...paths) {
  const needles = ['ENOENT', 'EACCES', 'SyntaxError', '    at ', 'node:internal', ...paths];
  if (/[A-Za-z]:\\\\|[A-Za-z]:\\/.test(text)) return 'Windows yolu';
  for (const n of needles) if (n && text.includes(n)) return n;
  return null;
}

/** Sunucunun soru dosyasından cevap anahtarı (yalnızca test doğrulaması için okunur). */
export async function answerKey(dataDir) {
  const questions = JSON.parse(await readFile(join(dataDir, 'questions.json'), 'utf8'));
  return new Map(questions.map((q) => [q.soru, q]));
}

/** Oturumdaki bir sorunun doğru şıkkının sırası. */
export const correctChoice = (key, round) => round.secenekler.indexOf(key.get(round.soru).dogru);
/** Oturumdaki bir sorunun (elenmemiş) yanlış şıklarından birinin sırası. */
export const wrongChoice = (key, round, skip = []) =>
  round.secenekler.findIndex((t, i) => t !== key.get(round.soru).dogru && !skip.includes(i));

/** SSE akışını okur: gelen her `data:` mesajını toplar, koşula uyan mesajı bekler. */
export async function openStream(url) {
  const ctrl = new AbortController();
  const res = await fetch(url, { signal: ctrl.signal });
  const messages = [];
  const waiters = [];
  let raw = '';
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
  })();
  return {
    messages,
    /** Ham akış metni (sızıntı aramak için). */
    get raw() { return JSON.stringify(messages); },
    // Bekleme payı geniştir: test dosyaları paralel çalışır, yoğun makinede akış mesajı gecikebilir.
    next(pred, timeoutMs = 15_000) {
      const found = messages.find(pred);
      if (found) return Promise.resolve(found);
      return new Promise((resolve, reject) => {
        const w = { pred, resolve };
        waiters.push(w);
        setTimeout(() => reject(new Error('Akış mesajı zaman aşımı')), timeoutMs).unref?.();
      });
    },
    close: () => ctrl.abort(),
  };
}
