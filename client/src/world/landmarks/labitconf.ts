// LABITCONF: Latin America's Bitcoin conference, as a hall in the village.
// A dark warehouse with the wordmark lit over the door. Inside, as at the
// real one: steel lighting trusses with orange spots under a black ceiling,
// a red-lit floor, rows of black chairs facing a stage with the panel's
// chairs, and a big LED wall over it flanked by two side screens. The LED
// wall plays LABITCONF's video while you're inside (world/youtubeStage.ts:
// a YouTube embed placed over it in 3D; here it is the card shown otherwise).
// La Bitcoineta is parked along the left wall as a stand, and a big green
// obelisk stands in the right corner by the stage.
//
// Local frame: facade on z = 0 facing +z, the hall behind it. You come in at
// the front right and look straight down the hall at the stage.

import * as THREE from 'three';
import { canvasTexture } from './signs';
import { buildObelisk } from '../obelisk';
import { buildBitcoineta, BITCOINETA } from '../bitcoineta';
import type { LandmarkBuild, LandmarkSeat } from './index';

export const LABITCONF = {
  W: 4.2,
  D: 3.9,
  H: 2.2,
  T: 0.07,
  /** The doors: a wide double door at the front right. */
  DOOR0: 0.85,
  DOOR1: 1.7,
  DOOR_H: 1.15,
  /** The stage along the back wall: wide and deep, room for a panel of five. */
  STAGE_X0: -1.55,
  STAGE_X1: 1.15,
  STAGE_Z: -2.85,
  STAGE_TOP: 0.14,
  /** The LED wall over the stage (16:9, facing +z). */
  SCREEN_W: 2.24,
  SCREEN_H: 1.26,
  SCREEN_X: -0.2,
  SCREEN_Y: 1.5,
  /** The panel's chairs on the stage (x). */
  PANEL: [-1.15, -0.7, -0.25, 0.2, 0.65],
  /** Audience rows (z) and columns (x): facing the stage (−z). */
  ROWS: [-0.95, -1.3, -1.65, -2.0, -2.35],
  COLS: [-0.55, -0.25, 0.05, 0.35, 0.65],
  SEAT_TOP: 0.19,
  /** La Bitcoineta's centre: along the left wall, nose toward the door. */
  VAN_X: -1.55,
  VAN_Z: -1.5,
  /** The green obelisk, at the stage's right corner. */
  OBELISK_X: 1.55,
  OBELISK_Z: -2.35,
  OBELISK_H: 1.9,
} as const;

/** The floor inside, as other walkable rooms (just over the lawn). */
export const LABITCONF_FLOOR = 0.006;

const flat = (color: number, o: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.85, flatShading: true, ...o });

/** The LED wall's card: the wordmark in glowing white-blue on black. */
export function drawLabitconfCard(c: CanvasRenderingContext2D, w: number, h: number): void {
  const grad = c.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, '#071a3a');
  grad.addColorStop(1, '#02060f');
  c.fillStyle = grad;
  c.fillRect(0, 0, w, h);
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.shadowColor = '#4fd2ff';
  c.shadowBlur = w * 0.03;
  c.fillStyle = '#e9fbff';
  c.font = `900 ${Math.round(w * 0.13)}px Inter, system-ui, sans-serif`;
  c.fillText('LABITCONF', w / 2, h * 0.45);
  c.shadowBlur = 0;
  c.fillStyle = '#7fb8d6';
  c.font = `600 ${Math.round(w * 0.032)}px Inter, system-ui, sans-serif`;
  c.fillText('LATIN AMERICA BITCOIN & BLOCKCHAIN CONFERENCE', w / 2, h * 0.68);
}

export function buildLabitconf(): LandmarkBuild & { screen: THREE.Mesh } {
  const L = LABITCONF;
  const { W, D, H, T, DOOR0, DOOR1, DOOR_H } = L;
  const g = new THREE.Group();
  const outer = flat(0x2c2f36);
  const inner = flat(0x2a2c33, { emissive: 0x1a1b22, emissiveIntensity: 1 });
  const steel = flat(0x8b9099, { metalness: 0.6, roughness: 0.4 });
  const black = flat(0x16171a);
  const box = (w: number, h: number, d: number, m: THREE.Material | THREE.Material[], x: number, y: number, z: number) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    b.position.set(x, y, z);
    b.castShadow = b.receiveShadow = true;
    g.add(b);
    return b;
  };

  // Walls: dark grey cladding outside, black inside; the door at the front right.
  const walls: THREE.Mesh[] = [
    box(W, H, T, [outer, outer, outer, outer, inner, outer], 0, H / 2, -D + T / 2),
    box(T, H, D, [inner, outer, outer, outer, outer, outer], -W / 2 + T / 2, H / 2, -D / 2),
    box(T, H, D, [outer, inner, outer, outer, outer, outer], W / 2 - T / 2, H / 2, -D / 2),
    box(DOOR0 + W / 2, H, T, [outer, outer, outer, outer, outer, inner], (-W / 2 + DOOR0) / 2, H / 2, -T / 2),
    box(W / 2 - DOOR1, H, T, [outer, outer, outer, outer, outer, inner], (DOOR1 + W / 2) / 2, H / 2, -T / 2),
    box(DOOR1 - DOOR0, H - DOOR_H, T, [outer, outer, outer, outer, outer, inner], (DOOR0 + DOOR1) / 2, (H + DOOR_H) / 2, -T / 2),
  ];
  // Corrugated look: vertical ribs on the facade and sides.
  const rib = flat(0x3a3e46);
  for (let x = -W / 2 + 0.12; x < W / 2 - 0.05; x += 0.22) {
    if (x > DOOR0 - 0.06 && x < DOOR1 + 0.06) continue;
    box(0.025, H - 0.1, 0.012, rib, x, (H - 0.1) / 2, 0.006);
  }
  for (const s of [-1, 1]) for (let z = -0.2; z > -D + 0.05; z -= 0.3) box(0.012, H - 0.1, 0.025, rib, s * (W / 2 + 0.006), (H - 0.1) / 2, z);
  const roofParts: THREE.Object3D[] = [];
  const roof = box(W + 0.12, 0.1, D + 0.12, flat(0x1f2126), 0, H + 0.05, -D / 2);
  roof.name = 'roof';
  roofParts.push(roof);
  box(W + 0.04, 0.1, 0.06, black, 0, 0.05, 0.02); // plinth

  // Floor: black with a red glow, as the stage lights wash it.
  const floorMat = flat(0x2a1418, { emissive: 0x7a1424, emissiveIntensity: 0.5, roughness: 1 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W - 2 * T, D - 2 * T), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, LABITCONF_FLOOR, -D / 2);
  floor.receiveShadow = true;
  g.add(floor);

  // The sign across the facade, centred on it: the wordmark, white on black with a pink-red glow.
  const signTex = canvasTexture(1024, 192, (c) => {
    c.fillStyle = '#0b0b0e';
    c.fillRect(0, 0, 1024, 192);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.shadowColor = '#ff2d55';
    c.shadowBlur = 28;
    c.fillStyle = '#ffffff';
    c.font = '900 120px Inter, system-ui, sans-serif';
    c.fillText('LABITCONF', 512, 100);
  });
  const signMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: signTex, emissive: 0xffffff, emissiveMap: signTex, emissiveIntensity: 0.4 });
  const sign = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.55, 0.05), [black, black, black, black, signMat, black]);
  sign.position.set(0, H - 0.36, 0.05);
  g.add(sign);
  // A red light strip under it, like the hall's stage glow.
  const glowStrip = new THREE.MeshStandardMaterial({ color: 0x330008, emissive: 0xff2d55, emissiveIntensity: 0.5 });
  const signStrip = box(3.0, 0.025, 0.03, glowStrip, 0, H - 0.66, 0.06);
  // A poster by the door: the dates-and-crowd banner.
  const posterTex = canvasTexture(192, 288, (c) => {
    const gr = c.createLinearGradient(0, 0, 0, 288);
    gr.addColorStop(0, '#2a0610');
    gr.addColorStop(1, '#0b0b0e');
    c.fillStyle = gr;
    c.fillRect(0, 0, 192, 288);
    c.fillStyle = '#ff2d55';
    for (let i = 0; i < 40; i++) c.fillRect((i * 53) % 192, 150 + ((i * 37) % 120), 4, 4);
    c.fillStyle = '#ffffff';
    c.textAlign = 'center';
    c.font = '900 30px Inter, system-ui, sans-serif';
    c.fillText('LABITCONF', 96, 70);
    c.fillStyle = '#f7931a';
    c.font = '800 56px Inter, system-ui, sans-serif';
    c.fillText('₿', 96, 130);
  });
  const poster = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.6), new THREE.MeshStandardMaterial({ map: posterTex, roughness: 0.7, emissive: 0xffffff, emissiveMap: posterTex, emissiveIntensity: 0.15 }));
  poster.position.set(-1.1, 0.62, 0.014);
  g.add(poster);

  // ── inside ──

  // The stage, its skirt lit red, the panel's chairs and a low table.
  const { STAGE_X0, STAGE_X1, STAGE_Z, STAGE_TOP } = L;
  const stageMid = (STAGE_X0 + STAGE_X1) / 2, stageW = STAGE_X1 - STAGE_X0, stageD = STAGE_Z - (-D + T);
  box(stageW, STAGE_TOP, stageD, flat(0x1d1e22), stageMid, STAGE_TOP / 2, (STAGE_Z + (-D + T)) / 2);
  box(stageW, 0.02, 0.015, glowStrip, stageMid, STAGE_TOP - 0.03, STAGE_Z + 0.01);
  const seats: LandmarkSeat[] = [];
  const chairMat = flat(0x232428);
  const chairLeg = flat(0x6e5236);
  const chair = (x: number, z: number, y0: number, back: number) => {
    // A cushion, a back on the far side from `back`'s sign, four legs.
    box(0.2, 0.035, 0.19, chairMat, x, y0 + L.SEAT_TOP - 0.018, z);
    box(0.2, 0.22, 0.03, chairMat, x, y0 + L.SEAT_TOP + 0.1, z + back * 0.1);
    for (const dx of [-0.085, 0.085]) for (const dz of [-0.08, 0.08]) box(0.02, L.SEAT_TOP - 0.03, 0.02, chairLeg, x + dx, y0 + (L.SEAT_TOP - 0.03) / 2, z + dz);
  };
  const panelZ = STAGE_Z - 0.38;
  for (const x of L.PANEL) {
    chair(x, panelZ, STAGE_TOP, -1);
    seats.push({ pos: { x, z: panelZ }, face: 0, y: STAGE_TOP + L.SEAT_TOP, prop: 'none', indoor: true });
  }
  // Low tables between the chairs, a lectern at the front right of the stage, monitors at its lip.
  const white = flat(0xe8e8e8);
  for (const x of [-0.92, -0.02, 0.42]) box(0.16, 0.1, 0.12, white, x, STAGE_TOP + 0.05, panelZ + 0.16);
  box(0.2, 0.42, 0.16, flat(0x111214), 0.95, STAGE_TOP + 0.21, STAGE_Z - 0.18);
  box(0.24, 0.03, 0.2, glowStrip, 0.95, STAGE_TOP + 0.43, STAGE_Z - 0.18);
  for (const x of [-0.95, 0.35]) {
    const m = box(0.22, 0.1, 0.12, black, x, STAGE_TOP + 0.05, STAGE_Z - 0.09);
    m.rotation.x = -0.4;
  }
  // Speaker stacks at the stage's ends.
  for (const x of [STAGE_X0 + 0.12, STAGE_X1 - 0.08]) box(0.18, 0.5, 0.16, black, x, STAGE_TOP + 0.25, -D + T + 0.12);

  // The LED wall: a black frame and the screen (the video's place), two side screens.
  const frameMat = new THREE.MeshBasicMaterial({ color: 0x050507 });
  const back = new THREE.Mesh(new THREE.PlaneGeometry(L.SCREEN_W + 0.08, L.SCREEN_H + 0.08), frameMat);
  back.name = 'labitconf-screen-back';
  back.position.set(L.SCREEN_X, L.SCREEN_Y, -D + T + 0.006);
  g.add(back);
  const card = canvasTexture(1024, 576, (c) => drawLabitconfCard(c, 1024, 576));
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(L.SCREEN_W, L.SCREEN_H), new THREE.MeshBasicMaterial({ map: card, toneMapped: false }));
  screen.name = 'labitconf-screen';
  screen.position.set(L.SCREEN_X, L.SCREEN_Y, -D + T + 0.012);
  g.add(screen);
  const sideTex = canvasTexture(256, 384, (c) => {
    const gr = c.createLinearGradient(0, 0, 0, 384);
    gr.addColorStop(0, '#3a0714');
    gr.addColorStop(1, '#0d0206');
    c.fillStyle = gr;
    c.fillRect(0, 0, 256, 384);
    c.fillStyle = '#ff4d6d';
    for (let i = 0; i < 60; i++) c.fillRect((i * 71) % 256, (i * 113) % 384, 6, 6);
    c.save();
    c.translate(128, 192);
    c.rotate(-Math.PI / 2);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = '#ffffff';
    c.font = '900 64px Inter, system-ui, sans-serif';
    c.fillText('LABITCONF', 0, 0);
    c.restore();
  });
  const sideMat = new THREE.MeshBasicMaterial({ map: sideTex, toneMapped: false });
  for (const x of [-1.78, 1.38]) {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.76), sideMat);
    s.position.set(x, 1.5, -D + T + 0.01);
    g.add(s);
  }

  // Audience: rows of black chairs facing the stage.
  for (const z of L.ROWS) for (const x of L.COLS) {
    chair(x, z, LABITCONF_FLOOR, 1);
    seats.push({ pos: { x, z }, face: Math.PI, y: LABITCONF_FLOOR + L.SEAT_TOP, prop: 'none', indoor: true });
  }

  // Lighting trusses across the hall with orange spot cans; a camera on a tripod.
  const spotMat = new THREE.MeshStandardMaterial({ color: 0x2a1500, emissive: 0xff8a1f, emissiveIntensity: 1.2 });
  const spotGeo = new THREE.CylinderGeometry(0.03, 0.04, 0.07, 8);
  for (const z of [-0.8, -1.75, -2.7]) {
    const y = H - 0.2;
    for (const dy of [0, -0.1]) box(W - 2 * T, 0.018, 0.018, steel, 0, y + dy, z);
    for (let i = 0; i < 18; i++) {
      const x0 = -W / 2 + T + 0.05 + i * 0.23;
      const d = box(0.01, 0.14, 0.01, steel, x0 + 0.06, y - 0.05, z);
      d.rotation.z = i % 2 ? 0.75 : -0.75;
      d.castShadow = false;
    }
    for (const x of [-1.68, -1.12, -0.56, 0, 0.56, 1.12, 1.68]) {
      const s = new THREE.Mesh(spotGeo, spotMat);
      s.position.set(x, y - 0.16, z);
      s.rotation.x = 0.35;
      g.add(s);
    }
  }
  box(0.04, 0.42, 0.04, black, 1.75, 0.21, -1.0); // tripod
  box(0.18, 0.08, 0.12, black, 1.73, 0.46, -1.0); // camera

  // La Bitcoineta, parked as a stand along the left wall, nose to the door.
  const van = buildBitcoineta();
  van.position.set(L.VAN_X, 0, L.VAN_Z);
  g.add(van);

  // The big green obelisk, on a low black base, in the corner by the stage.
  const ob = buildObelisk(L.OBELISK_H, { lights: false, plinth: false });
  box(0.56, 0.06, 0.56, black, L.OBELISK_X, 0.03, L.OBELISK_Z);
  ob.group.position.set(L.OBELISK_X, 0.06, L.OBELISK_Z);
  g.add(ob.group);

  // One warm light for the room (the spots are emissive only: the light budget).
  const houseLight = new THREE.PointLight(0xffb070, 2.4, 6.5, 1.2);
  houseLight.position.set(0, H - 0.4, -1.9);
  g.add(houseLight);

  // The door: two glass leaves sliding apart.
  const glass = new THREE.MeshStandardMaterial({ color: 0x101014, emissive: 0xff2d55, emissiveIntensity: 0.1, roughness: 0.1, transparent: true, opacity: 0.55 });
  const halfW = (DOOR1 - DOOR0) / 2;
  const leaves = [-1, 1].map((s) => {
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(halfW, DOOR_H, 0.03), glass);
    leaf.position.set((DOOR0 + DOOR1) / 2 + (s * halfW) / 2, DOOR_H / 2, -T / 2);
    g.add(leaf);
    return { leaf, s, x0: leaf.position.x };
  });

  // The van and the counter in front of its open side.
  const vanHalfW = BITCOINETA.W / 2 + 0.115;
  const solids: NonNullable<LandmarkBuild['solids']> = [
    { x: stageMid, z: (STAGE_Z + (-D + T)) / 2, hx: stageW / 2, hz: stageD / 2, top: STAGE_TOP },
    { x: L.VAN_X + 0.115, z: L.VAN_Z, hx: vanHalfW, hz: BITCOINETA.L / 2 + 0.04, top: BITCOINETA.H },
    { x: L.OBELISK_X, z: L.OBELISK_Z, hx: 0.28, hz: 0.28, top: 99 },
  ];

  let insideNow = false;
  return {
    group: g,
    screen,
    seats,
    solids,
    doorLocal: new THREE.Vector3((DOOR0 + DOOR1) / 2, 0, 0.6),
    groundAt(l) {
      const inRoom = l.x > -W / 2 + T && l.x < W / 2 - T && l.z > -D + T && l.z < -T;
      return inRoom ? LABITCONF_FLOOR : 0;
    },
    interior: {
      rooms: [
        { minX: -W / 2 + T + 0.02, maxX: W / 2 - T - 0.02, minZ: -D + T + 0.02, maxZ: -T - 0.02 },
        { minX: DOOR0 + 0.04, maxX: DOOR1 - 0.04, minZ: -0.4, maxZ: 0.6 },
      ],
      door: { x: (DOOR0 + DOOR1) / 2, z: 0 },
      setDoor(open) { for (const l of leaves) l.leaf.position.x = l.x0 + l.s * open * halfW * 0.9; },
      setInside(on) {
        if (on === insideNow) return;
        insideNow = on;
        for (const o of [...roofParts, sign, signStrip]) o.visible = !on;
        for (const m of [outer, inner]) { m.transparent = on; m.opacity = on ? 0.25 : 1; m.depthWrite = !on; m.needsUpdate = true; }
        for (const w of walls) w.castShadow = !on;
      },
    },
    update(_dt, t) {
      // The spots breathe a little, as stage lights do between talks.
      spotMat.emissiveIntensity = 1.0 + 0.3 * Math.sin(t * 1.3);
    },
    setNight(night, t) {
      signMat.emissiveIntensity = 0.4 + night * 1.0;
      glowStrip.emissiveIntensity = 0.5 + night * 1.0;
      glass.emissiveIntensity = 0.1 + night * 0.4;
      houseLight.intensity = 2.2 + night * 0.8;
      ob.setGlow(night, (Math.sin(t * 2) * 0.5 + 0.5) * 0.15);
    },
  };
}
