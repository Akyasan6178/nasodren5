// Sahne montajı: tüm görsel parçaları oluşturur ve seçilen yerleşime göre konumlar.
import { Container, Graphics, type Text } from 'pixi.js';
import { Background } from './background';
import { Baked, text } from './bake';
import { createChrome } from './chrome';
import { C, font, glow, noGlow } from './draw';
import { HeadArt } from './head';
import type { Layout } from './layout';
import { ReviewPanel, WHY_LINE, type ReviewAction, type ReviewRow } from './review';
import { TimerClock } from './timer';
import { AnswerBox, Button, QuestionBox, neonButton, pinkButton, steps, uniformSize, type Verdict } from './widgets';
import type { Lifeline } from '../quiz';

export interface SceneHandlers {
  onNew(): void;
  onSound(): void;
  onFull(): void;
  onLifeline(k: Lifeline): void;
  onAnswer(i: number): void;
  onHover(i: number, on: boolean): void;
  onConfirm(): void;
  onNext(): void;
  onModal(): void;
  onMulti(): void;
  onPause(): void;
  onHome(): void;
}

export type ActionMode = 'hints' | 'confirm' | 'feedback' | 'none';

/** Yazı boyutu hesabı için oyundaki tüm metinler. */
export interface TextPool { questions: string[]; answers: string[]; explanations: string[] }


export class Scene {
  readonly root = new Container();
  readonly bg = new Background();
  layout: Layout;

  private readonly chrome: Baked;
  readonly btnNew: Button;
  readonly btnSound: Button<'on' | 'off'>;
  readonly btnFull: Button;
  readonly btnPause: Button;
  readonly lifelines: Record<Lifeline, Button<'n' | 'used'>>;
  readonly counter: Text;
  readonly tagline: Text;
  readonly question = new QuestionBox();
  readonly answers: AnswerBox[];
  readonly board = new Container();
  readonly confirm: Button;
  /** Cevap sonrası açıklama ekranı. */
  readonly review: ReviewPanel;
  private pool: TextPool = { questions: [], answers: [], explanations: [] };
  readonly head: HeadArt;
  readonly timer = new TimerClock();
  readonly percent: Text;

  readonly modal = new Container();
  private readonly dim = new Graphics();
  private readonly card: Baked;
  readonly mEyebrow: Text;
  readonly mTitle: Text;
  readonly mScore: Text;
  readonly mBody: Text;
  readonly mNew: Button<'n' | 'start' | 'resume'>;
  /** Çok oyunculu mod ("Kim Nefes Almak İster?") sunucu ekranına geçer. */
  readonly mMulti: Button;
  /** Mola penceresinden başlangıç ekranına dönüş. */
  readonly mHome: Button;

  constructor(layout: Layout, h: SceneHandlers) {
    this.layout = layout;
    this.chrome = createChrome(() => this.layout);

    this.btnNew = new Button(190, 56, ['n'], neonButton('Yeni oyun', 'refresh', 20), h.onNew);
    this.btnSound = new Button(64, 56, ['on', 'off'], neonButton('', (v) => (v === 'off' ? 'mute' : 'speaker'), 20), h.onSound);
    this.btnFull = new Button(64, 56, ['n'], neonButton('', 'fullscreen', 20), h.onFull);
    this.btnPause = new Button(64, 56, ['n'], neonButton('', 'pause', 20), h.onPause);
    const ll = (label: string, ic: 'people' | 'bulb' | 'double', k: Lifeline) =>
      new Button(140, 56, ['n', 'used'], neonButton(label, ic, 17, { badge: true }), () => h.onLifeline(k), 26, { lift: 0.05 });
    this.lifelines = { fifty: ll('50:50', 'people', 'fifty'), hint: ll('İpucu', 'bulb', 'hint'), double: ll('Çift cevap', 'double', 'double') };

    this.counter = text({ fontSize: 24, fontWeight: '700', letterSpacing: 1 });
    this.counter.anchor.set(0.5);
    this.tagline = text({ fontSize: 21, fill: C.muted, align: 'center', wordWrap: true });
    this.tagline.anchor.set(0.5, 0);

    this.answers = [0, 1, 2, 3].map((i) => new AnswerBox(i, h.onAnswer, h.onHover));
    this.board.addChild(this.question.view, ...this.answers.map((a) => a.view));

    this.confirm = new Button(200, 44, ['n'], pinkButton({ n: 'Cevabı onayla' }, 19), h.onConfirm);
    this.review = new ReviewPanel(h.onNext);

    this.head = new HeadArt(360, 600);
    this.percent = text({
      fontSize: 82,
      fontWeight: '800',
      fill: C.cyan,
      dropShadow: { color: C.cyan, blur: 8, distance: 0, alpha: 0.3, angle: 0 },
      padding: 24,
    }, '%0');
    this.percent.anchor.set(0.5);

    // sonuç penceresi
    this.card = new Baked(660, 400, 40, (ctx, _s, r) => {
      const { w, h: ch } = this.card;
      ctx.beginPath();
      ctx.roundRect(0, 0, w, ch, 28);
      const g = ctx.createLinearGradient(0, 0, 0, ch);
      g.addColorStop(0, '#191c62');
      g.addColorStop(1, '#0c0e3a');
      ctx.fillStyle = g;
      glow(ctx, 'rgba(60,220,255,0.6)', 34, r);
      ctx.fill();
      noGlow(ctx);
      ctx.strokeStyle = C.cyan;
      ctx.lineWidth = 3;
      glow(ctx, 'rgba(60,220,255,0.9)', 12, r);
      ctx.stroke();
      noGlow(ctx);
      ctx.font = font(400, 1);
    });
    this.mEyebrow = text({ fontSize: 17, fontWeight: '500', fill: C.lav, letterSpacing: 5 });
    this.mTitle = text({ fontSize: 56, fontWeight: '900', fill: C.pink2 });
    this.mScore = text({ fontSize: 30, fontWeight: '700' });
    this.mBody = text({ fontSize: 19, fill: C.muted, align: 'center', wordWrap: true, wordWrapWidth: 540, lineHeight: 28 });
    for (const t of [this.mEyebrow, this.mTitle, this.mScore, this.mBody]) t.anchor.set(0.5, 0);
    this.mNew = new Button(220, 58, ['n', 'start', 'resume'], pinkButton({ n: 'Yeni oyun', start: 'Başla', resume: 'Devam et' }, 22), h.onModal);
    this.mMulti = new Button(220, 58, ['n'], neonButton('Çok oyunculu', 'people', 19), h.onMulti);
    this.mHome = new Button(220, 58, ['n'], neonButton('Ana menü', 'home', 19), h.onHome);
    this.card.view.addChild(this.mEyebrow, this.mTitle, this.mScore, this.mBody, this.mNew.view, this.mMulti.view, this.mHome.view);
    this.dim.eventMode = 'static'; // alttaki öğelere tıklamayı engeller
    this.modal.addChild(this.dim, this.card.view);
    this.modal.visible = false;

    this.root.addChild(
      this.bg.view,
      this.chrome.view,
      this.head.view,
      this.percent,
      this.timer.view,
      this.btnNew.view,
      this.btnSound.view,
      this.btnFull.view,
      this.btnPause.view,
      ...Object.values(this.lifelines).map((b) => b.view),
      this.counter,
      this.tagline,
      this.board,
      this.confirm.view,
      this.review.view,
      this.modal,
    );
    this.applyLayout(layout);
    this.setActionMode('hints');
  }

  /** Görünür alan (tasarım koordinatlarında) değişince çağrılır. */
  setViewport(vx: number, vy: number, vw: number, vh: number) {
    this.bg.setViewport(this.layout, vx, vy, vw, vh);
    this.review.setViewport(vx, vy, vw, vh);
    this.dim.clear().rect(vx, vy, vw, vh).fill({ color: 0x080319, alpha: 0.66 });
  }

  applyLayout(L: Layout) {
    const changed = L !== this.layout;
    this.layout = L;
    if (changed) this.chrome.invalidate();
    this.chrome.resize(L.W, L.H);

    const put = (b: { place(x: number, y: number, w: number, h: number): void }, r: { x: number; y: number; w: number; h: number }) => b.place(r.x, r.y, r.w, r.h);
    put(this.btnNew, L.btnNew);
    put(this.btnSound, L.btnSound);
    put(this.btnFull, L.btnFull);
    put(this.btnPause, L.btnPause);
    this.btnPause.baked.invalidate();
    put(this.lifelines.fifty, L.lifelines[0]);
    put(this.lifelines.hint, L.lifelines[1]);
    put(this.lifelines.double, L.lifelines[2]);
    for (const b of Object.values(this.lifelines)) b.baked.invalidate();

    this.counter.position.set(L.counter.x + L.counter.w / 2, L.counter.y + L.counter.h / 2 + 1);
    this.counter.style.fontSize = L.portrait ? 25 : 24;
    this.tagline.position.set(L.tagline.x + L.tagline.w / 2, L.tagline.y);
    this.tagline.style.wordWrapWidth = L.tagline.w;
    this.tagline.style.fontSize = L.portrait ? 22 : 21;

    const q = L.question;
    this.question.place(q.x, q.y, q.w, q.h, q.pt, q.padX, q.font);
    L.answers.forEach((a, i) => this.answers[i].place(a.x, a.y, a.w, a.h, L.answerPt));
    this.refitText();

    put(this.confirm, L.confirm);
    this.confirm.baked.invalidate();
    this.review.next.baked.invalidate();

    this.timer.place(L.timer.cx, L.timer.cy, L.timer.r);
    this.head.view.position.set(L.head.x, L.head.y);
    this.head.resize(L.head.w, L.head.h);
    this.percent.position.set(L.percent.cx, L.percent.cy);
    this.percent.style.fontSize = L.percent.size;

    const M = L.modal;
    this.card.view.position.set(M.cx - M.w / 2, M.cy - M.h / 2);
    this.card.resize(M.w, M.h);
    this.card.invalidate();
    const cx = M.w / 2;
    this.mEyebrow.position.set(cx, 44);
    this.mTitle.position.set(cx, 70);
    this.mScore.position.set(cx, 150);
    this.mBody.position.set(cx, 200);
    this.mBody.style.wordWrapWidth = M.w - 100;
    this.placeModalButtons();
    this.mMulti.baked.invalidate();
    this.mHome.baked.invalidate();
  }

  private modalKind: 'menu' | 'pause' = 'menu';

  /** menu: Başla/Yeni oyun + Çok oyunculu; pause: Devam et + Ana menü. */
  setModalKind(kind: 'menu' | 'pause') {
    this.modalKind = kind;
    this.placeModalButtons();
  }

  private placeModalButtons() {
    const M = this.layout.modal;
    const cx = M.w / 2;
    const pause = this.modalKind === 'pause';
    this.mMulti.view.visible = !pause;
    this.mHome.view.visible = pause;
    this.mNew.place(cx - 230, M.h - 96, 220, 58);
    (pause ? this.mHome : this.mMulti).place(cx + 10, M.h - 96, 220, 58);
  }


  setActionMode(m: ActionMode) {
    this.confirm.view.visible = m === 'confirm';
    this.review.view.visible = m === 'feedback';
  }

  // ---------- yazı boyutları ----------

  /** Oyunun soru havuzu değişince çağrılır; yazı boyutları tüm havuza göre bir kez seçilir. */
  setTextPool(pool: TextPool) {
    this.pool = pool;
    this.refitText();
  }

  /** Soru, şık ve açıklama yazıları için sorudan soruya değişmeyen tek bir boyut seçer. */
  private refitText() {
    const qb = this.question;
    const qa = qb.textArea;
    const qSize = this.pool.questions.length
      ? uniformSize(this.pool.questions, QuestionBox.STYLE, qa.w, qa.h, steps(qb.baseFont, [1, 0.94, 0.88, 0.82, 0.76, 0.7, 0.64, 0.58]), QuestionBox.LINE)
      : qb.baseFont;
    qb.setFontSize(qSize);

    // en dar şık kutusu belirleyicidir; dört şık da aynı boyutu kullanır
    const aw = Math.min(...this.answers.map((a) => a.textArea.w));
    const ah = Math.min(...this.answers.map((a) => a.textArea.h));
    const aSize = this.pool.answers.length
      ? uniformSize(this.pool.answers, AnswerBox.STYLE, aw, ah, AnswerBox.SIZES, AnswerBox.LINE)
      : AnswerBox.SIZES[0];
    for (const a of this.answers) a.setFontSize(aSize);
    this.review.setLayout(this.layout, aSize);

    // açıklamalar en fazla `lines` satıra sığacak tek bir boyutla yazılır
    const { font: f, lines } = this.layout.feedback;
    const maxH = Math.ceil(f * 1.45 + (lines - 1) * f * WHY_LINE) + 2;
    const eSize = this.pool.explanations.length
      ? uniformSize(this.pool.explanations, {}, this.review.whyWidth, maxH, steps(f, [1, 0.95, 0.9, 0.85, 0.8, 0.75, 0.7]), WHY_LINE)
      : f;
    this.review.setWhyFont(eSize);
  }

  /** Cevap açıklandı: açıklama ekranı ortada açılır. */
  setFeedback(verdict: Verdict, rows: ReviewRow[], action: ReviewAction) {
    this.review.show(verdict, rows, action);
  }

  update(dt: number) {
    this.head.update(dt);
  }
}
