import { describe, it, expect } from 'vitest';
import { liveTally, relayTally, speakerPlace, bubbleShown, RELAY_ACTIVE_MS } from './livePlaces';

describe('who is here', () => {
  const yards: Record<string, { x: number; z: number }> = { general: { x: 0, z: 0 }, bitcoin: { x: 10, z: 0 } };
  const placeOf = (p: { x: number; z: number }) => {
    for (const [id, y] of Object.entries(yards)) if (Math.hypot(p.x - y.x, p.z - y.z) < 2.6) return id;
    return null;
  };

  it('counts only connected people, each at the place they stand', () => {
    const people = [
      { pk: 'me', pos: { x: 0.5, z: 0 } },
      { pk: 'alice', pos: { x: -1, z: 1 } },
      { pk: 'bob', pos: { x: 10, z: 1 } },
      { pk: 'npc1', pos: { x: 0, z: 0.3 } },
      { pk: 'npc2', pos: { x: 10, z: 0 } },
      { pk: 'carol', pos: { x: 5, z: 0 } }, // between yards: nowhere
    ];
    const at = new Map(people.map((p) => [p.pk, p.pos]));
    const t = liveTally(['me', 'alice', 'bob', 'carol'], (pk) => at.get(pk) ?? null, placeOf);
    expect(t.byPlace.get('general')).toBe(2);
    expect(t.byPlace.get('bitcoin')).toBe(1);
    expect(t.byPlace.size).toBe(2);
    // Carol is connected but at no place: still in the total, as "around".
    expect(t.around).toBe(1);
    expect(t.total).toBe(4);
  });

  it('counts a connected person the world hasn’t drawn yet, and each person once', () => {
    const t = liveTally(['me', 'dave', 'me', 'dave'], (pk) => (pk === 'me' ? { x: 0, z: 0 } : null), placeOf);
    expect(t.total).toBe(2);
    expect(t.byPlace.get('general')).toBe(1);
    expect(t.around).toBe(1);
  });

  it('the total is the places plus around', () => {
    const pos: Record<string, { x: number; z: number }> = { a: { x: 0, z: 0 }, b: { x: 10, z: 0 }, c: { x: 5, z: 5 }, d: { x: 10, z: 1 } };
    const t = liveTally(Object.keys(pos), (pk) => pos[pk] ?? null, placeOf);
    expect([...t.byPlace.values()].reduce((x, y) => x + y, 0) + t.around).toBe(t.total);
  });

  it('is empty when nobody is connected (the director’s villagers only)', () => {
    const t = liveTally([], () => ({ x: 0, z: 0 }), placeOf);
    expect(t).toEqual({ total: 0, byPlace: new Map(), around: 0 });
  });
});

describe('message bubbles', () => {
  it('a connected speaker is where they stand, anyone else at the channel they posted in', () => {
    expect(speakerPlace(true, 'bitcoin', 'general')).toBe('bitcoin');
    expect(speakerPlace(true, null, 'general')).toBeNull();
    expect(speakerPlace(false, null, 'general')).toBe('general');
  });

  it('shows only to someone at the same place', () => {
    expect(bubbleShown('general', 'general')).toBe(true);
    expect(bubbleShown('general', 'bitcoin')).toBe(false);
    expect(bubbleShown(null, 'general')).toBe(false);
    expect(bubbleShown(null, null)).toBe(false);
  });

  it('shows the relay’s general chat to everyone, wherever they are', () => {
    expect(bubbleShown('bitcoin', 'general', true)).toBe(true);
    expect(bubbleShown(null, 'general', true)).toBe(true);
    expect(bubbleShown(null, null, true)).toBe(true);
  });
});

describe('everyone active on the relay', () => {
  const yards: Record<string, { x: number; z: number }> = { general: { x: 0, z: 0 }, bitcoin: { x: 10, z: 0 } };
  const placeOf = (p: { x: number; z: number }) => {
    for (const [id, y] of Object.entries(yards)) if (Math.hypot(p.x - y.x, p.z - y.z) < 2.6) return id;
    return null;
  };
  const now = 1_800_000_000;
  const since = now - RELAY_ACTIVE_MS / 1000;

  it('counts recent writers from any app with the people in Sky, each channel once per person', () => {
    const posts = [
      { pubkey: 'ana', created_at: now - 60, channel: 'general' },
      { pubkey: 'ana', created_at: now - 30, channel: 'general' },
      { pubkey: 'ana', created_at: now - 20, channel: 'bitcoin' },
      { pubkey: 'beto', created_at: now - 120, channel: 'bitcoin' },
      { pubkey: 'old', created_at: since - 1, channel: 'general' },
    ];
    const pos = new Map([['me', { x: 0, z: 0 }], ['walker', { x: 50, z: 50 }]]);
    const t = relayTally(posts, since, ['me', 'walker'], (pk) => pos.get(pk) ?? null, placeOf);
    expect(t.total).toBe(4); // ana, beto, me, walker; not the old poster
    expect(t.byPlace.get('general')).toBe(2); // ana wrote there, me stands there
    expect(t.byPlace.get('bitcoin')).toBe(2); // ana and beto wrote there
    expect(t.around).toBe(1); // walker: connected, at no place, quiet
  });

  it('counts someone in Sky who also wrote once in the total', () => {
    const t = relayTally([{ pubkey: 'me', created_at: now, channel: 'bitcoin' }], since, ['me'], () => ({ x: 0, z: 0 }), placeOf);
    expect(t.total).toBe(1);
    expect(t.byPlace.get('general')).toBe(1);
    expect(t.byPlace.get('bitcoin')).toBe(1);
    expect(t.around).toBe(0);
  });

  it('is empty with nobody active', () => {
    const t = relayTally([], since, [], () => null, placeOf);
    expect(t).toEqual({ total: 0, byPlace: new Map(), around: 0 });
  });
});
