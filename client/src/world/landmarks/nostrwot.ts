// nostr-wot headquarters: a modern two-storey block of dark panels and a
// glass front, nostr-wot's mark (the web-of-trust graph, from the extension's
// own icon-base.svg) lit on the facade beside a "nostr-wot" wordmark, and on
// the roof the same graph in 3D, growing branch by branch on the animated
// logo's 9 s cycle (AnimatedWotLogo), slowly turning, nodes flashing
// whenever someone in the village reacts or zaps. A hologram ring glows at
// the entrance, where the official nostr-wot account stands.
//
// Local frame: facade on z = 0 facing +z.

import * as THREE from 'three';
import type { LandmarkBuild, LandmarkSeat } from './index';
import { buildAura } from './aura';

/** The official nostr-wot account (npub18h3r9fz7snau7hht02nrct29ajkk4y3236h2qs69dzph6mjfr6ws60amaz). */
export const NOSTR_WOT_PUBKEY = '3de232a45e84fbcf5eeb7aa63c2d45ecad6a922a8eaea0434568837d6e491e9d';
export const NOSTR_WOT_SITE = 'https://nostr-wot.com';

export const BRAND = 0x6366f1;
const BRAND_LIGHT = 0x818cf8;

/** The logo's graph, in its 48×48 viewBox (icon-base.svg, AnimatedWotLogo). */
export const WOT_GRAPH = {
  center: [24, 24] as const,
  branches: [
    { mid: [24, 12], ends: [[18, 6], [30, 6]] },
    { mid: [34, 17], ends: [[42, 12]] },
    { mid: [36, 27], ends: [[43, 30]] },
    { mid: [30, 35], ends: [[35, 42]] },
    { mid: [17, 34], ends: [[12, 42]] },
    { mid: [12, 22], ends: [[5, 18]] },
  ] as { mid: [number, number]; ends: [number, number][] }[],
};

/** How far branch `i` has grown at time `t` of the 9 s cycle (0..1), like the animated logo. */
export function branchGrowth(i: number, t: number): { line: number; mid: number; ends: number; alpha: number } {
  const CYCLE = 9, HOLD_END = 7.8, FADE_END = 8.7;
  const s = t % CYCLE;
  const start = 0.4 + i * 0.55;
  const ramp = (a: number, d: number) => Math.min(1, Math.max(0, (s - a) / d));
  const alpha = s < HOLD_END ? 1 : Math.max(0, 1 - (s - HOLD_END) / (FADE_END - HOLD_END));
  return { line: ramp(start, 0.4), mid: ramp(start + 0.35, 0.2), ends: ramp(start + 0.75, 0.35), alpha };
}

/** Draw the web-of-trust mark (the logo's graph) into a 2D canvas. */
function drawGraph(g: CanvasRenderingContext2D, cx: number, cy: number, size: number, color: string, glow: string): void {
  const k = size / 48;
  const P = ([x, y]: readonly [number, number]) => [cx + (x - 24) * k, cy + (y - 24) * k] as const;
  g.save();
  g.shadowColor = glow;
  g.shadowBlur = size * 0.12;
  g.strokeStyle = color;
  g.lineWidth = 1.6 * k;
  g.lineCap = 'round';
  g.globalAlpha = 0.75;
  for (const b of WOT_GRAPH.branches) {
    const [ax, ay] = P(WOT_GRAPH.center), [mx, my] = P(b.mid);
    g.beginPath(); g.moveTo(ax, ay); g.lineTo(mx, my); g.stroke();
    for (const e of b.ends) { const [ex, ey] = P(e); g.beginPath(); g.moveTo(mx, my); g.lineTo(ex, ey); g.stroke(); }
  }
  g.globalAlpha = 1;
  g.fillStyle = color;
  const dot = (p: readonly [number, number], r: number) => { const [x, y] = P(p); g.beginPath(); g.arc(x, y, r * k, 0, Math.PI * 2); g.fill(); };
  for (const b of WOT_GRAPH.branches) { dot(b.mid, 3.5); for (const e of b.ends) dot(e, 2.5); }
  g.fillStyle = '#ffffff';
  dot(WOT_GRAPH.center, 5);
  g.restore();
}

/** The front sign: a lit graph mark, "nostr-wot" and "WEB OF TRUST", on a dark panel. */
function signTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 2048;
  c.height = 512;
  const g = c.getContext('2d')!;
  const bg = g.createLinearGradient(0, 0, 0, 512);
  bg.addColorStop(0, '#171a33');
  bg.addColorStop(1, '#0c0e1d');
  g.fillStyle = bg;
  g.beginPath();
  g.roundRect(8, 8, 2032, 496, 64);
  g.fill();
  g.strokeStyle = '#6366f1';
  g.lineWidth = 10;
  g.shadowColor = '#818cf8';
  g.shadowBlur = 30;
  g.stroke();
  g.shadowBlur = 0;
  drawGraph(g, 290, 256, 380, '#a5b4fc', '#6366f1');
  g.shadowColor = '#818cf8';
  g.shadowBlur = 36;
  g.fillStyle = '#ffffff';
  g.font = '800 230px Inter, system-ui, sans-serif';
  g.textBaseline = 'alphabetic';
  g.fillText('nostr-wot', 540, 300);
  g.shadowBlur = 12;
  g.fillStyle = '#a5b4fc';
  g.font = '600 74px Inter, system-ui, sans-serif';
  const sub = 'W E B   O F   T R U S T';
  g.fillText(sub, 548, 420);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** The wall screen inside: the graph and a few lines of "dashboard". */
function screenTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 448;
  const g = c.getContext('2d')!;
  g.fillStyle = '#0b0d1c';
  g.fillRect(0, 0, 1024, 448);
  drawGraph(g, 230, 224, 340, '#818cf8', '#6366f1');
  g.fillStyle = '#e0e7ff';
  g.font = '800 54px Inter, system-ui, sans-serif';
  g.fillText('Web of Trust', 470, 110);
  g.font = '500 30px Inter, system-ui, sans-serif';
  g.fillStyle = '#a5b4fc';
  ['follows graph · 2 hops', 'trusted relays ✓', 'spam filtered ✓', 'zaps validated ✓'].forEach((l, i) => g.fillText(l, 474, 180 + i * 56));
  g.fillStyle = '#6366f1';
  g.fillRect(470, 400, 480, 8);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildNostrWotHq(): LandmarkBuild {
  const g = new THREE.Group();
  const W = 2.7, D = 2.0, H1 = 1.15, H2 = 1.0, T = 0.08;
  const panel = new THREE.MeshStandardMaterial({ color: 0x32364f, roughness: 0.55, metalness: 0.2 });
  const inner = new THREE.MeshStandardMaterial({ color: 0xe6e8f0, roughness: 0.9 });
  const trim = new THREE.MeshStandardMaterial({ color: 0x2b2f4a, roughness: 0.4, metalness: 0.5 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x9fa8ff, emissive: BRAND, emissiveIntensity: 0.08, roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.32, depthWrite: false });
  const box = (w: number, h: number, d: number, m: THREE.Material | THREE.Material[], x: number, y: number, z: number) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    b.position.set(x, y, z);
    b.castShadow = b.receiveShadow = true;
    g.add(b);
    return b;
  };
  // Walls: dark outside, pale inside (+x, -x, +y, -y, +z, -z faces).
  const backWall = box(W, H1, T, [panel, panel, panel, panel, inner, panel], 0, H1 / 2, -D + T / 2);
  const leftWall = box(T, H1, D, [inner, panel, panel, panel, panel, panel], -W / 2 + T / 2, H1 / 2, -D / 2);
  const rightWall = box(T, H1, D, [panel, inner, panel, panel, panel, panel], W / 2 - T / 2, H1 / 2, -D / 2);
  const walls = [backWall, leftWall, rightWall];
  // Floor: pale concrete, an indigo rug with the mark.
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W - 2 * T, D - T), new THREE.MeshStandardMaterial({ color: 0xc9ccd8, roughness: 0.8 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0.006, -D / 2 - T / 2);
  floor.receiveShadow = true;
  g.add(floor);
  const rugC = document.createElement('canvas');
  rugC.width = rugC.height = 256;
  const rg = rugC.getContext('2d')!;
  rg.fillStyle = '#272a5c'; rg.beginPath(); rg.arc(128, 128, 126, 0, Math.PI * 2); rg.fill();
  drawGraph(rg, 128, 128, 200, '#818cf8', '#272a5c');
  const rugT = new THREE.CanvasTexture(rugC); rugT.colorSpace = THREE.SRGBColorSpace;
  const rug = new THREE.Mesh(new THREE.CircleGeometry(0.42, 32), new THREE.MeshStandardMaterial({ map: rugT, transparent: true, roughness: 1 }));
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(0.1, 0.014, -0.95);
  g.add(rug);

  // Glass front with a sliding double door at x 0.45.
  const DOOR_X = 0.45, DOOR_W = 0.56, top = H1 - 0.12;
  const paneL = box(DOOR_X - DOOR_W / 2 - (-W / 2), top - 0.08, 0.03, glass, (-W / 2 + DOOR_X - DOOR_W / 2) / 2, 0.08 + (top - 0.08) / 2, -0.01);
  const paneR = box(W / 2 - (DOOR_X + DOOR_W / 2), top - 0.08, 0.03, glass, (W / 2 + DOOR_X + DOOR_W / 2) / 2, 0.08 + (top - 0.08) / 2, -0.01);
  paneL.castShadow = paneR.castShadow = false;
  box(W, H1 - top, 0.06, trim, 0, top + (H1 - top) / 2, -0.01); // header over the glass
  box(W, 0.08, 0.06, trim, 0, 0.04, -0.01); // sill
  for (const x of [-W / 2 + 0.03, -0.7, DOOR_X - DOOR_W / 2, DOOR_X + DOOR_W / 2, W / 2 - 0.03]) box(0.035, top, 0.06, trim, x, top / 2, 0);
  const leaves: THREE.Mesh[] = [];
  for (const side of [-1, 1]) {
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(DOOR_W / 2, top - 0.1, 0.025), glass);
    leaf.position.set(DOOR_X + side * DOOR_W / 4, 0.08 + (top - 0.1) / 2, 0.02);
    leaf.userData.home = leaf.position.x;
    leaf.userData.side = side;
    g.add(leaf);
    leaves.push(leaf);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.22, 0.02), new THREE.MeshStandardMaterial({ color: 0xd8dde3, metalness: 0.9, roughness: 0.2 }));
    handle.position.set(-side * (DOOR_W / 4 - 0.03), 0, 0.02);
    leaf.add(handle);
  }

  // ── inside ─────────────────────────────────────────────────────────────
  const seats: LandmarkSeat[] = [];
  const solids: NonNullable<LandmarkBuild['solids']> = [];
  const white = new THREE.MeshStandardMaterial({ color: 0xf4f5fa, roughness: 0.5 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1f2233, roughness: 0.6 });
  const brandMat = new THREE.MeshStandardMaterial({ color: BRAND, emissive: BRAND, emissiveIntensity: 0.5 });
  // Wall screen on the back wall.
  const screenMat = new THREE.MeshStandardMaterial({ map: screenTexture(), emissive: 0xffffff, emissiveIntensity: 0.55 });
  screenMat.emissiveMap = screenMat.map;
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.57), screenMat);
  screen.position.set(-0.15, 0.64, -D + T + 0.024);
  g.add(screen);
  box(1.36, 0.63, 0.02, dark, -0.15, 0.64, -D + T + 0.001).castShadow = false;
  // Reception desk by the door, facing it.
  box(0.26, 0.36, 0.62, white, 0.98, 0.18, -0.85);
  box(0.27, 0.035, 0.64, brandMat, 0.98, 0.25, -0.85);
  solids.push({ x: 0.98, z: -0.85, hx: 0.13, hz: 0.31, top: 0.37 });
  const mini = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2), new THREE.MeshStandardMaterial({ map: rugT, transparent: true, emissive: 0xffffff, emissiveMap: rugT, emissiveIntensity: 0.4 }));
  mini.rotation.y = -Math.PI / 2;
  mini.position.set(0.98 - 0.135, 0.18, -0.85);
  g.add(mini);
  // Two workstations on the left: desk, monitor showing the graph, chair.
  const monTex = screenTexture();
  const chairMat = new THREE.MeshStandardMaterial({ color: 0x2b2f4a, roughness: 0.6 });
  for (const z of [-0.6, -1.4]) {
    box(0.42, 0.025, 0.5, white, -1.05, 0.3, z);
    for (const dz of [-0.22, 0.22]) box(0.03, 0.3, 0.03, dark, -1.2, 0.15, z + dz);
    solids.push({ x: -1.05, z, hx: 0.21, hz: 0.25, top: 0.31 });
    const mon = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.15), new THREE.MeshStandardMaterial({ map: monTex, emissive: 0xffffff, emissiveMap: monTex, emissiveIntensity: 0.6 }));
    mon.rotation.y = Math.PI / 2;
    mon.position.set(-1.163, 0.43, z);
    g.add(mon);
    box(0.02, 0.17, 0.36, dark, -1.182, 0.43, z);
    box(0.02, 0.1, 0.03, dark, -1.18, 0.34, z);
    // Chair facing the desk (-x).
    const cx = -0.72;
    box(0.17, 0.03, 0.17, chairMat, cx, 0.18, z);
    box(0.03, 0.2, 0.17, chairMat, cx + 0.085, 0.3, z);
    box(0.02, 0.17, 0.02, dark, cx, 0.085, z);
    seats.push({ pos: { x: cx, z }, face: -Math.PI / 2, y: 0.19, prop: 'coffee' });
  }
  // Plants in the back corners.
  for (const x of [-1.1, 1.1]) {
    box(0.16, 0.18, 0.16, white, x, 0.09, -D + T + 0.12);
    const leaves2 = new THREE.Mesh(new THREE.IcosahedronGeometry(0.17, 1), new THREE.MeshStandardMaterial({ color: 0x3f8f4a, roughness: 0.9, flatShading: true }));
    leaves2.position.set(x, 0.33, -D + T + 0.12);
    leaves2.scale.set(1, 1.4, 1);
    leaves2.castShadow = true;
    g.add(leaves2);
  }
  const roomLight = new THREE.PointLight(0xdfe3ff, 0.6, 3.2, 1.4);
  roomLight.position.set(0, 1.0, -1.0);
  g.add(roomLight);

  // ── upper floor, roof and the sign (hidden from inside) ────────────────
  const upperParts: THREE.Object3D[] = [];
  const up = (o: THREE.Object3D) => { upperParts.push(o); return o; };
  up(box(W + 0.1, H2, D + 0.25, panel, 0, H1 + H2 / 2, -D / 2 + 0.12));
  up(box(W + 0.2, 0.08, D + 0.35, trim, 0, H1 + H2 + 0.04, -D / 2 + 0.12));
  const lineMat = new THREE.MeshStandardMaterial({ color: BRAND, emissive: BRAND, emissiveIntensity: 0.6 });
  up(box(W + 0.1, 0.03, 0.03, lineMat, 0, H1 + 0.01, 0.265));
  // The sign, in a lit indigo frame on the upper floor.
  const signTex = signTexture();
  const signMat = new THREE.MeshStandardMaterial({ map: signTex, emissive: 0xffffff, emissiveMap: signTex, emissiveIntensity: 0.55, roughness: 0.35 });
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.6), signMat);
  sign.position.set(0, H1 + H2 / 2, 0.252 + 0.012);
  g.add(up(sign));
  const frameMat = new THREE.MeshStandardMaterial({ color: BRAND_LIGHT, emissive: BRAND, emissiveIntensity: 0.9 });
  for (const [w, h, x, y] of [[2.48, 0.025, 0, 0.31], [2.48, 0.025, 0, -0.31], [0.025, 0.64, 1.24, 0], [0.025, 0.64, -1.24, 0]] as const) {
    up(box(w, h, 0.03, frameMat, x, H1 + H2 / 2 + y, 0.26));
  }
  // Pale glow strips along the upper corners and under the roof trim: with
  // the one along the first floor they frame the upper storey.
  for (const x of [-(W + 0.1) / 2, (W + 0.1) / 2]) up(box(0.03, H2, 0.03, lineMat, x, H1 + H2 / 2, 0.255));
  const topStrip = up(box(W + 0.1, 0.03, 0.03, lineMat, 0, H1 + H2 - 0.015, 0.265));
  topStrip.name = 'frame-top';
  const logoMat = signMat;
  const wmMat = frameMat;

  // Entrance hologram, now to the left of the door where the resident stands.
  const RES_X = -0.85;
  const aura = buildAura(BRAND_LIGHT, BRAND);
  aura.group.position.set(RES_X, 0, 0.65);
  g.add(aura.group);

  // The rooftop graph: the logo in 3D, standing up, on a short mast.
  const graph = new THREE.Group();
  graph.position.set(0, H1 + H2 + 0.85, -D / 2 + 0.12);
  g.add(up(graph));
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.05, 0.75, 8), trim);
  mast.position.set(0, H1 + H2 + 0.42, -D / 2 + 0.12);
  g.add(up(mast));
  const S = 0.03; // viewBox unit → world
  const toLocal = ([x, y]: readonly [number, number]) => new THREE.Vector3((x - 24) * S, (24 - y) * S, 0);
  const nodeMat = new THREE.MeshStandardMaterial({ color: BRAND_LIGHT, emissive: BRAND, emissiveIntensity: 0.9 });
  const centerNode = new THREE.Mesh(new THREE.SphereGeometry(5 * S * 0.8, 16, 12), nodeMat);
  graph.add(centerNode);
  const lineMatG = new THREE.LineBasicMaterial({ color: BRAND_LIGHT, transparent: true, opacity: 0.8 });
  const nodes: { mesh: THREE.Mesh; r: number; branch: number; kind: 'mid' | 'end' }[] = [];
  const lines: { line: THREE.Line; from: THREE.Vector3; to: THREE.Vector3; branch: number; kind: 'mid' | 'end'; k: number }[] = [];
  const lineEnd = new THREE.Vector3();
  const pulses: { m: THREE.Mesh; from: THREE.Vector3; to: THREE.Vector3; phase: number }[] = [];
  const pulseMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  WOT_GRAPH.branches.forEach((b, i) => {
    const c = toLocal(WOT_GRAPH.center), m = toLocal(b.mid);
    const mkLine = (from: THREE.Vector3, to: THREE.Vector3, kind: 'mid' | 'end') => {
      const geo = new THREE.BufferGeometry().setFromPoints([from.clone(), to.clone()]);
      const l = new THREE.Line(geo, lineMatG.clone());
      graph.add(l);
      lines.push({ line: l, from, to, branch: i, kind, k: -1 });
    };
    mkLine(c, m, 'mid');
    const mid = new THREE.Mesh(new THREE.SphereGeometry(3.5 * S * 0.8, 12, 8), nodeMat.clone());
    mid.position.copy(m);
    graph.add(mid);
    nodes.push({ mesh: mid, r: 1, branch: i, kind: 'mid' });
    for (const e of b.ends) {
      const ep = toLocal(e as [number, number]);
      mkLine(m, ep, 'end');
      const end = new THREE.Mesh(new THREE.SphereGeometry(2.5 * S * 0.8, 10, 8), nodeMat.clone());
      end.position.copy(ep);
      graph.add(end);
      nodes.push({ mesh: end, r: 1, branch: i, kind: 'end' });
      const p = new THREE.Mesh(new THREE.SphereGeometry(0.018, 6, 4), pulseMat);
      graph.add(p);
      pulses.push({ m: p, from: c, to: ep, phase: Math.random() });
    }
  });
  const glowLight = new THREE.PointLight(BRAND, 0, 4, 1.5);
  glowLight.position.copy(graph.position);
  g.add(glowLight);

  let flash = 0;
  let night = 0;
  let inside = false;
  const wallMats = [panel, inner];
  return {
    group: g,
    doorLocal: new THREE.Vector3(DOOR_X, 0, 1.2),
    residentLocal: { x: RES_X, z: 0.65 },
    seats,
    solids,
    interior: {
      rooms: [
        { minX: -W / 2 + T + 0.02, maxX: W / 2 - T - 0.02, minZ: -D + T + 0.02, maxZ: -0.05 },
        { minX: DOOR_X - DOOR_W / 2 + 0.02, maxX: DOOR_X + DOOR_W / 2 - 0.02, minZ: -0.3, maxZ: 0.5 },
      ],
      door: { x: DOOR_X, z: 0.1 },
      setDoor(open) {
        for (const l of leaves) l.position.x = (l.userData.home as number) + (l.userData.side as number) * open * (DOOR_W / 2 - 0.02);
      },
      setInside(on) {
        if (on === inside) return;
        inside = on;
        for (const o of upperParts) o.visible = !on;
        for (const m of wallMats) { m.transparent = on; m.opacity = on ? 0.28 : 1; m.depthWrite = !on; m.needsUpdate = true; }
        for (const w of walls) w.castShadow = !on;
      },
    },
    pulse() { flash = 1; aura.pulse(); },
    update(dt, t) {
      graph.rotation.y = Math.sin(t * 0.25) * 0.6;
      flash = Math.max(0, flash - dt * 1.2);
      for (const n of nodes) {
        const gr = branchGrowth(n.branch, t);
        const k = (n.kind === 'mid' ? gr.mid : gr.ends) * gr.alpha;
        n.mesh.scale.setScalar(Math.max(0.001, k * (1 + (k < 1 && k > 0.6 ? 0.3 : 0))));
        (n.mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.9 + flash * 2.5 + night * 0.6;
      }
      for (const l of lines) {
        const gr = branchGrowth(l.branch, t);
        const k = l.kind === 'mid' ? gr.line : Math.min(1, gr.ends * 1.4);
        // Only re-upload a line that grew or shrank since the last frame.
        if (l.k !== k) {
          l.k = k;
          lineEnd.copy(l.from).lerp(l.to, k);
          const pos = l.line.geometry.attributes.position as THREE.BufferAttribute;
          pos.setXYZ(1, lineEnd.x, lineEnd.y, lineEnd.z);
          pos.needsUpdate = true;
        }
        (l.line.material as THREE.LineBasicMaterial).opacity = 0.8 * gr.alpha;
      }
      for (const p of pulses) {
        const k = (t * 0.45 + p.phase) % 1;
        p.m.position.copy(p.from).lerp(p.to, k);
        p.m.visible = flash > 0.05 || night > 0.3;
      }
      centerNode.scale.setScalar(1 + Math.sin(t * 2) * 0.05 + flash * 0.4);
      aura.update(dt, t);
      glowLight.intensity = night * 2.2 + flash * 3;
    },
    setNight(n) {
      night = n;
      glass.emissiveIntensity = 0.08 + n * 0.25;
      lineMat.emissiveIntensity = 0.6 + n * 1.6;
      logoMat.emissiveIntensity = 0.5 + n * 0.2;
      wmMat.emissiveIntensity = 0.9 + n * 1.4;
      roomLight.intensity = 0.6 + n * 1.4;
    },
  };
}
