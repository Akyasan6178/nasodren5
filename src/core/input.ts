// Keyboard + swipe-anywhere touch controls. No virtual D-pad (per UX brief).
// Swipes re-anchor after each detected direction, so a player can steer
// continuously without lifting the finger. The game keeps the last direction
// as a buffered "want" and applies it at the next possible junction.

import { DOWN, LEFT, RIGHT, UP } from '../game/maze.ts';

export interface InputHandlers {
  onDir(dir: number): void;
  onPause(): void;
  onMute(): void;
  onAnyInput?(): void;
}

const KEYMAP: Record<string, number> = {
  ArrowUp: UP,
  KeyW: UP,
  ArrowLeft: LEFT,
  KeyA: LEFT,
  ArrowDown: DOWN,
  KeyS: DOWN,
  ArrowRight: RIGHT,
  KeyD: RIGHT,
};

export class Input {
  /** Swipe distance threshold in CSS px; scaled with tile size by the layout. */
  threshold = 18;
  private pointerId = -1;
  private ax = 0;
  private ay = 0;
  private readonly h: InputHandlers;

  constructor(h: InputHandlers) {
    this.h = h;
    window.addEventListener('keydown', this.onKey, { passive: false });
    window.addEventListener('pointerdown', this.onDown, { passive: true });
    window.addEventListener('pointermove', this.onMove, { passive: true });
    window.addEventListener('pointerup', this.onUp, { passive: true });
    window.addEventListener('pointercancel', this.onUp, { passive: true });
    // iOS: stop rubber-banding / double-tap zoom while playing.
    document.addEventListener('touchmove', (e) => {
      if (!(e.target as HTMLElement).closest('.scrollable')) e.preventDefault();
    }, { passive: false });
  }

  private onKey = (e: KeyboardEvent): void => {
    const d = KEYMAP[e.code];
    if (d !== undefined) {
      e.preventDefault();
      this.h.onDir(d);
      this.h.onAnyInput?.();
      return;
    }
    if (e.code === 'KeyP' || e.code === 'Escape') this.h.onPause();
    else if (e.code === 'KeyM') this.h.onMute();
  };

  private onDown = (e: PointerEvent): void => {
    if ((e.target as HTMLElement).closest('button, a, .no-swipe')) return;
    this.pointerId = e.pointerId;
    this.ax = e.clientX;
    this.ay = e.clientY;
    this.h.onAnyInput?.();
  };

  private onMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId) return;
    const dx = e.clientX - this.ax;
    const dy = e.clientY - this.ay;
    const adx = Math.abs(dx);
    const ady = Math.abs(dy);
    if (Math.max(adx, ady) < this.threshold) return;
    // Require a clear dominant axis to avoid diagonal misreads.
    if (adx > ady * 1.15) this.h.onDir(dx > 0 ? RIGHT : LEFT);
    else if (ady > adx * 1.15) this.h.onDir(dy > 0 ? DOWN : UP);
    else return;
    this.ax = e.clientX;
    this.ay = e.clientY;
  };

  private onUp = (e: PointerEvent): void => {
    if (e.pointerId === this.pointerId) this.pointerId = -1;
  };
}
