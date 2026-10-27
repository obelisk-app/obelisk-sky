import { afterEach, describe, expect, it, vi } from 'vitest';
import { getEventHash } from 'nostr-tools';
import type { RelayHub } from '@nostr-wot/relay/hub';
import { guardHub, guestAuthor, guestPubkey, isGuest, isOwnWrite, localEvent, ownWritesAllowed, setGuest } from './guest';
import { AVATAR_D_TAG } from './avatars';
import { messageTemplate, publishSigned, publishToGroup } from './publish';
import { SessionManager } from './session';

const ME = 'cd'.repeat(32);

function fakeHub() {
  return {
    publish: vi.fn(async ({ relays }: { relays: string[] }) => relays.map((url) => ({ url, status: 'ok', reason: null }))),
    setIdentity: vi.fn(),
    acquireAuthLease: vi.fn(() => ({ release() {} })),
  };
}

afterEach(() => setGuest(null));

describe('the guest island publishes nothing', () => {
  it('turns a publish into a local unsigned event, without signing or sending', async () => {
    setGuest('logged-out', ME);
    const hub = fakeHub();
    const sign = vi.fn();
    const out = await publishToGroup(hub as unknown as RelayHub, sign, messageTemplate('guest-mate', 'hola', null));
    expect(sign).not.toHaveBeenCalled();
    expect(hub.publish).not.toHaveBeenCalled();
    expect(out.ok).toBe(true);
    expect(out.event!.pubkey).toBe(ME);
    expect(out.event!.sig).toBe('');
    expect(out.event!.id).toBe(getEventHash(out.event!));
    const signed = await publishSigned(hub as unknown as RelayHub, out.event!);
    expect(signed.ok).toBe(true);
    expect(hub.publish).not.toHaveBeenCalled();
  });

  it('publishes as before once off the island', async () => {
    const hub = fakeHub();
    const sign = vi.fn(async (t) => ({ ...t, pubkey: ME, id: 'x', sig: 'y' }));
    await publishToGroup(hub as unknown as RelayHub, sign, messageTemplate('g', 'hi', null));
    expect(sign).toHaveBeenCalledOnce();
    expect(hub.publish).toHaveBeenCalled();
  });

  it('makes the hub refuse every publish (DMs, profile edits, read-state)', async () => {
    const hub = fakeHub();
    const real = hub.publish;
    guardHub(hub as unknown as RelayHub);
    guardHub(hub as unknown as RelayHub); // once only
    setGuest('refused', ME);
    const ev = localEvent({ kind: 1059, tags: [], content: '', created_at: 1 }, ME);
    const res = await (hub as unknown as RelayHub).publish({ relays: ['wss://a', 'wss://b'], event: ev as never });
    expect(real).not.toHaveBeenCalled();
    expect(res.map((r) => r.status)).toEqual(['rejected', 'rejected']);
    setGuest(null);
    await (hub as unknown as RelayHub).publish({ relays: ['wss://a'], event: ev as never });
    expect(real).toHaveBeenCalledOnce();
  });

  it('lets a refused account publish its own profile and look, and nothing else', async () => {
    const hub = fakeHub();
    const real = hub.publish;
    guardHub(hub as unknown as RelayHub);
    setGuest('refused', ME);
    const send = (ev: ReturnType<typeof localEvent>) => (hub as unknown as RelayHub).publish({ relays: ['wss://a'], event: ev as never });
    await send(localEvent({ kind: 0, tags: [], content: '{}', created_at: 1 }, ME));
    await send(localEvent({ kind: 30078, tags: [['d', AVATAR_D_TAG]], content: '{}', created_at: 1 }, ME));
    expect(real).toHaveBeenCalledTimes(2);
    // Someone else's, another app's data, a channel message: still refused.
    const refused = await Promise.all([
      send(localEvent({ kind: 0, tags: [], content: '{}', created_at: 1 }, 'ef'.repeat(32))),
      send(localEvent({ kind: 30078, tags: [['d', 'obelisk:readstate:v1']], content: '', created_at: 1 }, ME)),
      send(localEvent({ kind: 9, tags: [['h', 'g']], content: 'hi', created_at: 1 }, ME)),
    ]);
    expect(real).toHaveBeenCalledTimes(2);
    expect(refused.flat().map((r) => r.status)).toEqual(['rejected', 'rejected', 'rejected']);
    // A logged-out guest has no key: not even a profile.
    setGuest('logged-out', ME);
    await send(localEvent({ kind: 0, tags: [], content: '{}', created_at: 1 }, ME));
    expect(real).toHaveBeenCalledTimes(2);
  });

  it('knows which writes are your own', () => {
    expect(isOwnWrite({ kind: 0, tags: [] })).toBe(true);
    expect(isOwnWrite({ kind: 24242, tags: [['t', 'upload']] })).toBe(true);
    expect(isOwnWrite({ kind: 30078, tags: [['d', AVATAR_D_TAG]] })).toBe(true);
    expect(isOwnWrite({ kind: 30078, tags: [['d', 'obelisk-sky:activity:v1']] })).toBe(false);
    expect(isOwnWrite({ kind: 7, tags: [] })).toBe(false);
    expect(ownWritesAllowed()).toBe(true);
    setGuest('refused', ME);
    expect(ownWritesAllowed()).toBe(true);
    setGuest('logged-out', ME);
    expect(ownWritesAllowed()).toBe(false);
  });

  it('keeps the signer out of it', async () => {
    const hub = fakeHub();
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) } as unknown as Storage;
    const session = new SessionManager(hub as unknown as RelayHub, storage);
    const signEvent = vi.fn();
    session.current = { pubkey: ME, method: 'nsec', signer: { signEvent } as never };
    setGuest('refused', ME);
    await expect(session.sign({ kind: 9, tags: [], content: 'x', created_at: 1 })).rejects.toThrow(/guest/);
    expect(signEvent).not.toHaveBeenCalled();
    // Your own profile and look are still yours to sign; nothing else goes through signOwn.
    await session.signOwn({ kind: 0, tags: [], content: '{}', created_at: 1 });
    expect(signEvent).toHaveBeenCalledOnce();
    await expect(session.signOwn({ kind: 9, tags: [], content: 'x', created_at: 1 })).rejects.toThrow(/not your profile/);
    setGuest('logged-out', ME);
    await expect(session.signOwn({ kind: 0, tags: [], content: '{}', created_at: 1 })).rejects.toThrow(/guest/);
    expect(signEvent).toHaveBeenCalledOnce();
  });

  it('gives a logged-out tab one made-up pubkey', () => {
    const store = new Map<string, string>();
    const s = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    const a = guestPubkey(s);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(guestPubkey(s)).toBe(a);
    expect(guestPubkey(null)).not.toBe(a);
  });

  it('switches on and off', () => {
    expect(isGuest()).toBe(false);
    setGuest('logged-out', ME);
    expect(isGuest()).toBe(true);
    expect(guestAuthor()).toBe(ME);
    setGuest(null);
    expect(guestAuthor()).toBeNull();
  });
});
