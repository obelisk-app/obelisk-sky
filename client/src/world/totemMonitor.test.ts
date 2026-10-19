// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { planIsland, trackSite, onTrack, plazaLanterns, buildNavGrid, distToPolyline } from './layout';
import { LANDMARKS, reserveLandmarkSlots, onLandmarkLawn } from './landmarks/index';
import { LABITCONF } from './landmarks/labitconf';
import { CHAR_HEIGHT } from './character';
import { obeliskShape } from './obelisk';
import { smoothRiver } from './island';
import { TOTEM, TOTEM_URL, buildTotemMonitor, drawTotemCard, inTotemZone, totemInView, OcclusionProbe, TotemStage } from './totemMonitor';
import { PAGE_VIEWPORT } from '../ui/theaterPanel';

/** LABITCONF's slot and the monitor's footprint in world space, as World places them. */
function placed() {
  const plan = planIsland();
  const track = trackSite(plan);
  const free = plan.slots.filter((s) => !track || !onTrack(s.pos, track, s.w * 0.7 + 0.6));
  const slots = reserveLandmarkSlots(free, plan.plaza.c);
  const s = slots.get('labitconf')!;
  const d = LANDMARKS.find((x) => x.id === 'labitconf')!;
  const c = Math.cos(s.rot), sn = Math.sin(s.rot);
  const toWorld = (x: number, z: number) => ({ x: s.pos.x + sn * d.forward + x * c + z * sn, z: s.pos.z + c * d.forward - x * sn + z * c });
  const m = buildTotemMonitor();
  const so = m.solid;
  const corners = [[-so.hx, -so.hz], [so.hx, -so.hz], [-so.hx, so.hz], [so.hx, so.hz]].map(([x, z]) => toWorld(TOTEM.X + x, TOTEM.Z + z));
  // World → the screen's frame (x across it, z out of its face), as World.totemLocal.
  const toScreen = (p: { x: number; z: number }) => {
    const dx = p.x - (s.pos.x + sn * d.forward), dz = p.z - (s.pos.z + c * d.forward);
    return { x: dx * c - dz * sn - TOTEM.X, z: dx * sn + dz * c - TOTEM.Z };
  };
  return { plan, slots, s, d, m, corners, centre: toWorld(TOTEM.X, TOTEM.Z), toWorld, toScreen };
}

describe('the totem monitor on LABITCONF’s lawn', () => {
  it('is a screen named for the World (its click), facing the plaza (+z), as big as TOTEM says', () => {
    const { group, screen } = buildTotemMonitor();
    expect(screen.name).toBe('totem-screen');
    expect(screen.parent).toBe(group);
    group.updateMatrixWorld(true);
    const normal = new THREE.Vector3(0, 0, 1).transformDirection(screen.matrixWorld);
    expect(normal.z).toBeCloseTo(1, 5);
    const geo = screen.geometry as THREE.PlaneGeometry;
    expect(geo.parameters.width).toBeCloseTo(TOTEM.W, 5);
    expect(geo.parameters.height).toBeCloseTo(TOTEM.H, 5);
  });

  it('hangs over the heads and under LABITCONF’s wordmark', () => {
    const { screen } = buildTotemMonitor();
    expect(screen.position.y - TOTEM.H / 2).toBeGreaterThan(CHAR_HEIGHT + 0.05);
    // The sign over the door is centred H − 0.36 up the facade: its letters stay readable over the monitor.
    expect(screen.position.y + TOTEM.H / 2).toBeLessThan(LABITCONF.H - 0.36);
  });

  it('stands on the lawn in front of the facade, left of the door, within the building’s width, solid up to its top', () => {
    const { solid } = buildTotemMonitor();
    // Solid round the whole screen and as high as it: you walk round it, you can’t jump through it.
    expect(solid.hx).toBeGreaterThanOrEqual(TOTEM.W / 2);
    expect(solid.top).toBeGreaterThanOrEqual(TOTEM.Y + TOTEM.H / 2);
    const f = LANDMARKS.find((x) => x.id === 'labitconf')!.footprint;
    expect(TOTEM.Z - solid.hz).toBeGreaterThan(f.maxZ + 0.1);
    expect(TOTEM.X - solid.hx).toBeGreaterThanOrEqual(-LABITCONF.W / 2);
    // Well clear of the double door (local x DOOR0..DOOR1) and its approach.
    expect(TOTEM.X + solid.hx).toBeLessThan(LABITCONF.DOOR0 - 0.3);
  });

  it('keeps off the cobbled path to the door, the plaza’s paving and its lanterns, and clear of the obelisk', () => {
    const { plan, s, slots, corners, centre, toScreen, m } = placed();
    // The road leaves the door two half-metre cells wide (world.ts layPaths), toward the plaza (the screen frame's +z).
    const door = toScreen(s.door);
    expect(m.solid.hx).toBeLessThan(door.x - 0.1);
    for (const p of corners) expect(Math.hypot(p.x - plan.plaza.c.x, p.z - plan.plaza.c.z)).toBeGreaterThan(plan.plaza.r);
    // Room to walk between the stand and every lantern still standing (buildPlaza drops those on a landmark’s lawn).
    for (const l of plazaLanterns(plan).filter((p) => !onLandmarkLawn(p, slots))) {
      const dx = Math.max(0, Math.abs(l.x - centre.x) - m.solid.hx), dz = Math.max(0, Math.abs(l.z - centre.z) - m.solid.hz);
      expect(Math.hypot(dx, dz)).toBeGreaterThan(0.3);
    }
    expect(Math.hypot(centre.x - plan.plaza.c.x, centre.z - plan.plaza.c.z)).toBeGreaterThan(obeliskShape(8).base + 1);
  });

  it('keeps its stand clear of every other slot and off the pond and the river banks', () => {
    const { plan, s, corners } = placed();
    for (const o of plan.slots) {
      if (o.index === s.index) continue;
      for (const p of corners) expect(Math.max(Math.abs(p.x - o.pos.x), Math.abs(p.z - o.pos.z))).toBeGreaterThan(o.w / 2 + 0.3);
    }
    const river = smoothRiver(plan);
    for (const p of corners) {
      expect(Math.hypot(p.x - plan.pond.c.x, p.z - plan.pond.c.z)).toBeGreaterThan(plan.pond.r + 0.65);
      expect(distToPolyline(p, river)).toBeGreaterThan(plan.riverWidth * 0.62 + 0.3 + 0.5);
    }
  });

  it('leaves the ground in front of the screen walkable (the grid, the stand and LABITCONF’s own solids, with the player’s 0.18 m clearance)', () => {
    const { plan, d, toWorld, m } = placed();
    const grid = buildNavGrid(plan, plan.slots);
    const pad = 0.18;
    // Monitor-local solids (the stand, LABITCONF's furniture) and the building itself.
    const local = [{ ...m.solid, x: TOTEM.X + m.solid.x, z: TOTEM.Z + m.solid.z }, ...(d.build().solids ?? [])];
    const f = d.footprint;
    const z = (TOTEM.ZONE.front + TOTEM.ZONE.depth) / 2;
    for (const x of [-TOTEM.W / 2 + pad, 0, TOTEM.W / 2 - pad]) {
      expect(inTotemZone({ x, z })).toBe(true);
      const lx = TOTEM.X + x, lz = TOTEM.Z + z;
      for (const so of local) expect(Math.abs(lx - so.x) > so.hx + pad || Math.abs(lz - so.z) > so.hz + pad).toBe(true);
      expect(lz).toBeGreaterThan(f.maxZ + pad);
      for (const [ox, oz] of [[0, 0], [pad, 0], [-pad, 0], [0, pad], [0, -pad]]) expect(grid.isWalkable(toWorld(lx + ox, lz + oz))).toBe(true);
    }
  });

  it('keeps the plaza’s lanterns out from in front of the screen: LABITCONF’s lawn reaches past its watch zone, and no other lantern goes', () => {
    const { plan, slots, toScreen } = placed();
    const others = LANDMARKS.filter((x) => x.id !== 'labitconf');
    let inFront = 0;
    // The ring of lanterns round the plaza (world.ts buildPlaza), each dropped on a landmark's lawn.
    for (const l of plazaLanterns(plan)) {
      const front = inTotemZone(toScreen(l), TOTEM.ZONE.pad);
      if (front) inFront++;
      expect(onLandmarkLawn(l, slots)).toBe(front || onLandmarkLawn(l, slots, others));
    }
    expect(inFront).toBe(1); // the one that stood between the plaza and the screen
  });
});

describe('the totem’s screen in the village', () => {
  it('paints a still look of the totem, never an instruction', () => {
    const said: string[] = [];
    const g = new Proxy({} as CanvasRenderingContext2D, {
      get: (_t, k) => (k === 'fillText' ? (t: string) => said.push(t) : k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => {}),
      set: () => true,
    });
    drawTotemCard(g, 1024, 576);
    // A still of the page, not a sign: it never tells you what to do (the prompt does, in your language).
    expect(said.join(' ')).not.toMatch(/acerc|closer|approach|walk|tap|press|apret|click/i);
  });

});

describe('walking up to the totem', () => {
  // Monitor-local: x across the screen, z out of its face (+z toward the plaza).
  it('is the ground right in front of the screen, as wide as it', () => {
    expect(inTotemZone({ x: 0, z: 0.6 })).toBe(true);
    expect(inTotemZone({ x: TOTEM.W / 2 - 0.05, z: 0.4 })).toBe(true);
    // Beside it, behind it, or back at the plaza: not.
    expect(inTotemZone({ x: TOTEM.W / 2 + 0.3, z: 0.6 })).toBe(false);
    expect(inTotemZone({ x: 0, z: -0.4 })).toBe(false);
    expect(inTotemZone({ x: 0, z: TOTEM.ZONE.depth + 0.2 })).toBe(false);
    // Padded, a little wider all round.
    expect(inTotemZone({ x: 0, z: TOTEM.ZONE.depth + 0.2 }, TOTEM.ZONE.pad)).toBe(true);
  });

  it('keeps clear of the road to LABITCONF’s door and the plaza’s middle (passers-by don’t get focused)', () => {
    const { plan, s, toScreen } = placed();
    // The road: two half-metre cells from the door (world.ts layPaths) out toward the plaza, in the screen's frame.
    const door = toScreen(s.door);
    for (let z = door.z; z <= TOTEM.ZONE.depth + TOTEM.ZONE.pad; z += 0.25) for (const x of [0.05, 0.5, 0.95]) expect(inTotemZone({ x: door.x + x, z })).toBe(false);
    expect(inTotemZone(toScreen(plan.plaza.c), TOTEM.ZONE.pad)).toBe(false);
  });

});

describe('the live totem on the monitor', () => {
  it('is on within VIEW_M of the camera and off past VIEW_M + VIEW_PAD (no flicker at the edge)', () => {
    expect(totemInView(TOTEM.VIEW_M - 0.1, false)).toBe(true);
    expect(totemInView(TOTEM.VIEW_M + 0.5, false)).toBe(false);
    expect(totemInView(TOTEM.VIEW_M + 0.5, true)).toBe(true);
    expect(totemInView(TOTEM.VIEW_M + TOTEM.VIEW_PAD + 0.1, true)).toBe(false);
  });

  function view() {
    const { group, screen } = buildTotemMonitor();
    group.position.set(0, 0, -3);
    group.updateMatrixWorld(true);
    const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.08, 100);
    camera.position.set(0, 1.4, 3);
    camera.lookAt(new THREE.Vector3(0, TOTEM.Y, -3));
    camera.updateMatrixWorld(true);
    const wall = new THREE.Mesh(new THREE.BoxGeometry(4, 4, 0.2), new THREE.MeshBasicMaterial());
    wall.position.set(0, 1.5, 0);
    wall.updateMatrixWorld(true);
    return { screen, camera, wall };
  }

  it('sees the screen when nothing stands between it and the camera, not when a building does', () => {
    const { screen, camera, wall } = view();
    expect(new OcclusionProbe().clear(1, camera, screen, [])).toBe(true);
    expect(new OcclusionProbe().clear(1, camera, screen, [wall])).toBe(false);
    // A post off to the side hides one corner only: still hidden (the page would cover it).
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 4, 0.1), new THREE.MeshBasicMaterial());
    post.position.set(-0.7, 1, -2.2);
    post.updateMatrixWorld(true);
    expect(new OcclusionProbe().clear(1, camera, screen, [post])).toBe(false);
    // Glows (sprites) are light, not walls: they never hide it, and probing them doesn't throw.
    const glow = new THREE.Sprite(new THREE.SpriteMaterial());
    glow.position.set(0, 1.4, 0);
    glow.scale.setScalar(2);
    glow.updateMatrixWorld(true);
    expect(new OcclusionProbe().clear(1, camera, screen, [glow])).toBe(true);
  });

  it('looks a few times a second, keeping the last answer in between', () => {
    const { screen, camera, wall } = view();
    const probe = new OcclusionProbe();
    expect(probe.clear(1, camera, screen, [])).toBe(true);
    expect(probe.clear(TOTEM.PROBE_S / 4, camera, screen, [wall])).toBe(true);
    expect(probe.clear(TOTEM.PROBE_S, camera, screen, [wall])).toBe(false);
  });

  function stageSetup() {
    const parent = document.createElement('div');
    const canvas = document.createElement('canvas');
    parent.append(canvas, document.createElement('div'));
    const v = view();
    const stage = new TotemStage(parent, canvas, v.screen, TOTEM.W, TOTEM.H);
    stage.setSize(800, 450);
    return { parent, canvas, stage, ...v };
  }

  it('opens totemcillo in view, hides it (page kept) while hidden, drops it (and its connections) out of range', () => {
    const { parent, canvas, camera, stage } = stageSetup();
    const layer = canvas.nextElementSibling as HTMLElement;
    stage.update(camera, false, true);
    expect(parent.querySelectorAll('iframe')).toHaveLength(0);
    stage.update(camera, true, true);
    const f = parent.querySelector('iframe')!;
    expect(f.src).toBe(TOTEM_URL);
    // The page's layout viewport is PAGE_VIEWPORT, and so is the box DomScreen scales onto the screen.
    const holder = f.parentElement as HTMLElement;
    expect([f.style.width, f.style.height, holder.style.width, holder.style.height]).toEqual([`${PAGE_VIEWPORT.W}px`, `${PAGE_VIEWPORT.H}px`, `${PAGE_VIEWPORT.W}px`, `${PAGE_VIEWPORT.H}px`]);
    expect(layer.style.display).toBe('');
    expect(stage.live).toBe(true);
    // Hidden by a building: the 3D card shows, the page keeps running.
    stage.update(camera, true, false);
    expect(layer.style.display).toBe('none');
    expect(parent.querySelectorAll('iframe')).toHaveLength(1);
    // Out of range (or focus mode has the page): gone.
    stage.update(camera, false, true);
    expect(parent.querySelectorAll('iframe')).toHaveLength(0);
    expect(stage.live).toBe(false);
  });

  it('draws totemcillo’s desktop view (wider than its 700 px phone breakpoint) on a 16:9 screen of the same shape', () => {
    expect(PAGE_VIEWPORT.W).toBeGreaterThan(700);
    expect(TOTEM.W / TOTEM.H).toBeCloseTo(16 / 9, 5);
    expect(PAGE_VIEWPORT.W / PAGE_VIEWPORT.H).toBeCloseTo(TOTEM.W / TOTEM.H, 9);
  });
});
