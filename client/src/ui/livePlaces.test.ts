import { describe, it, expect } from 'vitest';
import { hereCounts, speakerPlace, bubbleShown } from './livePlaces';

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
    const live = new Set(['me', 'alice', 'bob', 'carol']);
    const n = hereCounts(people, (pk) => live.has(pk), placeOf);
    expect(n.get('general')).toBe(2);
    expect(n.get('bitcoin')).toBe(1);
    expect(n.size).toBe(2);
  });

  it('is empty when nobody is connected (the director’s villagers only)', () => {
    expect(hereCounts([{ pk: 'npc', pos: { x: 0, z: 0 } }], () => false, placeOf).size).toBe(0);
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
