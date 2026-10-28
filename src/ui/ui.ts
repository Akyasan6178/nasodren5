// DOM overlay UI (HUD, screens, toasts). Per the brief, static UI lives in the
// DOM above the canvas, and it is written only when a value actually changes,
// so the HUD costs ~nothing per frame (no layout thrash).

import { FACTS, GHOST_INFO, LINKS, TEXT } from '../config.ts';
import type { Game } from '../game/game.ts';
import type { Location } from '../game/locations.ts';
import { faceDiagram } from './diagram.ts';
import { track } from '../core/analytics.ts';
import { storage } from '../core/storage.ts';

export type ScreenName = 'start' | 'pause' | 'level' | 'over' | null;

export interface UIHandlers {
  onStart(): void;
  onResume(): void;
  onRestart(): void;
  onNext(): void;
  onPause(): void;
  onMute(): void;
  onClick(): void;
}

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

const ICON_PAUSE =
  '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1.5"/><rect x="14" y="5" width="4" height="14" rx="1.5"/></svg>';
const ICON_SOUND =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/><path d="M19 6a8.5 8.5 0 0 1 0 12"/></svg>';
const ICON_MUTE =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor"/><path d="M17 9l5 5M22 9l-5 5"/></svg>';

export class UI {
  readonly stage = $('stage');
  private readonly screens: Record<Exclude<ScreenName, null>, HTMLElement> = {
    start: $('screen-start'),
    pause: $('screen-pause'),
    level: $('screen-level'),
    over: $('screen-over'),
  };
  private readonly el = {
    score: $('hud-score'),
    level: $('hud-level'),
    best: $('hud-best'),
    lives: $('hud-lives'),
    mult: $('hud-mult'),
    cleanPct: $('clean-pct'),
    cleanFill: $('meter-clean').querySelector<HTMLElement>('.fill')!,
    pressure: $('meter-pressure'),
    pressureFill: $('meter-pressure').querySelector<HTMLElement>('.fill')!,
    pressureLabel: $('pressure-label'),
    ready: $('ready'),
    toast: $('toast'),
    mute: $('btn-mute'),
    fact: $('fact'),
    miFact: $('mi-fact'),
    hint: $('hint'),
  };

  // Last-written values (dirty checking).
  private last = { score: -1, level: -1, best: -1, lives: -1, mult: -1, clean: -1, meter: -1, meterMode: '', danger: false };
  private toastTimer = 0;
  private multTimer = 0;
  private factIndex = 0;
  private shareScore = 0;
  private readonly icons: Record<string, string>;
  current: ScreenName = null;

  constructor(icons: Record<string, string>, customUi: Map<string, string>, h: UIHandlers) {
    this.icons = icons;
    // Optional brand images from /gorseller.
    const logo = customUi.get('logo');
    if (logo) {
      const img = document.createElement('img');
      img.src = logo;
      img.alt = TEXT.title;
      img.className = 'logo-img';
      $('brandmark').replaceChildren(img);
    }
    const bg = customUi.get('arka-plan');
    if (bg) document.body.style.backgroundImage = `url("${bg}")`;
    const click = (id: string, fn: () => void): void => {
      $(id).addEventListener('click', () => {
        h.onClick();
        fn();
      });
    };
    click('btn-start', h.onStart);
    click('btn-resume', h.onResume);
    click('btn-restart', h.onRestart);
    click('btn-next', h.onNext);
    click('btn-again', h.onRestart);
    click('btn-pause', h.onPause);
    click('btn-mute', h.onMute);
    click('btn-share', () => void this.share());
    click('btn-copy', () => void this.copyLink());
    $('btn-fact').addEventListener('click', () => this.nextFact());
    $('btn-wa').addEventListener('click', () => track('share', { method: 'whatsapp', score: this.shareScore }));
    $('btn-pause').innerHTML = ICON_PAUSE;
    if (!navigator.share) $('btn-share').hidden = true;

    // CTA links (UTM-tagged) + click tracking.
    const cta = (id: string, href: string, placement: string): void => {
      const a = $<HTMLAnchorElement>(id);
      a.href = href;
      a.addEventListener('click', () => track('cta_click', { placement }));
    };
    cta('lvl-cta', LINKS.levelClear(), 'levelclear');
    cta('over-cta', LINKS.gameOver(), 'gameover');
    cta('side-cta', LINKS.sidebar(), 'sidebar');
    cta('lvl-safety-link', LINKS.safety(), 'safety_level');
    cta('over-safety-link', LINKS.safety(), 'safety_over');
    $('lvl-safety-link').textContent = TEXT.safetyCta;
    $('over-safety-link').textContent = TEXT.safetyCta;
    $('lvl-safety').textContent = TEXT.safety;
    $('over-safety').textContent = TEXT.safety;
    $('lvl-body').textContent = TEXT.levelClearBody;
    $('over-body').textContent = TEXT.gameOverBody;

    this.buildLegend();
    const logoIcon = document.getElementById('logo-icon') as HTMLImageElement | null;
    if (logoIcon) logoIcon.src = icons.player;
    this.startFacts();
    $('where-diagram').innerHTML = faceDiagram(null, { view: 'full', id: 'wd', theme: 'light' });
  }

  private buildLegend(): void {
    const items: Array<[string, string, string]> = [
      ['player', 'Siklamen (Sen)', 'Doğanın temizleyici gücü: mukusu topla, sinüsleri ferahlat.'],
      ['pellet', 'Mukus', 'Yolları tıkayan koyu mukus ve alerjenler. Hepsini temizle!'],
      ['power', 'Siklamen Özü', 'Ozmotik etkiyle semptomları sıvılaştırır; drenaj başlar.'],
      ...GHOST_INFO.map((g, i) => [`ghost${i}`, g.name, g.desc] as [string, string, string]),
      ['fright', 'Drenaj', 'Sıvılaşan semptomlar: üzerlerinden geçerek dışarı at!'],
      ['trap', 'Kimyasal Sprey', 'Kısa rahatlama, ardından rebound tıkanıklık. Uzak dur!'],
    ];
    const byIcon = new Map(items.map((it) => [it[0], it]));
    const row = ([icon, name, desc]: [string, string, string], withDesc: boolean): HTMLLIElement => {
      const li = document.createElement('li');
      const img = document.createElement('img');
      img.src = this.icons[icon];
      img.alt = '';
      const txt = document.createElement('span');
      txt.className = 'txt';
      const b = document.createElement('b');
      b.textContent = name;
      txt.append(b);
      if (withDesc) {
        const s = document.createElement('small');
        s.textContent = desc;
        txt.append(s);
      }
      li.append(img, txt);
      return li;
    };

    // Desktop guide: grouped by what the player should DO with each thing.
    const groups: Array<[string, string, string[]]> = [
      ['Sen ve hedefin', 'goal', ['player', 'pellet']],
      ['Siklamen gücü', 'power', ['power', 'fright']],
      ['Semptomlardan kaç', 'danger', ['ghost0', 'ghost1', 'ghost2', 'ghost3']],
      ['Uzak dur', 'warn', ['trap']],
    ];
    const guide = document.createDocumentFragment();
    for (const [title, kind, icons] of groups) {
      const sec = document.createElement('section');
      sec.className = `guide-group ${kind}`;
      const h = document.createElement('h3');
      h.textContent = title;
      const ul = document.createElement('ul');
      ul.className = 'legend';
      for (const icon of icons) ul.append(row(byIcon.get(icon)!, true));
      sec.append(h, ul);
      guide.append(sec);
    }
    $('legend-side').append(guide);

    const start = document.createDocumentFragment();
    for (const icon of ['player', 'pellet', 'power', 'trap', 'ghost0', 'ghost1', 'ghost2', 'ghost3']) {
      start.append(row(byIcon.get(icon)!, false));
    }
    $('legend-start').append(start);

    // Phone strip: icon + short name only, colour-keyed (good / avoid).
    const mini: Array<[string, string, string]> = [
      ['power', 'Siklamen Özü', 'good'],
      ...GHOST_INFO.map((g, i) => [`ghost${i}`, g.short, 'danger'] as [string, string, string]),
      ['trap', 'Sprey', 'warn'],
    ];
    const frag = document.createDocumentFragment();
    for (const [icon, name, kind] of mini) {
      const li = document.createElement('li');
      li.className = kind;
      const img = document.createElement('img');
      img.src = this.icons[icon];
      img.alt = '';
      const span = document.createElement('span');
      span.textContent = name;
      li.append(img, span);
      frag.append(li);
    }
    $('mi-legend').append(frag);
  }

  private startFacts(): void {
    // Same rotation feeds the desktop side panel and the phone strip. Facts
    // never change on their own mid-run (motion in the corner of the eye pulls
    // focus off the maze): they advance between lives / levels, on request,
    // and slowly while a menu screen is open.
    for (const el of [this.el.fact, this.el.miFact]) el.textContent = FACTS[0];
    window.setInterval(() => {
      if (this.current !== null) this.nextFact();
    }, 12000);
  }

  nextFact(): void {
    const els = [this.el.fact, this.el.miFact];
    for (const el of els) el.classList.add('fading');
    window.setTimeout(() => {
      this.factIndex = (this.factIndex + 1) % FACTS.length;
      for (const el of els) {
        el.textContent = FACTS[this.factIndex];
        el.classList.remove('fading');
      }
    }, 300);
  }

  /** The swipe hint is only useful until the first run starts. */
  hideHint(): void {
    this.el.hint.classList.add('done');
  }

  // ---------------------------------------------------------------- HUD

  updateHud(game: Game): void {
    const L = this.last;
    if (game.score !== L.score) {
      // Big gains (cyclamen, drained symptoms) punch the score.
      if (L.score >= 0 && game.score - L.score >= 50) pop(this.el.score, 1.3);
      L.score = game.score;
      this.el.score.textContent = game.score.toLocaleString('tr-TR');
      const best = Math.max(game.score, storage.best());
      if (best !== L.best) {
        L.best = best;
        this.el.best.textContent = best.toLocaleString('tr-TR');
      }
    }
    if (game.level !== L.level) {
      L.level = game.level;
      this.el.level.textContent = String(game.level);
    }
    if (game.lives !== L.lives) {
      L.lives = game.lives;
      const n = Math.max(0, Math.min(6, game.lives));
      this.el.lives.innerHTML = '';
      for (let i = 0; i < n; i++) {
        const img = document.createElement('img');
        img.src = this.icons.player;
        img.alt = '';
        this.el.lives.append(img);
      }
    }
    if (game.multiplier !== L.mult) {
      const up = game.multiplier > L.mult && L.mult > 0;
      L.mult = game.multiplier;
      this.el.mult.textContent = `x${game.multiplier}`;
      this.el.mult.classList.toggle('hot', game.multiplier > 1);
      if (up) {
        this.el.mult.classList.add('bump');
        window.clearTimeout(this.multTimer);
        this.multTimer = window.setTimeout(() => this.el.mult.classList.remove('bump'), 150);
      }
    }
    const clean = Math.round((1 - game.pelletsLeft / game.totalPellets) * 100);
    if (clean !== L.clean) {
      // Every quarter cleaned is a small milestone.
      if (L.clean >= 0 && Math.floor(clean / 25) > Math.floor(L.clean / 25)) pop(this.el.cleanPct, 1.45);
      L.clean = clean;
      this.el.cleanPct.textContent = `${clean}%`;
      this.el.cleanFill.style.transform = `scaleX(${clean / 100})`;
    }

    // Pressure meter doubles as the cyclamen timer / rebound indicator.
    let mode: string;
    let v: number;
    if (game.frightTimer > 0) {
      mode = 'power';
      v = game.frightTimer / game.frightTotal;
    } else if (game.reboundTimer > 0) {
      mode = 'rebound';
      v = 1;
    } else {
      mode = 'pressure';
      v = game.pressure();
    }
    if (mode !== L.meterMode) {
      L.meterMode = mode;
      this.el.pressure.classList.toggle('power', mode === 'power');
      this.el.pressure.classList.toggle('rebound', mode === 'rebound');
      this.el.pressureLabel.textContent =
        mode === 'power' ? 'Siklamen Etkisi' : mode === 'rebound' ? 'Rebound Tıkanıklık!' : 'Semptom Baskısı';
    }
    const danger = mode === 'rebound' || (mode === 'pressure' && v >= 0.75);
    if (danger !== L.danger) {
      L.danger = danger;
      this.el.pressure.classList.toggle('danger', danger);
    }
    const q = Math.round(v * 200) / 200;
    if (q !== L.meter) {
      L.meter = q;
      this.el.pressureFill.style.transform = `scaleX(${q})`;
    }
  }

  setMuted(m: boolean): void {
    this.el.mute.innerHTML = m ? ICON_MUTE : ICON_SOUND;
    this.el.mute.setAttribute('aria-pressed', String(m));
  }

  // ------------------------------------------------------------ overlays

  showReady(on: boolean, text: string = TEXT.ready): void {
    this.el.ready.hidden = !on;
    if (on) this.el.ready.textContent = text;
  }

  /** Positions the READY label in stage CSS pixels (maze-aligned). */
  placeReady(x: number, y: number, fontPx: number): void {
    const s = this.el.ready.style;
    s.left = `${x}px`;
    s.top = `${y}px`;
    s.fontSize = `${fontPx}px`;
  }

  toast(text: string, kind: 'info' | 'power' | 'warn' = 'info', ms = 2600): void {
    const t = this.el.toast;
    t.textContent = text;
    t.className = `toast show ${kind}`;
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => (t.className = `toast ${kind}`), ms);
  }

  show(name: ScreenName): void {
    this.current = name;
    for (const [k, el] of Object.entries(this.screens)) el.hidden = k !== name;
    if (name === 'start') $('start-best').textContent = storage.best().toLocaleString('tr-TR');
    // Keyboard users can hit Enter right away; skip on touch (no focus ring).
    if (name && matchMedia('(pointer: fine)').matches) {
      this.screens[name].querySelector<HTMLElement>('.btn.primary')?.focus({ preventScroll: true });
    }
  }

  /** Location card shown while a level's READY phase runs. */
  showLevelIntro(level: number, loc: Location): void {
    const card = $('level-card');
    card.innerHTML = `<div class="lc-head"><span class="lc-step">Bölüm ${level}</span><span class="lc-name"></span></div>
      <div class="lc-diagram">${faceDiagram(loc.region, { marker: this.icons.player, view: 'card', id: 'lc', theme: 'light' })}</div>
      <p class="lc-blurb"></p>`;
    card.querySelector('.lc-name')!.textContent = loc.name;
    card.querySelector('.lc-blurb')!.textContent = loc.blurb;
    card.hidden = false;
    card.classList.remove('out');
    // Desktop side panel keeps a persistent "you are here" map.
    $('where-diagram').innerHTML = faceDiagram(loc.region, { marker: this.icons.player, view: 'full', id: 'wd', theme: 'light' });
    $('where-name').textContent = loc.name;
    $('mi-loc').textContent = loc.name;
    $('where-blurb').textContent = loc.blurb;
    if (level > 1) this.nextFact();
  }

  hideLevelIntro(): void {
    const card = $('level-card');
    if (card.hidden) return;
    card.classList.add('out');
    window.setTimeout(() => (card.hidden = true), 260);
  }

  showLevelClear(game: Game): void {
    $('lvl-num').textContent = game.location.name;
    $('lvl-score').textContent = game.score.toLocaleString('tr-TR');
    this.show('level');
  }

  showGameOver(score: number, isRecord: boolean): void {
    this.shareScore = score;
    $('over-score').textContent = score.toLocaleString('tr-TR');
    $('over-best').textContent = storage.best().toLocaleString('tr-TR');
    $('over-record').hidden = !isRecord;
    $<HTMLAnchorElement>('btn-wa').href = `https://wa.me/?text=${encodeURIComponent(`${TEXT.shareText(score)} ${shareUrl()}`)}`;
    this.show('over');
  }

  // ------------------------------------------------------------ sharing

  private async share(): Promise<void> {
    const text = TEXT.shareText(this.shareScore);
    try {
      await navigator.share({ title: TEXT.title, text, url: shareUrl() });
      track('share', { method: 'native', score: this.shareScore });
    } catch {
      /* user cancelled */
    }
  }

  private async copyLink(): Promise<void> {
    const text = `${TEXT.shareText(this.shareScore)} ${shareUrl()}`;
    try {
      await navigator.clipboard.writeText(text);
      this.toast('Link kopyalandı!', 'info', 1600);
      track('share', { method: 'copy', score: this.shareScore });
    } catch {
      this.toast('Kopyalanamadı', 'warn', 1600);
    }
  }
}

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

/** Short compositor-only "punch" (no layout, no class churn). */
function pop(el: HTMLElement, scale: number): void {
  if (reducedMotion.matches) return;
  el.animate([{ transform: 'scale(1)' }, { transform: `scale(${scale})` }, { transform: 'scale(1)' }], {
    duration: 260,
    easing: 'cubic-bezier(0.2, 1.4, 0.4, 1)',
  });
}

function shareUrl(): string {
  const u = new URL(location.href);
  u.search = 'utm_source=share&utm_medium=social&utm_campaign=siklamen_awareness';
  u.hash = '';
  return u.toString();
}
