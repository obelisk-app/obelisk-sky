// The totem monitor: a big screen on a stand on LABITCONF's front lawn,
// facing the plaza, for La Crypta's totem (totemcillo: the live #lacrypta /
// #labitconf notes and zaps, a QR to act on them from a phone).
//
// Like LABITCONF's stage (youtubeStage.ts), the monitor plays the real
// page: `TotemStage` lays totemcillo's <iframe> over the screen in 3D
// (domScreen.ts) while the camera is within `TOTEM.VIEW_M`, and removes it
// past that, so far-off visitors hold no relay connections. Drawn over the
// canvas, the page would show through whatever stands in front, so
// `OcclusionProbe` casts rays from the camera to the screen a few times a
// second and the layer hides unless the whole screen is clear; under it the
// screen's own texture, a painted still of the totem, is an ordinary mesh
// that buildings hide.
//
// In front of the screen (`inTotemZone`) main.ts offers "Press E to watch
// the totemcillo": E (or a tap on the prompt) opens the theater's Watch
// mode view (ui/theaterPanel.ts WatchView) holding the page, for you alone;
// the monitor's own page is dropped meanwhile. World places the monitor in
// LABITCONF's frame (`TOTEM.X`, `TOTEM.Z`).

import * as THREE from 'three';
import type { Vec2 } from './layout';
import { canvasTexture } from './landmarks/signs';
import { DomScreen } from './domScreen';
import { lookOnlyFrame } from '../ui/theaterPanel';

/** The page focus mode shows; its origin is in the server's CSP frame-src. */
export const TOTEM_URL = 'https://totemcillo.vercel.app/';
export const TOTEM_ORIGIN = new URL(TOTEM_URL).origin;

export const TOTEM = {
  /** The screen, 16:9: as wide as the lawn between the facade's left end and the road to the door allows. */
  W: 1.6,
  H: 0.9,
  /** Its centre's height: the bottom over the heads, the top under LABITCONF's wordmark. */
  Y: 1.27,
  /** Where it stands in LABITCONF's frame (facade at z = 0, door at the front right). */
  X: -1.05,
  Z: 0.5,
  /** Where E watches it (monitor-local): in front of the stand (from `front` to `depth` out), as wide as the screen; `pad` more all round for a click on the screen. */
  ZONE: { front: 0.15, depth: 1.3, pad: 0.5 },
  /** The live page is on while the camera is within VIEW_M of the screen (6 m: farther, the 1.6 m screen's page is too small to read), off past VIEW_M + VIEW_PAD. */
  VIEW_M: 6,
  VIEW_PAD: 2,
  /** Seconds between occlusion probes. */
  PROBE_S: 0.2,
} as const;

/** The page's size in CSS pixels, the screen's 16:9: its layout viewport is a desktop's (totemcillo draws its phone view at 700 px wide
 *  and below), and DomScreen scales the box down onto the 1.6 × 0.9 screen. */
export const TOTEM_PAGE = { W: 1600, H: 900 } as const;

/** Is `l` (monitor-local: x across the screen, z out of its face) on the ground in front of the screen? */
export function inTotemZone(l: Vec2, pad = 0): boolean {
  const { front, depth } = TOTEM.ZONE;
  return Math.abs(l.x) < TOTEM.W / 2 + pad && l.z > front - pad && l.z < depth + pad;
}

/** Should the live page be on, the camera `d` metres from the screen, `live` if it is now? */
export function totemInView(d: number, live: boolean): boolean {
  return d < TOTEM.VIEW_M + (live ? TOTEM.VIEW_PAD : 0);
}

/** Is the whole screen in plain sight of the camera? Rays to its centre and corners (inset a little), throttled to every `PROBE_S`. */
export class OcclusionProbe {
  private raycaster = new THREE.Raycaster();
  private wait = 0;
  private last = false;
  private eye = new THREE.Vector3();
  private dir = new THREE.Vector3();

  /** `dt` since the last call; `occluders`: what may stand in front (buildings, landmarks, the obelisk). */
  clear(dt: number, camera: THREE.Camera, screen: THREE.Object3D, occluders: THREE.Object3D[]): boolean {
    this.wait -= dt;
    if (this.wait > 0) return this.last;
    this.wait = TOTEM.PROBE_S;
    this.eye.setFromMatrixPosition(camera.matrixWorld);
    // Sprites (glows) need the camera to be hit at all; they're light, not walls, so they never count.
    this.raycaster.camera = camera;
    const hw = TOTEM.W * 0.47, hh = TOTEM.H * 0.45;
    this.last = [[0, 0], [-hw, -hh], [hw, -hh], [-hw, hh], [hw, hh]].every(([x, y]) => {
      const p = new THREE.Vector3(x, y, 0).applyMatrix4(screen.matrixWorld);
      const d = this.dir.copy(p).sub(this.eye).length();
      this.raycaster.set(this.eye, this.dir.normalize());
      this.raycaster.far = d - 0.05;
      return !this.raycaster.intersectObjects(occluders, true).some((h) => !(h.object as THREE.Sprite).isSprite);
    });
    return this.last;
  }
}

/** Totemcillo's page laid over the monitor while it's in view. */
export class TotemStage {
  private layer: DomScreen;
  private iframe: HTMLIFrameElement | null = null;

  constructor(parent: HTMLElement, after: Element | null, screen: THREE.Object3D, width: number, height: number, private url = TOTEM_URL) {
    this.layer = new DomScreen(parent, after, screen, width, height, 'totem-video', TOTEM_PAGE.W);
  }

  /** Is the page in the document? */
  get live(): boolean {
    return !!this.iframe;
  }

  setSize(w: number, h: number): void {
    this.layer.setSize(w, h);
  }

  /** Once a frame, after the world drew: `on` puts the page in or takes it out; `clear` (nothing in front) lets the layer show. */
  update(camera: THREE.PerspectiveCamera, on: boolean, clear: boolean): void {
    if (on && !this.iframe) {
      const f = lookOnlyFrame(this.url, 'Totem LABITCONF');
      Object.assign(f.style, { width: `${TOTEM_PAGE.W}px`, height: `${TOTEM_PAGE.H}px`, border: '0', display: 'block' });
      this.layer.holder.append(f);
      this.iframe = f;
    } else if (!on && this.iframe) {
      this.iframe.remove();
      this.iframe = null;
    }
    this.layer.update(camera, on && clear);
  }

  dispose(): void {
    this.iframe?.remove();
    this.iframe = null;
    this.layer.dispose();
  }
}

/** The screen's still (under the live page, and while it's off or hidden): a dark totem page (La Crypta's mark, the tags, the totemcillo name, a QR block). Brand words, in English as other painted screens. */
export function drawTotemCard(c: CanvasRenderingContext2D, w: number, h: number): void {
  const grad = c.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, '#111611');
  grad.addColorStop(1, '#050705');
  c.fillStyle = grad;
  c.fillRect(0, 0, w, h);
  c.textBaseline = 'middle';
  // Top bar: the mark on the left, the tags on the right.
  c.fillStyle = '#ffffff';
  c.textAlign = 'left';
  c.font = `800 ${Math.round(h * 0.06)}px Inter, system-ui, sans-serif`;
  c.fillText('la crypta', w * 0.05, h * 0.09);
  c.textAlign = 'right';
  c.fillStyle = '#a3e635';
  c.font = `700 ${Math.round(h * 0.04)}px Inter, system-ui, sans-serif`;
  c.fillText('#lacrypta · #labitconf', w * 0.95, h * 0.09);
  // The title, glowing La Crypta green, and lines standing for the notes.
  c.textAlign = 'center';
  c.shadowColor = '#a3e635';
  c.shadowBlur = w * 0.02;
  c.fillStyle = '#d9f99d';
  c.font = `900 ${Math.round(h * 0.13)}px Inter, system-ui, sans-serif`;
  c.fillText('totemcillo', w * 0.38, h * 0.3);
  c.shadowBlur = 0;
  c.fillStyle = '#2a332a';
  for (let i = 0; i < 4; i++) c.fillRect(w * 0.06, h * (0.46 + i * 0.12), w * (0.5 - (i % 2) * 0.12), h * 0.05);
  // The QR: a white card with a fixed pattern of modules and its three finder squares.
  const q = h * 0.42, qx = w * 0.7, qy = h * 0.4, cells = 21, m = q / cells;
  c.fillStyle = '#ffffff';
  c.fillRect(qx - m, qy - m, q + 2 * m, q + 2 * m);
  c.fillStyle = '#000000';
  for (let j = 0; j < cells; j++) for (let i = 0; i < cells; i++) {
    const finder = (i < 7 || i >= cells - 7) && j < 7 || i < 7 && j >= cells - 7;
    if (finder) continue;
    if (((i * 7 + j * 13 + i * j) % 5) < 2) c.fillRect(qx + i * m, qy + j * m, m, m);
  }
  for (const [fx, fy] of [[0, 0], [cells - 7, 0], [0, cells - 7]]) {
    c.fillRect(qx + fx * m, qy + fy * m, 7 * m, 7 * m);
    c.fillStyle = '#ffffff';
    c.fillRect(qx + (fx + 1) * m, qy + (fy + 1) * m, 5 * m, 5 * m);
    c.fillStyle = '#000000';
    c.fillRect(qx + (fx + 2) * m, qy + (fy + 2) * m, 3 * m, 3 * m);
  }
}

export interface TotemMonitor {
  group: THREE.Group;
  /** The screen (its front faces +z): clicked, it focuses the totem. */
  screen: THREE.Mesh;
  /** The stand's footprint, local and axis-aligned like a landmark's solids. */
  solid: { x: number; z: number; hx: number; hz: number; top: number };
}

/** The monitor in its own frame: on the ground at the origin, the screen facing +z. */
export function buildTotemMonitor(): TotemMonitor {
  const { W, H, Y } = TOTEM;
  const g = new THREE.Group();
  const black = new THREE.MeshStandardMaterial({ color: 0x16171a, roughness: 0.85, flatShading: true });
  const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    b.position.set(x, y, z);
    b.castShadow = b.receiveShadow = true;
    g.add(b);
    return b;
  };
  box(W + 0.1, 0.08, 0.24, black, 0, 0.04, 0); // base
  for (const s of [-1, 1]) box(0.06, Y, 0.06, black, s * (W / 2 - 0.15), Y / 2, -0.06); // posts
  box(W + 0.08, H + 0.08, 0.05, black, 0, Y, -0.03); // frame
  // A green strip under the screen, La Crypta's colour, lit by itself (no light: the budget).
  const glow = new THREE.MeshStandardMaterial({ color: 0x0d1a08, emissive: 0xa3e635, emissiveIntensity: 0.8 });
  box(W, 0.025, 0.03, glow, 0, Y - H / 2 - 0.06, 0);
  const card = canvasTexture(1024, 576, (c) => drawTotemCard(c, 1024, 576));
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshBasicMaterial({ map: card, toneMapped: false }));
  screen.name = 'totem-screen';
  screen.position.set(0, Y, 0.001);
  g.add(screen);
  return { group: g, screen, solid: { x: 0, z: 0, hx: (W + 0.1) / 2, hz: 0.12, top: Y + H / 2 + 0.04 } };
}
