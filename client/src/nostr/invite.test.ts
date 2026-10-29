// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RelayHub } from '@nostr-wot/relay/hub';
import type { NostrSigner } from '@nostr-wot/signers';
import { captureInvite, freshKeyLogin, inviteFor, inviteRelayStart, inviteWaitingForKey, isStaleClaim, mayInvite, readInvite, redeemInvite, skyInviteLink, INVITE_KEY, type InviteStatus } from './invite';
import { guardHub, setGuest } from './guest';

const RELAY = 'wss://public.obelisk.ar';

type Row = { status: 'ok' | 'rejected' | 'timeout'; reason: string | null };
/** A hub that answers each publish with the next row (the last one repeats). */
function hubAnswering(status: Row['status'], reason: string | null, ...then: Row[]) {
  const rows: Row[] = [{ status, reason }, ...then];
  let i = 0;
  const hub = { publish: vi.fn(async ({ relays }: { relays: string[] }) => { const r = rows[Math.min(i++, rows.length - 1)]; return relays.map((url) => ({ url, ...r })); }) };
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
    expect((await redeemInvite(hubAnswering('ok', 'no ack (ephemeral kind)'), signer, readInvite()!, 'pk1', { retryDelayMs: 0 })).status).toBe('retry');
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

  it('retries a stale claim once with a fresh created_at, and gives up after the second', async () => {
    captureInvite('https://sky.obelisk.ar/app?invite=Xk3abc', vi.fn());
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValueOnce(1_000_000_000).mockReturnValue(1_000_005_000);
    const hub = hubAnswering('rejected', 'restricted: invite stale: clock', { status: 'ok', reason: null });
    expect(await redeemInvite(hub, signer, readInvite()!, 'pk1', { retryDelayMs: 0 })).toEqual({ status: 'admitted' });
    expect(hub.publish).toHaveBeenCalledTimes(2);
    const [first, second] = hub.publish.mock.calls.map((c) => c[0].event.created_at);
    expect(second).toBeGreaterThan(first);
    now.mockRestore();

    const stuck = hubAnswering('rejected', 'restricted: invite stale: clock');
    const out = await redeemInvite(stuck, signer, readInvite()!, 'pk2', { retryDelayMs: 0 });
    expect(stuck.publish).toHaveBeenCalledTimes(2);
    expect(out.status).toBe('retry');
    expect(out.status === 'retry' && isStaleClaim(out.reason)).toBe(true);

    const quiet = hubAnswering('timeout', null);
    expect((await redeemInvite(quiet, signer, readInvite()!, 'pk2', { retryDelayMs: 0 })).status).toBe('retry');
    expect(quiet.publish).toHaveBeenCalledTimes(2);
    // An ordinary refusal is not retried at once.
    const refused = hubAnswering('rejected', 'restricted: not whitelisted');
    await redeemInvite(refused, signer, readInvite()!, 'pk2', { retryDelayMs: 0 });
    expect(refused.publish).toHaveBeenCalledTimes(1);
  });

  it('goes to an invite relay by itself only when it is known, and asks for an unknown one', () => {
    const known = ['wss://public.obelisk.ar', 'wss://lacrypta-relay.obelisk.ar', 'wss://mine.example'];
    expect(inviteRelayStart('wss://lacrypta-relay.obelisk.ar', 'wss://lacrypta-relay.obelisk.ar', known, RELAY))
      .toEqual({ relay: 'wss://lacrypta-relay.obelisk.ar', confirm: null });
    expect(inviteRelayStart('wss://Mine.example/', null, known, RELAY).confirm).toBeNull();
    expect(inviteRelayStart('wss://evil.example', 'wss://evil.example', known, RELAY))
      .toEqual({ relay: RELAY, confirm: 'wss://evil.example' });
    // No invite: an ordinary ?relay= link, as before.
    expect(inviteRelayStart(null, 'wss://other.example', known, RELAY)).toEqual({ relay: 'wss://other.example', confirm: null });
    expect(inviteRelayStart(null, null, known, RELAY)).toEqual({ relay: RELAY, confirm: null });
  });

  it('offers Invite people to an account with a basis even once its allowance is spent, or with links', () => {
    const base: InviteStatus = { basis: null, admits_left: 0, codes_left: 0, can_mint: false, is_admin: false, codes: [] };
    expect(mayInvite(null)).toBe(false);
    expect(mayInvite(base)).toBe(false);
    expect(mayInvite({ ...base, basis: 'reference', admits_total: 10, admits_left: 0 })).toBe(true);
    expect(mayInvite({ ...base, codes: [{ code: 'c', status: 'exhausted', max_uses: 1, uses: 1, expires_at: null, redemptions: [] }] })).toBe(true);
    // A relay older than the allowance sends no basis: can_mint decides.
    const old = { ...base, basis: undefined };
    expect(mayInvite({ ...old, can_mint: true })).toBe(true);
    expect(mayInvite(old)).toBe(false);
  });
});
