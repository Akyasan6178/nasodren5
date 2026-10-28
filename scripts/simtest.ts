// Headless simulation test (node >= 22.6, native TS stripping):
//   npm run test:sim
// 1) every location layout is valid  2) random bots: actor invariants never break
// 3) immortal BFS bot clears 8 levels (all locations + wrap)  4) rebound keeps every maze connected

import { SIM_STEP } from '../src/config.ts';
import { Game } from '../src/game/game.ts';
import { LOCATIONS } from '../src/game/locations.ts';
import { COLS, DX, DY, ROWS, T_PELLET, T_POWER, validateLayout } from '../src/game/maze.ts';

let failed = 0;
const check = (ok: boolean, msg: string): void => {
  if (!ok) {
    failed++;
    console.error('FAIL', msg);
  }
};

// 1. Maze
for (const loc of LOCATIONS) {
  const errs = validateLayout(loc.layout);
  check(errs.length === 0, `maze ${loc.name}: ${errs.join('; ')}`);
  console.log(`  ${loc.name.padEnd(22)} pellets=${loc.layout.pellets} tunnels=${loc.layout.tunnels.reduce((a, b) => a + b, 0)}`);
}

// 2. Random bots
let seed = 1;
const rnd = (): number => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
for (let run = 0; run < 20; run++) {
  const g = new Game();
  g.newGame();
  for (let i = 0; i < 120 * 60 * 4 && g.phase !== 'gameover'; i++) {
    if (i % 48 === 0) g.setWant((rnd() * 4) | 0);
    g.step(SIM_STEP);
    if (g.events.some((e) => e.type === 'levelClearDone')) g.nextLevel();
    g.events.length = 0;
    const p = g.player;
    if (!(p.x >= -2 && p.x <= COLS + 1 && p.y >= 0 && p.y < ROWS)) {
      check(false, `player out of bounds ${p.x},${p.y}`);
      break;
    }
    for (const q of g.ghosts) {
      const onGrid = q.state === 2 && Number.isInteger(q.x) && Number.isInteger(q.y) && q.x >= 0 && q.x < COLS;
      if (onGrid && !g.isOpen(q.x, q.y)) {
        check(false, `ghost ${q.id} inside wall at ${q.x},${q.y}`);
        i = Infinity;
      }
    }
  }
}

// 3. Immortal BFS bot
{
  const g = new Game();
  g.newGame();
  const prev = new Int32Array(COLS * ROWS);
  const queue = new Int32Array(COLS * ROWS);
  const nextDir = (): number => {
    const sc = Math.round(g.player.x);
    const sr = Math.round(g.player.y);
    if (sc < 0 || sc >= COLS) return -1;
    prev.fill(-2);
    const start = sr * COLS + sc;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    prev[start] = -1;
    while (head < tail) {
      const k = queue[head++];
      if (k !== start && (g.grid[k] === T_PELLET || g.grid[k] === T_POWER)) {
        let cur = k;
        while (prev[cur] !== start) cur = prev[cur];
        for (let d = 0; d < 4; d++) if ((sr + DY[d]) * COLS + sc + DX[d] === cur) return d;
        return -1;
      }
      const c = k % COLS;
      const r = (k / COLS) | 0;
      for (let d = 0; d < 4; d++) {
        const nc = c + DX[d];
        const nr = r + DY[d];
        if (nc < 0 || nc >= COLS) continue;
        const j = nr * COLS + nc;
        if (prev[j] !== -2 || !g.isOpen(nc, nr)) continue;
        prev[j] = k;
        queue[tail++] = j;
      }
    }
    return -1;
  };
  for (let i = 0; i < 120 * 60 * 30 && g.level < 9; i++) {
    g.lives = 9;
    // Ghosts that get too close are sent home (we test progression, not dodging).
    for (const q of g.ghosts) {
      if (!q.fright && !q.eaten && (q.x - g.player.x) ** 2 + (q.y - g.player.y) ** 2 < 2.5) {
        q.state = 0;
        q.x = q.homeX;
        q.y = 14;
      }
    }
    // Re-plan only near tile centers so equal-distance targets do not make the bot dither.
    const off = Math.abs(g.player.x - Math.round(g.player.x)) + Math.abs(g.player.y - Math.round(g.player.y));
    if (off < 0.12) {
      const d = nextDir();
      if (d >= 0) g.setWant(d);
    }
    g.step(SIM_STEP);
    if (g.events.some((e) => e.type === 'levelClearDone')) g.nextLevel();
    g.events.length = 0;
  }
  check(g.level >= 9, `progression: only reached level ${g.level}`);
}

// 4. Rebound swelling
{
  const g = new Game() as unknown as {
    newGame(): void;
    nextLevel(): void;
    startRebound(): void;
    endRebound(e: boolean): void;
    isConnected(): boolean;
    blocked: Uint8Array;
  };
  g.newGame();
  for (let k = 0; k < LOCATIONS.length * 6; k++) {
    if (k > 0 && k % 6 === 0) g.nextLevel();
    g.startRebound();
    const n = g.blocked.reduce((a, b) => a + b, 0);
    check(n >= 6 && g.isConnected(), `rebound: ${n} tiles, connected=${g.isConnected()}`);
    g.endRebound(false);
  }
}

console.log(failed ? `${failed} check(s) failed` : 'ALL SIM CHECKS PASSED');
process.exit(failed ? 1 : 0);
