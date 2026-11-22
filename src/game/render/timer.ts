// Kronometre biçiminde süre göstergesi. 60 parçalı halka kalan süreyle söner;
// renk camgöbeğinden sarıya, sonra kırmızıya döner. Renk değişimi tint ile yapılır
// (yeniden çizim yok); yalnızca saniye değişince rakam yeniden çizilir.
import { Container, Sprite } from 'pixi.js';
import { Baked, text } from './bake';
import { C, glow, noGlow } from './draw';
import { ease, tween } from '../tween';

const R = 86; // tasarım yarıçapı; farklı boyutlar view ölçeğiyle elde edilir
const SEGMENTS = 60;
const RING = R - 17;

const CYAN = [0x3c, 0xdc, 0xff];
const YELLOW = [0xff, 0xc8, 0x3c];
const RED = [0xff, 0x3b, 0x4d];

function mix(a: number[], b: number[], t = 0) {
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * t));
  return (c[0] << 16) | (c[1] << 8) | c[2];
}

/** Kalan oran → renk: %50 üstü camgöbeği, %25–50 sarı, altı kırmızı (sınırlarda yumuşak geçiş). */
export function timerColor(f: number) {
  const band = 0.06;
  if (f > 0.5 + band) return mix(CYAN, CYAN);
  if (f > 0.5 - band) return mix(YELLOW, CYAN, (f - (0.5 - band)) / (band * 2));
  if (f > 0.25 + band) return mix(YELLOW, YELLOW);
  if (f > 0.25 - band) return mix(RED, YELLOW, (f - (0.25 - band)) / (band * 2));
  return mix(RED, RED);
}

export class TimerClock {
  readonly view = new Container();
  private readonly body = new Container();
  private readonly face: Baked;
  private readonly segTex: Baked;
  private readonly segs: Sprite[] = [];
  private readonly num = text({
    fontSize: 54,
    fontWeight: '800',
    fill: '#ffffff',
    dropShadow: { color: '#ffffff', blur: 8, distance: 0, alpha: 0.2, angle: 0 },
    padding: 20,
  }, '30');
  private readonly label = text({ fontSize: 13, fontWeight: '600', fill: C.lav, letterSpacing: 3 }, 'SÜRE');
  private lastSecond = -1;
  private readonly pulseKey = {};

  constructor() {
    this.face = new Baked(R * 2, R * 2, 34, (ctx, _s, r) => this.drawFace(ctx, r));
    this.segTex = new Baked(5, 13, 10, (ctx, _s, r) => {
      ctx.beginPath();
      ctx.roundRect(0, 0, 5, 13, 2.5);
      glow(ctx, 'rgba(255,255,255,0.95)', 7, r);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      noGlow(ctx);
    });
    this.segTex.onBaked = () => { for (const s of this.segs) s.texture = this.segTex.texture(); };
    // Segmentler pişmiş dokuyu paylaşır; dokunun kendi sprite'ı sahneye eklenmez.
    const ring = new Container();
    for (let i = 0; i < SEGMENTS; i++) {
      const a = (i / SEGMENTS) * Math.PI * 2;
      const s = new Sprite();
      s.anchor.set(0.5);
      s.position.set(R + Math.sin(a) * RING, R - Math.cos(a) * RING);
      s.rotation = a;
      this.segs.push(s);
      ring.addChild(s);
    }
    this.num.anchor.set(0.5);
    this.num.position.set(R, R - 6);
    this.label.anchor.set(0.5);
    this.label.position.set(R, R + 32);
    this.body.addChild(this.face.view, ring, this.num, this.label);
    this.body.pivot.set(R, R);
    this.view.addChild(this.body);
  }

  place(cx: number, cy: number, r: number) {
    this.view.position.set(cx, cy);
    this.view.scale.set(r / R);
  }

  /** left/total saniye cinsinden. */
  set(left: number, total: number) {
    const f = total > 0 ? Math.max(0, left / total) : 0;
    const lit = f * SEGMENTS;
    const color = timerColor(f);
    for (let i = 0; i < SEGMENTS; i++) {
      const s = this.segs[i];
      const a = Math.min(1, Math.max(0, lit - i));
      s.visible = a > 0;
      s.alpha = a;
      s.tint = color;
    }
    this.num.tint = color;
    const sec = Math.ceil(Math.max(0, left));
    if (sec !== this.lastSecond) {
      this.lastSecond = sec;
      this.num.text = String(sec);
      if (f <= 0.25 && sec > 0) {
        // son saniyelerde her saniye kısa bir nabız
        tween(380, (v) => this.body.scale.set(1 + 0.09 * Math.sin(v * Math.PI)), { key: this.pulseKey, ease: ease.linear });
      }
    }
  }

  private drawFace(ctx: CanvasRenderingContext2D, r: number) {
    const c = R;
    // kronometre kurma düğmesi ve yan düğmeler
    ctx.fillStyle = '#16195a';
    ctx.strokeStyle = C.cyan;
    ctx.lineWidth = 2.5;
    glow(ctx, 'rgba(60,220,255,0.8)', 8, r);
    ctx.beginPath(); ctx.roundRect(c - 6, -10, 12, 14, 3); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.roundRect(c - 15, -22, 30, 13, 5); ctx.fill(); ctx.stroke();
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.translate(c, c);
      ctx.rotate(side * 0.72);
      ctx.beginPath(); ctx.roundRect(-7, -R - 11, 14, 14, 3); ctx.fill(); ctx.stroke();
      ctx.restore();
    }
    // gövde
    ctx.beginPath();
    ctx.arc(c, c, R - 1.5, 0, Math.PI * 2);
    const g = ctx.createRadialGradient(c, c - 20, 10, c, c, R);
    g.addColorStop(0, '#22267a');
    g.addColorStop(1, '#0b0c36');
    ctx.fillStyle = g;
    glow(ctx, 'rgba(60,220,255,0.75)', 20, r);
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.stroke();
    noGlow(ctx);
    // söndürülmüş segment izi
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    for (let i = 0; i < SEGMENTS; i++) {
      const a = (i / SEGMENTS) * Math.PI * 2;
      ctx.save();
      ctx.translate(c + Math.sin(a) * RING, c - Math.cos(a) * RING);
      ctx.rotate(a);
      ctx.beginPath();
      ctx.roundRect(-2.5, -6.5, 5, 13, 2.5);
      ctx.fill();
      ctx.restore();
    }
    // iç çizgi
    ctx.beginPath();
    ctx.arc(c, c, R - 30, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(60,220,255,0.28)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}
