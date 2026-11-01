// Oyun denetleyicisi: kurallar (Quiz) ile sahneyi (Scene), süreyi, müziği ve girdileri birbirine bağlar.
import { DEFAULT_SETTINGS, loadGame, reportResult, type Question, type Settings } from '../shared/store';
import { isSoundOn, play, setSound, unlockAudio } from './audio';
import { music } from './music';
import { Quiz, type Lifeline } from './quiz';
import type { Scene, SceneHandlers } from './render/scene';
import type { Verdict } from './render/widgets';
import { ease, tween, wait } from './tween';

const TAGLINE = 'Her doğru cevapla bir adım daha.';
const LOCK_MS = 1300;
const WARN_SECONDS = 5; // son saniyelerde tik sesi

export class Game {
  private quiz: Quiz | null = null;
  private busy = false; // geçiş animasyonu sürerken girdiyi yok say
  private shownProgress = 0;
  private readonly progressKey = {};
  private readonly boardKey = {};
  private token = 0; // yeni oyun başlayınca bekleyen zamanlayıcıları geçersiz kılar
  private timeLeft = 0;
  private timerOn = false;
  private modalMode: 'start' | 'result' = 'start';

  constructor(private readonly scene: Scene) {
    scene.btnSound.setVariant(isSoundOn() ? 'on' : 'off');
    if (!document.fullscreenEnabled) scene.btnFull.view.visible = false;
    window.addEventListener('keydown', (e) => this.onKey(e));
    window.addEventListener('pointerdown', unlockAudio, { passive: true });
  }

  // ---------- akış ----------

  /** Soruları yükler ve oyunu sıfırlar; soru yoksa false döner. */
  private async prepare(): Promise<boolean> {
    const t = ++this.token;
    this.busy = true;
    this.stopClock();
    music.stop();
    let pool: Question[] = [];
    let settings: Settings = DEFAULT_SETTINGS;
    try {
      ({ questions: pool, settings } = await loadGame());
      settings = { ...DEFAULT_SETTINGS, ...settings };
    } catch {
      /* boş havuzla devam; aşağıda mesaj gösterilir */
    }
    if (t !== this.token) return false;
    const s = this.scene;
    this.setProgress(0, true);
    for (const b of Object.values(s.lifelines)) b.setVariant('n');
    s.timer.view.visible = settings.secondsPerQuestion > 0;
    s.timer.set(settings.secondsPerQuestion, settings.secondsPerQuestion);

    if (!pool.length) {
      this.quiz = null;
      s.modal.visible = false;
      s.board.alpha = 1;
      s.question.set('', 'Henüz soru eklenmemiş. Yönetici panelinden soru ekleyin.');
      s.answers.forEach((a) => { a.set(''); a.setState('n'); });
      s.counter.text = 'SORU 0 / 0';
      s.setActionMode('none');
      return false;
    }
    this.quiz = new Quiz(pool, settings);
    this.syncLifelines();
    s.counter.text = `SORU 1 / ${this.quiz.total}`;
    return true;
  }

  /** İlk açılış: sorular arkada gizli, "Başla" ile süre ve müzik başlar (mobilde ses için dokunuş gerekir). */
  async intro() {
    if (!(await this.prepare())) return;
    const q = this.quiz!;
    const s = this.scene;
    s.board.alpha = 0;
    s.setActionMode('none');
    this.setTagline(TAGLINE, false);
    this.modalMode = 'start';
    s.mEyebrow.text = 'SİKLAMEN BİLGİ OYUNU';
    s.mTitle.text = 'Hazır mısınız?';
    s.mScore.text = q.seconds > 0 ? `${q.total} soru · her soru için ${q.seconds} saniye` : `${q.total} soru`;
    s.mBody.text = '50:50, İpucu ve Soruyu geç jokerlerinden birer hakkınız var. Doğru cevap verdikçe sinüs kanalları açılır.';
    s.mNew.setVariant('start');
    this.showModal();
  }

  async start() {
    this.scene.modal.visible = false;
    if (!(await this.prepare())) return;
    await this.showRound(true);
    this.beginQuestion();
  }

  private async begin() {
    const t = this.token;
    this.hideModal();
    this.busy = true;
    await this.showRound(true);
    if (t !== this.token) return;
    this.beginQuestion();
  }

  private async showRound(first = false) {
    const q = this.quiz!;
    const s = this.scene;
    const t = this.token;
    if (!first) await this.fadeBoard(0, 160);
    if (t !== this.token) return;
    const { q: data, options } = q.round;
    s.counter.text = `SORU ${q.index + 1} / ${q.total}`;
    this.setTagline(TAGLINE, false);
    s.question.set(data.kategori ?? '', data.soru);
    options.forEach((o, i) => {
      const a = s.answers[i];
      a.set(o.text);
      a.setState('n');
      a.refreshColor();
      a.setInteractive(true);
    });
    s.setActionMode('hints');
    if (q.seconds > 0) s.timer.set(q.seconds, q.seconds);
    await this.fadeBoard(1, 260);
  }

  /** Soru ekrana geldi: süre ve müzik başlar. */
  private beginQuestion() {
    const q = this.quiz;
    if (!q) return;
    this.busy = false;
    this.timeLeft = q.seconds;
    this.timerOn = q.seconds > 0;
    music.start();
    music.setIntensity(this.timerOn ? 0 : 0.2);
  }

  private stopClock() {
    this.timerOn = false;
  }

  /** Her karede çağrılır. */
  update(dt: number) {
    const q = this.quiz;
    if (!this.timerOn || !q || q.phase !== 'answering' || this.busy) return;
    const before = Math.ceil(this.timeLeft);
    this.timeLeft = Math.max(0, this.timeLeft - dt / 1000);
    const after = Math.ceil(this.timeLeft);
    this.scene.timer.set(this.timeLeft, q.seconds);
    music.setIntensity(1 - this.timeLeft / q.seconds);
    if (after < before && after > 0 && after <= WARN_SECONDS) play('tick');
    if (this.timeLeft <= 0) void this.onTimeout();
  }

  private fadeBoard(to: number, ms: number) {
    const s = this.scene;
    const from = s.board.alpha;
    return new Promise<void>((resolve) =>
      tween(ms, (v) => {
        s.board.alpha = from + (to - from) * v;
        s.question.content.y = (1 - s.board.alpha) * 10;
      }, { key: this.boardKey, done: resolve, ease: ease.inOutSine }));
  }

  private select(i: number) {
    const q = this.quiz;
    if (!q || this.busy || !q.select(i)) return;
    play('select');
    this.scene.answers.forEach((a, j) => {
      if (!a.removed) a.setState(j === i ? 'sel' : 'n');
      a.refreshColor();
    });
    this.scene.setActionMode('confirm');
  }

  private async confirm() {
    const q = this.quiz;
    if (!q || this.busy || !q.lock()) return;
    const s = this.scene;
    const t = this.token;
    this.busy = true;
    this.stopClock();
    music.stop();
    s.setActionMode('none');
    s.answers.forEach((a) => a.setInteractive(false));
    play('lock');
    const chosen = s.answers[q.selected];
    // gerilim: seçili şık nabız gibi parlar
    tween(LOCK_MS, (v) => { chosen.view.alpha = 0.78 + 0.22 * Math.cos(v * Math.PI * 6); }, { ease: ease.linear });
    await wait(LOCK_MS);
    if (t !== this.token) return;
    chosen.view.alpha = 1;

    const ok = q.reveal();
    play(ok ? 'correct' : 'wrong');
    if (!ok) { chosen.setState('bad'); chosen.refreshColor(); }
    await this.flashCorrect();
    if (t !== this.token) return;
    if (ok) this.setProgress(q.progress);
    this.showFeedback(ok ? 'ok' : 'bad');
  }

  private async onTimeout() {
    const q = this.quiz;
    if (!q || this.busy || !q.timeout()) return;
    const s = this.scene;
    const t = this.token;
    this.busy = true;
    this.stopClock();
    music.stop();
    s.setActionMode('none');
    s.answers.forEach((a) => {
      a.setInteractive(false);
      if (a.state === 'sel' || a.state === 'hover') { a.setState('n'); a.refreshColor(); }
    });
    play('timeout');
    await this.flashCorrect();
    if (t !== this.token) return;
    this.showFeedback('time');
  }

  /** Doğru şık birkaç kez yanıp söner. */
  private async flashCorrect() {
    const q = this.quiz!;
    const t = this.token;
    const right = this.scene.answers[q.correctIndex];
    for (let k = 0; k < 6; k++) {
      right.setState(k % 2 === 0 ? 'ok' : 'n');
      right.refreshColor();
      await wait(110);
      if (t !== this.token) return;
    }
    right.setState('ok');
    right.refreshColor();
  }

  private showFeedback(v: Verdict) {
    const q = this.quiz!;
    this.scene.setFeedback(v, q.round.q.aciklama?.trim() ?? '', q.phase === 'over');
    this.scene.setActionMode('feedback');
    this.busy = false;
  }

  private async advance() {
    const q = this.quiz;
    if (!q || this.busy) return;
    if (q.phase === 'over') return this.finish();
    if (!q.next()) return;
    play('click');
    this.busy = true;
    const t = this.token;
    await this.showRound();
    if (t !== this.token) return;
    this.beginQuestion();
  }

  private finish() {
    const q = this.quiz!;
    const s = this.scene;
    const won = !q.lost && q.correct === q.total;
    void reportResult(q.log, !q.lost);
    play(won ? 'win' : q.lost ? 'wrong' : 'correct');
    const pct = Math.round(q.progress * 100);
    this.modalMode = 'result';
    s.mEyebrow.text = q.lost ? 'OYUN BİTTİ' : 'TEBRİKLER';
    s.mTitle.text = won ? 'Sinüsler açıldı!' : q.lost ? (q.lastTimedOut ? 'Süre doldu!' : 'Bir dahaki sefere!') : 'Oyun tamamlandı';
    s.mScore.text = `${q.correct} / ${q.total} doğru cevap`;
    s.mBody.text = won
      ? 'Tüm soruları doğru bildiniz. Sinüs kanalları %100 açık!'
      : `Sinüs kanallarını %${pct} açtınız. Bilgilerinizi tazeleyip yeniden deneyin.`;
    s.mNew.setVariant('n');
    this.showModal();
  }

  private showModal() {
    const s = this.scene;
    s.modal.visible = true;
    s.modal.alpha = 0;
    tween(300, (v) => { s.modal.alpha = v; });
  }

  private hideModal() {
    this.scene.modal.visible = false;
  }

  private useLifeline(k: Lifeline) {
    const q = this.quiz;
    if (!q || this.busy || q.phase !== 'answering' || !q.lifelines[k]) return;
    const s = this.scene;
    if (k === 'fifty') {
      const removed = q.useFifty();
      if (!removed.length) return;
      for (const i of removed) s.answers[i].remove();
    } else if (k === 'hint') {
      const res = q.useHint();
      if (!res) return;
      this.setTagline(res.text, true);
      if (res.removed >= 0) s.answers[res.removed].remove();
    } else {
      if (!q.useSkip()) return;
      // yeni soru için süre ve müzik baştan başlar
      this.busy = true;
      music.stop();
      const t = this.token;
      void this.showRound().then(() => { if (t === this.token) this.beginQuestion(); });
    }
    play('lifeline');
    if (q.selected < 0) {
      s.answers.forEach((a) => { if (!a.removed && a.state === 'sel') a.setState('n'); a.refreshColor(); });
      if (k !== 'skip') s.setActionMode('hints');
    }
    this.syncLifelines();
  }

  private syncLifelines() {
    const q = this.quiz;
    const L = this.scene.lifelines;
    const avail = (k: Lifeline) => !!q && (k === 'skip' ? q.canSkip() : q.lifelines[k]);
    for (const k of ['fifty', 'hint', 'skip'] as Lifeline[]) {
      L[k].setVariant(avail(k) ? 'n' : 'used');
      L[k].setEnabled(avail(k));
    }
  }

  // ---------- görsel yardımcılar ----------

  private setTagline(str: string, hint: boolean) {
    const t = this.scene.tagline;
    t.text = hint ? `💡 ${str}` : str;
    t.style.fill = hint ? '#ffd1e8' : '#ddd3f7';
  }

  private setProgress(p: number, instant = false) {
    const s = this.scene;
    const from = this.shownProgress;
    const apply = (v: number) => {
      this.shownProgress = v;
      s.head.setProgress(v);
      const txt = `%${Math.round(v * 100)}`;
      if (s.percent.text !== txt) s.percent.text = txt; // metin yalnızca değer değişince yeniden çizilir
    };
    if (instant) return apply(p);
    tween(900, (v) => apply(from + (p - from) * v), { key: this.progressKey });
    tween(500, (v) => s.percent.scale.set(1 + 0.14 * Math.sin(v * Math.PI)), { ease: ease.linear });
  }

  // ---------- girdiler ----------

  readonly handlers: SceneHandlers = {
    onNew: () => { unlockAudio(); play('click'); void this.start(); },
    onSound: () => {
      setSound(!isSoundOn());
      this.scene.btnSound.setVariant(isSoundOn() ? 'on' : 'off');
      play('click');
    },
    onFull: () => {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void document.documentElement.requestFullscreen?.().catch(() => undefined);
    },
    onLifeline: (k) => this.useLifeline(k),
    onAnswer: (i) => {
      const q = this.quiz;
      // aynı şıkka ikinci dokunuş onaylar (mobil için hızlı yol)
      if (q && q.phase === 'answering' && q.selected === i) void this.confirm();
      else this.select(i);
    },
    onHover: (i, on) => {
      const q = this.quiz;
      const a = this.scene.answers[i];
      if (!q || q.phase !== 'answering' || this.busy || a.removed || q.selected === i) return;
      a.setState(on ? 'hover' : 'n');
    },
    onConfirm: () => void this.confirm(),
    onNext: () => void this.advance(),
    onModal: () => {
      unlockAudio();
      play('click');
      if (this.modalMode === 'start') void this.begin();
      else void this.start();
    },
  };

  private onKey(e: KeyboardEvent) {
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    unlockAudio();
    const k = e.key.toLocaleLowerCase('tr');
    const letters = ['a', 'b', 'c', 'd'].indexOf(k);
    const idx = letters >= 0 ? letters : ['1', '2', '3', '4'].indexOf(k);
    if (this.scene.modal.visible) {
      if (k === 'enter' || k === ' ') { e.preventDefault(); this.handlers.onModal(); }
      return;
    }
    if (idx >= 0) { e.preventDefault(); this.select(idx); return; }
    if (k === 'enter' || k === ' ') {
      e.preventDefault();
      const q = this.quiz;
      if (!q) return;
      if (q.phase === 'answering') void this.confirm();
      else if (q.phase === 'revealed' || q.phase === 'over') void this.advance();
    }
  }
}
