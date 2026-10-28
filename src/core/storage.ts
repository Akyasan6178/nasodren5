// Defensive localStorage wrapper (private mode / blocked storage can throw).

const PREFIX = 'sinus-labirenti:';

function read(key: string): string | null {
  try {
    return localStorage.getItem(PREFIX + key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(PREFIX + key, value);
  } catch {
    /* ignore */
  }
}

const today = (): string => new Date().toISOString().slice(0, 10);

export const storage = {
  best(): number {
    return Number(read('best')) || 0;
  },
  todayBest(): number {
    const raw = read('daily');
    if (!raw) return 0;
    const [day, score] = raw.split('|');
    return day === today() ? Number(score) || 0 : 0;
  },
  /** Records a finished game; returns whether it set a new all-time best. */
  submit(score: number): boolean {
    if (score > this.todayBest()) write('daily', `${today()}|${score}`);
    if (score > this.best()) {
      write('best', String(score));
      return true;
    }
    return false;
  },
  muted(): boolean {
    return read('muted') === '1';
  },
  setMuted(m: boolean): void {
    write('muted', m ? '1' : '0');
  },
};
