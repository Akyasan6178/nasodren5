// Sahne montajı: tüm görsel parçaları oluşturur ve seçilen yerleşime göre konumlar.
import { Container, Graphics, type Text } from 'pixi.js';
import { Background } from './background';
import { Baked, text } from './bake';
import { createChrome, createKeyHints } from './chrome';
import { C, font, glow, noGlow } from './draw';
import { HeadArt } from './head';
import type { Layout } from './layout';
import { TimerClock } from './timer';
import { AnswerBox, Button, QuestionBox, neonButton, pinkButton, verdictChip, type Verdict } from './widgets';
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
}

export type ActionMode = 'hints' | 'confirm' | 'feedback' | 'none';

export class Scene {
  readonly root = new Container();
  readonly bg = new Background();
  layout: Layout;

  private readonly chrome: Baked;
  private readonly keyHints: Baked;
  readonly btnNew: Button;
  readonly btnSound: Button<'on' | 'off'>;
  readonly btnFull: Button;
  readonly lifelines: Record<Lifeline, Button<'n' | 'used'>>;
  readonly counter: Text;
  readonly tagline: Text;
  readonly question = new QuestionBox();
  readonly answers: AnswerBox[];
  readonly board = new Container();
  readonly confirm: Button;
  readonly next: Button<'next' | 'result'>;
  readonly verdict = verdictChip();
  readonly explain: Text;
  readonly feedback = new Container();
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
  readonly mNew: Button<'n' | 'start'>;

  constructor(layout: Layout, h: SceneHandlers) {
    this.layout = layout;
    this.chrome = createChrome(() => this.layout);
    this.keyHints = createKeyHints();

    this.btnNew = new Button(190, 56, ['n'], neonButton('Yeni oyun', 'refresh', 20), h.onNew);
    this.btnSound = new Button(64, 56, ['on', 'off'], neonButton('', (v) => (v === 'off' ? 'mute' : 'speaker'), 20), h.onSound);
    this.btnFull = new Button(64, 56, ['n'], neonButton('', 'fullscreen', 20), h.onFull);
    const ll = (label: string, ic: 'people' | 'bulb' | 'skip', k: Lifeline) =>
      new Button(140, 56, ['n', 'used'], neonButton(label, ic, 17, { badge: true }), () => h.onLifeline(k), 26);
    this.lifelines = { fifty: ll('50:50', 'people', 'fifty'), hint: ll('İpucu', 'bulb', 'hint'), skip: ll('Soruyu geç', 'skip', 'skip') };

    this.counter = text({ fontSize: 24, fontWeight: '700', letterSpacing: 1 });
    this.counter.anchor.set(0.5);
    this.tagline = text({ fontSize: 21, fill: C.muted, align: 'center', wordWrap: true });
    this.tagline.anchor.set(0.5, 0);

    this.answers = [0, 1, 2, 3].map((i) => new AnswerBox(i, h.onAnswer, h.onHover));
    this.board.addChild(this.question.view, ...this.answers.map((a) => a.view));

    this.confirm = new Button(200, 44, ['n'], pinkButton({ n: 'Cevabı onayla' }, 19), h.onConfirm);
    this.next = new Button(200, 46, ['next', 'result'], pinkButton({ next: 'Sonraki soru  →', result: 'Sonucu gör  →' }, 19), h.onNext);
    this.explain = text({ fontSize: 16, fill: C.muted, wordWrap: true, lineHeight: 21 });
    this.explain.anchor.set(0, 0.5);
    this.feedback.addChild(this.verdict.view, this.explain, this.next.view);

    this.head = new HeadArt(360, 600);
    this.percent = text({
      fontSize: 82,
      fontWeight: '800',
      fill: C.cyan,
      dropShadow: { color: C.cyan, blur: 14, distance: 0, alpha: 0.85, angle: 0 },
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
    this.mNew = new Button(220, 58, ['n', 'start'], pinkButton({ n: 'Yeni oyun', start: 'Başla' }, 22), h.onModal);
    this.card.view.addChild(this.mEyebrow, this.mTitle, this.mScore, this.mBody, this.mNew.view);
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
      ...Object.values(this.lifelines).map((b) => b.view),
      this.counter,
      this.tagline,
      this.board,
      this.keyHints.view,
      this.confirm.view,
      this.feedback,
      this.modal,
    );
    this.applyLayout(layout);
    this.setActionMode('hints');
  }

  /** Görünür alan (tasarım koordinatlarında) değişince çağrılır. */
  setViewport(vx: number, vy: number, vw: number, vh: number) {
    this.bg.setViewport(this.layout, vx, vy, vw, vh);
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
    put(this.lifelines.fifty, L.lifelines[0]);
    put(this.lifelines.hint, L.lifelines[1]);
    put(this.lifelines.skip, L.lifelines[2]);
    for (const b of Object.values(this.lifelines)) b.baked.invalidate();

    this.counter.position.set(L.counter.x + L.counter.w / 2, L.counter.y + L.counter.h / 2 + 1);
    this.counter.style.fontSize = L.portrait ? 25 : 24;
    this.tagline.position.set(L.tagline.x + L.tagline.w / 2, L.tagline.y);
    this.tagline.style.wordWrapWidth = L.tagline.w;
    this.tagline.style.fontSize = L.portrait ? 22 : 21;

    const q = L.question;
    this.question.place(q.x, q.y, q.w, q.h, q.pt, q.padX, q.font);
    L.answers.forEach((a, i) => this.answers[i].place(a.x, a.y, a.w, a.h, L.answerPt));

    this.keyHints.view.position.set(L.action.cx - 310, L.action.cy - 20);
    put(this.confirm, L.confirm);
    this.confirm.baked.invalidate();
    const F = L.feedback;
    this.verdict.view.position.set(F.verdict.x, F.verdict.y);
    this.verdict.resize(F.verdict.w, F.verdict.h);
    this.explain.style.fontSize = F.font;
    this.explain.style.lineHeight = Math.round(F.font * 1.32);
    this.explain.style.wordWrapWidth = F.explain.w;
    this.explain.position.set(F.explain.x, F.explain.y + F.explain.h / 2);
    if (L.portrait) {
      this.explain.anchor.set(0.5, 0.5);
      this.explain.style.align = 'center';
      this.explain.x = F.explain.x + F.explain.w / 2;
    } else {
      this.explain.anchor.set(0, 0.5);
      this.explain.style.align = 'left';
    }
    put(this.next, F.next);
    this.next.baked.invalidate();

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
    this.mNew.place(cx - 110, M.h - 96, 220, 58);
  }

  setActionMode(m: ActionMode) {
    this.keyHints.view.visible = m === 'hints' && !this.layout.portrait;
    this.confirm.view.visible = m === 'confirm';
    this.feedback.visible = m === 'feedback';
  }

  /** Açıklama yoksa rozet ve düğme ortalanır. */
  setFeedback(verdict: Verdict, explanation: string, last: boolean) {
    this.verdict.setState(verdict);
    this.explain.text = explanation;
    this.next.setVariant(last ? 'result' : 'next');
    const F = this.layout.feedback;
    if (this.layout.portrait) {
      const gap = 16;
      const total = F.verdict.w + gap + F.next.w;
      const x0 = (this.layout.W - total) / 2;
      const y = explanation ? F.verdict.y : F.verdict.y - 30;
      this.verdict.view.position.set(x0, y);
      this.next.view.position.set(x0 + F.verdict.w + gap, y);
    }
  }

  update(dt: number) {
    this.bg.update(dt);
    this.head.update(dt);
  }
}
