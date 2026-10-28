// Visual smoke test: serves dist/ via vite preview, captures screenshots on
// desktop + phone viewports, and fails on console errors.
import { chromium } from 'playwright';
import { preview } from 'vite';

const out = process.argv[2] ?? 'shots';
const server = await preview({ preview: { port: 4179, strictPort: true }, logLevel: 'silent' });
const url = 'http://localhost:4179/?debug';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];

async function run(name, viewport, opts = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: opts.dpr ?? 1, hasTouch: !!opts.touch, isMobile: !!opts.touch });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${name}] ${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`[${name}] pageerror: ${e.message}`));
  await page.goto(url);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/${name}-1-start.png` });
  await page.click('#btn-start');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${out}/${name}-2-ready.png` });
  // Steer a bit with the keyboard.
  await page.waitForTimeout(1500);
  for (const k of ['ArrowLeft', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'ArrowLeft']) { await page.keyboard.press(k); await page.waitForTimeout(450); }
  await page.screenshot({ path: `${out}/${name}-3-play.png` });
  if (opts.extra) await opts.extra(page, name);
  await ctx.close();
}

await run('desktop', { width: 1440, height: 900 }, {
  extra: async (page, name) => {
    // Force power mode + rebound via the exposed debug hook to inspect visuals.
    await page.evaluate(() => window.__game?.debugPower());
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${out}/${name}-4-power.png` });
    await page.evaluate(() => window.__game?.debugRebound());
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${out}/${name}-5-rebound.png` });
    await page.evaluate(() => window.__game?.debugGameOver());
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${out}/${name}-6-over.png` });
  },
});
await run('phone', { width: 390, height: 844 }, {
  dpr: 3,
  touch: true,
  extra: async (page, name) => {
    // Continuous swipe without lifting: up, then right.
    const before = await page.evaluate(() => window.__game.game.player.want);
    await page.mouse.move(200, 700);
    await page.mouse.down();
    await page.mouse.move(200, 640, { steps: 4 });
    const afterUp = await page.evaluate(() => window.__game.game.player.want);
    await page.mouse.move(270, 640, { steps: 4 });
    const afterRight = await page.evaluate(() => window.__game.game.player.want);
    await page.mouse.up();
    console.log('swipe want:', before, '-> up', afterUp, '-> right', afterRight, '(UP=0 RIGHT=3)');
    if (afterUp !== 0 || afterRight !== 3) errors.push('swipe failed');
    await page.evaluate(() => window.__game?.debugGameOver());
    await page.waitForTimeout(3500);
    await page.screenshot({ path: `${out}/${name}-6-over.png` });
  },
});

await browser.close();
await server.close();
console.log(errors.length ? errors.join('\n') : 'NO CONSOLE ERRORS');
