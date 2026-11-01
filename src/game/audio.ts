// Ses efektleri WebAudio ile anlık sentezlenir; dosya indirilmez, gecikme olmaz.

type Sfx = 'select' | 'lock' | 'correct' | 'wrong' | 'lifeline' | 'win' | 'click' | 'tick' | 'timeout';

const KEY = 'siklamen.ses';
const MASTER_VOL = 0.5;
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let enabled = (() => { try { return localStorage.getItem(KEY) !== '0'; } catch { return true; } })();

function ensure(): AudioContext | null {
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = enabled ? MASTER_VOL : 0;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

/** Mobil tarayıcılar sesi ancak bir kullanıcı hareketinden sonra açar. */
export function unlockAudio() {
  if (enabled) ensure();
}

export const isSoundOn = () => enabled;
export function setSound(on: boolean) {
  enabled = on;
  try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* yoksay */ }
  // Ana çıkış kısılır; müzik zamanlayıcısı akmaya devam eder, ses açılınca kaldığı yerden duyulur.
  const ac = ensure();
  if (ac && master) master.gain.setTargetAtTime(on ? MASTER_VOL : 0, ac.currentTime, 0.03);
}

/** Müzik modülü için ortak bağlam ve çıkış. */
export function audioOut(): { ac: AudioContext; out: GainNode } | null {
  const ac = ensure();
  return ac && master ? { ac, out: master } : null;
}

function tone(freq: number, start: number, dur: number, type: OscillatorType, vol: number, slideTo?: number) {
  const ac = ctx!;
  const t0 = ac.currentTime + start;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(master!);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

export function play(sfx: Sfx) {
  if (!enabled || !ensure()) return;
  switch (sfx) {
    case 'click': tone(880, 0, 0.06, 'triangle', 0.15); break;
    case 'select': tone(660, 0, 0.09, 'triangle', 0.25); tone(990, 0.05, 0.1, 'triangle', 0.18); break;
    case 'lock':
      tone(220, 0, 1.1, 'sawtooth', 0.06, 330);
      tone(110, 0, 1.1, 'sine', 0.25);
      break;
    case 'correct': [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.09, 0.35, 'triangle', 0.28)); break;
    case 'wrong': tone(330, 0, 0.5, 'sawtooth', 0.14, 110); tone(220, 0.08, 0.55, 'square', 0.06, 90); break;
    case 'lifeline': tone(600, 0, 0.35, 'sine', 0.2, 1800); tone(1200, 0.12, 0.25, 'triangle', 0.1, 2400); break;
    case 'tick': tone(1760, 0, 0.05, 'square', 0.08); tone(880, 0, 0.08, 'sine', 0.2); break;
    case 'timeout': tone(392, 0, 0.25, 'square', 0.1); tone(294, 0.22, 0.25, 'square', 0.1); tone(196, 0.44, 0.6, 'sawtooth', 0.12, 120); break;
    case 'win':
      [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => tone(f, i * 0.12, 0.45, 'triangle', 0.26));
      break;
  }
}
