import { describe, it, expect } from 'vitest';
import { Director } from './director';
import { Player, findEpisodes, insertByTime, paceDelay, type Ev, LIVE_IDLE_BEFORE_STORY, ZAP_LIVE_S } from './player';

let n = 0;
const m = (pubkey: string, at: number, groupId = 'g'): Ev =>
  ({ k: 'msg', at, m: { id: `e${n++}`, pubkey, groupId, text: 'hello there', replyTo: null, replyToId: null, createdAt: at } });

describe('findEpisodes', () => {
  it('splits on long gaps and drops tiny clusters', () => {
    const evs = [m('A', 0), m('B', 60), m('A', 120), m('C', 5000), m('A', 20000), m('B', 20030), m('C', 20090), m('A', 20100)];
    const eps = findEpisodes(evs);
    expect(eps.map((e) => e.count)).toEqual([3, 4]);
    expect(eps[1]).toMatchObject({ start: 20000, end: 20100, groupId: 'g' });
  });
});

describe('paceDelay', () => {
  it('leaves time to read but compresses long gaps', () => {
    expect(paceDelay(m('A', 0), m('B', 3600))).toBeLessThanOrEqual(7);
    expect(paceDelay(m('A', 0), m('B', 3600))).toBeGreaterThanOrEqual(2);
  });
});

describe('Player', () => {
  const NOW = 100_000;
  const history = () => [m('A', NOW - 7200), m('B', NOW - 7150), m('A', NOW - 7100), m('C', NOW - 7050)];

  it('starts a replay when the village is quiet, then returns live', () => {
    const d = new Director();
    const p = new Player(d);
    p.load(history(), NOW);
    expect(p.mode).toBe('replay');
    for (let i = 0; i < 80; i++) p.update(0.5, NOW);
    expect(p.mode).toBe('live');
    expect(d.people.size).toBe(3);
  });

  it('a live event interrupts a replay', () => {
    const d = new Director();
    const p = new Player(d);
    p.load(history(), NOW);
    expect(p.mode).toBe('replay');
    p.push(m('D', NOW + 1), NOW + 1);
    expect(p.mode).toBe('live');
    expect(d.people.has('D')).toBe(true);
  });

  it('stays live when recent, and drifts into story after quiet', () => {
    const d = new Director();
    const p = new Player(d);
    p.load([m('A', NOW - 60), m('B', NOW - 50), m('A', NOW - 40)], NOW);
    expect(p.mode).toBe('live');
    p.update(LIVE_IDLE_BEFORE_STORY + 1, NOW);
    expect(p.mode).toBe('replay');
  });

  it('ignores duplicates', () => {
    const d = new Director();
    const p = new Player(d);
    const e = m('A', NOW - 5);
    p.load([e], NOW);
    const before = p.events.length;
    p.push(e, NOW);
    expect(p.events.length).toBe(before);
  });
});

describe('history mode', () => {
  it('keeps you in the past when live messages arrive, counting them', () => {
    const p = new Player(new Director());
    p.autoStory = false;
    const base = 1_700_000_000;
    p.load([m('a', base - 3600, 'g1'), m('b', base - 3500, 'g1'), m('a', base - 3400, 'g1')], base);
    p.history = true;
    p.playFrom(base - 3601, base - 3300, base);
    p.push(m('c', base + 10, 'g1'), base + 10);
    p.push(m('c', base + 11, 'g1'), base + 11);
    expect(p.mode).toBe('replay');
    expect(p.missed).toBe(2);
    expect(p.events).toHaveLength(5);
  });
  it('stays where a replay ends instead of jumping back to now', () => {
    const p = new Player(new Director());
    p.autoStory = false;
    const base = 1_700_000_000;
    p.load([m('a', base - 3600, 'g1'), m('b', base - 3500, 'g1')], base);
    p.history = true;
    p.playFrom(base - 3601, base - 3400, base);
    for (let i = 0; i < 200; i++) p.update(0.2, base);
    expect(p.mode).toBe('replay');
    p.history = false;
    p.goLive(base);
    expect(p.missed).toBe(0);
  });
});

describe('a zap reaching the village', () => {
  const NOW = 100_000;
  const zap = (id: string, at: number): Ev => ({ k: 'zap', at, z: { id, from: 'A', target: 'B', targetId: null, groupId: 'g', sats: 21, createdAt: at } });
  const flights = (d: Director) => d.take().filter((c) => c.c === 'zap' && !c.instant);

  it('flies once when it just happened', () => {
    const d = new Director();
    const p = new Player(d);
    p.load([], NOW);
    d.take();
    p.push(zap('z1', NOW - 5), NOW);
    p.push(zap('z1', NOW - 5), NOW);
    expect(flights(d)).toHaveLength(1);
  });

  it('an old one (a late receipt, a channel loaded later) is kept but doesn’t fly or cut a replay', () => {
    const d = new Director();
    const p = new Player(d);
    p.load([m('A', NOW - 7200), m('B', NOW - 7150), m('A', NOW - 7100), m('C', NOW - 7050)], NOW);
    expect(p.mode).toBe('replay');
    d.take();
    p.push(zap('z2', NOW - ZAP_LIVE_S - 1), NOW);
    expect(flights(d)).toHaveLength(0);
    expect(p.mode).toBe('replay');
    expect(p.events.some((e) => e.k === 'zap')).toBe(true);
  });

  it('while you look at history it is counted, not flown', () => {
    const d = new Director();
    const p = new Player(d);
    p.load([], NOW);
    p.history = true;
    d.take();
    p.push(zap('z3', NOW), NOW);
    expect(flights(d)).toHaveLength(0);
    expect(p.missed).toBe(1);
  });
});

describe('messages that arrive late (a reconnect, a channel listed later)', () => {
  const NOW = 100_000;
  const says = (d: Director) => d.take().filter((c) => c.c === 'say' && !c.instant);

  it('are kept in time order, whatever order they came in', () => {
    const p = new Player(new Director());
    p.load([m('A', NOW - 600), m('B', NOW - 30)], NOW);
    // The relay's catch-up, newest first.
    for (const at of [NOW - 100, NOW - 200, NOW - 300]) p.push(m('C', at), NOW);
    p.push(m('D', NOW), NOW);
    expect(p.events.map((e) => e.at)).toEqual([NOW - 600, NOW - 300, NOW - 200, NOW - 100, NOW - 30, NOW]);
  });

  it('are not acted out when they are from before what is already here', () => {
    const d = new Director();
    const p = new Player(d);
    p.load([m('A', NOW - 10)], NOW);
    d.take();
    p.push(m('B', NOW - 500), NOW);
    expect(says(d)).toHaveLength(0);
    // Just said: acted out, even if a moment older than the last one.
    p.push(m('C', NOW - 20), NOW);
    p.push(m('D', NOW), NOW);
    expect(says(d).map((c) => (c as { pk: string }).pk)).toEqual(['C', 'D']);
  });

  it('insertByTime keeps equal times in arrival order', () => {
    const evs: Ev[] = [];
    const a = m('A', 5), b = m('B', 5), c = m('C', 1);
    insertByTime(evs, a);
    insertByTime(evs, b);
    expect(insertByTime(evs, c)).toBe(0);
    expect(evs).toEqual([c, a, b]);
  });
});
