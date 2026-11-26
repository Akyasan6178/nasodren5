// public/data/varsayilan-sorular.json → Supabase seed migration'ı.
//   node scripts/seed-migration.mjs          ilk seed dosyasını üretir / günceller
//   node scripts/seed-migration.mjs --check  en son seed dosyası JSON ile uyumlu değilse hata verir (CI / test)
//   node scripts/seed-migration.mjs --yeni   seed JSON değiştiyse YENİ bir migration dosyası üretir
//                                            (uygulanmış migration'ları değiştirmeyin)
//
// Dosya n5_soru_tohumla() çağırır: var olan sorulara (düzenlenmiş, pasif ya da silinmiş) dokunmaz, yalnızca
// eksik kimlikleri ekler. Supabase SQL Editor'e tamamı yapıştırılarak TEK İŞLEMDE uygulanır; önce şema
// migration'ının uygulandığını doğrular ve kendi sürümünü public.n5_migrations tablosuna yazar (aynı dosya
// ikinci kez uygulanırsa hata verip geri alınır).
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SEED = join(ROOT, 'public', 'data', 'varsayilan-sorular.json');
const DIR = join(ROOT, 'supabase', 'migrations');
const FIRST = '20261127090100_n5_seed_sorular.sql';
const SCHEMA_VERSION = '20261127090000';
const TAG = '$n5seed$';

/** @param {object[]} questions  @param {string} version 14 haneli migration sürümü */
export function seedSql(questions, version = FIRST.slice(0, 14)) {
  const json = JSON.stringify(questions, null, 2);
  if (json.includes(TAG)) throw new Error('Seed içinde dolar-tırnak etiketi geçiyor.');
  return [
    '-- OTOMATİK ÜRETİLDİ: node scripts/seed-migration.mjs (kaynak: public/data/varsayilan-sorular.json)',
    '-- Elle düzenlemeyin. Var olan sorulara dokunmaz; yalnızca eksik kimlikleri ekler.',
    "-- Supabase SQL Editor'e TAMAMINI yapıştırıp çalıştırın (tek işlem). Önce şema migration'ı uygulanmış olmalı.",
    'begin;',
    'do $n5$',
    'begin',
    `  if not exists (select 1 from public.n5_migrations where surum = '${SCHEMA_VERSION}') then`,
    `    raise exception 'N5: önce şema migration''ı (${SCHEMA_VERSION}_n5_sema.sql) uygulanmalı. Hiçbir değişiklik yapılmadı.';`,
    '  end if;',
    'end',
    '$n5$;',
    `select public.n5_soru_tohumla(${TAG}${json}${TAG}::jsonb);`,
    `insert into public.n5_migrations (surum) values ('${version}');`,
    'commit;',
    '',
  ].join('\n');
}

const latestSeedFile = () => readdirSync(DIR).filter((f) => f.endsWith('_n5_seed_sorular.sql')).sort().at(-1) ?? FIRST;

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const seed = JSON.parse(readFileSync(SEED, 'utf8'));
  const arg = process.argv[2];
  if (arg === '--check') {
    const latest = latestSeedFile();
    const file = join(DIR, latest);
    const current = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
    if (current !== seedSql(seed, latest.slice(0, 14))) {
      console.error(`${file} seed JSON ile uyumlu değil. "node scripts/seed-migration.mjs --yeni" çalıştırın.`);
      process.exit(1);
    }
    console.log('Seed migration güncel.');
  } else {
    const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
    const name = arg === '--yeni' ? `${stamp}_n5_seed_sorular.sql` : FIRST;
    writeFileSync(join(DIR, name), seedSql(seed, name.slice(0, 14)));
    console.log(`Yazıldı: supabase/migrations/${name}`);
  }
}
