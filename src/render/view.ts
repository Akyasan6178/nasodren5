// Scene graph + presentation. Reads simulation state, interpolates positions,
// and plays effects driven by game events. Every display object is created up
// front and pooled: the per-frame path allocates nothing.

import { Container, Sprite, Texture } from 'pixi.js';
import { TRAP } from '../config.ts';
import {
  DEATH_ANIM,
  DEATH_FREEZE,
  G_ENTERING,
  type Game,
  type GameEvent,
} from '../game/game.ts';
import {
  BONUS_POS,
  COLS,
  DOOR_ROW,
  DOWN,
  DX,
  DY,
  LEFT,
  NONE,
  RIGHT,
  ROWS,
  T_PELLET,
  T_POWER,
  UP,
} from '../game/maze.ts';
import type { Atlas, MazeState, MazeTextures } from './atlas.ts';
import { PLAYER_DEATH_FRAMES, PLAYER_MOUTH_FRAMES, VIRUS_FRAMES } from './art.ts';

const MAZE_FADE = 0.3; // seconds to cross-fade between baked cavity states
const PETAL_PINK = [0xf91576, 0xff6fae, 0xb9014b] as const; // hero palette
const BUBBLES = 16;

const PARTICLES = 220;
const RIPPLES = 8;
const POPUPS = 6;

interface Particle {
  s: Sprite;
  vx: number;
  vy: number;
  life: number;
  max: number;
  g: number;
  s0: number;
  s1: number;
  a0: number;
  spin: number;
}

interface Bubble {
  s: Sprite;
  vy: number;
  phase: number;
}

interface Ripple {
  s: Sprite;
  life: number;
  max: number;
  from: number;
  to: number;
  delay: number;
  a0: number;
}

interface Popup {
  s: Sprite;
  life: number;
  y0: number;
}

interface GhostView {
  body: Sprite;
  eyes: Sprite;
  pupils: Sprite;
}

export class GameView {
  readonly root = new Container();
  private readonly world = new Container();
  private readonly T: number;

  private readonly maze: MazeTextures;
  /** Baked cavity: A shows the current state, B fades in the next one. */
  private readonly mazeA: Sprite;
  private readonly mazeB: Sprite;
  private mazeState: MazeState = 'inflamed';
  private mazeNext: MazeState = 'inflamed';
  private readonly bubbles: Bubble[] = [];
  private readonly dotTex: Texture;
  private readonly petalTex: Texture;
  private facing = 1;
  private readonly pellets: Array<Sprite | null> = new Array(COLS * ROWS).fill(null);
  private readonly powers: Array<{ flower: Sprite; glow: Sprite; idx: number }> = [];
  private readonly swell: Sprite[] = [];
  private readonly trap: Sprite;
  private readonly trapGlow: Sprite;
  private readonly ghosts: GhostView[] = [];
  private readonly player: Sprite;
  private readonly playerGlow: Sprite;
  private readonly customVirus: boolean[];
  private readonly playerRotates: boolean;
  private readonly particles: Particle[] = [];
  private readonly ripples: Ripple[] = [];
  private readonly popups: Popup[] = [];
  private readonly covers: Sprite[] = [];
  private readonly fxLayer = new Container();

  private readonly playerFrames: Texture[] = [];
  private readonly deathFrames: Texture[] = [];
  private readonly ghostFrames: Texture[][] = [];
  private readonly frightFrames: Texture[] = [];
  private readonly flashFrames: Texture[] = [];
  private readonly popupTex = new Map<number, Texture>();

  private time = 0;
  private palette = 0;
  private swellAmt = 0;
  private swellPop = 0;
  private shake = 0;
  private trailTimer = 0;
  // Player "juice": time since the cyclamen gulp, per-pellet chomp pulse, turn stretch.
  private gulpT = 9;
  private chomp = 0;
  private stretch = 0;
  private lastDir = NONE;
  private particleCursor = 0;
  bgColor: number;
  /** Reduced effects for weak devices (set by the quality governor). */
  lowFx = false;

  constructor(atlas: Atlas, maze: MazeTextures, game: Game) {
    this.T = atlas.tile;
    this.maze = maze;
    this.bgColor = maze.floorColor.inflamed;
    this.customVirus = atlas.customVirus;
    this.playerRotates = atlas.playerRotates;
    const T = this.T;
    const tex = (n: string): Texture => atlas.tex.get(n)!;

    for (let i = 0; i < PLAYER_MOUTH_FRAMES; i++) this.playerFrames.push(tex(`player${i}`));
    for (let i = 0; i < PLAYER_DEATH_FRAMES; i++) this.deathFrames.push(tex(`death${i}`));
    for (let id = 0; id < 4; id++) {
      const frames: Texture[] = [];
      for (let k = 0; k < VIRUS_FRAMES; k++) frames.push(tex(`ghost${id}_${k}`));
      this.ghostFrames.push(frames);
    }
    for (let k = 0; k < VIRUS_FRAMES; k++) {
      this.frightFrames.push(tex(`fright${k}`));
      this.flashFrames.push(tex(`flash${k}`));
    }
    for (const v of [100, 200, 400, 800, 1600]) this.popupTex.set(v, tex(`pop${v}`));

    this.root.addChild(this.world);
    const w = this.world;

    // Cavity (floor + mucosa walls baked together), then drifting bubbles.
    this.mazeA = new Sprite(maze.tex.inflamed);
    this.mazeB = new Sprite(maze.tex.inflamed);
    for (const m of [this.mazeA, this.mazeB]) {
      m.scale.set(maze.scale);
      w.addChild(m);
    }
    this.mazeB.visible = false;
    const bubbleLayer = new Container();
    w.addChild(bubbleLayer);
    const dotTex = tex('dot');
    this.dotTex = dotTex;
    this.petalTex = tex('petal');
    for (let i = 0; i < BUBBLES; i++) {
      const b = new Sprite(dotTex);
      b.anchor.set(0.5);
      b.position.set(Math.random() * COLS * T, Math.random() * ROWS * T);
      b.scale.set(0.35 + Math.random() * 0.5);
      b.alpha = 0.25 + Math.random() * 0.2;
      bubbleLayer.addChild(b);
      this.bubbles.push({ s: b, vy: (0.15 + Math.random() * 0.3) * T, phase: Math.random() * 6.28 });
    }

    const door = new Sprite(tex('door'));
    door.anchor.set(0.5);
    door.position.set(14 * T, (DOOR_ROW + 0.5) * T);
    w.addChild(door);

    // Pellets: one static sprite per pellet tile of this location, toggled visible.
    const fresh = game.location.layout.cells;
    const pelletLayer = new Container();
    w.addChild(pelletLayer);
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const i = r * COLS + c;
        if (fresh[i] !== T_PELLET) continue;
        const s = new Sprite(tex(`pellet${(c * 7 + r * 13) % 3}`));
        s.anchor.set(0.5);
        s.position.set((c + 0.5) * T, (r + 0.5) * T);
        if (!atlas.customPellet) s.rotation = ((c * 31 + r * 17) % 12) * 0.52;
        pelletLayer.addChild(s);
        this.pellets[i] = s;
      }
    }

    for (const [c, r] of game.location.layout.powers) {
      const glow = new Sprite(tex('glowPink'));
      glow.anchor.set(0.5);
      glow.position.set((c + 0.5) * T, (r + 0.5) * T);
      const flower = new Sprite(tex('power'));
      flower.anchor.set(0.5);
      flower.position.copyFrom(glow.position);
      w.addChild(glow, flower);
      this.powers.push({ flower, glow, idx: r * COLS + c });
    }

    this.trapGlow = new Sprite(tex('glowAqua'));
    this.trapGlow.anchor.set(0.5);
    this.trapGlow.tint = 0x9aa5b1;
    this.trap = new Sprite(tex('trap'));
    this.trap.anchor.set(0.5);
    for (const s of [this.trapGlow, this.trap]) {
      s.position.set((BONUS_POS.x + 0.5) * T, (BONUS_POS.y + 0.5) * T);
      s.visible = false;
      w.addChild(s);
    }

    for (let i = 0; i < TRAP.swellTiles; i++) {
      const s = new Sprite(tex('swell'));
      s.anchor.set(0.5);
      s.visible = false;
      w.addChild(s);
      this.swell.push(s);
    }

    // Ripples sit under the actors.
    for (let i = 0; i < RIPPLES; i++) {
      const s = new Sprite(tex('ring'));
      s.anchor.set(0.5);
      s.visible = false;
      w.addChild(s);
      this.ripples.push({ s, life: 0, max: 1, from: 0, to: 1, delay: 0, a0: 1 });
    }

    for (let id = 0; id < 4; id++) {
      const body = new Sprite(this.ghostFrames[id][0]);
      const eyes = new Sprite(tex('eyes'));
      const pupils = new Sprite(tex('pupils'));
      for (const s of [body, eyes, pupils]) {
        s.anchor.set(0.5);
        w.addChild(s);
      }
      this.ghosts.push({ body, eyes, pupils });
    }

    this.playerGlow = new Sprite(tex('glowSoft'));
    this.playerGlow.anchor.set(0.5);
    w.addChild(this.playerGlow);
    this.player = new Sprite(this.playerFrames[2]);
    this.player.anchor.set(0.5);
    w.addChild(this.player);

    w.addChild(this.fxLayer);
    for (let i = 0; i < PARTICLES; i++) {
      const s = new Sprite(dotTex);
      s.anchor.set(0.5);
      s.visible = false;
      this.fxLayer.addChild(s);
      this.particles.push({ s, vx: 0, vy: 0, life: 0, max: 1, g: 0, s0: 1, s1: 0, a0: 1, spin: 0 });
    }
    for (let i = 0; i < POPUPS; i++) {
      const s = new Sprite(this.popupTex.get(200)!);
      s.anchor.set(0.5);
      s.visible = false;
      this.fxLayer.addChild(s);
      this.popups.push({ s, life: 0, y0: 0 });
    }

    // Tunnel covers: hide actors travelling through the off-screen wrap.
    for (const side of [-1, 1]) {
      const s = new Sprite(Texture.WHITE);
      s.width = 40 * T;
      s.height = ROWS * T;
      s.x = side < 0 ? -40 * T : COLS * T;
      w.addChild(s);
      this.covers.push(s);
    }

    this.syncPellets(game);
    this.syncSwell(game);
  }

  get worldWidth(): number {
    return COLS * this.T;
  }

  get worldHeight(): number {
    return ROWS * this.T;
  }

  syncPellets(game: Game): void {
    for (let i = 0; i < this.pellets.length; i++) {
      const s = this.pellets[i];
      if (s) s.visible = game.grid[i] === T_PELLET;
    }
    for (const p of this.powers) {
      const on = game.grid[p.idx] === T_POWER;
      p.flower.visible = on;
      p.glow.visible = on;
    }
  }

  private syncSwell(game: Game): void {
    let k = 0;
    for (let i = 0; i < game.blocked.length && k < this.swell.length; i++) {
      if (!game.blocked[i]) continue;
      const s = this.swell[k++];
      s.visible = true;
      s.position.set(((i % COLS) + 0.5) * this.T, (((i / COLS) | 0) + 0.5) * this.T);
    }
    for (; k < this.swell.length; k++) this.swell[k].visible = false;
  }

  // ------------------------------------------------------------ events

  handle(e: GameEvent, game: Game): void {
    switch (e.type) {
      case 'pellet': {
        const s = this.pellets[e.y * COLS + e.x];
        if (s) s.visible = false;
        this.chomp = 1;
        if (!this.lowFx) this.burst(e.x, e.y, 4, 0xc8c03c, 1.6, 0.35, 0, 0.5);
        break;
      }
      case 'power': {
        this.gulpT = 0;
        for (const p of this.powers) {
          if (p.idx === e.y * COLS + e.x) {
            p.flower.visible = false;
            p.glow.visible = false;
          }
        }
        // Osmotic drainage wave: rings radiating through the sinus network.
        this.ripple(e.x, e.y, 0x6fd3c6, 0.3, 9, 1.4, 0, 0.7);
        this.ripple(e.x, e.y, 0x6fd3c6, 0.3, 6, 1.1, 0.15, 0.6);
        this.ripple(e.x, e.y, 0xf472b6, 0.2, 3.5, 0.8, 0.05, 0.8);
        this.burst(e.x, e.y, this.lowFx ? 10 : 22, 0xf472b6, 5, 1.0, 4, 1.2, true);
        this.burst(e.x, e.y, this.lowFx ? 6 : 14, 0x9ee6dc, 4, 1.0, 0, 0.9);
        break;
      }
      case 'ghostEaten':
        this.burst(e.x, e.y, this.lowFx ? 10 : 24, 0x6fb0ff, 7, 0.8, 14, 1.0);
        this.ripple(e.x, e.y, 0x6fb0ff, 0.2, 2.2, 0.5, 0, 0.8);
        this.popup(e.x, e.y, e.points);
        break;
      case 'trapTaken':
        this.burst(e.x, e.y, 16, 0xa8b2bf, 4, 0.9, -1, 1.0);
        this.popup(e.x, e.y, 100);
        break;
      case 'reboundStart':
        this.syncSwell(game);
        this.swellPop = 0;
        this.shake = Math.max(this.shake, 0.25);
        this.ripple(game.player.x, game.player.y, 0xe5574d, 0.2, 8, 0.9, 0, 0.6);
        break;
      case 'reboundEnd':
        this.syncSwell(game);
        break;
      case 'death':
        this.shake = 0.3;
        break;
      case 'deathAnim':
        // Wilting: petals fall away.
        this.burst(game.player.x, game.player.y, 16, 0xf9a8d4, 2.5, 1.4, 3, 1.3, true);
        break;
      case 'ready':
        this.syncPellets(game);
        this.syncSwell(game);
        break;
      case 'levelClear':
        for (let i = 0; i < (this.lowFx ? 20 : 50); i++) {
          const x = 1 + Math.random() * (COLS - 2);
          const y = 1 + Math.random() * (ROWS - 2);
          this.burst(x, y, 1, PETAL_PINK[i % 3], 2, 1.8, 1.5, 1.4, i % 2 === 0);
        }
        break;
      case 'extraLife':
        this.burst(game.player.x, game.player.y, 16, 0xffd23f, 4, 1.0, 0, 0.9);
        break;
      default:
        break;
    }
  }

  // ------------------------------------------------------------ frame

  update(game: Game, alpha: number, dt: number): void {
    this.time += dt;
    const T = this.T;
    const t = this.time;

    // Cavity state: inflamed -> clear under cyclamen extract; swollen during
    // rebound; flashing when the level is cleared.
    const k = Math.min(1, dt * 5);
    this.palette += ((game.frightTimer > 0 ? 1 : 0) - this.palette) * k;
    this.swellAmt += ((game.reboundTimer > 0 ? 1 : 0) - this.swellAmt) * k;
    let target: MazeState = game.reboundTimer > 0 ? 'swollen' : game.frightTimer > 0 ? 'clear' : 'inflamed';
    let instant = false;
    if (game.phase === 'levelclear' && game.phaseTime > 0.5) {
      target = Math.floor((game.phaseTime - 0.5) / 0.2) % 2 === 0 ? 'flash' : 'clear';
      instant = true;
    }
    this.updateMazeState(target, instant, dt);
    const bg = lerpColor(this.bgColor, this.maze.floorColor[target], instant ? 1 : k);
    this.bgColor = bg;

    // Drifting bubbles (ambient life inside the cavity).
    if (!this.lowFx) {
      const H = ROWS * T;
      for (const b of this.bubbles) {
        b.s.y -= b.vy * dt;
        b.s.x += Math.sin(t * 0.8 + b.phase) * 0.15 * T * dt;
        if (b.s.y < -T) {
          b.s.y = H + T;
          b.s.x = Math.random() * COLS * T;
        }
      }
    }
    this.covers[0].tint = bg;
    this.covers[1].tint = bg;

    // Shake
    if (this.shake > 0) {
      this.shake -= dt;
      const m = Math.max(0, this.shake) * 0.5 * T;
      this.world.position.set((Math.random() - 0.5) * m, (Math.random() - 0.5) * m);
    } else if (this.world.x !== 0 || this.world.y !== 0) {
      this.world.position.set(0, 0);
    }

    // Cyclamen pulse
    const pulse = 1 + Math.sin(t * 5) * 0.08;
    for (const p of this.powers) {
      p.flower.scale.set(1.05 * pulse);
      p.flower.rotation = Math.sin(t * 2.2 + p.idx) * 0.08;
      p.glow.alpha = 0.55 + Math.sin(t * 5) * 0.3;
      p.glow.scale.set(0.9 + Math.sin(t * 5) * 0.12);
    }

    // Trap
    const trapOn = game.trapActive && (game.trapTimer > 2 || Math.floor(t * 8) % 2 === 0);
    this.trap.visible = trapOn;
    this.trapGlow.visible = trapOn;
    if (trapOn) {
      this.trap.rotation = Math.sin(t * 6) * 0.12;
      this.trapGlow.alpha = 0.5 + Math.sin(t * 7) * 0.2;
    }

    // Swollen mucosa blobs
    if (this.swellAmt > 0.01 || game.reboundTimer > 0) {
      this.swellPop = Math.min(1, this.swellPop + dt * 4);
      const fade = game.reboundTimer > 0 ? (game.reboundTimer < 1 ? game.reboundTimer : 1) : 0;
      for (let i = 0; i < this.swell.length; i++) {
        const s = this.swell[i];
        if (!s.visible) continue;
        const sc = easeOutBack(this.swellPop) * fade * (1 + Math.sin(t * 6 + i) * 0.06);
        s.scale.set(sc);
      }
    }

    this.updateGhosts(game, alpha);
    this.updatePlayer(game, alpha, dt);
    this.updateFx(dt);
  }

  private updateMazeState(target: MazeState, instant: boolean, dt: number): void {
    const A = this.mazeA;
    const B = this.mazeB;
    if (instant) {
      if (this.mazeState !== target) A.texture = this.maze.tex[target];
      this.mazeState = this.mazeNext = target;
      B.visible = false;
      return;
    }
    if (target !== this.mazeNext) {
      // A newer target mid-fade: commit whichever layer dominates, restart.
      if (B.visible && B.alpha > 0.5) {
        A.texture = B.texture;
        this.mazeState = this.mazeNext;
      }
      this.mazeNext = target;
      if (target === this.mazeState) {
        B.visible = false;
        return;
      }
      B.texture = this.maze.tex[target];
      B.alpha = 0;
      B.visible = true;
    }
    if (!B.visible) return;
    B.alpha = Math.min(1, B.alpha + dt / MAZE_FADE);
    if (B.alpha >= 1) {
      A.texture = B.texture;
      this.mazeState = this.mazeNext;
      B.visible = false;
    }
  }

  private updateGhosts(game: Game, alpha: number): void {
    const T = this.T;
    const hideAll =
      game.phase === 'levelclear' ||
      game.phase === 'intermission' ||
      game.phase === 'gameover' ||
      game.phase === 'idle' ||
      (game.phase === 'dying' && game.phaseTime >= DEATH_FREEZE);
    const frame = Math.floor(this.time * 8) % VIRUS_FRAMES;
    const flashing = game.frightTimer > 0 && game.frightTimer < 2 && Math.floor(this.time * 5) % 2 === 0;

    for (let i = 0; i < 4; i++) {
      const g = game.ghosts[i];
      const v = this.ghosts[i];
      if (hideAll || (game.freezeTimer > 0 && g.eaten && g.state !== G_ENTERING && justEaten(game, i))) {
        v.body.visible = v.eyes.visible = v.pupils.visible = false;
        continue;
      }
      const x = (interp(g.px, g.x, alpha) + 0.5) * T;
      const y = (interp(g.py, g.y, alpha) + 0.5) * T;

      if (g.eaten) {
        v.body.visible = false;
        v.eyes.visible = v.pupils.visible = true;
      } else if (g.fright) {
        v.body.visible = true;
        v.eyes.visible = v.pupils.visible = false;
        v.body.texture = flashing ? this.flashFrames[frame] : this.frightFrames[frame];
      } else {
        v.body.visible = true;
        v.eyes.visible = v.pupils.visible = !this.customVirus[i];
        v.body.texture = this.ghostFrames[i][frame];
      }
      const bob = 1 + Math.sin(this.time * 9 + i * 1.7) * 0.035;
      v.body.position.set(x, y);
      v.body.scale.set(1 / bob, bob);
      v.eyes.position.set(x, y);
      const d = g.dir < 0 ? LEFT : g.dir;
      const look = 0.065 * T;
      v.pupils.position.set(x + DX[d] * look, y + DY[d] * look);
    }
  }

  private updatePlayer(game: Game, alpha: number, dt: number): void {
    const T = this.T;
    const p = game.player;
    const s = this.player;
    const glow = this.playerGlow;
    if (game.phase === 'idle' || game.phase === 'intermission' || game.phase === 'gameover') {
      s.visible = false;
      glow.visible = false;
      return;
    }
    s.visible = true;
    const x = (interp(p.px, p.x, alpha) + 0.5) * T;
    const y = (interp(p.py, p.y, alpha) + 0.5) * T;
    s.position.set(x, y);
    glow.visible = game.phase !== 'dying';
    glow.position.set(x, y);
    const boost = this.palette;
    glow.alpha = 0.3 + boost * 0.25 + Math.sin(this.time * 4) * 0.05;
    glow.scale.set(0.7 + boost * 0.25);
    s.tint = game.reboundTimer > 0 ? 0xffc9c0 : game.reliefTimer > 0 ? 0xdde3ea : 0xffffff;

    if (game.phase === 'dying') {
      const k = (game.phaseTime - DEATH_FREEZE) / DEATH_ANIM;
      if (k < 0) {
        s.texture = this.playerFrames[2];
      } else if (k >= 1) {
        s.visible = false;
      } else {
        s.texture = this.deathFrames[Math.min(PLAYER_DEATH_FRAMES - 1, Math.floor(k * PLAYER_DEATH_FRAMES))];
        // Pac-Man-style art dies facing where it was heading; the flower stands upright.
        if (!this.playerRotates) s.rotation = 0;
        s.scale.set(this.facing, 1);
      }
      return;
    }

    // Mouth: triangle wave over distance travelled.
    let fi = 2;
    if (p.moving || game.phase !== 'playing') {
      const ph = (p.travel * 2.4) % 2;
      fi = Math.round((ph < 1 ? ph : 2 - ph) * (PLAYER_MOUTH_FRAMES - 1));
    }
    s.texture = this.playerFrames[fi];
    // Face left/right by mirroring. The flower only leans into vertical movement
    // (it shouldn't turn upside down) and hovers; Pac-Man-style art turns fully.
    const d = p.dir;
    if (d === LEFT) this.facing = -1;
    else if (d === RIGHT) this.facing = 1;
    const turn = this.playerRotates ? Math.PI / 2 : 0.22;
    const lean = d === UP ? -turn : d === DOWN ? turn : 0;
    s.rotation = lean * this.facing;
    if (!this.playerRotates) s.y += Math.sin(this.time * 6) * 0.03 * T;

    // Juice: elastic gulp on cyclamen extract, a small pulse per pellet, and a
    // quick stretch along the new heading on every turn (sprite-local x = heading).
    if (d !== this.lastDir) {
      if (d !== NONE && this.lastDir !== NONE) this.stretch = 0.14;
      this.lastDir = d;
    }
    this.gulpT += dt;
    this.chomp *= Math.exp(-dt * 22);
    this.stretch *= Math.exp(-dt * 12);
    const gulp = this.gulpT < 0.8 ? 0.32 * Math.exp(-6 * this.gulpT) * Math.cos(15 * this.gulpT) : 0;
    const k = 1 + gulp + this.chomp * 0.06;
    s.scale.set(this.facing * k * (1 + this.stretch), k * (1 - this.stretch));
    glow.alpha += this.chomp * 0.15 + Math.max(0, gulp);

    // Airflow trail.
    if (p.moving && game.phase === 'playing' && !this.lowFx) {
      this.trailTimer -= dt;
      if (this.trailTimer <= 0) {
        // Petal trail (denser and brighter under cyclamen extract).
        this.trailTimer = game.frightTimer > 0 ? 0.05 : 0.11;
        const bx = interp(p.px, p.x, alpha) - DX[d] * 0.45;
        const by = interp(p.py, p.y, alpha) - DY[d] * 0.45 - 0.2;
        const col = PETAL_PINK[(Math.random() * 3) | 0];
        this.spawn(bx, by, (Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 0.5, 0.7, 1.2, col, 0.9, 0.3, 0.85, true);
      }
    }
  }

  // ------------------------------------------------------------ fx pools

  private spawn(
    tx: number,
    ty: number,
    vx: number,
    vy: number,
    life: number,
    g: number,
    color: number,
    s0: number,
    s1: number,
    a0: number,
    petal = false,
  ): void {
    const p = this.particles[this.particleCursor];
    this.particleCursor = (this.particleCursor + 1) % this.particles.length;
    const T = this.T;
    p.s.visible = true;
    p.s.texture = petal ? this.petalTex : this.dotTex;
    p.s.rotation = petal ? Math.random() * Math.PI * 2 : 0;
    p.spin = petal ? (Math.random() - 0.5) * 6 : 0;
    p.s.tint = color;
    p.s.position.set((tx + 0.5) * T, (ty + 0.5) * T);
    p.vx = vx * T;
    p.vy = vy * T;
    p.life = life;
    p.max = life;
    p.g = g * T;
    p.s0 = s0;
    p.s1 = s1;
    p.a0 = a0;
  }

  private burst(tx: number, ty: number, n: number, color: number, speed: number, life: number, g: number, size: number, petal = false): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.4 + Math.random() * 0.6);
      this.spawn(tx, ty, Math.cos(a) * v, Math.sin(a) * v - (g > 0 ? speed * 0.4 : 0), life * (0.6 + Math.random() * 0.4), g, color, size, 0, 1, petal);
    }
  }

  private ripple(tx: number, ty: number, color: number, from: number, to: number, life: number, delay: number, a0: number): void {
    let r = this.ripples[0];
    for (const q of this.ripples) {
      if (q.life <= 0) {
        r = q;
        break;
      }
    }
    r.s.position.set((tx + 0.5) * this.T, (ty + 0.5) * this.T);
    r.s.tint = color;
    r.s.visible = false;
    r.life = life;
    r.max = life;
    r.from = from;
    r.to = to;
    r.delay = delay;
    r.a0 = a0;
  }

  private popup(tx: number, ty: number, value: number): void {
    const tex = this.popupTex.get(value);
    if (!tex) return;
    let p = this.popups[0];
    for (const q of this.popups) {
      if (q.life <= 0) {
        p = q;
        break;
      }
    }
    p.s.texture = tex;
    p.s.visible = true;
    p.life = 1;
    p.y0 = (ty + 0.5) * this.T;
    p.s.position.set((tx + 0.5) * this.T, p.y0);
  }

  private updateFx(dt: number): void {
    for (const p of this.particles) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.s.visible = false;
        continue;
      }
      p.vy += p.g * dt;
      if (p.spin !== 0) p.s.rotation += p.spin * dt;
      p.s.x += p.vx * dt;
      p.s.y += p.vy * dt;
      const k = p.life / p.max;
      p.s.alpha = p.a0 * k;
      p.s.scale.set(p.s1 + (p.s0 - p.s1) * k);
    }
    for (const r of this.ripples) {
      if (r.life <= 0) continue;
      if (r.delay > 0) {
        r.delay -= dt;
        continue;
      }
      r.life -= dt;
      if (r.life <= 0) {
        r.s.visible = false;
        continue;
      }
      const k = 1 - r.life / r.max;
      r.s.visible = true;
      r.s.scale.set(r.from + (r.to - r.from) * easeOutCubic(k));
      r.s.alpha = r.a0 * (1 - k);
    }
    for (const p of this.popups) {
      if (p.life <= 0) continue;
      p.life -= dt * 1.1;
      if (p.life <= 0) {
        p.s.visible = false;
        continue;
      }
      const k = 1 - p.life;
      p.s.y = p.y0 - k * 0.9 * this.T;
      p.s.alpha = p.life < 0.3 ? p.life / 0.3 : 1;
      p.s.scale.set(k < 0.15 ? 0.6 + (k / 0.15) * 0.4 : 1);
    }
  }

  destroy(): void {
    this.root.destroy({ children: true });
  }
}

// ---------------------------------------------------------------- helpers

/** True for the ghost that triggered the current hit-stop (hidden behind its score). */
function justEaten(game: Game, i: number): boolean {
  const g = game.ghosts[i];
  const p = game.player;
  return (g.x - p.x) ** 2 + (g.y - p.y) ** 2 < 1.2;
}

function interp(a: number, b: number, t: number): number {
  // Don't smear across the tunnel wrap.
  if (Math.abs(b - a) > 2) return b;
  return a + (b - a) * t;
}

export function lerpColor(a: number, b: number, t: number): number {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const ar = (a >> 16) & 255;
  const ag = (a >> 8) & 255;
  const ab = a & 255;
  const r = ar + (((b >> 16) & 255) - ar) * t;
  const g = ag + (((b >> 8) & 255) - ag) * t;
  const bl = ab + ((b & 255) - ab) * t;
  // Round (not truncate) so repeated easing actually reaches the target.
  return ((Math.round(r) & 255) << 16) | ((Math.round(g) & 255) << 8) | (Math.round(bl) & 255);
}

function easeOutCubic(k: number): number {
  return 1 - (1 - k) ** 3;
}

function easeOutBack(k: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (k - 1) ** 3 + c1 * (k - 1) ** 2;
}
