// Oyun kuralları — çizimden bağımsız, saf durum makinesi.
import type { AnswerLog, Question, Settings } from '../shared/store';

/** `why`: şıkkın neden doğru ya da yanlış olduğu (boş olabilir). */
export interface Option { text: string; correct: boolean; removed: boolean; why: string }
export interface Round { q: Question; options: Option[] }
export type Phase = 'answering' | 'locked' | 'revealed' | 'over';
export type Lifeline = 'fifty' | 'hint' | 'double';

function shuffle<T>(arr: T[], rng: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

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

  constructor(pool: Question[], private readonly settings: Settings, private readonly rng: () => number = Math.random) {
    const picked = shuffle([...pool], rng);
    this.total = Math.min(settings.questionsPerGame, picked.length);
    this.rounds = picked.slice(0, this.total).map((q) => this.makeRound(q));
  }

  private makeRound(q: Question): Round {
    const options: Option[] = [
      { text: q.dogru, correct: true, removed: false, why: q.aciklama?.trim() ?? '' },
      ...q.yanlislar.map((text, i) => ({ text, correct: false, removed: false, why: q.yanlisAciklamalar?.[i]?.trim() ?? '' })),
    ];
    return { q, options: shuffle(options, this.rng) };
  }

  get round(): Round { return this.rounds[this.index]; }
  get correctIndex(): number { return this.round.options.findIndex((o) => o.correct); }
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
   * Kilitlenen cevap yanlışsa ve çift cevap jokeri etkinse: şık elenir, soru yeniden
   * cevaplanabilir olur ve true döner. Aksi hâlde hiçbir şey değişmez; reveal() çağrılmalıdır.
   */
  retry(): boolean {
    if (this.phase !== 'locked' || !this.doubleArmed || this.round.options[this.selected].correct) return false;
    this.doubleArmed = false;
    this.round.options[this.selected].removed = true;
    this.selected = -1;
    this.phase = 'answering';
    return true;
  }

  reveal(): boolean {
    if (this.phase !== 'locked') return false;
    this.doubleArmed = false;
    const ok = this.round.options[this.selected].correct;
    this.lastWasCorrect = ok;
    this.lastTimedOut = false;
    if (ok) this.correct++;
    this.log.push({ id: this.round.q.id, correct: ok });
    this.phase = (!ok && this.settings.endOnWrong) || this.isLast ? 'over' : 'revealed';
    return ok;
  }

  /** Süre doldu: soru yanlış sayılır. */
  timeout(): boolean {
    if (this.phase !== 'answering') return false;
    this.selected = -1;
    this.doubleArmed = false;
    this.lastWasCorrect = false;
    this.lastTimedOut = true;
    this.log.push({ id: this.round.q.id, correct: false });
    this.phase = this.settings.endOnWrong || this.isLast ? 'over' : 'revealed';
    return true;
  }

  next(): boolean {
    if (this.phase !== 'revealed') return false;
    this.index++;
    this.selected = -1;
    this.phase = 'answering';
    return true;
  }

  /** İki yanlış şıkkı eler; elenen şıkların sırasını döndürür. */
  useFifty(): number[] {
    if (!this.lifelines.fifty || this.phase !== 'answering') return [];
    this.lifelines.fifty = false;
    const wrong = this.round.options.map((o, i) => (!o.correct && !o.removed ? i : -1)).filter((i) => i >= 0);
    const removed = shuffle(wrong, this.rng).slice(0, Math.max(0, wrong.length - 1)).slice(0, 2);
    for (const i of removed) this.round.options[i].removed = true;
    if (removed.includes(this.selected)) this.selected = -1;
    return removed;
  }

  /** Sorunun ipucunu verir; ipucu yoksa bir yanlış şıkkı eler. */
  useHint(): { text: string; removed: number } | null {
    if (!this.lifelines.hint || this.phase !== 'answering') return null;
    this.lifelines.hint = false;
    const text = this.round.q.ipucu?.trim() ?? '';
    if (text) return { text, removed: -1 };
    const wrong = this.round.options.map((o, i) => (!o.correct && !o.removed ? i : -1)).filter((i) => i >= 0);
    const removed = wrong.length > 1 ? wrong[Math.floor(this.rng() * wrong.length)] : -1;
    if (removed >= 0) {
      this.round.options[removed].removed = true;
      if (this.selected === removed) this.selected = -1;
    }
    return { text: 'Bu soru için ipucu yok, bir yanlış şık elendi.', removed };
  }

  /** Bu soru için ikinci cevap hakkı verir (ilk cevap yanlışsa bir kez daha seçilebilir). */
  useDouble(): boolean {
    if (!this.lifelines.double || this.phase !== 'answering') return false;
    this.lifelines.double = false;
    this.doubleArmed = true;
    return true;
  }
}
