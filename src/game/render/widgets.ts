// Etkileşimli parçalar: düğmeler, soru kutusu, cevap şıkları.
import { Container, Polygon, Rectangle, type FederatedPointerEvent, type Text } from 'pixi.js';
import { Baked, text } from './bake';
import { C, font, glow, hexPath, icon, neonPill, noGlow, pillPath, type IconName } from './draw';

type Hot = 0 | 1;

/** Çok durumlu düğme; her (görünüm × üzerinde) çifti ayrı dokuya pişirilir. */
export class Button<V extends string = 'n'> {
  readonly baked: Baked<`${V}:${Hot}`>;
  private variant: V;
  private hot: Hot = 0;
  enabled = true;

  constructor(
    w: number,
    h: number,
    variants: V[],
    draw: (ctx: CanvasRenderingContext2D, w: number, h: number, variant: V, hot: boolean, r: number) => void,
    onTap: () => void,
    pad = 22,
  ) {
    this.variant = variants[0];
    const states = variants.flatMap((v) => [`${v}:0`, `${v}:1`] as `${V}:${Hot}`[]);
    this.baked = new Baked(w, h, pad, (ctx, s, r) => {
      const [v, hot] = s.split(':') as [V, string];
      draw(ctx, this.baked.w, this.baked.h, v, hot === '1', r);
    }, states);
    const view = this.baked.view;
    view.eventMode = 'static';
    view.cursor = 'pointer';
    view.hitArea = new Rectangle(0, 0, w, h);
    view.on('pointerover', (e: FederatedPointerEvent) => { if (e.pointerType === 'mouse') this.setHot(1); });
    view.on('pointerout', () => this.setHot(0));
    view.on('pointertap', () => { if (this.enabled) onTap(); });
  }

  get view() { return this.baked.view; }

  setVariant(v: V) {
    this.variant = v;
    this.baked.setState(`${v}:${this.hot}`);
  }

  private setHot(h: Hot) {
    this.hot = this.enabled ? h : 0;
    this.baked.setState(`${this.variant}:${this.hot}`);
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    this.view.cursor = on ? 'pointer' : 'default';
    if (!on) this.setHot(0);
  }

  place(x: number, y: number, w: number, h: number) {
    this.view.position.set(x, y);
    this.view.hitArea = new Rectangle(0, 0, w, h);
    this.baked.resize(w, h);
  }
}

/** Neon kapsül + simge + etiket (üst çubuk ve joker düğmeleri). */
export function neonButton(label: string, ic: IconName | ((v: string) => IconName), fontSize: number, opts: { badge?: boolean } = {}) {
  return <V extends string>(ctx: CanvasRenderingContext2D, w: number, h: number, v: V, hot: boolean, r: number) => {
    const used = v === 'used';
    neonPill(ctx, w, h, r, hot, used);
    ctx.globalAlpha = used ? 0.4 : 1;
    const name = typeof ic === 'function' ? ic(v) : ic;
    const isz = fontSize * 1.5;
    ctx.font = font(500, fontSize);
    const tw = label ? ctx.measureText(label).width : 0;
    const gap = label ? fontSize * 0.6 : 0;
    const x0 = (w - (isz + gap + tw)) / 2;
    icon(ctx, name, x0, (h - isz) / 2, isz, C.white);
    if (label) {
      ctx.fillStyle = C.white;
      ctx.textBaseline = 'middle';
      ctx.fillText(label, x0 + isz + gap, h / 2 + 1);
    }
    ctx.globalAlpha = 1;
    if (opts.badge) {
      const bx = w - 14;
      const by = 2;
      ctx.beginPath();
      ctx.arc(bx, by, 13, 0, Math.PI * 2);
      if (used) {
        ctx.fillStyle = '#5d4f7c';
      } else {
        const g = ctx.createRadialGradient(bx - 4, by - 4, 1, bx, by, 13);
        g.addColorStop(0, '#ff7aa3');
        g.addColorStop(1, '#e8174f');
        ctx.fillStyle = g;
        glow(ctx, 'rgba(255,40,90,0.85)', 8, r);
      }
      ctx.fill();
      noGlow(ctx);
      ctx.fillStyle = C.white;
      ctx.font = font(700, 15);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(used ? '0' : '1', bx, by + 1);
      ctx.textAlign = 'left';
    }
  };
}

/** Pembe dolgu düğme (onayla / sonraki soru / yeni oyun). */
export function pinkButton(labels: Record<string, string>, fontSize: number) {
  return (ctx: CanvasRenderingContext2D, w: number, h: number, v: string, hot: boolean, r: number) => {
    pillPath(ctx, 0, 0, w, h);
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, hot ? '#ff63ad' : '#ff3f97');
    g.addColorStop(1, hot ? '#ff3d8a' : '#ff1f73');
    ctx.fillStyle = g;
    glow(ctx, hot ? 'rgba(255,70,160,0.95)' : 'rgba(255,45,138,0.65)', hot ? 22 : 16, r);
    ctx.fill();
    noGlow(ctx);
    ctx.font = font(700, fontSize);
    ctx.fillStyle = C.white;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(labels[v] ?? v, w / 2, h / 2 + 1);
    ctx.textAlign = 'left';
  };
}

// ---------- altıgen kutular ----------

type HexState = 'n' | 'hover' | 'sel' | 'ok' | 'bad';

const HEX_STYLE: Record<HexState, { edge: [string, string, string]; fill: [string, string, string]; glow: string; blur: number }> = {
  n: { edge: ['#48d4ff', '#6f7dff', '#b36bff'], fill: ['#1a1b60', '#0c0e3c', '#15115a'], glow: 'rgba(90,130,255,0.85)', blur: 12 },
  hover: { edge: ['#9af2ff', '#a3adff', '#d6a2ff'], fill: ['#262a80', '#131655', '#1d1972'], glow: 'rgba(120,190,255,1)', blur: 18 },
  sel: { edge: ['#ffe39a', '#ffc04a', '#ffad2e'], fill: ['#ffc54d', '#f39a12', '#e98500'], glow: 'rgba(255,180,40,0.95)', blur: 20 },
  ok: { edge: ['#c4ffe0', '#5df5ad', '#3cf09a'], fill: ['#35e690', '#14b061', '#0b9a52'], glow: 'rgba(46,224,138,1)', blur: 22 },
  bad: { edge: ['#ffc2c8', '#ff7381', '#ff4d5e'], fill: ['#ff5363', '#d61f38', '#b5122a'], glow: 'rgba(255,60,80,1)', blur: 22 },
};

function drawHex(ctx: CanvasRenderingContext2D, w: number, h: number, pt: number, st: HexState, r: number) {
  const S = HEX_STYLE[st];
  const bw = 2.8;
  const edge = ctx.createLinearGradient(0, 0, w, 0);
  edge.addColorStop(0, S.edge[0]);
  edge.addColorStop(0.45, S.edge[1]);
  edge.addColorStop(1, S.edge[2]);
  hexPath(ctx, 0, 0, w, h, pt);
  glow(ctx, S.glow, S.blur, r);
  ctx.fillStyle = edge;
  ctx.fill();
  noGlow(ctx);
  const fill = ctx.createLinearGradient(0, 0, 0, h);
  fill.addColorStop(0, S.fill[0]);
  fill.addColorStop(0.7, S.fill[1]);
  fill.addColorStop(1, S.fill[2]);
  const ip = pt * (1 - (bw * 2) / h); // içteki altıgen aynı eğimi korur
  hexPath(ctx, bw, bw, w - bw * 2, h - bw * 2, ip);
  ctx.fillStyle = fill;
  ctx.fill();
  // üst kenarda ince ışık yansıması
  ctx.save();
  ctx.clip();
  const sheen = ctx.createLinearGradient(0, 0, 0, h * 0.5);
  sheen.addColorStop(0, 'rgba(255,255,255,0.10)');
  sheen.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, w, h * 0.5);
  ctx.restore();
}

function hexHit(w: number, h: number, pt: number) {
  return new Polygon([0, h / 2, pt, 0, w - pt, 0, w, h / 2, w - pt, h, pt, h]);
}

/** Metni kutuya sığana kadar küçültür (yalnızca içerik değiştiğinde çalışır). */
function fit(t: Text, maxW: number, maxH: number, sizes: number[]) {
  for (const s of sizes) {
    t.style.fontSize = s;
    t.style.wordWrapWidth = maxW;
    if (t.height <= maxH && t.width <= maxW + 1) return;
  }
}

export class QuestionBox {
  readonly baked: Baked;
  readonly category = text({ fontSize: 15, fontWeight: '600', fill: C.cyan, letterSpacing: 4.5 });
  readonly label = text({ fontSize: 35, fontWeight: '700', align: 'center', wordWrap: true, lineHeight: 0 });
  readonly content = new Container();
  private pt = 66;
  private padX = 120;
  private baseFont = 35;

  constructor() {
    this.baked = new Baked(100, 100, 24, (ctx, _s, r) => drawHex(ctx, this.baked.w, this.baked.h, this.pt, 'n', r));
    this.category.anchor.set(0.5, 0);
    this.label.anchor.set(0.5, 0);
    this.content.addChild(this.category, this.label);
    this.baked.view.addChild(this.content);
  }

  get view() { return this.baked.view; }

  place(x: number, y: number, w: number, h: number, pt: number, padX: number, baseFont: number) {
    this.pt = pt;
    this.padX = padX;
    this.baseFont = baseFont;
    this.view.position.set(x, y);
    this.baked.resize(w, h);
    this.baked.invalidate();
    this.layoutText();
  }

  set(category: string, question: string) {
    this.category.text = category.toLocaleUpperCase('tr');
    this.label.text = question;
    this.layoutText();
  }

  private layoutText() {
    const { w, h } = this.baked;
    const maxW = w - this.padX * 2;
    const hasCat = !!this.category.text;
    this.category.visible = hasCat;
    const catH = hasCat ? 26 : 0;
    const b = this.baseFont;
    this.label.style.lineHeight = 0;
    fit(this.label, maxW, h - 28 - catH, [b, b * 0.88, b * 0.78, b * 0.7, b * 0.62, b * 0.55]);
    this.label.style.lineHeight = Math.round(Number(this.label.style.fontSize) * 1.22);
    const total = catH + this.label.height;
    const top = (h - total) / 2;
    this.category.position.set(w / 2, top);
    this.label.position.set(w / 2, top + catH);
  }
}

export class AnswerBox {
  readonly baked: Baked<HexState>;
  readonly badge: Baked;
  readonly label = text({ fontSize: 26, fontWeight: '600', wordWrap: true, lineHeight: 0 });
  removed = false;
  private pt = 40;

  constructor(readonly index: number, onTap: (i: number) => void, onHover: (i: number, on: boolean) => void) {
    const letter = 'ABCD'[index];
    this.baked = new Baked(100, 78, 26, (ctx, s, r) => drawHex(ctx, this.baked.w, this.baked.h, this.pt, s, r), ['n', 'hover', 'sel', 'ok', 'bad']);
    this.badge = new Baked(62, 52, 10, (ctx, _s, r) => {
      ctx.beginPath();
      ctx.moveTo(0, 26); ctx.lineTo(15.5, 0); ctx.lineTo(46.5, 0); ctx.lineTo(62, 26); ctx.lineTo(46.5, 52); ctx.lineTo(15.5, 52);
      ctx.closePath();
      const g = ctx.createRadialGradient(24, 15, 2, 31, 26, 40);
      g.addColorStop(0, '#ff6ab4');
      g.addColorStop(0.7, '#ef1677');
      g.addColorStop(1, '#d10c64');
      ctx.fillStyle = g;
      glow(ctx, 'rgba(255,45,138,0.7)', 8, r);
      ctx.fill();
      noGlow(ctx);
      ctx.font = font(700, 30);
      ctx.fillStyle = C.white;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(letter, 31, 28);
    });
    this.label.anchor.set(0, 0.5);
    const v = this.baked.view;
    v.addChild(this.badge.view, this.label);
    v.eventMode = 'static';
    v.cursor = 'pointer';
    v.on('pointertap', () => onTap(index));
    v.on('pointerover', (e: FederatedPointerEvent) => { if (e.pointerType === 'mouse') onHover(index, true); });
    v.on('pointerout', () => onHover(index, false));
  }

  get view() { return this.baked.view; }
  get state() { return this.baked.state; }
  setState(s: HexState) { this.baked.setState(s); }

  place(x: number, y: number, w: number, h: number, pt: number) {
    this.pt = pt;
    this.view.position.set(x, y);
    this.view.hitArea = hexHit(w, h, pt);
    this.baked.resize(w, h);
    this.baked.invalidate();
    this.badge.view.position.set(pt + 6, (h - 52) / 2);
    this.layoutText();
  }

  set(label: string) {
    this.label.text = label;
    this.removed = false;
    this.label.alpha = 1;
    this.badge.view.alpha = 1;
    this.layoutText();
  }

  remove() {
    this.removed = true;
    this.label.alpha = 0;
    this.badge.view.alpha = 0.3;
    this.view.cursor = 'default';
  }

  setInteractive(on: boolean) {
    this.view.cursor = on && !this.removed ? 'pointer' : 'default';
  }

  private layoutText() {
    const { w, h } = this.baked;
    const x = this.pt + 6 + 62 + 24;
    const maxW = w - x - this.pt - 4;
    this.label.style.lineHeight = 0;
    fit(this.label, maxW, h - 10, [26, 23, 21, 19, 17, 15]);
    this.label.style.lineHeight = Math.round(Number(this.label.style.fontSize) * 1.15);
    this.label.position.set(x, h / 2);
    this.label.style.fill = this.baked.state === 'sel' ? '#2a1200' : '#ffffff';
  }

  refreshColor() {
    this.label.style.fill = this.baked.state === 'sel' ? '#2a1200' : '#ffffff';
  }
}

/** Doğru / yanlış / süre doldu rozeti. */
export type Verdict = 'ok' | 'bad' | 'time';
const VERDICT: Record<Verdict, { fill: string; glow: string; label: string }> = {
  ok: { fill: '#0b9a52', glow: 'rgba(46,224,138,0.7)', label: 'DOĞRU!' },
  bad: { fill: '#b5122a', glow: 'rgba(255,60,80,0.7)', label: 'YANLIŞ' },
  time: { fill: '#b5122a', glow: 'rgba(255,60,80,0.7)', label: 'SÜRE DOLDU' },
};

export function verdictChip() {
  const chip: Baked<Verdict> = new Baked<Verdict>(150, 40, 18, (ctx, s, r) => {
    const v = VERDICT[s];
    const { w, h } = chip;
    pillPath(ctx, 0, 0, w, h, 10);
    ctx.fillStyle = v.fill;
    glow(ctx, v.glow, 14, r);
    ctx.fill();
    noGlow(ctx);
    ctx.font = font(800, h * (s === 'time' ? 0.38 : 0.43));
    ctx.fillStyle = C.white;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(v.label, w / 2, h / 2 + 1);
    ctx.textAlign = 'left';
  }, ['ok', 'bad', 'time']);
  return chip;
}
