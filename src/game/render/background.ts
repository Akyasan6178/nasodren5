// Arka plan: gradyan, siklamen yaprakları, ışık hüzmeleri (tek doku) + parıldayan noktalar.
import { Container, Sprite, Texture, CanvasSource } from 'pixi.js';
import { Baked } from './bake';
import type { Layout } from './layout';

// Siklamen yaprağı: tabanı (0,0), ucu yukarıda (0,-1) olan kıvrık damla.
function petal(ctx: CanvasRenderingContext2D, x: number, y: number, len: number, wid: number, rot: number, alpha: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(-wid, -len * 0.25, -wid * 0.9, -len * 0.75, wid * 0.12, -len);
  ctx.bezierCurveTo(wid * 0.75, -len * 0.7, wid * 0.85, -len * 0.25, 0, 0);
  ctx.closePath();
  const g = ctx.createLinearGradient(0, 0, 0, -len);
  g.addColorStop(0, `rgba(205, 40, 140, ${alpha})`);
  g.addColorStop(0.55, `rgba(120, 24, 110, ${alpha * 0.75})`);
  g.addColorStop(1, `rgba(70, 16, 90, ${alpha * 0.2})`);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = `rgba(255, 110, 190, ${alpha * 0.35})`;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  // orta damar
  ctx.beginPath();
  ctx.moveTo(0, -len * 0.05);
  ctx.quadraticCurveTo(-wid * 0.1, -len * 0.5, wid * 0.08, -len * 0.92);
  ctx.strokeStyle = `rgba(255, 140, 210, ${alpha * 0.18})`;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

export class Background {
  readonly view = new Container();
  private readonly art: Baked;
  private readonly sparkles: Sprite[] = [];
  private readonly phase: Float32Array;
  private readonly speed: Float32Array;
  private layout!: Layout;
  private vx = 0;
  private vy = 0;
  private time = 0;

  constructor(count = 46) {
    this.art = new Baked(1, 1, 0, (ctx, _s, r) => this.draw(ctx, r));
    this.view.addChild(this.art.view);
    const dot = dotTexture();
    this.phase = new Float32Array(count);
    this.speed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const s = new Sprite(dot);
      s.anchor.set(0.5);
      s.tint = i % 3 === 0 ? 0x6fe6ff : i % 3 === 1 ? 0xff7ac4 : 0xc9a8ff;
      this.phase[i] = Math.random() * Math.PI * 2;
      this.speed[i] = 0.6 + Math.random() * 1.4;
      this.sparkles.push(s);
      this.view.addChild(s);
    }
  }

  /** vx..vh: görünür alanın tasarım koordinatlarındaki karşılığı (letterbox dahil). */
  setViewport(layout: Layout, vx: number, vy: number, vw: number, vh: number) {
    const changed = layout !== this.layout;
    this.layout = layout;
    this.vx = vx;
    this.vy = vy;
    this.art.view.position.set(vx, vy);
    this.art.resize(Math.ceil(vw), Math.ceil(vh));
    this.art.invalidate();
    if (changed) {
      // Noktalar yalnızca sol/oyun alanına ve başlık çevresine serpilir.
      const W = layout.portrait ? layout.W : layout.panel.x;
      for (const s of this.sparkles) {
        s.position.set(Math.random() * W, 90 + Math.random() * (layout.H - 140));
        s.scale.set(0.12 + Math.random() * 0.22);
      }
    }
  }

  update(dt: number) {
    this.time += dt / 1000;
    for (let i = 0; i < this.sparkles.length; i++) {
      this.sparkles[i].alpha = 0.15 + 0.75 * (0.5 + 0.5 * Math.sin(this.time * this.speed[i] + this.phase[i]));
    }
  }

  private draw(ctx: CanvasRenderingContext2D, r: number) {
    const L = this.layout;
    const w = this.art.w;
    const h = this.art.h;
    // taban gradyan
    const base = ctx.createLinearGradient(0, 0, w * 0.4, h);
    base.addColorStop(0, '#1d0a3c');
    base.addColorStop(0.55, '#130628');
    base.addColorStop(1, '#0a0420');
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);

    ctx.translate(-this.vx, -this.vy);
    const { cx, cy, s } = L.petals;

    const glowAt = (x: number, y: number, rad: number, color: string) => {
      const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
      g.addColorStop(0, color);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    };
    glowAt(cx, cy - 120 * s, 620 * s, 'rgba(110, 22, 110, 0.55)');
    glowAt(L.portrait ? 120 : 90, L.portrait ? 1250 : 700, 420, 'rgba(90, 18, 100, 0.45)');
    glowAt(cx + 260 * s, cy - 280 * s, 300 * s, 'rgba(60, 40, 140, 0.35)');

    // büyük siklamen çiçeği (başlığın arkasında)
    ctx.save();
    ctx.filter = `blur(${1.2 * r}px)`;
    const fx = cx + 10 * s;
    const fy = cy + 10 * s;
    petal(ctx, fx, fy, 330 * s, 120 * s, -0.08, 0.62);
    petal(ctx, fx + 10 * s, fy, 320 * s, 120 * s, 0.55, 0.55);
    petal(ctx, fx - 10 * s, fy, 300 * s, 115 * s, -0.75, 0.55);
    petal(ctx, fx + 20 * s, fy, 290 * s, 110 * s, 1.1, 0.42);
    petal(ctx, fx - 20 * s, fy, 270 * s, 105 * s, -1.25, 0.38);
    petal(ctx, fx + 230 * s, fy - 30 * s, 220 * s, 80 * s, 0.75, 0.25);
    // sol alttaki yapraklar
    const lx = L.portrait ? 60 : 70;
    const ly = L.portrait ? 1180 : 660;
    petal(ctx, lx, ly, 260, 90, -0.2, 0.32);
    petal(ctx, lx + 10, ly, 230, 85, 0.6, 0.26);
    petal(ctx, lx + 160, ly + 230, 210, 75, 0.2, 0.2);
    ctx.restore();

    // ışık hüzmeleri
    ctx.save();
    const sy = L.portrait ? 470 : 300;
    const sw = L.portrait ? 900 : 1190;
    const streak = ctx.createLinearGradient(0, 0, sw, 0);
    streak.addColorStop(0, 'rgba(255,63,164,0)');
    streak.addColorStop(0.35, 'rgba(255,63,164,0.75)');
    streak.addColorStop(0.7, 'rgba(65,217,255,0.7)');
    streak.addColorStop(1, 'rgba(65,217,255,0)');
    ctx.strokeStyle = streak;
    ctx.shadowColor = 'rgba(255,90,190,0.9)';
    ctx.shadowBlur = 10 * r;
    ctx.lineCap = 'round';
    for (const [dy, lw, a] of [[0, 2, 0.55], [32, 1.2, 0.35], [-18, 0.8, 0.25]] as const) {
      ctx.globalAlpha = a;
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.moveTo(-40, sy + dy);
      ctx.bezierCurveTo(sw * 0.2, sy - 60 + dy, sw * 0.3, sy + 30 + dy, sw * 0.48, sy - 10 + dy);
      ctx.bezierCurveTo(sw * 0.66, sy - 50 + dy, sw * 0.8, sy - 120 + dy, sw + 40, sy - 70 + dy);
      ctx.stroke();
    }
    ctx.restore();

    // bokeh
    ctx.save();
    ctx.filter = `blur(${3 * r}px)`;
    const bokeh: [number, number, number, string][] = L.portrait
      ? [[90, 1500, 26, 'rgba(255,80,170,.25)'], [820, 960, 18, 'rgba(120,90,255,.22)'], [150, 640, 14, 'rgba(255,80,170,.2)']]
      : [[60, 820, 30, 'rgba(255,80,170,.22)'], [260, 860, 18, 'rgba(255,80,170,.18)'], [1100, 840, 22, 'rgba(120,90,255,.2)'], [980, 120, 12, 'rgba(255,80,170,.2)']];
    for (const [x, y, rad, c] of bokeh) {
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(x, y, rad, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

/** Yumuşak parıltı noktası; bulanık olduğu için ölçekten bağımsız, bir kez üretilir. */
function dotTexture(): Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.18, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.25)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new Texture({ source: new CanvasSource({ resource: c }) });
}
