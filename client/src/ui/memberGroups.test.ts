import { describe, it, expect } from 'vitest';
import { listMembers, type Rank } from './memberGroups';
import type { Presence } from '../nostr/presence';

describe('the member list', () => {
  const og: Rank = { id: 'og', name: 'OG', tier: 5, color: '#fff', emoji: '⭐' };
  const mod: Rank = { id: 'mod', name: 'Moderator', tier: 9, color: '#f00', emoji: '' };
  const presence: Record<string, Presence> = { ana: 'online', bob: 'online', cy: 'online', dee: 'afk', eve: 'offline', fin: 'online', gus: 'offline' };
  const ranks: Record<string, Rank[]> = { bob: [og], cy: [mod, og], dee: [mod], gus: [mod] };
  const out = listMembers(Object.keys(presence), new Set(['ana']), (pk) => ranks[pk], (pk) => presence[pk], (pk) => pk);

  it('lists everyone once, connected first, then AFK, then offline', () => {
    expect(out.map((r) => r.pk)).toEqual(['ana', 'cy', 'bob', 'fin', 'dee', 'gus', 'eve']);
  });

  it('orders by standing within each: admins, then ranks by tier, then names', () => {
    const online = out.filter((r) => r.presence === 'online');
    expect(online.map((r) => [r.pk, r.admin, r.rank?.id ?? null])).toEqual([['ana', true, null], ['cy', false, 'mod'], ['bob', false, 'og'], ['fin', false, null]]);
  });

  it('keeps the offline people in the list, not folded apart', () => {
    expect(out.filter((r) => r.presence === 'offline').map((r) => r.pk)).toEqual(['gus', 'eve']);
  });
});
