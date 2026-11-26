// Production frontend çıktısının (dist/) güvenlik taraması. `npm run build` sonrasında çalıştırılır;
// bir bulgu varsa 1 koduyla çıkar (CI'da deploy'u durdurur).
//   * seed dosyası (dist/data) ya da cevap anahtarı / açıklama / ipucu metinleri
//   * Supabase service-role / secret anahtarı biçimleri, yönetici parolası değişken değerleri
//   * migration / SQL içeriği
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');

export function scanDist(dist = DIST) {
  const findings = [];
  if (!existsSync(dist)) return ['dist/ yok: önce npm run build'];
  if (existsSync(join(dist, 'data'))) findings.push('dist/data var: seed (cevap anahtarı) yayına çıkar');
  const seed = JSON.parse(readFileSync(join(ROOT, 'public', 'data', 'varsayilan-sorular.json'), 'utf8'));
  const secrets = seed.flatMap((q) => [q.aciklama, q.ipucu, ...q.yanlisAciklamalar].map((t) => [q.id, t]));
  const patterns = [
    [/sb_secret_[A-Za-z0-9_-]{8,}/, 'Supabase secret anahtarı'],
    [/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, 'JWT (service_role anahtarı olabilir)'],
    [/SUPABASE_SERVICE_KEY|service_role/, 'Supabase backend anahtarı adı'],
    [/ADMIN_PASSWORD/, 'yönetici parolası değişkeni'],
    [/n5_soru_tohumla|create table|create or replace function/i, 'migration / SQL içeriği'],
    [/"yanlisAciklamalar"\s*:\s*\[/, 'soru verisi (açıklama dizisi)'],
  ];
  const files = [];
  const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else files.push(p); } };
  walk(dist);
  for (const file of files) {
    if (!/\.(js|css|html|json|txt|map|svg|webmanifest)$/.test(file) && !file.endsWith('_headers') && !file.endsWith('_redirects')) continue;
    const text = readFileSync(file, 'utf8');
    const rel = relative(ROOT, file);
    for (const [id, t] of secrets) if (text.includes(t)) findings.push(`${rel}: ${id} cevap anahtarı/açıklama metni`);
    for (const [re, what] of patterns) if (re.test(text)) findings.push(`${rel}: ${what}`);
  }
  return findings;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const findings = scanDist();
  if (findings.length) {
    console.error(`Paket taraması BAŞARISIZ (${findings.length} bulgu):\n  ${findings.join('\n  ')}`);
    process.exit(1);
  }
  console.log('Paket taraması temiz: cevap anahtarı, seed, migration verisi ya da secret yok.');
}
