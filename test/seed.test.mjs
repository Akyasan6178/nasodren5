// Varsayılan soru havuzunun (public/data/varsayilan-sorular.json) şema ve içerik denetimi.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { cleanQuestion } from '../server/api.mjs';
import { SEED_FILE } from './helpers.mjs';

const ALLOWED_KEYS = new Set(['id', 'soru', 'dogru', 'yanlislar', 'kategori', 'ipucu', 'aciklama', 'yanlisAciklamalar', 'aktif', 'olusturma']);
// Yönetici panelindeki form sınırları (admin.html maxlength) ve sunucu sınırları (cleanQuestion) ile aynı.
const LIMITS = { soru: 300, dogru: 120, yanlis: 120, kategori: 60, ipucu: 300, aciklama: 400, yanlisAciklama: 300 };
const DEFAULT_QUESTIONS_PER_GAME = 15;

const seed = JSON.parse(await readFile(SEED_FILE, 'utf8'));

test('seed bir soru listesidir ve varsayılan oyunu doldurmaya yeter', () => {
  assert.ok(Array.isArray(seed), 'üst seviye bir dizi olmalı');
  assert.ok(seed.length >= DEFAULT_QUESTIONS_PER_GAME, `en az ${DEFAULT_QUESTIONS_PER_GAME} soru olmalı (şu an ${seed.length})`);
});

test('soru kimlikleri benzersiz ve API yoluna uygun', () => {
  const ids = seed.map((q) => q.id);
  assert.equal(new Set(ids).size, ids.length, 'yinelenen id var');
  for (const id of ids) assert.match(id, /^[\w-]+$/, `id API yolu deseniyle eşleşmiyor: ${id}`);
});

for (const q of seed) {
  test(`soru ${q.id}: şema, içerik ve doğrulama`, () => {
    for (const k of Object.keys(q)) assert.ok(ALLOWED_KEYS.has(k), `şema dışı alan: ${k}`);
    for (const k of ['soru', 'dogru', 'kategori', 'ipucu', 'aciklama']) {
      assert.equal(typeof q[k], 'string', `${k} metin olmalı`);
      assert.ok(q[k].trim().length > 0, `${k} boş`);
      assert.equal(q[k], q[k].trim(), `${k} baş/son boşluk içeriyor`);
    }
    assert.ok(Array.isArray(q.yanlislar) && q.yanlislar.length === 3, 'tam üç yanlış şık olmalı');
    assert.ok(Array.isArray(q.yanlisAciklamalar), 'yanlisAciklamalar dizi olmalı');
    assert.equal(q.yanlisAciklamalar.length, q.yanlislar.length, 'yanlış açıklamaları yanlış şıklarla aynı uzunlukta olmalı');
    for (const s of [...q.yanlislar, ...q.yanlisAciklamalar]) {
      assert.ok(typeof s === 'string' && s.trim().length > 0 && s === s.trim(), 'boş ya da boşluklu şık/açıklama');
    }
    const options = [q.dogru, ...q.yanlislar].map((s) => s.toLocaleLowerCase('tr'));
    assert.equal(new Set(options).size, 4, 'şıklar birbirinden farklı olmalı');
    assert.equal(q.aktif, true, 'başlangıçta aktif olmalı');

    assert.ok(q.soru.length <= LIMITS.soru, 'soru çok uzun');
    assert.ok(q.dogru.length <= LIMITS.dogru, 'doğru şık çok uzun');
    assert.ok(q.kategori.length <= LIMITS.kategori, 'kategori çok uzun');
    assert.ok(q.ipucu.length <= LIMITS.ipucu, 'ipucu çok uzun');
    assert.ok(q.aciklama.length <= LIMITS.aciklama, 'açıklama çok uzun');
    for (const y of q.yanlislar) assert.ok(y.length <= LIMITS.yanlis, 'yanlış şık çok uzun');
    for (const w of q.yanlisAciklamalar) assert.ok(w.length <= LIMITS.yanlisAciklama, 'yanlış açıklaması çok uzun');

    // Sunucu doğrulaması: kabul edilmeli ve hiçbir alan kırpılmamalı (panelden düzenlenince veri değişmesin).
    const { q: cleaned, error } = cleanQuestion(q, { id: q.id, olusturma: q.olusturma });
    assert.equal(error, undefined, `sunucu doğrulaması reddetti: ${error}`);
    for (const k of ['soru', 'dogru', 'kategori', 'ipucu', 'aciklama', 'aktif']) assert.equal(cleaned[k], q[k], `${k} temizlemede değişti`);
    assert.deepEqual(cleaned.yanlislar, q.yanlislar);
    assert.deepEqual(cleaned.yanlisAciklamalar, q.yanlisAciklamalar);

    // Cevabın ipucunda ya da soru kökünde birebir geçmemesi
    assert.ok(!q.ipucu.toLocaleLowerCase('tr').includes(q.dogru.toLocaleLowerCase('tr')), 'ipucu cevabı birebir içeriyor');
    assert.ok(!q.soru.toLocaleLowerCase('tr').includes(q.dogru.toLocaleLowerCase('tr')), 'soru kökü cevabı birebir içeriyor');
  });
}

test('oyun içinde marka adı geçmiyor', () => {
  assert.ok(!JSON.stringify(seed).toLocaleLowerCase('tr').includes('nasodren'));
});

test('siklamen sorularında tedavi ya da sağlık iddiası yok', () => {
  const claims = /tedavi eder|tedavi ed|iyileştir|şifa|geçirir|sinüzite iyi gel|ilaç|sprey|ekstre|özüt|nazal/iu;
  const plant = seed.filter((q) => q.kategori === 'Siklamen');
  assert.ok(plant.length > 0);
  for (const q of plant) {
    const text = [q.soru, q.dogru, ...q.yanlislar, q.ipucu, q.aciklama, ...q.yanlisAciklamalar].join(' ');
    assert.doesNotMatch(text, claims, `${q.id} tıbbi/ürün iddiası içeriyor`);
  }
});

test('her kategoride birden fazla soru var', () => {
  const counts = new Map();
  for (const q of seed) counts.set(q.kategori, (counts.get(q.kategori) ?? 0) + 1);
  for (const [cat, n] of counts) assert.ok(n >= 2, `${cat} kategorisinde yalnızca ${n} soru var`);
});
