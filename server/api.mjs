// Soru API'si. Hem üretim sunucusu (server.mjs) hem de Vite geliştirme sunucusu
// (vite.config.ts) tarafından kullanılır. Veriler data/ altında JSON dosyalarında durur.
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID, timingSafeEqual, createHash } from 'node:crypto';
import { createLive } from './canli.mjs';

const DEFAULT_SETTINGS = { questionsPerGame: 15, endOnWrong: true, secondsPerQuestion: 30 };
const DEFAULT_STATS = { games: 0, finished: 0, totalCorrect: 0, perQuestion: {} };

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function cleanQuestion(input, existing) {
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
  // tüm alanlar zorunlu (src/shared/store.ts içindeki validate ile aynı kurallar)
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

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > 2_000_000) throw new Error('İstek çok büyük.');
    chunks.push(c);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}

/**
 * @param {{ dataDir: string, seedFile: string, adminPassword: string }} opts
 * @returns {(req, res, next?) => Promise<void>} Connect uyumlu ara katman
 */
export function createApi({ dataDir, seedFile, adminPassword }) {
  const files = {
    questions: join(dataDir, 'questions.json'),
    settings: join(dataDir, 'settings.json'),
    stats: join(dataDir, 'stats.json'),
  };
  const realKey = createHash('sha256').update(adminPassword).digest();
  let writeChain = Promise.resolve();
  let ready = null;

  async function load(name, fallback) {
    try {
      return JSON.parse(await readFile(files[name], 'utf8'));
    } catch {
      return structuredClone(fallback);
    }
  }

  // Yazmalar sıraya alınır ve geçici dosya + rename ile atomik yapılır.
  function save(name, value) {
    writeChain = writeChain.then(async () => {
      const tmp = files[name] + '.tmp';
      await writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
      await rename(tmp, files[name]);
    });
    return writeChain;
  }

  async function init() {
    await mkdir(dataDir, { recursive: true });
    if (!existsSync(files.questions)) await save('questions', JSON.parse(await readFile(seedFile, 'utf8')));
  }

  // Soru başına başarı oranına canlı yarışmadaki cevaplar da eklenir.
  // (games/totalCorrect tek kişilik oyunların ortalaması için kullanıldığından onlara dokunulmaz.)
  async function recordAnswers(answers) {
    const stats = await load('stats', DEFAULT_STATS);
    for (const a of answers) {
      if (typeof a?.id !== 'string') continue;
      const s = (stats.perQuestion[a.id] ??= { asked: 0, correct: 0 });
      s.asked += 1;
      if (a.correct) s.correct += 1;
    }
    await save('stats', stats);
  }

  async function getGame() {
    const [questions, settings] = await Promise.all([load('questions', []), load('settings', DEFAULT_SETTINGS)]);
    return { questions: questions.filter((q) => q.aktif), settings: { ...DEFAULT_SETTINGS, ...settings } };
  }

  const live = createLive({ getGame, recordAnswers });

  const isAdmin = (req) =>
    timingSafeEqual(createHash('sha256').update(String(req.headers['x-admin-key'] ?? '')).digest(), realKey);

  async function route(req, res, pathname, query) {
    const method = req.method;

    // Herkese açık uçlar (oyun ekranı)
    if (method === 'GET' && pathname === '/api/oyun') return send(res, 200, await getGame());
    // Çok oyunculu canlı yarışma (server/canli.mjs)
    if (pathname.startsWith('/api/canli/')) {
      if (await live(req, res, pathname, query, { send, readBody })) return;
      return send(res, 404, { error: 'Bulunamadı' });
    }
    if (method === 'POST' && pathname === '/api/sonuc') {
      const body = await readBody(req);
      const answers = Array.isArray(body.answers) ? body.answers.slice(0, 100) : [];
      const stats = await load('stats', DEFAULT_STATS);
      stats.games += 1;
      if (body.finished) stats.finished += 1;
      for (const a of answers) {
        if (typeof a?.id !== 'string') continue;
        const s = (stats.perQuestion[a.id] ??= { asked: 0, correct: 0 });
        s.asked += 1;
        if (a.correct) { s.correct += 1; stats.totalCorrect += 1; }
      }
      await save('stats', stats);
      return send(res, 200, { ok: true });
    }

    // Yönetici uçları
    if (!isAdmin(req)) return send(res, 401, { error: 'Şifre hatalı.' });

    if (method === 'GET' && pathname === '/api/admin') {
      const [questions, settings, stats] = await Promise.all([
        load('questions', []), load('settings', DEFAULT_SETTINGS), load('stats', DEFAULT_STATS),
      ]);
      return send(res, 200, { questions, settings: { ...DEFAULT_SETTINGS, ...settings }, stats });
    }
    if (method === 'POST' && pathname === '/api/sorular') {
      const { q, error } = cleanQuestion(await readBody(req));
      if (error) return send(res, 400, { error });
      const questions = await load('questions', []);
      questions.push(q);
      await save('questions', questions);
      return send(res, 201, q);
    }
    const m = pathname.match(/^\/api\/sorular\/([\w-]+)$/);
    if (m && (method === 'PUT' || method === 'DELETE')) {
      const questions = await load('questions', []);
      const i = questions.findIndex((x) => x.id === m[1]);
      if (i < 0) return send(res, 404, { error: 'Soru bulunamadı.' });
      if (method === 'DELETE') {
        questions.splice(i, 1);
      } else {
        const { q, error } = cleanQuestion(await readBody(req), questions[i]);
        if (error) return send(res, 400, { error });
        questions[i] = q;
      }
      await save('questions', questions);
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
      await save('questions', out);
      return send(res, 200, { ok: true, count: out.length });
    }
    if (method === 'PUT' && pathname === '/api/ayarlar') {
      const settings = cleanSettings(await readBody(req));
      await save('settings', settings);
      return send(res, 200, settings);
    }
    if (method === 'DELETE' && pathname === '/api/istatistik') {
      await save('stats', DEFAULT_STATS);
      return send(res, 200, { ok: true });
    }
    return send(res, 404, { error: 'Bulunamadı' });
  }

  return async (req, res, next) => {
    const { pathname, searchParams } = new URL(req.url, 'http://x');
    if (!pathname.startsWith('/api/')) return next?.();
    try {
      await (ready ??= init());
      await route(req, res, pathname, searchParams);
    } catch (err) {
      if (res.headersSent) return void res.end(); // akış açıldıktan sonra JSON hata gönderilemez
      send(res, err.status || 500, { error: err.message || 'Sunucu hatası' });
    }
  };
}
