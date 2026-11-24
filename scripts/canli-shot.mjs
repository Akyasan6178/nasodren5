// Çok oyunculu duman testi: bir sunucu ekranı ve üç telefon açar, iki soruluk bir yarışmayı
// baştan sona oynar, her aşamada ekran görüntüsü alır ve konsol hatalarını raporlar.
//   node scripts/canli-shot.mjs <url> <çıktı-klasörü>
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const base = (process.argv[2] ?? 'http://localhost:5173/').replace(/\/$/, '');
const out = process.argv[3] ?? 'shots';
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const errors = [];
const watch = (page, name) => {
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${name}] ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`[${name}] pageerror: ${e.message}`));
};

const hostCtx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
const host = await hostCtx.newPage();
watch(host, 'sunucu');
await host.goto(`${base}/canli`);
await host.waitForSelector('.join-card .code');
const code = (await host.textContent('.join-card .code')).replace(/\D/g, '');
console.log('Oda kodu:', code);
await host.screenshot({ path: `${out}/canli-0-lobi-bos.png` });

const names = ['Ayşe', 'Mehmet', 'Zeynep', 'Kerem'];
const phones = [];
for (const [i, name] of names.entries()) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const p = await ctx.newPage();
  watch(p, name);
  // ilk oyuncu kodu elle yazar, diğerleri QR bağlantısıyla gelir
  if (i === 0) {
    await p.goto(`${base}/katil`);
    await p.screenshot({ path: `${out}/canli-telefon-0-kod.png` });
    await p.fill('input.code-in', code);
    await p.click('button[type=submit]');
  } else {
    await p.goto(`${base}/katil?kod=${code}`);
  }
  await p.waitForSelector('input[aria-label=Ad]');
  await p.fill('input[aria-label=Ad]', name);
  if (i === 0) await p.screenshot({ path: `${out}/canli-telefon-1-ad.png` });
  await p.click('button[type=submit]');
  await p.waitForSelector('text=Oyuna katıldın!');
  phones.push(p);
}
await phones[0].screenshot({ path: `${out}/canli-telefon-2-bekle.png` });
await host.waitForFunction(() => document.querySelectorAll('.chip').length === 4);
// soru sayısını 2'ye indir
for (let k = 0; k < 50; k++) await host.click('.stepper >> nth=0 >> button >> nth=0');
await host.click('.stepper >> nth=0 >> button >> nth=1');
await host.screenshot({ path: `${out}/canli-1-lobi.png` });
await host.click('#start-btn');

for (let round = 0; round < 2; round++) {
  await host.waitForSelector('.ready');
  await phones[0].waitForSelector('.p-q.big');
  if (round === 0) {
    await host.screenshot({ path: `${out}/canli-2-hazir.png` });
    await phones[0].screenshot({ path: `${out}/canli-telefon-3-hazir.png` });
  }
  await host.waitForSelector('.clock');
  await phones[0].waitForSelector('.p-choices');
  await host.waitForTimeout(600);
  if (round === 0) {
    await host.screenshot({ path: `${out}/canli-3-soru.png` });
    await phones[0].screenshot({ path: `${out}/canli-telefon-4-sikler.png` });
  }
  // her oyuncu farklı şık seçer; biri mutlaka doğru bilir
  for (const [i, p] of phones.entries()) {
    await p.waitForSelector('.p-choices');
    await p.click(`.p-choices .choice >> nth=${i}`);
    await p.waitForTimeout(150);
  }
  if (round === 0) await phones[0].screenshot({ path: `${out}/canli-telefon-5-kilit.png` });
  await host.waitForSelector('.dist');
  await phones[0].waitForSelector('.verdict');
  await host.waitForTimeout(900);
  if (round === 0) {
    await host.screenshot({ path: `${out}/canli-4-sonuc.png` });
    for (const [i, p] of phones.entries()) await p.screenshot({ path: `${out}/canli-telefon-6-sonuc-${i}.png` });
  }
  await host.click('text=Skor tablosu');
  await host.waitForSelector('.ranks');
  await host.waitForTimeout(1500);
  if (round === 0) await host.screenshot({ path: `${out}/canli-5-tablo.png` });
  await host.click('.foot .btn.primary');
}
await host.waitForSelector('.podium');
await host.waitForTimeout(2200);
await host.screenshot({ path: `${out}/canli-6-final.png` });
await phones[0].waitForSelector('.final');
await phones[0].waitForTimeout(500);
for (const [i, p] of phones.entries()) await p.screenshot({ path: `${out}/canli-telefon-7-final-${i}.png` });

await browser.close();
console.log(errors.length ? errors.join('\n') : 'Konsol hatası yok.');
