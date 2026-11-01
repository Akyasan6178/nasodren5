// Sinüs kanalları göstergesi: neon yüz çizimi + iltihap (pembe) ve açılma (camgöbeği) katmanları.
// İlerleme arttıkça pembe bulutlar söner, sinüsler camgöbeğiyle "temizlenir".
import { Container } from 'pixi.js';
import { Baked } from './bake';
import { glow, noGlow } from './draw';

// Çizim 400 genişlikli koordinatlarda; görünür kırpım (x, y, w, h) paneli dolduracak şekilde seçildi.
const VB = { w: 400, crop: { x: 26, y: 56, w: 348, h: 540 } };

// Yüzün sol yarısı; sağ yarı aynalanarak çizilir. Göz ve burun konumları referans
// görseldeki oranlara göre (public/img/etmoid sinus.png) yerleştirildi.
const HALF = {
  ear: 'M66 262 C 46 246 30 262 34 292 C 38 324 52 346 76 352',
  earIn: 'M52 282 C 46 294 50 314 60 324',
  neck: 'M134 452 C 138 492 136 522 124 548 C 102 562 68 574 30 586',
  lidFold: 'M88 274 C 106 262 138 262 158 274',
  lid: 'M91 287 C 106 301 138 303 154 289',
  bridge: 'M194 262 C 193 300 190 340 180 372',
  nostril: 'M180 372 C 165 378 164 397 183 396 C 189 402 197 403 200 402',
};
const HEAD = 'M200 70 C 290 70 336 140 338 232 C 340 300 326 352 302 398 C 276 446 240 474 200 476 C 160 474 124 446 98 398 C 74 352 60 300 62 232 C 64 140 110 70 200 70 Z';
const LIPS = 'M170 432 C 184 424 193 422 200 426 C 207 422 216 424 230 432 C 215 444 185 444 170 432 Z';
const LIP_LINE = 'M170 432 C 187 436 213 436 230 432';

// Sinüs şekilleri public/img altındaki görsellerin konturlarından üretildi
// (frontal_sol/sag, maxillary_sol/sag ayrı görsellerden; etmoidler referans yüzdeki mavi bölgelerden).
// "sol" izleyicinin solundaki, "sag" sağındaki sinüstür; iki yan birbirinin aynası değildir.
const SINUS = {
  frontalSol: 'M180.2 214 C178.2 214.1 175.9 214.9 174.1 216.1 C172.3 217.4 170.9 219.7 169.4 221.5 C167.8 223.3 166.4 225.3 164.7 226.9 C162.9 228.5 160.7 229.4 158.8 230.9 C156.9 232.3 155.2 234 153.4 235.5 C151.7 237 150.1 238.4 148.4 239.7 C146.7 241 145 242.2 143.3 243.2 C141.7 244.3 139.4 244.7 138.3 246 C137.2 247.4 136.2 249.7 136.8 251.3 C137.3 252.9 139.8 254.9 141.8 255.8 C143.9 256.7 146.6 256.6 149 256.6 C151.4 256.5 153.7 255.7 156.1 255.4 C158.5 255.2 161.1 254.7 163.4 255 C165.8 255.3 168.2 256 170.2 257 C172.3 258 174.4 259.3 175.7 261.1 C177 262.8 177.5 265.3 177.9 267.4 C178.3 269.5 177 272.3 178 273.7 C179 275 181.8 275.1 183.8 275.5 C185.9 275.8 188.5 276.4 190.5 275.9 C192.5 275.4 195 274.3 196 272.6 C197 270.8 196.7 267.7 196.6 265.4 C196.5 263 195.5 260.7 195.3 258.4 C195.1 256.1 195.5 253.9 195.5 251.7 C195.4 249.5 195.4 247.3 195.1 245.1 C194.8 242.8 194.1 240.6 193.8 238.3 C193.4 236.1 193.1 234 193.2 231.8 C193.3 229.5 194.7 227.1 194.5 225 C194.3 222.9 193.5 220.6 192.1 219.1 C190.8 217.6 188.4 216.8 186.5 215.9 C184.5 215.1 182.3 214 180.2 214Z',
  frontalSag: 'M217.2 218.1 C215.3 218.2 213.2 219.2 211.4 220.1 C209.6 221 207.6 221.8 206.4 223.4 C205.3 224.9 204.7 227.3 204.7 229.4 C204.6 231.5 205.8 233.7 205.9 235.8 C206 238 205.6 240.1 205.3 242.2 C205 244.4 204.3 246.6 204 248.7 C203.8 250.8 203.8 252.9 203.8 255.1 C203.7 257.2 203.9 259.3 203.8 261.5 C203.6 263.7 202.8 266.1 202.7 268.3 C202.7 270.6 202.5 273.5 203.6 275.1 C204.6 276.7 207 277.6 208.9 278 C210.8 278.3 213.2 277.7 215 277.2 C216.8 276.8 219.2 276.5 220 275.2 C220.8 273.8 219.6 271 219.9 269 C220.3 267 220.9 264.6 222.2 263 C223.4 261.4 225.5 260.2 227.4 259.3 C229.4 258.4 231.6 257.7 233.7 257.6 C235.9 257.4 238.2 257.9 240.4 258.1 C242.6 258.4 244.8 259.2 247 259.2 C249.1 259.2 251.7 259.1 253.5 258.2 C255.3 257.3 257.4 255.1 257.8 253.6 C258.2 252 256.9 250.1 255.8 248.8 C254.7 247.5 252.8 247 251.3 246 C249.7 244.9 248.1 243.9 246.5 242.6 C244.9 241.4 243.5 239.8 241.9 238.4 C240.3 236.9 238.7 235.3 237 233.9 C235.2 232.6 233.1 231.6 231.6 230.1 C230 228.6 228.8 226.5 227.4 224.8 C226 223 224.6 220.9 222.9 219.8 C221.2 218.7 219.1 218.1 217.2 218.1Z',
  ethmoidSol: 'M177.6 279.6 C176.6 279.7 175.6 280 174.6 280.3 C173.6 280.6 172.5 280.9 171.6 281.5 C170.7 282 169.9 282.6 169.2 283.4 C168.5 284.1 168 285.1 167.7 286.1 C167.4 287 167.2 288 167.1 289.1 C167.1 290.1 167.4 291.1 167.5 292.1 C167.7 293.2 168 294.3 167.9 295.3 C167.8 296.3 167.5 297.3 167.1 298.3 C166.7 299.3 166 300.1 165.6 301.1 C165.3 302.1 165 303.1 164.9 304.2 C164.8 305.2 164.8 306.3 165 307.4 C165.2 308.4 165.6 309.4 165.9 310.4 C166.3 311.4 166.9 312.3 167.3 313.2 C167.7 314.2 168.2 315.2 168.4 316.2 C168.6 317.2 168.6 318.3 168.4 319.3 C168.3 320.4 167.9 321.4 167.6 322.4 C167.4 323.4 167 324.5 167 325.4 C167 326.4 167.2 327.6 167.7 328.4 C168.2 329.2 169 330 169.8 330.3 C170.7 330.6 171.8 330.7 172.7 330.4 C173.6 330 174.4 329.2 175.1 328.4 C175.9 327.7 176.4 326.7 177.1 325.9 C177.8 325.1 178.6 324.4 179.4 323.8 C180.2 323.2 181.2 322.7 182.1 322.3 C183.1 321.8 184.2 321.7 185 321.1 C185.8 320.6 186.6 319.9 187 319.1 C187.5 318.2 187.6 317.1 187.7 316 C187.8 314.9 187.8 313.7 187.7 312.6 C187.6 311.5 187.4 310.5 187.3 309.4 C187.3 308.3 187.4 307.3 187.4 306.2 C187.5 305.1 187.7 304.1 187.7 302.9 C187.8 301.8 187.8 300.7 187.8 299.6 C187.8 298.4 187.8 297.3 187.7 296.2 C187.7 295 187.7 293.9 187.5 292.9 C187.2 291.8 186.8 290.9 186.5 289.9 C186.2 288.9 186 287.8 185.7 286.8 C185.5 285.7 185.4 284.6 185 283.7 C184.6 282.7 184.1 281.8 183.4 281.1 C182.7 280.5 181.7 280.1 180.8 279.8 C179.8 279.6 178.7 279.5 177.6 279.6Z',
  ethmoidSag: 'M219.9 278.4 C219 278.7 218 279.3 217.5 280 C216.9 280.8 216.8 281.9 216.8 282.8 C216.8 283.8 217.4 284.8 217.6 285.8 C217.8 286.8 218.2 287.8 218.2 288.8 C218.2 289.8 217.8 290.9 217.6 291.9 C217.4 293 217.2 294 217.1 295.1 C217 296.2 217 297.3 217 298.4 C217 299.5 217 300.7 217 301.8 C217.1 302.9 217.1 304 217.3 305.1 C217.5 306.1 217.9 307.1 218.1 308.1 C218.2 309.1 218.2 310.2 218 311.2 C217.8 312.3 217.3 313.2 217 314.2 C216.7 315.2 216.5 316.3 216.3 317.3 C216 318.3 215.8 319.4 215.6 320.4 C215.5 321.4 215.2 322.4 215.3 323.4 C215.5 324.4 216 325.4 216.6 326.2 C217.2 327 218.1 327.7 219 328.3 C219.8 328.9 220.8 329.3 221.8 329.7 C222.7 330 223.8 330.2 224.9 330.2 C225.9 330.3 227.1 330.2 228.1 330 C229.1 329.8 230.1 329.4 231 328.9 C231.9 328.4 232.8 327.8 233.5 327 C234.1 326.2 234.6 325.3 234.9 324.3 C235.2 323.3 235.2 322.2 235.1 321.2 C235 320.2 234.5 319.2 234.2 318.2 C233.9 317.2 233.6 316.2 233.4 315.2 C233.3 314.1 233.4 312.9 233.3 311.8 C233.2 310.7 233.3 309.6 233 308.6 C232.7 307.5 232.3 306.6 231.8 305.7 C231.3 304.8 230.6 303.9 230.1 303 C229.6 302.1 229.1 301.2 228.9 300.1 C228.6 299.1 228.6 298 228.7 296.9 C228.8 295.9 229.1 294.8 229.3 293.8 C229.6 292.8 230 291.8 230.1 290.8 C230.3 289.7 230.4 288.7 230.3 287.7 C230.2 286.6 229.9 285.6 229.5 284.6 C229.2 283.7 228.7 282.7 228.1 281.9 C227.4 281 226.6 280.2 225.8 279.6 C224.9 279.1 223.9 278.7 222.9 278.4 C221.9 278.2 220.8 278.1 219.9 278.4Z',
  maxillarySol: 'M100.1 315.4 C97.7 315.8 95.2 316.6 93.6 318.3 C92.1 319.9 91.8 322.7 90.9 325 C90 327.2 89 329.5 88.2 331.9 C87.5 334.2 86.8 336.7 86.5 339.3 C86.2 341.9 86.4 344.9 86.4 347.7 C86.5 350.4 86 353.5 86.6 356 C87.1 358.5 88.2 361.3 90 362.5 C91.8 363.7 95 362.9 97.4 363 C99.8 363 102.5 361.8 104.5 362.8 C106.6 363.7 108 366.7 109.8 368.7 C111.5 370.6 113 373.1 115 374.7 C117.1 376.3 119.5 377.7 122 378.3 C124.5 379 127.8 379.3 130 378.6 C132.1 377.9 133.1 375.2 134.8 373.8 C136.5 372.4 138.7 371.7 140.4 370.2 C142.2 368.7 143.7 366.8 145.3 364.8 C146.9 362.9 148.3 360.4 150.2 358.6 C152.2 356.8 154.6 355.6 156.8 354 C158.9 352.5 161.7 351.3 163.2 349.4 C164.6 347.5 165.2 344.8 165.3 342.5 C165.4 340.2 165 337.4 163.9 335.4 C162.8 333.5 160.5 331.8 158.5 330.7 C156.4 329.7 154 329.5 151.5 329 C149.1 328.4 146.4 327.8 143.9 327.5 C141.4 327.2 139 327.7 136.7 327.2 C134.4 326.7 132.4 325.3 130.1 324.3 C127.8 323.4 125.2 322.5 122.9 321.4 C120.5 320.3 118.3 318.8 115.9 317.8 C113.5 316.8 111 316 108.4 315.6 C105.7 315.2 102.6 314.9 100.1 315.4Z',
  maxillarySag: 'M294.2 314 C291.5 314.1 288.7 315 286.2 316.2 C283.7 317.4 281.7 319.5 279.4 321.1 C277.1 322.7 274.8 324.5 272.3 325.7 C269.8 326.9 267.1 327.6 264.3 328.3 C261.6 329 258.6 329.5 256 330 C253.4 330.5 251.1 330.8 248.7 331.3 C246.2 331.7 243.5 331.9 241.4 333 C239.3 334 238.2 336.3 236.2 337.3 C234.1 338.4 230.7 337.9 229.1 339.3 C227.5 340.7 226.3 343.5 226.5 345.6 C226.8 347.7 228.8 350.3 230.8 351.8 C232.7 353.4 235.9 353.9 238.4 355.1 C240.9 356.4 243.5 357.5 245.6 359.3 C247.6 361 249 363.4 250.6 365.5 C252.2 367.6 253.3 370.1 255.2 371.9 C257.1 373.8 259.5 375.6 262 376.5 C264.6 377.3 268 377.7 270.6 377.2 C273.2 376.8 275.4 375.2 277.6 373.9 C279.8 372.7 281.7 371.1 284 369.8 C286.2 368.6 289.2 368.1 291 366.4 C292.8 364.7 293.4 361.7 295 359.7 C296.6 357.8 298.5 355.9 300.7 354.7 C303 353.5 306.8 354 308.5 352.5 C310.1 350.9 310.5 347.9 310.8 345.4 C311.2 342.9 311.6 339.7 310.7 337.4 C309.9 335.2 307.5 333.9 305.8 332.1 C304.2 330.2 301.3 328.4 301 326.5 C300.6 324.5 303.4 322.3 303.6 320.4 C303.9 318.6 303.8 316.6 302.2 315.5 C300.6 314.4 296.9 313.9 294.2 314Z',
};
const NOSE_TIP = { x: 200, y: 386, r: 26 };

type Path = keyof typeof HALF;

function mirrored(ctx: CanvasRenderingContext2D, fn: () => void) {
  fn();
  ctx.save();
  ctx.translate(VB.w, 0);
  ctx.scale(-1, 1);
  fn();
  ctx.restore();
}

function sinusClip() {
  const p = new Path2D();
  for (const d of Object.values(SINUS)) p.addPath(new Path2D(d));
  return p;
}

// Tekrar pişirmelerde aynı görüntü için sabit tohumlu rastgele.
function rng(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
}

export class HeadArt {
  readonly view = new Container();
  private readonly base: Baked;
  private readonly clear: Baked;
  private readonly inflamed: Baked;
  private progress = 0;
  private time = 0;

  constructor(w: number, h: number) {
    const fit = (ctx: CanvasRenderingContext2D, bw: number, bh: number) => {
      const c = VB.crop;
      const s = Math.min(bw / c.w, bh / c.h);
      ctx.translate((bw - c.w * s) / 2, (bh - c.h * s) / 2);
      ctx.scale(s, s);
      ctx.translate(-c.x, -c.y);
      return s;
    };
    const PAD = 30;
    this.clear = new Baked(w, h, PAD, (ctx, _s, r) => { const s = fit(ctx, this.clear.w, this.clear.h); this.drawClear(ctx, r * s); });
    this.inflamed = new Baked(w, h, PAD, (ctx, _s, r) => { const s = fit(ctx, this.inflamed.w, this.inflamed.h); this.drawInflamed(ctx, r * s); });
    this.base = new Baked(w, h, PAD, (ctx, _s, r) => { const s = fit(ctx, this.base.w, this.base.h); this.drawBase(ctx, r * s); });
    this.view.addChild(this.clear.view, this.inflamed.view, this.base.view);
    this.setProgress(0);
  }

  resize(w: number, h: number) {
    this.base.resize(w, h);
    this.clear.resize(w, h);
    this.inflamed.resize(w, h);
  }

  setProgress(p: number) {
    this.progress = p;
    this.clear.view.alpha = p;
  }

  update(dt: number) {
    this.time += dt / 1000;
    // iltihap katmanı hafifçe "nabız" atar
    const pulse = 0.86 + 0.14 * Math.sin(this.time * 2.4);
    this.inflamed.view.alpha = (1 - this.progress) * pulse;
  }

  // ---------- çizim (yalnızca pişirmede) ----------

  private neon(ctx: CanvasRenderingContext2D, r: number, draw: () => void, width: number, color = '#3cdcff') {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // geniş, sönük hale + parlak çekirdek
    glow(ctx, 'rgba(60,220,255,0.9)', 16, r);
    ctx.strokeStyle = 'rgba(60,220,255,0.35)';
    ctx.lineWidth = width * 2.6;
    draw();
    glow(ctx, color, 6, r);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    draw();
    noGlow(ctx);
    ctx.strokeStyle = 'rgba(220,250,255,0.9)';
    ctx.lineWidth = width * 0.4;
    draw();
  }

  private drawBase(ctx: CanvasRenderingContext2D, r: number) {
    const stroke = (d: string) => ctx.stroke(new Path2D(d));
    const half = (k: Path) => mirrored(ctx, () => stroke(HALF[k]));

    // yüz içi koyu dolgu, kenarlarda mavi yansıma
    const face = new Path2D(HEAD);
    const fg = ctx.createRadialGradient(200, 280, 40, 200, 280, 260);
    fg.addColorStop(0, 'rgba(18,30,90,0.55)');
    fg.addColorStop(1, 'rgba(40,80,200,0.25)');
    ctx.fillStyle = fg;
    ctx.fill(face);

    this.neon(ctx, r, () => { ctx.stroke(face); half('ear'); half('neck'); }, 3.4, '#3f8dff');
    this.neon(ctx, r, () => { half('earIn'); half('lidFold'); half('lid'); half('bridge'); half('nostril'); stroke(LIPS); stroke(LIP_LINE); }, 2.4);
    // kirpikler
    this.neon(ctx, r, () => mirrored(ctx, () => {
      for (let i = 0; i < 5; i++) {
        const t = 0.15 + i * 0.17;
        const x = 91 + t * 63;
        const y = 288 + Math.sin(t * Math.PI) * 13;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - 2 + i, y + 7);
        ctx.stroke();
      }
    }), 1.6);
    // sinüs sınırları
    this.neon(ctx, r, () => { for (const d of Object.values(SINUS)) stroke(d); }, 2.6);
    // etmoid hava hücreleri: dış hattın içinde ince bölmeler
    for (const d of [SINUS.ethmoidSol, SINUS.ethmoidSag]) {
      const cell = new Path2D(d);
      ctx.save();
      ctx.clip(cell);
      this.neon(ctx, r, () => {
        for (let y = 291; y < 330; y += 11) {
          ctx.beginPath();
          ctx.moveTo(150, y);
          ctx.bezierCurveTo(175, y - 6, 205, y + 6, 250, y - 2);
          ctx.stroke();
        }
      }, 1.1);
      ctx.restore();
    }
  }

  private drawInflamed(ctx: CanvasRenderingContext2D, r: number) {
    const clip = sinusClip();
    // dış pembe hale
    glow(ctx, 'rgba(255,45,138,1)', 26, r);
    ctx.fillStyle = 'rgba(255,40,140,0.62)';
    ctx.fill(clip);
    ctx.fill(clip);
    noGlow(ctx);
    // içte bulutsu iltihap dokusu
    ctx.save();
    ctx.clip(clip);
    const rand = rng(7);
    for (let i = 0; i < 320; i++) {
      const x = 80 + rand() * 240;
      const y = 205 + rand() * 180;
      const rad = 6 + rand() * 18;
      const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
      const hot = rand() > 0.6;
      g.addColorStop(0, hot ? 'rgba(255,190,230,0.85)' : 'rgba(255,50,150,0.75)');
      g.addColorStop(1, 'rgba(255,40,140,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    ctx.restore();
    // burun ucu kızarıklığı
    const n = NOSE_TIP;
    const ng = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, n.r);
    ng.addColorStop(0, 'rgba(255,80,170,0.9)');
    ng.addColorStop(1, 'rgba(255,40,140,0)');
    ctx.fillStyle = ng;
    ctx.fillRect(n.x - n.r, n.y - n.r, n.r * 2, n.r * 2);
  }

  private drawClear(ctx: CanvasRenderingContext2D, r: number) {
    const clip = sinusClip();
    glow(ctx, 'rgba(60,220,255,0.9)', 18, r);
    ctx.fillStyle = 'rgba(60,220,255,0.28)';
    ctx.fill(clip);
    noGlow(ctx);
    ctx.save();
    ctx.clip(clip);
    // hava akışını çağrıştıran ince çizgiler
    ctx.strokeStyle = 'rgba(190,245,255,0.55)';
    ctx.lineWidth = 1.4;
    for (let y = 210; y < 385; y += 9) {
      ctx.beginPath();
      ctx.moveTo(90, y);
      ctx.bezierCurveTo(150, y - 8, 250, y + 8, 310, y);
      ctx.stroke();
    }
    ctx.restore();
  }
}
