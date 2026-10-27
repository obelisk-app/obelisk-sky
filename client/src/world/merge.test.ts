// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { mergeStatic, mergeTogether } from './merge';

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

describe('finding what moves', () => {
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
      const moving = findDynamic(b.group, poke);
      const before = meshes(b.group).length;
      mergeStatic(b.group, (m) => moving.has(m) || m.name === 'roof');
      expect(meshes(b.group).length).toBeLessThan(before);
      // Every mesh the hooks still move survived the merge.
      for (const m of moving) if ((m as THREE.Mesh).isMesh) expect(m.parent).not.toBeNull();
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
