import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { chooseLights, lampLevel, lightBudget, LightScan, scanOnChange, STREET_LAMP, type LightSpot } from './lightBudget';
import { DAY, NIGHT } from './sky';

const at = (x: number, kind: 'point' | 'spot' = 'point', lit = true): LightSpot => ({ x, y: 0, z: 0, kind, lit });

describe('the light budget', () => {
  it('keeps the lit lights nearest where you look', () => {
    const lights = [at(10), at(1), at(5), at(2), at(30)];
    expect([...chooseLights(lights, { x: 0, y: 0, z: 0 }, { point: 2, spot: 0 })].sort()).toEqual([1, 3]);
  });

  it('prefers lit lights, then pads with dark ones so the count never changes', () => {
    const lights = [at(1, 'point', false), at(8, 'point', true), at(2, 'point', false)];
    const keep = chooseLights(lights, { x: 0, y: 0, z: 0 }, { point: 2, spot: 0 });
    expect(keep.has(1)).toBe(true);
    expect(keep.size).toBe(2);
    // Same count by day and by night: no shader recompiles.
    const day = chooseLights(lights.map((l) => ({ ...l, lit: false })), { x: 0, y: 0, z: 0 }, { point: 2, spot: 0 });
    expect(day.size).toBe(keep.size);
  });

  it('budgets point and spot lights separately', () => {
    const lights = [at(1, 'spot'), at(2, 'spot'), at(3), at(4), at(5)];
    const keep = chooseLights(lights, { x: 0, y: 0, z: 0 }, { point: 2, spot: 1 });
    expect([...keep].sort()).toEqual([0, 2, 3]);
  });

  it('gives phones and low quality fewer lights', () => {
    expect(lightBudget(true, 'high').point).toBeLessThan(lightBudget(false, 'high').point);
    expect(lightBudget(false, 'low').point).toBeLessThan(lightBudget(false, 'medium').point);
  });
});

describe('street lamps', () => {
  it('are off by day, fully on from early dusk, and rise smoothly between', () => {
    expect(lampLevel(0)).toBe(0);
    expect(lampLevel(0.1)).toBe(0);
    expect(lampLevel(0.45)).toBe(1);
    expect(lampLevel(1)).toBe(1);
    let last = 0;
    for (let n = 0; n <= 1; n += 0.01) {
      const v = lampLevel(n);
      expect(v).toBeGreaterThanOrEqual(last);
      expect(v - last).toBeLessThan(0.07);
      last = v;
    }
  });
});

describe('looking for new lights', () => {
  it('rescans on the frame a lamp is added, not 3 s later', () => {
    const scan = new LightScan(3);
    const scene = new THREE.Scene();
    const root = new THREE.Group();
    scene.add(root);
    scanOnChange(scan, [scene, root]);
    expect(scan.due(0)).toBe(true); // the first frame always looks
    expect(scan.due(0.016)).toBe(false);
    root.add(new THREE.PointLight());
    expect(scan.due(0.032)).toBe(true); // the same frame
    expect(scan.due(0.048)).toBe(false);
    const house = new THREE.Group();
    house.add(new THREE.PointLight());
    root.add(house); // a house with its lamp
    expect(scan.due(0.064)).toBe(true);
    root.remove(house);
    expect(scan.due(0.08)).toBe(true);
    // Nothing added: the backstop every 3 s.
    expect(scan.due(3)).toBe(false);
    expect(scan.due(3.1)).toBe(true);
  });
});

describe('a street lamp at night', () => {
  const lum = (c: THREE.Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  const lamp = new THREE.Color(0xffb45a);
  // Light on the cobbles at `d` metres from the bulb (physical: candela / d^decay).
  const at = (d: number) => (lum(lamp) * STREET_LAMP.cd) / d ** STREET_LAMP.decay;
  const noon = lum(DAY.sun) * DAY.sunI;
  const moon = lum(NIGHT.sun) * NIGHT.sunI + lum(NIGHT.hemiSky) * NIGHT.hemiI;

  it('lights a pool under it dimmer than the noon sun (the plaza burnt orange-white)', () => {
    expect(at(0.95)).toBeLessThan(noon);
    expect(at(0.95)).toBeGreaterThan(moon);
  });
  it('fades to under the moonlight a couple of metres out, and to nothing at its reach', () => {
    expect(at(2)).toBeLessThan(moon);
    expect(at(STREET_LAMP.distance)).toBeLessThan(0.05);
  });
});
