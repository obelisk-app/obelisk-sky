// Halloween 5 at La Crypta's door (events/halloween.ts): an orange aura where
// La Crypta's account stands, a painted sign on two posts beside it, and two
// jack-o'-lanterns, one at the sign's far end and one on the landing by the door.
// Built by World.buildHalloween in La Crypta's frame (facade z = 0 facing +z),
// outside the landmark's merge, only while the party is on. No lights: the
// sign and the lanterns' faces are emissive, the aura is additive.

import * as THREE from 'three';
import { canvasTexture } from './landmarks/signs';
import { buildAura, type Aura } from './landmarks/aura';
import { LA_CRYPTA_DOOR, LA_CRYPTA_RESIDENT, LA_CRYPTA_STAIRS } from './lacrypta';
import type { Vec2 } from './layout';

export const PUMPKIN = 0xfb923c;
const BROWN = '#271208';
const ORANGE = '#fb923c';
const PEACH = '#fdba74';

/** The sign (local): beside the resident, away from the steps, turned a little toward the street's middle. */
export const HALLOWEEN_SIGN = { x: LA_CRYPTA_RESIDENT.x + 0.8, z: LA_CRYPTA_RESIDENT.z - 0.12, yaw: -0.3, w: 0.9, h: 0.63, bottom: 0.4 } as const;
/** You can talk to La Crypta from this far (m). */
export const TALK_RADIUS = 1.8;

export interface HalloweenCorner {
  group: THREE.Group;
  /** Solids (local, as a landmark's): the sign's posts and the lantern at its foot. */
  solids: { x: number; z: number; hx: number; hz: number; top: number }[];
  update(dt: number, t: number, near: boolean): void;
  setNight(n: number): void;
}

/** The sign's face: a pumpkin, the party, the date and "tickets here", in the site's colours. */
export function drawHalloweenSign(g: CanvasRenderingContext2D, w: number, h: number): void {
  g.fillStyle = BROWN;
  g.fillRect(0, 0, w, h);
  // Diagonal grain, as on the event page.
  g.strokeStyle = 'rgba(255,255,255,0.04)';
  g.lineWidth = 2;
  for (let x = -h; x < w; x += 14) { g.beginPath(); g.moveTo(x, h); g.lineTo(x + h * 0.6, 0); g.stroke(); }
  const glow = g.createRadialGradient(w * 0.15, h * 0.1, 0, w * 0.15, h * 0.1, w * 0.6);
  glow.addColorStop(0, 'rgba(251,146,60,0.35)');
  glow.addColorStop(1, 'rgba(251,146,60,0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, w, h);
  g.strokeStyle = ORANGE;
  g.lineWidth = 10;
  g.strokeRect(12, 12, w - 24, h - 24);

  drawPumpkin(g, w * 0.16, h * 0.34, h * 0.15);
  // Inside the frame: every line is shrunk until it fits its width.
  const left = w * 0.3, right = w - 36, inner = w - 72;
  g.textBaseline = 'alphabetic';
  g.textAlign = 'left';
  g.fillStyle = PEACH;
  fitText(g, 'LA CRYPTA PRESENTA', left, h * 0.19, right - left, 600, 26);
  g.fillStyle = ORANGE;
  fitText(g, 'HALLOWEEN 5', left, h * 0.36, right - left, 900, 64);
  g.fillStyle = '#fff7ed';
  fitText(g, 'Fiesta de disfraces', left, h * 0.5, right - left, 700, 34);
  g.textAlign = 'center';
  g.fillStyle = PEACH;
  fitText(g, 'Sáb 31/10 · 20 h', w / 2, h * 0.64, inner, 700, 38);
  g.fillStyle = '#fff7ed';
  fitText(g, '100% Bitcoin · Villanueva 1367', w / 2, h * 0.74, inner, 600, 28);
  // "Entradas acá" on an orange band, with a bolt.
  const bandX = w * 0.14, bandW = w * 0.72, bandY = h * 0.79, bandH = h * 0.12;
  g.fillStyle = ORANGE;
  g.fillRect(bandX, bandY, bandW, bandH);
  g.fillStyle = '#090909';
  bolt(g, bandX + 12, bandY + bandH * 0.12, bandH * 0.76);
  fitText(g, 'ENTRADAS ACÁ', w / 2 + bandH * 0.3, bandY + bandH * 0.74, bandW - bandH * 1.4, 900, 40);
}

/** Text in `weight` at up to `size` px, smaller until it fits `max` px wide. */
export function fitText(g: CanvasRenderingContext2D, text: string, x: number, y: number, max: number, weight: number, size: number): number {
  let px = size;
  for (; px > 10; px -= 2) {
    g.font = `${weight} ${px}px system-ui, sans-serif`;
    if (g.measureText(text).width <= max) break;
  }
  g.fillText(text, x, y);
  return px;
}

function drawPumpkin(g: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  g.fillStyle = '#4d7c0f';
  g.fillRect(cx - r * 0.1, cy - r * 1.15, r * 0.2, r * 0.35);
  g.fillStyle = ORANGE;
  for (const dx of [-0.45, 0.45, 0]) {
    g.beginPath();
    g.ellipse(cx + dx * r, cy, r * 0.62, r * 0.85, 0, 0, Math.PI * 2);
    g.fill();
  }
  g.strokeStyle = '#c2410c';
  g.lineWidth = 3;
  for (const dx of [-0.3, 0.3]) { g.beginPath(); g.ellipse(cx + dx * r, cy, r * 0.25, r * 0.8, 0, 0, Math.PI * 2); g.stroke(); }
  g.fillStyle = '#facc15';
  tri(g, cx - r * 0.38, cy - r * 0.12, r * 0.22);
  tri(g, cx + r * 0.38, cy - r * 0.12, r * 0.22);
  g.beginPath();
  g.moveTo(cx - r * 0.5, cy + r * 0.25);
  for (let i = 0; i <= 6; i++) g.lineTo(cx - r * 0.5 + (i * r) / 6, cy + r * (i % 2 ? 0.48 : 0.3));
  g.lineTo(cx + r * 0.5, cy + r * 0.25);
  g.closePath();
  g.fill();
}

function tri(g: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  g.beginPath();
  g.moveTo(x, y - s * 0.6);
  g.lineTo(x + s * 0.6, y + s * 0.45);
  g.lineTo(x - s * 0.6, y + s * 0.45);
  g.closePath();
  g.fill();
}

function bolt(g: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  g.beginPath();
  g.moveTo(x + s * 0.55, y);
  g.lineTo(x + s * 0.1, y + s * 0.55);
  g.lineTo(x + s * 0.4, y + s * 0.55);
  g.lineTo(x + s * 0.2, y + s);
  g.lineTo(x + s * 0.75, y + s * 0.4);
  g.lineTo(x + s * 0.45, y + s * 0.4);
  g.closePath();
  g.fill();
}

/** A jack-o'-lantern: ribbed orange body, stem, a carved face that glows after dark. */
function jackOLantern(faceMat: THREE.Material, s = 1): THREE.Group {
  const p = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color: PUMPKIN, roughness: 0.7, flatShading: true });
  for (const [dx, k] of [[0, 1], [-0.045, 0.85], [0.045, 0.85]] as const) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.1 * k, 10, 8), body);
    m.scale.set(1, 0.78, 1);
    m.position.set(dx, 0.078, 0);
    m.castShadow = true;
    p.add(m);
  }
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.018, 0.05, 6), new THREE.MeshStandardMaterial({ color: 0x4d7c0f, flatShading: true }));
  stem.position.y = 0.16;
  p.add(stem);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(0.13, 0.09), faceMat);
  face.position.set(0, 0.08, 0.093);
  p.add(face);
  p.scale.setScalar(s);
  return p;
}

export function buildHalloweenCorner(): HalloweenCorner {
  const group = new THREE.Group();
  group.name = 'halloween';

  const aura: Aura = buildAura(PUMPKIN, 0xc2410c, 0.34, 0.6);
  aura.group.position.set(LA_CRYPTA_RESIDENT.x, 0, LA_CRYPTA_RESIDENT.z);
  group.add(aura.group);

  // The sign: a painted board in a dark frame on two posts.
  const S = HALLOWEEN_SIGN;
  const sign = new THREE.Group();
  sign.position.set(S.x, 0, S.z);
  sign.rotation.y = S.yaw;
  const tex = canvasTexture(640, 448, (g) => drawHalloweenSign(g, 640, 448));
  const faceMat = new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.25, roughness: 0.8 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x2a1a10, roughness: 0.9, flatShading: true });
  const board = new THREE.Mesh(new THREE.BoxGeometry(S.w + 0.05, S.h + 0.05, 0.035), wood);
  board.position.y = S.bottom + S.h / 2;
  board.castShadow = true;
  sign.add(board);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(S.w, S.h), faceMat);
  face.position.set(0, S.bottom + S.h / 2, 0.019);
  face.name = 'halloween-sign';
  sign.add(face);
  for (const x of [-S.w / 2 + 0.06, S.w / 2 - 0.06]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.045, S.bottom + 0.06, 0.045), wood);
    post.position.set(x, (S.bottom + 0.06) / 2, -0.03);
    post.castShadow = true;
    sign.add(post);
  }
  group.add(sign);

  // Lantern faces: a dark carving by day, glowing yellow after dark.
  const carve = canvasTexture(128, 96, (g) => {
    const w = 128, h = 96;
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#ffd34d';
    tri(g, w * 0.3, h * 0.35, h * 0.35);
    tri(g, w * 0.7, h * 0.35, h * 0.35);
    g.beginPath();
    g.moveTo(w * 0.18, h * 0.6);
    for (let i = 0; i <= 8; i++) g.lineTo(w * 0.18 + (i * w * 0.64) / 8, h * (i % 2 ? 0.88 : 0.68));
    g.lineTo(w * 0.82, h * 0.6);
    g.closePath();
    g.fill();
  });
  const lanternFace = new THREE.MeshStandardMaterial({ map: carve, transparent: true, color: 0x3a1a06, emissive: 0xffb02e, emissiveMap: carve, emissiveIntensity: 0.15, depthWrite: false });
  const foot = jackOLantern(lanternFace, 1.2);
  const footAt: Vec2 = { x: S.x + 0.56, z: S.z + 0.2 };
  foot.position.set(footAt.x, 0, footAt.z);
  foot.rotation.y = -0.2;
  group.add(foot);
  const landing = jackOLantern(lanternFace, 0.9);
  landing.position.set(LA_CRYPTA_DOOR.x + 0.28, LA_CRYPTA_STAIRS.lift, 0.25);
  group.add(landing);

  // The posts, as one solid along the board (axis-aligned bounds of the turned sign).
  const c = Math.abs(Math.cos(S.yaw)), sn = Math.abs(Math.sin(S.yaw));
  const solids = [
    { x: S.x, z: S.z, hx: (S.w / 2) * c + 0.03, hz: (S.w / 2) * sn + 0.04, top: S.bottom + S.h + 0.03 },
    { x: footAt.x, z: footAt.z, hx: 0.1, hz: 0.1, top: 0.18 },
  ];

  let night = 0;
  return {
    group,
    solids,
    update(dt, t, near) {
      aura.update(dt, t, near);
      lanternFace.emissiveIntensity = 0.15 + night * (1.4 + Math.sin(t * 7.3) * 0.12 + Math.sin(t * 12.1) * 0.08);
    },
    setNight(n) {
      night = n;
      faceMat.emissiveIntensity = 0.25 + n * 0.45;
    },
  };
}
