// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildHalloweenCorner, HALLOWEEN_SIGN, TALK_RADIUS } from './halloween';
import { laCryptaGround, LA_CRYPTA_RESIDENT, LA_CRYPTA_STAIRS } from './lacrypta';
import { LANDMARKS } from './landmarks';

const lacrypta = LANDMARKS.find((d) => d.id === 'lacrypta')!;
const inSolid = (p: { x: number; z: number }, s: { x: number; z: number; hx: number; hz: number }, pad = 0) =>
  Math.abs(p.x - s.x) < s.hx + pad && Math.abs(p.z - s.z) < s.hz + pad;

describe('Halloween at La Crypta’s door', () => {
  const h = buildHalloweenCorner();

  it('stands La Crypta on the street, off the steps, in front of the house', () => {
    expect(laCryptaGround(LA_CRYPTA_RESIDENT)).toBe(0);
    expect(LA_CRYPTA_RESIDENT.z).toBeGreaterThan(lacrypta.footprint.maxZ + 1);
    for (const p of LA_CRYPTA_STAIRS.path) expect(Math.hypot(p.x - LA_CRYPTA_RESIDENT.x, p.z - LA_CRYPTA_RESIDENT.z)).toBeGreaterThan(0.5);
    // Visitors walk to the foot of the steps: not on top of the resident.
    const door = { x: LA_CRYPTA_STAIRS.foot.x, z: LA_CRYPTA_STAIRS.foot.z + 0.25 }; // doorLocal: just out from the steps' foot
    expect(Math.hypot(door.x - LA_CRYPTA_RESIDENT.x, door.z - LA_CRYPTA_RESIDENT.z)).toBeGreaterThan(0.6);
  });

  it('keeps its solids off the steps, the resident and the walk to the door', () => {
    const door = { x: LA_CRYPTA_STAIRS.foot.x, z: LA_CRYPTA_STAIRS.foot.z + 0.25 }; // doorLocal: just out from the steps' foot
    for (const s of h.solids) {
      for (const p of LA_CRYPTA_STAIRS.path) expect(inSolid(p, s, 0.25), `${JSON.stringify(s)} on the steps`).toBe(false);
      expect(inSolid(LA_CRYPTA_RESIDENT, s, 0.2)).toBe(false);
      expect(inSolid({ x: door.x, z: door.z }, s, 0.3)).toBe(false);
    }
  });

  it('puts the sign within talking range, beside the resident', () => {
    const d = Math.hypot(HALLOWEEN_SIGN.x - LA_CRYPTA_RESIDENT.x, HALLOWEEN_SIGN.z - LA_CRYPTA_RESIDENT.z);
    expect(d).toBeGreaterThan(0.4);
    expect(d).toBeLessThan(TALK_RADIUS);
  });

  it('adds no lights and glows brighter when you come close', () => {
    let lights = 0;
    h.group.traverse((o) => { if ((o as THREE.Light).isLight) lights++; });
    expect(lights).toBe(0);
    const veil = (h.group.getObjectByName('aura')!.children[0].children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial;
    h.update(0.1, 1, false);
    const far = veil.opacity;
    for (let i = 0; i < 20; i++) h.update(0.1, 1, true);
    expect(veil.opacity).toBeGreaterThan(far + 0.05);
  });
});
