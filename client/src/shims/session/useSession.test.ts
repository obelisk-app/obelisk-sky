import { describe, it, expect, vi, beforeEach } from 'vitest';

const uploads: string[] = [];
const uploadSigners: unknown[] = [];
vi.mock('../blossom', () => ({
  uploadToBlossom: async (file: File, _sk?: Uint8Array, sign?: unknown) => { uploads.push(file.name); uploadSigners.push(sign); return `https://blossom.example/${file.name}`; },
}));
/** What the relays do with a new account's first profile. */
let relayAnswer: (url: string) => Promise<string> = async () => 'ok';
const sentTo: string[][] = [];
vi.mock('@nostr-wot/data', async (orig) => ({
  ...(await orig<typeof import('@nostr-wot/data')>()),
  getPool: () => ({ publish: (relays: string[]) => { sentTo.push(relays); return relays.map((r) => relayAnswer(r)); } }),
}));

import { nip19 } from 'nostr-tools';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import type { VerifiedEvent } from 'nostr-tools';
import { generatedProfileRelays, publishGeneratedProfile, updateProfile } from './useSession';
import { registerHost } from '../host';
import { activeRelay } from '../../nostr/hub';
import type { ProfileEdit } from '../../nostr/ownProfile';
import type { ProfileFormValues } from '@/types/session/profile';

const blank: ProfileFormValues = { name: 'Ana', about: '', picture: '', banner: 'https://old/banner.png', nip05: '', lud16: '', website: '', pictureFile: null, bannerFile: null };

let pubkey: string | null = 'a'.repeat(64);
let gen = 1;
let edits: ProfileEdit[] = [];
let signedUp: VerifiedEvent[] = [];
const signOwn = async () => { throw new Error('unused'); };

beforeEach(() => {
  uploads.length = 0;
  uploadSigners.length = 0;
  sentTo.length = 0;
  relayAnswer = async () => 'ok';
  edits = [];
  signedUp = [];
  pubkey = 'a'.repeat(64);
  gen = 1;
  registerHost({
    login: async () => {},
    sign: async () => { throw new Error('unused'); },
    pubkey: () => pubkey,
    generation: () => gen,
    signOwn,
    editProfile: async (edit, assertCurrent) => { assertCurrent(); edits.push(edit); },
    ownProfileSigned: (ev) => { signedUp.push(ev); },
  });
});

describe("a new account's first profile (dex publishGeneratedProfile)", () => {
  const sk = generateSecretKey();
  const nsec = nip19.nsecEncode(sk);

  it('publishes name, about, picture and banner off the group relay, and hands the event to sky', async () => {
    await publishGeneratedProfile(nsec, { name: ' Ana ', about: ' Hago mate ', picture: 'https://b/p.png', banner: 'https://b/b.png' });
    expect(sentTo).toHaveLength(1);
    expect(sentTo[0]).toEqual(generatedProfileRelays());
    expect(sentTo[0]).not.toContain(activeRelay());
    expect(sentTo[0]).toEqual(expect.arrayContaining(['wss://relay.damus.io', 'wss://nos.lol', 'wss://purplepag.es']));
    expect(signedUp).toHaveLength(1);
    expect(signedUp[0].pubkey).toBe(getPublicKey(sk));
    expect(JSON.parse(signedUp[0].content)).toEqual({ name: 'Ana', display_name: 'Ana', about: 'Hago mate', picture: 'https://b/p.png', banner: 'https://b/b.png' });
  });

  it('makes up a name when none was typed', async () => {
    await publishGeneratedProfile(nsec, {});
    const c = JSON.parse(signedUp[0].content);
    expect(c.name.length).toBeGreaterThan(0);
    expect(c.display_name).toBe(c.name);
  });

  it('is done once one relay takes it', async () => {
    relayAnswer = async (url) => { if (url === 'wss://nos.lol') return 'ok'; throw new Error('blocked'); };
    await expect(publishGeneratedProfile(nsec, { name: 'x' })).resolves.toBeUndefined();
  });

  it('fails when no relay takes it, so the modal offers a retry and holds Enter back', async () => {
    relayAnswer = async () => { throw new Error('blocked'); };
    await expect(publishGeneratedProfile(nsec, { name: 'x' })).rejects.toBeTruthy();
    expect(signedUp).toHaveLength(0);
  });

  it('gives up after dex\'s timeout when the relays go quiet', async () => {
    vi.useFakeTimers();
    relayAnswer = () => new Promise(() => {});
    const out = publishGeneratedProfile(nsec, { name: 'x' });
    const done = expect(out).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(8_000);
    await done;
    vi.useRealTimers();
  });
});

describe('updateProfile (dex updateSessionProfile over sky)', () => {
  it('uploads a picked picture first and saves its URL', async () => {
    const seen: (string | null)[] = [];
    const file = new File(['x'], 'me.png', { type: 'image/png' });
    await updateProfile({ ...blank, pictureFile: file }, (w) => seen.push(w));
    expect(uploads).toEqual(['me.png']);
    // Signed as your own profile's (allowed on the guest island to a refused account).
    expect(uploadSigners).toHaveLength(1);
    expect(typeof uploadSigners[0]).toBe('function');
    expect(edits[0]).toMatchObject({ name: 'Ana', displayName: 'Ana', picture: 'https://blossom.example/me.png', banner: 'https://old/banner.png' });
    expect(seen[0]).toBe('picture');
    expect(seen.at(-1)).toBeNull();
  });

  it('refuses when logged out', async () => {
    pubkey = null;
    await expect(updateProfile(blank)).rejects.toMatchObject({ code: 'not-logged-in' });
  });

  it('drops the save when the account changes during an upload', async () => {
    const file = new File(['x'], 'b.png', { type: 'image/png' });
    const save = updateProfile({ ...blank, bannerFile: file }, (w) => { if (w === 'banner') gen = 2; });
    await expect(save).rejects.toThrow(/superseded/);
    expect(edits).toHaveLength(0);
  });
});
