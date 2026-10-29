import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { MUSHROOM, MagicMushrooms, PER_SPOT, TRIP, Trip, spreadPick } from './mushrooms';
import { Grade } from './post';

describe('the trip', () => {
  it('comes up, holds, and wears off', () => {
    const t = new Trip();
    expect(t.level(10)).toBe(0);
    t.begin(10);
    expect(t.level(10)).toBe(0);
    expect(t.level(10 + TRIP.ONSET_S / 2)).toBeGreaterThan(0);
    expect(t.level(10 + TRIP.ONSET_S / 2)).toBeLessThan(1);
    expect(t.level(10 + TRIP.ONSET_S)).toBe(1);
    expect(t.level(10 + TRIP.PEAK_S - 1)).toBe(1);
    const down = t.level(10 + (TRIP.PEAK_S + TRIP.END_S) / 2);
    expect(down).toBeGreaterThan(0);
    expect(down).toBeLessThan(1);
    expect(t.level(10 + TRIP.END_S)).toBe(0);
    expect(t.level(5)).toBe(0);
  });

  it('another mushroom while it’s on keeps it at its height; while coming up changes nothing', () => {
    const t = new Trip();
    t.begin(0);
    t.begin(2);
    expect(t.level(TRIP.ONSET_S)).toBe(1);
    const late = TRIP.PEAK_S + 10;
    expect(t.level(late)).toBeLessThan(1);
    t.begin(late);
    expect(t.level(late)).toBe(1);
    expect(t.level(late + TRIP.PEAK_S - TRIP.ONSET_S - 1)).toBe(1);
  });

  it('is drawn by the colour grade', () => {
    expect(Grade.uniforms.uTrip.value).toBe(0);
    expect(Grade.fragmentShader).toContain('uniform sampler2D tDiffuse; uniform float uSat, uContrast, uVignette, uTrip, uTime;');
  });
});

describe('where the rings grow', () => {
  it('picks up to n spots, spread out, the same every time', () => {
    const pts = [{ x: 0, z: 0 }, { x: 0.5, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 0.4 }, { x: 0, z: 10 }, { x: 5, z: 5 }];
    const a = spreadPick(pts, 3, () => 0);
    expect(a).toEqual(spreadPick(pts, 3, () => 0));
    expect(new Set(a).size).toBe(3);
    // Far apart: no two of the close pairs.
    expect(a.includes(0) && a.includes(1)).toBe(false);
    expect(a.includes(2) && a.includes(3)).toBe(false);
    expect(spreadPick(pts, 10, () => 0.5)).toHaveLength(pts.length);
    expect(spreadPick([], 3, () => 0)).toEqual([]);
  });
});

describe('the magic mushrooms', () => {
  const spots = [{ x: 0, z: 0, y: 0.01, rot: 0 }, { x: 5, z: 0, y: 0, rot: 1 }];
  const scaleOf = (m: THREE.InstancedMesh, i: number) => {
    const mat = new THREE.Matrix4();
    m.getMatrixAt(i, mat);
    return new THREE.Vector3().setFromMatrixScale(mat).x;
  };

  it('are within reach only up close', () => {
    const mm = new MagicMushrooms(spots);
    expect(mm.near({ x: 0.3, z: 0.2 })).toBe(0);
    expect(mm.near({ x: 4.6, z: 0 })).toBe(1);
    expect(mm.near({ x: 2.5, z: 0 })).toBe(-1);
    expect(mm.near({ x: MUSHROOM.REACH + 0.05, z: 0 })).toBe(-1);
  });

  it('once eaten are gone, and grow back', () => {
    const mm = new MagicMushrooms(spots);
    const meshes = mm.group.children as THREE.InstancedMesh[];
    expect(meshes).toHaveLength(2);
    expect(scaleOf(meshes[0], 0)).toBeGreaterThan(1);
    expect(mm.eat(0, 100)).toBe(true);
    expect(mm.eat(0, 101)).toBe(false);
    expect(mm.near({ x: 0.1, z: 0 })).toBe(-1);
    for (const m of meshes) for (let j = 0; j < PER_SPOT; j++) expect(scaleOf(m, j)).toBe(0);
    expect(scaleOf(meshes[0], PER_SPOT)).toBeGreaterThan(0); // the other spot stays
    mm.update(100 + MUSHROOM.REGROW_S - 1);
    expect(mm.near({ x: 0.1, z: 0 })).toBe(-1);
    mm.update(100 + MUSHROOM.REGROW_S);
    expect(mm.near({ x: 0.1, z: 0 })).toBe(0);
    expect(scaleOf(meshes[0], 0)).toBeGreaterThan(1);
  });

  it('stand on the ground they were given', () => {
    const mm = new MagicMushrooms(spots);
    const mat = new THREE.Matrix4();
    (mm.group.children[0] as THREE.InstancedMesh).getMatrixAt(0, mat);
    expect(new THREE.Vector3().setFromMatrixPosition(mat).y).toBeCloseTo(0.01);
  });
});

describe('the trip on the wall clock', () => {
  it('is over 85 s after eating, however few frames were drawn', () => {
    const t = new Trip();
    const start = 1_700_000_000;
    t.begin(start);
    expect(t.level(start + TRIP.PEAK_S - 1)).toBe(1);
    expect(t.level(start + TRIP.END_S)).toBe(0);
    expect(t.level(start + 3600)).toBe(0);
  });
});
