// Oyun denetleyicisi: kurallar (Quiz) ile sahneyi (Scene), süreyi, müziği ve girdileri birbirine bağlar.
import { DEFAULT_SETTINGS, loadGame, reportResult, type Question, type Settings } from '../shared/store';
import { isSoundOn, play, setSound, unlockAudio } from './audio';
import { music } from './music';
import { Quiz, type Lifeline } from './quiz';
import type { Scene, SceneHandlers } from './render/scene';
import type { ReviewRow } from './render/review';
import type { Verdict } from './render/widgets';
import { cancel, ease, tween, wait } from './tween';

// Sloganın yeri yalnızca ipucu jokerinde dolar; ekran sade kalsın diye varsayılanı boş.
const TAGLINE = '';
const LOCK_MS = 1300;
const WARN_SECONDS = 5; // son saniyelerde tik sesi
/** Joker kullanılınca düğmeden yayılan halkanın rengi. */
const LIFELINE_COLOR: Record<Lifeline, number> = { fifty: 0xff4f9a, hint: 0xffc04a, double: 0x3cdcff };
/** Soru üstündeki bilgi satırının görünümleri. */
const TAG = {
  plain: { prefix: '', fill: '#ddd3f7' },
  hint: { prefix: '💡 ', fill: '#ffd1e8' },
  double: { prefix: '✌️ ', fill: '#bff3ff' },
};

export class Game {
  private quiz: Quiz | null = null;
  private busy = false; // geçiş animasyonu sürerken girdiyi yok say
  /** Çift cevap jokerinde açıklama kartı açık: "Tekrar dene" bekleniyor (yanlış şıkkın sırası, yoksa -1). */
  private retryPending = -1;
  private shownProgress = 0;
  private readonly progressKey = {};
  private readonly boardKey = {};
  private readonly taglineKey = {};
  private token = 0; // yeni oyun başlayınca bekleyen zamanlayıcıları geçersiz kılar
  private timeLeft = 0;
  private timerOn = false;
  private modalMode: 'start' | 'result' | 'pause' = 'start';
  /** Mola: süre ve müzik durur, soru gizlenir. */
  private paused = false;
  /** Geçiş animasyonu sırasında basılan duraklatma, animasyon bitince uygulanır. */
  private pendingPause = false;
  private pausedTimer = false;
  private pausedHidden: { visible: boolean }[] = [];

  constructor(private readonly scene: Scene) {
    scene.btnSound.setVariant(isSoundOn() ? 'on' : 'off');
    if (!document.fullscreenEnabled) scene.btnFull.view.visible = false;
    window.addEventListener('keydown', (e) => this.onKey(e));
    window.addEventListener('pointerdown', unlockAudio, { passive: true });
    // sekme/uygulama değişince (telefonda arama gelince vb.) oyun kendiliğinden molaya girer
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.requestPause(); });
  }

  // ---------- akış ----------

  /** Soruları yükler ve oyunu sıfırlar; soru yoksa false döner. */
  private async prepare(): Promise<boolean> {
    const t = ++this.token;
    this.busy = true;
    this.retryPending = -1;
    this.paused = false;
    this.pendingPause = false;
    for (const o of this.pausedHidden) o.visible = true; // moladan çıkılmadan yeni oyuna geçildiyse
    this.pausedHidden = [];
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
    // yazı boyutları tüm havuza göre seçilir: sorudan soruya değişmez
    s.setTextPool({
      questions: pool.map((x) => x.soru),
      answers: pool.flatMap((x) => [x.dogru, ...x.yanlislar]),
      explanations: pool.flatMap((x) => [x.aciklama ?? '', ...(x.yanlisAciklamalar ?? [])]).map((t) => t.trim()).filter(Boolean),
    });
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
    this.setTagline(TAGLINE);
    this.modalMode = 'start';
    s.mEyebrow.text = 'KİM NEFES ALMAK İSTER?';
    s.mTitle.text = 'Hazır mısınız?';
    s.mScore.text = q.seconds > 0 ? `${q.total} soru · her soru için ${q.seconds} saniye` : `${q.total} soru`;
    s.mBody.text = '50:50, İpucu ve Çift cevap jokerlerinden birer hakkınız var. Doğru cevap verdikçe sinüs kanalları açılır.';
    s.mNew.setVariant('start');
    s.setModalKind('menu');
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
    this.setTagline(TAGLINE);
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
    this.timeLeft = q.seconds;
    this.timerOn = q.seconds > 0;
    music.start();
    music.setIntensity(this.timerOn ? 0 : 0.2);
    this.settle();
  }

  /** Geçiş bitti, girdi yeniden açılır; bu arada duraklatma istendiyse şimdi uygulanır. */
  private settle() {
    this.busy = false;
    if (this.pendingPause) {
      this.pendingPause = false;
      this.pause();
    }
  }

  // ---------- mola ----------

  private requestPause() {
    if (!this.quiz || this.paused || this.scene.modal.visible) return;
    if (this.busy) this.pendingPause = true;
    else this.pause();
  }

  private pause() {
    const q = this.quiz;
    const s = this.scene;
    if (!q || this.paused || s.modal.visible) return;
    this.paused = true;
    this.pausedTimer = this.timerOn;
    this.timerOn = false;
    music.stop();
    // soru, şıklar ve ipucu mola boyunca gizlenir: mola düşünme süresine dönüşmesin
    this.pausedHidden = [s.board, s.review.view, s.confirm.view, s.tagline].filter((o) => o.visible);
    for (const o of this.pausedHidden) o.visible = false;
    this.modalMode = 'pause';
    s.mEyebrow.text = 'OYUN DURAKLATILDI';
    s.mTitle.text = 'Mola';
    s.mScore.text = `Soru ${q.index + 1} / ${q.total}${this.pausedTimer ? ` · ${Math.ceil(this.timeLeft)} sn kaldı` : ''}`;
    s.mBody.text = 'Soru ve şıklar mola boyunca gizlenir. Kaldığınız yerden devam edebilir ya da ana menüye dönebilirsiniz (bu oyundaki ilerleme silinir).';
    s.mNew.setVariant('resume');
    s.setModalKind('pause');
    this.showModal();
  }

  private resume() {
    const q = this.quiz;
    if (!this.paused || !q) return;
    this.paused = false;
    this.hideModal();
    for (const o of this.pausedHidden) o.visible = true;
    this.pausedHidden = [];
    this.timerOn = this.pausedTimer && this.timeLeft > 0;
    if (q.phase === 'answering' && this.retryPending < 0) {
      music.start(true);
      music.setIntensity(this.timerOn ? 1 - this.timeLeft / q.seconds : 0.2);
    }
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
        if (to === 0) s.review.view.alpha = Math.min(s.review.view.alpha, s.board.alpha); // açıklama ekranı da söner
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

    const picked = q.selected;
    if (q.retry()) return this.secondChance(picked);
    const ok = q.reveal();
    play(ok ? 'correct' : 'wrong');
    if (!ok) { chosen.setState('bad'); chosen.refreshColor(); }
    await this.flashCorrect();
    if (t !== this.token) return;
    if (ok) this.setProgress(q.progress);
    this.showFeedback(ok ? 'ok' : 'bad');
  }

  /**
   * Çift cevap jokeri: ilk cevap yanlıştı. Şık kırmızıya döner; açıklaması varsa açıklama
   * kartında yalnızca bu şık ve neden yanlış olduğu gösterilir (doğru şık açık edilmez, kart
   * açıkken süre durur). "Tekrar dene" ile ya da açıklama yoksa doğrudan ikinci hakka geçilir.
   */
  private async secondChance(i: number) {
    const q = this.quiz!;
    const s = this.scene;
    const t = this.token;
    const wrong = s.answers[i];
    play('wrong');
    wrong.setState('bad');
    wrong.refreshColor();
    await wait(650);
    if (t !== this.token) return;
    const o = q.round.options[i];
    if (!o.why) return this.resumeSecondChance(i);
    this.retryPending = i;
    s.setActionMode('feedback');
    s.setFeedback('bad', [{ letter: 'ABCD'[i], text: o.text, kind: 'bad', why: o.why }], 'retry');
  }

  /** Açıklama kartı kapanır, yanlış şık elenir; süre ve müzik kaldığı yerden devam eder. */
  private async resumeSecondChance(i: number) {
    const q = this.quiz!;
    const s = this.scene;
    const t = this.token;
    if (this.retryPending >= 0) {
      this.retryPending = -1;
      play('click');
      await new Promise<void>((resolve) => s.review.hide(resolve));
      if (t !== this.token) return;
    }
    s.answers[i].remove();
    this.setTagline('Yanlış! Çift cevap jokeri sayesinde bir hakkınız daha var.', 'double');
    s.answers.forEach((a) => a.setInteractive(true));
    s.setActionMode('hints');
    this.timerOn = q.seconds > 0 && this.timeLeft > 0;
    music.start();
    music.setIntensity(this.timerOn ? 1 - this.timeLeft / q.seconds : 0.2);
    this.settle();
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
    for (let k = 0; k < 2; k++) {
      right.setState(k % 2 === 0 ? 'ok' : 'n');
      right.refreshColor();
      await wait(160);
      if (t !== this.token) return;
    }
    right.setState('ok');
    right.refreshColor();
  }

  /**
   * Açıklama ekranı: yanlış cevapta seçilen şık ve neden yanlış olduğu, altında doğru şık ve
   * neden doğru olduğu gösterilir. Doğru cevapta ya da süre dolunca yalnızca doğru şık gelir.
   */
  private showFeedback(v: Verdict) {
    const q = this.quiz!;
    const shown = v === 'bad' ? [q.selected, q.correctIndex] : [q.correctIndex];
    const rows: ReviewRow[] = shown.map((i) => {
      const o = q.round.options[i];
      return { letter: 'ABCD'[i], text: o.text, kind: o.correct ? 'ok' : 'bad', why: o.why };
    });
    this.scene.setActionMode('feedback');
    this.scene.setFeedback(v, rows, q.phase === 'over' ? 'result' : 'next');
    this.settle();
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
    s.setModalKind('menu');
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
      removed.forEach((i, n) => s.answers[i].remove(120 + n * 180)); // şıklar sırayla elenir
    } else if (k === 'hint') {
      const res = q.useHint();
      if (!res) return;
      this.setTagline(res.text, 'hint');
      if (res.removed >= 0) s.answers[res.removed].remove(200);
    } else {
      if (!q.useDouble()) return;
      this.setTagline('Çift cevap aktif: ilk cevabınız yanlışsa bir hakkınız daha var.', 'double');
    }
    play('lifeline');
    s.lifelines[k].burst(LIFELINE_COLOR[k]);
    if (q.selected < 0) {
      s.answers.forEach((a) => { if (!a.removed && a.state === 'sel') a.setState('n'); a.refreshColor(); });
      s.setActionMode('hints');
    }
    this.syncLifelines(true);
  }

  /** animate: kullanılan joker yumuşakça "kullanıldı" görünümüne geçer. */
  private syncLifelines(animate = false) {
    const q = this.quiz;
    const L = this.scene.lifelines;
    for (const k of ['fifty', 'hint', 'double'] as Lifeline[]) {
      const avail = !!q && q.lifelines[k];
      L[k].setVariant(avail ? 'n' : 'used', animate);
      L[k].setEnabled(avail);
    }
  }

  // ---------- görsel yardımcılar ----------

  /** Joker mesajı (ipucu / çift cevap) gelince satır hafif aşağıdan kayıp büyüyerek belirir. */
  private setTagline(str: string, kind: keyof typeof TAG = 'plain') {
    const t = this.scene.tagline;
    const look = TAG[kind];
    t.text = look.prefix + str;
    t.style.fill = look.fill;
    cancel(this.taglineKey);
    t.alpha = 1;
    t.pivot.y = 0;
    t.scale.set(1);
    if (kind === 'plain') return;
    tween(560, (v) => {
      t.alpha = Math.min(1, v * 1.8);
      t.pivot.y = -16 * (1 - v);
      t.scale.set(0.92 + 0.08 * v);
    }, { key: this.taglineKey, ease: ease.outBack, delay: 80 });
    t.alpha = 0;
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
    if (p > from) s.head.pulse();
    tween(1400, (v) => apply(from + (p - from) * v), { key: this.progressKey, ease: ease.inOutSine });
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
    onNext: () => void (this.retryPending >= 0 ? this.resumeSecondChance(this.retryPending) : this.advance()),
    onModal: () => {
      unlockAudio();
      play('click');
      if (this.modalMode === 'pause') this.resume();
      else if (this.modalMode === 'start') void this.begin();
      else void this.start();
    },
    onHome: () => {
      play('click');
      music.stop();
      this.scene.modal.visible = false;
      void this.intro(); // oyun sıfırlanır, "Hazır mısınız?" başlangıç ekranı açılır
    },
    onPause: () => {
      unlockAudio();
      play('click');
      if (this.paused) this.resume();
      else this.requestPause();
    },
    onMulti: () => {
      play('click');
      music.stop();
      location.href = `${import.meta.env.BASE_URL}katil.html`; // PIN ile katıl ya da oyun oluştur
    },
  };

  private onKey(e: KeyboardEvent) {
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    unlockAudio();
    const k = e.key.toLocaleLowerCase('tr');
    const letters = ['a', 'b', 'c', 'd'].indexOf(k);
    const idx = letters >= 0 ? letters : ['1', '2', '3', '4'].indexOf(k);
    // P ya da Esc: duraklat / devam et
    if (k === 'p' || k === 'escape') {
      if (this.paused || !this.scene.modal.visible) { e.preventDefault(); this.handlers.onPause(); }
      return;
    }
    if (this.scene.modal.visible) {
      if (k === 'enter' || k === ' ') { e.preventDefault(); this.handlers.onModal(); }
      return;
    }
    if (idx >= 0) { e.preventDefault(); this.select(idx); return; }
    if (k === 'enter' || k === ' ') {
      e.preventDefault();
      const q = this.quiz;
      if (!q) return;
      if (this.retryPending >= 0) this.handlers.onNext();
      else if (q.phase === 'answering') void this.confirm();
      else if (q.phase === 'revealed' || q.phase === 'over') void this.advance();
    }
  }
}
