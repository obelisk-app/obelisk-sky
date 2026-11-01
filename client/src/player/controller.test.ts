import { describe, it, expect } from 'vitest';
import { PlayerController, placeAt, RUN_SPEED, WALK_SPEED, RIDE_SPEEDS, FOOT_SPEEDS, RIDE_RUN, RIDE_WALK, type Solid } from './controller';
import { NavGrid } from '../world/layout';
import { archHeight, BRIDGE_RISE } from '../world/bridge';

function grid() {
  const g = new NavGrid(10);
  g.mark((p) => p.x > 2 && p.x < 3 && p.z > -5 && p.z < 5, 1); // a wall at x 2..3
  return g;
}

describe('PlayerController', () => {
  it('stops dead for an emote: no coast left to cancel it', () => {
    const g = grid();
    const c = new PlayerController(() => g, { x: 0, z: 0 });
    c.step(0.5, { x: 0, y: 1, run: true }, 0);
    c.stopNow();
    const z = c.pos.z;
    c.step(0.05, { x: 0, y: 0, run: false }, 0);
    expect(c.moving).toBe(false);
    expect(c.pos.z).toBe(z);
  });
  it('walks away from the camera on "forward"', () => {
    const g = grid();
    const c = new PlayerController(() => g, { x: 0, z: 0 });
    c.step(1, { x: 0, y: 1, run: false }, 0); // camera looks along +z
    expect(c.pos.z).toBeCloseTo(WALK_SPEED, 3);
    expect(Math.abs(c.pos.x)).toBeLessThan(1e-6);
  });
  it('strafes to the screen right on "right" (looking down +z, right is -x)', () => {
    const g = grid();
    const c = new PlayerController(() => g, { x: 0, z: 0 });
    c.step(0.5, { x: 1, y: 0, run: false }, 0);
    expect(c.pos.x).toBeLessThan(-WALK_SPEED * 0.45);
    const c2 = new PlayerController(() => g, { x: 0, z: 0 });
    c2.step(0.5, { x: -1, y: 0, run: false }, 0);
    expect(c2.pos.x).toBeGreaterThan(WALK_SPEED * 0.45);
  });
  it('cannot walk through a wall', () => {
    const g = grid();
    const c = new PlayerController(() => g, { x: 0, z: 0 });
    for (let i = 0; i < 60; i++) c.step(0.05, { x: 0, y: 1, run: true }, Math.PI / 2); // towards +x
    expect(c.pos.x).toBeLessThan(2);
  });
  it('slides along a wall when moving diagonally into it', () => {
    const g = grid();
    const c = new PlayerController(() => g, { x: 1.5, z: 0 });
    for (let i = 0; i < 20; i++) c.step(0.05, { x: 0, y: 1, run: false }, Math.PI / 4);
    expect(c.pos.x).toBeLessThan(2);
    expect(c.pos.z).toBeGreaterThan(0.5);
  });
  it('eases up to speed and coasts briefly to a stop', () => {
    const c = new PlayerController(() => grid(), { x: 0, z: -3 });
    c.step(1 / 60, { x: 0, y: 1, run: true }, 0);
    const first = c.pos.z + 3;
    expect(first).toBeLessThan(RUN_SPEED / 60 * 0.5); // not full speed on the first frame
    for (let i = 0; i < 30; i++) c.step(1 / 60, { x: 0, y: 1, run: true }, 0);
    const z = c.pos.z;
    for (let i = 0; i < 30; i++) c.step(1 / 60, { x: 0, y: 0, run: false }, 0);
    expect(c.pos.z - z).toBeGreaterThan(0.05); // a little coast…
    expect(c.pos.z - z).toBeLessThan(0.3); // …not a slide
    expect(c.moving).toBe(false);
  });
  it('follows a click-to-walk path and keys cancel it', () => {
    const g = grid();
    const c = new PlayerController(() => g, { x: 0, z: 0 });
    expect(c.walkTo({ x: 0, z: 3 })).toBe(true);
    for (let i = 0; i < 100; i++) c.step(0.05, { x: 0, y: 0, run: false }, 0);
    expect(Math.hypot(c.pos.x, c.pos.z - 3)).toBeLessThan(0.3);
    c.walkTo({ x: -3, z: 0 });
    c.step(0.05, { x: 1, y: 0, run: false }, 0);
    expect(c.path).toHaveLength(0);
  });
});

describe('placeAt', () => {
  it('picks the nearest yard within reach', () => {
    const yards = [{ groupId: 'a', yard: { x: 0, z: 0 } }, { groupId: 'b', yard: { x: 4, z: 0 } }];
    expect(placeAt({ x: 1, z: 0 }, yards)).toBe('a');
    expect(placeAt({ x: 3.5, z: 0 }, yards)).toBe('b');
    expect(placeAt({ x: 2, z: 9 }, yards)).toBeNull();
  });
});

describe('jumping', () => {
  const still = { x: 0, y: 0, run: false };
  const step = (c: PlayerController, n: number, jump = false) => { for (let i = 0; i < n; i++) c.step(1 / 60, { ...still, jump: jump && i === 0 }, 0); };
  it('rises to about v²/2g and lands back on the ground', () => {
    const c = new PlayerController(() => grid(), { x: 0, z: 0 });
    let peak = 0;
    c.step(1 / 60, { ...still, jump: true }, 0);
    let landedAt = -1;
    for (let i = 0; i < 120; i++) {
      c.step(1 / 60, still, 0);
      peak = Math.max(peak, c.height);
      if (c.landed) { landedAt = i; break; }
    }
    expect(peak).toBeGreaterThan(0.38);
    expect(peak).toBeLessThan(0.46);
    expect(landedAt).toBeGreaterThan(25);
    expect(c.height).toBe(0);
    expect(c.airborne).toBe(false);
  });
  it('does not double-jump in mid-air', () => {
    const c = new PlayerController(() => grid(), { x: 0, z: 0 });
    step(c, 1, true);
    step(c, 10);
    const vy = c.vy;
    c.step(1 / 60, { ...still, jump: true }, 0);
    expect(c.vy).toBeLessThan(vy);
  });
  it('buffers a press just before landing', () => {
    const c = new PlayerController(() => grid(), { x: 0, z: 0 });
    step(c, 1, true);
    while (!(c.vy < 0 && c.height < 0.08)) c.step(1 / 60, still, 0);
    c.step(1 / 60, { ...still, jump: true }, 0); // pressed a hair early
    let relaunched = false;
    for (let i = 0; i < 10; i++) { c.step(1 / 60, still, 0); if (c.vy > 0) relaunched = true; }
    expect(relaunched).toBe(true);
  });
  it('keeps bouncing while jump is held, one take-off per landing', () => {
    const c = new PlayerController(() => grid(), { x: 0, z: 0 });
    let takeoffs = 0, wasUp = false;
    for (let i = 0; i < 180; i++) {
      c.step(1 / 60, { ...still, jump: true }, 0);
      const up = c.vy > 0;
      if (up && !wasUp) takeoffs++;
      wasUp = up;
    }
    // 3 s held, about 0.53 s per hop.
    expect(takeoffs).toBeGreaterThanOrEqual(4);
    expect(takeoffs).toBeLessThanOrEqual(6);
  });
});

describe('solid furniture', () => {
  // A bench 0.22 high, from x 1 to 1.6, across the whole lane.
  const bench = [{ minX: 1, maxX: 1.6, minZ: -1, maxZ: 1, top: 0.22 }];
  const fwdX = -Math.PI / 2; // camera yaw so "forward" walks toward +x... computed below
  const step = (c: PlayerController, n: number, input: { x: number; y: number; run: boolean; jump?: boolean }) => {
    for (let i = 0; i < n; i++) c.step(1 / 60, { ...input, jump: input.jump && i === 0 }, Math.PI / 2);
  };
  it('blocks walking into it', () => {
    const c = new PlayerController(() => grid(), { x: 0, z: 0 }, () => bench);
    step(c, 120, { x: 0, y: 1, run: false });
    expect(c.pos.x).toBeLessThan(1);
    expect(c.height).toBe(0);
    void fwdX;
  });
  it('can be jumped onto, stood on, and walked off', () => {
    const c = new PlayerController(() => grid(), { x: 0.75, z: 0 }, () => bench);
    step(c, 1, { x: 0, y: 1, run: false, jump: true });
    step(c, 30, { x: 0, y: 1, run: false });
    expect(c.pos.x).toBeGreaterThan(1);
    step(c, 30, { x: 0, y: 0, run: false });
    expect(c.height).toBeCloseTo(0.22, 5);
    expect(c.airborne).toBe(false);
    step(c, 60, { x: 0, y: 1, run: false });
    expect(c.pos.x).toBeGreaterThan(1.6);
    step(c, 30, { x: 0, y: 0, run: false });
    expect(c.height).toBe(0);
  });
});

describe('raised ground (stairs, a raised floor)', () => {
  // A ramp from x 0 to 2 rising to 0.7, then a floor at 0.7.
  const ramp = (p: { x: number; z: number }) => Math.max(0, Math.min(0.7, p.x * 0.35));
  const step = (c: PlayerController, n: number, input: { x: number; y: number; run: boolean; jump?: boolean }, yaw = Math.PI / 2) => {
    for (let i = 0; i < n; i++) c.step(1 / 60, { ...input, jump: input.jump && i === 0 }, yaw);
  };
  const fwd = { x: 0, y: 1, run: false };
  it('walks up it smoothly, never airborne, and stands on top', () => {
    const c = new PlayerController(() => new NavGrid(10), { x: -0.5, z: 0 }, () => [], () => false, ramp);
    let last = 0;
    for (let i = 0; i < 300; i++) {
      step(c, 1, fwd);
      expect(c.height).toBeGreaterThanOrEqual(last - 1e-9);
      expect(c.airborne).toBe(false);
      last = c.height;
    }
    expect(c.pos.x).toBeGreaterThan(2);
    expect(c.height).toBeCloseTo(0.7, 5);
  });
  it('walks down it without falling, even running', () => {
    const c = new PlayerController(() => new NavGrid(10), { x: 2.5, z: 0 }, () => [], () => false, ramp);
    step(c, 2, { x: 0, y: 0, run: false });
    expect(c.height).toBeCloseTo(0.7, 5);
    for (let i = 0; i < 90; i++) { step(c, 1, { x: 0, y: 1, run: true }, -Math.PI / 2); expect(c.airborne).toBe(false); }
    expect(c.pos.x).toBeLessThan(0);
    expect(c.height).toBe(0);
  });
  it('runs up and over a bridge arch even at 10 fps, never stalling or hopping', () => {
    const arch = (p: { x: number; z: number }) => archHeight((p.x - 2) / 1.6);
    const c = new PlayerController(() => new NavGrid(10), { x: -0.5, z: 0 }, () => [], () => false, arch);
    let peak = 0;
    for (let i = 0; i < 40; i++) {
      c.step(0.1, { x: 0, y: 1, run: true }, Math.PI / 2);
      peak = Math.max(peak, c.height);
      expect(c.airborne).toBe(false);
      // Height settles at the start of the next step: at most one step behind.
      expect(Math.abs(c.height - arch(c.pos))).toBeLessThan(0.26 * 0.9);
    }
    expect(c.pos.x).toBeGreaterThan(4);
    expect(peak).toBeGreaterThan(BRIDGE_RISE * 0.9);
  });
  it('still blocks a ledge higher than a step', () => {
    const ledge = (p: { x: number; z: number }) => (p.x > 1 ? 0.4 : 0);
    const c = new PlayerController(() => new NavGrid(10), { x: 0, z: 0 }, () => [], () => false, ledge);
    step(c, 120, fwd);
    expect(c.pos.x).toBeLessThan(1);
    expect(c.height).toBe(0);
  });
});

describe('riding (RIDE_SPEEDS)', () => {
  it('gallops at about RIDE_RUN and goes back to foot speed', () => {
    const g = new NavGrid(30);
    const c = new PlayerController(() => g, { x: 0, z: -12 });
    c.speeds = RIDE_SPEEDS;
    for (let i = 0; i < 60; i++) c.step(1 / 60, { x: 0, y: 1, run: true }, 0);
    expect(c.pos.z + 12).toBeGreaterThan(RIDE_RUN * 0.85);
    c.speeds = FOOT_SPEEDS;
    for (let i = 0; i < 60; i++) c.step(1 / 60, { x: 0, y: 1, run: true }, 0); // eases down
    const z = c.pos.z;
    for (let i = 0; i < 60; i++) c.step(1 / 60, { x: 0, y: 1, run: true }, 0);
    expect(c.pos.z - z).toBeCloseTo(RUN_SPEED, 1);
  });
  it('does not gallop through a wall on a slow frame', () => {
    const g = grid();
    const c = new PlayerController(() => g, { x: 0, z: 0 });
    c.speeds = RIDE_SPEEDS;
    for (let i = 0; i < 10; i++) c.step(0.1, { x: 0, y: 1, run: true }, Math.PI / 2);
    expect(c.pos.x).toBeLessThan(2);
  });
  it('follows a clicked path past several waypoints in one long step', () => {
    const g = new NavGrid(30);
    const c = new PlayerController(() => g, { x: 0, z: 0 });
    c.speeds = RIDE_SPEEDS;
    c.path = [{ x: 0, z: 0.5 }, { x: 0, z: 1 }, { x: 0, z: 1.5 }, { x: 0, z: 5 }];
    c.step(0.3, { x: 0, y: 0, run: false }, 0);
    expect(c.pos.z).toBeCloseTo(RIDE_WALK * 0.3, 2);
  });
});

describe('a clicked path never freezes the page', () => {
  it('ends the step when what is left of it rounds to nothing on a long leg', () => {
    // left = speed × dt is the smallest number above 0; left / 5 rounds to 0, so the old loop moved
    // nothing, subtracted nothing and spun forever (the recorder froze right after a click on the map).
    const g = new NavGrid(30);
    const c = new PlayerController(() => g, { x: 0, z: 0 });
    c.path = [{ x: 0, z: 5 }];
    c.step(Number.MIN_VALUE, { x: 0, y: 0, run: false }, 0);
    expect(c.path).toHaveLength(1);
    expect(c.moving).toBe(true);
  });
  it('walks any frame length to the end of the path', () => {
    const g = new NavGrid(30);
    const c = new PlayerController(() => g, { x: 0, z: 0 });
    c.path = [{ x: 0, z: 0.7 }, { x: 0.9, z: 1.3 }, { x: 0.9, z: 3 }];
    for (const dt of [1 / 24, 1 / 30, 1 / 60, 1 / 144, 0.333]) for (let i = 0; i < 4000 && c.path.length; i++) c.step(dt, { x: 0, y: 0, run: false }, 0);
    expect(c.path).toHaveLength(0);
  });
});

describe('stairs (the obelisk\'s plinth)', () => {
  // Two steps 0.16 high round a shaft, all on walkable ground.
  const steps: Solid[] = [
    { minX: 2, maxX: 8, minZ: -3, maxZ: 3, top: 0.16, stair: true },
    { minX: 2.5, maxX: 7.5, minZ: -2.5, maxZ: 2.5, top: 0.32, stair: true },
    { minX: 3.5, maxX: 6.5, minZ: -1.5, maxZ: 1.5, top: 99 },
  ];
  const walkUp = (solids: Solid[]) => {
    const g = new NavGrid(20);
    const c = new PlayerController(() => g, { x: 1, z: 0 }, () => solids);
    for (let i = 0; i < 240; i++) c.step(1 / 60, { x: 0, y: 1, run: false }, Math.PI / 2); // towards +x
    return c;
  };
  it('walks up the steps without jumping, and stops at the shaft', () => {
    const c = walkUp(steps);
    expect(c.pos.x).toBeGreaterThan(2.6);
    expect(c.pos.x).toBeLessThan(3.5);
    expect(c.height).toBeCloseTo(0.32, 2);
    expect(c.airborne).toBe(false);
  });
  it('walks back down them, feet on each step', () => {
    const c = walkUp(steps);
    let air = 0;
    for (let i = 0; i < 240; i++) { c.step(1 / 60, { x: 0, y: -1, run: false }, Math.PI / 2); if (c.airborne) air++; }
    expect(c.pos.x).toBeLessThan(2);
    expect(c.height).toBeCloseTo(0, 2);
    expect(air).toBe(0);
  });
  it('furniture of the same height still needs a jump', () => {
    const c = walkUp(steps.map((s) => ({ ...s, stair: undefined })));
    expect(c.pos.x).toBeLessThan(2.1);
  });
});

describe('a clicked path', () => {
  it('stops at a wall instead of climbing it', () => {
    const g = new NavGrid(20);
    const wall: Solid[] = [{ minX: 3, maxX: 5, minZ: -1, maxZ: 1, top: 99 }];
    const c = new PlayerController(() => g, { x: 0, z: 0 }, () => wall);
    c.path = [{ x: 4, z: 0 }];
    for (let i = 0; i < 400; i++) c.step(1 / 60, { x: 0, y: 0, run: false }, 0);
    expect(c.pos.x).toBeLessThan(3);
    expect(c.height).toBeLessThan(1);
  });
});
