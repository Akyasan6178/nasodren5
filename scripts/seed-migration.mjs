// public/data/varsayilan-sorular.json → Supabase seed migration'ı.
//   node scripts/seed-migration.mjs          dosyayı üretir / günceller
//   node scripts/seed-migration.mjs --check  dosya JSON ile uyumlu değilse hata verir (CI / test)
//
// Migration n5_soru_tohumla() çağırır: var olan sorulara (düzenlenmiş, pasif ya da silinmiş) dokunmaz,
// yalnızca eksik kimlikleri ekler. Bu yüzden tekrar çalıştırmak güvenlidir.
// Seed JSON'u değişirse YENİ bir migration dosyası üretin (uygulanmış migration'ları değiştirmeyin):
//   node scripts/seed-migration.mjs --yeni
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SEED = join(ROOT, 'public', 'data', 'varsayilan-sorular.json');
const DIR = join(ROOT, 'supabase', 'migrations');
const FIRST = '20261126120100_n5_seed_sorular.sql';
const TAG = '$n5seed$';

export function seedSql(questions) {
  const json = JSON.stringify(questions, null, 2);
  if (json.includes(TAG)) throw new Error('Seed içinde dolar-tırnak etiketi geçiyor.');
  return [
    '-- OTOMATİK ÜRETİLDİ: node scripts/seed-migration.mjs (kaynak: public/data/varsayilan-sorular.json)',
    '-- Elle düzenlemeyin. Var olan sorulara dokunmaz; yalnızca eksik kimlikleri ekler.',
    `select public.n5_soru_tohumla(${TAG}${json}${TAG}::jsonb);`,
    '',
  ].join('\n');
}

const latestSeedFile = () => readdirSync(DIR).filter((f) => f.endsWith('_n5_seed_sorular.sql')).sort().at(-1) ?? FIRST;

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const sql = seedSql(JSON.parse(readFileSync(SEED, 'utf8')));
  const arg = process.argv[2];
  if (arg === '--check') {
    const file = join(DIR, latestSeedFile());
    const current = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
    if (current !== sql) {
      console.error(`${file} seed JSON ile uyumlu değil. "node scripts/seed-migration.mjs --yeni" çalıştırın.`);
      process.exit(1);
    }
    console.log('Seed migration güncel.');
  } else {
    const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
    const name = arg === '--yeni' ? `${stamp}_n5_seed_sorular.sql` : FIRST;
    writeFileSync(join(DIR, name), sql);
    console.log(`Yazıldı: supabase/migrations/${name}`);
  }
}
