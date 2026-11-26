// Ortak Supabase projesi izolasyonu: public şemasında önceki dört oyunu taklit eden nesneler varken
// beşinci oyunun migration'ları uygulanır. Kanıtlananlar:
//   * önceki nesnelerin hiçbiri (tanım, yetki, RLS, policy, varsayılan yetkiler, veri) değişmez,
//   * önceki oyunların anon erişimi bozulmaz,
//   * eklenen HER nesne "n5_" önekli,
//   * n5_ fonksiyonları yalnızca n5_ nesnelerine başvurur,
//   * n5_ adı zaten kullanılıyorsa migration hiçbir şey yapmadan durur (yarım uygulama yok).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { openDatabase, MIGRATIONS_DIR, migrationFiles } from '../scripts/lib/supabase-emulator.mjs';

// Önceki oyunları taklit eden nesneler: genel adlar, anon erişimi, RLS politikası, fonksiyon, view,
// sequence ve "n5" ile başlayan ama "n5_" önekli OLMAYAN bir ad (ön kontrol yanlış alarm vermemeli).
const OTHER_GAMES = `
create table public.questions (id serial primary key, soru text not null, dogru text);
create table public.settings (id int primary key, json jsonb);
create table public.stats_totals (id int primary key, games int default 0);
create table public.n50_scores (id int primary key, puan int);
create table public.oyun3_skorlar (oyuncu text primary key, puan int check (puan >= 0));
create index questions_soru_idx on public.questions (soru);
create view public.oyun2_ozet as select count(*) as soru_sayisi from public.questions;
create sequence public.oyun4_sayac;
alter table public.questions enable row level security;
create policy "herkes okur" on public.questions for select to anon using (true);
grant select on public.questions, public.oyun2_ozet to anon;
create function public.get_questions() returns setof public.questions language sql stable as $$ select * from public.questions $$;
insert into public.questions (soru, dogru) values ('Oyun 1 sorusu?', 'A'), ('Oyun 2 sorusu?', 'B');
insert into public.settings values (1, '{"tema":"mavi"}');
insert into public.stats_totals values (1, 42);
insert into public.oyun3_skorlar values ('Ali', 7);
`;

/** public şemasının (n5_ dışındaki) tam anlık görüntüsü: nesneler, tanımlar, yetkiler, RLS, policy, veri. */
async function snapshot(db, { includeN5 = false } = {}) {
  const keep = (n) => includeN5 || !(n.startsWith('n5_') || n.startsWith('_n5_'));
  const q = async (sql) => (await db.query(sql)).rows;
  const classes = (await q(`select relname, relkind, relrowsecurity, relforcerowsecurity, coalesce(relacl::text, '') acl
    from pg_class where relnamespace = 'public'::regnamespace order by relname`)).filter((r) => keep(r.relname));
  const procs = (await q(`select proname, pg_get_function_identity_arguments(oid) args, prosrc, prosecdef, coalesce(proacl::text, '') acl,
    coalesce(array_to_string(proconfig, ','), '') cfg from pg_proc where pronamespace = 'public'::regnamespace order by 1, 2`)).filter((r) => keep(r.proname));
  const cons = (await q(`select conname, conrelid::regclass::text rel, pg_get_constraintdef(oid) def from pg_constraint
    where connamespace = 'public'::regnamespace order by 1`)).filter((r) => keep(r.rel.replace(/^public\./, '')));
  const policies = (await q(`select tablename, policyname, cmd, roles::text, qual from pg_policies where schemaname = 'public' order by 1, 2`))
    .filter((r) => keep(r.tablename));
  const types = (await q(`select typname from pg_type where typnamespace = 'public'::regnamespace order by 1`)).filter((r) => keep(r.typname));
  const defaults = await q(`select defaclrole::regrole::text, defaclobjtype, defaclacl::text from pg_default_acl order by 1, 2`);
  const data = {};
  for (const t of classes.filter((c) => c.relkind === 'r' || c.relkind === 'v')) {
    data[t.relname] = (await q(`select coalesce(json_agg(x order by x::text), '[]')::text d from public.${t.relname} x`))[0].d;
  }
  return { classes, procs, cons, policies, types, defaults, data };
}

const applyAll = async (db) => {
  for (const f of migrationFiles()) await db.exec(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));
};

test('önceki oyunların nesneleri, yetkileri, politikaları ve verisi değişmez', async () => {
  const db = await openDatabase({ migrations: false, setup: OTHER_GAMES });
  const before = await snapshot(db);
  await applyAll(db);
  const after = await snapshot(db);
  assert.deepEqual(after.classes, before.classes, 'tablo/indeks/view/sequence ya da RLS/yetki değişti');
  assert.deepEqual(after.procs, before.procs, 'fonksiyon değişti');
  assert.deepEqual(after.cons, before.cons, 'kısıt değişti');
  assert.deepEqual(after.policies, before.policies, 'RLS politikası değişti');
  assert.deepEqual(after.types, before.types);
  assert.deepEqual(after.defaults, before.defaults, 'varsayılan yetkiler değişti');
  assert.deepEqual(after.data, before.data, 'önceki oyunların verisi değişti');
  await db.close();
});

test('önceki oyunların anon erişimi bozulmaz; beşinci oyunun tablolarına anon erişemez', async () => {
  const db = await openDatabase({ migrations: false, setup: OTHER_GAMES });
  await applyAll(db);
  const asAnon = (sql) => db.transaction(async (tx) => { await tx.exec('set local role anon'); return tx.query(sql); });
  assert.equal((await asAnon('select count(*)::int c from public.questions')).rows[0].c, 2, 'önceki oyunun anon okuması bozuldu');
  assert.equal((await asAnon('select soru_sayisi::int c from public.oyun2_ozet')).rows[0].c, 2);
  await assert.rejects(asAnon('select * from public.n5_questions'), /permission denied/);
  await assert.rejects(asAnon('select public.n5_oyun_verisi()'), /permission denied/);
  await db.close();
});

test('migration\'ların eklediği her nesne "n5_" önekli; fonksiyonlar yalnızca n5_ nesnelerine başvurur', async () => {
  const db = await openDatabase({ migrations: false, setup: OTHER_GAMES });
  const before = await snapshot(db, { includeN5: true });
  await applyAll(db);
  const after = await snapshot(db, { includeN5: true });
  const added = (key, name) => after[key].map(name).filter((n) => !before[key].map(name).includes(n));
  const newNames = [
    ...added('classes', (r) => r.relname),
    ...added('procs', (r) => r.proname),
    ...added('types', (r) => r.typname),
    ...added('cons', (r) => r.conname),
  ];
  assert.ok(newNames.length > 40, `beklenen nesneler oluşmadı (${newNames.length})`);
  const bad = newNames.filter((n) => !n.startsWith('n5_') && !n.startsWith('_n5_'));
  assert.deepEqual(bad, [], `önek dışı nesne: ${bad.join(', ')}`);
  assert.deepEqual(added('policies', (r) => r.policyname), [], 'n5_ tablolarında politika olmamalı');
  for (const p of after.procs.filter((r) => r.proname.startsWith('n5_'))) {
    const refs = [...p.prosrc.matchAll(/public\.([a-z0-9_]+)/g)].map((m) => m[1]);
    const foreign = refs.filter((r) => !r.startsWith('n5_'));
    assert.deepEqual(foreign, [], `${p.proname} başka nesnelere başvuruyor: ${foreign.join(', ')}`);
  }
  await db.close();
});

test('n5_ adı zaten kullanılıyorsa migration hiçbir şey yapmadan durur', async () => {
  for (const conflict of [
    'create table public.n5_questions (x int);',
    'create function public.n5_genel_durum() returns int language sql as $$ select 1 $$;',
    'create type public.n5_ayar as enum (\'a\');',
  ]) {
    const db = await openDatabase({ migrations: false, setup: OTHER_GAMES + conflict });
    const before = await snapshot(db, { includeN5: true });
    const schema = migrationFiles().find((f) => f.endsWith('_n5_sema.sql'));
    await assert.rejects(db.exec(readFileSync(join(MIGRATIONS_DIR, schema), 'utf8')), /n5_/, conflict);
    await db.exec('rollback').catch(() => undefined);
    assert.deepEqual(await snapshot(db, { includeN5: true }), before, `yarım uygulama kaldı: ${conflict}`);
    await db.close();
  }
});
