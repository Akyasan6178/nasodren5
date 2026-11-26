// Supabase migration'ları: gerçek PostgreSQL motorunda (PGlite) sıfırdan kurulum, erişim kısıtları,
// veri eşlemesi, idempotency ve atomik güncellemeler.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { openDatabase, applyMigrations, MIGRATIONS_DIR, migrationFiles } from '../scripts/lib/supabase-emulator.mjs';
import { seed as loadSeed } from './helpers.mjs';

const seed = loadSeed();

/** Belirli bir rolle çalıştırır (Supabase'deki anon / authenticated / service_role). */
async function asRole(db, role, sql, params) {
  return db.transaction(async (tx) => {
    await tx.exec(`set local role ${role}`);
    return tx.query(sql, params);
  });
}
const rpc = async (db, fn, args = {}, role = 'service_role') => {
  const names = Object.keys(args);
  const r = await asRole(db, role, `select public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')}) as r`,
    names.map((n) => (args[n] !== null && typeof args[n] === 'object' ? JSON.stringify(args[n]) : args[n])));
  return r.rows[0].r;
};
const code = async (p) => p.then(() => 'ok', (e) => e.code);

test('migration\'lar sıfırdan kurulur, yeniden uygulanınca hiçbir şey değişmez', async () => {
  const db = await openDatabase();
  const tables = (await db.query(`select tablename from pg_tables where schemaname = 'public' and tablename not like 'n5_emulator%' order by 1`)).rows.map((r) => r.tablename);
  assert.deepEqual(tables, ['data_imports', 'game_results', 'question_stats', 'questions', 'settings', 'stats_totals']);
  assert.equal((await db.query('select count(*)::int c from public.questions')).rows[0].c, 30);
  assert.equal((await db.query('select count(*)::int c from public.settings')).rows[0].c, 1);
  assert.equal((await db.query('select games::int from public.stats_totals')).rows[0].games, 0);
  // Migration'ları ikinci kez (izleme tablosu olmadan, ham SQL olarak) çalıştırmak da güvenli olmalı
  for (const f of migrationFiles()) await db.exec(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));
  assert.equal((await db.query('select count(*)::int c from public.questions')).rows[0].c, 30);
  assert.deepEqual(await applyMigrations(db), []);
  await db.close();
});

test('RLS açık, anon ve authenticated hiçbir tabloyu ve fonksiyonu kullanamaz', async () => {
  const db = await openDatabase();
  const rls = (await db.query(`select relname, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and relname not like 'n5_emulator%'`)).rows;
  for (const r of rls) assert.equal(r.relrowsecurity, true, `${r.relname} RLS kapalı`);
  for (const role of ['anon', 'authenticated']) {
    for (const t of ['questions', 'settings', 'stats_totals', 'question_stats', 'game_results', 'data_imports']) {
      assert.equal(await code(asRole(db, role, `select * from public.${t}`)), '42501', `${role} ${t} okuyabildi`);
      assert.equal(await code(asRole(db, role, `delete from public.${t}`)), '42501', `${role} ${t} silebildi`);
    }
    assert.equal(await code(asRole(db, role, `insert into public.questions (id, soru, dogru, yanlislar, kategori, ipucu, aciklama, yanlis_aciklamalar) values ('x','s','d','{a,b,c}','k','i','a','{a,b,c}')`)), '42501');
    for (const fn of ['n5_oyun_verisi()', 'n5_admin_verisi()', 'n5_genel_durum()', 'n5_istatistik_sifirla()']) {
      assert.equal(await code(asRole(db, role, `select public.${fn}`)), '42501', `${role} ${fn} çalıştırabildi`);
    }
  }
  assert.equal((await rpc(db, 'n5_oyun_verisi')).questions.length, 30, 'service_role çalışabilmeli');
  await db.close();
});

test('fonksiyonlar SECURITY INVOKER ve sabit, boş search_path ile tanımlı', async () => {
  const db = await openDatabase();
  const fns = (await db.query(`select proname, prosecdef, proconfig from pg_proc where pronamespace = 'public'::regnamespace and proname like 'n5_%'`)).rows;
  assert.ok(fns.length >= 15);
  for (const f of fns) {
    assert.equal(f.prosecdef, false, `${f.proname} SECURITY DEFINER`);
    assert.ok((f.proconfig ?? []).some((c) => c === 'search_path=""' || c === 'search_path='), `${f.proname} search_path sabit değil: ${f.proconfig}`);
  }
  await db.close();
});

test('soru eşlemesi kayıpsız: veritabanından dönen sorular seed ile birebir aynı', async () => {
  const db = await openDatabase();
  const { questions } = await rpc(db, 'n5_admin_verisi');
  assert.deepEqual(questions, seed);
  const pub = await rpc(db, 'n5_genel_durum');
  assert.deepEqual(Object.keys(pub).sort(), ['aktifSoru', 'ayarlar']);
  assert.ok(!JSON.stringify(pub).includes('"dogru"'));
  await db.close();
});

test('seed idempotent: tekrar çalışınca yineleme yok, düzenleme ve silme korunur', async () => {
  const db = await openDatabase();
  await rpc(db, 'n5_soru_guncelle', { p_id: seed[0].id, p_soru: { ...seed[0], ipucu: 'Yönetici değiştirdi', aktif: false } });
  await rpc(db, 'n5_soru_sil', { p_id: seed[1].id });
  const r = await rpc(db, 'n5_soru_tohumla', { p_sorular: seed });
  assert.deepEqual(r, { eklenen: 0, mevcut: 30 });
  const { questions } = await rpc(db, 'n5_admin_verisi');
  assert.equal(questions.length, 29, 'silinen soru geri gelmemeli');
  const q0 = questions.find((q) => q.id === seed[0].id);
  assert.equal(q0.ipucu, 'Yönetici değiştirdi');
  assert.equal(q0.aktif, false);
  assert.equal((await rpc(db, 'n5_oyun_verisi')).questions.length, 28, 'pasif ve silinen sorular oyunda yok');
  await db.close();
});

test('oyun sonucu bir kez sayılır; sayaçlar tek ifadeyle atomik artar', async () => {
  const db = await openDatabase();
  const id = crypto.randomUUID();
  const answers = [{ id: 'sinus-01', correct: true }, { id: 'sinus-02', correct: false }, { id: 'sinus-01', correct: true }];
  assert.deepEqual(await rpc(db, 'n5_oyun_kaydet', { p_oyun_id: id, p_tur: 'tek', p_cevaplar: answers, p_bitti: true }), { kaydedildi: true });
  for (let i = 0; i < 3; i++) assert.deepEqual(await rpc(db, 'n5_oyun_kaydet', { p_oyun_id: id, p_tur: 'tek', p_cevaplar: answers, p_bitti: true }), { kaydedildi: false });
  await rpc(db, 'n5_oyun_kaydet', { p_oyun_id: crypto.randomUUID(), p_tur: 'canli', p_cevaplar: [{ id: 'sinus-02', correct: true }], p_bitti: true });
  const { stats } = await rpc(db, 'n5_admin_verisi');
  assert.deepEqual(stats, {
    games: 1, finished: 1, totalCorrect: 2,
    perQuestion: { 'sinus-01': { asked: 2, correct: 2 }, 'sinus-02': { asked: 2, correct: 1 } },
  });
  // Bozuk girdiler reddedilir
  for (const bad of [[{ id: 1, correct: true }], [{ id: 'x' }], [{ id: 'x', correct: 'evet' }], { not: 'array' }]) {
    assert.equal(await code(rpc(db, 'n5_oyun_kaydet', { p_oyun_id: crypto.randomUUID(), p_tur: 'tek', p_cevaplar: bad, p_bitti: true })), 'PT400');
  }
  assert.equal(await code(rpc(db, 'n5_oyun_kaydet', { p_oyun_id: crypto.randomUUID(), p_tur: 'hile', p_cevaplar: [], p_bitti: true })), 'PT400');
  // Fonksiyonda istemci tarafı oku-değiştir-yaz yok: güncellemeler "games = games + 1" biçiminde
  const src = (await db.query(`select prosrc from pg_proc where proname = 'n5_oyun_kaydet'`)).rows[0].prosrc;
  assert.match(src, /games = games \+ 1/);
  assert.match(src, /on conflict \(game_id\) do nothing/);
  await db.close();
});

test('ayarlar: iyimser eşzamanlılık — eski sürümle yazma 409, geçersiz değer 400', async () => {
  const db = await openDatabase();
  const s1 = (await rpc(db, 'n5_admin_verisi')).settings;
  assert.equal(s1.surum, 1);
  const s2 = await rpc(db, 'n5_ayarlari_guncelle', { p_ayarlar: { questionsPerGame: 5, endOnWrong: false, secondsPerQuestion: 20 }, p_surum: 1 });
  assert.deepEqual(s2, { questionsPerGame: 5, endOnWrong: false, secondsPerQuestion: 20, surum: 2 });
  // Aynı eski sürümle ikinci yazma (başka bir sekmeden) reddedilir; ilk yazma ezilmez
  assert.equal(await code(rpc(db, 'n5_ayarlari_guncelle', { p_ayarlar: { questionsPerGame: 9, endOnWrong: true, secondsPerQuestion: 30 }, p_surum: 1 })), 'PT409');
  assert.equal((await rpc(db, 'n5_admin_verisi')).settings.questionsPerGame, 5);
  for (const bad of [{ questionsPerGame: 0, endOnWrong: true, secondsPerQuestion: 30 }, { questionsPerGame: 'x', endOnWrong: true, secondsPerQuestion: 30 }, { questionsPerGame: 5, endOnWrong: true, secondsPerQuestion: 999 }]) {
    assert.equal(await code(rpc(db, 'n5_ayarlari_guncelle', { p_ayarlar: bad, p_surum: 2 })), 'PT400');
  }
  await db.close();
});

test('toplu değiştirme tek işlemdir: hatalı bir soru varsa hiçbir değişiklik uygulanmaz', async () => {
  const db = await openDatabase();
  const list = seed.slice(0, 5).map((q) => ({ ...q, ipucu: 'yeni' }));
  assert.equal(await code(rpc(db, 'n5_sorulari_degistir', { p_sorular: [...list, { ...seed[6], yanlislar: ['a'] }] })), 'PT400');
  assert.equal((await rpc(db, 'n5_admin_verisi')).questions.length, 30, 'yarım değişiklik kalmamalı');
  const r = await rpc(db, 'n5_sorulari_degistir', { p_sorular: list });
  assert.deepEqual(r, { ok: true, count: 5 });
  const { questions } = await rpc(db, 'n5_admin_verisi');
  assert.equal(questions.length, 5);
  assert.ok(questions.every((q) => q.ipucu === 'yeni'));
  // Listeye geri eklenen soru, silinmiş olsa bile geri gelir
  await rpc(db, 'n5_sorulari_degistir', { p_sorular: seed });
  assert.equal((await rpc(db, 'n5_admin_verisi')).questions.length, 30);
  await db.close();
});

test('eski istatistik aktarımı bir kez uygulanır', async () => {
  const db = await openDatabase();
  const data = { games: 7, finished: 2, totalCorrect: 20, perQuestion: { 'sinus-01': { asked: 5, correct: 3 } } };
  assert.deepEqual(await rpc(db, 'n5_istatistik_aktar', { p_aktarim_id: 'test:1', p_istatistik: data }), { aktarildi: true });
  assert.deepEqual(await rpc(db, 'n5_istatistik_aktar', { p_aktarim_id: 'test:1', p_istatistik: data }), { aktarildi: false });
  const { stats } = await rpc(db, 'n5_admin_verisi');
  assert.equal(stats.games, 7);
  assert.deepEqual(stats.perQuestion['sinus-01'], { asked: 5, correct: 3 });
  await db.close();
});

test('kısıtlar: geçersiz soru verisi tabloya yazılamaz', async () => {
  const db = await openDatabase();
  const base = { ...seed[0], id: 'yeni-soru' };
  for (const bad of [{ ...base, soru: '' }, { ...base, id: 'bozuk id!' }, { ...base, kategori: 'x'.repeat(61) }, { ...base, yanlislar: ['a', 'b'] }]) {
    assert.equal(await code(rpc(db, 'n5_soru_ekle', { p_soru: bad })), 'PT400', JSON.stringify(bad).slice(0, 60));
  }
  assert.equal(await code(rpc(db, 'n5_soru_ekle', { p_soru: { ...base, id: seed[0].id } })), 'PT409');
  assert.equal(await code(rpc(db, 'n5_soru_guncelle', { p_id: 'yok', p_soru: base })), 'PT404');
  await db.close();
});
