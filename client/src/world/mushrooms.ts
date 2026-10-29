// A few magic mushrooms among the island's ordinary ones: fairy rings of
// golden, bell-capped Psilocybe in open grass, their caps glowing a little
// violet (more after dark), so they can be found. World.decorate turns a few
// of the ordinary mushroom spots that no tree overhangs into rings, spread
// over the island (`spreadPick`; the layout otherwise as it was), the same
// spots on every screen. Up close, E eats one (main.ts `eatMushroom`): it's gone for
// `MUSHROOM.REGROW_S` and the trip begins (`Trip`; post.ts Grade draws it:
// waves, a slow swirl, split colours, hues turning). Local only: nothing is
// published, nobody else sees it.

import * as THREE from 'three';
import type { Vec2 } from './layout';

export const MUSHROOM = {
  /** How close to a ring's middle you must stand to eat from it. */
  REACH: 0.95,
  REGROW_S: 600,
  /** At most this many rings on the island. */
  MAX: 8,
} as const;

/** The trip's shape (seconds): coming up over ONSET_S, full until PEAK_S, gone by END_S. */
export const TRIP = { ONSET_S: 8, PEAK_S: 55, END_S: 85 } as const;

const smooth = (x: number) => x * x * (3 - 2 * x);

/** Seconds on the wall clock: what the trip and the regrowth are timed by. */
export const wallSeconds = (): number => Date.now() / 1000;

/** How strong the trip is (0–1) over time. Eating another while it's on keeps it at its height. */
export class Trip {
  private start = -Infinity;

  begin(now: number): void {
    const t = now - this.start;
    if (t >= 0 && t < TRIP.ONSET_S) return; // already coming up
    this.start = this.level(now) > 0 ? now - TRIP.ONSET_S : now;
  }

  level(now: number): number {
    const t = now - this.start;
    if (!(t >= 0) || t >= TRIP.END_S) return 0;
    if (t < TRIP.ONSET_S) return smooth(t / TRIP.ONSET_S);
    if (t < TRIP.PEAK_S) return 1;
    return 1 - smooth((t - TRIP.PEAK_S) / (TRIP.END_S - TRIP.PEAK_S));
  }
}

export interface MushroomSpot { x: number; z: number; y: number; rot: number }

/** Up to `n` of `points` (their indices), spread out: a first one picked by `r`, then each time the one farthest from those already picked. */
export function spreadPick(points: readonly Vec2[], n: number, r: () => number): number[] {
  if (!points.length || n <= 0) return [];
  const picked = [Math.floor(r() * points.length)];
  const near = points.map((p) => Math.hypot(p.x - points[picked[0]].x, p.z - points[picked[0]].z));
  while (picked.length < Math.min(n, points.length)) {
    let best = -1;
    near.forEach((d, i) => { if (d > 0 && (best < 0 || d > near[best])) best = i; });
    if (best < 0) break;
    picked.push(best);
    points.forEach((p, i) => { near[i] = Math.min(near[i], Math.hypot(p.x - points[best].x, p.z - points[best].z)); });
  }
  return picked;
}

/** Their size against the shapes below: bigger than the island's ordinary mushrooms, so they can be seen from the follow camera. */
const SIZE = 2.2;

/** A fairy ring: one in the middle and seven round it (offset along the spot's turn, size). */
const CLUSTER: readonly { dx: number; dz: number; s: number }[] = [
  { dx: 0, dz: 0, s: 1.15 },
  ...Array.from({ length: 7 }, (_, i) => {
    const a = (i / 7) * Math.PI * 2, r = 0.15 + 0.02 * (i % 3);
    return { dx: Math.cos(a) * r, dz: Math.sin(a) * r, s: 0.65 + 0.12 * ((i * 5) % 3) };
  }),
];
/** Mushrooms to a spot. */
export const PER_SPOT = CLUSTER.length;

/** A bell cap with a little nipple, turned on a lathe; its rim at y = 0. */
function capGeometry(): THREE.BufferGeometry {
  const pts = [[0, 0.042], [0.006, 0.041], [0.012, 0.036], [0.026, 0.026], [0.037, 0.012], [0.043, 0.002], [0.044, 0], [0.036, -0.002], [0, -0.002]]
    .map(([x, y]) => new THREE.Vector2(x, y));
  return new THREE.LatheGeometry(pts, 9);
}

const STEM_H = 0.1;

export class MagicMushrooms {
  readonly group = new THREE.Group();
  private stems: THREE.InstancedMesh;
  private caps: THREE.InstancedMesh;
  private capMat: THREE.MeshStandardMaterial;
  /** Seconds (World's clock) until each spot grows back; 0: there. */
  private regrowAt: number[];

  constructor(readonly spots: readonly MushroomSpot[]) {
    const n = spots.length * CLUSTER.length;
    const stemGeo = new THREE.CylinderGeometry(0.007, 0.011, STEM_H, 6).translate(0, STEM_H / 2, 0);
    const stemMat = new THREE.MeshStandardMaterial({ color: 0xeee6d2, roughness: 0.8 });
    this.capMat = new THREE.MeshStandardMaterial({ color: 0xc08a3e, roughness: 0.55, emissive: 0x8a5cff, emissiveIntensity: 0.22 });
    this.stems = new THREE.InstancedMesh(stemGeo, stemMat, Math.max(1, n));
    this.caps = new THREE.InstancedMesh(capGeometry().translate(0, STEM_H - 0.004, 0), this.capMat, Math.max(1, n));
    for (const m of [this.stems, this.caps]) {
      m.name = 'magic-mushrooms';
      m.castShadow = false;
      m.receiveShadow = true;
      // Spread over the whole island and tiny: never worth culling.
      m.frustumCulled = false;
      this.group.add(m);
    }
    this.regrowAt = spots.map(() => 0);
    spots.forEach((_, i) => this.place(i, true));
  }

  private place(i: number, shown: boolean): void {
    const sp = this.spots[i];
    const m = new THREE.Matrix4();
    const c = Math.cos(sp.rot), s = Math.sin(sp.rot);
    CLUSTER.forEach((k, j) => {
      const scale = shown ? k.s * SIZE : 0;
      const lean = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.12 * (j - 1), sp.rot + j * 2.1, 0.1 * j));
      const dx = k.dx * SIZE, dz = k.dz * SIZE;
      m.compose(new THREE.Vector3(sp.x + dx * c + dz * s, sp.y, sp.z - dx * s + dz * c), lean, new THREE.Vector3(scale, scale, scale));
      this.stems.setMatrixAt(i * CLUSTER.length + j, m);
      this.caps.setMatrixAt(i * CLUSTER.length + j, m);
    });
    this.stems.instanceMatrix.needsUpdate = this.caps.instanceMatrix.needsUpdate = true;
  }

  /** The nearest spot with mushrooms on it within `reach` of `p`, or -1. */
  near(p: Vec2, reach: number = MUSHROOM.REACH): number {
    let best = -1, bd = reach;
    this.spots.forEach((sp, i) => {
      if (this.regrowAt[i] > 0) return;
      const d = Math.hypot(sp.x - p.x, sp.z - p.z);
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  }

  /** Pick spot `i` (`now`: World's clock); false if there's nothing there. */
  eat(i: number, now: number): boolean {
    if (i < 0 || i >= this.spots.length || this.regrowAt[i] > 0) return false;
    this.regrowAt[i] = now + MUSHROOM.REGROW_S;
    this.place(i, false);
    return true;
  }

  /** Grow back what's due. */
  update(now: number): void {
    this.regrowAt.forEach((t, i) => {
      if (t > 0 && now >= t) { this.regrowAt[i] = 0; this.place(i, true); }
    });
  }

  /** The caps glow a little violet, more after dark. */
  setNight(night: number): void {
    this.capMat.emissiveIntensity = 0.22 + night * 0.6;
  }
}
