// Değişmeyen arayüz katmanı tek dokuda: başlık, ayırıcı, soru sayacı çerçevesi ve
// sinüs paneli. Tek sprite = tek çizim çağrısı.
import { Baked } from './bake';
import { C, font, glow, noGlow, pillPath, spaced } from './draw';
import type { Layout } from './layout';

export function createChrome(getLayout: () => Layout): Baked {
  return new Baked(getLayout().W, getLayout().H, 0, (ctx, _s, r) => drawChrome(ctx, getLayout(), r));
}

function drawChrome(ctx: CanvasRenderingContext2D, L: Layout, r: number) {
  ctx.textBaseline = 'alphabetic';

  // üst ayırıcı
  ctx.fillStyle = 'rgba(255,255,255,0.09)';
  ctx.fillRect(L.sep.x0, L.sep.y, L.sep.x1 - L.sep.x0, 1);

  // başlık
  const T = L.title;
  ctx.font = font(900, T.brandSize);
  const sp = -T.brandSize * 0.015;
  // "SİKLAMEN" baştan sona aynı pembe gradyanla yazılır
  const pg = ctx.createLinearGradient(0, T.brandY - T.brandSize * 0.75, 0, T.brandY);
  pg.addColorStop(0, '#ff56aa');
  pg.addColorStop(1, '#ff1b7a');
  ctx.fillStyle = pg;
  spaced(ctx, 'SİKLAMEN', T.cx, T.brandY, sp, 'center');

  ctx.font = font(800, T.subSize);
  ctx.fillStyle = C.white;
  spaced(ctx, 'BİLGİ OYUNU', T.cx, T.subY, T.subSize * 0.55, 'center');

  // soru sayacı çerçevesi
  const k = L.counter;
  pillPath(ctx, k.x, k.y, k.w, k.h);
  ctx.fillStyle = 'rgba(8,10,40,0.65)';
  ctx.fill();
  glow(ctx, 'rgba(60,220,255,0.7)', 12, r);
  ctx.strokeStyle = C.cyan;
  ctx.lineWidth = 2.5;
  ctx.stroke();
  noGlow(ctx);

  // sinüs paneli
  const P = L.panel;
  ctx.beginPath();
  ctx.roundRect(P.x, P.y, P.w, P.h, 24);
  const pf = ctx.createLinearGradient(0, P.y, 0, P.y + P.h);
  pf.addColorStop(0, '#10164a');
  pf.addColorStop(0.6, '#0a0d35');
  pf.addColorStop(1, '#0b0b30');
  ctx.fillStyle = pf;
  ctx.fill();
  glow(ctx, 'rgba(60,220,255,0.6)', 14, r);
  ctx.strokeStyle = 'rgba(60,220,255,0.75)';
  ctx.lineWidth = 2;
  ctx.stroke();
  noGlow(ctx);

  const PT = L.panelTitle;
  ctx.font = font(700, PT.size);
  ctx.fillStyle = C.white;
  ctx.textBaseline = 'middle';
  const tw = spaced(ctx, 'SİNÜS KANALLARI', PT.cx, PT.cy + 1, PT.size * 0.07, 'center');
  ctx.textBaseline = 'alphabetic';
  glow(ctx, C.cyan, 6, r);
  ctx.fillStyle = C.cyan;
  ctx.fillRect(PT.cx - tw / 2 - 52, PT.cy - 1, 32, 2);
  ctx.fillRect(PT.cx + tw / 2 + 20, PT.cy - 1, 32, 2);
  noGlow(ctx);
}
