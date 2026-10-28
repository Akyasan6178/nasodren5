// Procedural chiptune + SFX on WebAudio. No audio files to download.
// Psychoacoustic design from the brief: while "congested", the music runs
// through a low-pass + echo (muffled, blocked-ear feel); cyclamen lifts the
// filter instantly with a breath/wind whoosh and a brighter, faster groove.

const LOOKAHEAD = 0.15;
const TICK_MS = 25;
const MUFFLED_HZ = 620;
const CLEAR_HZ = 16000;

type Prog = ReadonlyArray<readonly [root: number, minor: boolean]>;
const PROG_BLOCKED: Prog = [
  [45, true],
  [41, false],
  [48, false],
  [43, false],
];
const PROG_CLEAR: Prog = [
  [48, false],
  [43, false],
  [45, true],
  [41, false],
];

const mtof = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

/**
 * Continuous background loop, like the arcade's siren. One oscillator whose
 * pitch is swept by an LFO; only its parameters change between modes.
 *  - siren: a congested "whine" that climbs in 5 steps as the sinuses clear
 *  - fright: fast, low gurgle while symptoms are liquefied (drainage)
 *  - eyes: quick rising whistle while eaten symptoms flee back home
 */
export type LoopMode = 'none' | 'siren' | 'fright' | 'eyes';
export const SIREN_STEPS = 5;
interface LoopVoice {
  wave: OscillatorType;
  lfo: OscillatorType;
  base: number; // Hz
  depth: number; // Hz of pitch sweep
  rate: number; // sweeps per second
  gain: number;
}
const LOOP_VOICE: Record<Exclude<LoopMode, 'none'>, (step: number) => LoopVoice> = {
  siren: (s) => ({ wave: 'triangle', lfo: 'triangle', base: 360 + s * 45, depth: 95, rate: 2.4 + s * 0.4, gain: 0.032 }),
  fright: () => ({ wave: 'triangle', lfo: 'square', base: 210, depth: 55, rate: 9, gain: 0.03 }),
  eyes: () => ({ wave: 'sine', lfo: 'sawtooth', base: 1050, depth: 380, rate: 10, gain: 0.03 }),
};

export type Sfx =
  | 'pellet'
  | 'power'
  | 'ghost'
  | 'death'
  | 'levelclear'
  | 'trap'
  | 'rebound'
  | 'extralife'
  | 'start'
  | 'frightEnd'
  | 'combo'
  | 'click';

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicGain!: GainNode;
  private musicFilter!: BiquadFilterNode;
  private echoSend!: GainNode;
  private sfxGain!: GainNode;
  private noise!: AudioBuffer;
  private timer = 0;
  private step = 0;
  private nextTime = 0;
  private clear = false;
  private musicOn = false;
  private pelletFlip = false;
  private loopOsc: OscillatorNode | null = null;
  private loopLfo!: OscillatorNode;
  private loopDepth!: GainNode;
  private loopGain!: GainNode;
  private loopMode: LoopMode = 'none';
  private loopStep = -1;
  muted = false;

  /** Must be called from a user gesture (iOS/Safari autoplay policy). */
  unlock(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      const ctx = new Ctor({ latencyHint: 'interactive' });
      this.ctx = ctx;
      this.build(ctx);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private build(ctx: AudioContext): void {
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    this.master.connect(comp).connect(ctx.destination);

    this.musicFilter = ctx.createBiquadFilter();
    this.musicFilter.type = 'lowpass';
    this.musicFilter.frequency.value = MUFFLED_HZ;
    this.musicFilter.Q.value = 0.9;
    this.musicGain = ctx.createGain();
    this.musicGain.gain.value = 0.55;
    this.musicGain.connect(this.musicFilter).connect(this.master);

    // Echo (the "reverberant, blocked" feel).
    const delay = ctx.createDelay(1);
    delay.delayTime.value = 0.28;
    const fb = ctx.createGain();
    fb.gain.value = 0.38;
    const wetFilter = ctx.createBiquadFilter();
    wetFilter.type = 'lowpass';
    wetFilter.frequency.value = 1800;
    this.echoSend = ctx.createGain();
    this.echoSend.gain.value = 0.45;
    this.musicFilter.connect(this.echoSend).connect(delay);
    delay.connect(wetFilter).connect(fb).connect(delay);
    wetFilter.connect(this.master);

    this.sfxGain = ctx.createGain();
    this.sfxGain.gain.value = 0.9;
    this.sfxGain.connect(this.master);

    const len = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.02);
  }

  suspend(): void {
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend();
  }

  resume(): void {
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
  }

  // ------------------------------------------------------------- music

  startMusic(): void {
    if (!this.ctx || this.musicOn) return;
    this.musicOn = true;
    this.step = 0;
    this.nextTime = this.ctx.currentTime + 0.06;
    this.musicGain.gain.setTargetAtTime(0.55, this.ctx.currentTime, 0.05);
    this.timer = window.setInterval(() => this.schedule(), TICK_MS);
  }

  stopMusic(): void {
    if (!this.musicOn) return;
    this.musicOn = false;
    window.clearInterval(this.timer);
    if (this.ctx) this.musicGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.08);
  }

  setClear(on: boolean): void {
    if (on === this.clear) return;
    this.clear = on;
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const f = this.musicFilter.frequency;
    f.cancelScheduledValues(t);
    f.setValueAtTime(f.value, t);
    if (on) {
      f.exponentialRampToValueAtTime(CLEAR_HZ, t + 0.18);
      this.echoSend.gain.setTargetAtTime(0.12, t, 0.1);
    } else {
      f.exponentialRampToValueAtTime(MUFFLED_HZ, t + 0.9);
      this.echoSend.gain.setTargetAtTime(0.45, t, 0.4);
    }
  }

  private schedule(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    // After a long stall (tab switch), resync instead of bursting notes.
    if (this.nextTime < ctx.currentTime - 0.2) this.nextTime = ctx.currentTime + 0.05;
    while (this.nextTime < ctx.currentTime + LOOKAHEAD) {
      this.playStep(this.step, this.nextTime);
      this.nextTime += this.clear ? 60 / 132 / 4 : 60 / 100 / 4;
      this.step = (this.step + 1) % 64;
    }
  }

  private playStep(step: number, t: number): void {
    const bar = step >> 4;
    const s = step & 15;
    const prog = this.clear ? PROG_CLEAR : PROG_BLOCKED;
    const [root, minor] = prog[bar];
    const chord = [0, minor ? 3 : 4, 7];
    const out = this.musicGain;

    if (!this.clear) {
      if (s === 0 || s === 3 || s === 8 || s === 11) this.tone('triangle', mtof(root), t, 0.28, 0.26, out);
      if (s === 0 || s === 8) this.kick(t, 0.5, out);
      if (s === 0) for (const c of chord) this.tone('sine', mtof(root + 24 + c), t, 2.2, 0.035, out, 0.4);
      if (s === 6 || s === 14) this.tone('triangle', mtof(root + 24 + chord[(bar + s) % 3] + 12), t, 0.3, 0.07, out);
    } else {
      this.tone('triangle', mtof(root + (s & 2 ? 12 : 0)), t, 0.1, 0.24, out);
      if ((s & 3) === 0) this.kick(t, 0.65, out);
      if ((s & 3) === 2) this.hat(t, out);
      const arp = [0, 1, 2, 1, 2, 0, 1, 2];
      const n = root + 36 + chord[arp[s & 7]] + (s >= 8 ? 12 : 0);
      this.tone('square', mtof(n), t, 0.08, 0.05, out);
      if (s === 0) for (const c of chord) this.tone('sine', mtof(root + 24 + c), t, 1.6, 0.03, out, 0.05);
    }
  }

  // ------------------------------------------------------------- loop

  /** Call every frame; it only touches the audio graph when mode or siren step changes. */
  setLoop(mode: LoopMode, progress = 0): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const step = mode === 'siren' ? Math.min(SIREN_STEPS - 1, Math.floor(progress * SIREN_STEPS)) : 0;
    if (mode === this.loopMode && step === this.loopStep) return;
    this.loopMode = mode;
    this.loopStep = step;
    if (!this.loopOsc) {
      this.loopOsc = ctx.createOscillator();
      this.loopLfo = ctx.createOscillator();
      this.loopDepth = ctx.createGain();
      this.loopGain = ctx.createGain();
      this.loopGain.gain.value = 0;
      const soft = ctx.createBiquadFilter();
      soft.type = 'lowpass';
      soft.frequency.value = 1800;
      this.loopLfo.connect(this.loopDepth).connect(this.loopOsc.frequency);
      this.loopOsc.connect(soft).connect(this.loopGain).connect(this.sfxGain);
      this.loopOsc.start();
      this.loopLfo.start();
    }
    const t = ctx.currentTime;
    if (mode === 'none') {
      this.loopGain.gain.setTargetAtTime(0, t, 0.05);
      return;
    }
    const v = LOOP_VOICE[mode](step);
    this.loopOsc.type = v.wave;
    this.loopLfo.type = v.lfo;
    this.loopOsc.frequency.setTargetAtTime(v.base, t, 0.03);
    this.loopDepth.gain.setTargetAtTime(v.depth, t, 0.03);
    this.loopLfo.frequency.setTargetAtTime(v.rate, t, 0.03);
    this.loopGain.gain.setTargetAtTime(v.gain, t, 0.06);
  }

  // ------------------------------------------------------------- voices

  private tone(
    type: OscillatorType,
    freq: number,
    t: number,
    dur: number,
    gain: number,
    dest: AudioNode,
    attack = 0.005,
  ): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(attack + 0.01, dur));
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private sweep(
    type: OscillatorType,
    f0: number,
    f1: number,
    t: number,
    dur: number,
    gain: number,
    dest: AudioNode = this.sfxGain,
  ): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private noiseBurst(
    t: number,
    dur: number,
    gain: number,
    filter: BiquadFilterType,
    f0: number,
    f1: number,
    q = 0.8,
    attack = 0.005,
    dest: AudioNode = this.sfxGain,
  ): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const bf = ctx.createBiquadFilter();
    bf.type = filter;
    bf.Q.value = q;
    bf.frequency.setValueAtTime(f0, t);
    bf.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bf).connect(g).connect(dest);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  private kick(t: number, gain: number, dest: AudioNode): void {
    this.sweep('sine', 150, 42, t, 0.22, gain, dest);
  }

  private hat(t: number, dest: AudioNode): void {
    this.noiseBurst(t, 0.05, 0.12, 'highpass', 7000, 9000, 0.7, 0.002, dest);
  }

  // ------------------------------------------------------------- sfx

  play(name: Sfx): void {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const t = ctx.currentTime + 0.005;
    switch (name) {
      case 'pellet': {
        // Soft "bubble pop"; alternates pitch like a chomp.
        this.pelletFlip = !this.pelletFlip;
        const f = this.pelletFlip ? 520 : 680;
        this.sweep('triangle', f, f * 1.6, t, 0.06, 0.11);
        break;
      }
      case 'power':
        // Deep breath / airflow: band-passed noise sweeping open, then sparkle.
        this.noiseBurst(t, 0.95, 0.55, 'bandpass', 300, 2600, 0.9, 0.3);
        this.noiseBurst(t + 0.05, 0.7, 0.22, 'highpass', 2500, 6000, 0.5, 0.2);
        [76, 81, 85, 88].forEach((m, i) => this.tone('sine', mtof(m), t + 0.18 + i * 0.06, 0.35, 0.12, this.sfxGain));
        break;
      case 'ghost':
        // Liquid flush: falling low-pass noise + gurgle.
        this.noiseBurst(t, 0.5, 0.5, 'lowpass', 3200, 180, 2.5, 0.01);
        this.sweep('sine', 900, 110, t, 0.38, 0.28);
        this.sweep('sine', 500, 160, t + 0.12, 0.25, 0.16);
        break;
      case 'death':
        this.sweep('sawtooth', 520, 70, t, 1.2, 0.12);
        this.sweep('triangle', 780, 90, t, 1.2, 0.14);
        this.noiseBurst(t + 0.9, 0.5, 0.25, 'lowpass', 1200, 200, 1, 0.05);
        break;
      case 'levelclear':
        [69, 73, 76, 81, 85, 88].forEach((m, i) => this.tone('square', mtof(m), t + i * 0.09, 0.25, 0.07, this.sfxGain));
        this.noiseBurst(t, 1.2, 0.2, 'bandpass', 600, 3000, 0.8, 0.4);
        break;
      case 'trap':
        this.noiseBurst(t, 0.35, 0.35, 'highpass', 3500, 5000, 0.6, 0.01);
        this.noiseBurst(t + 0.12, 0.3, 0.25, 'highpass', 3500, 5000, 0.6, 0.01);
        break;
      case 'rebound':
        this.sweep('sine', 120, 38, t, 0.6, 0.6);
        this.noiseBurst(t, 0.6, 0.35, 'lowpass', 600, 120, 1.5, 0.01);
        break;
      case 'extralife':
        [81, 88, 93].forEach((m, i) => this.tone('sine', mtof(m), t + i * 0.08, 0.3, 0.14, this.sfxGain));
        break;
      case 'start':
        [57, 64, 69, 72, 76].forEach((m, i) => this.tone('triangle', mtof(m), t + i * 0.11, 0.22, 0.15, this.sfxGain));
        break;
      case 'frightEnd':
        this.sweep('triangle', 900, 300, t, 0.35, 0.07);
        break;
      case 'combo':
        this.sweep('square', 600, 1200, t, 0.09, 0.05);
        break;
      case 'click':
        this.tone('triangle', 880, t, 0.05, 0.08, this.sfxGain);
        break;
    }
  }
}
