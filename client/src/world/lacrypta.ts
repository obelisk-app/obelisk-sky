// La Crypta's house, from photos of its front in Buenos Aires: a red-brick
// Tudor front of two equal gables side by side, a downpipe between them;
// mullioned triple pointed-arch windows in pale stone frames (two tiers on
// the left bay, one on the right, a slit vent high in the right gable); a
// tall grey stone base under the left bay; the wooden arched door half a
// storey up on the right, reached by stone steps that curve down a grassy
// mound to the street, with a fairy-light rail and a round shrub by the door.
// La Crypta's arched, striped logo beside the door, at its height, is backlit; a
// white glowing ball with the gold ₿ sits on the lawn; red and violet
// uplights at night. No front fence.
//
// On the left, flush with the front and as tall, the older wing on flat
// ground: a wooden arched garage door in stone, a band of leaded windows
// that glow orange at night, a wooden balcony, and a slate gable like the
// others turned to face the side, joining the house's roof as a cross gable.
//
// You can walk up the steps and in: the door swings open on the living
// room (lacryptaInterior.ts), the fireplace under the neon ₿.
//
// Local space: the facade is the plane z = 0 facing +z; the house is behind
// it, the mound and stairs in front of it.

import * as THREE from 'three';
import { grassDetailTexture } from './island';
import type { LandmarkBuild, LocalRect } from './landmarks';
import type { Vec2 } from './layout';
import { buildLivingRoom } from './lacryptaInterior';

const flat = (color: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.9, ...extra });

// The house's measures (also used by the walkable ground below).
const W = 2.9;            // facade width: two bays
const bay = W / 2;
const D = 2.1;            // depth behind the facade
const T = 0.07;           // wall thickness
const lift = 0.7;         // the raised ground floor (top of the stone base)
const eaves = lift + 2.0; // where the gables start
const rise = 1.15;        // gable height
const ceil = lift + 1.25; // the living room's ceiling
const L = -bay / 2, R = bay / 2; // bay centres
const doorX = R - 0.25;
const DOOR_W = 0.48, DOOR_H = 0.85;
const moundDepth = 2.0;
const moundX0 = -W / 2, moundX1 = W / 2 + 0.3;
/** The older wing on the left, flush with the front of the house. */
const WING_W = 1.05, WING_Z = 0;

/** The living room, inside the walls. */
const ROOM: LocalRect = { minX: -W / 2 + T, maxX: W / 2 - T, minZ: -D + T, maxZ: -T };
/** The landing in front of the door and the doorway through the front wall. */
const LANDING: LocalRect = { minX: doorX - 0.35, maxX: doorX + 0.35, minZ: -T - 0.02, maxZ: 0.42 };

/** The grassy mound: highest under the door, falling to the street and to the
 *  left, both side edges down to the ground. */
function moundHeight(x: number, z: number): number {
  if (x < moundX0 || x > moundX1 || z < 0 || z > moundDepth) return 0;
  const across = THREE.MathUtils.clamp((x - (L - 0.2)) / (doorX - (L - 0.2)), 0, 1);
  const out = 1 - z / moundDepth;
  const edge = Math.min(1, (x - moundX0) / 0.45, (moundX1 - x) / 0.45);
  const e = edge * edge * (3 - 2 * edge);
  return Math.max(0, lift * Math.pow(out, 1.15) * (0.25 + 0.75 * across) * e);
}

/** Curved stone steps, as seen from the street: down from the door with a
 *  slight bow to the right, then sweeping to the left at the bottom. */
const stairPath = new THREE.CatmullRomCurve3([
  new THREE.Vector3(doorX, 0, 0.3),
  new THREE.Vector3(doorX + 0.1, 0, 0.7),
  new THREE.Vector3(doorX + 0.06, 0, 1.15),
  new THREE.Vector3(doorX - 0.2, 0, 1.6),
  new THREE.Vector3(doorX - 0.55, 0, moundDepth + 0.05),
]);
const STAIR_SAMPLES = stairPath.getSpacedPoints(80);
const STAIR_HALF = 0.23;
const STAIR_EDGE = 0.12;
const STEPS = 11;

const inRect = (r: LocalRect, p: Vec2) => p.x >= r.minX && p.x <= r.maxX && p.z >= r.minZ && p.z <= r.maxZ;

/** How high the ground is at p (local): the mound, the stairs as a smooth
 *  ramp from the street up to the door, the landing and the floor inside. */
export function laCryptaGround(p: Vec2): number {
  if (inRect(ROOM, p) || inRect(LANDING, p)) return lift;
  // Far from the mound and steps (most of the island): flat.
  if (p.z < -0.1 || p.z > moundDepth + 0.4 || p.x < moundX0 - 0.4 || p.x > moundX1 + 0.4) return 0;
  const h = moundHeight(p.x, p.z);
  let best = STAIR_HALF + STAIR_EDGE, bi = -1;
  for (let i = 0; i < STAIR_SAMPLES.length; i++) {
    const d = Math.hypot(STAIR_SAMPLES[i].x - p.x, STAIR_SAMPLES[i].z - p.z);
    if (d < best) { best = d; bi = i; }
  }
  if (bi < 0) return h;
  // Off the side of the steps the ground eases down to the grass (a slope
  // you walk down, not a ledge).
  const stair = lift * (1 - bi / (STAIR_SAMPLES.length - 1));
  const off = THREE.MathUtils.clamp((best - STAIR_HALF + STAIR_EDGE) / (2 * STAIR_EDGE), 0, 1);
  return Math.max(h, stair + (h - stair) * off);
}

/** Where the street meets the steps, and the top step by the door (local). */
export const LA_CRYPTA_STAIRS = {
  foot: { x: STAIR_SAMPLES[80].x, z: STAIR_SAMPLES[80].z },
  top: { x: doorX, z: 0.3 },
  /** From the door down to the street. */
  path: STAIR_SAMPLES.map((v) => ({ x: v.x, z: v.z })),
  lift,
};
export const LA_CRYPTA_ROOM = ROOM;
/** The door (local): its centre x, width, sill and height. */
export const LA_CRYPTA_DOOR = { x: doorX, w: DOOR_W, sill: lift, h: DOOR_H } as const;
/** Where La Crypta's own account stands (local): on the street right of the
 *  steps' foot, facing out (world/halloween.ts puts its sign beside it). */
export const LA_CRYPTA_RESIDENT: Vec2 = { x: doorX + 0.15, z: moundDepth + 0.3 };
/** The logo plaque on the brick right of the door (local): its centre x, bottom, size. */
export const LA_CRYPTA_LOGO = { x: (doorX + DOOR_W / 2 + W / 2) / 2 + 0.04, y: lift + 0.16, w: 0.42, h: 0.5 } as const;

let brickCanvas: HTMLCanvasElement | null = null;

/** A brick texture (running bond, dark mortar, a little variation), repeated
 *  to fit a wall of w × h. The canvas is drawn once; each wall gets its own
 *  texture on it, since a repeat is per texture. */
function brickTexture(w = 1, h = 1): THREE.CanvasTexture {
  brickCanvas ??= drawBricks();
  const t = new THREE.CanvasTexture(brickCanvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(w * 1.6, h * 1.6);
  return t;
}

function drawBricks(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#3a2621';
  g.fillRect(0, 0, 256, 256);
  const bw = 32, bh = 12;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let row = 0; row < 256 / bh + 1; row++) {
    const off = row % 2 ? bw / 2 : 0;
    for (let col = -1; col < 256 / bw + 1; col++) {
      const l = 0.36 + rnd() * 0.1;
      const h = 0.025 + rnd() * 0.02;
      g.fillStyle = `hsl(${h * 360} ${48 + rnd() * 12}% ${l * 100}%)`;
      g.fillRect(col * bw + off + 1, row * bh + 1, bw - 2, bh - 2);
    }
  }
  return c;
}

/** Leaded glass: small diamond panes in lead cames. */
function leadedTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#e8a050';
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = '#2a1c14';
  g.lineWidth = 4;
  for (let k = -128; k <= 256; k += 32) {
    g.beginPath(); g.moveTo(k, 0); g.lineTo(k + 128, 128); g.stroke();
    g.beginPath(); g.moveTo(k, 128); g.lineTo(k + 128, 0); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** The white ball's skin: an equirectangular canvas with the gold ₿ disc
 *  where the sphere faces +z (u = 0.25 on three's SphereGeometry). */
function ballTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 512;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fbfaf6';
  g.fillRect(0, 0, 1024, 512);
  const cx = 256, cy = 262, r = 118;
  g.fillStyle = '#c8964a';
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#fbfaf6';
  g.font = '800 170px Inter, system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.save();
  g.translate(cx, cy + 6);
  g.rotate(0.24);
  g.fillText('B', 0, 0);
  // The two bars through the top and the bottom.
  for (const dx of [-14, 18]) {
    g.fillRect(dx - 7, -84, 14, 26);
    g.fillRect(dx - 7, 58, 14, 26);
  }
  g.restore();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A pointed (gothic) arch outline of width w and total height h. */
function lancet(w: number, h: number): THREE.Shape {
  const s = new THREE.Shape();
  lancetPath(s, w, h);
  return s;
}

function lancetPath(s: THREE.Path, w: number, h: number): void {
  const r = w; // equilateral arch
  const spring = h - w * 0.87;
  s.moveTo(-w / 2, 0);
  s.lineTo(w / 2, 0);
  s.lineTo(w / 2, spring);
  s.absarc(-w / 2, spring, r, 0, Math.PI / 3, false);
  s.absarc(w / 2, spring, r, (Math.PI * 2) / 3, Math.PI, false);
  s.lineTo(-w / 2, 0);
}

export function buildLaCryptaHouse(): LandmarkBuild {
  const g = new THREE.Group();
  /** The house's walls and everything on them: see-through from inside. */
  const shell = new THREE.Group();
  g.add(shell);
  const stone = flat(0xd8d2c7, { roughness: 0.8 });
  const baseStone = flat(0xb9b4ab, { roughness: 0.95 });
  const slate = flat(0x4a4038, { roughness: 0.75 });
  const grass = new THREE.MeshStandardMaterial({ color: 0x6aa443, map: grassDetailTexture(), roughness: 1 });
  const step = flat(0x7d776f, { roughness: 0.9 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x1e1a1c, emissive: 0xff7a40, emissiveIntensity: 0.08, roughness: 0.25, metalness: 0.2, side: THREE.DoubleSide });
  const woodDoor = new THREE.MeshStandardMaterial({ color: 0x7a4a2c, emissive: 0xffb060, emissiveIntensity: 0, roughness: 0.7, flatShading: true, side: THREE.DoubleSide });
  const darkWood = flat(0x4a2e1c, { roughness: 0.8 });

  /** Parts hidden while you're inside (roofs, gables, the floor above). */
  const overhead: THREE.Object3D[] = [];

  const brickWall = (w: number, h: number, d: number, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ map: brickTexture(Math.max(w, d), h), roughness: 0.95 }));
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    shell.add(m);
    return m;
  };
  const gableRoof = (w: number, depth: number) => {
    const over = 0.1;
    const sh = new THREE.Shape();
    sh.moveTo(-w / 2 - over, 0);
    sh.lineTo(0, rise);
    sh.lineTo(w / 2 + over, 0);
    sh.lineTo(w / 2 + over - 0.09, -0.06);
    sh.lineTo(0, rise - 0.12);
    sh.lineTo(-w / 2 - over + 0.09, -0.06);
    sh.closePath();
    const geo = new THREE.ExtrudeGeometry(sh, { depth: depth + over, bevelEnabled: false });
    geo.translate(0, 0, -depth);
    const m = new THREE.Mesh(geo, slate);
    m.castShadow = true;
    return m;
  };
  /** A brick gable triangle, at the front (and the back) of a bay. */
  const gableWall = (w: number) => {
    const sh = new THREE.Shape();
    sh.moveTo(-w / 2, 0);
    sh.lineTo(0, rise - 0.06);
    sh.lineTo(w / 2, 0);
    sh.closePath();
    const geo = new THREE.ShapeGeometry(sh);
    const pos = geo.attributes.position;
    const uv: number[] = [];
    for (let i = 0; i < pos.count; i++) uv.push(pos.getX(i) / w + 0.5, pos.getY(i) / rise);
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: brickTexture(w, rise), roughness: 0.95, side: THREE.DoubleSide }));
    m.castShadow = true;
    return m;
  };
  /** A mullioned window: n pointed lights in a stone frame, a transom bar,
   *  a hood moulding above. Bottom-centre at (x, y) on the facade. */
  const windowN = (x: number, y: number, n: number, lightW: number, h: number) => {
    const gap = 0.045;
    const fw = n * lightW + (n + 1) * gap;
    const frame = new THREE.Mesh(new THREE.BoxGeometry(fw + 0.06, h + 0.08, 0.06), stone);
    frame.position.set(x, y + h / 2, 0.02);
    frame.castShadow = true;
    shell.add(frame);
    for (let i = 0; i < n; i++) {
      const cx = x - fw / 2 + gap + lightW / 2 + i * (lightW + gap);
      const glass = new THREE.Mesh(new THREE.ShapeGeometry(lancet(lightW, h - 0.06), 6), glassMat);
      glass.position.set(cx, y + 0.03, 0.055);
      shell.add(glass);
    }
    const transom = new THREE.Mesh(new THREE.BoxGeometry(fw, 0.035, 0.04), stone);
    transom.position.set(x, y + h * 0.66, 0.065);
    shell.add(transom);
    const hood = new THREE.Mesh(new THREE.BoxGeometry(fw + 0.16, 0.05, 0.1), stone);
    hood.position.set(x, y + h + 0.07, 0.04);
    shell.add(hood);
  };

  // The house: hollow brick walls, a gable over each bay.
  const d0 = doorX - DOOR_W / 2, d1 = doorX + DOOR_W / 2;
  brickWall(d0 + W / 2, eaves, T, (-W / 2 + d0) / 2, eaves / 2, -T / 2);            // front, left of the door
  brickWall(W / 2 - d1, eaves, T, (d1 + W / 2) / 2, eaves / 2, -T / 2);             // front, right of the door
  brickWall(DOOR_W, eaves - lift - DOOR_H, T, doorX, (eaves + lift + DOOR_H) / 2, -T / 2); // over the door
  brickWall(DOOR_W, lift, T, doorX, lift / 2, -T / 2);                              // under the door
  brickWall(W, eaves, T, 0, eaves / 2, -D + T / 2);                                 // back
  brickWall(T, eaves, D - 2 * T, -W / 2 + T / 2, eaves / 2, -D / 2);               // left side
  brickWall(T, eaves, D - 2 * T, W / 2 - T / 2, eaves / 2, -D / 2);                // right side
  // The ground floor's floor (what you walk on) and the floor above.
  const floor = new THREE.Mesh(new THREE.BoxGeometry(W - 2 * T, 0.05, D - 2 * T), darkWood);
  floor.position.set(0, lift - 0.025, -D / 2);
  floor.receiveShadow = true;
  g.add(floor);
  const upper = new THREE.Mesh(new THREE.BoxGeometry(W - 2 * T, 0.06, D - 2 * T), darkWood);
  upper.position.set(0, ceil + 0.03, -D / 2);
  shell.add(upper);
  overhead.push(upper);
  for (const cx of [L, R]) {
    const roof = gableRoof(bay, D);
    roof.position.set(cx, eaves, 0.02);
    const front = gableWall(bay);
    front.position.set(cx, eaves, 0.003);
    const back = gableWall(bay);
    back.position.set(cx, eaves, -D - 0.003);
    shell.add(roof, front, back);
    overhead.push(roof, front, back);
  }
  // Tall grey stone base under the left bay, a lower band under the right.
  const baseL = new THREE.Mesh(new THREE.BoxGeometry(bay + 0.02, lift, 0.08), baseStone);
  baseL.position.set(L, lift / 2, 0.03);
  baseL.receiveShadow = true;
  shell.add(baseL);
  const sill = new THREE.Mesh(new THREE.BoxGeometry(W + 0.04, 0.06, 0.12), stone);
  sill.position.set(0, lift + 0.03, 0.05);
  shell.add(sill);

  // Windows as in the photo.
  windowN(L, lift + 0.25, 3, 0.16, 0.7);  // left, ground floor
  windowN(L, lift + 1.3, 3, 0.15, 0.6);   // left, upper floor
  windowN(R + 0.12, lift + 1.25, 3, 0.15, 0.62); // right, upper floor
  const vent = new THREE.Mesh(new THREE.ShapeGeometry(lancet(0.08, 0.26), 6), glassMat);
  vent.position.set(R, eaves + 0.45, 0.01);
  shell.add(vent);
  overhead.push(vent);

  // The wooden arched door, half a storey up, in a stone surround: it
  // swings in on its left hinge.
  const surroundShape = lancet(DOOR_W + 0.14, DOOR_H + 0.13);
  const hole = new THREE.Path();
  lancetPath(hole, DOOR_W, DOOR_H);
  surroundShape.holes.push(hole);
  // Brick fills the corners between the arch and the square opening.
  const spandrel = new THREE.Shape();
  spandrel.moveTo(-DOOR_W / 2, 0);
  spandrel.lineTo(DOOR_W / 2, 0);
  spandrel.lineTo(DOOR_W / 2, DOOR_H);
  spandrel.lineTo(-DOOR_W / 2, DOOR_H);
  spandrel.closePath();
  const sHole = new THREE.Path();
  lancetPath(sHole, DOOR_W, DOOR_H);
  spandrel.holes.push(sHole);
  const fill = new THREE.Mesh(new THREE.ShapeGeometry(spandrel, 8), new THREE.MeshStandardMaterial({ map: brickTexture(DOOR_W, DOOR_H), roughness: 0.95, side: THREE.DoubleSide }));
  fill.position.set(doorX, lift, -T / 2);
  shell.add(fill);
  const surround = new THREE.Mesh(new THREE.ShapeGeometry(surroundShape, 8), stone);
  surround.position.set(doorX, lift, 0.02);
  shell.add(surround);
  const doorPivot = new THREE.Group();
  doorPivot.position.set(d0, lift, -0.02);
  g.add(doorPivot);
  const leafGeo = new THREE.ExtrudeGeometry(lancet(DOOR_W - 0.01, DOOR_H - 0.01), { depth: 0.03, bevelEnabled: false, curveSegments: 8 });
  leafGeo.translate(DOOR_W / 2, 0, -0.015);
  const leaf = new THREE.Mesh(leafGeo, woodDoor);
  leaf.castShadow = true;
  doorPivot.add(leaf);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.018, 6, 4), flat(0x1a1a1a, { metalness: 0.6 }));
  knob.position.set(DOOR_W - 0.07, DOOR_H * 0.45, 0.02);
  doorPivot.add(knob);
  const landing = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.06, 0.4), step);
  landing.position.set(doorX, lift - 0.03, 0.2);
  landing.receiveShadow = true;
  g.add(landing);

  // White downpipe between the bays.
  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, eaves - 0.2, 6), flat(0xe6e4df));
  pipe.position.set(0.02, (eaves - 0.2) / 2 + 0.1, 0.06);
  shell.add(pipe);

  // The older wing on the left, flush with the front, on flat ground.
  const leaded = new THREE.MeshStandardMaterial({ color: 0x3a2a20, map: leadedTexture(), emissive: 0xff7a30, emissiveIntensity: 0.05, roughness: 0.3, metalness: 0.1 });
  {
    const wx0 = -W / 2 - WING_W, wx1 = -W / 2, wc = (wx0 + wx1) / 2;
    // As tall as the house: its eaves line up with the gables'.
    const wingH = eaves;
    // The body behind the balcony, and its front block (garage, windows).
    brickWall(WING_W, wingH, D + WING_Z - 0.3, wc, wingH / 2, (WING_Z - 0.3 - D) / 2);
    const base = new THREE.Mesh(new THREE.BoxGeometry(WING_W, 0.74, 0.3), baseStone);
    base.position.set(wc, 0.37, WING_Z - 0.15);
    base.castShadow = base.receiveShadow = true;
    shell.add(base);
    // Arched studded garage door in a stone surround.
    const gs = new THREE.Mesh(new THREE.ShapeGeometry(roundArch(0.66, 0.7), 10), stone);
    gs.position.set(wc + 0.08, 0, WING_Z + 0.005);
    const gd = new THREE.Mesh(new THREE.ShapeGeometry(roundArch(0.56, 0.64), 10), flat(0x6a4024, { roughness: 0.75 }));
    gd.position.set(wc + 0.08, 0, WING_Z + 0.01);
    shell.add(gs, gd);
    const grille = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.01), flat(0x161616));
    grille.position.set(wc + 0.08, 0.42, WING_Z + 0.016);
    shell.add(grille);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) {
      const stud = new THREE.Mesh(new THREE.SphereGeometry(0.008, 4, 3), flat(0x161616));
      stud.position.set(wc + 0.08 - 0.18 + i * 0.12, 0.1 + j * 0.12, WING_Z + 0.016);
      shell.add(stud);
    }
    // The wooden frame with its band of leaded windows.
    const band = new THREE.Mesh(new THREE.BoxGeometry(WING_W, 0.66, 0.3), darkWood);
    band.position.set(wc, 0.74 + 0.33, WING_Z - 0.15);
    band.castShadow = true;
    shell.add(band);
    const panes = 4, pw = (WING_W - 0.12) / panes;
    leaded.map!.repeat.set(2, 3);
    for (let i = 0; i < panes; i++) {
      const pane = new THREE.Mesh(new THREE.PlaneGeometry(pw - 0.04, 0.46), leaded);
      pane.position.set(wx0 + 0.06 + pw / 2 + i * pw, 1.09, WING_Z + 0.004);
      shell.add(pane);
    }
    const trim = new THREE.Mesh(new THREE.BoxGeometry(WING_W + 0.04, 0.06, 0.06), flat(0x3a2416));
    trim.position.set(wc, 0.77, WING_Z + 0.02);
    const trim2 = trim.clone();
    trim2.position.y = 1.38;
    shell.add(trim, trim2);
    // The balcony: a floor on the front block, a railing, timber posts and an
    // arch under the eaves, glass doors behind.
    const deck = new THREE.Mesh(new THREE.BoxGeometry(WING_W + 0.04, 0.05, 0.36), darkWood);
    deck.position.set(wc, 1.425, WING_Z - 0.15);
    shell.add(deck);
    const railM = flat(0x5a3820);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(WING_W, 0.03, 0.03), railM);
    rail.position.set(wc, 1.68, WING_Z - 0.01);
    shell.add(rail);
    for (let i = 0; i <= 10; i++) {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.22, 4), railM);
      b.position.set(wx0 + 0.03 + i * ((WING_W - 0.06) / 10), 1.56, WING_Z - 0.01);
      shell.add(b);
    }
    for (const x of [wx0 + 0.04, wx1 - 0.04]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.8, 0.06), railM);
      post.position.set(x, 1.85, WING_Z - 0.02);
      shell.add(post);
    }
    const arch = new THREE.Mesh(new THREE.TorusGeometry(WING_W / 2 - 0.04, 0.025, 4, 16, Math.PI), railM);
    arch.position.set(wc, 1.95, WING_Z - 0.02);
    arch.scale.y = 0.55;
    shell.add(arch);
    const beam = new THREE.Mesh(new THREE.BoxGeometry(WING_W + 0.06, 0.06, 0.08), railM);
    beam.position.set(wc, 2.24, WING_Z - 0.02);
    shell.add(beam);
    const glazing = new THREE.Mesh(new THREE.PlaneGeometry(WING_W * 0.6, 0.65), glassMat);
    glazing.position.set(wc, 1.8, WING_Z - 0.299);
    shell.add(glazing);
    for (const x of [wx0 + 0.2, wc + 0.1, wx1 - 0.15]) {
      const plant = new THREE.Mesh(new THREE.IcosahedronGeometry(0.07, 0), flat(0x3d7a3a));
      plant.position.set(x, 1.5, WING_Z - 0.08);
      shell.add(plant);
    }
    // Its roof: a gable like the house's two, the same height and pitch of
    // slate, but turned: the ridge runs along the street and the triangle
    // faces the side. It runs on into the left bay's roof as a cross gable
    // (valleys where the two meet), as a real wing joins its house.
    const wingRoof = gableRoof(D, L - wx0);
    wingRoof.rotation.y = -Math.PI / 2;
    wingRoof.position.set(wx0, eaves, -D / 2);
    const wingGable = gableWall(D);
    wingGable.rotation.y = -Math.PI / 2;
    wingGable.position.set(wx0 - 0.003, eaves, -D / 2);
    shell.add(wingRoof, wingGable);
    overhead.push(wingRoof, wingGable);
    // Brick from the balcony's beam up to the eaves, across its front.
    brickWall(WING_W, eaves - 2.27, T, wc, (2.27 + eaves) / 2, WING_Z - T / 2);
  }

  // The grassy mound: from the door's level down to the street, in front
  // of the right bay and tapering across the left.
  {
    const nx = 14, nz = 10;
    const pos: number[] = [];
    const idx: number[] = [];
    for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
      const x = moundX0 + (moundX1 - moundX0) * (i / nx), z = 0.12 + (moundDepth - 0.12) * (j / nz);
      pos.push(x, moundHeight(x, z) + 0.01, z);
    }
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    // Same turf as the island around it: world-ish UVs, smooth normals.
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(pos.flatMap((v, k) => (k % 3 === 1 ? [] : [v * 0.62])), 2));
    geo.computeVertexNormals();
    const mound = new THREE.Mesh(geo, grass);
    mound.receiveShadow = true;
    g.add(mound);
  }

  // The steps up the mound.
  const railPts: THREE.Vector3[] = [];
  for (let i = 0; i < STEPS; i++) {
    const t0 = i / STEPS, t1 = (i + 1) / STEPS;
    const a = stairPath.getPoint(t0), b = stairPath.getPoint(t1);
    const mid = a.clone().lerp(b, 0.5);
    const yTop = lift * (1 - (i + 0.5) / STEPS);
    const st = new THREE.Mesh(new THREE.BoxGeometry(STAIR_HALF * 2, Math.max(0.05, yTop), a.distanceTo(b) + 0.02), step);
    st.position.set(mid.x, Math.max(0.05, yTop) / 2, mid.z);
    st.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);
    st.castShadow = true;
    st.receiveShadow = true;
    g.add(st);
    // Rail on the left of the steps (as you walk up).
    const tan = b.clone().sub(a).normalize();
    railPts.push(mid.clone().add(new THREE.Vector3(tan.z, 0, -tan.x).multiplyScalar(-0.3)).setY(yTop + 0.38));
  }
  const railCurve = new THREE.CatmullRomCurve3(railPts);
  g.add(new THREE.Mesh(new THREE.TubeGeometry(railCurve, 30, 0.011, 5), flat(0x161616)));
  for (const k of [0, 4, 8, STEPS - 1]) {
    const p = railPts[k];
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.4, 5), flat(0x161616));
    post.position.set(p.x, p.y - 0.2, p.z);
    g.add(post);
  }
  const bulbMat = new THREE.MeshStandardMaterial({ color: 0xfff2c4, emissive: 0xffd77a, emissiveIntensity: 1 });
  const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.016, 6, 4), bulbMat, 24);
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < 24; i++) bulbs.setMatrixAt(i, m4.makeTranslation(railCurve.getPoint(i / 23).add(new THREE.Vector3(0, -0.015, 0))));
  g.add(bulbs);

  // The round shrub by the door, on a short trunk.
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.045, 0.3, 5), flat(0x4a3526));
  trunk.position.set(doorX - 0.62, lift * 0.62 + 0.15, 0.55);
  g.add(trunk);
  const shrub = new THREE.Mesh(new THREE.IcosahedronGeometry(0.3, 1), flat(0x3d7a3a));
  shrub.scale.set(1.15, 0.9, 1);
  shrub.position.set(doorX - 0.62, lift * 0.62 + 0.42, 0.55);
  shrub.castShadow = true;
  g.add(shrub);

  // La Crypta's logo on the brick right of the door, at the door's height,
  // backlit: an arched white plaque with three black bars.
  const logoGlow = new THREE.MeshStandardMaterial({ color: 0xf4f1ea, emissive: 0xfff6e6, emissiveIntensity: 0.25, flatShading: true });
  const { x: logoX, y: logoY, w: LOGO_W, h: LOGO_H } = LA_CRYPTA_LOGO;
  const logo = new THREE.Mesh(new THREE.ExtrudeGeometry(roundArch(LOGO_W, LOGO_H), { depth: 0.02, bevelEnabled: false, curveSegments: 10 }), logoGlow);
  logo.position.set(logoX, logoY, 0.02);
  shell.add(logo);
  const kx = LOGO_W / 0.36, ky = LOGO_H / 0.44; // the old plaque's bars, scaled up
  for (let i = 0; i < 3; i++) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry((0.28 - i * 0.02) * kx, 0.04 * ky, 0.01), flat(0x161616));
    bar.position.set(logoX + (0.02 + i * 0.01) * kx, logoY + (0.07 + i * 0.075) * ky, 0.045);
    shell.add(bar);
  }
  const logoLight = new THREE.PointLight(0xfff3dc, 0, 1.8, 1.6);
  logoLight.position.set(logoX, logoY + LOGO_H * 0.5, 0.4);
  g.add(logoLight);

  // The white glowing ball with the gold ₿, on the lawn left of the steps.
  const BALL_R = 0.36;
  const ballAt = { x: L + 0.22, z: 1.2 };
  const ballTex = ballTexture();
  const ballMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: ballTex, emissive: 0xffffff, emissiveMap: ballTex, emissiveIntensity: 0.35, roughness: 0.5 });
  const ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 32, 20), ballMat);
  ball.scale.y = 0.94;
  const ballY = moundHeight(ballAt.x, ballAt.z) + BALL_R * 0.94 - 0.02;
  ball.position.set(ballAt.x, ballY, ballAt.z);
  ball.rotation.y = 0.25; // turned a little toward the steps, as in the photo
  ball.castShadow = true;
  g.add(ball);
  const ballLight = new THREE.PointLight(0xfff4e0, 0, 2.6, 1.5);
  ballLight.position.set(ballAt.x + 0.1, ballY, ballAt.z + 0.45);
  g.add(ballLight);

  // Night: warm windows and door, red by the door, violet wash up the gables.
  const red = new THREE.PointLight(0xff2a3a, 0, 2.4, 1.6);
  red.position.set(doorX - 0.45, lift + 0.25, 0.55);
  const violet = new THREE.SpotLight(0x7a6aff, 0, 7, Math.PI / 4.5, 0.6, 1.2);
  violet.position.set(0, 0.1, 1.6);
  violet.target.position.set(0, eaves, 0);
  g.add(red, violet, violet.target);

  // The living room.
  const room = buildLivingRoom({ ...ROOM, floor: lift, ceil, door: { x: doorX, w: DOOR_W } });
  g.add(room.group);

  // From inside, the shell turns see-through (its materials, gathered once).
  const shellMats = new Set<THREE.MeshStandardMaterial>();
  shell.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    for (const m of [o.material].flat()) shellMats.add(m as THREE.MeshStandardMaterial);
  });
  const walls = shell.children.filter((o): o is THREE.Mesh => o instanceof THREE.Mesh);
  let insideNow = false;

  return {
    group: g,
    doorLocal: new THREE.Vector3(doorX - 0.6, 0, moundDepth + 0.3),
    residentLocal: LA_CRYPTA_RESIDENT,
    seats: room.seats,
    solids: [
      ...room.solids,
      { x: ballAt.x, z: ballAt.z, hx: BALL_R * 0.8, hz: BALL_R * 0.8, top: ballY + BALL_R * 0.9 },
    ],
    groundAt: laCryptaGround,
    interior: {
      rooms: [
        { minX: ROOM.minX + 0.02, maxX: ROOM.maxX - 0.02, minZ: ROOM.minZ + 0.02, maxZ: ROOM.maxZ - 0.02 },
        { minX: d0 + 0.03, maxX: d1 - 0.03, minZ: -0.3, maxZ: 0.42 },
      ],
      door: { x: doorX, z: 0 },
      setDoor(open) { doorPivot.rotation.y = open * 1.5; },
      setInside(on) {
        if (on === insideNow) return;
        insideNow = on;
        for (const o of [...overhead, ...room.cutaway]) o.visible = !on;
        for (const m of shellMats) { m.transparent = on; m.opacity = on ? 0.22 : 1; m.depthWrite = !on; m.needsUpdate = true; }
        for (const w of walls) w.castShadow = !on;
      },
    },
    update(dt, t) {
      room.update(dt, t);
    },
    setNight(night: number, t: number) {
      glassMat.emissiveIntensity = 0.08 + night * 0.9;
      leaded.emissiveIntensity = 0.05 + night * 0.9;
      woodDoor.emissiveIntensity = night * 0.18;
      bulbMat.emissiveIntensity = 0.4 + night * (1.6 + Math.sin(t * 3) * 0.25);
      logoGlow.emissiveIntensity = 0.3 + night * 0.6;
      logoLight.intensity = night * 0.5;
      ballMat.emissiveIntensity = 0.35 + night * 0.75;
      ballLight.intensity = night * 1.6;
      red.intensity = night * 1.1;
      violet.intensity = night * 3.5;
      room.setNight(night);
    },
  };
}

/** A round-topped arch (the La Crypta plaque) of width w, height h. */
function roundArch(w: number, h: number): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0);
  s.lineTo(w / 2, 0);
  s.lineTo(w / 2, h - w / 2);
  s.absarc(0, h - w / 2, w / 2, 0, Math.PI, false);
  s.lineTo(-w / 2, 0);
  return s;
}
