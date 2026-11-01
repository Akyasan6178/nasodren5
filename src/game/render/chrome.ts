// Değişmeyen arayüz katmanı tek dokuda: logo, başlık, ayırıcılar, bağlantı çizgileri,
// panel çerçevesi, alt bilgi. Tek sprite = tek çizim çağrısı.
import { Baked } from './bake';
import { C, font, getLogo, glow, noGlow, pillPath, spaced } from './draw';
import type { Layout } from './layout';

export function createChrome(getLayout: () => Layout): Baked {
  return new Baked(getLayout().W, getLayout().H, 0, (ctx, _s, r) => drawChrome(ctx, getLayout(), r));
}

function drawChrome(ctx: CanvasRenderingContext2D, L: Layout, r: number) {
  ctx.textBaseline = 'alphabetic';

  // üst ayırıcı
  ctx.fillStyle = 'rgba(255,255,255,0.09)';
  ctx.fillRect(L.sep.x0, L.sep.y, L.sep.x1 - L.sep.x0, 1);

  // logo
  const lg = getLogo();
  if (lg) {
    glow(ctx, 'rgba(255,45,138,0.55)', 10, r);
    ctx.drawImage(lg, L.logo.x, L.logo.y, L.logo.size, L.logo.size);
    noGlow(ctx);
  }
  ctx.font = font(700, L.logo.font);
  const tx = L.logo.x + L.logo.size + 4;
  const ty = L.logo.y + L.logo.size * 0.68;
  ctx.fillStyle = C.white;
  ctx.fillText('Yaşasın ', tx, ty);
  ctx.fillStyle = C.pink2;
  ctx.fillText('Sağlık', tx + ctx.measureText('Yaşasın ').width, ty);

  // başlık
  const T = L.title;
  ctx.font = font(500, 17);
  ctx.fillStyle = C.lav;
  spaced(ctx, 'SİKLAMEN OYUNLARI • 05', T.cx, T.eyebrowY, 5.8, 'center');

  ctx.font = font(900, T.brandSize);
  const sp = -T.brandSize * 0.015;
  const wW = measureSpaced(ctx, 'SİKL', sp);
  const wP = measureSpaced(ctx, 'AMEN', sp);
  const bx = T.cx - (wW + wP + sp) / 2;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 18 * r;
  ctx.shadowOffsetY = 4 * r;
  ctx.fillStyle = C.white;
  spaced(ctx, 'SİKL', bx, T.brandY, sp);
  ctx.restore();
  const pg = ctx.createLinearGradient(0, T.brandY - T.brandSize * 0.75, 0, T.brandY);
  pg.addColorStop(0, '#ff56aa');
  pg.addColorStop(1, '#ff1b7a');
  glow(ctx, 'rgba(255,45,138,0.6)', 18, r);
  ctx.fillStyle = pg;
  spaced(ctx, 'AMEN', bx + wW + sp, T.brandY, sp);
  noGlow(ctx);

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

  // soru/şık bağlantı çizgileri
  for (const ln of L.lines) {
    const g = ctx.createLinearGradient(ln.x0, 0, ln.x1, 0);
    g.addColorStop(0, 'rgba(70,120,255,0.95)');
    g.addColorStop(1, 'rgba(150,100,255,0.95)');
    glow(ctx, 'rgba(90,140,255,0.9)', 8, r);
    ctx.fillStyle = g;
    ctx.fillRect(ln.x0, ln.y - 1.25, ln.x1 - ln.x0, 2.5);
  }
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
  ctx.save();
  ctx.clip();
  glow(ctx, 'rgba(60,220,255,0.45)', 26, r);
  ctx.strokeStyle = 'rgba(60,220,255,0.5)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.roundRect(P.x - 2, P.y - 2, P.w + 4, P.h + 4, 26);
  ctx.stroke();
  ctx.restore();
  ctx.beginPath();
  ctx.roundRect(P.x, P.y, P.w, P.h, 24);
  glow(ctx, 'rgba(60,220,255,0.85)', 22, r);
  ctx.strokeStyle = C.cyan;
  ctx.lineWidth = 3;
  ctx.stroke();
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

  // alt bilgi şeridi
  const F = L.footer;
  ctx.fillStyle = 'rgba(6,3,20,0.8)';
  ctx.fillRect(F.x, F.y, F.w, F.h);
  ctx.fillStyle = 'rgba(255,255,255,0.07)';
  ctx.fillRect(F.x, F.y, F.w, 1);
  ctx.textBaseline = 'middle';
  ctx.font = font(400, L.footerFont);
  ctx.fillStyle = C.white;
  if (!L.portrait) ctx.fillText('Siklamen Oyunları', 25, F.y + F.h / 2);
  ctx.font = font(400, L.footerFont - 1);
  ctx.fillStyle = C.muted;
  ctx.textAlign = 'center';
  ctx.fillText('Gösterge yalnızca oyun içi ilerlemeyi temsil eder.', L.portrait ? F.w / 2 : 800, F.y + F.h / 2);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

function measureSpaced(ctx: CanvasRenderingContext2D, s: string, spacing: number) {
  return [...s].reduce((a, c) => a + ctx.measureText(c).width, 0) + spacing * ([...s].length - 1);
}

/** Klavye kısayol satırı (yalnızca yatay yerleşimde, seçim yapılmamışken görünür). */
export function createKeyHints(): Baked {
  return new Baked(620, 40, 2, (ctx) => {
    ctx.textBaseline = 'middle';
    ctx.font = font(400, 18);
    const key = (label: string, x: number, w: number) => {
      ctx.beginPath();
      ctx.roundRect(x, 5, w, 30, 5);
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.font = font(500, 16);
      ctx.fillStyle = C.white;
      ctx.textAlign = 'center';
      ctx.fillText(label, x + w / 2, 21);
      ctx.textAlign = 'left';
      ctx.font = font(400, 18);
    };
    let x = 30;
    key('A', x, 30); x += 42;
    ctx.fillStyle = C.muted; ctx.fillText('–', x, 21); x += 22;
    key('D', x, 30); x += 44;
    ctx.fillStyle = C.muted; ctx.fillText('ile seç', x, 21); x += 126;
    key('Enter', x, 74); x += 88;
    ctx.fillStyle = C.muted; ctx.fillText('ile onayla', x, 21);
  });
}
