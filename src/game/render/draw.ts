// Canvas2D çizim yardımcıları (yalnızca pişirme sırasında çalışır, karelerde değil).

export const C = {
  cyan: '#3cdcff',
  cyanSoft: '#9aefff',
  pink: '#ff2d8a',
  pink2: '#ff5aae',
  lav: '#c4b5ff',
  muted: '#ddd3f7',
  white: '#ffffff',
  fillA: '#1a1b60',
  fillB: '#0c0e3c',
};

export const font = (weight: number, size: number) => `${weight} ${size}px Poppins, sans-serif`;

/** shadowBlur dönüşümden etkilenmez; tasarım birimini cihaz pikseline çevirir. */
export function glow(ctx: CanvasRenderingContext2D, color: string, blur: number, r: number) {
  ctx.shadowColor = color;
  ctx.shadowBlur = blur * r;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
}
export function noGlow(ctx: CanvasRenderingContext2D) {
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
}

export function pillPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, rad = h / 2) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.min(rad, h / 2, w / 2));
}

export function hexPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, pt: number) {
  ctx.beginPath();
  ctx.moveTo(x, y + h / 2);
  ctx.lineTo(x + pt, y);
  ctx.lineTo(x + w - pt, y);
  ctx.lineTo(x + w, y + h / 2);
  ctx.lineTo(x + w - pt, y + h);
  ctx.lineTo(x + pt, y + h);
  ctx.closePath();
}

/** Harf aralıklı metin (ctx.letterSpacing her tarayıcıda yok). */
export function spaced(ctx: CanvasRenderingContext2D, str: string, x: number, y: number, spacing: number, align: 'left' | 'center' | 'right' = 'left') {
  const chars = [...str];
  const widths = chars.map((c) => ctx.measureText(c).width);
  const total = widths.reduce((a, b) => a + b, 0) + spacing * (chars.length - 1);
  let cx = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
  const prev = ctx.textAlign;
  ctx.textAlign = 'left';
  chars.forEach((c, i) => {
    ctx.fillText(c, cx, y);
    cx += widths[i] + spacing;
  });
  ctx.textAlign = prev;
  return total;
}

/** Neon çerçeveli kapsül düğme. */
export function neonPill(ctx: CanvasRenderingContext2D, w: number, h: number, r: number, hot = false, dim = false) {
  const lw = 2.6;
  pillPath(ctx, lw / 2, lw / 2, w - lw, h - lw);
  ctx.fillStyle = hot ? 'rgba(28, 58, 120, 0.75)' : 'rgba(8, 10, 40, 0.62)';
  ctx.fill();
  if (!dim) {
    glow(ctx, hot ? 'rgba(80,230,255,0.95)' : 'rgba(60,220,255,0.7)', hot ? 18 : 12, r);
  }
  ctx.strokeStyle = dim ? 'rgba(60,220,255,0.35)' : hot ? '#8ff0ff' : C.cyan;
  ctx.lineWidth = lw;
  ctx.stroke();
  noGlow(ctx);
  // iç parıltı
  if (!dim) {
    ctx.save();
    pillPath(ctx, lw / 2, lw / 2, w - lw, h - lw);
    ctx.clip();
    glow(ctx, 'rgba(60,220,255,0.35)', 10, r);
    ctx.strokeStyle = 'rgba(60,220,255,0.35)';
    ctx.lineWidth = 2;
    pillPath(ctx, -1, -1, w + 2, h + 2);
    ctx.stroke();
    ctx.restore();
  }
}

// ---------- simgeler (24×24 kutuda SVG yolları) ----------

const ICONS = {
  refresh: { stroke: ['M20 12a8 8 0 1 1-2.34-5.66', 'M20 4v5h-5'] },
  speaker: { fill: ['M4 9h4l5-4v14l-5-4H4z'], stroke: ['M16.5 8.5a5 5 0 0 1 0 7', 'M19 6a8.5 8.5 0 0 1 0 12'] },
  mute: { fill: ['M4 9h4l5-4v14l-5-4H4z'], stroke: ['M16.5 9.5l5 5', 'M21.5 9.5l-5 5'] },
  fullscreen: { stroke: ['M4 9V4h5', 'M15 4h5v5', 'M20 15v5h-5', 'M9 20H4v-5'] },
  people: {
    fill: [
      'M9 4.8a3.2 3.2 0 1 1 0 6.4 3.2 3.2 0 0 1 0-6.4z',
      'M16.5 6.4a2.6 2.6 0 1 1 0 5.2 2.6 2.6 0 0 1 0-5.2z',
      'M2.5 19c.5-4 3.2-6 6.5-6s6 2 6.5 6z',
      'M15.6 13.2c3.4-.6 5.4 1.3 5.9 5.3h-4.6c-.2-2-.6-3.8-1.3-5.3z',
    ],
  },
  bulb: {
    fill: [
      'M12 2.5a6.5 6.5 0 0 0-4 11.6c.7.6 1 1.3 1 2.2V17h6v-.7c0-.9.4-1.6 1-2.2a6.5 6.5 0 0 0-4-11.6z',
      'M9.5 18.2h5v1.4a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2z',
    ],
  },
  skip: { fill: ['M2.5 5.5v13l9-6.5z', 'M12 5.5v13l9-6.5z'] },
  next: { stroke: ['M5 12h13', 'M13 6l6 6-6 6'] },
} satisfies Record<string, { fill?: string[]; stroke?: string[] }>;

export type IconName = keyof typeof ICONS;

export function icon(ctx: CanvasRenderingContext2D, name: IconName, x: number, y: number, size: number, color: string) {
  const def = ICONS[name] as { fill?: string[]; stroke?: string[] };
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 24, size / 24);
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.1;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const d of def.fill ?? []) ctx.fill(new Path2D(d));
  for (const d of def.stroke ?? []) ctx.stroke(new Path2D(d));
  ctx.restore();
}

let logoImg: HTMLImageElement | null = null;
export async function loadLogo(url: string) {
  const img = new Image();
  img.src = url;
  await img.decode().catch(() => undefined);
  logoImg = img.complete && img.naturalWidth ? img : null;
}
export const getLogo = () => logoImg;
