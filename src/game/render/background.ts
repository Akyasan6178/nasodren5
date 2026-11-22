// Arka plan: koyu gradyan ve tek, yumuşak ışık; tek doku, hareketsiz (dikkat dağıtmasın diye).
import { Container } from 'pixi.js';
import { Baked } from './bake';
import type { Layout } from './layout';

export class Background {
  readonly view = new Container();
  private readonly art: Baked;
  private layout!: Layout;
  private vx = 0;
  private vy = 0;

  constructor() {
    this.art = new Baked(1, 1, 0, (ctx) => this.draw(ctx));
    this.view.addChild(this.art.view);
  }

  /** vx..vh: görünür alanın tasarım koordinatlarındaki karşılığı (letterbox dahil). */
  setViewport(layout: Layout, vx: number, vy: number, vw: number, vh: number) {
    this.layout = layout;
    this.vx = vx;
    this.vy = vy;
    this.art.view.position.set(vx, vy);
    this.art.resize(Math.ceil(vw), Math.ceil(vh));
    this.art.invalidate();
  }

  private draw(ctx: CanvasRenderingContext2D) {
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
    glowAt(cx, cy - 120 * s, 620 * s, 'rgba(90, 22, 100, 0.35)');
  }
}
