// Procedural art. Everything is drawn once with Canvas2D at the exact device
// tile size (T = texture pixels per tile) and packed into an atlas, so the GPU
// only samples pre-rendered sprites (no per-frame vector rasterizing).
// Style follows the hero art (gorseller/oyuncu-*.png): flat cut-paper shapes,
// one darker flat plane instead of gradients, black dot eyes, sticker outlines.

import { COLS, ROWS, T_WALL } from '../game/maze.ts';
import { SPRITE_SLOTS, VIRUS_SLOTS, type CustomArt, type SpriteSlot } from './custom.ts';

export const PLAYER_MOUTH_FRAMES = 6;
export const PLAYER_DEATH_FRAMES = 14;
export const POPUP_VALUES = [100, 200, 400, 800, 1600] as const;

type Ctx = CanvasRenderingContext2D;

function makeCanvas(w: number, h: number): [HTMLCanvasElement, Ctx] {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  const ctx = c.getContext('2d')!;
  return [c, ctx];
}

function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (s: number): number => Math.round(((pa >> s) & 255) + (((pb >> s) & 255) - ((pa >> s) & 255)) * t);
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}

/** Teardrop path in local space: tip at (0,-h), round end around the origin. */
function teardrop(ctx: Ctx, w: number, h: number): void {
  ctx.beginPath();
  ctx.moveTo(0, -h);
  ctx.bezierCurveTo(w * 0.9, -h * 0.45, w, w * 0.6, 0, w * 0.9);
  ctx.bezierCurveTo(-w, w * 0.6, -w * 0.9, -h * 0.45, 0, -h);
  ctx.closePath();
}

function teardropAt(ctx: Ctx, x: number, y: number, w: number, h: number): void {
  ctx.save();
  ctx.translate(x, y);
  teardrop(ctx, w, h);
  ctx.restore();
}

function heartLeaf(ctx: Ctx, s: number): void {
  // Cyclamen leaf: heart shape, tip pointing +x in local space.
  ctx.beginPath();
  ctx.moveTo(s, 0);
  ctx.bezierCurveTo(s * 0.55, -s * 0.2, s * 0.1, -s * 0.75, -s * 0.45, -s * 0.5);
  ctx.bezierCurveTo(-s * 0.75, -s * 0.35, -s * 0.6, -s * 0.05, -s * 0.35, 0);
  ctx.bezierCurveTo(-s * 0.6, s * 0.05, -s * 0.75, s * 0.35, -s * 0.45, s * 0.5);
  ctx.bezierCurveTo(s * 0.1, s * 0.75, s * 0.55, s * 0.2, s, 0);
  ctx.closePath();
}

// ------------------------------------------------------------ player: Siklamen
// The hero is a cyclamen flower: its reflexed petals sweep back like hair,
// heart-shaped leaves flap like little wings. Faces right; the view mirrors it.

// Like the reference: tall central petals plus two flaring out to the sides.
const PETALS: ReadonlyArray<readonly [angle: number, len: number, width: number, back: boolean]> = [
  [-3.05, 0.62, 0.24, true],
  [-2.45, 0.74, 0.27, true],
  [-2.0, 0.82, 0.29, false],
  [-1.58, 0.74, 0.27, false],
  [-0.6, 0.5, 0.21, false],
];

/** Player frames are larger than other sprites so the flower reads well on phones. */
export const PLAYER_FRAME = 2.8;

function drawSiklamen(T: number, open: number, flap: number, wilt: number): HTMLCanvasElement {
  const U = T * 1.15;
  const S = PLAYER_FRAME * T;
  const [c, ctx] = makeCanvas(S, S);
  const hx = S / 2 - 0.02 * U;
  const hy = S / 2 + 0.22 * U;
  const Rh = 0.44 * U;
  const fade = wilt > 0.7 ? 1 - (wilt - 0.7) / 0.3 : 1;
  if (fade <= 0.01) return c;
  ctx.globalAlpha = fade;
  const w = wilt;
  const grey = '#cdb3c1';
  const petalLight = mix('#ffc2de', grey, w);
  const petalMid = mix('#f472b6', grey, w * 0.8);
  const petalDark = mix('#d6458c', '#a88a9b', w * 0.8);
  const petalLine = mix('#c03a7c', '#9c7d8f', w * 0.8);
  const leafA = mix('#8ad685', '#b9c4a6', w);
  const leafB = mix('#4fa95b', '#93a088', w);
  const leafLine = mix('#3a8a49', '#7f8b76', w);

  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // Stem curl (behind)
  ctx.strokeStyle = leafLine;
  ctx.lineWidth = 0.075 * U;
  ctx.beginPath();
  ctx.moveTo(hx - 0.05 * U, hy + 0.3 * U);
  ctx.quadraticCurveTo(hx - 0.12 * U, hy + 0.62 * U, hx - 0.32 * U, hy + 0.62 * U);
  ctx.quadraticCurveTo(hx - 0.44 * U, hy + 0.6 * U, hx - 0.4 * U, hy + 0.5 * U);
  ctx.stroke();
  ctx.strokeStyle = leafA;
  ctx.lineWidth = 0.035 * U;
  ctx.stroke();

  const leaf = (x: number, y: number, rot: number, size: number): void => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    heartLeaf(ctx, size);
    const g = ctx.createLinearGradient(-size, -size, size, size);
    g.addColorStop(0, leafA);
    g.addColorStop(1, leafB);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = leafLine;
    ctx.lineWidth = 0.035 * U;
    ctx.stroke();
    // Silvery marbling typical of cyclamen leaves + midrib
    ctx.strokeStyle = 'rgba(235,255,235,0.6)';
    ctx.lineWidth = 0.03 * U;
    ctx.beginPath();
    ctx.ellipse(-size * 0.05, 0, size * 0.42, size * 0.26, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-size * 0.3, 0);
    ctx.lineTo(size * 0.8, 0);
    ctx.stroke();
    ctx.restore();
  };

  // Back leaf-wing
  leaf(hx - 0.36 * U, hy + 0.12 * U, Math.PI + 0.5 - flap * 0.45 - w * 0.6, 0.34 * U);

  // Petals (back ones first). Wilting makes them droop and pale.
  const petal = (i: number): void => {
    const [a0, len0, wid] = PETALS[i];
    const a = a0 + Math.sin(flap * Math.PI + i * 1.3) * 0.05 + w * (1.25 - i * 0.12);
    const len = len0 * U * (1 - w * 0.2);
    const bx = hx + Math.cos(a) * Rh * 0.45;
    const by = hy - 0.12 * U + Math.sin(a) * Rh * 0.45;
    ctx.save();
    ctx.translate(bx, by);
    ctx.rotate(a + Math.PI / 2);
    // Slight S-twist like the reference image's petals.
    const W2 = wid * U;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(-W2 * 1.2, -len * 0.25, -W2 * 0.6, -len * 0.8, W2 * 0.15, -len);
    ctx.bezierCurveTo(W2 * 0.9, -len * 0.75, W2 * 1.1, -len * 0.25, 0, 0);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, 0, 0, -len);
    g.addColorStop(0, petalDark);
    g.addColorStop(0.45, petalMid);
    g.addColorStop(1, petalLight);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = petalLine;
    ctx.lineWidth = 0.035 * U;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 0.03 * U;
    ctx.beginPath();
    ctx.moveTo(0, -len * 0.25);
    ctx.quadraticCurveTo(-W2 * 0.25, -len * 0.6, W2 * 0.05, -len * 0.88);
    ctx.stroke();
    ctx.restore();
  };
  for (let i = 0; i < PETALS.length; i++) if (PETALS[i][3]) petal(i);
  for (let i = 0; i < PETALS.length; i++) if (!PETALS[i][3]) petal(i);

  // Flower "collar" where the petals meet + yellow stamens (from the reference).
  ctx.fillStyle = mix('#b8327a', '#9c7d8f', w);
  ctx.beginPath();
  ctx.ellipse(hx - 0.08 * U, hy - 0.36 * U, 0.2 * U, 0.09 * U, -0.35, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = mix('#ffd45c', '#d8cfa6', w);
  for (const [dx, dy] of [
    [-0.16, -0.39],
    [-0.07, -0.42],
    [0.02, -0.4],
  ] as const) {
    ctx.beginPath();
    ctx.arc(hx + dx * U, hy + dy * U, 0.04 * U, 0, Math.PI * 2);
    ctx.fill();
  }

  // Head
  const sy = 1 - w * 0.12;
  ctx.save();
  ctx.translate(hx, hy);
  ctx.scale(1 + w * 0.06, sy);
  ctx.beginPath();
  ctx.arc(0, 0, Rh + 0.045 * U, 0, Math.PI * 2);
  ctx.fillStyle = mix('#e690bb', '#b79aa9', w);
  ctx.fill();
  const hg = ctx.createRadialGradient(-0.12 * U, -0.16 * U, 0.04 * U, 0, 0, Rh);
  hg.addColorStop(0, '#fffafd');
  hg.addColorStop(0.65, mix('#ffe3ef', '#efe4ea', w));
  hg.addColorStop(1, mix('#ffc7df', '#e2cfd9', w));
  ctx.beginPath();
  ctx.arc(0, 0, Rh, 0, Math.PI * 2);
  ctx.fillStyle = hg;
  ctx.fill();
  ctx.restore();

  // Face (3/4 view, looking right)
  const ex = hx + 0.1 * U;
  const ey = hy - 0.05 * U;
  const eye = (x: number, scale: number): void => {
    if (w > 0.35) {
      // Closed, tired eyes while wilting
      ctx.strokeStyle = '#6b4a63';
      ctx.lineWidth = 0.04 * U;
      ctx.beginPath();
      ctx.arc(x, ey, 0.055 * U * scale, Math.PI * 1.1, Math.PI * 1.9);
      ctx.stroke();
      return;
    }
    ctx.fillStyle = '#4a2a45';
    ctx.beginPath();
    ctx.ellipse(x, ey, 0.07 * U * scale, 0.098 * U * scale, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(x + 0.018 * U, ey - 0.03 * U, 0.024 * U * scale, 0, Math.PI * 2);
    ctx.fill();
  };
  eye(ex - 0.02 * U, 0.85);
  eye(ex + 0.19 * U, 1);
  ctx.fillStyle = 'rgba(255,140,180,0.45)';
  ctx.beginPath();
  ctx.ellipse(ex + 0.27 * U, hy + 0.09 * U, 0.07 * U, 0.045 * U, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(ex - 0.12 * U, hy + 0.09 * U, 0.05 * U, 0.035 * U, 0, 0, Math.PI * 2);
  ctx.fill();

  // Mouth: chomps open while moving (inhaling the mucus)
  const mx = ex + 0.1 * U;
  const my = hy + 0.15 * U;
  if (open < 0.12 || w > 0.35) {
    ctx.strokeStyle = '#a8325e';
    ctx.lineWidth = 0.04 * U;
    ctx.beginPath();
    ctx.arc(mx, my - 0.03 * U, 0.06 * U, 0.2 * Math.PI, 0.8 * Math.PI);
    ctx.stroke();
  } else {
    const rx = (0.055 + 0.035 * open) * U;
    const ry = (0.03 + 0.085 * open) * U;
    ctx.fillStyle = '#a8325e';
    ctx.beginPath();
    ctx.ellipse(mx, my, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ff8fb3';
    ctx.beginPath();
    ctx.ellipse(mx, my + ry * 0.45, rx * 0.65, ry * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Front leaf-wing
  leaf(hx + 0.08 * U, hy + 0.38 * U, 0.35 + flap * 0.4 + w * 0.5, 0.3 * U);
  return c;
}

// ------------------------------------------------------------ shared style
// Flat "cut paper" look taken from the hero art (gorseller/oyuncu-*.png):
// solid fills, one darker flat plane per shape instead of gradients, solid
// black dot eyes, and a white sticker outline with a thin plum rim.

export const HERO = { pink: '#f91576', dark: '#b9014b', darkest: '#90023a', leaf: '#58844f', stem: '#a11247' } as const;
const RIM = '#5c1640';
const INK = '#1d0b16';
/** Sticker outline widths in tiles (matches the hero frames on screen). */
const STICKER_WHITE = 0.05;
const STICKER_RIM = 0.026;

/** Adds the hero's sticker outline (white band + plum rim) around a sprite's silhouette. */
function sticker(src: HTMLCanvasElement, T: number, white = STICKER_WHITE, rim = STICKER_RIM): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(src.width, src.height);
  const [m, mctx] = makeCanvas(src.width, src.height);
  const ring = (r: number, color: string): void => {
    if (r <= 0) return;
    mctx.globalCompositeOperation = 'copy';
    mctx.drawImage(src, 0, 0);
    mctx.globalCompositeOperation = 'source-in';
    mctx.fillStyle = color;
    mctx.fillRect(0, 0, m.width, m.height);
    // Dilate by stamping the silhouette around two circles.
    for (const rr of [r, r * 0.5]) {
      const n = Math.max(12, Math.ceil(rr * 5));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        ctx.drawImage(m, Math.cos(a) * rr, Math.sin(a) * rr);
      }
    }
  };
  ring((white + rim) * T, RIM);
  ring(white * T, '#ffffff');
  ctx.drawImage(src, 0, 0);
  return c;
}

/**
 * Fills `shape` flat, then a darker plane on its lower-right side: the shape
 * minus a copy nudged up-left. This is the hero's two-tone shading.
 */
function flatShade(ctx: Ctx, shape: () => void, base: string, shade: string, dx: number, dy: number): void {
  ctx.save();
  shape();
  ctx.fillStyle = shade;
  ctx.fill();
  ctx.clip();
  ctx.translate(-dx, -dy);
  shape();
  ctx.fillStyle = base;
  ctx.fill();
  ctx.restore();
}

/** Hero-style petal: pointed tip at (0,-len), slight S-twist, base at the origin. */
function petalPath(ctx: Ctx, w: number, len: number): void {
  ctx.beginPath();
  ctx.moveTo(-w, 0);
  ctx.bezierCurveTo(-w * 1.1, -len * 0.45, -w * 0.2, -len * 0.75, w * 0.25, -len);
  ctx.bezierCurveTo(w * 0.55, -len * 0.7, w * 1.15, -len * 0.4, w, 0);
  ctx.closePath();
}

function star(ctx: Ctx, x: number, y: number, r: number, inner = 0.35, points = 4): void {
  ctx.beginPath();
  for (let k = 0; k < points * 2; k++) {
    const rr = k % 2 ? r * inner : r;
    const a = (k / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
}

// ------------------------------------------------------- power: Siklamen Özü
// A drop of extract in the hero's colours, with a cyclamen leaf at its tip.
function drawExtract(T: number): HTMLCanvasElement {
  const S = 2 * T;
  const [c, ctx] = makeCanvas(S, S);
  const cx = S / 2;
  const cy = S / 2 + 0.22 * T;
  const drop = (): void => {
    ctx.save();
    ctx.translate(cx, cy);
    teardrop(ctx, 0.34 * T, 0.72 * T);
    ctx.restore();
  };
  // Leaf + stem behind the drop's tip.
  ctx.strokeStyle = HERO.stem;
  ctx.lineWidth = 0.06 * T;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx, cy - 0.62 * T);
  ctx.quadraticCurveTo(cx + 0.05 * T, cy - 0.8 * T, cx + 0.16 * T, cy - 0.86 * T);
  ctx.stroke();
  ctx.save();
  ctx.translate(cx + 0.3 * T, cy - 0.9 * T);
  ctx.rotate(-0.5);
  heartLeaf(ctx, 0.2 * T);
  ctx.fillStyle = HERO.leaf;
  ctx.fill();
  ctx.restore();
  flatShade(ctx, drop, HERO.pink, HERO.dark, 0.11 * T, 0.05 * T);
  // Flat white glint, petal-shaped.
  ctx.save();
  ctx.translate(cx - 0.13 * T, cy - 0.12 * T);
  ctx.rotate(-0.35);
  petalPath(ctx, 0.05 * T, 0.26 * T);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.restore();
  const out = sticker(c, T);
  const octx = out.getContext('2d')!;
  octx.fillStyle = '#ffe14d';
  star(octx, cx + 0.42 * T, cy - 0.5 * T, 0.12 * T);
  octx.fill();
  star(octx, cx - 0.44 * T, cy - 0.18 * T, 0.08 * T);
  octx.fill();
  return out;
}

// ------------------------------------------------------------------ viruses
// Symptoms are round viruses whose spikes are drawn like the hero's petals.
// 4 frames make the spikes "breathe"; eyes/pupils are separate sprites so the
// view can aim the gaze (and show only the eyes when a virus is eaten).

export const VIRUS_FRAMES = 4;
const BODY_R = 0.54;
const EYE_Y = -0.06;
const EYE_DX = 0.2;

export const GHOST_COLORS = [
  { base: '#ff5a2c', shade: '#d93a12', spike: '#b02a0a', light: '#ffd9a8' }, // acute infection / fever
  { base: '#8f5cff', shade: '#6b3ae6', spike: '#4c22b8', light: '#e2d6ff' }, // headache
  { base: '#2e90ff', shade: '#156bd8', spike: '#0d4ea6', light: '#cfe6ff' }, // facial pressure
  { base: '#ffb21e', shade: '#e88a00', spike: '#b86a00', light: '#fff0b8' }, // congestion
] as const;

type VirusColors = (typeof GHOST_COLORS)[number];

function drawSpikes(ctx: Ctx, cx: number, cy: number, T: number, id: number, frame: number, col: VirusColors): void {
  const n = id === 2 ? 9 : id === 1 ? 11 : 10;
  const R = BODY_R * T;
  const ph = (frame / VIRUS_FRAMES) * Math.PI * 2;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2 + 0.2;
    const breathe = Math.sin(ph + i * 2.1);
    ctx.save();
    ctx.translate(cx + Math.cos(a) * R * 0.8, cy + Math.sin(a) * R * 0.8);
    ctx.rotate(a + Math.PI / 2 + breathe * 0.08);
    ctx.fillStyle = col.spike;
    if (id === 0) {
      // Fever: flame-like petals
      petalPath(ctx, 0.13 * T, (0.42 + 0.06 * breathe) * T);
      ctx.fill();
    } else if (id === 1) {
      // Headache: sharp, thin spikes
      ctx.beginPath();
      ctx.moveTo(-0.08 * T, 0);
      ctx.lineTo(0.02 * T, -(0.44 + 0.07 * breathe) * T);
      ctx.lineTo(0.08 * T, 0);
      ctx.closePath();
      ctx.fill();
    } else if (id === 2) {
      // Pressure: blunt, heavy clubs
      const len = (0.34 + 0.04 * breathe) * T;
      ctx.fillRect(-0.05 * T, -len, 0.1 * T, len);
      ctx.beginPath();
      ctx.roundRect(-0.13 * T, -len - 0.06 * T, 0.26 * T, 0.13 * T, 0.06 * T);
      ctx.fill();
    } else {
      // Congestion: drooping mucus drops
      const len = (0.3 + 0.05 * breathe) * T;
      ctx.fillRect(-0.04 * T, -len, 0.08 * T, len);
      ctx.translate(0, -len - 0.02 * T);
      ctx.rotate(Math.PI);
      teardrop(ctx, 0.1 * T, 0.12 * T);
      ctx.fill();
    }
    ctx.restore();
  }
}

function drawCapsid(ctx: Ctx, cx: number, cy: number, T: number, col: VirusColors): void {
  const R = BODY_R * T;
  const body = (): void => {
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
  };
  flatShade(ctx, body, col.base, col.shade, 0.13 * T, 0.15 * T);
  // A few flat membrane spots for texture.
  ctx.fillStyle = col.shade;
  for (const [ang, dist, r] of [
    [2.5, 0.68, 0.075],
    [0.35, 0.74, 0.06],
    [3.7, 0.72, 0.05],
  ] as const) {
    ctx.beginPath();
    ctx.arc(cx + Math.cos(ang) * R * dist, cy + Math.sin(ang) * R * dist, r * T, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawVirusFace(ctx: Ctx, cx: number, cy: number, T: number, id: number, col: VirusColors): void {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = INK;
  ctx.fillStyle = INK;
  const browY = cy + (EYE_Y - 0.25) * T;

  // Brows: mischievous slant; sleepy droop for congestion.
  ctx.lineWidth = 0.06 * T;
  for (const s of [-1, 1]) {
    const outer = id === 3 ? browY + 0.06 * T : browY - 0.03 * T;
    const inner = id === 3 ? browY - 0.01 * T : browY + 0.05 * T;
    ctx.beginPath();
    ctx.moveTo(cx + s * 0.31 * T, outer);
    ctx.lineTo(cx + s * 0.12 * T, inner);
    ctx.stroke();
  }

  const my = cy + 0.23 * T;
  ctx.lineWidth = 0.055 * T;
  if (id === 0) {
    // Cheeky smirk + flat sweat drop
    ctx.beginPath();
    ctx.moveTo(cx - 0.14 * T, my - 0.02 * T);
    ctx.quadraticCurveTo(cx + 0.02 * T, my + 0.09 * T, cx + 0.16 * T, my - 0.07 * T);
    ctx.stroke();
    ctx.fillStyle = '#7fd3ff';
    teardropAt(ctx, cx + 0.4 * T, cy - 0.3 * T, 0.05 * T, 0.11 * T);
    ctx.fill();
  } else if (id === 1) {
    // Zigzag "ouch" mouth + flat bandage cross
    ctx.beginPath();
    for (let i = 0; i <= 4; i++) {
      const x = cx - 0.13 * T + (0.26 * T * i) / 4;
      const y = my + (i % 2 ? -0.04 : 0.04) * T;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.save();
    ctx.translate(cx + 0.27 * T, cy - 0.33 * T);
    ctx.rotate(0.6);
    for (const [rot, fill] of [
      [0, '#ffe2c2'],
      [Math.PI / 2, '#f5c99a'],
    ] as const) {
      ctx.save();
      ctx.rotate(rot);
      ctx.beginPath();
      ctx.roundRect(-0.16 * T, -0.05 * T, 0.32 * T, 0.1 * T, 0.04 * T);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  } else if (id === 2) {
    // Strained pout
    ctx.beginPath();
    ctx.moveTo(cx - 0.12 * T, my + 0.04 * T);
    ctx.quadraticCurveTo(cx, my - 0.07 * T, cx + 0.12 * T, my + 0.04 * T);
    ctx.stroke();
  } else {
    // Sleepy open mouth + snot bubble
    ctx.beginPath();
    ctx.ellipse(cx, my + 0.01 * T, 0.085 * T, 0.065 * T, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = col.light;
    ctx.beginPath();
    ctx.arc(cx + 0.21 * T, cy + 0.06 * T, 0.09 * T, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(cx + 0.18 * T, cy + 0.03 * T, 0.025 * T, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawGhostBody(T: number, id: number, frame: number): HTMLCanvasElement {
  const S = 2 * T;
  const [c, ctx] = makeCanvas(S, S);
  const col = GHOST_COLORS[id];
  const cx = S / 2;
  const cy = S / 2;
  ctx.save();
  if (id === 2) {
    ctx.translate(cx, cy);
    ctx.scale(1.08, 0.9);
    ctx.translate(-cx, -cy);
  }
  drawSpikes(ctx, cx, cy, T, id, frame, col);
  drawCapsid(ctx, cx, cy, T, col);
  ctx.restore();
  drawVirusFace(ctx, cx, cy, T, id, col);
  return sticker(c, T);
}

function drawGhostEyes(T: number): HTMLCanvasElement {
  const S = 2 * T;
  const [c, ctx] = makeCanvas(S, S);
  const cx = S / 2;
  const ey = S / 2 + EYE_Y * T;
  for (const [fill, grow] of [
    [RIM, 0.03],
    ['#ffffff', 0],
  ] as const) {
    ctx.fillStyle = fill;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(cx + s * EYE_DX * T, ey, (0.13 + grow) * T, (0.16 + grow) * T, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  return c;
}

/** Solid black dots, like the hero's eye. */
function drawGhostPupils(T: number): HTMLCanvasElement {
  const S = 2 * T;
  const [c, ctx] = makeCanvas(S, S);
  const cx = S / 2;
  const ey = S / 2 + EYE_Y * T;
  ctx.fillStyle = INK;
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(cx + s * EYE_DX * T, ey + 0.01 * T, 0.075 * T, 0, Math.PI * 2);
    ctx.fill();
  }
  return c;
}

/** Frightened = liquefied virus ("drainage" state): a melting aqua blob, dripping. */
function drawFright(T: number, frame: number, flash: boolean): HTMLCanvasElement {
  const S = 2 * T;
  const [c, ctx] = makeCanvas(S, S);
  const cx = S / 2;
  const cy = S / 2 - 0.04 * T;
  const R = BODY_R * T;
  const base = flash ? '#ffffff' : '#62d0ff';
  const shade = flash ? '#ffc6dd' : '#2b8fe0';
  const face = flash ? HERO.pink : INK;
  const ph = (frame / VIRUS_FRAMES) * Math.PI * 2;

  // Melted spike stubs
  ctx.fillStyle = shade;
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2 + 0.2;
    const sag = (0.5 + 0.5 * Math.sin(a)) * 0.08 * T;
    ctx.beginPath();
    ctx.ellipse(cx + Math.cos(a) * (R + 0.05 * T), cy + Math.sin(a) * (R + 0.05 * T) + sag, 0.07 * T, 0.085 * T, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  const blob = (): void => {
    ctx.beginPath();
    for (let i = 0; i <= 40; i++) {
      const a = (i / 40) * Math.PI * 2;
      const w = Math.sin(a * 5 + ph) * 0.022 * T + Math.max(0, Math.sin(a)) * 0.06 * T;
      const x = cx + Math.cos(a) * (R + w * 0.5);
      const y = cy + Math.sin(a) * (R + w);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  };
  flatShade(ctx, blob, base, shade, 0.13 * T, 0.15 * T);

  // Drips falling away
  ctx.fillStyle = shade;
  for (const [dx, off] of [
    [-0.32, 0],
    [0.12, 0.5],
    [0.38, 0.25],
  ] as const) {
    const k = (frame / VIRUS_FRAMES + off) % 1;
    const sz = (1 - k * 0.5) * T;
    teardropAt(ctx, cx + dx * T, cy + R + (0.1 + k * 0.26) * T, 0.05 * sz, 0.1 * sz);
    ctx.fill();
  }

  ctx.fillStyle = face;
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(cx + s * 0.19 * T, cy - 0.06 * T, 0.075 * T, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = face;
  ctx.lineWidth = 0.055 * T;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (let i = 0; i <= 6; i++) {
    const x = cx - 0.25 * T + (0.5 * T * i) / 6;
    const y = cy + 0.2 * T + (i % 2 ? -0.045 : 0.045) * T;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  return sticker(c, T);
}

// --------------------------------------------------------- pickups & props

function drawPellet(T: number, variant: number): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(T, T);
  const cx = T / 2;
  const cy = T / 2;
  const r = 0.13 * T;
  const offs = [
    [
      [0, 0, 1],
      [0.35, -0.3, 0.6],
    ],
    [
      [0, 0, 1],
      [-0.4, 0.2, 0.55],
      [0.35, 0.3, 0.45],
    ],
    [
      [0, 0, 0.95],
      [0.1, -0.45, 0.5],
    ],
  ][variant];
  const blob = (grow: number) => (): void => {
    ctx.beginPath();
    for (const [dx, dy, s] of offs) {
      ctx.moveTo(cx + dx * r + s * r + grow, cy + dy * r);
      ctx.arc(cx + dx * r, cy + dy * r, s * r + grow, 0, Math.PI * 2);
    }
  };
  blob(0.035 * T)();
  ctx.fillStyle = '#6d6a12';
  ctx.fill();
  flatShade(ctx, blob(0), '#e3e64a', '#b5b81e', 0.05 * T, 0.06 * T);
  return c;
}

function drawGlow(T: number, rgb: string, size: number): HTMLCanvasElement {
  const S = size * T;
  const [c, ctx] = makeCanvas(S, S);
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, `rgba(${rgb},0.7)`);
  g.addColorStop(0.35, `rgba(${rgb},0.3)`);
  g.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  return c;
}

/** Hero-shaped petal used for the player's trail and wilt particles (tinted at runtime). */
function drawPetalParticle(T: number): HTMLCanvasElement {
  const S = Math.max(6, 0.45 * T);
  const [c, ctx] = makeCanvas(S, S);
  ctx.translate(S / 2, S * 0.9);
  petalPath(ctx, S * 0.2, S * 0.8);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  return c;
}

function drawTrap(T: number): HTMLCanvasElement {
  const S = 2 * T;
  const [c, ctx] = makeCanvas(S, S);
  const cx = S / 2 - 0.1 * T;
  const bw = 0.7 * T;
  const bh = 0.95 * T;
  const by = S / 2 - 0.15 * T;
  const rr = (x: number, y: number, w: number, h: number, r: number) => (): void => {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
  };
  // Nozzle + neck, then the bottle body
  flatShade(ctx, rr(cx - 0.12 * T, by - 0.6 * T, 0.24 * T, 0.34 * T, 0.08 * T), '#ff5a2c', '#c2300f', 0.06 * T, 0);
  flatShade(ctx, rr(cx - 0.17 * T, by - 0.3 * T, 0.34 * T, 0.34 * T, 0.05 * T), '#56677d', '#3d4b5e', 0.07 * T, 0);
  flatShade(ctx, rr(cx - bw / 2, by, bw, bh, 0.16 * T), '#b9c6d6', '#8798ae', 0.16 * T, 0);
  // Warning label
  const ly = by + 0.22 * T;
  ctx.fillStyle = '#ffd23f';
  ctx.beginPath();
  ctx.moveTo(cx - 0.04 * T, ly);
  ctx.lineTo(cx + 0.24 * T, ly + 0.46 * T);
  ctx.lineTo(cx - 0.32 * T, ly + 0.46 * T);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = INK;
  ctx.font = `900 ${0.3 * T}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('!', cx - 0.04 * T, ly + 0.3 * T);
  const out = sticker(c, T);
  // Chemical mist (no outline)
  const octx = out.getContext('2d')!;
  octx.fillStyle = '#9aa7b8';
  for (const [dx, dy, r] of [
    [0.27, -0.48, 0.07],
    [0.44, -0.62, 0.06],
    [0.57, -0.44, 0.05],
    [0.66, -0.7, 0.04],
  ] as const) {
    octx.beginPath();
    octx.arc(cx + dx * T, by + dy * T, r * T, 0, Math.PI * 2);
    octx.fill();
  }
  return out;
}

function drawSwell(T: number): HTMLCanvasElement {
  const S = 1.3 * T;
  const [c, ctx] = makeCanvas(S, S);
  const cx = S / 2;
  const cy = S / 2;
  const lumps = [
    [0, 0, 0.38],
    [-0.18, -0.14, 0.24],
    [0.2, 0.11, 0.26],
    [0.16, -0.18, 0.2],
  ];
  const blob = (): void => {
    ctx.beginPath();
    for (const [dx, dy, r] of lumps) {
      ctx.moveTo(cx + dx * T + r * T, cy + dy * T);
      ctx.arc(cx + dx * T, cy + dy * T, r * T, 0, Math.PI * 2);
    }
  };
  flatShade(ctx, blob, '#ff6457', '#d23a33', 0.1 * T, 0.12 * T);
  return sticker(c, T, 0, 0.04);
}

/** Crisp flat disc (bubbles and particles, tinted at runtime). */
function drawDot(T: number): HTMLCanvasElement {
  const S = Math.max(4, 0.5 * T);
  const [c, ctx] = makeCanvas(S, S);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, S / 2 - 0.5, 0, Math.PI * 2);
  ctx.fill();
  return c;
}

function drawRing(T: number): HTMLCanvasElement {
  const S = 4 * T;
  const [c, ctx] = makeCanvas(S, S);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 0.14 * T;
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, S / 2 - 0.2 * T, 0, Math.PI * 2);
  ctx.stroke();
  return c;
}

function drawDoor(T: number): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(2 * T, 0.5 * T);
  ctx.fillStyle = RIM;
  ctx.beginPath();
  ctx.roundRect(0.08 * T, 0.1 * T, 1.84 * T, 0.3 * T, 0.15 * T);
  ctx.fill();
  ctx.fillStyle = HERO.pink;
  ctx.beginPath();
  ctx.roundRect(0.12 * T, 0.14 * T, 1.76 * T, 0.22 * T, 0.11 * T);
  ctx.fill();
  return c;
}

function drawPopup(T: number, value: number): HTMLCanvasElement {
  const text = String(value);
  const fs = 0.8 * T;
  const [c, ctx] = makeCanvas(fs * 0.62 * text.length + 0.5 * T, fs * 1.4);
  ctx.font = `900 ${fs}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 0.2 * T;
  ctx.strokeStyle = RIM;
  ctx.strokeText(text, c.width / 2, c.height / 2);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, c.width / 2, c.height / 2);
  return c;
}

// --------------------------------------------------------------------- maze
// Mucosa walls as flat cut-paper shapes: a rounded blob mask with a gentle
// hand-cut wobble, blurred and re-thresholded into crisp rounded outlines.
// Shading is flat bands like the hero art: a lighter top-left edge, a darker
// lower-right plane, a thin dark rim and a hard (unblurred) shadow on the floor.
// Output is greyscale so the view can tint it per location / state.

export interface MazeArt {
  walls: HTMLCanvasElement;
  floor: HTMLCanvasElement;
  /** Texture pixels per world (tile-space) pixel for each canvas. */
  wallScale: number;
  floorScale: number;
}

const smooth = (a: number, b: number, x: number): number => {
  const t = x <= a ? 0 : x >= b ? 1 : (x - a) / (b - a);
  return t * t * (3 - 2 * t);
};

function boxBlur(src: Float32Array, tmp: Float32Array, w: number, h: number, r: number): void {
  const norm = 1 / (2 * r + 1);
  // Horizontal: src -> tmp
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += src[row + Math.min(w - 1, Math.max(0, k))];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc * norm;
      acc += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
    }
  }
  // Vertical: tmp -> src
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += tmp[Math.min(h - 1, Math.max(0, k)) * w + x];
    for (let y = 0; y < h; y++) {
      src[y * w + x] = acc * norm;
      acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
}

export function drawMazeArt(T: number, grid: Uint8Array, tunnels: Uint8Array, seed: number): MazeArt {
  // Full device resolution (blurry walls otherwise), capped so the four baked
  // state textures stay small on very large screens.
  const s = Math.min(1, 44 / T);
  const U = T * s;
  const W = Math.ceil(COLS * U);
  const H = Math.ceil(ROWS * U);
  const isWall = (c: number, r: number): boolean => {
    if (r < 0 || r >= ROWS) return true;
    if (c < 0 || c >= COLS) return tunnels[r] !== 1;
    return grid[r * COLS + c] === T_WALL;
  };

  // 1. Blob mask
  const [mc, mctx] = makeCanvas(W, H);
  const R = 0.25 * U;
  const p = new Path2D();
  for (let r = -1; r <= ROWS; r++) {
    for (let c = -1; c <= COLS; c++) {
      if (!isWall(c, r)) continue;
      const x = (c + 0.5) * U;
      const y = (r + 0.5) * U;
      p.moveTo(x + R, y);
      p.arc(x, y, R, 0, Math.PI * 2);
      if (isWall(c + 1, r)) p.rect(x, y - R, U, R * 2);
      if (isWall(c, r + 1)) p.rect(x - R, y, R * 2, U);
      if (isWall(c + 1, r) && isWall(c, r + 1) && isWall(c + 1, r + 1)) p.rect(x, y, U, U);
    }
  }
  mctx.fillStyle = '#fff';
  mctx.fill(p);
  const md = mctx.getImageData(0, 0, W, H).data;
  const F = new Float32Array(W * H);
  for (let i = 0; i < F.length; i++) F[i] = md[i * 4 + 3] / 255;

  // 2. Organic wobble (seeded value noise)
  let sd = (seed * 2654435761) >>> 0 || 1;
  const rnd = (): number => {
    sd ^= sd << 13;
    sd ^= sd >>> 17;
    sd ^= sd << 5;
    return ((sd >>> 0) / 4294967296) * 2 - 1;
  };
  const cs = 1.7 * U;
  const nx = Math.ceil(W / cs) + 2;
  const ny = Math.ceil(H / cs) + 2;
  const nv = new Float32Array(nx * ny);
  for (let i = 0; i < nv.length; i++) nv[i] = rnd();
  for (let y = 0; y < H; y++) {
    const fy = y / cs;
    const iy = fy | 0;
    const ty = smooth(0, 1, fy - iy);
    for (let x = 0; x < W; x++) {
      const fx = x / cs;
      const ix = fx | 0;
      const tx = smooth(0, 1, fx - ix);
      const a = nv[iy * nx + ix] + (nv[iy * nx + ix + 1] - nv[iy * nx + ix]) * tx;
      const b = nv[(iy + 1) * nx + ix] + (nv[(iy + 1) * nx + ix + 1] - nv[(iy + 1) * nx + ix]) * tx;
      F[y * W + x] += (a + (b - a) * ty) * 0.1;
    }
  }

  // 3. Soften
  const tmp = new Float32Array(W * H);
  const br = Math.max(1, Math.round(0.15 * U));
  boxBlur(F, tmp, W, H, br);
  boxBlur(F, tmp, W, H, br);

  // Depth field for a soft "pillow" swell of the mucosa.
  const D = F.slice();
  const dr = Math.max(1, Math.round(0.3 * U));
  boxBlur(D, tmp, W, H, dr);
  boxBlur(D, tmp, W, H, dr);

  // 4. Shade (flat bands, anti-aliased by the smooth threshold)
  const out = mctx.createImageData(W, H);
  const o = out.data;
  const inside = (x: number, y: number): number => {
    const xi = x < 0 ? 0 : x >= W ? W - 1 : x;
    const yi = y < 0 ? 0 : y >= H ? H - 1 : y;
    return smooth(0.45, 0.55, F[yi * W + xi]);
  };
  const dk = Math.max(1, Math.round(0.13 * U)); // darker lower-right plane
  const lt = Math.max(1, Math.round(0.05 * U)); // light top-left edge
  const sh = Math.max(1, Math.round(0.16 * U)); // floor shadow offset
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const a = inside(x, y);
      let gray = 0;
      if (a > 0) {
        const plane = 1 - inside(x + dk, y + dk);
        const edge = 1 - inside(x - lt, y - lt);
        const rim = 1 - smooth(0.55, 0.62, F[i]);
        gray = 0.84 + 0.1 * smooth(0.55, 0.95, D[i]);
        gray += (1 - gray) * edge * (1 - plane);
        gray = gray * (1 - plane) + 0.74 * plane;
        gray = gray * (1 - rim) + 0.5 * rim;
      }
      const sa = inside(x - (sh >> 1), y - sh) * 0.22 * (1 - a);
      const alpha = a + sa;
      const g = alpha > 0 ? (a * gray + sa * 0.3) / alpha : 0;
      const j = i * 4;
      o[j] = o[j + 1] = o[j + 2] = g * 255;
      o[j + 3] = alpha * 255;
    }
  }
  mctx.putImageData(out, 0, 0);

  // 5. Floor: soft mucosa mottling, a few faint capillaries and a sparse print
  // of "cells". Kept low-contrast so the play field stays calm on the eyes.
  const fs = s;
  const [fc, fctx] = makeCanvas(W, H);
  fctx.fillStyle = '#ffffff';
  fctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 60; i++) {
    const x = ((rnd() + 1) / 2) * W;
    const y = ((rnd() + 1) / 2) * H;
    const r = (1.2 + rnd() * 0.6) * U;
    const g = fctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(0,0,0,0.035)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    fctx.fillStyle = g;
    fctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  fctx.lineCap = 'round';
  fctx.strokeStyle = 'rgba(0,0,0,0.05)';
  const vessel = (x: number, y: number, a: number, len: number, w: number, depth: number): void => {
    fctx.lineWidth = w;
    fctx.beginPath();
    fctx.moveTo(x, y);
    for (let k = 0; k < len; k++) {
      a += rnd() * 0.5;
      const nx = x + Math.cos(a) * 0.8 * U;
      const ny = y + Math.sin(a) * 0.8 * U;
      fctx.quadraticCurveTo(x + Math.cos(a + 0.4) * 0.4 * U, y + Math.sin(a + 0.4) * 0.4 * U, nx, ny);
      x = nx;
      y = ny;
      if (depth > 0 && rnd() > 0.55) {
        fctx.stroke();
        vessel(x, y, a + (rnd() > 0 ? 0.9 : -0.9), (len - k) >> 1, w * 0.6, depth - 1);
        fctx.lineWidth = w;
        fctx.beginPath();
        fctx.moveTo(x, y);
      }
    }
    fctx.stroke();
  };
  for (let i = 0; i < 9; i++) {
    vessel(((rnd() + 1) / 2) * W, ((rnd() + 1) / 2) * H, rnd() * Math.PI, 7, 0.07 * U, 2);
  }
  for (let r = 0; r < ROWS; r += 2) {
    for (let c = (r >> 1) % 2; c < COLS; c += 2) {
      const x = (c + 0.5 + rnd() * 0.5) * U;
      const y = (r + 0.5 + rnd() * 0.5) * U;
      const big = rnd() > 0.1;
      fctx.fillStyle = big ? 'rgba(0,0,0,0.03)' : 'rgba(0,0,0,0.06)';
      fctx.beginPath();
      fctx.arc(x, y, (big ? 0.55 + rnd() * 0.25 : 0.09) * U, 0, Math.PI * 2);
      fctx.fill();
    }
  }

  return { walls: mc, floor: fc, wallScale: s, floorScale: fs };
}

// ----------------------------------------------------------------- frames

export type FrameMap = Map<string, HTMLCanvasElement>;

/** Rasterizes a custom image into a frame, centered and contained in `box` tiles. */
function fitImage(img: HTMLImageElement, T: number, frameW: number, frameH: number, box: number, scale = 1, alpha = 1): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(frameW, frameH);
  const iw = img.naturalWidth || 256;
  const ih = img.naturalHeight || 256;
  const k = ((box * T) / Math.max(iw, ih)) * scale;
  const w = iw * k;
  const h = ih * k;
  ctx.imageSmoothingQuality = 'high';
  ctx.globalAlpha = alpha;
  ctx.drawImage(img, (c.width - w) / 2, (c.height - h) / 2, w, h);
  return c;
}

/**
 * Death frame for custom player art (k: 0..1). Like the arcade, the mouth gapes
 * all the way open first; then the flower spins, shrinks and wilts to grey.
 */
function customDeath(mouth: HTMLCanvasElement[], k: number): HTMLCanvasElement {
  const OPEN = 0.25;
  const src = mouth[Math.round(Math.min(1, k / OPEN) * (mouth.length - 1))];
  const t = Math.max(0, (k - OPEN) / (1 - OPEN));
  const [c, ctx] = makeCanvas(src.width, src.height);
  const s = 1 - t * 0.85;
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate(-t * t * Math.PI * 1.5);
  ctx.scale(s, s);
  ctx.globalAlpha = 1 - t * t;
  ctx.drawImage(src, -src.width / 2, -src.height / 2);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = `rgba(196,178,188,${(t * 0.75).toFixed(3)})`;
  ctx.fillRect(0, 0, c.width, c.height);
  return c;
}

/** White-washed copy (used for the "fright ending" flash when no custom flash art exists). */
function whiten(src: HTMLCanvasElement): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(src.width, src.height);
  ctx.drawImage(src, 0, 0);
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.fillRect(0, 0, c.width, c.height);
  return c;
}

export function drawFrames(T: number, custom?: CustomArt): FrameMap {
  const f: FrameMap = new Map();
  const imgs = (slot: SpriteSlot): HTMLImageElement[] | undefined => custom?.sprites.get(slot);
  const fit = (slot: SpriteSlot, i: number, size: number, scale = 1, alpha = 1): HTMLCanvasElement => {
    const list = imgs(slot)!;
    return fitImage(list[i % list.length], T, size * T, size * T, SPRITE_SLOTS[slot].box, scale, alpha);
  };

  // Player
  if (imgs('oyuncu')) {
    // Custom frames are ordered closed -> open; spread them over the mouth cycle.
    const mouth = imgs('oyuncu')!.map((_, i) => fit('oyuncu', i, PLAYER_FRAME));
    const n = mouth.length;
    for (let i = 0; i < PLAYER_MOUTH_FRAMES; i++) {
      f.set(`player${i}`, mouth[Math.round((i * (n - 1)) / (PLAYER_MOUTH_FRAMES - 1))]);
    }
    for (let i = 0; i < PLAYER_DEATH_FRAMES; i++) f.set(`death${i}`, customDeath(mouth, i / (PLAYER_DEATH_FRAMES - 1)));
  } else {
    for (let i = 0; i < PLAYER_MOUTH_FRAMES; i++) {
      const k = i / (PLAYER_MOUTH_FRAMES - 1);
      f.set(`player${i}`, drawSiklamen(T, k, k * 2 - 1, 0));
    }
    for (let i = 0; i < PLAYER_DEATH_FRAMES; i++) {
      f.set(`death${i}`, drawSiklamen(T, 0.2, 0, i / (PLAYER_DEATH_FRAMES - 1)));
    }
  }

  // Viruses
  for (let id = 0; id < 4; id++) {
    const slot = VIRUS_SLOTS[id];
    for (let k = 0; k < VIRUS_FRAMES; k++) {
      f.set(`ghost${id}_${k}`, imgs(slot) ? fit(slot, k, 2) : drawGhostBody(T, id, k));
    }
  }

  // Drainage (frightened) + its end-of-effect flash
  for (let k = 0; k < VIRUS_FRAMES; k++) {
    const fright = imgs('drenaj') ? fit('drenaj', k, 2) : drawFright(T, k, false);
    f.set(`fright${k}`, fright);
    if (imgs('drenaj-uyari')) f.set(`flash${k}`, fit('drenaj-uyari', k, 2));
    else f.set(`flash${k}`, imgs('drenaj') ? whiten(fright) : drawFright(T, k, true));
  }

  f.set('eyes', drawGhostEyes(T));
  f.set('pupils', drawGhostPupils(T));
  for (let v = 0; v < 3; v++) f.set(`pellet${v}`, imgs('mukus') ? fit('mukus', v, 1) : drawPellet(T, v));
  f.set('power', imgs('siklamen-ozu') ? fit('siklamen-ozu', 0, 2) : drawExtract(T));
  f.set('glowPink', drawGlow(T, '255,110,185', 3));
  f.set('glowAqua', drawGlow(T, '90,215,215', 3));
  f.set('glowSoft', drawGlow(T, '255,236,246', 3));
  f.set('trap', imgs('sprey') ? fit('sprey', 0, 2) : drawTrap(T));
  f.set('swell', imgs('sislik') ? fit('sislik', 0, 1.3) : drawSwell(T));
  f.set('dot', drawDot(T));
  f.set('petal', drawPetalParticle(T));
  f.set('ring', drawRing(T));
  f.set('door', drawDoor(T));
  for (const v of POPUP_VALUES) f.set(`pop${v}`, drawPopup(T, v));
  return f;
}

/** Small composited icons for the DOM UI (legend, lives), matching in-game art. */
export function drawIcons(T: number, custom?: CustomArt): Record<string, string> {
  const f = drawFrames(T, custom);
  const compose = (...parts: HTMLCanvasElement[]): string => {
    const [c, ctx] = makeCanvas(parts[0].width, parts[0].height);
    for (const p of parts) ctx.drawImage(p, (c.width - p.width) / 2, (c.height - p.height) / 2);
    return c.toDataURL();
  };
  const icons: Record<string, string> = {
    player: compose(f.get('player2')!),
    pellet: compose(f.get('pellet1')!),
    power: compose(f.get('power')!),
    trap: compose(f.get('trap')!),
    fright: compose(f.get('fright0')!),
  };
  for (let id = 0; id < 4; id++) {
    const body = f.get(`ghost${id}_0`)!;
    icons[`ghost${id}`] = custom?.sprites.has(VIRUS_SLOTS[id]) ? compose(body) : compose(body, f.get('eyes')!, f.get('pupils')!);
  }
  return icons;
}
