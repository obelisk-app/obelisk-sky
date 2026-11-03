// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { materialSig, materialsIn, mergeStatic, mergeTogether, mergeToggling, mergeWithinMoving } from './merge';

const meshes = (o: THREE.Object3D) => { const out: THREE.Mesh[] = []; o.traverse((x) => { if ((x as THREE.Mesh).isMesh) out.push(x as THREE.Mesh); }); return out; };
const worldBox = (o: THREE.Object3D) => { o.updateMatrixWorld(true); return new THREE.Box3().setFromObject(o); };

describe('merging static pieces', () => {
  it('folds pieces sharing a material into one mesh, in the same place', () => {
    const root = new THREE.Group();
    root.position.set(5, 0, -2);
    root.rotation.y = 0.7;
    const wood = new THREE.MeshStandardMaterial(), stone = new THREE.MeshStandardMaterial();
    const geo = new THREE.BoxGeometry(1, 1, 1);
    for (let i = 0; i < 6; i++) {
      const sub = new THREE.Group();
      sub.position.set(i, 0, 0);
      const m = new THREE.Mesh(geo, i % 2 ? wood : stone);
      m.position.y = i * 0.5;
      m.castShadow = true;
      sub.add(m);
      root.add(sub);
    }
    const before = worldBox(root);
    expect(mergeStatic(root)).toBe(4);
    const ms = meshes(root);
    expect(ms).toHaveLength(2);
    expect(new Set(ms.map((m) => m.material))).toEqual(new Set([wood, stone]));
    expect(ms.every((m) => m.castShadow)).toBe(true);
    const after = worldBox(root);
    expect(after.min.distanceTo(before.min)).toBeLessThan(1e-6);
    expect(after.max.distanceTo(before.max)).toBeLessThan(1e-6);
  });

  it('leaves alone what must stay separate: kept, hidden, mirrored, instanced', () => {
    const root = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial();
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const roof = new THREE.Mesh(geo, mat); roof.name = 'roof';
    const hiddenWin = new THREE.Mesh(geo, mat); hiddenWin.visible = false;
    const mirrored = new THREE.Mesh(geo, mat); mirrored.scale.x = -1;
    const inst = new THREE.InstancedMesh(geo, mat, 3);
    const a = new THREE.Mesh(geo, mat), b = new THREE.Mesh(geo, mat);
    b.position.x = 2;
    root.add(roof, hiddenWin, mirrored, inst, a, b);
    expect(mergeStatic(root, (m) => m.name === 'roof')).toBe(1);
    expect(roof.parent).toBe(root);
    expect(hiddenWin.parent).toBe(root);
    expect(mirrored.parent).toBe(root);
    expect(inst.parent).toBe(root);
    expect(a.parent).toBeNull();
  });
});

describe('merging by look', () => {
  const flat = (color: number, o: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, flatShading: true, ...o });

  it('folds pieces made with a fresh material each into one mesh, colours kept per vertex', () => {
    const root = new THREE.Group();
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const colors = [0xff0000, 0x00ff00, 0xff0000, 0x0000ff];
    colors.forEach((c, i) => { const m = new THREE.Mesh(geo, flat(c)); m.position.x = i * 2; root.add(m); });
    const before = worldBox(root);
    expect(mergeStatic(root, () => false, { live: new Set() })).toBe(3);
    const [m] = meshes(root);
    const mat = m.material as THREE.MeshStandardMaterial;
    expect(mat.vertexColors).toBe(true);
    expect(mat.color.getHex()).toBe(0xffffff);
    expect(mat.flatShading).toBe(true);
    // Each box's vertices carry its own colour (24 vertices a box, in order).
    const col = m.geometry.attributes.color;
    colors.forEach((c, i) => {
      const want = new THREE.Color(c);
      expect([col.getX(i * 24), col.getY(i * 24), col.getZ(i * 24)]).toEqual([want.r, want.g, want.b]);
    });
    const after = worldBox(root);
    expect(after.min.distanceTo(before.min)).toBeLessThan(1e-6);
    expect(after.max.distanceTo(before.max)).toBeLessThan(1e-6);
  });

  it('keeps one material when the look-alikes share a colour', () => {
    const root = new THREE.Group();
    const geo = new THREE.BoxGeometry(1, 1, 1);
    for (let i = 0; i < 3; i++) root.add(new THREE.Mesh(geo, flat(0x336699)));
    expect(mergeStatic(root, () => false, { live: new Set() })).toBe(2);
    const mat = meshes(root)[0].material as THREE.MeshStandardMaterial;
    expect(mat.vertexColors).toBe(false);
    expect(mat.color.getHex()).toBe(0x336699);
  });

  it('never merges by look what changes, is see-through, looks different or without opting in', () => {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const glow = flat(0xffffff, { emissive: 0xffaa00 });
    const make = () => {
      const root = new THREE.Group();
      root.add(
        new THREE.Mesh(geo, glow), new THREE.Mesh(geo, flat(0xff0000, { emissive: 0xffaa00 })), // glow is live
        new THREE.Mesh(geo, flat(0xff0000, { transparent: true, opacity: 0.5 })), new THREE.Mesh(geo, flat(0x00ff00, { transparent: true, opacity: 0.5 })),
        new THREE.Mesh(geo, flat(0xff0000, { roughness: 0.2 })), new THREE.Mesh(geo, flat(0x00ff00, { roughness: 0.9 })),
      );
      return root;
    };
    const root = make();
    expect(mergeStatic(root, () => false, { live: new Set([glow]) })).toBe(0);
    expect(meshes(root).some((m) => m.material === glow)).toBe(true);
    expect(mergeStatic(make())).toBe(0); // no opt-in: by identity only, as before
  });

  it('tells materials apart by their settings, not their identity', () => {
    expect(materialSig(flat(0xff0000))).toBe(materialSig(flat(0x00ff00)));
    expect(materialSig(flat(0xff0000), true)).not.toBe(materialSig(flat(0x00ff00), true));
    expect(materialSig(flat(0xff0000))).not.toBe(materialSig(flat(0xff0000, { roughness: 0.2 })));
    expect(materialSig(new THREE.MeshBasicMaterial())).not.toBe(materialSig(new THREE.MeshStandardMaterial()));
    const patched = flat(0xff0000); patched.onBeforeCompile = () => {};
    expect(materialSig(patched)).toBeNull();
    expect(materialSig(new THREE.ShaderMaterial())).toBeNull();
  });
});

describe('finding what moves', () => {
  it('reports the materials a hook changes, and meshes whose material it swaps', async () => {
    const { findDynamic } = await import('./merge');
    const root = new THREE.Group();
    const lamp = new THREE.MeshStandardMaterial({ emissiveIntensity: 0 }), wall = new THREE.MeshStandardMaterial(), other = new THREE.MeshStandardMaterial();
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const a = new THREE.Mesh(geo, lamp), b = new THREE.Mesh(geo, wall), c = new THREE.Mesh(geo, wall);
    root.add(a, b, c);
    const live = new Set<THREE.Material>();
    const moving = findDynamic(root, (mark) => { lamp.emissiveIntensity = 1; mark(); lamp.emissiveIntensity = 0; c.material = other; mark(); c.material = wall; }, { materials: live });
    // The lamp's glow changed; the material a hook swapped in counts as changing too; the wall never did.
    expect(live).toEqual(new Set([lamp, other]));
    expect(moving.has(c)).toBe(true);
    expect(moving.has(b)).toBe(false);
  });

  it('merges what is still inside a part that moves as a whole, and it keeps moving', async () => {
    const { findDynamic } = await import('./merge');
    const root = new THREE.Group();
    const door = new THREE.Group(); door.position.set(1, 0, 0); root.add(door);
    const mat = new THREE.MeshStandardMaterial(), geo = new THREE.BoxGeometry(0.1, 1, 0.1);
    for (let i = 0; i < 4; i++) { const m = new THREE.Mesh(geo, mat); m.position.x = i * 0.2; door.add(m); }
    const handle = new THREE.Mesh(geo, mat); door.add(handle); // turns inside the door
    const nodes = new Set<THREE.Object3D>();
    findDynamic(root, (mark) => { door.rotation.y = 1; handle.rotation.z = 0.5; mark(); door.rotation.y = 0; handle.rotation.z = 0; }, { nodes });
    expect(nodes).toEqual(new Set([door, handle]));
    expect(mergeWithinMoving(nodes)).toBe(3);
    expect(handle.parent).toBe(door);
    const merged = door.children.find((c) => c.name === 'merged')!;
    expect(merged.parent).toBe(door);
    door.rotation.y = Math.PI / 2; root.updateMatrixWorld(true);
    // The merged leaf turned with its door.
    const box = new THREE.Box3().setFromObject(merged);
    expect(box.max.x - box.min.x).toBeLessThan(0.2);
  });

  it('merges pieces only ever switched on and off together, and switching one still works', async () => {
    const { findDynamic } = await import('./merge');
    const root = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial(), geo = new THREE.BoxGeometry(1, 1, 1);
    const walls = [0, 1, 2].map((i) => { const m = new THREE.Mesh(geo, mat); m.position.x = i; m.castShadow = true; root.add(m); return m; });
    const lamp = new THREE.Mesh(geo, mat); lamp.position.z = 3; root.add(lamp); // hidden at other steps than the walls
    const setInside = (on: boolean) => { for (const w of walls) { w.castShadow = !on; w.visible = !on; } };
    const toggles = new Map<THREE.Object3D, string>();
    findDynamic(root, (mark) => { setInside(true); mark(); setInside(false); lamp.visible = false; mark(); lamp.visible = true; }, { toggles });
    expect(new Set(toggles.keys())).toEqual(new Set([...walls, lamp]));
    expect(mergeToggling(toggles)).toBe(2);
    const merged = meshes(root).filter((m) => m.name === 'merged-toggle');
    expect(merged).toHaveLength(1);
    expect(lamp.parent).toBe(root);
    // The landmark's own code, holding its walls, still hides them and their shadows.
    setInside(true);
    expect(merged[0].visible).toBe(false);
    expect(merged[0].castShadow).toBe(false);
    setInside(false);
    expect(merged[0].visible).toBe(true);
    expect(merged[0].castShadow).toBe(true);
    expect(walls[1].castShadow).toBe(true);
  });

  it('collects the materials a build hands out besides its group', () => {
    const shared = new THREE.MeshStandardMaterial(), inGroup = new THREE.MeshStandardMaterial(), screenMat = new THREE.MeshBasicMaterial();
    const group = new THREE.Group(); group.add(new THREE.Mesh(new THREE.BoxGeometry(), inGroup));
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(), screenMat);
    const out = materialsIn({ group, screen, hall: { lights: [shared] }, seats: [{ pos: { x: 0, z: 0 } }] });
    expect(out).toEqual(new Set([screenMat, shared]));
  });

  it('reports meshes a hook moves, hides or unshadows, and everything under a moving node', async () => {
    const { findDynamic } = await import('./merge');
    const root = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial();
    const box = () => new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat);
    const still = box(), spun = box(), hidden = box(), wall = box();
    const door = new THREE.Group();
    const leaf = box(), knob = box();
    door.add(leaf, knob);
    wall.castShadow = true;
    root.add(still, spun, hidden, wall, door);
    const moving = findDynamic(root, () => {
      spun.rotation.y = 1;
      hidden.visible = false;
      wall.castShadow = false;
      door.rotation.y = 1.4;
      mat.opacity = 0.3; // a material change is shared, merged or not
    });
    expect(moving.has(still)).toBe(false);
    for (const m of [spun, hidden, wall, leaf, knob]) expect(moving.has(m)).toBe(true);
  });

  it('reports a door that is opened and closed again during the poke', async () => {
    const { findDynamic } = await import('./merge');
    const root = new THREE.Group();
    const glass = new THREE.MeshStandardMaterial();
    const pane = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), glass);
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), glass);
    root.add(pane, leaf);
    const moving = findDynamic(root, (mark) => { leaf.position.x = 0.8; mark(); leaf.position.x = 0; });
    expect(moving.has(leaf)).toBe(true);
    expect(moving.has(pane)).toBe(false);
    mergeStatic(root, (m) => moving.has(m));
    expect(leaf.parent).toBe(root);
  });

  it('keeps every landmark whole: what it animates stays out of the merge', async () => {
    const { findDynamic } = await import('./merge');
    const { LANDMARKS } = await import('./landmarks');
    const { vi } = await import('vitest');
    // jsdom has no canvas: a 2D context that takes every call and draws nothing.
    const noop: unknown = new Proxy(() => noop, { get: (_t, k) => (k === 'measureText' ? () => ({ width: 0 }) : k === 'getImageData' ? () => ({ data: new Uint8ClampedArray(4) }) : noop), set: () => true, apply: () => noop });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(noop as never);
    for (const d of LANDMARKS) {
      const b = d.build();
      const poke = (mark: () => void = () => {}) => {
        for (const t of [0.4, 2.9, 7.3, 13.1]) { b.update?.(0.016, t); mark(); }
        b.setNight(1, 1); mark();
        b.interior?.setDoor(1); mark();
        b.interior?.setInside(true); mark();
        b.pulse?.(); mark();
        b.update?.(0.5, 17); mark();
        b.interior?.setInside(false);
        b.interior?.setDoor(0);
        b.setNight(0, 1);
      };
      const live = materialsIn(b);
      const nodes = new Set<THREE.Object3D>();
      const toggles = new Map<THREE.Object3D, string>();
      const moving = findDynamic(b.group, poke, { materials: live, nodes, toggles });
      const before = meshes(b.group).length;
      const shown = new Set(meshes(b.group).flatMap((m) => (Array.isArray(m.material) ? m.material : [m.material])));
      mergeStatic(b.group, (m) => moving.has(m) || m.name === 'roof', { live });
      mergeWithinMoving(nodes, (m) => m.name === 'roof' || toggles.has(m), { live });
      mergeToggling(toggles, (m) => m.name === 'roof', { live });
      expect(meshes(b.group).length).toBeLessThan(before);
      // A material a hook changes (or World code is handed) is still on screen itself.
      const after = new Set(meshes(b.group).flatMap((m) => (Array.isArray(m.material) ? m.material : [m.material])));
      for (const m of live) if (shown.has(m)) expect(after.has(m), `${d.id}: ${m.type} ${m.name}`).toBe(true);
      // Every node the hooks move themselves survived the merge (only shown, hidden or shadowed ones may be folded).
      for (const m of nodes) if (!toggles.has(m) || m.parent) expect(m.parent, `${d.id}: ${m.name}`).not.toBeNull();
      // And a folded piece still shows, hides and shadows what replaced it.
      for (const m of toggles.keys()) {
        if (m.parent) continue;
        const was = m.visible;
        m.visible = !was;
        const into = meshes(b.group).filter((x) => x.name === 'merged-toggle' && x.visible === !was);
        expect(into.length, `${d.id}: folded piece toggles its merged mesh`).toBeGreaterThan(0);
        m.visible = was;
      }
      // And the hooks still run on what's left.
      expect(() => poke()).not.toThrow();
      // A door still opens: some mesh left in the scene moves when it does.
      if (b.interior) {
        b.group.updateMatrixWorld(true);
        const at = new Map(meshes(b.group).map((m) => [m, m.matrixWorld.elements.slice()]));
        b.interior.setDoor(1);
        b.group.updateMatrixWorld(true);
        const moved = meshes(b.group).some((m) => { const a = at.get(m); return !!a && m.matrixWorld.elements.some((x, i) => Math.abs(x - a[i]) > 1e-6); });
        expect(moved, `${d.id} door`).toBe(true);
        b.interior.setDoor(0);
      }
    }
  });
});

describe('merging panes that light up together', () => {
  it('makes one mesh in the same place, hidden as they were, and toggled as one', () => {
    const root = new THREE.Group();
    root.position.set(3, 0, 1);
    root.rotation.y = 1.1;
    const glow = new THREE.MeshBasicMaterial();
    const geo = new THREE.PlaneGeometry(0.3, 0.3);
    const panes: THREE.Mesh[] = [];
    for (let i = 0; i < 5; i++) {
      const cell = new THREE.Group();
      cell.rotation.y = i * 0.5;
      cell.position.set(i, i * 0.4, 0);
      const pane = new THREE.Mesh(geo, glow);
      pane.position.set(0.5, 0.55, 0);
      pane.visible = false;
      cell.add(pane);
      root.add(cell);
      panes.push(pane);
    }
    root.updateMatrixWorld(true);
    const before = new THREE.Box3();
    for (const p of panes) before.expandByObject(p);
    const out = mergeTogether(root, panes, 'windows');
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('windows');
    expect(out[0].visible).toBe(false);
    expect(panes.every((p) => !p.parent)).toBe(true);
    root.updateMatrixWorld(true);
    const after = new THREE.Box3().setFromObject(out[0], true);
    expect(after.min.distanceTo(before.min)).toBeLessThan(1e-5);
    expect(after.max.distanceTo(before.max)).toBeLessThan(1e-5);
  });

  it('leaves them as they were when there is nothing to merge or they differ', () => {
    const root = new THREE.Group();
    const one = [new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial())];
    root.add(one[0]);
    expect(mergeTogether(root, one, 'w')).toBe(one);
    const two = [new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial()), new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial())];
    root.add(...two);
    expect(mergeTogether(root, two, 'w')).toBe(two);
  });
});
