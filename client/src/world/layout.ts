// The island's ground plan — pure data, no three.js, so it can be tested.
//
// Everything is derived from a fixed seed: the island is the same every
// visit. Channels are assigned to building slots by activity, busiest
// nearest the plaza.

export interface Vec2 { x: number; z: number }

export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z);

function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x, dz = b.z - a.z;
  const l2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2));
  return Math.hypot(p.x - (a.x + t * dx), p.z - (a.z + t * dz));
}

export function distToPolyline(p: Vec2, line: Vec2[]): number {
  let d = Infinity;
  for (let i = 0; i < line.length - 1; i++) d = Math.min(d, distToSegment(p, line[i], line[i + 1]));
  return d;
}

/** Half the width of the obelisk's bottom step (obelisk.ts plinthSteps(8)). */
export const PLINTH_HALF = 1.553;

export interface Slot {
  index: number;
  pos: Vec2;
  /** Y rotation so the door faces the plaza. */
  rot: number;
  w: number;
  d: number;
  door: Vec2;
  /** Open ground in front of the door where its people hang out. */
  yard: Vec2;
}

export interface Mountain { pos: Vec2; r: number; h: number }

export interface IslandPlan {
  R: number;
  seed: number;
  /** Radius of the top surface at angle θ. */
  radiusAt: (theta: number) => number;
  plaza: { c: Vec2; r: number };
  pond: { c: Vec2; r: number };
  river: Vec2[];
  riverWidth: number;
  waterfall: { pos: Vec2; angle: number };
  mountains: Mountain[];
  slots: Slot[];
  campfire: Vec2;
}

export const ISLAND_R = 18.5;

export function planIsland(seed = 7): IslandPlan {
  const R = ISLAND_R;
  const r0 = rng(seed);
  const harmonics = Array.from({ length: 5 }, (_, i) => ({ k: i + 2, a: (r0() - 0.5) * 0.09 / (1 + i * 0.4), p: r0() * Math.PI * 2 }));
  const radiusAt = (theta: number) => R * (1 + harmonics.reduce((s, h) => s + h.a * Math.sin(h.k * theta + h.p), 0));

  const plaza = { c: { x: 0, z: 0.5 }, r: 3.2 };
  // A little upstream of the straight line from the obelisk to the Liberture
  // house, so the footbridge on that line crosses only the river.
  const pond = { c: { x: 6.7, z: -3.7 }, r: 1.9 };
  // Where the pond stood when the building slots were first laid out (a step
  // downstream): slots still keep clear of it, so moving the pond moved no house.
  const slotPond = { c: { x: 7.2, z: -2.2 }, r: 2.1 };

  // Mountains along the back (−z) edge.
  const mountains: Mountain[] = [];
  const mr = rng(seed + 1);
  for (let i = 0; i < 7; i++) {
    const th = -Math.PI / 2 + (i - 3) * 0.22 + (mr() - 0.5) * 0.08;
    const rad = radiusAt(th) - 2.6 - mr() * 1.4 - (i === 3 ? 0.8 : 0);
    mountains.push({
      pos: { x: Math.cos(th) * rad, z: Math.sin(th) * rad },
      r: 2.3 + mr() * 1.3 + (i === 3 ? 1.2 : 0),
      h: 4 + mr() * 3 + (i === 3 ? 4 : 0) - Math.abs(i - 3) * 0.7,
    });
  }

  // River: from the foot of the mountains, through the pond, off the
  // front-right edge as a waterfall.
  const fallAngle = Math.PI * 0.3;
  const fallR = radiusAt(fallAngle);
  const river: Vec2[] = [
    { x: 4.6, z: -10.8 },
    { x: 5.8, z: -7.6 },
    pond.c,
    { x: 7.2, z: -2.2 },
    { x: 8.4, z: 1.2 },
    { x: 8.6, z: 4.4 },
    { x: Math.cos(fallAngle) * (fallR - 2.2), z: Math.sin(fallAngle) * (fallR - 2.2) },
    { x: Math.cos(fallAngle) * (fallR + 0.4), z: Math.sin(fallAngle) * (fallR + 0.4) },
  ];
  const riverWidth = 1.15;

  const slots: Slot[] = [];
  // Greedy fill from the plaza outward: the first few get big buildings.
  const cands: Vec2[] = [];
  for (let gz = -R; gz <= R; gz += 0.5) for (let gx = -R; gx <= R; gx += 0.5) cands.push({ x: gx, z: gz });
  const sr = rng(seed + 2);
  const jitter = new Map(cands.map((c) => [c, sr() * 0.6]));
  cands.sort((a, b) => Math.hypot(a.x, a.z) + jitter.get(a)! - (Math.hypot(b.x, b.z) + jitter.get(b)!));
  for (const pos of cands) {
    const size = slots.length < 5 ? 3 : 2;
    const r = Math.hypot(pos.x, pos.z);
    const th = Math.atan2(pos.z, pos.x);
    if (r < plaza.r + 2.6) continue;
    const clearance = size * 0.72 + 0.6;
    if (r + clearance > radiusAt(th) - 1.0) continue;
    if (distToPolyline(pos, river) < clearance + riverWidth) continue;
    if (dist(pos, slotPond.c) < slotPond.r + clearance + 0.4 || dist(pos, pond.c) < pond.r + clearance) continue;
    if (mountains.some((m) => dist(pos, m.pos) < m.r + clearance + 0.2)) continue;
    if (slots.some((o) => dist(o.pos, pos) < (o.w + size) / 2 + 2.2)) continue;
    // Face the plaza: door on local +z.
    const rot = Math.round(Math.atan2(plaza.c.x - pos.x, plaza.c.z - pos.z) / (Math.PI / 4)) * (Math.PI / 4);
    const toward = { x: Math.sin(rot), z: Math.cos(rot) };
    const door = { x: pos.x + toward.x * (size / 2 + 0.05), z: pos.z + toward.z * (size / 2 + 0.05) };
    const yard = { x: pos.x + toward.x * (size / 2 + 1.4), z: pos.z + toward.z * (size / 2 + 1.4) };
    if (dist(yard, plaza.c) < 1.5) continue;
    slots.push({ index: slots.length, pos, rot, w: size, d: size, door, yard });
    if (slots.length >= 26) break;
  }

  return {
    R, seed, radiusAt, plaza, pond, river, riverWidth,
    waterfall: { pos: river[river.length - 2], angle: fallAngle },
    mountains, slots,
    campfire: { x: -4.2, z: 4.6 },
  };
}

/** The island's rim as a closed polygon (seen from above), from the same
 *  radius function the ground is built with. */
export function islandOutline(plan: IslandPlan, steps = 96): Vec2[] {
  return Array.from({ length: steps }, (_, i) => {
    const th = (i / steps) * Math.PI * 2;
    const r = plan.radiusAt(th);
    return { x: Math.cos(th) * r, z: Math.sin(th) * r };
  });
}

/** Busiest channel gets slot 0 (nearest the plaza). Ties by id for stability. */
export function assignSlots(groupIds: string[], activity: Map<string, number>, slotCount: number): Map<string, number> {
  const order = [...groupIds].sort((a, b) => (activity.get(b) ?? 0) - (activity.get(a) ?? 0) || a.localeCompare(b));
  const out = new Map<string, number>();
  order.slice(0, slotCount).forEach((id, i) => out.set(id, i));
  return out;
}

// ── navigation grid ──────────────────────────────────────────────────────

export const CELL = 0.5;

export class NavGrid {
  readonly n: number;
  readonly half: number;
  /** 0 walkable, 1 blocked. */
  readonly blocked: Uint8Array;
  /** Movement cost multiplier ×10 (paths cheaper than grass). */
  readonly cost: Uint8Array;

  constructor(readonly extent: number) {
    this.n = Math.ceil((extent * 2) / CELL);
    this.half = extent;
    this.blocked = new Uint8Array(this.n * this.n);
    this.cost = new Uint8Array(this.n * this.n).fill(10);
  }

  cellOf(p: Vec2): [number, number] {
    return [Math.floor((p.x + this.half) / CELL), Math.floor((p.z + this.half) / CELL)];
  }

  centerOf(i: number, j: number): Vec2 {
    return { x: (i + 0.5) * CELL - this.half, z: (j + 0.5) * CELL - this.half };
  }

  idx(i: number, j: number): number { return j * this.n + i; }

  inBounds(i: number, j: number): boolean { return i >= 0 && j >= 0 && i < this.n && j < this.n; }

  walkable(i: number, j: number): boolean { return this.inBounds(i, j) && !this.blocked[this.idx(i, j)]; }

  isWalkable(p: Vec2): boolean { const [i, j] = this.cellOf(p); return this.walkable(i, j); }

  /** Mark every cell whose centre satisfies `pred`. */
  mark(pred: (p: Vec2) => boolean, value: 0 | 1): void {
    for (let j = 0; j < this.n; j++) for (let i = 0; i < this.n; i++) {
      if (pred(this.centerOf(i, j))) this.blocked[this.idx(i, j)] = value;
    }
  }

  setCost(pred: (p: Vec2) => boolean, c: number): void {
    for (let j = 0; j < this.n; j++) for (let i = 0; i < this.n; i++) {
      if (pred(this.centerOf(i, j))) this.cost[this.idx(i, j)] = c;
    }
  }

  nearestWalkable(p: Vec2, maxRing = 12): Vec2 | null {
    const [ci, cj] = this.cellOf(p);
    if (this.walkable(ci, cj)) return p;
    for (let r = 1; r <= maxRing; r++) {
      let best: Vec2 | null = null;
      let bd = Infinity;
      for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        if (!this.walkable(ci + di, cj + dj)) continue;
        const c = this.centerOf(ci + di, cj + dj);
        const d = dist(c, p);
        if (d < bd) { bd = d; best = c; }
      }
      if (best) return best;
    }
    return null;
  }

  /** A* over 8-connected cells; returns world-space waypoints (smoothed),
   *  or null when unreachable. */
  findPath(from: Vec2, to: Vec2): Vec2[] | null {
    const s = this.nearestWalkable(from);
    const g = this.nearestWalkable(to);
    if (!s || !g) return null;
    const [si, sj] = this.cellOf(s);
    const [gi, gj] = this.cellOf(g);
    const start = this.idx(si, sj);
    const goal = this.idx(gi, gj);
    if (start === goal) return [g];
    const N = this.n;
    const gScore = new Float32Array(N * N).fill(Infinity);
    const came = new Int32Array(N * N).fill(-1);
    const closed = new Uint8Array(N * N);
    const heap = new MinHeap();
    gScore[start] = 0;
    heap.push(start, 0);
    const h = (k: number) => {
      const dx = Math.abs((k % N) - gi), dz = Math.abs(((k / N) | 0) - gj);
      return (Math.max(dx, dz) + 0.414 * Math.min(dx, dz)) * 0.6;
    };
    let found = false;
    let iter = 0;
    while (heap.size) {
      const cur = heap.pop();
      if (cur === goal) { found = true; break; }
      if (closed[cur]) continue;
      closed[cur] = 1;
      if (++iter > 40000) break;
      const ci = cur % N, cj = (cur / N) | 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = ci + di, nj = cj + dj;
        if (!this.walkable(ni, nj)) continue;
        // No corner cutting.
        if (di && dj && (!this.walkable(ci + di, cj) || !this.walkable(ci, cj + dj))) continue;
        const nk = this.idx(ni, nj);
        if (closed[nk]) continue;
        const step = (di && dj ? 1.414 : 1) * (this.cost[nk] / 10);
        const ng = gScore[cur] + step;
        if (ng < gScore[nk]) {
          gScore[nk] = ng;
          came[nk] = cur;
          heap.push(nk, ng + h(nk));
        }
      }
    }
    if (!found) return null;
    const cells: number[] = [];
    for (let k = goal; k !== -1; k = came[k]) cells.push(k);
    cells.reverse();
    const pts = cells.map((k) => this.centerOf(k % N, (k / N) | 0));
    pts[pts.length - 1] = g;
    return this.smooth(pts);
  }

  /** Drop waypoints that a straight walk can skip. */
  private smooth(pts: Vec2[]): Vec2[] {
    if (pts.length <= 2) return pts.slice(1);
    const out: Vec2[] = [];
    let anchor = pts[0];
    for (let i = 1; i < pts.length; i++) {
      if (i === pts.length - 1 || !this.lineClear(anchor, pts[i + 1])) {
        out.push(pts[i]);
        anchor = pts[i];
      }
    }
    return out;
  }

  lineClear(a: Vec2, b: Vec2): boolean {
    const steps = Math.ceil(dist(a, b) / (CELL * 0.4));
    let costA = -1;
    for (let s = 0; s <= steps; s++) {
      const t = s / (steps || 1);
      const p = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
      const [i, j] = this.cellOf(p);
      if (!this.walkable(i, j)) return false;
      // Keep people on the paths they chose rather than cutting the grass.
      const c = this.cost[this.idx(i, j)];
      if (costA === -1) costA = c;
      else if (c > costA) return false;
    }
    return true;
  }
}

class MinHeap {
  private keys: number[] = [];
  private pri: number[] = [];
  get size() { return this.keys.length; }
  push(k: number, p: number) {
    this.keys.push(k); this.pri.push(p);
    let i = this.keys.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.pri[parent] <= this.pri[i]) break;
      this.swap(i, parent); i = parent;
    }
  }
  pop(): number {
    const top = this.keys[0];
    const lk = this.keys.pop()!, lp = this.pri.pop()!;
    if (this.keys.length) {
      this.keys[0] = lk; this.pri[0] = lp;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < this.keys.length && this.pri[l] < this.pri[m]) m = l;
        if (r < this.keys.length && this.pri[r] < this.pri[m]) m = r;
        if (m === i) break;
        this.swap(i, m); i = m;
      }
    }
    return top;
  }
  private swap(a: number, b: number) {
    [this.keys[a], this.keys[b]] = [this.keys[b], this.keys[a]];
    [this.pri[a], this.pri[b]] = [this.pri[b], this.pri[a]];
  }
}

/** In the river or the pond (the band the walk grid blocks), and not past the rim where it falls off. */
export function inWater(plan: IslandPlan, p: Vec2): boolean {
  if (Math.hypot(p.x, p.z) > plan.radiusAt(Math.atan2(p.z, p.x)) - 0.9) return false;
  return distToPolyline(p, plan.river) < plan.riverWidth * 0.75 + 0.15 || dist(p, plan.pond.c) < plan.pond.r + 0.25;
}

/** Where the plaza's lanterns stand: a ring just outside its paving (world.ts buildPlaza skips those on a landmark's lawn). */
export function plazaLanterns(plan: Pick<IslandPlan, 'plaza'>, n = 8): Vec2[] {
  const { c, r } = plan.plaza;
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2 + 0.2;
    return { x: c.x + Math.cos(a) * (r + 0.25), z: c.z + Math.sin(a) * (r + 0.25) };
  });
}

/** Build the walk grid for a plan: island top minus water, mountains and
 *  building footprints; plaza and paths cheaper; bridges walkable. */
export function buildNavGrid(plan: IslandPlan, usedSlots: Slot[], bridges: Vec2[] = []): NavGrid {
  const grid = new NavGrid(plan.R + 2);
  grid.mark((p) => {
    const th = Math.atan2(p.z, p.x);
    if (Math.hypot(p.x, p.z) > plan.radiusAt(th) - 0.9) return true;
    if (distToPolyline(p, plan.river) < plan.riverWidth * 0.75 + 0.15) return true;
    if (dist(p, plan.pond.c) < plan.pond.r + 0.25) return true;
    if (plan.mountains.some((m) => dist(p, m.pos) < m.r * 0.92)) return true;
    if (Math.max(Math.abs(p.x - plan.plaza.c.x), Math.abs(p.z - plan.plaza.c.z)) < PLINTH_HALF + 0.2) return true; // the obelisk and its plinth
    for (const s of usedSlots) if (inFootprint(p, s, 0.15)) return true;
    return false;
  }, 1);
  // Bridges: a corridor straight across the river, longer than the blocked
  // band on both banks (a round opening left a thin wall at each end).
  const band = plan.riverWidth * 0.75 + 0.15;
  for (const b of bridges) {
    const t = riverTangentAt(plan.river, b);
    grid.mark((p) => {
      const dx = p.x - b.x, dz = p.z - b.z;
      const along = Math.abs(dx * t.x + dz * t.z);
      const across = Math.abs(-dx * t.z + dz * t.x);
      return along < 0.42 && across < band + 0.6;
    }, 0);
  }
  return grid;
}

export function inFootprint(p: Vec2, s: Slot, pad = 0): boolean {
  const dx = p.x - s.pos.x, dz = p.z - s.pos.z;
  const c = Math.cos(s.rot), sn = Math.sin(s.rot);
  const lx = dx * c - dz * sn, lz = dx * sn + dz * c;
  return Math.abs(lx) < s.w / 2 + pad && Math.abs(lz) < s.d / 2 + pad;
}

/** Points on a circle around `c`, for arranging a conversation. */
export function circleSpots(c: Vec2, count: number, radius = 0.55): Vec2[] {
  if (count <= 1) return [c];
  const r = Math.max(radius, count * 0.16);
  return Array.from({ length: count }, (_, i) => {
    const a = (i / count) * Math.PI * 2;
    return { x: c.x + Math.cos(a) * r, z: c.z + Math.sin(a) * r };
  });
}

// ── themed districts ─────────────────────────────────────────────────────

export type District = 'plaza' | 'sports' | 'gaming' | 'library' | 'stage';

/** Where each district gathers, as an angle around the plaza (radians;
 *  x = cos, z = sin). Mountains sit at −π/2 and the river runs east, so the
 *  open west and front-left take the space-hungry districts. */
export const DISTRICT_ANGLE: Record<Exclude<District, 'plaza'>, number> = {
  sports: Math.PI,
  gaming: Math.PI * 0.72,
  library: Math.PI * 0.42,
  stage: -Math.PI * 0.8,
};

export const TRACK = { halfLength: 2.7, radius: 1.55 } as const;

/** A clear spot for the running track near the sports district, or null. */
export function trackSite(plan: IslandPlan): { c: Vec2; rot: number } | null {
  for (const da of [0, 0.15, -0.15, 0.3, -0.3, 0.45, -0.45]) {
    for (const r of [11.5, 12.5, 10.5, 13.5]) {
      const a = DISTRICT_ANGLE.sports + da;
      const c = { x: Math.cos(a) * r, z: Math.sin(a) * r };
      const reach = TRACK.halfLength + TRACK.radius + 0.6;
      if (Math.hypot(c.x, c.z) + reach > plan.radiusAt(a) - 0.8) continue;
      if (distToPolyline(c, plan.river) < reach + plan.riverWidth) continue;
      if (dist(c, plan.pond.c) < reach + plan.pond.r) continue;
      if (dist(c, plan.plaza.c) < reach + plan.plaza.r + 1) continue;
      if (plan.mountains.some((m) => dist(c, m.pos) < reach + m.r)) continue;
      // Long axis tangent to the island so the oval hugs the rim.
      return { c, rot: a + Math.PI / 2 };
    }
  }
  return null;
}

/** Where the paths cross the river (the footbridges): one stretch before the pond, one after. */
export function bridgePoints(riverPts: Vec2[], pond: Vec2): Vec2[] {
  const pondIdx = riverPts.reduce((best, p, i) => (dist(p, pond) < dist(riverPts[best], pond) ? i : best), 0);
  return [Math.floor(pondIdx * 0.45), Math.floor(pondIdx + (riverPts.length - pondIdx) * 0.45)].map((i) => riverPts[i]);
}

/** Where the watermill's house can't stand: building slots and their yards, the track, the rim. */
export function millBlocked(plan: IslandPlan, track: { c: Vec2; rot: number } | null): (p: Vec2) => boolean {
  return (p) => plan.slots.some((sl) => inFootprint(p, sl, 0.4) || dist(p, sl.yard) < 1)
    || (!!track && onTrack(p, track, 0.6)) || Math.hypot(p.x, p.z) > plan.R - 1.4;
}

/** How far along the river the footbridge by the watermill stands from it:
 *  past the house's half width (0.75), the deck's half (0.55) and a step. */
export const MILL_BRIDGE_GAP = 1.75;

/**
 * The footbridges and the watermill (world.ts and the loading map share it):
 * one bridge upstream, one where the straight line from the obelisk to
 * `line` (the Liberture house) crosses the river, and one right beside the
 * mill's wheel, on its upstream side (toward the village) if there's room. `blocked` is where the
 * mill's house can't stand.
 */
export function waterworks(
  plan: IslandPlan, riverPts: Vec2[], line: Vec2 | null, blocked: (p: Vec2) => boolean,
): { bridges: Vec2[]; mill: MillSite | null } {
  const pond = plan.pond;
  const nearPond = (p: Vec2, pad: number) => dist(p, pond.c) < pond.r + pad;
  const bridges = [riverPts[Math.floor(riverPts.length * 0.11)]];
  if (line) {
    // The river point nearest the segment obelisk → `line`, if it really crosses there.
    const o = plan.plaza.c, dx = line.x - o.x, dz = line.z - o.z, len2 = dx * dx + dz * dz || 1;
    const off = (p: Vec2) => {
      const t = Math.max(0, Math.min(1, ((p.x - o.x) * dx + (p.z - o.z) * dz) / len2));
      return dist(p, { x: o.x + dx * t, z: o.z + dz * t });
    };
    const at = riverPts.reduce((b, p) => (off(p) < off(b) ? p : b));
    if (off(at) < 0.5 && !nearPond(at, 1.7)) bridges.push(at);
  }
  // The mill keeps its stretch near the waterfall (from 72% of the river on).
  const mill = millSite(riverPts, plan.riverWidth * 0.62, { avoid: [...bridges, { ...pond.c, r: pond.r + 0.6 }], clear: 2.4, lo: 0.72, blocked });
  if (!mill) return { bridges: [...bridges, bridgePoints(riverPts, pond.c)[1]], mill };
  const i = riverPts.indexOf(mill.at);
  const along = (dir: 1 | -1): Vec2 | null => {
    let run = 0;
    for (let k = i + dir; k > 0 && k < riverPts.length - 1; k += dir) {
      run += dist(riverPts[k], riverPts[k - dir]);
      if (run >= MILL_BRIDGE_GAP) return riverPts[k];
    }
    return null;
  };
  const fits = (p: Vec2 | null): p is Vec2 => !!p && !nearPond(p, 1.7) && Math.hypot(p.x, p.z) < plan.R - 1.6 && bridges.every((b) => dist(b, p) > 2.5);
  const byMill = [along(-1), along(1)].find(fits);
  return { bridges: byMill ? [...bridges, byMill] : bridges, mill };
}

/**
 * The calisthenics park: beside or past the end of the track, wherever no
 * building slot (used now or later) and no water is in the way.
 */
export function parkSite(plan: IslandPlan, t: { c: Vec2; rot: number }, riverPts: Vec2[]): Vec2 {
  const tan = { x: Math.cos(t.rot), z: Math.sin(t.rot) };
  const nrm = { x: -Math.sin(t.rot), z: Math.cos(t.rot) };
  const candidates = [
    { x: t.c.x + tan.x * 5.4, z: t.c.z + tan.z * 5.4 },
    { x: t.c.x - tan.x * 5.4, z: t.c.z - tan.z * 5.4 },
    { x: t.c.x + nrm.x * 3.2, z: t.c.z + nrm.z * 3.2 },
    { x: t.c.x - nrm.x * 3.2, z: t.c.z - nrm.z * 3.2 },
  ];
  const clearance = (p: Vec2) => Math.min(
    ...plan.slots.filter((sl) => !onTrack(sl.pos, t, sl.w * 0.7 + 0.6)).map((sl) => dist(p, sl.pos) - sl.w * 0.75),
    distToPolyline(p, riverPts) - 1,
    plan.radiusAt(Math.atan2(p.z, p.x)) - Math.hypot(p.x, p.z) - 1.2,
  );
  return candidates.reduce((best, p) => (clearance(p) > clearance(best) ? p : best));
}

/** Is `p` under the track (or its run-off)? Slots there stay empty. */
export function onTrack(p: Vec2, site: { c: Vec2; rot: number }, pad = 0): boolean {
  const dx = p.x - site.c.x, dz = p.z - site.c.z;
  const c = Math.cos(site.rot), s = Math.sin(site.rot);
  const lx = dx * c + dz * s, lz = -dx * s + dz * c;
  const ex = Math.max(0, Math.abs(lx) - TRACK.halfLength);
  return Math.hypot(ex, lz) < TRACK.radius + pad;
}

/**
 * Channels to slots by district. Themed channels gather around their
 * district's point on the outer ring (busiest first); plaza channels then
 * take what's left nearest the plaza. Slots under the track are skipped.
 */
export function assignByDistrict(
  channels: { id: string; district: District; activity: number }[],
  plan: IslandPlan,
  track: { c: Vec2; rot: number } | null,
): Map<string, number> {
  const out = new Map<string, number>();
  const free = new Set(plan.slots.filter((s) => !track || !onTrack(s.pos, track, s.w * 0.7 + 0.6)).map((s) => s.index));
  const byActivity = (a: { id: string; activity: number }, b: { id: string; activity: number }) => b.activity - a.activity || a.id.localeCompare(b.id);
  for (const d of ['sports', 'gaming', 'library', 'stage'] as const) {
    const mine = channels.filter((c) => c.district === d).sort(byActivity);
    if (!mine.length) continue;
    const a = DISTRICT_ANGLE[d];
    const centre = d === 'sports' && track ? track.c : { x: Math.cos(a) * 11.5, z: Math.sin(a) * 11.5 };
    for (const ch of mine) {
      let best: Slot | null = null;
      for (const s of plan.slots) if (free.has(s.index) && (!best || dist(s.pos, centre) < dist(best.pos, centre))) best = s;
      if (!best) break;
      out.set(ch.id, best.index);
      free.delete(best.index);
    }
  }
  const plaza = channels.filter((c) => c.district === 'plaza' || !out.has(c.id)).filter((c) => !out.has(c.id)).sort(byActivity);
  for (const ch of plaza) {
    let best: Slot | null = null;
    for (const s of plan.slots) if (free.has(s.index) && (!best || s.index < best.index)) best = s;
    if (!best) break;
    out.set(ch.id, best.index);
    free.delete(best.index);
  }
  return out;
}

// ── watermill ───────────────────────────────────────────────────────────

export interface MillSite {
  /** The river point the mill stands at, its downstream tangent, and the
   *  unit normal pointing at the bank the house stands on. */
  at: Vec2;
  t: Vec2;
  n: Vec2;
  /** Wheel centre (in the water, by the house's bank) and house centre (on land). */
  wheel: Vec2;
  house: Vec2;
  /** Y rotation that turns local +X (the wheel's axle) onto `n`. */
  rot: number;
  /** +1 or -1: spin about the axle that moves the wheel's bottom downstream. */
  spin: number;
}

export const MILL = { wheelRadius: 0.5, wheelWidth: 0.58, houseDepth: 1.1, houseWidth: 1.5 };

/**
 * Where the watermill goes: the straightest stretch of river in
 * [lo, hi] of its length, at least `clear` from every point in `avoid`
 * (bridges, the pond), with the house on the bank toward the island's centre
 * and not on anything `blocked` says is taken (slots, paths, the track).
 */
export function millSite(
  river: Vec2[], halfWidth: number,
  opts: { avoid?: (Vec2 & { r?: number })[]; clear?: number; lo?: number; hi?: number; blocked?: (p: Vec2) => boolean } = {},
): MillSite | null {
  const { avoid = [], clear = 2.2, lo = 0.6, hi = 0.92, blocked = () => false } = opts;
  let best: MillSite | null = null;
  let bestBend = Infinity;
  for (let i = Math.max(3, Math.floor(river.length * lo)); i <= Math.min(river.length - 4, Math.floor(river.length * hi)); i++) {
    const a = river[i - 3], p = river[i], b = river[i + 3];
    if (avoid.some((q) => dist(q, p) < clear + (q.r ?? 0))) continue;
    const t1 = norm({ x: p.x - a.x, z: p.z - a.z }), t2 = norm({ x: b.x - p.x, z: b.z - p.z });
    const bend = 1 - (t1.x * t2.x + t1.z * t2.z);
    const t = norm({ x: b.x - a.x, z: b.z - a.z });
    // Normal toward the island's centre (the side with land to build on).
    let n = { x: -t.z, z: t.x };
    if (n.x * -p.x + n.z * -p.z < 0) n = { x: -n.x, z: -n.z };
    const wheelOff = halfWidth - MILL.wheelWidth / 2 - 0.04;
    const houseOff = halfWidth + 0.25 + MILL.houseDepth / 2;
    const wheel = { x: p.x + n.x * wheelOff, z: p.z + n.z * wheelOff };
    const house = { x: p.x + n.x * houseOff, z: p.z + n.z * houseOff };
    const corners = [-1, 1].flatMap((sx) => [-1, 1].map((sz) => ({
      x: house.x + n.x * sx * MILL.houseDepth / 2 + t.x * sz * MILL.houseWidth / 2,
      z: house.z + n.z * sx * MILL.houseDepth / 2 + t.z * sz * MILL.houseWidth / 2,
    })));
    if (blocked(house) || corners.some(blocked)) continue;
    if (bend < bestBend) {
      bestBend = bend;
      // Bottom of a wheel spinning +ω about n moves along -(n × up) = (n.z, 0, -n.x)·ω.
      const bottom = { x: n.z, z: -n.x };
      const spin = bottom.x * t.x + bottom.z * t.z >= 0 ? 1 : -1;
      best = { at: p, t, n, wheel, house, rot: Math.atan2(-n.z, n.x), spin };
    }
  }
  return best;
}

function norm(v: Vec2): Vec2 {
  const l = Math.hypot(v.x, v.z) || 1;
  return { x: v.x / l, z: v.z / l };
}

/** Unit direction of the river polyline's segment nearest to p. */
export function riverTangentAt(line: Vec2[], p: Vec2): Vec2 {
  let best = { x: 1, z: 0 }, bd = Infinity;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i];
    const vx = b.x - a.x, vz = b.z - a.z;
    const len2 = vx * vx + vz * vz || 1;
    const k = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.z - a.z) * vz) / len2));
    const d = Math.hypot(a.x + vx * k - p.x, a.z + vz * k - p.z);
    if (d < bd) { bd = d; const l = Math.sqrt(len2); best = { x: vx / l, z: vz / l }; }
  }
  return best;
}

/** Half extents of the axis-aligned box round a `hx` × `hz` rectangle turned by `yaw`. */
export function turnedHalf(hx: number, hz: number, yaw: number): { hx: number; hz: number } {
  const c = Math.abs(Math.cos(yaw)), sn = Math.abs(Math.sin(yaw));
  return { hx: c * hx + sn * hz, hz: sn * hx + c * hz };
}
