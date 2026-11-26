// Eski JSON kurulumundan (data/*.json) ya da yalnızca seed'den Supabase'e kontrollü veri aktarımı.
//
//   SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node scripts/supabase-import.mjs [--kaynak data] [--uygula]
//
// Varsayılan "kuru çalıştırma"dır: yalnızca plan yazdırılır. --uygula ile yazma yapılır.
// Anahtar yalnızca ortam değişkeninden okunur; hiçbir çıktıya yazılmaz.
//
// Kurallar:
//   * Önce Supabase'in mevcut hâli yedeklenir: yedek/supabase-<zaman>.json (git dışında).
//   * Sorular: data/questions.json VARSA yönetici tarafından düzenlenmiş gerçek liste odur ve Supabase'deki
//     listenin yerine geçer (listede olmayan sorular silinmiş işaretlenir, silinmez). YOKSA yalnızca seed
//     eklenir (var olan sorulara dokunulmaz). İkisi de idempotenttir.
//   * Ayarlar: data/settings.json varsa güncel sürüm üzerine yazılır.
//   * İstatistik: data/stats.json bir kez aktarılır (dosya içeriğinin özeti aktarım kimliğidir; ikinci
//     çalıştırma aynı istatistiği tekrar eklemez).
//   * Sonunda kayıt sayıları ve alanlar kaynakla karşılaştırılır.
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SEED = join(ROOT, 'public', 'data', 'varsayilan-sorular.json');
const FIELDS = ['id', 'soru', 'dogru', 'yanlislar', 'kategori', 'ipucu', 'aciklama', 'yanlisAciklamalar', 'aktif'];

export async function importData({ url, key, sourceDir, apply, backupDir = join(ROOT, 'yedek'), log = console.log }) {
  if (!url || !key) throw new Error('SUPABASE_URL ve SUPABASE_SERVICE_KEY ortam değişkenleri gerekli.');
  const headers = { apikey: key, 'content-type': 'application/json', ...(key.startsWith('sb_') ? {} : { authorization: `Bearer ${key}` }) };
  const rpc = async (fn, args = {}) => {
    const res = await fetch(`${url.replace(/\/$/, '')}/rest/v1/rpc/${fn}`, { method: 'POST', headers, body: JSON.stringify(args) });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`${fn}: HTTP ${res.status} ${body?.code ?? ''} ${body?.message ?? ''}`.trim());
    return body;
  };
  const read = (name) => {
    const file = join(sourceDir, name);
    return existsSync(file) ? { file, text: readFileSync(file, 'utf8'), json: JSON.parse(readFileSync(file, 'utf8')) } : null;
  };

  const questions = read('questions.json');
  const settings = read('settings.json');
  const stats = read('stats.json');
  const seed = JSON.parse(readFileSync(SEED, 'utf8'));
  const sourceQuestions = questions?.json ?? null;
  if (sourceQuestions && !Array.isArray(sourceQuestions)) throw new Error(`${questions.file} bir soru listesi değil.`);

  const before = await rpc('n5_admin_verisi');
  log(`Supabase şu an: ${before.questions.length} soru, ayar sürümü ${before.settings.surum}, ${before.stats.games} oyun.`);
  log(`Kaynak: ${sourceQuestions ? `${questions.file} (${sourceQuestions.length} soru)` : `seed (${seed.length} soru, yalnızca eksikler eklenir)`}`
    + `${settings ? `, ${settings.file}` : ''}${stats ? `, ${stats.file}` : ''}`);
  if (!apply) {
    log('Kuru çalıştırma: hiçbir şey yazılmadı. Uygulamak için --uygula ekleyin.');
    return { applied: false };
  }

  mkdirSync(backupDir, { recursive: true });
  const backup = join(backupDir, `supabase-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(backup, JSON.stringify({ alindi: new Date().toISOString(), veri: before }, null, 2));
  log(`Yedek: ${backup}`);

  if (sourceQuestions) {
    const r = await rpc('n5_sorulari_degistir', { p_sorular: sourceQuestions.map((q) => ({ aktif: true, ...q })) });
    log(`Sorular aktarıldı: ${r.count}`);
  } else {
    const r = await rpc('n5_soru_tohumla', { p_sorular: seed });
    log(`Seed: ${r.eklenen} eklendi, ${r.mevcut} zaten vardı.`);
  }
  if (settings) {
    const current = (await rpc('n5_admin_verisi')).settings;
    const s = settings.json;
    const same = ['questionsPerGame', 'endOnWrong', 'secondsPerQuestion'].every((k) => s[k] === undefined || s[k] === current[k]);
    if (same) log('Ayarlar zaten aynı.');
    else log(`Ayarlar güncellendi (sürüm ${(await rpc('n5_ayarlari_guncelle', { p_ayarlar: { ...current, ...s }, p_surum: current.surum })).surum}).`);
  }
  if (stats) {
    const id = `json-istatistik:${createHash('sha256').update(stats.text).digest('hex')}`;
    const r = await rpc('n5_istatistik_aktar', { p_aktarim_id: id, p_istatistik: stats.json });
    log(r.aktarildi ? 'İstatistik aktarıldı.' : 'İstatistik daha önce aktarılmış; tekrar eklenmedi.');
  }

  // Doğrulama: kaynak sorular Supabase'de alan kaybı olmadan var mı?
  const after = await rpc('n5_admin_verisi');
  const expected = sourceQuestions ?? seed;
  const byId = new Map(after.questions.map((q) => [q.id, q]));
  const problems = [];
  for (const q of expected) {
    const got = byId.get(q.id);
    if (!got) { if (sourceQuestions) problems.push(`${q.id} eksik`); continue; }
    if (!sourceQuestions) continue; // seed: var olan (düzenlenmiş) sorular bilerek değiştirilmedi
    for (const f of FIELDS) {
      const want = f === 'aktif' ? q.aktif !== false : q[f];
      if (JSON.stringify(got[f]) !== JSON.stringify(want)) problems.push(`${q.id}.${f} farklı`);
    }
  }
  if (sourceQuestions && after.questions.length !== sourceQuestions.length) problems.push(`soru sayısı ${after.questions.length}, beklenen ${sourceQuestions.length}`);
  log(problems.length ? `DOĞRULAMA HATASI:\n  ${problems.join('\n  ')}` : `Doğrulandı: ${after.questions.length} soru, ${after.stats.games} oyun.`);
  return { applied: true, backup, problems, after };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const i = args.indexOf('--kaynak');
  importData({
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_SERVICE_KEY,
    sourceDir: resolve(i >= 0 ? args[i + 1] : join(ROOT, 'data')),
    apply: args.includes('--uygula'),
  })
    .then((r) => { if (r.problems?.length) process.exit(1); })
    .catch((err) => { console.error(`Aktarım başarısız: ${err.message}`); process.exit(1); });
}
