// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RelayHub } from '@nostr-wot/relay/hub';
import type { NostrSigner } from '@nostr-wot/signers';
import { captureInvite, freshKeyLogin, inviteFor, inviteWaitingForKey, readInvite, redeemInvite, skyInviteLink, INVITE_KEY } from './invite';
import { guardHub, setGuest } from './guest';

const RELAY = 'wss://public.obelisk.ar';

function hubAnswering(status: 'ok' | 'rejected', reason: string | null) {
  const hub = { publish: vi.fn(async ({ relays }: { relays: string[] }) => relays.map((url) => ({ url, status, reason }))) };
  return hub as unknown as RelayHub & { publish: ReturnType<typeof vi.fn> };
}

const signer = {
  signEvent: vi.fn(async (t: { kind: number; tags: string[][] }) => ({ ...t, id: 'id', pubkey: 'pk1', sig: 'sig' })),
} as unknown as NostrSigner;

beforeEach(() => localStorage.clear());
afterEach(() => setGuest(null));

describe('relay invites in sky', () => {
  it('keeps the code from the address, drops it from the bar, and keeps the relay', () => {
    const replace = vi.fn();
    expect(captureInvite('https://sky.obelisk.ar/app?invite=Xk3abc&relay=public.obelisk.ar', replace)).toBe(RELAY);
    expect(replace).toHaveBeenCalledWith('/app?relay=public.obelisk.ar');
    expect(readInvite()).toEqual({ code: 'Xk3abc', relay: RELAY, redeemed: [] });
    expect(captureInvite('https://sky.obelisk.ar/app?relay=x', vi.fn())).toBeNull();
    expect(captureInvite('https://sky.obelisk.ar/app?invite=%3Cscript%3E', vi.fn())).toBeNull();
  });

  it('redeems for each new key, even on the guest island, and makes a key only for a fresh invite', async () => {
    captureInvite('https://sky.obelisk.ar/app?invite=Xk3abc', vi.fn());
    expect(inviteWaitingForKey(RELAY)).toBe(true);
    const hub = guardHub(hubAnswering('ok', null)) as RelayHub & { publish: ReturnType<typeof vi.fn> };
    // A refused account is on the guest island: the claim must still go out.
    setGuest('refused');
    const out = await redeemInvite(hub, signer, inviteFor(RELAY, 'pk1')!, 'pk1');
    expect(out).toEqual({ status: 'admitted' });
    expect(inviteFor(RELAY, 'pk1')).toBeNull();
    expect(inviteFor(RELAY, 'pk2')?.code).toBe('Xk3abc');
    expect(inviteWaitingForKey(RELAY)).toBe(false);
  });

  it('sends the claim to the invite relay only, without AUTH', async () => {
    captureInvite('https://sky.obelisk.ar/app?invite=Xk3abc', vi.fn());
    const hub = hubAnswering('ok', null);
    await redeemInvite(hub, signer, readInvite()!, 'pk1');
    const spec = hub.publish.mock.calls[0][0];
    expect(spec.relays).toEqual([RELAY]);
    expect(spec.authMode).toBe('never');
    expect(spec.event.kind).toBe(28934);
    expect(spec.event.tags).toEqual([['claim', 'Xk3abc']]);
  });

  it('drops a dead code and keeps one whose answer was unclear', async () => {
    captureInvite('https://sky.obelisk.ar/app?invite=Xk3abc', vi.fn());
    expect((await redeemInvite(hubAnswering('ok', 'no ack (ephemeral kind)'), signer, readInvite()!, 'pk1')).status).toBe('retry');
    expect(readInvite()).not.toBeNull();
    const dead = await redeemInvite(hubAnswering('rejected', 'restricted: invite expired: gone'), signer, readInvite()!, 'pk1');
    expect(dead).toEqual({ status: 'dead', reason: 'expired' });
    expect(localStorage.getItem(INVITE_KEY)).toBeNull();
  });

  it('makes a working key for a silent login, and shares sky links', () => {
    const args = freshKeyLogin();
    expect(args.method).toBe('generate');
    expect(args.pubkey).toMatch(/^[0-9a-f]{64}$/);
    expect(args.nsec).toMatch(/^nsec1/);
    expect(skyInviteLink('https://sky.obelisk.ar/', 'abc', 'wss://public.obelisk.ar/')).toBe('https://sky.obelisk.ar/invite/abc?relay=public.obelisk.ar');
  });
});
