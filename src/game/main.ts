import '@fontsource/poppins/400.css';
import '@fontsource/poppins/500.css';
import '@fontsource/poppins/600.css';
import '@fontsource/poppins/700.css';
import '@fontsource/poppins/800.css';
import '@fontsource/poppins/900.css';
import { Application, Text } from 'pixi.js';
import { flushBakes, setDensity, text } from './render/bake';
import { loadHeadArt } from './render/head';
import { pickLayout } from './render/layout';
import { Scene, type SceneHandlers } from './render/scene';
import { Game } from './game';
import { updateTweens } from './tween';

const MAX_DPR = 2; // 3x ekranlarda fark görünmez, piksel maliyeti 2.25 kat artar

async function loadFonts() {
  // Türkçe karakterler latin-ext alt kümesinde; onları da önceden yüklüyoruz.
  const sample = 'AaŞşĞğİıÖöÜüÇç%0123456789';
  await Promise.all([400, 500, 600, 700, 800, 900].map((w) => document.fonts.load(`${w} 32px Poppins`, sample)));
}

async function boot() {
  const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
  const app = new Application();
  await Promise.all([
    app.init({
      resizeTo: window,
      resolution: dpr,
      autoDensity: true,
      antialias: false, // tüm kenarlar dokularda zaten yumuşatılmış
      backgroundColor: 0x120629,
      preference: 'webgl',
      powerPreference: 'high-performance',
    }),
    loadFonts(),
    loadHeadArt(import.meta.env.BASE_URL),
  ]);
  document.getElementById('app')!.appendChild(app.canvas);

  let layout = pickLayout(window.innerWidth, window.innerHeight);
  // Yoğunluk sahne kurulmadan ayarlanır ki dokular ilk seferde doğru çözünürlükte pişsin.
  setDensity(Math.min(window.innerWidth / layout.W, window.innerHeight / layout.H) * dpr);

  let game!: Game;
  // Sahne, oyundan önce kurulur; düğme olayları oyunun işleyicilerine yönlendirilir.
  const scene = new Scene(layout, new Proxy({} as SceneHandlers, {
    get: (_t, key: keyof SceneHandlers) => (...args: never[]) => (game.handlers[key] as (...a: never[]) => void)(...args),
  }));
  app.stage.addChild(scene.root);
  game = new Game(scene);

  // Yerleşim: tasarım alanını ekrana sığdır, kalan boşluğu arka plan doldursun.
  let resizeTimer = 0;
  const fitScene = (rebake: boolean) => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const next = pickLayout(w, h);
    const s = Math.min(w / next.W, h / next.H);
    const ox = (w - next.W * s) / 2;
    const oy = (h - next.H * s) / 2;
    scene.root.scale.set(s);
    scene.root.position.set(ox, oy);
    if (next !== layout || rebake) {
      layout = next;
      setDensity(s * dpr);
      scene.applyLayout(layout);
      scene.setViewport(-ox / s, -oy / s, w / s, h / s);
    }
  };
  fitScene(true);
  window.addEventListener('resize', () => {
    // Anında ölçekle (ucuz), dokuları ise sürükleme bitince yeniden pişir (pahalı).
    fitScene(false);
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => fitScene(true), 140);
  });

  // ?fps ile kare hızı göstergesi
  let fpsText: Text | null = null;
  if (new URLSearchParams(location.search).has('fps')) {
    fpsText = text({ fontSize: 14, fontWeight: '600', fill: '#7CFFB2' });
    fpsText.position.set(8, 4);
    app.stage.addChild(fpsText);
  }
  let fpsAcc = 0;
  let fpsFrames = 0;

  app.ticker.add((tk) => {
    const dt = Math.min(tk.deltaMS, 100); // sekme dönüşünde büyük sıçramaları kırp
    updateTweens(dt);
    game.update(dt);
    scene.update(dt);
    flushBakes();
    if (fpsText) {
      fpsAcc += tk.deltaMS;
      fpsFrames++;
      if (fpsAcc >= 500) {
        fpsText.text = `${Math.round((fpsFrames * 1000) / fpsAcc)} fps`;
        fpsAcc = 0;
        fpsFrames = 0;
      }
    }
  });

  document.getElementById('loader')?.remove();
  await game.intro();
  (window as unknown as { __game: Game }).__game = game;
}

void boot();
