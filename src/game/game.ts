// Deterministic, render-agnostic simulation. Advanced in fixed steps (SIM_STEP);
// the view interpolates between (px,py) and (x,y). No per-step allocations on
// the hot path except the occasional event object.

import {
  COMBO,
  EXTRA_LIFE_SCORE,
  FULL_SPEED,
  PRESSURE,
  SCORE,
  START_LIVES,
  TRAP,
  levelSpec,
  type LevelSpec,
} from '../config.ts';
import {
  BONUS_POS,
  COLS,
  DOOR_X,
  DOWN,
  DX,
  DY,
  HOUSE,
  HOUSE_CENTER_Y,
  HOUSE_EXIT_Y,
  LEFT,
  NONE,
  PLAYER_START,
  RIGHT,
  ROWS,
  T_EMPTY,
  T_PELLET,
  T_POWER,
  UP,
  WRAP_PERIOD,
  isCorridor,
  opposite,
} from './maze.ts';
import { type Location, locationForLevel } from './locations.ts';
import { Rng } from './rng.ts';

export const G_HOUSE = 0;
export const G_LEAVING = 1;
export const G_ACTIVE = 2;
export const G_ENTERING = 3;

export const BLINKY = 0;
export const PINKY = 1;
export const INKY = 2;
export const CLYDE = 3;

export type Phase = 'idle' | 'ready' | 'playing' | 'dying' | 'levelclear' | 'intermission' | 'gameover';

export const READY_TIME = 1.9;
/** Longer intro at the start of each level (location card is shown). */
export const LEVEL_INTRO_TIME = 3.4;
export const DEATH_FREEZE = 0.8;
export const DEATH_ANIM = 1.4;
export const LEVEL_CLEAR_TIME = 2.2;
export const GHOST_EAT_FREEZE = 0.55;
const COLLIDE_DIST2 = 0.6 * 0.6;
const EPS = 1e-6;

export interface Actor {
  x: number;
  y: number;
  px: number;
  py: number;
  dir: number;
}

export interface Player extends Actor {
  want: number;
  moving: boolean;
  travel: number; // accumulated distance, drives the mouth animation
}

export interface Ghost extends Actor {
  id: number;
  state: number;
  fright: boolean;
  eaten: boolean;
  homeX: number;
  dotCounter: number;
}

export type GameEvent =
  | { type: 'pellet'; x: number; y: number; multiplier: number }
  | { type: 'power'; x: number; y: number }
  | { type: 'ghostEaten'; x: number; y: number; points: number; ghost: number }
  | { type: 'frightEnd' }
  | { type: 'death' }
  | { type: 'deathAnim' }
  | { type: 'levelClear' }
  | { type: 'levelClearDone' }
  | { type: 'gameOver' }
  | { type: 'levelStart' }
  | { type: 'ready' }
  | { type: 'go' }
  | { type: 'trapSpawn' }
  | { type: 'trapExpire' }
  | { type: 'trapTaken'; x: number; y: number }
  | { type: 'reboundStart' }
  | { type: 'reboundEnd' }
  | { type: 'extraLife' }
  | { type: 'pressureHigh' }
  | { type: 'multiplier'; value: number };

const SCATTER_TARGETS: ReadonlyArray<readonly [number, number]> = [
  [COLS - 3, -3],
  [2, -3],
  [COLS - 1, ROWS + 2],
  [0, ROWS + 2],
];
const HOUSE_X = [DOOR_X, DOOR_X, DOOR_X - 2, DOOR_X + 2];
const RELEASE_ORDER = [PINKY, INKY, CLYDE] as const;

export class Game {
  readonly grid: Uint8Array;
  /** Per-row tunnel flags of the current layout. */
  readonly tunnels: Uint8Array;
  /** Swollen (rebound) tiles, temporarily treated as walls. */
  readonly blocked: Uint8Array;
  totalPellets = 0;
  location: Location = locationForLevel(1);
  private readyTime = READY_TIME;
  readonly player: Player;
  readonly ghosts: Ghost[];
  readonly events: GameEvent[] = [];

  phase: Phase = 'idle';
  phaseTime = 0;
  level = 1;
  score = 0;
  lives = START_LIVES;
  pelletsLeft = 0;
  pelletsEaten = 0;
  levelTime = 0;

  spec: LevelSpec = levelSpec(1);
  modeIndex = 0;
  modeTime = 0;
  frightTimer = 0;
  frightTotal = 0;
  ghostChain = 0;
  freezeTimer = 0;

  combo = 0;
  comboTimer = 0;
  multiplier = 1;
  pressureTime = 0;
  private pressureWarned = false;

  trapActive = false;
  trapTimer = 0;
  private trapSpawns = 0;
  reliefTimer = 0;
  reboundTimer = 0;

  private sinceLastPellet = 0;
  private afterDeath = false;
  private extraLifeGiven = false;
  private readonly rng = new Rng(0x5eed);
  private readonly swellCandidates: number[] = [];
  private readonly bfsQueue: Int32Array;
  private readonly bfsSeen: Uint8Array;

  constructor() {
    this.grid = new Uint8Array(COLS * ROWS);
    this.tunnels = new Uint8Array(ROWS);
    this.blocked = new Uint8Array(COLS * ROWS);
    this.loadLocation(locationForLevel(1));
    this.bfsQueue = new Int32Array(COLS * ROWS);
    this.bfsSeen = new Uint8Array(COLS * ROWS);
    this.player = { x: 0, y: 0, px: 0, py: 0, dir: LEFT, want: NONE, moving: false, travel: 0 };
    this.ghosts = [0, 1, 2, 3].map((id) => ({
      id,
      x: 0,
      y: 0,
      px: 0,
      py: 0,
      dir: LEFT,
      state: G_HOUSE,
      fright: false,
      eaten: false,
      homeX: HOUSE_X[id],
      dotCounter: 0,
    }));
  }

  // ---------------------------------------------------------------- lifecycle

  newGame(): void {
    this.score = 0;
    this.lives = START_LIVES;
    this.level = 1;
    this.extraLifeGiven = false;
    this.startLevel();
  }

  nextLevel(): void {
    this.level++;
    this.startLevel();
  }

  private loadLocation(loc: Location): void {
    this.location = loc;
    this.grid.set(loc.layout.cells);
    this.tunnels.set(loc.layout.tunnels);
    this.totalPellets = loc.layout.pellets;
    this.pelletsLeft = this.totalPellets;
    this.computeSwellCandidates();
  }

  private startLevel(): void {
    this.loadLocation(locationForLevel(this.level));
    this.emit({ type: 'levelStart' });
    this.readyTime = LEVEL_INTRO_TIME;
    this.pelletsEaten = 0;
    this.spec = levelSpec(this.level);
    this.trapSpawns = 0;
    this.afterDeath = false;
    for (const g of this.ghosts) g.dotCounter = 0;
    this.resetActors();
  }

  private resetActors(): void {
    const p = this.player;
    p.x = p.px = PLAYER_START.x;
    p.y = p.py = PLAYER_START.y;
    p.dir = LEFT;
    p.want = NONE;
    p.moving = false;
    p.travel = 0;
    for (const g of this.ghosts) {
      g.fright = false;
      g.eaten = false;
      if (g.id === BLINKY) {
        g.state = G_ACTIVE;
        g.x = DOOR_X;
        g.y = HOUSE_EXIT_Y;
        g.dir = LEFT;
      } else {
        g.state = G_HOUSE;
        g.x = g.homeX;
        g.y = HOUSE_CENTER_Y;
        g.dir = g.id === PINKY ? DOWN : UP;
      }
      g.px = g.x;
      g.py = g.y;
    }
    this.modeIndex = 0;
    this.modeTime = 0;
    this.frightTimer = 0;
    this.ghostChain = 0;
    this.freezeTimer = 0;
    this.combo = 0;
    this.comboTimer = 0;
    this.multiplier = 1;
    this.pressureTime = 0;
    this.pressureWarned = false;
    this.levelTime = 0;
    this.trapActive = false;
    this.reliefTimer = 0;
    this.endRebound(false);
    this.sinceLastPellet = 0;
    this.setPhase('ready');
    this.emit({ type: 'ready' });
  }

  /** Seconds of the current READY phase (longer when a level begins). */
  get readyDuration(): number {
    return this.readyTime;
  }

  private setPhase(p: Phase): void {
    this.phase = p;
    this.phaseTime = 0;
  }

  setWant(dir: number): void {
    this.player.want = dir;
  }

  // -------------------------------------------------------------------- step

  step(dt: number): void {
    const p = this.player;
    p.px = p.x;
    p.py = p.y;
    for (const g of this.ghosts) {
      g.px = g.x;
      g.py = g.y;
    }
    this.phaseTime += dt;

    switch (this.phase) {
      case 'ready':
        if (this.phaseTime >= this.readyTime) {
          this.readyTime = READY_TIME;
          this.setPhase('playing');
          this.emit({ type: 'go' });
        }
        break;
      case 'playing':
        if (this.freezeTimer > 0) {
          this.freezeTimer -= dt;
          // Eyes keep travelling during the hit-stop, like the arcade.
          for (const g of this.ghosts) if (g.eaten && g.state === G_ACTIVE) this.moveGhost(g, dt);
        } else {
          this.updatePlaying(dt);
        }
        break;
      case 'dying':
        if (this.phaseTime >= DEATH_FREEZE && this.phaseTime - dt < DEATH_FREEZE) this.emit({ type: 'deathAnim' });
        if (this.phaseTime >= DEATH_FREEZE + DEATH_ANIM + 0.4) {
          this.lives--;
          if (this.lives <= 0) {
            this.setPhase('gameover');
            this.emit({ type: 'gameOver' });
          } else {
            this.afterDeath = true;
            for (const g of this.ghosts) g.dotCounter = 0;
            this.resetActors();
          }
        }
        break;
      case 'levelclear':
        if (this.phaseTime >= LEVEL_CLEAR_TIME) {
          this.setPhase('intermission');
          this.emit({ type: 'levelClearDone' });
        }
        break;
      default:
        break;
    }
  }

  private updatePlaying(dt: number): void {
    this.levelTime += dt;
    this.sinceLastPellet += dt;

    // Combo window (positive loop).
    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) this.resetCombo();
    }

    // Fright / mode timers. Scatter-chase clock pauses while frightened.
    if (this.frightTimer > 0) {
      this.frightTimer -= dt;
      if (this.frightTimer <= 0) {
        this.frightTimer = 0;
        for (const g of this.ghosts) g.fright = false;
        this.emit({ type: 'frightEnd' });
      }
    } else {
      this.pressureTime += dt;
      if (!this.pressureWarned && this.pressure() >= 0.6) {
        this.pressureWarned = true;
        this.emit({ type: 'pressureHigh' });
      }
      const modes = this.spec.modes;
      if (this.modeIndex < modes.length) {
        this.modeTime += dt;
        if (this.modeTime >= modes[this.modeIndex]) {
          this.modeTime = 0;
          this.modeIndex++;
          this.reverseGhosts();
        }
      }
    }

    // Decongestant trap.
    if (this.trapActive) {
      this.trapTimer -= dt;
      if (this.trapTimer <= 0) {
        this.trapActive = false;
        this.emit({ type: 'trapExpire' });
      }
    }
    if (this.reliefTimer > 0) {
      this.reliefTimer -= dt;
      if (this.reliefTimer <= 0) this.startRebound();
    }
    if (this.reboundTimer > 0) {
      this.reboundTimer -= dt;
      if (this.reboundTimer <= 0) this.endRebound(true);
    }

    this.updateHouse(dt);
    this.movePlayer(dt);
    if (this.checkCollisions()) return;
    for (const g of this.ghosts) this.moveGhost(g, dt);
    if (this.checkCollisions()) return;

    if (this.trapActive) {
      const dx = this.player.x - BONUS_POS.x;
      const dy = this.player.y - BONUS_POS.y;
      if (dx * dx + dy * dy < COLLIDE_DIST2) this.takeTrap();
    }

    if (this.pelletsLeft <= 0) {
      this.trapActive = false;
      this.reliefTimer = 0;
      this.endRebound(false);
      this.frightTimer = 0;
      for (const g of this.ghosts) g.fright = false;
      this.setPhase('levelclear');
      this.emit({ type: 'levelClear' });
    }
  }

  // ------------------------------------------------------------------ player

  private playerSpeed(): number {
    const s = this.spec;
    let mult = this.frightTimer > 0 ? s.pacFrightSpeed : s.pacSpeed;
    mult *= 1 + this.comboSpeedBonus();
    if (this.reliefTimer > 0) mult *= 1 + TRAP.reliefSpeedBonus;
    if (this.reboundTimer > 0) mult *= TRAP.reboundSpeedFactor;
    return mult * FULL_SPEED;
  }

  private movePlayer(dt: number): void {
    const p = this.player;
    let dist = this.playerSpeed() * dt;
    const want = p.want;

    if (want !== NONE && want === opposite(p.dir)) p.dir = want;

    // Late-turn grace ("cornering"): a perpendicular input arriving just after
    // a junction snaps back and takes the turn instead of overshooting.
    if (want !== NONE && want !== p.dir && want !== opposite(p.dir) && p.dir !== NONE) {
      const cx = Math.round(p.x);
      const cy = Math.round(p.y);
      const past = (p.x - cx) * DX[p.dir] + (p.y - cy) * DY[p.dir];
      if (past > EPS && past <= 0.3 && this.isOpen(cx + DX[want], cy + DY[want])) {
        p.x = cx;
        p.y = cy;
        dist += past;
      }
    }

    let moved = 0;
    let guard = 8;
    while (dist > EPS && guard-- > 0) {
      if (atCenter(p)) {
        p.x = Math.round(p.x);
        p.y = Math.round(p.y);
        const cx = p.x;
        const cy = p.y;
        if (want !== NONE && this.isOpen(cx + DX[want], cy + DY[want])) p.dir = want;
        if (!this.isOpen(cx + DX[p.dir], cy + DY[p.dir])) break;
      }
      const toNext = distToNextCenter(p);
      const s = dist < toNext ? dist : toNext;
      p.x += DX[p.dir] * s;
      p.y += DY[p.dir] * s;
      dist -= s;
      moved += s;
      wrap(p);
      if (s === toNext) {
        p.x = Math.round(p.x);
        p.y = Math.round(p.y);
      }
    }
    // Eat on entering a tile (arcade-accurate), not on reaching its center:
    // reversing just before a pellet's center still collects it.
    if (moved > 0) this.onPlayerEnterTile(Math.round(p.x), Math.round(p.y));
    p.moving = moved > 0;
    p.travel += moved;
  }

  private onPlayerEnterTile(c: number, r: number): void {
    if (c < 0 || c >= COLS) return;
    const i = r * COLS + c;
    const t = this.grid[i];
    if (t !== T_PELLET && t !== T_POWER) return;
    this.grid[i] = T_EMPTY;
    this.pelletsLeft--;
    this.pelletsEaten++;
    this.sinceLastPellet = 0;
    this.creditHouseDot();

    // Combo / multiplier.
    this.combo++;
    this.comboTimer = COMBO.window;
    const m = Math.min(COMBO.maxMultiplier, 1 + Math.floor(this.combo / COMBO.perStep));
    if (m !== this.multiplier) {
      this.multiplier = m;
      this.emit({ type: 'multiplier', value: m });
    }

    if (t === T_POWER) {
      this.addScore(SCORE.power);
      this.startFright();
      this.emit({ type: 'power', x: c, y: r });
    } else {
      this.addScore(SCORE.pellet * this.multiplier);
      this.emit({ type: 'pellet', x: c, y: r, multiplier: this.multiplier });
    }

    if (this.trapSpawns < TRAP.spawnAtPellets.length && this.pelletsEaten >= TRAP.spawnAtPellets[this.trapSpawns]) {
      this.trapSpawns++;
      this.trapActive = true;
      this.trapTimer = TRAP.lifetime;
      this.emit({ type: 'trapSpawn' });
    }
  }

  private resetCombo(): void {
    this.combo = 0;
    this.comboTimer = 0;
    if (this.multiplier !== 1) {
      this.multiplier = 1;
      this.emit({ type: 'multiplier', value: 1 });
    }
  }

  comboSpeedBonus(): number {
    return ((this.multiplier - 1) / (COMBO.maxMultiplier - 1)) * COMBO.maxSpeedBonus;
  }

  /** 0..1 symptom pressure (negative feedback loop). */
  pressure(): number {
    const t = (this.pressureTime - PRESSURE.graceSeconds) / PRESSURE.rampSeconds;
    return t <= 0 ? 0 : t >= 1 ? 1 : t;
  }

  private addScore(n: number): void {
    this.score += n;
    if (!this.extraLifeGiven && this.score >= EXTRA_LIFE_SCORE) {
      this.extraLifeGiven = true;
      this.lives++;
      this.emit({ type: 'extraLife' });
    }
  }

  // ------------------------------------------------------------------ fright

  private startFright(): void {
    const t = this.spec.frightTime;
    this.frightTimer = t;
    this.frightTotal = t;
    this.ghostChain = 0;
    // Cyclamen instantly resets the accumulated symptom pressure.
    this.pressureTime = 0;
    this.pressureWarned = false;
    for (const g of this.ghosts) {
      if (g.eaten) continue;
      g.fright = true;
      if (g.state === G_ACTIVE) g.dir = opposite(g.dir);
    }
  }

  private reverseGhosts(): void {
    for (const g of this.ghosts) {
      if (g.state === G_ACTIVE && !g.eaten && !g.fright) g.dir = opposite(g.dir);
    }
  }

  isScatter(): boolean {
    return this.modeIndex < this.spec.modes.length && (this.modeIndex & 1) === 0;
  }

  // ------------------------------------------------------------------ ghosts

  private elroyLevel(): number {
    const d = this.spec.elroyDots;
    if (this.pelletsLeft <= d / 2) return 2;
    if (this.pelletsLeft <= d) return 1;
    return 0;
  }

  private ghostSpeed(g: Ghost): number {
    const s = this.spec;
    if (g.eaten) return 1.6 * FULL_SPEED;
    if (g.state === G_HOUSE || g.state === G_LEAVING) return 0.5 * FULL_SPEED;
    if (this.tunnels[g.y] === 1 && (g.x < 5 || g.x > COLS - 6)) return s.ghostTunnelSpeed * FULL_SPEED;
    if (g.fright) return s.ghostFrightSpeed * FULL_SPEED;
    let mult = s.ghostSpeed * (1 + this.pressure() * PRESSURE.maxGhostBonus);
    if (g.id === BLINKY) mult += this.elroyLevel() * 0.05;
    return mult * FULL_SPEED;
  }

  private updateHouse(dt: number): void {
    // Release by idle timer: punishes camping away from pellets.
    const idleLimit = this.level < 5 ? 4 : 3;
    if (this.sinceLastPellet >= idleLimit) {
      const g = this.preferredHouseGhost();
      if (g) {
        g.state = G_LEAVING;
        this.sinceLastPellet = 0;
      }
    }
    for (const g of this.ghosts) {
      if (g.state !== G_HOUSE) continue;
      if (g.dotCounter >= this.dotLimit(g.id) && g === this.preferredHouseGhost()) {
        g.state = G_LEAVING;
        continue;
      }
      // Bob up and down.
      const sp = this.ghostSpeed(g) * dt;
      g.y += g.dir === UP ? -sp : sp;
      if (g.y <= HOUSE_CENTER_Y - 0.5) {
        g.y = HOUSE_CENTER_Y - 0.5;
        g.dir = DOWN;
      } else if (g.y >= HOUSE_CENTER_Y + 0.5) {
        g.y = HOUSE_CENTER_Y + 0.5;
        g.dir = UP;
      }
    }
  }

  private dotLimit(id: number): number {
    if (this.afterDeath) return [0, 0, 8, 20][id];
    if (this.level === 1) return [0, 0, 30, 60][id];
    if (this.level === 2) return [0, 0, 0, 50][id];
    return 0;
  }

  private preferredHouseGhost(): Ghost | null {
    for (const id of RELEASE_ORDER) {
      const g = this.ghosts[id];
      if (g.state === G_HOUSE) return g;
    }
    return null;
  }

  private creditHouseDot(): void {
    const g = this.preferredHouseGhost();
    if (g) g.dotCounter++;
  }

  private moveGhost(g: Ghost, dt: number): void {
    let dist = this.ghostSpeed(g) * dt;
    if (g.state === G_HOUSE) return;

    if (g.state === G_LEAVING) {
      if (Math.abs(g.x - DOOR_X) > EPS) {
        const s = Math.min(dist, Math.abs(DOOR_X - g.x));
        g.dir = g.x < DOOR_X ? RIGHT : LEFT;
        g.x += g.x < DOOR_X ? s : -s;
        return;
      }
      g.dir = UP;
      g.y -= dist;
      if (g.y <= HOUSE_EXIT_Y) {
        g.y = HOUSE_EXIT_Y;
        g.state = G_ACTIVE;
        g.dir = LEFT;
      }
      return;
    }

    if (g.state === G_ENTERING) {
      if (Math.abs(g.x - DOOR_X) > EPS) {
        const s = Math.min(dist, Math.abs(DOOR_X - g.x));
        g.dir = g.x < DOOR_X ? RIGHT : LEFT;
        g.x += g.x < DOOR_X ? s : -s;
        return;
      }
      g.dir = DOWN;
      g.y += dist;
      if (g.y >= HOUSE_CENTER_Y) {
        g.y = HOUSE_CENTER_Y;
        g.eaten = false;
        g.fright = false;
        g.state = G_LEAVING;
      }
      return;
    }

    let guard = 8;
    while (dist > EPS && guard-- > 0) {
      if (atCenter(g)) {
        g.x = Math.round(g.x);
        g.y = Math.round(g.y);
        if (g.eaten && g.y === HOUSE_EXIT_Y && (g.x === 13 || g.x === 14)) {
          g.state = G_ENTERING;
          return;
        }
        g.dir = this.chooseGhostDir(g, g.x, g.y);
      }
      const toNext = distToNextCenter(g);
      const s = dist < toNext ? dist : toNext;
      g.x += DX[g.dir] * s;
      g.y += DY[g.dir] * s;
      dist -= s;
      wrap(g);
      if (s === toNext) {
        g.x = Math.round(g.x);
        g.y = Math.round(g.y);
      }
    }
  }

  private chooseGhostDir(g: Ghost, cx: number, cy: number): number {
    const back = opposite(g.dir);
    let options = 0;
    let count = 0;
    for (let d = 0; d < 4; d++) {
      if (d === back) continue;
      if (this.isOpen(cx + DX[d], cy + DY[d])) {
        options |= 1 << d;
        count++;
      }
    }
    if (count === 0) return this.isOpen(cx + DX[back], cy + DY[back]) ? back : g.dir;

    if (g.fright && !g.eaten) {
      let pick = this.rng.int(count);
      for (let d = 0; d < 4; d++) {
        if (options & (1 << d)) {
          if (pick === 0) return d;
          pick--;
        }
      }
    }

    let tx: number;
    let ty: number;
    if (g.eaten) {
      tx = 13;
      ty = HOUSE_EXIT_Y;
    } else {
      const t = this.ghostTarget(g);
      tx = t[0];
      ty = t[1];
    }
    let best = -1;
    let bestD = Infinity;
    for (let d = 0; d < 4; d++) {
      if (!(options & (1 << d))) continue;
      const nx = cx + DX[d] - tx;
      const ny = cy + DY[d] - ty;
      const dd = nx * nx + ny * ny;
      if (dd < bestD) {
        bestD = dd;
        best = d;
      }
    }
    return best;
  }

  private readonly targetOut: [number, number] = [0, 0];

  ghostTarget(g: Ghost): [number, number] {
    const out = this.targetOut;
    const scatter = this.isScatter() && !(g.id === BLINKY && this.elroyLevel() > 0);
    if (scatter) {
      out[0] = SCATTER_TARGETS[g.id][0];
      out[1] = SCATTER_TARGETS[g.id][1];
      return out;
    }
    const p = this.player;
    const pc = Math.round(p.x);
    const pr = Math.round(p.y);
    const pd = p.dir === NONE ? LEFT : p.dir;
    switch (g.id) {
      case BLINKY: // Acute infection: straight at you.
        out[0] = pc;
        out[1] = pr;
        break;
      case PINKY: // Headache: ambush 4 tiles ahead.
        out[0] = pc + DX[pd] * 4;
        out[1] = pr + DY[pd] * 4;
        break;
      case INKY: {
        // Facial pressure: pincer vector built from the infection's position.
        const b = this.ghosts[BLINKY];
        const ax = pc + DX[pd] * 2;
        const ay = pr + DY[pd] * 2;
        out[0] = ax * 2 - Math.round(b.x);
        out[1] = ay * 2 - Math.round(b.y);
        break;
      }
      default: {
        // Congestion: chases from afar, retreats when close (on/off nature).
        const dx = Math.round(g.x) - pc;
        const dy = Math.round(g.y) - pr;
        if (dx * dx + dy * dy > 64) {
          out[0] = pc;
          out[1] = pr;
        } else {
          out[0] = SCATTER_TARGETS[CLYDE][0];
          out[1] = SCATTER_TARGETS[CLYDE][1];
        }
      }
    }
    return out;
  }

  // -------------------------------------------------------------- collisions

  private checkCollisions(): boolean {
    const p = this.player;
    for (const g of this.ghosts) {
      if (g.state === G_HOUSE || g.state === G_ENTERING || g.eaten) continue;
      const dx = g.x - p.x;
      const dy = g.y - p.y;
      if (dx * dx + dy * dy > COLLIDE_DIST2) continue;
      if (g.fright) {
        const points = SCORE.ghosts[Math.min(this.ghostChain, SCORE.ghosts.length - 1)];
        this.ghostChain++;
        g.eaten = true;
        g.fright = false;
        this.addScore(points);
        this.freezeTimer = GHOST_EAT_FREEZE;
        this.emit({ type: 'ghostEaten', x: g.x, y: g.y, points, ghost: g.id });
        // Leaving ghosts that get eaten: snap them onto the grid above the door.
        if (g.state === G_LEAVING) {
          g.state = G_ACTIVE;
          g.x = 13;
          g.y = HOUSE_EXIT_Y;
        }
      } else {
        this.trapActive = false;
        this.reliefTimer = 0;
        this.setPhase('dying');
        this.emit({ type: 'death' });
        return true;
      }
    }
    return false;
  }

  // -------------------------------------------------------- trap / rebound

  private takeTrap(): void {
    this.trapActive = false;
    this.addScore(SCORE.trap);
    this.reliefTimer = TRAP.reliefSeconds;
    this.emit({ type: 'trapTaken', x: BONUS_POS.x, y: BONUS_POS.y });
  }

  private startRebound(): void {
    this.reliefTimer = 0;
    this.reboundTimer = TRAP.reboundSeconds;
    this.pickSwellTiles();
    this.emit({ type: 'reboundStart' });
  }

  private endRebound(emit: boolean): void {
    const wasActive = this.reboundTimer > 0 || this.blocked.some((v) => v !== 0);
    this.reboundTimer = 0;
    this.blocked.fill(0);
    if (emit && wasActive) this.emit({ type: 'reboundEnd' });
  }

  private computeSwellCandidates(): void {
    const g = this.grid;
    const t = this.tunnels;
    this.swellCandidates.length = 0;
    const powerSet = new Set(this.location.layout.powers.map(([c, r]) => r * COLS + c));
    for (let r = 1; r < ROWS - 1; r++) {
      for (let c = 1; c < COLS - 1; c++) {
        if (!isCorridor(g, t, c, r) || t[r]) continue;
        if (powerSet.has(r * COLS + c)) continue;
        if (r >= HOUSE.r0 - 1 && r <= HOUSE.r1 + 1 && c >= HOUSE.c0 - 1 && c <= HOUSE.c1 + 1) continue;
        if (r === 23 && c >= 11 && c <= 16) continue; // spawn area
        const l = isCorridor(g, t, c - 1, r);
        const rr = isCorridor(g, t, c + 1, r);
        const u = isCorridor(g, t, c, r - 1);
        const d = isCorridor(g, t, c, r + 1);
        const h = l && rr;
        const v = u && d;
        const n = +l + +rr + +u + +d;
        if (n === 2 && (h || v)) this.swellCandidates.push(r * COLS + c);
      }
    }
  }

  private pickSwellTiles(): void {
    const cand = this.swellCandidates.slice();
    this.rng.shuffle(cand);
    let placed = 0;
    for (const idx of cand) {
      if (placed >= TRAP.swellTiles) break;
      const c = idx % COLS;
      const r = (idx / COLS) | 0;
      if (this.nearActor(c, r, 3)) continue;
      if (this.blockedNear(c, r)) continue;
      this.blocked[idx] = 1;
      if (this.isConnected()) placed++;
      else this.blocked[idx] = 0;
    }
  }

  private nearActor(c: number, r: number, radius: number): boolean {
    const r2 = radius * radius;
    const p = this.player;
    if ((p.x - c) ** 2 + (p.y - r) ** 2 < r2) return true;
    for (const g of this.ghosts) {
      if (g.state !== G_ACTIVE) continue;
      if ((g.x - c) ** 2 + (g.y - r) ** 2 < r2) return true;
    }
    return false;
  }

  private blockedNear(c: number, r: number): boolean {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const nc = c + dx;
        const nr = r + dy;
        if (nc < 0 || nc >= COLS || nr < 0 || nr >= ROWS) continue;
        if (this.blocked[nr * COLS + nc]) return true;
      }
    }
    return false;
  }

  /** BFS over open tiles: true if every open tile is reachable. */
  private isConnected(): boolean {
    const seen = this.bfsSeen;
    const q = this.bfsQueue;
    seen.fill(0);
    let total = 0;
    let start = -1;
    for (let i = 0; i < COLS * ROWS; i++) {
      if (this.isOpen(i % COLS, (i / COLS) | 0)) {
        total++;
        if (start < 0) start = i;
      }
    }
    let head = 0;
    let tail = 0;
    q[tail++] = start;
    seen[start] = 1;
    let reached = 1;
    while (head < tail) {
      const i = q[head++];
      const c = i % COLS;
      const r = (i / COLS) | 0;
      for (let d = 0; d < 4; d++) {
        let nc = c + DX[d];
        const nr = r + DY[d];
        if (nr >= 0 && nr < ROWS && this.tunnels[nr]) nc = (nc + COLS) % COLS;
        if (nc < 0 || nc >= COLS || nr < 0 || nr >= ROWS) continue;
        const j = nr * COLS + nc;
        if (seen[j] || !this.isOpen(nc, nr)) continue;
        seen[j] = 1;
        reached++;
        q[tail++] = j;
      }
    }
    return reached === total;
  }

  // ------------------------------------------------------------------ utils

  isOpen(c: number, r: number): boolean {
    if (!isCorridor(this.grid, this.tunnels, c, r)) return false;
    if (c >= 0 && c < COLS && this.blocked[r * COLS + c]) return false;
    return true;
  }

  private emit(e: GameEvent): void {
    this.events.push(e);
  }
}

function atCenter(a: Actor): boolean {
  return Math.abs(a.x - Math.round(a.x)) < EPS && Math.abs(a.y - Math.round(a.y)) < EPS;
}

function distToNextCenter(a: Actor): number {
  const d = a.dir;
  if (DX[d] !== 0) {
    const f = a.x - Math.floor(a.x);
    if (f < EPS || f > 1 - EPS) return 1;
    return DX[d] > 0 ? 1 - f : f;
  }
  const f = a.y - Math.floor(a.y);
  if (f < EPS || f > 1 - EPS) return 1;
  return DY[d] > 0 ? 1 - f : f;
}

function wrap(a: Actor): void {
  if (a.x < -1.5) a.x += WRAP_PERIOD;
  else if (a.x > COLS + 0.5) a.x -= WRAP_PERIOD;
}
