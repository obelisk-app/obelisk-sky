import { describe, it, expect } from 'vitest';
import { stepPet, petLift, FLY_HEIGHT, type PetMotion } from './pet';

const pet = (): PetMotion => ({ x: 0, z: -1, yaw: 0, vel: 0, anim: 'idle' });

describe('a pet following its owner', () => {
  it('settles at its owner’s running pace instead of lagging and lunging', () => {
    const m = pet();
    const anims: string[] = [];
    let ownerZ = 0;
    for (let i = 0; i < 600; i++) {
      ownerZ += 2.6 / 60;
      stepPet(m, { x: 0, z: ownerZ }, 1 / 60);
      if (i > 120) anims.push(m.anim);
    }
    expect(Math.abs(m.vel - 2.6)).toBeLessThan(0.1);
    expect(ownerZ - m.z).toBeLessThan(1.2);
    expect(new Set(anims)).toEqual(new Set(['run'])); // no walk/run flicker
  });

  it('walks at a walking owner’s pace, close behind', () => {
    const m = pet();
    let ownerZ = 0;
    for (let i = 0; i < 600; i++) { ownerZ += 0.78 / 60; stepPet(m, { x: 0, z: ownerZ }, 1 / 60); }
    expect(m.anim).toBe('walk');
    expect(ownerZ - m.z).toBeLessThan(0.5);
  });

  it('comes to rest at the heel and turns smoothly, not in a snap', () => {
    const m = pet();
    for (let i = 0; i < 300; i++) stepPet(m, { x: 0, z: 0 }, 1 / 60);
    expect(m.anim).toBe('idle');
    const m2: PetMotion = { x: 0, z: 0, yaw: 0, vel: 0, anim: 'idle' };
    stepPet(m2, { x: -3, z: 0 }, 1 / 60);
    stepPet(m2, { x: -3, z: 0 }, 1 / 60);
    expect(Math.abs(m2.yaw)).toBeLessThan(Math.PI / 2 * 0.5); // still turning toward −x
  });
});

describe('a pet’s hop', () => {
  it('follows the pet’s own clock: the same frames give the same heights, however long they took', () => {
    // Two runs of the same 24 fps frames: the hop depends on the summed dt alone.
    const heights = () => { let t = 0; const out: number[] = []; for (let i = 0; i < 48; i++) { t += 1 / 24; out.push(petLift(t, 0.9, false, false)); } return out; };
    expect(heights()).toEqual(heights());
  });

  it('moves smoothly from frame to frame while walking, and stays down standing still', () => {
    let t = 0, prev = petLift(0, 0.9, false, false), worst = 0;
    for (let i = 0; i < 240; i++) { t += 1 / 60; const y = petLift(t, 0.9, false, false); worst = Math.max(worst, Math.abs(y - prev)); prev = y; }
    expect(worst).toBeLessThan(0.006);
    expect(petLift(1.234, 0, false, false)).toBe(0);
    expect(petLift(1.234, 2, false, true)).toBe(0); // the nostrich walks on its legs
  });

  it('keeps a flier hovering near its height', () => {
    for (let t = 0; t < 5; t += 0.1) expect(Math.abs(petLift(t, 0, true, false, 3) - FLY_HEIGHT)).toBeLessThanOrEqual(0.06);
  });
});
