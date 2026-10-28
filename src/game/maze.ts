// Maze model. Layouts are authored as 28x31 ASCII (see locations.ts) and
// parsed into a compact grid. Shared rules every layout must follow (checked
// by validateLayout): fixed ghost house + door, open spawn/bonus tiles, no dead
// ends, no 2x2 open areas, fully connected, tunnels open on both sides.
//
// ASCII legend:  #  wall    .  mucus pellet    o  cyclamen extract (power)
//                ' ' empty corridor    -  house door    _  house interior

export const COLS = 28;
export const ROWS = 31;

export const T_WALL = 0;
export const T_EMPTY = 1;
export const T_PELLET = 2;
export const T_POWER = 3;
export const T_DOOR = 4;
export const T_HOUSE = 5;

/** Horizontal wrap period: centers -1 and COLS are virtual off-screen tunnel tiles. */
export const WRAP_PERIOD = COLS + 2;

// Directions, in classic tie-break priority order.
export const UP = 0;
export const LEFT = 1;
export const DOWN = 2;
export const RIGHT = 3;
export const NONE = -1;
export const DX = [0, -1, 0, 1];
export const DY = [-1, 0, 1, 0];
export const opposite = (d: number): number => (d < 0 ? d : (d + 2) & 3);

// Ghost house (identical in every layout): walls rows 12-16 / cols 10-17.
export const HOUSE = { c0: 10, c1: 17, r0: 12, r1: 16 } as const;
export const DOOR_ROW = 12;
export const DOOR_X = 13.5; // door spans cols 13-14
export const HOUSE_EXIT_Y = 11; // corridor row right above the door
export const HOUSE_CENTER_Y = 14;

export const PLAYER_START = { x: 13.5, y: 23 } as const;
export const BONUS_POS = { x: 13.5, y: 17 } as const;

/** Rect [r0, r1, c0, c1] (inclusive) where pellets are not placed. */
export type QuietRect = readonly [number, number, number, number];

export interface Layout {
  cells: Uint8Array;
  /** 1 for rows whose both edges are open (wrap-around tunnel). */
  tunnels: Uint8Array;
  powers: Array<[number, number]>;
  pellets: number;
}

const CHAR_TILE: Record<string, number> = {
  '#': T_WALL,
  '.': T_PELLET,
  o: T_POWER,
  ' ': T_EMPTY,
  '-': T_DOOR,
  _: T_HOUSE,
};

export function parseLayout(rows: readonly string[], mirror = false, quiet: readonly QuietRect[] = []): Layout {
  if (rows.length !== ROWS) throw new Error(`maze needs ${ROWS} rows, got ${rows.length}`);
  const cells = new Uint8Array(COLS * ROWS);
  for (let r = 0; r < ROWS; r++) {
    const line = rows[r];
    if (line.length !== COLS) throw new Error(`maze row ${r} has ${line.length} cols`);
    for (let c = 0; c < COLS; c++) {
      const ch = line[mirror ? COLS - 1 - c : c];
      const t = CHAR_TILE[ch];
      if (t === undefined) throw new Error(`maze row ${r}: bad char "${ch}"`);
      cells[r * COLS + c] = t;
    }
  }
  for (const [r0, r1, c0, c1] of quiet) {
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const cc = mirror ? COLS - 1 - c : c;
        if (cells[r * COLS + cc] === T_PELLET) cells[r * COLS + cc] = T_EMPTY;
      }
    }
  }
  // Spawn tiles never hold pellets.
  cells[23 * COLS + 13] = cells[23 * COLS + 13] === T_WALL ? T_WALL : T_EMPTY;
  cells[23 * COLS + 14] = cells[23 * COLS + 14] === T_WALL ? T_WALL : T_EMPTY;

  const tunnels = new Uint8Array(ROWS);
  for (let r = 0; r < ROWS; r++) tunnels[r] = cells[r * COLS] !== T_WALL && cells[r * COLS + COLS - 1] !== T_WALL ? 1 : 0;
  const powers: Array<[number, number]> = [];
  let pellets = 0;
  for (let i = 0; i < cells.length; i++) {
    if (cells[i] === T_POWER) powers.push([i % COLS, (i / COLS) | 0]);
    if (cells[i] === T_PELLET || cells[i] === T_POWER) pellets++;
  }
  return { cells, tunnels, powers, pellets };
}

/** Corridor tiles walkable by actors, with tunnel virtualization off the edges. */
export function isCorridor(grid: Uint8Array, tunnels: Uint8Array, c: number, r: number): boolean {
  if (r < 0 || r >= ROWS) return false;
  if (c < 0 || c >= COLS) return tunnels[r] === 1;
  const t = grid[r * COLS + c];
  return t === T_EMPTY || t === T_PELLET || t === T_POWER;
}

/** Returns a list of problems; empty means the layout is sound. */
export function validateLayout(L: Layout): string[] {
  const errors: string[] = [];
  const { cells, tunnels } = L;
  const walk = (c: number, r: number): boolean => isCorridor(cells, tunnels, c, r);
  let start = -1;
  let total = 0;
  for (let r = 0; r < ROWS; r++) {
    const a = cells[r * COLS] !== T_WALL;
    const b = cells[r * COLS + COLS - 1] !== T_WALL;
    if (a !== b) errors.push(`half-open tunnel on row ${r}`);
    for (let c = 0; c < COLS; c++) {
      if (!walk(c, r)) continue;
      total++;
      if (start < 0) start = r * COLS + c;
      let n = 0;
      for (let d = 0; d < 4; d++) if (walk(c + DX[d], r + DY[d])) n++;
      if (n < 2) errors.push(`dead end at ${c},${r}`);
      if (walk(c + 1, r) && walk(c, r + 1) && walk(c + 1, r + 1)) errors.push(`2x2 open at ${c},${r}`);
    }
  }
  const house = [
    [T_WALL, T_WALL, T_WALL, T_DOOR, T_DOOR, T_WALL, T_WALL, T_WALL],
    [T_WALL, T_HOUSE, T_HOUSE, T_HOUSE, T_HOUSE, T_HOUSE, T_HOUSE, T_WALL],
    [T_WALL, T_HOUSE, T_HOUSE, T_HOUSE, T_HOUSE, T_HOUSE, T_HOUSE, T_WALL],
    [T_WALL, T_HOUSE, T_HOUSE, T_HOUSE, T_HOUSE, T_HOUSE, T_HOUSE, T_WALL],
    [T_WALL, T_WALL, T_WALL, T_WALL, T_WALL, T_WALL, T_WALL, T_WALL],
  ];
  for (let i = 0; i < 5; i++) {
    for (let j = 0; j < 8; j++) if (cells[(HOUSE.r0 + i) * COLS + HOUSE.c0 + j] !== house[i][j]) errors.push(`house mismatch ${HOUSE.c0 + j},${HOUSE.r0 + i}`);
  }
  for (const [c, r] of [
    [12, 11],
    [13, 11],
    [14, 11],
    [15, 11],
    [13, 17],
    [14, 17],
    [12, 23],
    [13, 23],
    [14, 23],
    [15, 23],
  ]) {
    if (!walk(c, r)) errors.push(`required open tile ${c},${r}`);
  }
  if (L.powers.length !== 4) errors.push(`expected 4 power tiles, got ${L.powers.length}`);

  const seen = new Uint8Array(COLS * ROWS);
  const stack = [start];
  seen[start] = 1;
  let reached = 1;
  while (stack.length) {
    const i = stack.pop()!;
    const c = i % COLS;
    const r = (i / COLS) | 0;
    for (let d = 0; d < 4; d++) {
      let nc = c + DX[d];
      const nr = r + DY[d];
      if (nr >= 0 && nr < ROWS && tunnels[nr]) nc = (nc + COLS) % COLS;
      if (nc < 0 || nc >= COLS || !walk(nc, nr)) continue;
      const j = nr * COLS + nc;
      if (!seen[j]) {
        seen[j] = 1;
        reached++;
        stack.push(j);
      }
    }
  }
  if (reached !== total) errors.push(`disconnected: reached ${reached}/${total}`);
  return errors;
}
