// JSON → Supabase veri aktarımı (scripts/supabase-import.mjs): yedek, idempotency, alan kaybı olmaması.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importData } from '../scripts/supabase-import.mjs';
import { startSupabaseEmulator } from '../scripts/lib/supabase-emulator.mjs';
import { seed as loadSeed } from './helpers.mjs';

const seed = loadSeed();
const quiet = () => {};

async function setup(t) {
  const db = await startSupabaseEmulator();
  const dir = await mkdtemp(join(tmpdir(), 'n5-aktarim-'));
  t.after(async () => { await db.close(); await rm(dir, { recursive: true, force: true }); });
  return { db, dir, src: join(dir, 'data'), backups: join(dir, 'yedek') };
}

test('kuru çalıştırma hiçbir şey yazmaz', async (t) => {
  const { db, dir, backups } = await setup(t);
  const r = await importData({ url: db.url, key: db.serviceKey, sourceDir: join(dir, 'yok'), apply: false, backupDir: backups, log: quiet });
  assert.equal(r.applied, false);
  assert.ok(!db.calls.some((c) => !['n5_admin_verisi'].includes(c.fn)), 'yalnızca okuma yapılmalı');
});

test('eski JSON kurulumu: sorular, ayarlar ve istatistik aktarılır; ikinci çalıştırma tekrar eklemez', async (t) => {
  const { db, src, backups } = await setup(t);
  const { mkdir } = await import('node:fs/promises');
  await mkdir(src, { recursive: true });
  // Yönetici düzenlemesi içeren gerçek liste: bir soru değişmiş, biri silinmiş, biri yeni
  const questions = seed.slice(1).map((q, i) => (i === 0 ? { ...q, ipucu: 'Panelde değişti', aktif: false } : q));
  questions.push({ ...seed[0], id: 'panel-yeni', soru: 'Panelden eklenen soru?', olusturma: '2026-11-20T10:00:00.000Z' });
  await writeFile(join(src, 'questions.json'), JSON.stringify(questions));
  await writeFile(join(src, 'settings.json'), JSON.stringify({ questionsPerGame: 12, endOnWrong: false, secondsPerQuestion: 45 }));
  await writeFile(join(src, 'stats.json'), JSON.stringify({ games: 40, finished: 9, totalCorrect: 210, perQuestion: { 'sinus-02': { asked: 10, correct: 7 } } }));

  const first = await importData({ url: db.url, key: db.serviceKey, sourceDir: src, apply: true, backupDir: backups, log: quiet });
  assert.deepEqual(first.problems, []);
  assert.equal(first.after.questions.length, questions.length);
  assert.ok(!first.after.questions.some((q) => q.id === seed[0].id), 'listede olmayan soru silinmiş işaretlenir');
  assert.equal(first.after.questions.find((q) => q.id === questions[0].id).ipucu, 'Panelde değişti');
  assert.deepEqual(first.after.settings, { questionsPerGame: 12, endOnWrong: false, secondsPerQuestion: 45, surum: 2 });
  assert.equal(first.after.stats.games, 40);
  assert.deepEqual(first.after.stats.perQuestion['sinus-02'], { asked: 10, correct: 7 });

  const files = await readdir(backups);
  assert.equal(files.length, 1, 'aktarım öncesi yedek alınmalı');
  assert.equal(JSON.parse(await readFile(join(backups, files[0]), 'utf8')).veri.questions.length, 30);

  const second = await importData({ url: db.url, key: db.serviceKey, sourceDir: src, apply: true, backupDir: backups, log: quiet });
  assert.deepEqual(second.problems, []);
  assert.equal(second.after.stats.games, 40, 'istatistik iki kez aktarılmamalı');
  assert.equal(second.after.questions.length, questions.length, 'yinelenen soru oluşmamalı');
  assert.equal(second.after.settings.surum, 2, 'aynı ayarlar yeniden yazılmamalı');
});

test('kaynak yoksa yalnızca seed eklenir ve var olan düzenlemelere dokunulmaz', async (t) => {
  const { db, dir, backups } = await setup(t);
  await db.query(`update public.questions set ipucu = 'Elle değişti' where id = 'sinus-01'`);
  const r = await importData({ url: db.url, key: db.serviceKey, sourceDir: join(dir, 'yok'), apply: true, backupDir: backups, log: quiet });
  assert.deepEqual(r.problems, []);
  assert.equal(r.after.questions.length, 30);
  assert.equal(r.after.questions.find((q) => q.id === 'sinus-01').ipucu, 'Elle değişti');
});

test('anahtar olmadan çalışmaz; anahtar hiçbir çıktıya yazılmaz', async (t) => {
  const { db, dir, backups } = await setup(t);
  await assert.rejects(importData({ url: db.url, key: '', sourceDir: dir, apply: true, backupDir: backups, log: quiet }), /SUPABASE_SERVICE_KEY/);
  const lines = [];
  await importData({ url: db.url, key: db.serviceKey, sourceDir: join(dir, 'yok'), apply: true, backupDir: backups, log: (l) => lines.push(l) });
  assert.ok(!lines.join('\n').includes(db.serviceKey));
});
