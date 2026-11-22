// Etkileşimli parçalar: düğmeler, soru kutusu, cevap şıkları.
import { CanvasTextMetrics, Container, Graphics, Polygon, Rectangle, Sprite, TextStyle, type FederatedPointerEvent, type TextStyleOptions } from 'pixi.js';
import { cancel, ease, tween } from '../tween';
import { Baked, text } from './bake';
import { C, font, glow, hexPath, icon, neonPill, noGlow, pillPath, type IconName } from './draw';

type Hot = 0 | 1;

/**
 * Çok durumlu düğme; her (görünüm × üzerinde) çifti ayrı dokuya pişirilir. Geçişler anlık
 * değil: üzerine gelme dokusu yumuşakça belirir, görünüm değişiminde eski doku söner, basınca
 * düğme hafifçe içe göçer. `lift` verilirse fareyle üzerine gelince o oranda büyür.
 */
export class Button<V extends string = 'n'> {
  readonly baked: Baked<`${V}:${Hot}`>;
  private variant: V;
  private hot: Hot = 0;
  enabled = true;
  /** Taban dokunun üstünde, alfası tween'lenen "üzerinde" dokusu. */
  private readonly hotSprite = new Sprite();
  /** Görünüm değişirken eski dokuyu gösterip söndüren kopya. */
  private readonly ghost = new Sprite();
  private readonly ring = new Graphics();
  private readonly keys = { hot: {}, hover: {}, press: {}, pop: {}, ghost: {}, ring: {} };
  private readonly k = { hover: 1, press: 1, pop: 1 };
  private readonly lift: number;

  constructor(
    w: number,
    h: number,
    variants: V[],
    draw: (ctx: CanvasRenderingContext2D, w: number, h: number, variant: V, hot: boolean, r: number) => void,
    onTap: () => void,
    pad = 22,
    opts: { lift?: number } = {},
  ) {
    this.variant = variants[0];
    this.lift = opts.lift ?? 0;
    const states = variants.flatMap((v) => [`${v}:0`, `${v}:1`] as `${V}:${Hot}`[]);
    this.baked = new Baked(w, h, pad, (ctx, s, r) => {
      const [v, hot] = s.split(':') as [V, string];
      draw(ctx, this.baked.w, this.baked.h, v, hot === '1', r);
    }, states);
    this.baked.onBaked = () => this.syncTextures();
    for (const s of [this.hotSprite, this.ghost]) s.position.copyFrom(this.baked.sprite.position);
    this.hotSprite.alpha = 0;
    this.ghost.visible = false;
    this.ring.visible = false;
    const view = this.baked.view;
    view.addChildAt(this.ring, 0);
    view.addChild(this.hotSprite, this.ghost);
    view.eventMode = 'static';
    view.cursor = 'pointer';
    view.hitArea = new Rectangle(0, 0, w, h);
    view.on('pointerover', (e: FederatedPointerEvent) => { if (e.pointerType === 'mouse') this.setHot(1); });
    view.on('pointerout', () => { this.setHot(0); this.press(false); });
    view.on('pointerdown', () => this.press(true));
    view.on('pointerup', () => this.press(false));
    view.on('pointerupoutside', () => this.press(false));
    view.on('pointertap', () => { if (this.enabled) onTap(); });
  }

  get view() { return this.baked.view; }

  private syncTextures() {
    this.hotSprite.texture = this.baked.texture(`${this.variant}:1`);
  }

  private applyScale() {
    this.view.scale.set(this.k.hover * this.k.press * this.k.pop);
  }

  /** Ölçek bileşenlerinden birini yumuşakça hedefe taşır. */
  private scaleTo(part: 'hover' | 'press' | 'pop', to: number, ms: number, e = ease.outCubic) {
    const from = this.k[part];
    tween(ms, (v) => { this.k[part] = from + (to - from) * v; this.applyScale(); }, { key: this.keys[part], ease: e });
  }

  /** animate: eski görünüm yerinde kısa bir süre sönerek yeni görünüme geçer. */
  setVariant(v: V, animate = false) {
    if (v === this.variant) return;
    if (animate) {
      this.ghost.texture = this.baked.texture(`${this.variant}:0`);
      this.ghost.visible = true;
      this.ghost.alpha = 1;
      tween(420, (t) => { this.ghost.alpha = 1 - t; }, { key: this.keys.ghost, ease: ease.inOutSine, done: () => { this.ghost.visible = false; } });
    }
    this.variant = v;
    this.baked.setState(`${v}:0`);
    this.syncTextures();
  }

  private setHot(h: Hot) {
    const hot: Hot = this.enabled ? h : 0;
    if (hot === this.hot) return;
    this.hot = hot;
    const from = this.hotSprite.alpha;
    tween(hot ? 160 : 240, (v) => { this.hotSprite.alpha = from + (hot - from) * v; }, { key: this.keys.hot });
    if (this.lift) this.scaleTo('hover', hot ? 1 + this.lift : 1, hot ? 220 : 260, hot ? ease.outBack : ease.outCubic);
  }

  private press(down: boolean) {
    if (down && !this.enabled) return;
    if (down) this.scaleTo('press', 0.94, 90);
    else if (this.k.press !== 1) this.scaleTo('press', 1, 320, ease.outBack);
  }

  /** Düğme kullanıldı: kısa bir "pop" ve dışa doğru yayılıp sönen ışık halkası. */
  burst(color = 0xff4f9a) {
    const from = this.k.pop;
    tween(520, (v) => { this.k.pop = from + (1 - from) * v + 0.16 * Math.sin(v * Math.PI) * (1 - v * 0.4); this.applyScale(); }, { key: this.keys.pop, ease: ease.outCubic });
    const { w, h } = this.baked;
    const g = this.ring;
    g.clear()
      .roundRect(-w / 2, -h / 2, w, h, h / 2).stroke({ width: 3, color, alpha: 1 })
      .roundRect(-w / 2 - 5, -h / 2 - 5, w + 10, h + 10, h / 2 + 5).stroke({ width: 6, color, alpha: 0.25 });
    g.position.set(w / 2, h / 2);
    g.visible = true;
    tween(620, (v) => {
      g.scale.set(1 + 0.32 * v, 1 + 0.6 * v);
      g.alpha = 1 - v;
    }, { key: this.keys.ring, ease: ease.outCubic, done: () => { g.visible = false; } });
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    this.view.cursor = on ? 'pointer' : 'default';
    if (!on) { this.setHot(0); this.press(false); }
  }

  /** Ölçek animasyonları ortadan olsun diye pivot düğmenin merkezindedir. */
  place(x: number, y: number, w: number, h: number) {
    this.view.pivot.set(w / 2, h / 2);
    this.view.position.set(x + w / 2, y + h / 2);
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
  n: { edge: ['#5f86e6', '#6878e8', '#7d6fe0'], fill: ['#1a1b60', '#0c0e3c', '#15115a'], glow: 'rgba(90,130,255,0.85)', blur: 12 },
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

/**
 * Havuzdaki metinlerin hepsinin kutuya sığdığı en büyük yazı boyutu. Boyut soruya göre
 * değil havuza göre seçildiği için oyun boyunca her soruda aynı kalır.
 */
export function uniformSize(samples: string[], base: TextStyleOptions, maxW: number, maxH: number, sizes: number[], lineK: number): number {
  for (const size of sizes) {
    const style = new TextStyle({
      fontFamily: 'Poppins', ...base, fontSize: size, wordWrap: true, wordWrapWidth: maxW, lineHeight: Math.round(size * lineK),
    });
    const fits = samples.every((t) => {
      const m = CanvasTextMetrics.measureText(t, style);
      return m.height <= maxH && m.width <= maxW + 1;
    });
    if (fits) return size;
  }
  return sizes[sizes.length - 1];
}

/** Taban boyuttan küçülen aday boyutlar. */
export const steps = (b: number, k: number[]) => k.map((f) => Math.round(b * f));

export class QuestionBox {
  readonly baked: Baked;
  readonly category = text({ fontSize: 15, fontWeight: '600', fill: C.cyan, letterSpacing: 4.5 });
  static readonly STYLE: TextStyleOptions = { fontWeight: '700', align: 'center' };
  static readonly LINE = 1.22;
  static readonly CAT_H = 26;
  readonly label = text({ ...QuestionBox.STYLE, fontSize: 35, wordWrap: true });
  readonly content = new Container();
  private pt = 66;
  private padX = 120;
  baseFont = 35;
  /** Oyun boyunca sabit yazı boyutu (Scene.refitText belirler). */
  fontSize = 35;

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

  /** Soru metninin sığması gereken alan (kategori satırı her zaman hesaba katılır). */
  get textArea() {
    return { w: this.baked.w - this.padX * 2, h: this.baked.h - 28 - QuestionBox.CAT_H };
  }

  setFontSize(size: number) {
    this.fontSize = size;
    this.layoutText();
  }

  private layoutText() {
    const { w, h } = this.baked;
    const hasCat = !!this.category.text;
    this.category.visible = hasCat;
    const catH = hasCat ? QuestionBox.CAT_H : 0;
    this.label.style.fontSize = this.fontSize;
    this.label.style.wordWrapWidth = this.textArea.w;
    this.label.style.lineHeight = Math.round(this.fontSize * QuestionBox.LINE);
    const total = catH + this.label.height;
    const top = (h - total) / 2;
    this.category.position.set(w / 2, top);
    this.label.position.set(w / 2, top + catH);
  }
}

export class AnswerBox {
  readonly baked: Baked<HexState>;
  readonly badge: Baked;
  static readonly STYLE: TextStyleOptions = { fontWeight: '600' };
  static readonly LINE = 1.15;
  static readonly SIZES = [26, 24, 23, 21, 19, 17, 15];
  readonly label = text({ ...AnswerBox.STYLE, fontSize: 26, wordWrap: true });
  removed = false;
  private pt = 40;
  private letter: string;
  /** Elenme animasyonunda metnin üstünü çizen çizgi. */
  private readonly strike = new Graphics();
  private readonly fx = {};
  private baseX = 0;
  /** Oyun boyunca sabit yazı boyutu (Scene.refitText belirler). */
  fontSize = 26;

  constructor(readonly index: number, onTap: (i: number) => void, onHover: (i: number, on: boolean) => void) {
    this.letter = 'ABCD'[index];
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
      ctx.fillText(this.letter, 31, 28);
    });
    this.label.anchor.set(0, 0.5);
    this.strike.visible = false;
    const v = this.baked.view;
    v.addChild(this.badge.view, this.label, this.strike);
    v.eventMode = 'static';
    v.cursor = 'pointer';
    v.on('pointertap', () => onTap(index));
    v.on('pointerover', (e: FederatedPointerEvent) => { if (e.pointerType === 'mouse') onHover(index, true); });
    v.on('pointerout', () => onHover(index, false));
  }

  get view() { return this.baked.view; }
  get state() { return this.baked.state; }
  setState(s: HexState) { this.baked.setState(s); }

  /** Açıklama ekranındaki kopyalar için: rozetteki harfi değiştirir. */
  setLetter(l: string) {
    if (l === this.letter) return;
    this.letter = l;
    this.badge.invalidate();
  }

  place(x: number, y: number, w: number, h: number, pt: number) {
    if (pt !== this.pt) this.baked.invalidate(); // boyut değişimini resize zaten yakalar
    this.pt = pt;
    this.baseX = x;
    this.view.position.set(x, y);
    this.view.hitArea = hexHit(w, h, pt);
    this.baked.resize(w, h);
    this.badge.view.position.set(pt + 6, (h - 52) / 2);
    this.layoutText();
  }

  set(label: string) {
    cancel(this.fx);
    this.label.text = label;
    this.removed = false;
    this.label.alpha = 1;
    this.badge.view.alpha = 1;
    this.view.alpha = 1;
    this.view.x = this.baseX;
    this.strike.visible = false;
    this.layoutText();
  }

  /**
   * Şıkkı eler: metnin üstü soldan sağa çizilir, kutu kısa bir titreşimle sarsılır, ardından
   * metin söner ve kutu soluklaşır. delay ile birden çok şık sırayla elenir.
   */
  remove(delay = 0) {
    cancel(this.fx);
    this.removed = true;
    this.view.cursor = 'default';
    const s = this.strike;
    const len = Math.min(this.label.width, this.textArea.w) + 16;
    s.clear().roundRect(0, -1.5, len, 3, 1.5).fill({ color: 0xff5a8c });
    s.position.set(this.textX - 8, this.baked.h / 2);
    s.scale.x = 0;
    s.alpha = 1;
    s.visible = true;
    tween(720, (t) => {
      const a = Math.min(1, t / 0.4); // çizgi ilerler
      const b = ease.inOutSine(Math.max(0, (t - 0.35) / 0.65)); // her şey söner
      s.scale.x = ease.outCubic(a);
      this.view.x = this.baseX + Math.sin(a * Math.PI * 3) * 5 * (1 - a);
      this.label.alpha = 1 - b;
      s.alpha = 1 - b;
      this.badge.view.alpha = 1 - 0.7 * b;
      this.view.alpha = 1 - 0.4 * b;
    }, { key: this.fx, delay, ease: ease.linear, done: () => { s.visible = false; } });
  }

  setInteractive(on: boolean) {
    this.view.cursor = on && !this.removed ? 'pointer' : 'default';
  }

  private get textX() { return this.pt + 6 + 62 + 24; }

  /** Şık metninin sığması gereken alan. */
  get textArea() {
    return { w: this.baked.w - this.textX - this.pt - 4, h: this.baked.h - 10 };
  }

  setFontSize(size: number) {
    this.fontSize = size;
    this.layoutText();
  }

  private layoutText() {
    const { h } = this.baked;
    this.label.style.fontSize = this.fontSize;
    this.label.style.wordWrapWidth = this.textArea.w;
    this.label.style.lineHeight = Math.round(this.fontSize * AnswerBox.LINE);
    this.label.position.set(this.textX, h / 2);
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

/** Cevaptan sonra gelen açıklama kartı; çerçeve rengi sonuca göre (yeşil / kırmızı). */
const CARD_EDGE: Record<Verdict, { edge: string; glow: string }> = {
  ok: { edge: '#3cf09a', glow: 'rgba(46,224,138,0.75)' },
  bad: { edge: '#ff5868', glow: 'rgba(255,60,80,0.75)' },
  time: { edge: '#ff5868', glow: 'rgba(255,60,80,0.75)' },
};

export function feedbackCard() {
  const card: Baked<Verdict> = new Baked<Verdict>(1085, 130, 30, (ctx, s, r) => {
    const S = CARD_EDGE[s];
    const { w, h } = card;
    ctx.beginPath();
    ctx.roundRect(1.5, 1.5, w - 3, h - 3, 22);
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(26,30,100,0.96)');
    g.addColorStop(1, 'rgba(11,13,52,0.96)');
    ctx.fillStyle = g;
    glow(ctx, S.glow, 22, r);
    ctx.fill();
    noGlow(ctx);
    glow(ctx, S.glow, 10, r);
    ctx.strokeStyle = S.edge;
    ctx.lineWidth = 2.6;
    ctx.stroke();
    noGlow(ctx);
  }, ['ok', 'bad', 'time']);
  return card;
}
