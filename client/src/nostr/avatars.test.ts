import { describe, it, expect } from 'vitest';
import { finalizeEvent, generateSecretKey } from 'nostr-tools';
import { parseAvatar, avatarTemplate, AvatarStore, AVATAR_D_TAG, DEFAULT_AVATAR, AVATAR_CACHE_PREFIX, cacheAvatar, fetchOwnLook, loadCachedAvatar, shouldRepublish } from './avatars';
import { activeRelay } from './hub';
import { defaultLook, parseLook } from '../people/people';

describe('avatar config', () => {
  it('round-trips through its event', () => {
    const a = { v: 1 as const, skin: 'q', look: null, hat: 'boina' as const, hatColor: '#ff4d5e', pet: { kind: 'dog' as const, name: 'Mate' } };
    const t = avatarTemplate(a);
    expect(t.tags).toEqual([['d', AVATAR_D_TAG]]);
    expect(parseAvatar(t.content)).toEqual(a);
  });
  it('drops unknown values and fields, clips names', () => {
    const a = parseAvatar(JSON.stringify({ v: 1, skin: 'zz', hat: 'helmet', hatColor: 'red', pet: { kind: 'dragon', name: 'x' }, extra: '<script>' }))!;
    expect(a).toEqual({ ...DEFAULT_AVATAR, pet: null });
    const b = parseAvatar(JSON.stringify({ v: 1, pet: { kind: 'cat', name: 'x'.repeat(100) + '‮' } }))!;
    expect(b.pet!.name).toHaveLength(24);
    expect(Object.keys(b).sort()).toEqual(['hat', 'hatColor', 'look', 'pet', 'skin', 'v']);
  });
  it('rejects other versions and junk', () => {
    expect(parseAvatar('nope')).toBeNull();
    expect(parseAvatar(JSON.stringify({ v: 2 }))).toBeNull();
    expect(parseAvatar(JSON.stringify({ v: 3, skin: 'a' }))).toBeNull();
  });
  it('keeps the newest per person', () => {
    const sk = generateSecretKey();
    const store = new AvatarStore({} as never);
    const ev = (skin: string, at: number) => finalizeEvent({ ...avatarTemplate({ ...DEFAULT_AVATAR, skin }), created_at: at }, sk);
    store.ingest(ev('b', 20));
    store.ingest(ev('c', 10));
    expect(store.get(ev('a', 1).pubkey)!.skin).toBe('b');
  });
});

describe('favourite places (haunts)', () => {
  const look = defaultLook(3);
  it('round-trip with the look, v1 and v2', () => {
    const v2 = { ...DEFAULT_AVATAR, v: 2 as const, look, haunts: ['parrilla' as const, 'pond' as const] };
    expect(parseAvatar(avatarTemplate(v2).content)).toEqual(v2);
    const v1 = { ...DEFAULT_AVATAR, haunts: ['gym' as const] };
    expect(parseAvatar(avatarTemplate(v1).content)).toEqual(v1);
  });
  it('are left out of the event when there are none, and old events parse with none', () => {
    expect(JSON.parse(avatarTemplate({ ...DEFAULT_AVATAR, haunts: [] }).content)).not.toHaveProperty('haunts');
    expect(parseAvatar(JSON.stringify({ v: 2, skin: 'a', look }))).not.toHaveProperty('haunts');
    expect(parseAvatar(JSON.stringify({ v: 1, skin: 'a' }))).not.toHaveProperty('haunts');
  });
  it('drop unknown places, repeats and junk, and keep three at most', () => {
    const a = parseAvatar(JSON.stringify({ v: 2, skin: 'a', look, haunts: ['moon', 'pond', 'pond', 7, 'plaza', 'park', 'gym'] }))!;
    expect(a.haunts).toEqual(['pond', 'plaza', 'park']);
    expect(parseAvatar(JSON.stringify({ v: 1, haunts: 'pond' }))).not.toHaveProperty('haunts');
  });
});

describe('avatar v2 (a full look)', () => {
  const look = { ...defaultLook(42), body: 'm' as const, outfit: 'ranger' as const, hood: true, beard: true };
  it('round-trips a look', () => {
    const a = { ...DEFAULT_AVATAR, v: 2 as const, look };
    expect(parseAvatar(avatarTemplate(a).content)).toEqual(a);
  });
  it('rejects a look with any value off its list', () => {
    for (const bad of [{ top: 'red' }, { hair: 'mohawk' }, { body: 'x' }, { skinTint: '#123456' }, { shoes: 'url(x)' }]) {
      expect(parseLook({ ...look, ...bad })).toBeNull();
      expect(parseAvatar(JSON.stringify({ v: 2, skin: 'a', look: { ...look, ...bad } }))).toBeNull();
    }
  });
  it('drops a beard or hood that the body or outfit cannot wear, and extra fields', () => {
    const f = parseLook({ ...look, body: 'f', beard: true, outfit: 'peasant', hood: true, extra: 1 })!;
    expect(f.beard).toBe(false);
    expect(f.hood).toBe(false);
    expect(Object.keys(f)).not.toContain('extra');
  });
  it('keeps "no shirt" for a man only, and leaves it out when off', () => {
    const a = { ...DEFAULT_AVATAR, v: 2 as const, look: { ...look, shirtless: true } };
    expect(parseAvatar(avatarTemplate(a).content)).toEqual(a);
    expect(parseLook({ ...look, body: 'f', beard: false, shirtless: true })!).not.toHaveProperty('shirtless');
    expect(parseLook({ ...look, shirtless: false })!).not.toHaveProperty('shirtless');
  });
  it('still reads v1 avatars, with no look', () => {
    const a = parseAvatar(JSON.stringify({ v: 1, skin: 'c', hat: 'cap', hatColor: '#38bdf8', pet: null }))!;
    expect(a.v).toBe(1);
    expect(a.look).toBeNull();
    expect(a.skin).toBe('c');
  });
  it('gives everyone a stable default look', () => {
    expect(defaultLook(7)).toEqual(defaultLook(7));
    expect(parseLook(defaultLook(7))).toEqual(defaultLook(7));
  });
});

describe('your look across relays', () => {
  const mem = (): Storage => {
    const m = new Map<string, string>();
    return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k), clear: () => m.clear(), key: () => null, length: 0 } as Storage;
  };
  const sk = generateSecretKey();
  const pet = { kind: 'dog' as const, name: 'Mate' };
  const ev = (at: number, hat: 'cap' | 'boina' = 'cap') => finalizeEvent({ ...avatarTemplate({ ...DEFAULT_AVATAR, hat, pet }), created_at: at }, sk);
  const hubWith = (events: ReturnType<typeof ev>[]) => ({ query: async () => ({ events }) }) as never;

  it('caches the newest only, and rejects junk or another key', () => {
    const s = mem();
    cacheAvatar(ev(20), s);
    cacheAvatar(ev(10, 'boina'), s);
    const pk = ev(1).pubkey;
    expect(loadCachedAvatar(pk, s)!.created_at).toBe(20);
    s.setItem(AVATAR_CACHE_PREFIX + pk, '{oops');
    expect(loadCachedAvatar(pk, s)).toBeNull();
    s.setItem(AVATAR_CACHE_PREFIX + 'ab'.repeat(32), JSON.stringify(ev(5)));
    expect(loadCachedAvatar('ab'.repeat(32), s)).toBeNull();
  });

  it('republishes only when the relay is missing it or behind', () => {
    expect(shouldRepublish(null, 0)).toBe(false);
    expect(shouldRepublish(ev(10), 0)).toBe(true);
    expect(shouldRepublish(ev(10), 5)).toBe(true);
    expect(shouldRepublish(ev(10), 10)).toBe(false);
    expect(shouldRepublish(ev(10), 20)).toBe(false);
  });

  it('shows the cached look at once and copies it to a relay that lacks it', async () => {
    const s = mem();
    const mine = ev(30);
    cacheAvatar(mine, s);
    const store = new AvatarStore(hubWith([]), s);
    const sent: string[] = [];
    const out = await store.syncOwn(mine.pubkey, async (e) => { sent.push(e.id); return true; });
    expect(out).toBe('republished');
    expect(sent).toEqual([mine.id]); // the very same signed event
    expect(store.get(mine.pubkey)!.pet).toEqual(pet);
  });

  it('takes a newer look from the relay and caches it instead', async () => {
    const s = mem();
    cacheAvatar(ev(30), s);
    const newer = ev(40, 'boina');
    const store = new AvatarStore(hubWith([newer]), s);
    let sent = 0;
    expect(await store.syncOwn(newer.pubkey, async () => { sent++; return true; })).toBe('current');
    expect(sent).toBe(0);
    expect(store.get(newer.pubkey)!.hat).toBe('boina');
    expect(loadCachedAvatar(newer.pubkey, s)!.id).toBe(newer.id);
  });

  it('takes a look saved while refused (on the public relays) to a group relay that lacks it', async () => {
    const s = mem();
    const fromIsland = ev(60, 'boina');
    // The group relay has an older one; the public profile relays have the island's.
    const hub = { query: async (q: { relays: string[] }) => ({ events: q.relays.includes(activeRelay()) ? [ev(20)] : [fromIsland], complete: true }) } as never;
    const store = new AvatarStore(hub, s);
    const sent: string[] = [];
    expect(await store.syncOwn(fromIsland.pubkey, async (e) => { sent.push(e.id); return true; }, ['wss://elsewhere.example'])).toBe('republished');
    expect(sent).toEqual([fromIsland.id]);
    expect(store.get(fromIsland.pubkey)!.hat).toBe('boina');
  });

  it('reads your newest look off other relays and caches it if newer', async () => {
    const s = mem();
    cacheAvatar(ev(30), s);
    const pk = ev(1).pubkey;
    const other = finalizeEvent({ ...avatarTemplate({ ...DEFAULT_AVATAR, hat: 'crown' }), created_at: 90 }, generateSecretKey());
    expect((await fetchOwnLook(hubWith([ev(70, 'boina'), ev(50), other]), pk, ['wss://x'], s))!.created_at).toBe(70);
    expect(loadCachedAvatar(pk, s)!.created_at).toBe(70);
    expect(await fetchOwnLook(hubWith([ev(70)]), pk, [], s)).toBeNull();
  });

  it('caches the look you save', async () => {
    const s = mem();
    const store = new AvatarStore(hubWith([]), s);
    const pk = ev(1).pubkey;
    expect(await store.syncOwn(pk, async () => true)).toBe('none');
    store.ingest(ev(50));
    expect(loadCachedAvatar(pk, s)!.created_at).toBe(50);
  });
});

describe('AvatarStore on the relay', () => {
  const sk = generateSecretKey();
  const lookEv = (at: number, outfit: 'peasant' | 'ranger') =>
    finalizeEvent({ ...avatarTemplate({ ...DEFAULT_AVATAR, v: 2, look: { ...defaultLook(1), outfit } }), created_at: at }, sk);

  it('hears a look saved after we first asked (a change of clothes reaches everyone)', () => {
    let onEvent: ((ev: ReturnType<typeof lookEv>) => void) | null = null;
    let released = false;
    const hub = { subscribe: (spec: { filters: { '#d': string[] }[]; onEvent: typeof onEvent }) => {
      expect(spec.filters[0]['#d']).toEqual([AVATAR_D_TAG]);
      onEvent = spec.onEvent;
      return { release: () => { released = true; } };
    } };
    const store = new AvatarStore(hub as never, null);
    const seen: string[] = [];
    store.onChange((_pk, a) => seen.push(a.look!.outfit));
    store.start();
    onEvent!(lookEv(10, 'peasant'));
    onEvent!(lookEv(20, 'ranger'));
    expect(store.get(lookEv(1, 'ranger').pubkey)!.look!.outfit).toBe('ranger');
    expect(seen).toEqual(['peasant', 'ranger']);
    store.stop();
    expect(released).toBe(true);
  });

  it('asks again for people whose query did not finish', async () => {
    const asked: string[][] = [];
    let complete = false;
    const hub = { query: async (spec: { filters: { authors: string[] }[]; cache?: { mode: string } }) => {
      asked.push(spec.filters[0].authors);
      expect(spec.cache?.mode).toBe('bypass');
      return { events: [], complete, perRelay: {}, fromCache: false };
    } };
    const store = new AvatarStore(hub as never, null);
    store.want(['a']);
    await new Promise((r) => setTimeout(r, 0));
    complete = true;
    store.want(['a']);
    await new Promise((r) => setTimeout(r, 0));
    store.want(['a']);
    expect(asked).toEqual([['a'], ['a']]);
  });
});
