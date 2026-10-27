/**
 * Relay invitation codes in sky, as obelisk-dex does them
 * (vendor/obelisk/docs/features/relay-invites.md; relay side: obelisk-relay
 * docs/relay-invites.md). A link `/invite/<code>?relay=<host>` (the server
 * sends it on to `/app?invite=<code>&relay=<host>`) keeps the code here; with
 * no account a key is made for the person; every key in use on that relay is
 * then redeemed with a NIP-43 claim, so a key made later gets in too.
 */
import type { RelayHub } from '@nostr-wot/relay/hub';
import { PrivateKeySigner, type NostrSigner } from '@nostr-wot/signers';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { nsecEncode } from 'nostr-tools/nip19';
import type { EventTemplate, VerifiedEvent } from 'nostr-tools';
import { KIND_HTTP_AUTH } from '@/constants/nostr/nip-kinds';
import { RELAY_INVITE_CLAIM_TIMEOUT_MS, RELAY_INVITE_DEFAULT_TTL_SECS } from '@/constants/relay/relay-invite';
import {
  cleanInviteCode,
  inviteLinkRelay,
  inviteNeedsRedeem,
  isDeadInviteReason,
  relayInviteApiUrl,
  relayInviteClaimTemplate,
  relayInviteRefusalReason,
  type RelayInviteDeadReason,
  type StoredRelayInvite,
} from '@/utils/relay/relay-invite';
import { publishPastGuestGuard } from './guest';
import type { LoginArgs } from './session';

export const INVITE_KEY = 'obelisk-sky/invite';

export type RedeemOutcome =
  | { status: 'admitted' }
  | { status: 'dead'; reason: RelayInviteDeadReason }
  | { status: 'retry'; reason: string | null };

function store(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

export function readInvite(): StoredRelayInvite | null {
  try {
    const raw = store()?.getItem(INVITE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<StoredRelayInvite>;
    if (typeof p.code !== 'string' || typeof p.relay !== 'string') return null;
    return { code: p.code, relay: p.relay, redeemed: Array.isArray(p.redeemed) ? p.redeemed.filter((x) => typeof x === 'string') : [] };
  } catch {
    return null;
  }
}

function writeInvite(invite: StoredRelayInvite | null): void {
  try {
    if (invite) store()?.setItem(INVITE_KEY, JSON.stringify(invite));
    else store()?.removeItem(INVITE_KEY);
  } catch { /* private mode: this visit only */ }
}

/** Keep a code; the same code again keeps the keys it already let in. */
export function keepInvite(code: string, relay: string): void {
  const prev = readInvite();
  writeInvite({ code, relay, redeemed: prev && prev.code === code && prev.relay === relay ? prev.redeemed : [] });
}

export function forgetInvite(): void { writeInvite(null); }

/**
 * Read `?invite=` off the address (and its `?relay=`), keep it, and take the
 * code out of the address bar so a shared screenshot or copied URL doesn't
 * carry it. Returns the invite's relay, or null when there was none.
 */
export function captureInvite(href: string, replace: (url: string) => void): string | null {
  const url = new URL(href);
  const code = cleanInviteCode(url.searchParams.get('invite'));
  if (!url.searchParams.has('invite')) return null;
  url.searchParams.delete('invite');
  replace(url.pathname + url.search + url.hash);
  if (!code) return null;
  const relay = inviteLinkRelay(url.searchParams.get('relay') ?? undefined);
  keepInvite(code, relay);
  return relay;
}

/** The stored invite, when `pubkey` still has to be let in with it on `relay`. */
export function inviteFor(relay: string, pubkey: string): StoredRelayInvite | null {
  const invite = readInvite();
  return inviteNeedsRedeem(invite, relay, pubkey) ? invite : null;
}

/** A fresh invite for `relay` (no key let in yet): with no account, make one. */
export function inviteWaitingForKey(relay: string): boolean {
  const invite = readInvite();
  return !!invite && invite.redeemed.length === 0 && inviteNeedsRedeem(invite, relay, 'any');
}

function markRedeemed(pubkey: string): void {
  const invite = readInvite();
  if (invite && !invite.redeemed.includes(pubkey)) writeInvite({ ...invite, redeemed: [...invite.redeemed, pubkey] });
}

/** A new key's login, for `SessionManager.login`: no widget, no backup steps (offered later). */
export function freshKeyLogin(): LoginArgs {
  const sk = generateSecretKey();
  const hex = Array.from(sk, (b) => b.toString(16).padStart(2, '0')).join('');
  return { signer: new PrivateKeySigner(hex), pubkey: getPublicKey(sk), method: 'generate', nsec: nsecEncode(sk) };
}

/**
 * Send the claim, signed by the account's own signer (not `session.sign`,
 * which refuses on the guest island: a refused account is exactly who sends
 * this), to the invite's relay only, without AUTH, past the guest guard.
 */
export async function redeemInvite(hub: RelayHub, signer: NostrSigner, invite: StoredRelayInvite, pubkey: string): Promise<RedeemOutcome> {
  const event = await signer.signEvent(relayInviteClaimTemplate(invite.code, Math.floor(Date.now() / 1000))) as VerifiedEvent;
  const [row] = await publishPastGuestGuard(hub, {
    relays: [invite.relay], event, authMode: 'never', ackTimeoutMs: RELAY_INVITE_CLAIM_TIMEOUT_MS,
  });
  if (row?.status === 'ok' && !row.reason) {
    markRedeemed(pubkey);
    return { status: 'admitted' };
  }
  const reason = relayInviteRefusalReason(row?.reason);
  if (isDeadInviteReason(reason)) {
    forgetInvite();
    return { status: 'dead', reason };
  }
  return { status: 'retry', reason: row?.reason ?? null };
}

// ── the relay's minter API (NIP-98), for "Invite people" ─────────────────

export interface InviteCode {
  code: string;
  status: 'active' | 'revoked' | 'expired' | 'exhausted';
  max_uses: number | null;
  uses: number;
  expires_at: number | null;
  redemptions: { pubkey: string; at: number }[];
}

export interface InviteStatus {
  can_mint: boolean;
  is_admin: boolean;
  codes_left: number | null;
  admits_left: number | null;
  codes: InviteCode[];
}

type Sign = (t: EventTemplate) => Promise<VerifiedEvent>;

async function call<T>(sign: Sign, relay: string, path: string, method: 'GET' | 'POST' | 'DELETE', body?: unknown): Promise<T> {
  const url = relayInviteApiUrl(relay, path);
  const auth = await sign({ kind: KIND_HTTP_AUTH, created_at: Math.floor(Date.now() / 1000), content: '', tags: [['u', url], ['method', method]] });
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Nostr ${btoa(JSON.stringify(auth))}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw new Error(await res.json().then((b: { error?: string }) => b.error ?? `HTTP ${res.status}`).catch(() => `HTTP ${res.status}`));
  return (res.status === 204 ? undefined : await res.json()) as T;
}

/** Null on a relay with no invite API, or when the request fails: no "Invite people" then. */
export function inviteStatus(sign: Sign, relay: string): Promise<InviteStatus | null> {
  return call<InviteStatus>(sign, relay, '/me', 'GET').catch(() => null);
}

export function createInvite(sign: Sign, relay: string): Promise<InviteCode> {
  return call<InviteCode>(sign, relay, '', 'POST', { expires_in: RELAY_INVITE_DEFAULT_TTL_SECS });
}

export function revokeInvite(sign: Sign, relay: string, code: string): Promise<void> {
  return call<void>(sign, relay, `/${encodeURIComponent(code)}`, 'DELETE');
}

/** The link to share: sky's own `/invite/<code>`. */
export function skyInviteLink(origin: string, code: string, relay: string): string {
  return `${origin.replace(/\/+$/, '')}/invite/${encodeURIComponent(code)}?relay=${encodeURIComponent(relay.replace(/^wss?:\/\//, '').replace(/\/+$/, ''))}`;
}
