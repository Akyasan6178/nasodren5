// Cevap sonrası açıklama ekranı: oyun alanı karartılır, ortadaki kartta şıklar alt alta durur.
// Yanlış cevapta önce seçilen (kırmızı) şık ve neden yanlış olduğu, altında doğru (yeşil) şık
// ve neden doğru olduğu yazar. Doğru cevapta ya da süre dolunca yalnızca doğru şık gösterilir.
// Çift cevap jokerinde ilk yanlış cevaptan sonra yalnızca yanlış şık ve açıklaması gelir.
import { Container, Graphics, Rectangle, type Text } from 'pixi.js';
import { text } from './bake';
import type { Layout } from './layout';
import { AnswerBox, Button, feedbackCard, pinkButton, verdictChip, type Verdict } from './widgets';
import { ease, tween } from '../tween';

export interface ReviewRow { letter: string; text: string; kind: 'ok' | 'bad'; why: string }
/** Kartın altındaki düğme: sonraki soru, sonuç ya da (çift cevap jokerinde) ikinci hak. */
export type ReviewAction = 'next' | 'result' | 'retry';

export const WHY_LINE = 1.32;
const PAD = 28;
const LABEL = { ok: { text: 'NEDEN DOĞRU?', fill: '#6ff0b0' }, bad: { text: 'NEDEN YANLIŞ?', fill: '#ff8f9a' } };

interface RowView { box: AnswerBox; label: Text; why: Text }

export class ReviewPanel {
  readonly view = new Container();
  private readonly dim = new Graphics();
  private readonly body = new Container();
  private readonly card = feedbackCard();
  private readonly chip = verdictChip();
  readonly next: Button<ReviewAction>;
  private readonly rows: RowView[];
  private layout!: Layout;
  private data: { verdict: Verdict; rows: ReviewRow[] } | null = null;
  private readonly key = {};

  constructor(onNext: () => void) {
    this.next = new Button(230, 52, ['next', 'result', 'retry'], pinkButton({ next: 'Sonraki soru  →', result: 'Sonucu gör  →', retry: 'Tekrar dene  →' }, 19), onNext);
    this.rows = [0, 1].map(() => {
      const box = new AnswerBox(0, () => {}, () => {});
      box.view.eventMode = 'none';
      const label = text({ fontSize: 15, fontWeight: '700', letterSpacing: 3 });
      const why = text({ fontSize: 21, fill: '#ece6ff', align: 'center', wordWrap: true });
      label.anchor.set(0.5, 0);
      why.anchor.set(0.5, 0);
      this.body.addChild(box.view, label, why);
      return { box, label, why };
    });
    this.dim.eventMode = 'static'; // alttaki şıklara ve düğmelere dokunmayı engeller
    this.card.view.eventMode = 'static';
    this.body.addChildAt(this.card.view, 0);
    this.body.addChild(this.chip.view, this.next.view);
    this.view.addChild(this.dim, this.body);
  }

  /** Açıklama metni için kullanılabilir genişlik (yazı boyutu hesabı için). */
  get whyWidth() { return this.boxWidth - 40; }
  private get boxWidth() { return this.layout.feedback.w - PAD * 2 - (this.layout.portrait ? 0 : 44); }

  setLayout(L: Layout, answerFont: number) {
    this.layout = L;
    for (const r of this.rows) {
      r.box.setFontSize(answerFont);
      r.label.style.fontSize = L.portrait ? 19 : 15;
      r.why.style.wordWrapWidth = this.whyWidth;
    }
    if (this.data) this.arrange();
  }

  setWhyFont(size: number) {
    for (const r of this.rows) {
      r.why.style.fontSize = size;
      r.why.style.lineHeight = Math.round(size * WHY_LINE);
    }
    if (this.data) this.arrange();
  }

  /** Oyun alanını karartır; sinüs paneli açık kalır ki doğru cevapta açılma görünsün. */
  setViewport(vx: number, vy: number, vw: number, vh: number) {
    const L = this.layout;
    const P = L.panel;
    const g = this.dim.clear();
    if (L.portrait) {
      // panelin üstü, altı ve iki yanı karartılır; panel açık kalır
      const top = P.y - 4;
      const bottom = P.y + P.h + 4;
      g.rect(vx, vy, vw, top - vy)
        .rect(vx, bottom, vw, vy + vh - bottom)
        .rect(vx, top, P.x - 4 - vx, bottom - top)
        .rect(P.x + P.w + 4, top, vx + vw - (P.x + P.w + 4), bottom - top);
    } else {
      g.rect(vx, vy, P.x - 4 - vx, vh);
    }
    g.fill({ color: 0x080319, alpha: 0.8 });
  }

  /** Kartı yumuşakça söndürür; bitince done çağrılır. */
  hide(done: () => void) {
    const a = this.view.alpha;
    const y = this.body.y;
    tween(220, (v) => {
      this.view.alpha = a * (1 - v);
      this.body.y = y + v * 12;
    }, { key: this.key, ease: ease.inOutSine, done: () => { this.body.y = y; done(); } });
  }

  show(verdict: Verdict, rows: ReviewRow[], action: ReviewAction) {
    this.data = { verdict, rows };
    this.chip.setState(verdict);
    this.card.setState(verdict);
    this.next.setVariant(action);
    this.rows.forEach((r, i) => {
      const d = rows[i];
      const on = !!d;
      r.box.view.visible = r.label.visible = r.why.visible = on;
      if (!d) return;
      r.box.setLetter(d.letter);
      r.box.set(d.text);
      r.box.setState(d.kind);
      r.box.refreshColor();
      r.label.text = LABEL[d.kind].text;
      r.label.style.fill = LABEL[d.kind].fill;
      r.why.text = d.why;
      r.label.visible = r.why.visible = !!d.why;
    });
    this.arrange();
    const y = this.body.y;
    this.view.alpha = 0;
    tween(380, (v) => {
      this.view.alpha = v;
      this.body.y = y + (1 - v) * 18;
    }, { key: this.key, ease: ease.outCubic });
  }

  /** Kartın içeriğini yukarıdan aşağı dizer, kartı içeriğe göre boyutlandırıp ortalar. */
  private arrange() {
    const L = this.layout;
    const F = L.feedback;
    const D = this.data!;
    const w = F.w;
    const boxW = this.boxWidth;
    const boxH = L.portrait ? 84 : 78;
    const chipW = L.portrait ? 220 : 170;
    const chipH = L.portrait ? 50 : 46;
    const nextW = L.portrait ? 380 : 230;
    const nextH = L.portrait ? 58 : 52;
    let y = PAD;
    this.chip.resize(chipW, chipH);
    this.chip.view.position.set((w - chipW) / 2, y);
    y += chipH + 22;
    D.rows.forEach((_, i) => {
      const r = this.rows[i];
      r.box.place((w - boxW) / 2, y, boxW, boxH, L.answerPt);
      y += boxH + 12;
      if (r.why.visible) {
        r.label.position.set(w / 2, y);
        y += r.label.height + 4;
        r.why.position.set(w / 2, y);
        y += r.why.height;
      }
      y += 22;
    });
    this.next.place((w - nextW) / 2, y, nextW, nextH);
    y += nextH + PAD;
    this.card.resize(w, y);
    this.card.view.hitArea = new Rectangle(0, 0, w, y);
    this.body.position.set(Math.round(F.cx - w / 2), Math.round(Math.max(F.minY, F.cy - y / 2)));
  }
}
