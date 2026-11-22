// Sinüs kanalları göstergesi. Altta yüz ve açılmış (kırmızımsı pembe) sinüsler, üstte iltihaplı (açık yeşil)
// katman durur. Her doğru cevapta dolu bölgeler kenarlarından içe doğru temizlenir.
//
// Yüz stilleri (adres satırında ?yuz=… ile denenebilir, varsayılan FACE_DEFAULT):
//   ten   — ten rengi, düz illüstrasyon (vektör, public/img/etmoid sinus.png referansıyla)
//   cizgi — koyu zeminde sade çizgi yüz (vektör)
//   neon  — oyun-tasarim.jpg'den kesilen neon yüz (public/img/sinus-yuz*.png)
import { CanvasSource, Container, Sprite, Texture } from 'pixi.js';
import { Baked } from './bake';
import { CROP, drawFaceBase, drawFaceInflamed, drawSinusGlow, openingOrder, type VectorFace } from './faces';

export type FaceStyle = VectorFace | 'neon';
export const FACE_DEFAULT: FaceStyle = 'ten';

const IMG = { inflamed: 'img/sinus-yuz.png', clear: 'img/sinus-yuz-acik.png', order: 'img/sinus-sira.png' };
/** Açılma cephesinin yumuşaklığı (sıra biriminde). */
const BAND = 0.07;
/** Vektör yüzlerde iltihap katmanının çözünürlüğü (çizim birimi başına piksel). */
const OVERLAY_RES = 2;

interface Art {
  /** İçeriğin çizim birimindeki boyutu. */
  w: number;
  h: number;
  /** Taban katmanı (yüz + açık sinüsler) çizim biriminde çizer. */
  drawBase(ctx: CanvasRenderingContext2D): void;
  /** Doğru cevapta parlayan katmanı çizer. */
  drawGlow(ctx: CanvasRenderingContext2D): void;
  /** İltihap katmanının çalışma tuvali; ilerleme değiştikçe saydamlığı güncellenir. */
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  pixels: ImageData;
  /** Tuval pikseli / çizim birimi. */
  k: number;
  /** Pembe alandaki piksellerin alfa dizini, açılma sırası ve özgün saydamlığı. */
  idx: Uint32Array;
  order: Float32Array;
  alpha: Uint8Array;
}
let art: Art | null = null;

function pickStyle(): FaceStyle {
  const q = new URLSearchParams(location.search).get('yuz');
  return q === 'ten' || q === 'cizgi' || q === 'neon' ? q : FACE_DEFAULT;
}

async function loadImage(url: string) {
  const img = new Image();
  img.src = url;
  await img.decode().catch(() => undefined);
  return img;
}

function canvas2d(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return { canvas: c, ctx: c.getContext('2d', { willReadFrequently: true })! };
}

function readPixels(img: HTMLImageElement) {
  const { canvas, ctx } = canvas2d(img.naturalWidth, img.naturalHeight);
  ctx.drawImage(img, 0, 0);
  return { canvas, ctx, data: ctx.getImageData(0, 0, canvas.width, canvas.height) };
}

async function loadNeon(base: string): Promise<Art | null> {
  const [inflamed, clear, orderImg] = await Promise.all([IMG.inflamed, IMG.clear, IMG.order].map((u) => loadImage(base + u)));
  if (!inflamed.naturalWidth || !clear.naturalWidth) return null;
  const inf = readPixels(inflamed);
  const idx: number[] = [];
  const order: number[] = [];
  const alpha: number[] = [];
  if (orderImg.naturalWidth === inflamed.naturalWidth && orderImg.naturalHeight === inflamed.naturalHeight) {
    const map = readPixels(orderImg).data.data;
    const px = inf.data.data;
    for (let i = 0; i < map.length; i += 4) {
      if (map[i + 1] === 0) continue; // pembe alan dışı
      idx.push(i + 3);
      order.push(map[i] / 255);
      alpha.push(px[i + 3]);
    }
  }
  return {
    w: inflamed.naturalWidth,
    h: inflamed.naturalHeight,
    drawBase: (ctx) => ctx.drawImage(clear, 0, 0),
    drawGlow: (ctx) => ctx.drawImage(clear, 0, 0),
    canvas: inf.canvas,
    ctx: inf.ctx,
    pixels: inf.data,
    k: 1,
    idx: Uint32Array.from(idx),
    order: Float32Array.from(order),
    alpha: Uint8Array.from(alpha),
  };
}

function buildVector(style: VectorFace): Art {
  const k = OVERLAY_RES;
  const { canvas, ctx } = canvas2d(CROP.w * k, CROP.h * k);
  ctx.scale(k, k);
  drawFaceInflamed(ctx, style);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const { idx, order } = openingOrder(pixels.data, canvas.width, canvas.height);
  const alpha = Uint8Array.from(idx, (i) => pixels.data[i]);
  return { w: CROP.w, h: CROP.h, drawBase: (c) => drawFaceBase(c, style), drawGlow: drawSinusGlow, canvas, ctx, pixels, k, idx, order, alpha };
}

/** Yüzü hazırlar; sahne kurulmadan çağrılmalı. */
export async function loadHeadArt(base: string) {
  const style = pickStyle();
  art = style === 'neon' ? await loadNeon(base) : buildVector(style);
}

export class HeadArt {
  readonly view = new Container();
  private readonly base: Baked;
  private readonly inflamed = new Sprite();
  /** Doğru cevapta açık sinüslerin kısa süre parlaması ("nefes"). */
  private readonly breath: Baked;
  private readonly source: CanvasSource | null = null;
  private box = { w: 0, h: 0 };
  private shown = -1;
  private flash = 0;

  constructor(w: number, h: number) {
    const layer = (draw: (a: Art, ctx: CanvasRenderingContext2D) => void) => (ctx: CanvasRenderingContext2D) => {
      if (!art) return;
      const f = this.fit();
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.translate(f.x, f.y);
      ctx.scale(f.s, f.s);
      draw(art, ctx);
    };
    this.base = new Baked(w, h, 0, layer((a, ctx) => a.drawBase(ctx)));
    this.breath = new Baked(w, h, 0, layer((a, ctx) => a.drawGlow(ctx)));
    if (art) {
      this.source = new CanvasSource({ resource: art.canvas });
      this.inflamed.texture = new Texture({ source: this.source });
    }
    this.breath.sprite.blendMode = 'add';
    this.breath.view.alpha = 0;
    this.view.addChild(this.base.view, this.breath.view, this.inflamed);
    this.resize(w, h);
    this.setProgress(0);
  }

  /** İçeriği kutuya oranını koruyarak ortalar. */
  private fit() {
    const w = art?.w ?? 1;
    const h = art?.h ?? 1;
    const s = Math.min(this.box.w / w, this.box.h / h);
    return { x: (this.box.w - w * s) / 2, y: (this.box.h - h * s) / 2, s };
  }

  resize(w: number, h: number) {
    this.box = { w, h };
    for (const b of [this.base, this.breath]) {
      b.resize(w, h);
      b.invalidate();
    }
    if (art) {
      const f = this.fit();
      this.inflamed.position.set(f.x, f.y);
      this.inflamed.scale.set(f.s / art.k);
    }
  }

  /** Doğru cevap verildi: açık sinüsler kısa bir an parlar. */
  pulse() {
    this.flash = 1;
  }

  /** p: doğru cevap oranı (0..1). İlk doğru cevaplar da belirgin görünsün diye eğri bükülür. */
  setProgress(p: number) {
    const v = Math.min(1, Math.max(0, p)) ** 0.6;
    if (!art || !this.source || Math.abs(v - this.shown) < 0.002) return;
    this.shown = v;
    const px = art.pixels.data;
    const front = v * (1 + BAND);
    for (let k = 0; k < art.idx.length; k++) {
      // cephenin gerisinde kalan pikseller açılmıştır (pembe katman saydam)
      const keep = Math.min(1, Math.max(0, (art.order[k] - front) / BAND + 1));
      px[art.idx[k]] = art.alpha[k] * keep;
    }
    art.ctx.putImageData(art.pixels, 0, 0);
    this.source.update();
  }

  update(dt: number) {
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt / 1600);
      this.breath.view.alpha = 0.5 * Math.sin(this.flash * Math.PI); // yükselip sönen parıltı
    }
  }
}
