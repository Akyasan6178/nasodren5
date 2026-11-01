// Görsel duman testi: oyunu masaüstü ve telefon boyutunda açar, ekran görüntüsü alır,
// konsol hatalarını ve ortalama kare hızını raporlar.
//   node scripts/shot.mjs <url> <çıktı-klasörü>
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:5173/';
const out = process.argv[3] ?? 'shots';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];

async function run(name, viewport, opts = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: opts.dpr ?? 1, hasTouch: !!opts.touch, isMobile: !!opts.touch });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${name}] ${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`[${name}] pageerror: ${e.message}`));
  await page.goto(url + '?fps');
  await page.waitForFunction(() => window.__game, null, { timeout: 15000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/${name}-0-baslangic.png` });
  await page.keyboard.press('Enter'); // "Başla"
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}/${name}-1-soru.png` });
  // ilk şıkkı seç, onayla, sonucu gör
  await page.keyboard.press('a');
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${out}/${name}-2-secim.png` });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2400);
  await page.screenshot({ path: `${out}/${name}-3-sonuc.png` });
  if (opts.extra) await opts.extra(page, name);
  await ctx.close();
}

await run('masaustu', { width: 1600, height: 900 });
await run('telefon', { width: 390, height: 844 }, { dpr: 2, touch: true });
await browser.close();
console.log(errors.length ? errors.join('\n') : 'Konsol hatası yok.');
