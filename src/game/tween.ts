// Ayırma (allocation) yapmayan küçük tween sistemi; tek ticker'dan sürülür.

export type Ease = (t: number) => number;
export const ease = {
  linear: (t: number) => t,
  outCubic: (t: number) => 1 - (1 - t) ** 3,
  inOutSine: (t: number) => -(Math.cos(Math.PI * t) - 1) / 2,
  outBack: (t: number) => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2,
};

interface Tween {
  elapsed: number;
  duration: number;
  delay: number;
  ease: Ease;
  update: (v: number) => void;
  done?: () => void;
  key?: object;
}

const active: Tween[] = [];

/** `update(0..1)` çağırır. Aynı `key` ile yeni tween başlatılırsa eskisi iptal edilir. */
export function tween(duration: number, update: (v: number) => void, opts: { ease?: Ease; delay?: number; done?: () => void; key?: object } = {}) {
  if (opts.key) cancel(opts.key);
  active.push({ elapsed: 0, duration, delay: opts.delay ?? 0, ease: opts.ease ?? ease.outCubic, update, done: opts.done, key: opts.key });
}

export function cancel(key: object) {
  for (let i = active.length - 1; i >= 0; i--) if (active[i].key === key) active.splice(i, 1);
}

/** Süre bazlı bekleme; ticker ile senkron olduğundan sekme arka plandayken de tutarlıdır. */
export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => tween(ms, () => {}, { done: resolve }));
}

export function updateTweens(dtMs: number) {
  for (let i = active.length - 1; i >= 0; i--) {
    const t = active[i];
    if (t.delay > 0) { t.delay -= dtMs; if (t.delay > 0) continue; }
    t.elapsed += dtMs;
    const p = Math.min(1, t.elapsed / t.duration);
    t.update(t.ease(p));
    if (p >= 1) {
      active.splice(i, 1);
      t.done?.();
    }
  }
}
