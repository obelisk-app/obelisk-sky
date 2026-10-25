import { describe, it, expect, vi } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import type { EventTemplate } from 'nostr-tools';
import { editOwnProfile, initialOf, mergeProfile, newestKind0, syncOwnProfile } from './ownProfile';
import { activeRelay } from './hub';

const sk = generateSecretKey();
const pk = getPublicKey(sk);
const sign = async (t: EventTemplate) => finalizeEvent(t, sk);
const kind0 = (content: Record<string, unknown>, at: number) => finalizeEvent({ kind: 0, created_at: at, tags: [], content: JSON.stringify(content) }, sk);

function fakeHub(events: ReturnType<typeof kind0>[], complete: boolean, accept = true) {
  const published: { relays: readonly string[]; content: Record<string, unknown>; created_at: number }[] = [];
  const hub = {
    query: vi.fn(async () => ({ events, complete, fromCache: false, perRelay: {} })),
    publish: vi.fn(async (spec: { relays: readonly string[]; event: { content: string; created_at: number } }) => {
      published.push({ relays: spec.relays, content: JSON.parse(spec.event.content), created_at: spec.event.created_at });
      return spec.relays.map((url) => ({ url, status: accept ? 'ok' as const : 'rejected' as const, reason: accept ? null : 'blocked' }));
    }),
  };
  return { hub, published };
}

describe('mergeProfile', () => {
  it('keeps keys the editor does not know and replaces the edited ones', () => {
    const merged = mergeProfile(
      { name: 'old', display_name: 'Old', about: 'hi', bot: true, pronouns: 'they', lud06: 'lnurl1…' },
      { name: 'New', displayName: 'New', about: '', lud16: 'me@wallet.com' },
    );
    expect(merged).toEqual({ name: 'New', display_name: 'New', about: '', bot: true, pronouns: 'they', lud06: 'lnurl1…', lud16: 'me@wallet.com' });
  });

  it('leaves a field alone when the edit does not set it', () => {
    expect(mergeProfile({ picture: 'https://a/p.png' }, { name: 'x' })).toEqual({ picture: 'https://a/p.png', name: 'x' });
  });
});

describe('newestKind0 / initialOf', () => {
  it('picks the newest kind 0 of that author', () => {
    const a = kind0({ name: 'a' }, 100);
    const b = kind0({ name: 'b' }, 200);
    expect(newestKind0([a, b], pk)?.id).toBe(b.id);
    expect(newestKind0([a, b], 'f'.repeat(64))).toBeNull();
  });

  it('reads the editor fields, display name first', () => {
    const init = initialOf(kind0({ name: 'n', display_name: 'D', banner: 'https://b', website: 'https://w', extra: 1 }, 1));
    expect(init).toMatchObject({ displayName: 'D', name: 'n', banner: 'https://b', website: 'https://w', about: null });
  });
});

describe('editOwnProfile', () => {
  it('merges into the relays\' newest profile and publishes it everywhere', async () => {
    const now = Math.floor(Date.now() / 1000);
    const { hub, published } = fakeHub([kind0({ name: 'old', bot: false }, now - 50), kind0({ name: 'older', gone: 1 }, now - 500)], true);
    const ev = await editOwnProfile({ hub: hub as never, pubkey: pk, sign }, { name: 'Ana', displayName: 'Ana', website: 'https://ana.ar' });
    expect(JSON.parse(ev.content)).toEqual({ name: 'Ana', display_name: 'Ana', bot: false, website: 'https://ana.ar' });
    expect(ev.pubkey).toBe(pk);
    expect(hub.query).toHaveBeenCalledWith(expect.objectContaining({ cache: { mode: 'bypass' }, filters: [{ kinds: [0], authors: [pk], limit: 5 }] }));
    const relays = published.flatMap((p) => p.relays);
    expect(relays).toContain(activeRelay());
    expect(relays.length).toBeGreaterThan(1);
  });

  it('refuses to publish when nothing loaded and the query did not finish', async () => {
    const { hub, published } = fakeHub([], false);
    await expect(editOwnProfile({ hub: hub as never, pubkey: pk, sign }, { name: 'x' })).rejects.toMatchObject({ code: 'profile-load-failed' });
    expect(published).toHaveLength(0);
  });

  it('publishes a first profile when every relay answered with none', async () => {
    const { hub } = fakeHub([], true);
    const ev = await editOwnProfile({ hub: hub as never, pubkey: pk, sign }, { name: 'First' });
    expect(JSON.parse(ev.content)).toEqual({ name: 'First' });
  });

  it('is never older than the profile it replaces', async () => {
    const future = Math.floor(Date.now() / 1000) + 100;
    const { hub } = fakeHub([kind0({ name: 'x' }, future)], true);
    const ev = await editOwnProfile({ hub: hub as never, pubkey: pk, sign }, { name: 'y' });
    expect(ev.created_at).toBe(future + 1);
  });

  it('fails when no relay takes it', async () => {
    const { hub } = fakeHub([], true, false);
    await expect(editOwnProfile({ hub: hub as never, pubkey: pk, sign }, { name: 'z' })).rejects.toThrow(/No relay/);
  });

  it('stops when the account changed while loading', async () => {
    const { hub, published } = fakeHub([], true);
    const abort = () => { throw new DOMException('superseded', 'AbortError'); };
    await expect(editOwnProfile({ hub: hub as never, pubkey: pk, sign }, { name: 'z' }, abort)).rejects.toThrow(/superseded/);
    expect(published).toHaveLength(0);
  });
});

describe('syncOwnProfile', () => {
  /** A hub whose group relay holds `onGroup` and the other relays `elsewhere`. */
  function relayHub(onGroup: ReturnType<typeof kind0>[], elsewhere: ReturnType<typeof kind0>[]) {
    const published: { relays: readonly string[]; id: string }[] = [];
    const hub = {
      query: vi.fn(async (spec: { relays: readonly string[] }) => ({
        events: spec.relays.includes(activeRelay()) ? onGroup : elsewhere, complete: true, fromCache: false, perRelay: {},
      })),
      publish: vi.fn(async (spec: { relays: readonly string[]; event: { id: string } }) => {
        published.push({ relays: spec.relays, id: spec.event.id });
        return spec.relays.map((url) => ({ url, status: 'ok' as const, reason: null }));
      }),
    };
    return { hub, published };
  }

  it('copies a newer profile from the other relays to the group relay, unchanged', async () => {
    const edited = kind0({ name: 'edited' }, 200);
    const { hub, published } = relayHub([kind0({ name: 'old' }, 100)], [edited]);
    expect(await syncOwnProfile({ hub: hub as never, pubkey: pk })).toBe('republished');
    expect(published).toEqual([{ relays: [activeRelay()], id: edited.id }]);
  });

  it('copies it to a group relay that has none', async () => {
    const edited = kind0({ name: 'edited' }, 200);
    const { hub, published } = relayHub([], [edited]);
    expect(await syncOwnProfile({ hub: hub as never, pubkey: pk })).toBe('republished');
    expect(published[0].id).toBe(edited.id);
  });

  it('uses the profile just saved when no relay returned it', async () => {
    const saved = kind0({ name: 'saved' }, 300);
    const { hub, published } = relayHub([kind0({ name: 'old' }, 100)], []);
    expect(await syncOwnProfile({ hub: hub as never, pubkey: pk }, saved)).toBe('republished');
    expect(published[0].id).toBe(saved.id);
  });

  it('leaves a group relay that is up to date alone', async () => {
    const same = kind0({ name: 'same' }, 200);
    const { hub, published } = relayHub([same], [kind0({ name: 'older' }, 100)]);
    expect(await syncOwnProfile({ hub: hub as never, pubkey: pk })).toBe('current');
    expect(published).toHaveLength(0);
  });

  it('does nothing without a profile anywhere', async () => {
    const { hub, published } = relayHub([], []);
    expect(await syncOwnProfile({ hub: hub as never, pubkey: pk })).toBe('none');
    expect(published).toHaveLength(0);
  });
});
