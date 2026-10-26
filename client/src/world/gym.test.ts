// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildGym, gymLights, pickGymChannel, BENCH_TOP, OPENGYM } from './gym';
import { trackLap, TRACK_LANES } from './districts';
import { dist } from './layout';

describe('the gym', () => {
  const sports = () => 'sports' as const;
  const wide = () => 2;
  it('goes to a channel named like a gym, La Crypta\'s first', () => {
    const groups = [
      { id: 'a', name: 'general', kind: 'text' },
      { id: 'b', name: 'Gym talk', kind: 'text' },
      { id: 'c', name: 'La Crypta Fitness', kind: 'text' },
    ];
    expect(pickGymChannel(groups, () => 'plaza', wide)).toBe('c');
    expect(pickGymChannel(groups.slice(0, 2), () => 'plaza', wide)).toBe('b');
  });
  it('falls back to a sports channel, never a voice room, and needs room for the machines', () => {
    expect(pickGymChannel([{ id: 'v', name: 'gym voice', kind: 'voice' }, { id: 'r', name: 'runners', kind: 'text' }], sports, wide)).toBe('r');
    expect(pickGymChannel([{ id: 'g', name: 'gym', kind: 'text' }], sports, () => 1)).toBeNull();
    expect(pickGymChannel([{ id: 'x', name: 'chat', kind: 'text' }], () => 'plaza', wide)).toBeNull();
  });
  it('has machines inside the room, each with a way on, and a ramp in at the door', () => {
    const slot = { index: 0, pos: { x: 0, z: 0 }, rot: 0, w: 2, d: 2, door: { x: 0, z: 1.2 }, yard: { x: 0, z: 2 } };
    const g = buildGym(slot, 0xff0000);
    const room = g.interior.rooms[0];
    expect(g.stations.map((s) => s.kinds[0]).sort()).toEqual(['benchpress', 'curl', 'squat']);
    for (const s of g.stations) {
      for (const p of [s.at, s.approach]) {
        expect(p.x).toBeGreaterThan(room.minX);
        expect(p.x).toBeLessThan(room.maxX);
        expect(p.z).toBeGreaterThan(room.minZ);
        expect(p.z).toBeLessThan(room.maxZ);
      }
    }
    expect(g.stations.find((s) => s.kinds[0] === 'benchpress')!.grip).toBe(BENCH_TOP);
    // Outside 0, inside the floor, and no ledge on the way in.
    expect(g.groundAt({ x: 0, z: 3 })).toBe(0);
    const floor = g.groundAt({ x: 0, z: 0 });
    expect(floor).toBeGreaterThan(0.05);
    let last = g.groundAt({ x: 0, z: 1.8 });
    for (let z = 1.8; z > 0.5; z -= 0.02) {
      const h = g.groundAt({ x: 0, z });
      expect(h - last).toBeLessThan(0.02);
      last = h;
    }
  });
});

describe('track lanes', () => {
  it('runs each lane on its own line, inside to outside', () => {
    const site = { c: { x: 0, z: 0 }, rot: 0 };
    const lanes = Array.from({ length: TRACK_LANES }, (_, i) => trackLap(site, 40, i));
    const r = (pts: { x: number; z: number }[]) => Math.max(...pts.map((p) => Math.abs(p.z)));
    for (let i = 1; i < lanes.length; i++) expect(r(lanes[i])).toBeGreaterThan(r(lanes[i - 1]) + 0.2);
    // Neighbouring runners never share a line.
    expect(Math.min(...lanes[0].map((p) => Math.min(...lanes[1].map((q) => dist(p, q)))))).toBeGreaterThan(0.2);
  });
});

describe('the gym never closes', () => {
  it('keeps its lights on by day and brightens them at night', () => {
    const day = gymLights(0), night = gymLights(1);
    expect(day.lamp).toBeGreaterThan(0);
    expect(day.strip).toBeGreaterThan(0);
    expect(night.lamp).toBeGreaterThan(day.lamp * 2);
    expect(night.strip).toBeGreaterThan(day.strip);
    expect(night.glass).toBeGreaterThan(0);
    expect(gymLights(0.5).lamp).toBeGreaterThan(day.lamp);
  });

  it('hangs strip lights under the ceiling, inside the walls', () => {
    const slot = { pos: { x: 0, z: 0 }, rot: 0, w: 2.4, d: 2, yard: { x: 0, z: 2 } } as never;
    const strips = buildGym(slot, 0x334455).group.children.filter((o) => o.name === 'gym-strip');
    expect(strips).toHaveLength(2);
    for (const s of strips) expect(Math.abs(s.position.z)).toBeLessThan(1);
  });
  it('keeps its glass door out of the merge, so it still slides open', async () => {
    const THREE = await import('three');
    const { findDynamic, mergeStatic } = await import('./merge');
    const slot = { index: 0, pos: { x: 0, z: 0 }, rot: 0, w: 2, d: 2, door: { x: 0, z: 1.2 }, yard: { x: 0, z: 2 } };
    const gb = buildGym(slot, 0x334455);
    // As world.ts builds it.
    const moving = findDynamic(gb.group, (mark) => {
      gb.interior.setDoor(1); mark(); gb.interior.setInside(true); mark(); gb.interior.setInside(false); gb.interior.setDoor(0);
    });
    mergeStatic(gb.group, (m) => moving.has(m) || m.name === 'roof' || m.name === 'gym-glass' || gb.windows.includes(m));
    const all = () => { const out: InstanceType<typeof THREE.Mesh>[] = []; gb.group.traverse((o) => { if ((o as InstanceType<typeof THREE.Mesh>).isMesh) out.push(o as InstanceType<typeof THREE.Mesh>); }); return out; };
    gb.group.updateMatrixWorld(true);
    const at = new Map(all().map((m) => [m, m.matrixWorld.elements.slice()]));
    gb.interior.setDoor(1);
    gb.group.updateMatrixWorld(true);
    expect(all().some((m) => at.get(m)?.some((x, i) => Math.abs(x - m.matrixWorld.elements[i]) > 1e-6))).toBe(true);
    expect(all().filter((m) => m.name === 'gym-glass')).toHaveLength(4);
  });

  it('keeps the sliding door clear of the fixed panes at every opening', () => {
    const gb = buildGym({ pos: { x: 0, z: 0 }, rot: 0, w: 2.4, d: 2 } as never, 0x334455);
    const door = gb.group.getObjectByName('gym-door')!;
    const panes = gb.group.children.filter((o) => o.name === 'gym-glass');
    for (const pane of panes) {
      // The upper rail starts at floor 0.115 + wall 1.25 - rail 0.05.
      expect(new THREE.Box3().setFromObject(pane).max.y).toBeCloseTo(1.315);
    }
    for (let open = 0; open <= 1; open += 0.1) {
      gb.interior.setDoor(open);
      gb.group.updateMatrixWorld(true);
      const doorBox = new THREE.Box3().setFromObject(door);
      for (const pane of panes) expect(doorBox.intersectsBox(new THREE.Box3().setFromObject(pane))).toBe(false);
    }
    // Side panes span the side wall; thickness is reduced along x, not z.
    const side = panes.filter((o) => Math.abs(o.position.x) > 1);
    expect(side).toHaveLength(2);
    for (const pane of side) {
      const size = new THREE.Box3().setFromObject(pane).getSize(new THREE.Vector3());
      expect(size.x).toBeCloseTo(0.032);
      expect(size.z).toBeCloseTo(2);
    }
  });

  it('shows the screen ahead of its bezel from inside the hall', () => {
    const gb = buildGym({ pos: { x: 0, z: 0 }, rot: 0, w: 2.4, d: 2 } as never, 0x334455);
    const screen = gb.group.getObjectByName('gym-screen')!;
    gb.group.updateMatrixWorld(true);
    const origin = new THREE.Vector3(screen.position.x, screen.position.y, 0);
    const hits = new THREE.Raycaster(origin, new THREE.Vector3(0, 0, -1)).intersectObject(gb.group, true);
    expect(hits[0].object).toBe(screen);
  });
});

describe("the gym wears openGym's look", () => {
  it('dark cladding and lime accents, no red brick left', () => {
    const slot = { index: 0, pos: { x: 0, z: 0 }, w: 2, d: 2, rot: 0 } as never;
    const g = buildGym(slot, 0x3355aa);
    const colours = new Set<number>();
    g.group.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (m && !Array.isArray(m) && m.color) colours.add(m.color.getHex());
    });
    expect(colours.has(0xa4553f)).toBe(false);
    expect(colours.has(OPENGYM.panel)).toBe(true);
    expect(colours.has(OPENGYM.lime)).toBe(true);
    // The channel still names the house: its colour stays on the fascia.
    expect(colours.has(0x3355aa)).toBe(true);
  });
});
