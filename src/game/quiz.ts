// Oyun kuralları — çizimden bağımsız durum makinesi.
// İstemci cevap anahtarını bilmez: her şıkkın doğru olup olmadığı ve açıklaması, cevap kesinleşince
// değerlendiriciden (sunucu ya da açıkça seçilmiş yerel mod) öğrenilir.
import type { AnswerLog, GameStart, Judge, PublicRound, Settings, Verdict } from '../shared/store';

/** `correct` ve `why` cevap kesinleşene kadar bilinmez (null / boş). */
export interface Option { text: string; correct: boolean | null; removed: boolean; why: string }
export interface Round { q: PublicRound; options: Option[] }
export type Phase = 'answering' | 'locked' | 'revealed' | 'over';
export type Lifeline = 'fifty' | 'hint' | 'double';
/** Kilitlenen cevabın sonucu. */
export type Outcome = 'retry' | 'correct' | 'wrong';

export class Quiz {
  readonly total: number;
  index = 0;
  correct = 0;
  selected = -1;
  phase: Phase = 'answering';
  lastWasCorrect = false;
  lastTimedOut = false;
  readonly lifelines: Record<Lifeline, boolean> = { fifty: true, hint: true, double: true };
  /** Çift cevap jokeri bu soruda etkin: ilk yanlış cevap bir hak daha verir. */
  doubleArmed = false;
  readonly log: AnswerLog[] = [];
  private readonly rounds: Round[];
  private readonly settings: Settings;
  private readonly judge: Judge;

  constructor(game: GameStart) {
    this.settings = game.ayarlar;
    this.judge = game.judge;
    this.rounds = game.sorular.map((q) => ({
      q,
      options: q.secenekler.map((text) => ({ text, correct: null, removed: false, why: '' })),
    }));
    this.total = this.rounds.length;
  }

  get round(): Round { return this.rounds[this.index]; }
  /** Yalnızca cevap kesinleştikten sonra anlamlıdır (aksi hâlde -1). */
  get correctIndex(): number { return this.round.options.findIndex((o) => o.correct === true); }
  get progress(): number { return this.total ? this.correct / this.total : 0; }
  get isLast(): boolean { return this.index >= this.total - 1; }
  /** Oyun, yanlış cevap yüzünden mi bitti? */
  get lost(): boolean { return this.phase === 'over' && !this.lastWasCorrect && this.settings.endOnWrong; }
  get seconds(): number { return this.settings.secondsPerQuestion; }

  select(i: number): boolean {
    if (this.phase !== 'answering' || i < 0 || i > 3 || this.round.options[i].removed) return false;
    this.selected = i;
    return true;
  }

  lock(): boolean {
    if (this.phase !== 'answering' || this.selected < 0) return false;
    this.phase = 'locked';
    return true;
  }

  /**
   * Kilitlenen cevabı değerlendiriciye gönderir. Hata olursa (ağ, sunucu) durum değişmez ve hata
   * fırlatılır; aynı çağrı güvenle yeniden yapılabilir (sunucu aynı cevabı aynı sonuçla yanıtlar).
   * 'retry': çift cevap jokeri — şık elendi, soru yeniden cevaplanabilir.
   */
  async resolve(): Promise<Outcome> {
    if (this.phase !== 'locked') throw new Error('Cevap kilitli değil.');
    const i = this.selected;
    const res = await this.judge.answer(this.index, i);
    if (res.sonuc === 'tekrar') {
      const o = this.round.options[res.elenen];
      o.removed = true;
      o.correct = false;
      o.why = res.aciklama;
      this.doubleArmed = false;
      this.selected = -1;
      this.phase = 'answering';
      return 'retry';
    }
    this.apply(res, false);
    return res.sonuc === 'dogru' ? 'correct' : 'wrong';
  }

  /** Süre doldu: soru yanlış sayılır. Hata olursa yeniden çağrılabilir. */
  async timeout(): Promise<void> {
    if (this.phase !== 'answering' && this.phase !== 'locked') return;
    this.phase = 'locked'; // sonuç gelene kadar seçim yapılamaz
    const res = await this.judge.timeout(this.index);
    this.selected = -1;
    this.apply(res, true);
  }

  private apply(v: Verdict, timedOut: boolean) {
    this.round.options.forEach((o, k) => {
      o.correct = k === v.dogruSik;
      o.why = v.aciklamalar[k] ?? '';
    });
    this.doubleArmed = false;
    const ok = v.sonuc === 'dogru';
    this.lastWasCorrect = ok;
    this.lastTimedOut = timedOut;
    this.correct = v.dogruSayisi;
    this.log.push({ id: String(this.index), correct: ok });
    this.phase = v.bitti ? 'over' : 'revealed';
  }

  next(): boolean {
    if (this.phase !== 'revealed') return false;
    this.index++;
    this.selected = -1;
    this.phase = 'answering';
    return true;
  }

  private async useLifeline(k: Lifeline) {
    if (!this.lifelines[k] || this.phase !== 'answering') return null;
    const res = await this.judge.lifeline(this.index, k);
    this.lifelines[k] = false;
    for (const i of res.elenen ?? []) {
      this.round.options[i].removed = true;
      this.round.options[i].correct = false;
      if (this.selected === i) this.selected = -1;
    }
    return res;
  }

  /** İki yanlış şıkkı eler; elenen şıkların sırasını döndürür. */
  async useFifty(): Promise<number[]> {
    return (await this.useLifeline('fifty'))?.elenen ?? [];
  }

  /** Sorunun ipucunu verir; ipucu yoksa bir yanlış şıkkı eler. */
  async useHint(): Promise<{ text: string; removed: number } | null> {
    const res = await this.useLifeline('hint');
    return res ? { text: res.ipucu ?? '', removed: res.elenen?.[0] ?? -1 } : null;
  }

  /** Bu soru için ikinci cevap hakkı verir (ilk cevap yanlışsa bir kez daha seçilebilir). */
  async useDouble(): Promise<boolean> {
    const res = await this.useLifeline('double');
    if (res) this.doubleArmed = true;
    return !!res;
  }
}
