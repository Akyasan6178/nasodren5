// "Pişirme": parıltı, gradyan ve blur gibi pahalı efektler Canvas2D ile bir kez
// dokuya çizilir. Karelerde GPU'ya yalnızca hazır doku gider, filtre çalışmaz.
// Ekran boyutu değişince tüm dokular yeni çözünürlükte yeniden pişirilir.
import { CanvasSource, Container, Sprite, Text, Texture, type TextStyleOptions } from 'pixi.js';

export type Draw<K extends string> = (ctx: CanvasRenderingContext2D, state: K, r: number) => void;

const bakedAll = new Set<Baked<string>>();
const dirty = new Set<Baked<string>>();
const textsAll = new Set<Text>();
let density = 1;

/** Tasarım biriminin cihaz pikseline oranı (yerleşim ölçeği × devicePixelRatio). */
export const getDensity = () => density;

/**
 * Durumlu, önceden çizilmiş görsel. `view` mantıksal dikdörtgenin sol üst köşesindedir;
 * parıltı payı (pad) kadar taşma doku içinde kalır.
 */
export class Baked<K extends string = 'n'> {
  readonly view = new Container();
  readonly sprite = new Sprite();
  private readonly textures = new Map<K, Texture>();
  private current: K;
  /** Doku yeniden pişirilince çağrılır (dokuyu paylaşan başka sprite'lar için). */
  onBaked?: () => void;

  constructor(
    public w: number,
    public h: number,
    private readonly pad: number,
    private readonly draw: Draw<K>,
    private readonly states: K[] = ['n' as K],
  ) {
    this.current = states[0];
    this.sprite.position.set(-pad, -pad);
    this.view.addChild(this.sprite);
    bakedAll.add(this as unknown as Baked<string>);
    this.invalidate();
  }

  /** Yeniden çizimi bir sonraki kareye erteler; aynı karedeki istekler birleşir. */
  invalidate() {
    dirty.add(this as unknown as Baked<string>);
  }

  get state(): K { return this.current; }

  setState(s: K) {
    if (s === this.current) return;
    this.current = s;
    this.sprite.texture = this.textures.get(s) ?? Texture.EMPTY;
  }

  /** Boyut değişen görseller için (ör. yönlendirme değişimi). */
  resize(w: number, h: number) {
    if (w === this.w && h === this.h) return;
    this.w = w;
    this.h = h;
    this.invalidate();
  }

  bake() {
    const r = density;
    const lw = Math.max(1, this.w + this.pad * 2);
    const lh = Math.max(1, this.h + this.pad * 2);
    for (const s of this.states) {
      // Kaynağı önce oluşturup sonra çiziyoruz: CanvasSource kesirli çözünürlükte canvas
      // boyutunu yeniden atar ve bu, önceden çizilmiş içeriği siler.
      const source = new CanvasSource({ width: lw, height: lh, resolution: r });
      const canvas = source.resource as HTMLCanvasElement;
      const ctx = canvas.getContext('2d')!;
      const sx = canvas.width / lw;
      ctx.setTransform(sx, 0, 0, canvas.height / lh, 0, 0);
      ctx.translate(this.pad, this.pad);
      this.draw(ctx, s, sx);
      source.update();
      const old = this.textures.get(s);
      this.textures.set(s, new Texture({ source }));
      old?.destroy(true);
    }
    this.sprite.texture = this.textures.get(this.current)!;
    this.onBaked?.();
  }

  texture(s: K = this.current): Texture {
    return this.textures.get(s) ?? Texture.EMPTY;
  }

  destroy() {
    bakedAll.delete(this as unknown as Baked<string>);
    dirty.delete(this as unknown as Baked<string>);
    for (const t of this.textures.values()) t.destroy(true);
    this.view.destroy({ children: true });
  }
}

/** Çözünürlüğü yerleşim ölçeğiyle birlikte güncellenen metin. */
export function text(style: TextStyleOptions, value = ''): Text {
  const t = new Text({ text: value, style: { fontFamily: 'Poppins', fill: '#ffffff', ...style }, resolution: density });
  textsAll.add(t);
  t.on('destroyed', () => textsAll.delete(t));
  return t;
}

export function setDensity(r: number) {
  if (Math.abs(r - density) < 0.01) return;
  density = r;
  for (const b of bakedAll) dirty.add(b);
  for (const t of textsAll) t.resolution = r;
}

/** Bekleyen tüm pişirmeleri yapar; çizimden hemen önce çağrılır. */
export function flushBakes() {
  if (!dirty.size) return;
  for (const b of dirty) b.bake();
  dirty.clear();
}
