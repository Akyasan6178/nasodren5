// Soru API'si. Hem üretim sunucusu (server.mjs) hem de Vite geliştirme sunucusu
// (vite.config.ts) tarafından kullanılır. Veriler data/ altında JSON dosyalarında durur.
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID, timingSafeEqual, createHash } from 'node:crypto';
import { createLive } from './canli.mjs';
import { createSessions } from './oturum.mjs';
import { createRateLimiter, clientIp } from './ratelimit.mjs';
import { loadConfig } from './config.mjs';

const DEFAULT_SETTINGS = { questionsPerGame: 15, endOnWrong: true, secondsPerQuestion: 30 };
const DEFAULT_STATS = { games: 0, finished: 0, totalCorrect: 0, perQuestion: {} };
const GENERIC_ERROR = 'Sunucu hatası. Lütfen biraz sonra tekrar deneyin.';

/**
 * İstemciye gösterilebilecek hata. Mesajı kullanıcıya yönelik olmalıdır; dosya yolu,
 * sistem hatası ya da yığın izi içermemelidir. Diğer tüm hatalar genel bir mesajla yanıtlanır.
 */
export class HttpError extends Error {
  constructor(status, message, headers) {
    super(message);
    this.status = status;
    this.expose = true;
    this.headers = headers;
  }
}

const tooMany = (retryAfter) =>
  new HttpError(429, 'Çok fazla istek gönderildi. Lütfen biraz bekleyip tekrar deneyin.', { 'retry-after': String(retryAfter) });

/** Günlük için yol: oturum ve benzeri kimlikler maskelenir. */
const safePath = (p) => p.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':token');

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Soru doğrulama ve temizleme (src/shared/store.ts içindeki validate ile aynı kurallar). */
export function cleanQuestion(input, existing) {
  const q = {
    id: existing?.id ?? randomUUID(),
    soru: str(input.soru, 300),
    dogru: str(input.dogru, 120),
    yanlislar: Array.isArray(input.yanlislar) ? input.yanlislar.map((y) => str(y, 120)) : [],
    kategori: str(input.kategori, 60),
    ipucu: str(input.ipucu, 300),
    aciklama: str(input.aciklama, 400),
    yanlisAciklamalar: [0, 1, 2].map((i) => str(Array.isArray(input.yanlisAciklamalar) ? input.yanlisAciklamalar[i] : '', 300)),
    aktif: input.aktif !== false,
    olusturma: existing?.olusturma ?? new Date().toISOString(),
  };
  // tüm alanlar zorunlu
  if (!q.soru) return { error: 'Soru metni boş olamaz.' };
  if (!q.kategori) return { error: 'Kategori boş olamaz.' };
  if (!q.dogru) return { error: 'Doğru cevap boş olamaz.' };
  if (!q.aciklama) return { error: 'Doğru cevabın neden doğru olduğunu yazın.' };
  if (q.yanlislar.length !== 3 || q.yanlislar.some((y) => !y)) return { error: 'Üç yanlış cevap girilmelidir.' };
  if (q.yanlisAciklamalar.some((y) => !y)) return { error: 'Her yanlış cevabın neden yanlış olduğunu yazın.' };
  if (!q.ipucu) return { error: 'İpucu boş olamaz.' };
  const all = [q.dogru, ...q.yanlislar].map((s) => s.toLocaleLowerCase('tr'));
  if (new Set(all).size !== 4) return { error: 'Cevap şıkları birbirinden farklı olmalıdır.' };
  return { q };
}

function cleanSettings(input) {
  const n = Math.round(Number(input.questionsPerGame));
  const sec = Math.round(Number(input.secondsPerQuestion));
  return {
    questionsPerGame: Number.isFinite(n) ? Math.min(50, Math.max(1, n)) : DEFAULT_SETTINGS.questionsPerGame,
    endOnWrong: input.endOnWrong !== false,
    secondsPerQuestion: Number.isFinite(sec) ? Math.min(180, Math.max(0, sec)) : DEFAULT_SETTINGS.secondsPerQuestion,
  };
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > 2_000_000) throw new HttpError(413, 'İstek çok büyük.');
    chunks.push(c);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'İstek gövdesi geçerli bir JSON değil.');
  }
}

/**
 * JSON dosya deposu. Aynı dosyayı değiştiren işlemler tek bir kuyrukta sırayla çalışır:
 * her işlem en güncel içeriği okur, değiştirir ve geçici dosya + rename ile atomik yazar.
 * Başarısız bir işlem yalnızca kendi çağıranına hata döndürür; kuyruk sonraki işlemlerle devam eder.
 */
function createJsonStore(files) {
  const queues = new Map();

  /** Dosyayı okur. Dosya yoksa varsayılanı döndürür; bozuk JSON'u ise hata olarak bildirir (asla üstüne yazılmaz). */
  async function load(name, fallback) {
    let text;
    try {
      text = await readFile(files[name], 'utf8');
    } catch (err) {
      if (err?.code === 'ENOENT') return structuredClone(fallback);
      throw err;
    }
    try {
      return JSON.parse(text);
    } catch (err) {
      throw new Error(`Veri dosyası bozuk: ${files[name]} (${err.message})`, { cause: err });
    }
  }

  async function write(name, value) {
    const tmp = `${files[name]}.tmp`;
    await writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
    await rename(tmp, files[name]);
  }

  /**
   * Oku-değiştir-yaz işlemini kuyruğa alır. `fn(current)` yeni değeri ve isteğe bağlı bir sonucu
   * `{ value, result }` olarak döndürür; `value` undefined ise yazma yapılmaz.
   */
  function update(name, fallback, fn) {
    const prev = queues.get(name) ?? Promise.resolve();
    const job = prev.then(async () => {
      const current = await load(name, fallback);
      const { value, result } = await fn(current);
      if (value !== undefined) await write(name, value);
      return result;
    });
    // Kuyruk, başarısız işlemden sonra da sonraki işleri çalıştırır.
    queues.set(name, job.catch(() => undefined));
    return job;
  }

  return { load, update };
}

/**
 * @param {{
 *   dataDir: string, seedFile: string, adminPassword: string,
 *   log?: (...args: unknown[]) => void,
 *   trustProxy?: number,
 *   limits?: ReturnType<typeof loadConfig>['limits'],
 *   now?: () => number,
 *   liveTiming?: { readyMs?: number },
 * }} opts
 * @returns {(req, res, next?) => Promise<void>} Connect uyumlu ara katman
 */
export function createApi({
  dataDir, seedFile, adminPassword, log = console.error, trustProxy = 0,
  limits = loadConfig({}, 'development').limits, now = Date.now, liveTiming,
}) {
  if (typeof adminPassword !== 'string' || !adminPassword) throw new Error('createApi: adminPassword gerekli.');
  const files = {
    questions: join(dataDir, 'questions.json'),
    settings: join(dataDir, 'settings.json'),
    stats: join(dataDir, 'stats.json'),
  };
  const store = createJsonStore(files);
  const { load } = store;
  const realKey = createHash('sha256').update(adminPassword).digest();
  let ready = null;

  // İlk açılışta soru dosyası yoksa seed'den oluşturulur. Mevcut dosyaya asla dokunulmaz.
  async function init() {
    await mkdir(dataDir, { recursive: true });
    await store.update('questions', null, async (current) => {
      if (current !== null) return {}; // dosya zaten var (bozuksa load hata fırlatır)
      let seed;
      try {
        seed = JSON.parse(await readFile(seedFile, 'utf8'));
      } catch (err) {
        throw new Error(`Varsayılan soru dosyası okunamadı: ${seedFile} (${err.message})`, { cause: err });
      }
      if (!Array.isArray(seed)) throw new Error(`Varsayılan soru dosyası bir soru listesi değil: ${seedFile}`);
      return { value: seed };
    });
  }

  /** Başarılı başlatma bir kez yapılır; başarısız olursa önbellekten silinir ve sonraki istekte yeniden denenir. */
  function ensureReady() {
    ready ??= init().catch((err) => {
      ready = null;
      throw err;
    });
    return ready;
  }

  function addAnswers(stats, answers, countTotals) {
    for (const a of answers) {
      if (typeof a?.id !== 'string') continue;
      const s = (stats.perQuestion[a.id] ??= { asked: 0, correct: 0 });
      s.asked += 1;
      if (a.correct) {
        s.correct += 1;
        if (countTotals) stats.totalCorrect += 1;
      }
    }
  }

  // Soru başına başarı oranına canlı yarışmadaki cevaplar da eklenir.
  // (games/totalCorrect tek kişilik oyunların ortalaması için kullanıldığından onlara dokunulmaz.)
  function recordAnswers(answers) {
    return store.update('stats', DEFAULT_STATS, (stats) => {
      addAnswers(stats, answers, false);
      return { value: stats };
    });
  }

  async function getGame() {
    const [questions, settings] = await Promise.all([load('questions', []), load('settings', DEFAULT_SETTINGS)]);
    return { questions: questions.filter((q) => q.aktif), settings: { ...DEFAULT_SETTINGS, ...settings } };
  }

  // Tek oyunculu oyun bittiğinde sunucunun doğruladığı cevaplardan istatistik yazılır.
  function recordGame(answers, finished) {
    return store.update('stats', DEFAULT_STATS, (stats) => {
      stats.games += 1;
      if (finished) stats.finished += 1;
      addAnswers(stats, answers, true);
      return { value: stats };
    });
  }

  const live = createLive({ getGame, recordAnswers, timing: liveTiming });
  const sessions = createSessions({ getGame, recordGame, HttpError, now });
  const limiter = {
    adminLogin: createRateLimiter({ ...limits.adminLogin, now }),
    roomCreate: createRateLimiter({ ...limits.roomCreate, now }),
    gameStart: createRateLimiter({ ...limits.gameStart, now }),
  };
  for (const l of Object.values(limiter)) setInterval(l.sweep, 60_000).unref?.();

  const isAdmin = (req) =>
    timingSafeEqual(createHash('sha256').update(String(req.headers['x-admin-key'] ?? '')).digest(), realKey);

  /** Sınırı aşan istemci 429 alır. */
  function limit(l, key) {
    const r = l.hit(key);
    if (r.limited) throw tooMany(r.retryAfter);
  }

  async function route(req, res, pathname, query) {
    const method = req.method;
    const ip = clientIp(req, trustProxy);

    // Herkese açık uçlar (oyun ekranı). Cevap anahtarı ve açıklamalar burada asla gönderilmez.
    if (method === 'GET' && pathname === '/api/oyun') {
      const { questions, settings } = await getGame();
      return send(res, 200, { ayarlar: settings, aktifSoru: questions.length });
    }
    if (method === 'POST' && pathname === '/api/oyun/oturum') {
      limit(limiter.gameStart, ip);
      return send(res, 201, await sessions.start());
    }
    const og = pathname.match(/^\/api\/oyun\/oturum\/([^/]+)\/(cevap|joker)$/);
    if (og && method === 'POST') {
      const body = await readBody(req);
      return send(res, 200, og[2] === 'cevap' ? await sessions.answer(og[1], body) : sessions.lifeline(og[1], body));
    }
    // Eski, istemci beyanına dayanan istatistik ucu kaldırıldı: istatistik artık sunucuda,
    // doğrulanmış oyun cevaplarından üretilir.
    if (pathname === '/api/sonuc') {
      return send(res, 410, { error: 'Bu işlem artık desteklenmiyor.' });
    }
    // Çok oyunculu canlı yarışma (server/canli.mjs)
    if (pathname.startsWith('/api/canli/')) {
      if (method === 'POST' && pathname === '/api/canli/oda') limit(limiter.roomCreate, ip);
      if (await live(req, res, pathname, query, { send, readBody })) return;
      return send(res, 404, { error: 'Bulunamadı' });
    }

    // Yönetici uçları. Yalnızca başarısız denemeler sayılır; başarılı giriş o adresin sayacını sıfırlar.
    // Sınır aşıldıysa doğru parola da pencere dolana kadar 429 alır (deneme-yanılmayı durdurur).
    const blocked = limiter.adminLogin.check(ip);
    if (blocked.limited) throw tooMany(blocked.retryAfter);
    if (!isAdmin(req)) {
      limiter.adminLogin.hit(ip);
      return send(res, 401, { error: 'Şifre hatalı.' });
    }
    limiter.adminLogin.reset(ip);

    if (method === 'GET' && pathname === '/api/admin') {
      const [questions, settings, stats] = await Promise.all([
        load('questions', []), load('settings', DEFAULT_SETTINGS), load('stats', DEFAULT_STATS),
      ]);
      return send(res, 200, { questions, settings: { ...DEFAULT_SETTINGS, ...settings }, stats });
    }
    if (method === 'POST' && pathname === '/api/sorular') {
      const { q, error } = cleanQuestion(await readBody(req));
      if (error) return send(res, 400, { error });
      await store.update('questions', [], (questions) => {
        questions.push(q);
        return { value: questions };
      });
      return send(res, 201, q);
    }
    const m = pathname.match(/^\/api\/sorular\/([\w-]+)$/);
    if (m && (method === 'PUT' || method === 'DELETE')) {
      const body = method === 'PUT' ? await readBody(req) : null;
      await store.update('questions', [], (questions) => {
        const i = questions.findIndex((x) => x.id === m[1]);
        if (i < 0) throw new HttpError(404, 'Soru bulunamadı.');
        if (method === 'DELETE') {
          questions.splice(i, 1);
        } else {
          const { q, error } = cleanQuestion(body, questions[i]);
          if (error) throw new HttpError(400, error);
          questions[i] = q;
        }
        return { value: questions };
      });
      return send(res, 200, { ok: true });
    }
    if (method === 'PUT' && pathname === '/api/sorular') {
      // Toplu içe aktarma: listeyi tamamen değiştirir.
      const body = await readBody(req);
      if (!Array.isArray(body)) return send(res, 400, { error: 'Geçersiz dosya: soru listesi bekleniyor.' });
      const out = [];
      for (const [i, item] of body.entries()) {
        const keep = item?.id ? { id: String(item.id), olusturma: item.olusturma } : undefined;
        const { q, error } = cleanQuestion(item ?? {}, keep);
        if (error) return send(res, 400, { error: `${i + 1}. soru: ${error}` });
        out.push(q);
      }
      await store.update('questions', [], () => ({ value: out }));
      return send(res, 200, { ok: true, count: out.length });
    }
    if (method === 'PUT' && pathname === '/api/ayarlar') {
      const settings = cleanSettings(await readBody(req));
      await store.update('settings', DEFAULT_SETTINGS, () => ({ value: settings }));
      return send(res, 200, settings);
    }
    if (method === 'DELETE' && pathname === '/api/istatistik') {
      await store.update('stats', DEFAULT_STATS, () => ({ value: structuredClone(DEFAULT_STATS) }));
      return send(res, 200, { ok: true });
    }
    return send(res, 404, { error: 'Bulunamadı' });
  }

  return async (req, res, next) => {
    const { pathname, searchParams } = new URL(req.url, 'http://x');
    if (!pathname.startsWith('/api/')) return next?.();
    try {
      await ensureReady();
      await route(req, res, pathname, searchParams);
    } catch (err) {
      const exposed = err?.expose === true;
      // Ayrıntı yalnızca sunucu günlüğüne yazılır; istemciye dosya yolu ya da sistem mesajı gitmez.
      if (!exposed) log(`[api] ${req.method} ${safePath(pathname)} başarısız:`, err);
      if (res.headersSent) return void res.end(); // akış açıldıktan sonra JSON hata gönderilemez
      if (exposed) send(res, err.status, { error: err.message }, err.headers);
      else send(res, 500, { error: GENERIC_ERROR });
    }
  };
}
