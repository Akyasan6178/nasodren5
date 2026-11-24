// Değişmeyen arayüz katmanı tek dokuda: başlık, ayırıcı, soru sayacı çerçevesi ve
// sinüs paneli. Tek sprite = tek çizim çağrısı.
import { Baked } from './bake';
import { C, font, glow, noGlow, pillPath, spaced } from './draw';
import type { Layout } from './layout';

export function createChrome(getLayout: () => Layout): Baked {
  return new Baked(getLayout().W, getLayout().H, 0, (ctx, _s, r) => drawChrome(ctx, getLayout(), r));
}

/** `spaced` ile yazılacak metnin genişliği (çizmeden). */
function spacedWidth(ctx: CanvasRenderingContext2D, str: string, spacing: number) {
  const chars = [...str];
  return chars.reduce((a, c) => a + ctx.measureText(c).width, 0) + spacing * (chars.length - 1);
}

function drawChrome(ctx: CanvasRenderingContext2D, L: Layout, r: number) {
  ctx.textBaseline = 'alphabetic';

  // üst ayırıcı
  ctx.fillStyle = 'rgba(255,255,255,0.09)';
  ctx.fillRect(L.sep.x0, L.sep.y, L.sep.x1 - L.sep.x0, 1);

  // başlık: "KİM NEFES" (büyük; KİM beyaz, NEFES pembe) + "ALMAK İSTER?" (aralıklı alt satır).
  // Yazılar eski "SİKLAMEN / BİLGİ OYUNU" başlığının genişliğine sığdırılır; sayaç ve süreyle çakışmaz.
  const T = L.title;
  const fit = (str: string, weight: number, size: number, spacingK: number, maxW: number) => {
    ctx.font = font(weight, size);
    const w = spacedWidth(ctx, str, size * spacingK);
    return w > maxW ? size * (maxW / w) : size;
  };
  ctx.font = font(900, T.brandSize);
  const brandMax = spacedWidth(ctx, 'SİKLAMEN', -T.brandSize * 0.015);
  const bs = fit('KİM NEFES', 900, T.brandSize, -0.015, brandMax);
  ctx.font = font(900, bs);
  const sp = -bs * 0.015;
  const pg = ctx.createLinearGradient(0, T.brandY - bs * 0.75, 0, T.brandY);
  pg.addColorStop(0, '#ff56aa');
  pg.addColorStop(1, '#ff1b7a');
  const head = 'KİM ';
  const total = spacedWidth(ctx, 'KİM NEFES', sp);
  const x0 = T.cx - total / 2;
  ctx.fillStyle = C.white;
  spaced(ctx, head, x0, T.brandY, sp, 'left');
  ctx.fillStyle = pg;
  spaced(ctx, 'NEFES', x0 + spacedWidth(ctx, head, sp) + sp, T.brandY, sp, 'left');

  ctx.font = font(800, T.subSize);
  const subMax = spacedWidth(ctx, 'BİLGİ OYUNU', T.subSize * 0.55);
  const ss = fit('ALMAK İSTER?', 800, T.subSize, 0.55, subMax);
  ctx.font = font(800, ss);
  ctx.fillStyle = C.white;
  spaced(ctx, 'ALMAK İSTER?', T.cx, T.subY, ss * 0.55, 'center');

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
