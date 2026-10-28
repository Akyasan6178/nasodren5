import { Application } from 'pixi.js';
import { SIM_STEP, TEXT } from './config.ts';
import { AudioEngine, type LoopMode } from './core/audio.ts';
import { track } from './core/analytics.ts';
import { Input } from './core/input.ts';
import { storage } from './core/storage.ts';
import { Game, type GameEvent } from './game/game.ts';
import { LOCATIONS } from './game/locations.ts';
import { COLS, ROWS, validateLayout } from './game/maze.ts';
import { drawIcons } from './render/art.ts';
import { loadCustomArt } from './render/custom.ts';
import { buildAtlas, buildMazeTextures, type Atlas, type MazeTextures } from './render/atlas.ts';
import { GameView } from './render/view.ts';
import { UI } from './ui/ui.ts';

const MAX_FRAME = 0.1; // clamp long frames (tab switch, GC) to avoid a spiral of death
const MIN_TILE_TX = 10;
const MAX_TILE_TX = 72;
const debug = new URLSearchParams(location.search).has('debug');

async function boot(): Promise<void> {
  if (import.meta.env.DEV) {
    LOCATIONS.forEach((loc) => {
      const errs = validateLayout(loc.layout);
      if (errs.length) console.error(`Maze "${loc.name}" failed validation`, errs);
    });
  }

  const custom = await loadCustomArt();
  const game = new Game();
  const audio = new AudioEngine();
  audio.muted = storage.muted();

  let paused = false;
  let firstReadyOfGame = false;
  let powerToastShown = false;

  const ui = new UI(drawIcons(48, custom), custom.ui, {
    onStart: () => startGame(),
    onRestart: () => startGame(),
    onResume: () => setPaused(false),
    onNext: () => {
      ui.show(null);
      game.nextLevel();
      track('level_start', { level: game.level });
    },
    onPause: () => togglePause(),
    onMute: () => toggleMute(),
    onClick: () => {
      audio.unlock();
      audio.play('click');
    },
  });
  ui.setMuted(audio.muted);

  // ---------------------------------------------------------------- renderer
  let resolution = Math.min(window.devicePixelRatio || 1, 2);
  const app = new Application();
  await app.init({
    width: Math.max(1, ui.stage.clientWidth),
    height: Math.max(1, ui.stage.clientHeight),
    resolution,
    autoDensity: true,
    antialias: false, // all art is pre-rendered smooth; MSAA would only cost fill-rate
    backgroundColor: 0xfff1ec,
    powerPreference: 'high-performance',
    preference: 'webgl',
    hello: false,
  });
  ui.stage.prepend(app.canvas);
  app.ticker.maxFPS = 0;

  let atlas: Atlas | null = null;
  let view: GameView | null = null;
  // Maze textures per location, valid for the current atlas tile size.
  const mazeCache = new Map<number, MazeTextures>();
  const mazeFor = (locIndex: number): MazeTextures => {
    let m = mazeCache.get(locIndex);
    if (!m) {
      const loc = LOCATIONS[locIndex];
      m = buildMazeTextures(atlas!.tile, loc, locIndex + 1);
      mazeCache.set(locIndex, m);
    }
    return m;
  };
  const locIndex = (level: number): number => (level - 1) % LOCATIONS.length;
  const placement = { scale: 1, ox: 0, oy: 0 };

  /** (Re)creates the scene for the current level's location. */
  const rebuildView = (): void => {
    const oldView = view;
    view = new GameView(atlas!, mazeFor(locIndex(game.level)), game);
    view.lowFx = oldView?.lowFx ?? false;
    view.root.scale.set(placement.scale);
    view.root.position.set(placement.ox, placement.oy);
    app.stage.addChild(view.root);
    oldView?.destroy();
    // Keep only the current and next location's baked textures in GPU memory.
    const keep = new Set([locIndex(game.level), locIndex(game.level + 1)]);
    for (const [k, m] of mazeCache) {
      if (!keep.has(k)) {
        m.destroy();
        mazeCache.delete(k);
      }
    }
  };

  const rebuild = (tile: number): void => {
    const oldAtlas = atlas;
    for (const m of mazeCache.values()) m.destroy();
    mazeCache.clear();
    atlas = buildAtlas(tile, custom);
    rebuildView();
    oldAtlas?.destroy();
  };

  /** Builds the next location's maze texture while the player reads the level-clear card. */
  const prewarmNext = (): void => {
    window.setTimeout(() => {
      if (atlas) mazeFor(locIndex(game.level + 1));
    }, 120);
  };

  const mobileInfo = document.getElementById('mobile-info')!;
  let lastW = 0;
  let lastH = 0;
  const layout = (force = false): void => {
    const w = Math.max(1, ui.stage.clientWidth);
    const h = Math.max(1, ui.stage.clientHeight);
    if (!force && w === lastW && h === lastH) return;
    lastW = w;
    lastH = h;
    app.renderer.resize(w, h, resolution);
    const T = Math.min(w / COLS, h / ROWS); // CSS px per tile
    const tile = clamp(Math.round(T * resolution), MIN_TILE_TX, MAX_TILE_TX);
    if (force || !atlas || Math.abs(tile - atlas.tile) / atlas.tile > 0.12) rebuild(tile);
    const v = view!;
    const scale = T / atlas!.tile;
    const ox = Math.round((w - COLS * T) / 2);
    // Portrait phones: sit slightly above center, leaving a thumb swipe zone below
    // (the info strip, when shown, already is that zone, so stay centered).
    const thumbZone = h > w * 1.25 && mobileInfo.offsetParent === null;
    const oy = Math.round((h - ROWS * T) * (thumbZone ? 0.3 : 0.5));
    placement.scale = scale;
    placement.ox = ox;
    placement.oy = oy;
    v.root.scale.set(scale);
    v.root.position.set(ox, oy);
    ui.placeReady(ox + 14 * T, oy + 17.5 * T, Math.max(14, T * 1.05));
    input.threshold = clamp(T * 1.1, 14, 30);
  };

  // ---------------------------------------------------------------- input
  const input = new Input({
    onDir: (d) => {
      if (!paused) game.setWant(d);
    },
    onPause: () => togglePause(),
    onMute: () => toggleMute(),
  });

  new ResizeObserver(() => layout()).observe(ui.stage);
  window.addEventListener('orientationchange', () => window.setTimeout(() => layout(true), 250));
  layout(true);

  // ---------------------------------------------------------------- flow
  function startGame(): void {
    audio.unlock();
    audio.stopMusic();
    audio.setClear(false);
    paused = false;
    powerToastShown = false;
    firstReadyOfGame = true;
    ui.show(null);
    game.newGame();
    track('game_start');
  }

  function canPause(): boolean {
    return game.phase === 'ready' || game.phase === 'playing' || game.phase === 'dying';
  }

  function setPaused(p: boolean): void {
    if (p && !canPause()) return;
    paused = p;
    ui.show(p ? 'pause' : null);
    if (p) audio.suspend();
    else audio.resume();
  }

  function togglePause(): void {
    if (ui.current === 'pause') setPaused(false);
    else if (ui.current === null) setPaused(true);
  }

  function toggleMute(): void {
    audio.unlock();
    audio.setMuted(!audio.muted);
    storage.setMuted(audio.muted);
    ui.setMuted(audio.muted);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (canPause() && !paused) setPaused(true);
      audio.suspend();
      app.ticker.stop();
    } else {
      app.ticker.start();
      if (!paused) audio.resume();
    }
  });

  // ---------------------------------------------------------------- events
  const onEvent = (e: GameEvent): void => {
    if (e.type === 'levelStart') {
      rebuildView();
      ui.showLevelIntro(game.level, game.location);
    }
    view!.handle(e, game);
    switch (e.type) {
      case 'pellet':
        audio.play('pellet');
        break;
      case 'multiplier':
        if (e.value > 1) audio.play('combo');
        break;
      case 'power':
        audio.play('power');
        audio.setClear(true);
        if (!powerToastShown) {
          powerToastShown = true;
          ui.toast(TEXT.toastPower, 'power');
        }
        break;
      case 'frightEnd':
        audio.setClear(false);
        audio.play('frightEnd');
        break;
      case 'ghostEaten':
        audio.play('ghost');
        break;
      case 'death':
        audio.stopMusic();
        audio.setClear(false);
        break;
      case 'deathAnim':
        audio.play('death');
        ui.nextFact();
        break;
      case 'ready':
        ui.showReady(true);
        if (firstReadyOfGame) {
          audio.play('start');
          firstReadyOfGame = false;
        }
        break;
      case 'go':
        ui.showReady(false);
        ui.hideLevelIntro();
        ui.hideHint();
        audio.startMusic();
        break;
      case 'levelClear':
        audio.stopMusic();
        audio.setClear(false);
        audio.play('levelclear');
        break;
      case 'levelClearDone':
        ui.showLevelClear(game);
        prewarmNext();
        track('level_clear', { level: game.level, score: game.score });
        break;
      case 'gameOver': {
        const record = storage.submit(game.score);
        ui.showGameOver(game.score, record);
        track('game_over', { level: game.level, score: game.score, record });
        break;
      }
      case 'trapTaken':
        audio.play('trap');
        ui.toast(TEXT.toastTrap, 'info', 2000);
        break;
      case 'reboundStart':
        audio.play('rebound');
        ui.toast(TEXT.toastRebound, 'warn', 3200);
        break;
      case 'extraLife':
        audio.play('extralife');
        ui.toast(TEXT.toastExtraLife, 'power', 1800);
        break;
      case 'pressureHigh':
        ui.toast(TEXT.toastPressure, 'warn');
        break;
      default:
        break;
    }
  };

  /** Which background loop fits the moment (eyes beat drainage beats the siren). */
  const loopMode = (): LoopMode => {
    if (paused || game.phase !== 'playing') return 'none';
    for (const g of game.ghosts) if (g.eaten) return 'eyes';
    return game.frightTimer > 0 ? 'fright' : 'siren';
  };

  // ---------------------------------------------------------------- governor
  // Dynamic quality: if frames run long for a sustained period, drop render
  // resolution (fill-rate is the usual mobile bottleneck), then trim effects.
  let ema = 1000 / 60;
  let slowMs = 0;
  let warmup = 3;
  const governor = (dtMs: number, dt: number): void => {
    if (warmup > 0) {
      warmup -= dt;
      return;
    }
    if (dtMs > 100) return;
    ema += (dtMs - ema) * 0.05;
    slowMs = ema > 19.5 ? slowMs + dtMs : Math.max(0, slowMs - dtMs * 0.5);
    if (slowMs < 2500) return;
    slowMs = 0;
    warmup = 2;
    if (resolution > 1) {
      resolution = Math.max(1, resolution - 0.5);
      layout(true);
      if (debug) console.info('[governor] resolution ->', resolution);
    } else if (view && !view.lowFx) {
      view.lowFx = true;
      if (debug) console.info('[governor] low fx');
    }
  };

  // ---------------------------------------------------------------- loop
  const fpsEl = document.getElementById('fps')!;
  fpsEl.hidden = !debug;
  let fpsFrames = 0;
  let fpsTime = 0;
  let worst = 0;
  let acc = 0;
  let lastBg = -1;

  app.ticker.add((ticker) => {
    const dtMs = ticker.deltaMS;
    const dt = Math.min(dtMs / 1000, MAX_FRAME);

    if (!paused) {
      acc += dt;
      while (acc >= SIM_STEP) {
        game.step(SIM_STEP);
        acc -= SIM_STEP;
        if (game.events.length) {
          for (let i = 0; i < game.events.length; i++) onEvent(game.events[i]);
          game.events.length = 0;
        }
      }
    }
    // Read after the sim: a level change during the steps swaps the view.
    const v = view!;
    v.update(game, paused ? 1 : acc / SIM_STEP, paused ? 0 : dt);
    if (v.bgColor !== lastBg) {
      lastBg = v.bgColor;
      app.renderer.background.color = lastBg;
    }
    ui.updateHud(game);
    audio.setLoop(loopMode(), 1 - game.pelletsLeft / game.totalPellets);
    governor(dtMs, dt);

    if (debug) {
      fpsFrames++;
      fpsTime += dtMs;
      worst = Math.max(worst, dtMs);
      if (fpsTime >= 500) {
        fpsEl.textContent = `${((fpsFrames * 1000) / fpsTime).toFixed(0)} fps  worst ${worst.toFixed(1)}ms\nres ${resolution} tile ${atlas?.tile}${v.lowFx ? ' lowfx' : ''}`;
        fpsFrames = 0;
        fpsTime = 0;
        worst = 0;
      }
    }
  });

  ui.show('start');

  if (debug) {
    // QA hooks (only with ?debug): force states for visual testing.
    const g = game as unknown as Record<string, (...a: unknown[]) => void>;
    (window as unknown as Record<string, unknown>).__game = {
      game,
      debugPower: () => {
        g.startFright();
        onEvent({ type: 'power', x: 1, y: 3 });
      },
      debugRebound: () => g.startRebound(),
      debugLevel: (n: number) => {
        ui.show(null);
        game.level = n - 1;
        game.nextLevel();
      },
      debugGameOver: () => {
        game.lives = 1;
        g.setPhase('dying');
        onEvent({ type: 'death' });
      },
    };
  }
}

function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}

void boot();
