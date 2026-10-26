// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Character } from './character';

afterEach(() => vi.restoreAllMocks());
const runner = () => {
  vi.spyOn(Character.prototype, 'setLook').mockImplementation(() => {});
  const noop: unknown = new Proxy(() => noop, { get: (_t,k) => k === 'measureText' ? () => ({width:0}) : noop, set: () => true, apply: () => noop });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(noop as never);
  const c = new Character('runner', 'Runner');
  c.opacity = c.targetOpacity = 1;
  return c;
};

describe('continuous path locomotion', () => {
  it('keeps running at the same speed across dense track waypoints', () => {
    const c = runner();
    c.walk(Array.from({length:120},(_,i)=>({x:(i+1)*0.02,z:0})),true);
    for (let frame=1;frame<=24;frame++) {
      c.update(1/24);
      expect(c.pos.x).toBeCloseTo(frame*0.1,6);
      expect(c.speed).toBeGreaterThan(0);
    }
    expect(c.path).toHaveLength(0);
  });
  it('carries the remaining distance into the next lap without an idle frame', () => {
    const c=runner();
    c.walk([{x:0.06,z:0}],true,()=>c.walk([{x:1,z:0}],true));
    c.update(1/24);
    expect(c.pos.x).toBeCloseTo(0.1);
    expect(c.running).toBe(true);
  });
  it('stops at a seat when arrival changes the activity', () => {
    const c=runner();
    c.walk([{x:0.06,z:0}],true,()=>c.sit());
    c.update(1/24);
    expect(c.pos.x).toBeCloseTo(0.06);
    expect(c.activity).toBe('sit');
  });
});
