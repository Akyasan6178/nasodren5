// Packs the procedural frames into one atlas canvas -> one GPU texture, so all
// sprites batch into a single draw call. Maze textures are built separately
// (one pair per location) and cached by the caller.

import { CanvasSource, Rectangle, Texture } from 'pixi.js';
import { drawFrames, drawMazeArt } from './art.ts';
import { SPRITE_SLOTS, VIRUS_SLOTS, type CustomArt } from './custom.ts';
import type { Location } from '../game/locations.ts';

export interface Atlas {
  tile: number; // texture pixels per tile
  tex: Map<string, Texture>;
  /** Viruses drawn from custom art (they carry their own face, so no eye overlay). */
  customVirus: boolean[];
  /** Custom pellet art is shown upright (procedural blobs get random rotation). */
  customPellet: boolean;
  /** Player turns to face up/down (custom art with `rotate`) instead of leaning. */
  playerRotates: boolean;
  destroy(): void;
}

/** Visual states of the cavity; each is baked into one opaque texture. */
export type MazeState = 'inflamed' | 'clear' | 'swollen' | 'flash';
export const MAZE_STATES: readonly MazeState[] = ['inflamed', 'clear', 'swollen', 'flash'];

/** Shared state palettes; 'inflamed' comes from the location. */
export const STATE_PALETTE: Record<Exclude<MazeState, 'inflamed'>, { wall: number; floor: number }> = {
  clear: { wall: 0x45b8ae, floor: 0xeafaf5 },
  swollen: { wall: 0xd8505a, floor: 0xffe4e2 },
  flash: { wall: 0xffffff, floor: 0xeafaf5 },
};

export interface MazeTextures {
  tex: Record<MazeState, Texture>;
  floorColor: Record<MazeState, number>;
  /** Sprite scale that maps texture pixels back to world (tile * atlas.tile) units. */
  scale: number;
  destroy(): void;
}

const PAD = 2;

export function buildAtlas(tile: number, custom?: CustomArt): Atlas {
  const frames = drawFrames(tile, custom);
  const entries = [...frames.entries()].sort((a, b) => b[1].height - a[1].height);

  // Shelf packing into a fixed-width sheet.
  const width = tile >= 48 ? 2048 : 1024;
  let x = PAD;
  let y = PAD;
  let shelf = 0;
  const placed: Array<[string, HTMLCanvasElement, number, number]> = [];
  for (const [name, c] of entries) {
    if (x + c.width + PAD > width) {
      x = PAD;
      y += shelf + PAD;
      shelf = 0;
    }
    placed.push([name, c, x, y]);
    x += c.width + PAD;
    shelf = Math.max(shelf, c.height);
  }
  const height = nextPow2(y + shelf + PAD);

  const sheet = document.createElement('canvas');
  sheet.width = width;
  sheet.height = height;
  const ctx = sheet.getContext('2d')!;
  for (const [, c, px, py] of placed) ctx.drawImage(c, px, py);

  const source = new CanvasSource({ resource: sheet, scaleMode: 'linear' });
  const tex = new Map<string, Texture>();
  for (const [name, c, px, py] of placed) {
    tex.set(name, new Texture({ source, frame: new Rectangle(px, py, c.width, c.height), label: name }));
  }

  return {
    tile,
    tex,
    customVirus: VIRUS_SLOTS.map((s) => custom?.sprites.has(s) ?? false),
    customPellet: custom?.sprites.has('mukus') ?? false,
    playerRotates: (custom?.sprites.has('oyuncu') ?? false) && SPRITE_SLOTS.oyuncu.rotate,
    destroy() {
      for (const t of tex.values()) t.destroy(false);
      source.destroy();
    },
  };
}

/**
 * Bakes floor + tinted walls per palette state into single textures, so the
 * cavity costs ONE full-screen layer per frame (two only while cross-fading).
 */
export function buildMazeTextures(tile: number, loc: Location, seed: number): MazeTextures {
  const art = drawMazeArt(tile, loc.layout.cells, loc.layout.tunnels, seed);
  const W = art.walls.width;
  const H = art.walls.height;
  const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;
  const palettes: Record<MazeState, { wall: number; floor: number }> = {
    inflamed: { wall: loc.wall, floor: loc.floor },
    ...STATE_PALETTE,
  };
  const tinted = document.createElement('canvas');
  tinted.width = W;
  tinted.height = H;
  const tctx = tinted.getContext('2d')!;

  const tex = {} as Record<MazeState, Texture>;
  const floorColor = {} as Record<MazeState, number>;
  for (const state of MAZE_STATES) {
    const { wall, floor } = palettes[state];
    floorColor[state] = floor;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d')!;
    // Floor: greyscale detail multiplied by the floor colour.
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(art.floor, 0, 0, W, H);
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = hex(floor);
    ctx.fillRect(0, 0, W, H);
    // Walls: tint greyscale, then restore their alpha, then lay over the floor.
    tctx.globalCompositeOperation = 'copy';
    tctx.drawImage(art.walls, 0, 0);
    tctx.globalCompositeOperation = 'multiply';
    tctx.fillStyle = hex(wall);
    tctx.fillRect(0, 0, W, H);
    tctx.globalCompositeOperation = 'destination-in';
    tctx.drawImage(art.walls, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(tinted, 0, 0);
    tex[state] = new Texture({ source: new CanvasSource({ resource: c, scaleMode: 'linear' }), label: `maze-${state}` });
  }
  return {
    tex,
    floorColor,
    scale: 1 / art.wallScale,
    destroy() {
      for (const t of Object.values(tex)) t.destroy(true);
    },
  };
}

function nextPow2(v: number): number {
  let p = 1;
  while (p < v) p <<= 1;
  return p;
}
