// A fixed budget of point and spot lights. Every lamp, fire and glowing sign
// in the village is a real light, and every lit pixel pays for each one in
// the scene, lit or not. Only the few nearest where you're looking stay on.
// The counts stay constant (when there are enough lights), so turning
// lights over never makes three.js recompile its shaders.

import type { Object3D } from 'three';

export interface LightSpot {
  x: number;
  y: number;
  z: number;
  kind: 'point' | 'spot';
  /** Currently giving light (night, a fire): preferred over dark ones. */
  lit: boolean;
}

export interface Budget { point: number; spot: number }

/** Budgets by device: phones and the lowest quality get fewer. */
export function lightBudget(coarse: boolean, level: string): Budget {
  if (level === 'low') return { point: 2, spot: 1 };
  if (coarse || level === 'medium') return { point: 4, spot: 1 };
  return { point: 7, spot: 2 };
}

/** Indices of the lights to keep on: lit ones nearest `to` first, padded with
 *  the nearest dark ones so each kind keeps exactly its budget. */
export function chooseLights(lights: readonly LightSpot[], to: { x: number; y: number; z: number }, budget: Budget): Set<number> {
  const keep = new Set<number>();
  for (const kind of ['point', 'spot'] as const) {
    const ranked = lights
      .map((l, i) => ({ i, l, d: (l.x - to.x) ** 2 + (l.y - to.y) ** 2 + (l.z - to.z) ** 2 }))
      .filter((r) => r.l.kind === kind)
      .sort((a, b) => Number(b.l.lit) - Number(a.l.lit) || a.d - b.d);
    for (const r of ranked.slice(0, budget[kind])) keep.add(r.i);
  }
  return keep;
}

/**
 * A street lamp at full night (three.js physical units: candela, falling off
 * as 1/d²). Its pool on the cobbles is a little brighter than the moonlit
 * lawn, never brighter than the noon sun (6 cd at decay 1.6 was: the plaza's
 * eight overlapping pools burnt to orange-white and bloomed). The bulb glows
 * just over the bloom threshold, so the lamp itself shines and its pool doesn't.
 */
export const STREET_LAMP = { cd: 2.2, distance: 6, decay: 2, bulb: 1.8 } as const;

/** How far the street lamps are on for a night amount (0 day … 1 night):
 *  off in daylight, fully on from early dusk, so they never sit half-lit. */
export function lampLevel(night01: number): number {
  const k = Math.min(1, Math.max(0, (night01 - 0.15) / 0.25));
  return k * k * (3 - 2 * k);
}

/** When the world looks for its lights again: at once after something was
 *  added to or removed from the scene (`mark`: a lamp, a campfire, the gym),
 *  else every `every` seconds as a backstop. A new light used to stay on for
 *  up to 3 s, so the light count changed and every lit shader recompiled. */
export class LightScan {
  private dirty = true;
  private at = -Infinity;

  constructor(private every = 3) {}

  mark(): void {
    this.dirty = true;
  }

  /** True when a rescan is due at `now` (s); the caller then rescans. */
  due(now: number): boolean {
    if (!this.dirty && now - this.at <= this.every) return false;
    this.dirty = false;
    this.at = now;
    return true;
  }
}

/** Mark `scan` whenever a child is added to or removed from one of `roots`
 *  (the scene and the World's roots, where every lamp, fire and house goes). */
export function scanOnChange(scan: LightScan, roots: readonly Object3D[]): void {
  for (const r of roots) {
    r.addEventListener('childadded', () => scan.mark());
    r.addEventListener('childremoved', () => scan.mark());
  }
}
