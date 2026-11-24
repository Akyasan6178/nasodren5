// Gerilim müziği: Edvard Grieg — "Dağ Kralının Salonunda" (In the Hall of the Mountain King, 1875).
// Eser kamu malıdır. Hazır kayıt yerine notalar WebAudio ile anlık sentezlenir, böylece kayıt
// telifi de söz konusu olmaz. Süre azaldıkça tempo ve yoğunluk eserin kendisindeki gibi artar.
import { audioOut } from './audio';

const H = null; // önceki nota tutulur
type Step = number | null;

// B minör; değerler B3'e göre yarım ses. Her satır bir ölçü (8 sekizlik).
const THEME: Step[] = [
  0, 2, 3, 5, 7, 3, 7, H,
  6, 2, 6, H, 5, 1, 5, H,
  0, 2, 3, 5, 7, 3, 7, 12,
  10, 7, 3, 7, 10, H, H, H,
  // aynı tema beşli yukarıda (F#)
  7, 9, 11, 12, 14, 11, 14, H,
  15, 11, 15, H, 14, 11, 14, H,
  7, 9, 11, 12, 14, 11, 14, 19,
  17, 14, 11, 14, 17, H, H, H,
];
const B3 = 246.94;
const B2 = 123.47;
const LOOKAHEAD = 0.12; // sn
const TICK_MS = 25;

const hz = (base: number, semis: number) => base * 2 ** (semis / 12);

class Music {
  private gain: GainNode | null = null;
  private timer = 0;
  private step = 0;
  private nextTime = 0;
  private intensity = 0;
  private playing = false;

  /** resume: moladan dönüşte tema baştan değil, kaldığı yerden çalar. */
  start(resume = false) {
    const a = audioOut();
    if (!a) return;
    if (!this.gain) {
      this.gain = a.ac.createGain();
      this.gain.connect(a.out);
    }
    const t = a.ac.currentTime;
    this.gain.gain.cancelScheduledValues(t);
    this.gain.gain.setValueAtTime(0.0001, t);
    this.gain.gain.exponentialRampToValueAtTime(0.55, t + 0.15);
    if (!resume) this.step = 0;
    this.nextTime = t + 0.06;
    this.intensity = 0;
    this.playing = true;
    if (!this.timer) this.timer = window.setInterval(() => this.schedule(), TICK_MS);
  }

  stop() {
    if (!this.playing) return;
    this.playing = false;
    clearInterval(this.timer);
    this.timer = 0;
    const a = audioOut();
    if (a && this.gain) {
      const t = a.ac.currentTime;
      this.gain.gain.cancelScheduledValues(t);
      this.gain.gain.setTargetAtTime(0.0001, t, 0.08);
    }
  }

  /** 0 = sakin, 1 = süre bitmek üzere. */
  setIntensity(v: number) {
    this.intensity = Math.min(1, Math.max(0, v));
  }

  private schedule() {
    const a = audioOut();
    if (!a || !this.playing || document.hidden) return;
    const { ac } = a;
    // Sekme arka plandayken zamanlayıcı kısılır; dönüşte biriken notaları çalmak yerine yeniden hizala.
    if (this.nextTime < ac.currentTime - 0.05) this.nextTime = ac.currentTime + 0.05;
    while (this.nextTime < ac.currentTime + LOOKAHEAD) {
      const dur = 30 / (100 + 85 * this.intensity ** 1.2); // sekizlik süresi
      this.note(ac, this.step, this.nextTime, dur);
      this.nextTime += dur;
      this.step = (this.step + 1) % THEME.length;
    }
  }

  private note(ac: AudioContext, step: number, t: number, dur: number) {
    const k = this.intensity;
    const s = THEME[step];
    if (s !== H) {
      this.pluck(ac, hz(B3, s), t, Math.min(0.32, dur * 1.7), 0.22);
      if (k > 0.45) this.pluck(ac, hz(B3, s + 12), t, Math.min(0.2, dur * 1.2), 0.08 + 0.08 * k);
    }
    // pes "um-pa": dörtlüklerde kök ve beşli sırayla
    if (step % 2 === 0) {
      const root = step < 32 ? 0 : 7;
      this.bass(ac, hz(B2, root + (step % 4 === 0 ? 0 : -5)), t, 0.16);
    }
    // timpani: yoğunluk arttıkça sıklaşır
    if ((step % 8 === 0 && k > 0.25) || (step % 4 === 0 && k > 0.65)) this.timpani(ac, t, 0.18 + 0.3 * k);
  }

  private env(ac: AudioContext, t: number, dur: number, vol: number) {
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(this.gain!);
    return g;
  }

  private pluck(ac: AudioContext, f: number, t: number, dur: number, vol: number) {
    const g = this.env(ac, t, dur, vol);
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1400 + 2600 * this.intensity, t);
    lp.frequency.exponentialRampToValueAtTime(500, t + dur);
    lp.connect(g);
    for (const [type, mul, detune] of [['triangle', 1, 0], ['square', 0.35, 6]] as const) {
      const o = ac.createOscillator();
      const og = ac.createGain();
      o.type = type;
      o.frequency.value = f;
      o.detune.value = detune;
      og.gain.value = mul;
      o.connect(og).connect(lp);
      o.start(t);
      o.stop(t + dur + 0.02);
    }
  }

  private bass(ac: AudioContext, f: number, t: number, dur: number) {
    const g = this.env(ac, t, dur, 0.3);
    const o = ac.createOscillator();
    o.type = 'triangle';
    o.frequency.value = f;
    o.connect(g);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private timpani(ac: AudioContext, t: number, vol: number) {
    const g = this.env(ac, t, 0.35, vol);
    const o = ac.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(98, t);
    o.frequency.exponentialRampToValueAtTime(52, t + 0.3);
    o.connect(g);
    o.start(t);
    o.stop(t + 0.4);
  }
}

export const music = new Music();
