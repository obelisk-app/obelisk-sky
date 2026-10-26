// The gym: one channel's house becomes a glass-walled hall you can walk into,
// with a bench press, a squat rack and a curl spot in front of a mirror. Its
// machines are training stations like the park's (world.ts `stations`), so
// several people train at once, each on their own machine.
//
// It wears openGym's look (github.com/DuarteSantos8/openGym, the self-hosted
// gym tracker): near-black cladding, lime accents, the lime dumbbell and the
// "openGym" wordmark over the door, a screen on the back wall with the app's
// home card, and the dumbbell on the floor.

import * as THREE from 'three';
import type { ExerciseKind } from './anim/exercises';
import { bitcoinSign, canvasTexture } from './landmarks/signs';
import type { Building } from './buildings';
import type { LandmarkInterior } from './landmarks';
import type { Slot, Vec2 } from './layout';
import type { District } from './layout';

/** Channel names that are a gym. */
export const GYM_RE = /\bgym\b|gimnasio|fitness|\bfit\b|crossfit|pesas|weights|musculaci|powerlift|halterof/i;

/** Which channel gets the gym: one named like a gym (La Crypta's first), else
 *  the first sports-district text channel. Needs a slot two wide or more. */
export function pickGymChannel(
  groups: readonly { id: string; name: string; kind: string }[],
  districtFor: (id: string) => District,
  slotWidth: (id: string) => number,
): string | null {
  const ok = groups.filter((g) => !g.kind.startsWith('voice') && slotWidth(g.id) >= 2);
  const named = ok.filter((g) => GYM_RE.test(g.name));
  return (named.find((g) => /crypta/i.test(g.name)) ?? named[0] ?? ok.find((g) => districtFor(g.id) === 'sports'))?.id ?? null;
}

/** A machine, in the hall's local frame (front wall, with the door, at +z). */
export interface GymStation {
  at: Vec2;
  /** Which way the person faces (atan2(dx, dz), local). */
  face: number;
  /** Bench height (lying), or 0 (standing). */
  grip: number;
  kinds: ExerciseKind[];
  /** The bar resting on the machine, hidden while someone lifts it. */
  rest?: THREE.Object3D;
  /** Where you step to and from the machine (local). */
  approach: Vec2;
}

export interface GymBuild extends Building {
  interior: LandmarkInterior;
  stations: GymStation[];
  /** Furniture (local, axis-aligned): bump into it, jump on it. */
  solids: { x: number; z: number; hx: number; hz: number; top: number }[];
  /** The floor inside, and a ramp up through the doorway (local). */
  groundAt(local: Vec2): number;
}

/** The gym never closes: its lights by day and how they rise at night. */
export const GYM_LIGHTS = { lampDay: 0.6, lampNight: 2.6, stripDay: 0.8, stripNight: 2.4, glassNight: 0.35 } as const;

/** Light levels for a night amount (0 day … 1 night): never off. */
export function gymLights(night: number): { lamp: number; strip: number; glass: number } {
  const n = Math.min(1, Math.max(0, night));
  const L = GYM_LIGHTS;
  return { lamp: L.lampDay + (L.lampNight - L.lampDay) * n, strip: L.stripDay + (L.stripNight - L.stripDay) * n, glass: L.glassNight * n };
}

/** The bench's height: the person lies on it. */
export const BENCH_TOP = 0.2;

/** openGym's palette (its banner and app icon). */
export const OPENGYM = { ink: 0x0c0e12, panel: 0x161a21, edge: 0x2b3140, lime: 0xa3e635, green: 0x30d158 } as const;

const mat = (color: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.75, ...extra });

/** A barbell along x, `len` long, plates at both ends. */
export function buildBarbell(len = 0.62, plateR = 0.07): THREE.Group {
  const g = new THREE.Group();
  const steel = mat(0xb9c0c8, { metalness: 0.8, roughness: 0.3 });
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, len, 8), steel);
  bar.rotation.z = Math.PI / 2;
  g.add(bar);
  const plate = mat(0x1d1f24, { roughness: 0.6 });
  for (const s of [-1, 1]) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(plateR, plateR, 0.03, 16), plate);
    p.rotation.z = Math.PI / 2;
    p.position.x = s * (len / 2 - 0.06);
    p.castShadow = true;
    g.add(p);
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(plateR * 0.45, plateR * 0.45, 0.034, 12), mat(OPENGYM.lime, { emissive: 0x2a3a10 }));
    rim.rotation.z = Math.PI / 2;
    rim.position.x = p.position.x;
    g.add(rim);
  }
  return g;
}

export function buildGym(slot: Slot, roofColor: number): GymBuild {
  const group = new THREE.Group();
  group.position.set(slot.pos.x, 0, slot.pos.z);
  group.rotation.y = slot.rot;
  const W = slot.w, D = slot.d;
  const H = 1.25;
  const T = 0.08; // wall thickness
  const add = <T extends THREE.Object3D>(o: T, x: number, y: number, z: number): T => {
    o.position.set(x, y, z);
    o.castShadow = o.receiveShadow = true;
    group.add(o);
    return o;
  };
  const box = (w: number, h: number, d: number, m: THREE.Material) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);

  // Floor: concrete slab, black rubber tiles inside.
  add(box(W + 0.2, 0.14, D + 0.2, mat(0x9a948c)), 0, 0.03, 0);
  const rubber = add(box(W - 0.1, 0.02, D - 0.1, mat(0x1c1f25, { roughness: 1 })), 0, 0.105, 0);
  rubber.castShadow = false;
  const F = 0.115; // floor level inside
  // openGym's dumbbell, painted on the floor in the middle.
  const decal = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.18), new THREE.MeshStandardMaterial({ map: dumbbellTexture(), transparent: true, roughness: 0.9, depthWrite: false }));
  decal.rotation.x = -Math.PI / 2;
  decal.position.set(0, F + 0.002, 0.02);
  decal.receiveShadow = true;
  group.add(decal);

  // Walls: dark cladding (openGym's near-black) at the back with a mirror and
  // the app's screen, glass sides and front on a low clad base.
  const brick = mat(OPENGYM.panel, { roughness: 0.85 });
  // At night the glass glows a little: the hall reads as lit from outside.
  const glass = new THREE.MeshPhysicalMaterial({ color: 0xbfe6ff, transparent: true, opacity: 0.22, roughness: 0.18, metalness: 0.1, depthWrite: false, emissive: 0xfff4dc, emissiveIntensity: 0 });
  const frame = mat(OPENGYM.edge, { metalness: 0.5, roughness: 0.4 });
  const walls: THREE.Mesh[] = [];
  walls.push(add(box(W, H, T, brick), 0, F + H / 2, -D / 2 + T / 2));
  const mirror = add(box(W * 0.42, 0.62, 0.012, mat(0xdfe8ee, { metalness: 0.9, roughness: 0.2 })), -W * 0.16, F + 0.55, -D / 2 + T + 0.007);
  mirror.castShadow = false;
  // The openGym home card on a wall screen: today's workout, body weight, the streak.
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(W * 0.26, W * 0.26 * 0.62), new THREE.MeshBasicMaterial({ map: openGymScreen(), toneMapped: false }));
  screen.name = 'gym-screen';
  // The bezel ends at T + 0.008: put the picture in front of that face,
  // rather than inside the box where depth precision makes it flicker.
  screen.position.set(W * 0.27, F + 0.66, -D / 2 + T + 0.012);
  group.add(screen);
  add(box(W * 0.26 + 0.03, W * 0.26 * 0.62 + 0.03, 0.012, mat(OPENGYM.ink)), W * 0.27, F + 0.66, -D / 2 + T + 0.002).castShadow = false;
  const DOOR = 0.62;
  const glassWall = (x: number, z: number, w: number, d: number) => {
    walls.push(add(box(w, 0.28, d, brick), x, F + 0.14, z));
    // Stop below the upper rail: a pane extending through it puts two top
    // faces at exactly the same height, causing striped depth flicker.
    const paneH = H - 0.28 - 0.05;
    const pane = add(box(w === T ? w * 0.4 : w, paneH, d === T ? d * 0.4 : d, glass), x, F + 0.28 + paneH / 2, z);
    // Keep each pane independently sortable. Merging transparent walls fixes
    // their triangle order and makes the glass pop as the camera moves.
    pane.name = 'gym-glass';
    pane.castShadow = pane.receiveShadow = false;
    walls.push(add(box(w, 0.05, d, frame), x, F + H - 0.025, z));
  };
  glassWall(-W / 2 + T / 2, 0, T, D);
  glassWall(W / 2 - T / 2, 0, T, D);
  const side = (W - DOOR) / 2;
  glassWall(-W / 2 + side / 2, D / 2 - T / 2, side, T);
  glassWall(W / 2 - side / 2, D / 2 - T / 2, side, T);
  // Sliding glass door.
  // A separate outer sliding track keeps the open door clear of the fixed
  // pane; coincident glass faces used to shimmer where they overlapped.
  const door = add(box(DOOR, H - 0.05, 0.03, glass), 0, F + (H - 0.05) / 2, D / 2 + 0.01);
  door.name = 'gym-door';
  door.castShadow = door.receiveShadow = false;
  // "Bitcoin accepted here" stuck on the glass beside the door.
  const btc = add(bitcoinSign(), DOOR / 2 + 0.2, F + 0.72, D / 2 - T * 0.3 + 0.004);
  btc.castShadow = false;
  for (const x of [-W / 2, W / 2, -DOOR / 2, DOOR / 2]) walls.push(add(box(0.06, H, 0.06, frame), x, F + H / 2, D / 2 - T / 2));

  // Flat roof with a fascia in the channel's colour (it names the house), a
  // lime trim under it, and the openGym sign on top.
  const roofParts: THREE.Object3D[] = [];
  const roof = add(box(W + 0.3, 0.12, D + 0.3, mat(OPENGYM.edge)), 0, F + H + 0.06, 0);
  roof.name = 'roof';
  roofParts.push(roof);
  // The lime dumbbell painted across the roof: the gym, seen from above.
  const roofMark = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(W, D) * 0.8, Math.min(W, D) * 0.8 * 0.36), new THREE.MeshStandardMaterial({ map: dumbbellTexture(), transparent: true, roughness: 0.8, depthWrite: false }));
  roofMark.rotation.x = -Math.PI / 2;
  roofMark.position.set(0, F + H + 0.122, 0);
  group.add(roofMark);
  roofParts.push(roofMark);
  roofParts.push(add(box(W + 0.34, 0.2, 0.06, mat(roofColor)), 0, F + H + 0.02, D / 2 + 0.15));
  roofParts.push(add(box(W + 0.34, 0.025, 0.065, mat(OPENGYM.lime, { emissive: OPENGYM.lime, emissiveIntensity: 0.35 })), 0, F + H - 0.09, D / 2 + 0.15));
  const sign = gymSign();
  sign.position.set(0, F + H + 0.3, D / 2 + 0.12);
  group.add(sign);
  roofParts.push(sign);

  const solids: GymBuild['solids'] = [];
  const stations: GymStation[] = [];
  const steel = mat(0x8d969e, { metalness: 0.7, roughness: 0.35 });
  const pad = mat(0x15161a, { roughness: 0.8 });
  const accent = mat(OPENGYM.lime, { roughness: 0.5 });

  // Bench press: the bench runs front to back, the lifter lies with the feet
  // toward the door; uprights at the head hold the bar.
  {
    const x = -W / 4 + 0.02, z = -D / 4 + 0.15;
    const g = new THREE.Group();
    g.position.set(x, F, z);
    group.add(g);
    const bench = box(0.2, 0.05, 0.78, pad);
    bench.position.set(0, BENCH_TOP - 0.025, -0.1);
    bench.castShadow = true;
    g.add(bench);
    for (const lz of [-0.4, 0.22]) {
      const leg = box(0.16, BENCH_TOP - 0.05, 0.05, steel);
      leg.position.set(0, (BENCH_TOP - 0.05) / 2, lz);
      g.add(leg);
    }
    for (const sx of [-1, 1]) {
      const up = box(0.035, 0.52, 0.035, steel);
      up.position.set(sx * 0.27, 0.26, -0.42);
      up.castShadow = true;
      g.add(up);
      const hook = box(0.05, 0.02, 0.06, accent);
      hook.position.set(sx * 0.27, 0.44, -0.4);
      g.add(hook);
    }
    const rest = buildBarbell(0.68);
    rest.position.set(0, 0.465, -0.38);
    g.add(rest);
    solids.push({ x, z: z - 0.1, hx: 0.12, hz: 0.42, top: F + BENCH_TOP });
    // The lifter's hips sit on the bench's front half; the head toward the uprights.
    // Grip: the bench top above the floor you stand on (the floor is raised ground).
    stations.push({ at: { x, z: z + 0.12 }, face: 0, grip: BENCH_TOP, kinds: ['benchpress'], rest, approach: { x: x + 0.3, z: z + 0.15 } });
  }

  // Squat rack: four posts and safety bars, facing the mirror.
  {
    const x = W / 4 - 0.02, z = -D / 4 + 0.05;
    const g = new THREE.Group();
    g.position.set(x, F, z);
    group.add(g);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const post = box(0.04, 1.0, 0.04, steel);
      post.position.set(sx * 0.3, 0.5, sz * 0.22);
      post.castShadow = true;
      g.add(post);
    }
    for (const sz of [-1, 1]) {
      const top = box(0.64, 0.04, 0.04, steel);
      top.position.set(0, 1.0, sz * 0.22);
      g.add(top);
    }
    for (const sx of [-1, 1]) {
      const safety = box(0.04, 0.03, 0.5, accent);
      safety.position.set(sx * 0.3, 0.3, 0);
      g.add(safety);
    }
    const rest = buildBarbell(0.72, 0.08);
    rest.position.set(0, 0.58, -0.2);
    g.add(rest);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) solids.push({ x: x + sx * 0.3, z: z + sz * 0.22, hx: 0.04, hz: 0.04, top: F + 1.0 });
    stations.push({ at: { x, z: z + 0.02 }, face: Math.PI, grip: 0, kinds: ['squat'], rest, approach: { x, z: z + 0.5 } });
  }

  // Dumbbell rack along the back wall, and a curl spot in front of the mirror.
  {
    const z = -D / 2 + T + 0.16;
    const rack = add(box(W * 0.5, 0.05, 0.18, steel), 0, F + 0.24, z);
    rack.castShadow = true;
    for (const lx of [-W * 0.23, W * 0.23]) add(box(0.04, 0.24, 0.16, steel), lx, F + 0.12, z);
    const bell = mat(0x1d1f24, { roughness: 0.55 });
    const n = Math.max(4, Math.round(W * 3));
    for (let i = 0; i < n; i++) {
      const lx = -W * 0.22 + (W * 0.44 * i) / (n - 1);
      const r = 0.026 + (i / n) * 0.016;
      for (const s of [-1, 1]) {
        const head = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.03, 10), bell);
        head.rotation.x = Math.PI / 2;
        add(head, lx, F + 0.27 + r, z + s * 0.05);
      }
    }
    solids.push({ x: 0, z, hx: W * 0.25, hz: 0.1, top: F + 0.27 });
    stations.push({ at: { x: 0, z: D / 4 - 0.05 }, face: Math.PI, grip: 0, kinds: ['curl'], approach: { x: 0, z: D / 4 + 0.35 } });
    // Kettlebells in a corner.
    const kb = mat(0x2b2e34, { metalness: 0.4, roughness: 0.5 });
    for (let i = 0; i < 3; i++) {
      const k = new THREE.Mesh(new THREE.SphereGeometry(0.045 + i * 0.008, 10, 8), kb);
      add(k, -W / 2 + 0.2 + i * 0.13, F + 0.05, D / 2 - 0.25);
    }
  }

  // Open 24 hours: strip lights along the ceiling are always on (they glow,
  // so they cost no light), and a light fills the hall, brighter at night.
  const stripMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xf4fbff, emissiveIntensity: GYM_LIGHTS.stripDay, roughness: 0.4 });
  for (const lz of [-D / 4, D / 4]) {
    const strip = box(W * 0.7, 0.025, 0.05, stripMat);
    strip.position.set(0, F + H - 0.03, lz);
    strip.name = 'gym-strip';
    group.add(strip);
  }
  const lamp = new THREE.PointLight(0xf2f7ff, GYM_LIGHTS.lampDay, W * 1.8, 1.4);
  lamp.position.set(0, F + H - 0.15, 0);
  group.add(lamp);
  const windows: THREE.Mesh[] = [];

  let insideNow = false;
  const interior: LandmarkInterior = {
    rooms: [
      { minX: -W / 2 + T + 0.04, maxX: W / 2 - T - 0.04, minZ: -D / 2 + T + 0.04, maxZ: D / 2 - T - 0.04 },
      { minX: -DOOR / 2 + 0.06, maxX: DOOR / 2 - 0.06, minZ: D / 2 - 0.3, maxZ: D / 2 + 0.65 },
    ],
    door: { x: 0, z: D / 2 },
    setDoor(open) { door.position.x = open * DOOR * 0.9; },
    setInside(on) {
      if (on === insideNow) return;
      insideNow = on;
      for (const o of roofParts) o.visible = !on;
      brick.transparent = on;
      brick.opacity = on ? 0.3 : 1;
      brick.depthWrite = !on;
      brick.needsUpdate = true;
      for (const w of walls) w.castShadow = !on;
    },
  };
  group.userData.setNight = (night: number) => {
    const k = gymLights(night);
    lamp.intensity = k.lamp;
    stripMat.emissiveIntensity = k.strip;
    glass.emissiveIntensity = k.glass;
  };
  const room = interior.rooms[0], doorway = interior.rooms[1];
  const groundAt = (l: Vec2): number => {
    if (l.x > room.minX && l.x < room.maxX && l.z > room.minZ && l.z < room.maxZ) return F;
    // The concrete slab's rim (top 0.1) eases up from its edge.
    const rim = Math.min(W / 2 + 0.1 - Math.abs(l.x), D / 2 + 0.1 - Math.abs(l.z));
    const slab = rim > 0 ? 0.1 * Math.min(1, rim / 0.1) : 0;
    if (l.x > doorway.minX && l.x < doorway.maxX && l.z > doorway.minZ && l.z < doorway.maxZ) {
      // A gentle ramp over the threshold, up to the floor just inside.
      const k = (doorway.maxZ - l.z) / (doorway.maxZ - (D / 2 - 0.1));
      return Math.max(slab, F * Math.min(1, Math.max(0, k)));
    }
    return slab;
  };
  return { group, windows, doorLocal: new THREE.Vector3(0, 0, D / 2 + 0.3), height: F + H + 0.5, roofColor, interior, stations, solids, groundAt };
}

/** openGym's dumbbell (its app icon's five bars), drawn into a box on a 2D canvas. */
function drawDumbbell(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string): void {
  // The icon's bars on its 512 grid: bar, inner plates, outer plates.
  const bars = [[80, 242, 352, 28], [80, 199, 36, 114], [131, 169, 47, 174], [334, 169, 47, 174], [396, 199, 36, 114]];
  const sx = w / 352, sy = h / 174;
  g.fillStyle = color;
  for (const [bx, by, bw, bh] of bars) {
    const r = Math.min(bw * sx, bh * sy) * 0.3;
    g.beginPath();
    g.roundRect(x + (bx - 80) * sx, y + (by - 169) * sy, bw * sx, bh * sy, r);
    g.fill();
  }
}

/** The lime dumbbell on a clear ground (the floor decal). */
function dumbbellTexture(): THREE.CanvasTexture {
  return canvasTexture(512, 184, (g) => drawDumbbell(g, 6, 5, 500, 174, '#a3e635'));
}

/** openGym's banner: the lime dumbbell and "open" + "Gym" on its dark board. */
function gymSign(): THREE.Mesh {
  const tex = canvasTexture(512, 128, (g) => {
    const grad = g.createLinearGradient(0, 0, 512, 128);
    grad.addColorStop(0, '#12151b');
    grad.addColorStop(1, '#0c0e12');
    g.fillStyle = grad;
    g.beginPath();
    g.roundRect(2, 2, 508, 124, 18);
    g.fill();
    g.strokeStyle = '#2b3140';
    g.lineWidth = 4;
    g.stroke();
    g.shadowColor = '#a3e635';
    g.shadowBlur = 14;
    drawDumbbell(g, 26, 34, 120, 60, '#a3e635');
    g.font = '800 64px Inter, system-ui, sans-serif';
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    g.shadowBlur = 0;
    g.fillStyle = '#eef1f6';
    g.fillText('open', 164, 66);
    const w = g.measureText('open').width;
    g.shadowBlur = 16;
    g.fillStyle = '#a3e635';
    g.fillText('Gym', 164 + w, 66);
  });
  return new THREE.Mesh(new THREE.PlaneGeometry(0.84, 0.21), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, transparent: true }));
}

/** The app's home card, as on its phone screen: today's workout, body weight and the streak. */
function openGymScreen(): THREE.CanvasTexture {
  return canvasTexture(512, 318, (g) => {
    g.fillStyle = '#000000';
    g.fillRect(0, 0, 512, 318);
    g.textBaseline = 'alphabetic';
    g.fillStyle = '#ffffff';
    g.font = '800 38px Inter, system-ui, sans-serif';
    g.fillText('openGym', 22, 48);
    // Today.
    g.fillStyle = '#1c1c1e';
    g.beginPath(); g.roundRect(16, 64, 480, 66, 14); g.fill();
    g.fillStyle = '#30d158';
    g.beginPath(); g.roundRect(30, 76, 42, 42, 10); g.fill();
    drawDumbbell(g, 36, 89, 30, 15, '#ffffff');
    g.fillStyle = 'rgba(235,235,245,0.6)';
    g.font = '600 15px Inter, system-ui, sans-serif';
    g.fillText('TODAY', 86, 90);
    g.fillStyle = '#ffffff';
    g.font = '600 24px Inter, system-ui, sans-serif';
    g.fillText('Push Day', 86, 118);
    g.fillStyle = '#248a3d';
    g.beginPath(); g.roundRect(404, 82, 76, 30, 8); g.fill();
    g.fillStyle = '#30d158';
    g.font = '600 17px Inter, system-ui, sans-serif';
    g.fillText('Start', 422, 103);
    // Body weight, with its line and the dashed goal.
    g.fillStyle = '#1c1c1e';
    g.beginPath(); g.roundRect(16, 142, 300, 160, 14); g.fill();
    g.fillStyle = 'rgba(235,235,245,0.6)';
    g.font = '500 15px Inter, system-ui, sans-serif';
    g.fillText('Body weight', 30, 168);
    g.fillStyle = '#ffffff';
    g.font = '800 34px Inter, system-ui, sans-serif';
    g.fillText('78.4', 30, 206);
    g.fillStyle = '#30d158';
    g.font = '600 16px Inter, system-ui, sans-serif';
    g.fillText('↓ 0.5 kg', 112, 206);
    const pts = [82.5, 82.9, 81.9, 81.8, 81.4, 81.3, 80.6, 80.7, 80.3, 79.6, 79.5, 79.0, 79.1, 78.6, 78.4];
    const px = (k: number) => 30 + (k / (pts.length - 1)) * 270, py = (v: number) => 290 - (v - 76.8) * 12;
    g.strokeStyle = '#ffd60a';
    g.setLineDash([6, 5]);
    g.lineWidth = 2;
    g.beginPath(); g.moveTo(30, py(77)); g.lineTo(300, py(77)); g.stroke();
    g.setLineDash([]);
    g.strokeStyle = '#30d158';
    g.lineWidth = 3;
    g.beginPath();
    pts.forEach((v, k) => (k ? g.lineTo(px(k), py(v)) : g.moveTo(px(k), py(v))));
    g.stroke();
    // The streak.
    g.fillStyle = '#1c1c1e';
    g.beginPath(); g.roundRect(328, 142, 168, 160, 14); g.fill();
    g.fillStyle = '#ff9f0a';
    g.font = '700 30px Inter, system-ui, sans-serif';
    g.fillText('🔥', 344, 190);
    g.fillStyle = '#ffffff';
    g.font = '800 44px Inter, system-ui, sans-serif';
    g.fillText('12', 344, 246);
    g.fillStyle = 'rgba(235,235,245,0.6)';
    g.font = '600 16px Inter, system-ui, sans-serif';
    g.fillText('week streak', 344, 274);
  });
}
