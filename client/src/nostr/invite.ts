/**
 * Relay invitation codes in sky, as obelisk-dex does them
 * (vendor/obelisk/docs/features/relay-invites.md; relay side: obelisk-relay
 * docs/relay-invites.md). A link `/invite/<code>?relay=<host>` (the server
 * sends it on to `/app?invite=<code>&relay=<host>`) keeps the code here; with
 * no account a key is made for the person; every key in use on that relay is
 * then redeemed with a NIP-43 claim, so a key made later gets in too. An
 * unknown relay is only gone to once the person says so (`inviteRelayStart`).
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

/** Refusals worth one more try at once: a stale clock read, or no answer. */
function retryable(status: string | undefined, reason: string | null): boolean {
  return reason === 'stale' || !status || status === 'timeout' || status === 'unreachable';
}

/**
 * Send the claim, signed by the account's own signer (not `session.sign`,
 * which refuses on the guest island: a refused account is exactly who sends
 * this), to the invite's relay only, without AUTH, past the guest guard.
 * A `stale` refusal or a timeout is tried once more after `retryDelayMs`,
 * with a fresh `created_at` (obelisk-relay docs/relay-invites.md §6 step 6).
 */
export async function redeemInvite(
  hub: RelayHub, signer: NostrSigner, invite: StoredRelayInvite, pubkey: string,
  opts: { retryDelayMs?: number } = {},
): Promise<RedeemOutcome> {
  let last: { status?: string; reason?: string | null } | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, opts.retryDelayMs ?? 1500));
    const event = await signer.signEvent(relayInviteClaimTemplate(invite.code, Math.floor(Date.now() / 1000))) as VerifiedEvent;
    const [row] = await publishPastGuestGuard(hub, {
      relays: [invite.relay], event, authMode: 'never', ackTimeoutMs: RELAY_INVITE_CLAIM_TIMEOUT_MS,
    });
    last = row;
    if (row?.status === 'ok' && !row.reason) {
      markRedeemed(pubkey);
      return { status: 'admitted' };
    }
    const reason = relayInviteRefusalReason(row?.reason);
    if (isDeadInviteReason(reason)) {
      forgetInvite();
      return { status: 'dead', reason };
    }
    if (!retryable(row?.status, reason)) break;
  }
  return { status: 'retry', reason: last?.reason ?? last?.status ?? null };
}

/** Whether a `retry` outcome was the relay saying this device's clock is off. */
export function isStaleClaim(reason: string | null): boolean {
  return relayInviteRefusalReason(reason) === 'stale';
}

// ── which relay an invite link may take you to (§6 step 2) ───────────────

const relayKey = (r: string) => r.trim().toLowerCase().replace(/^wss?:\/\//, '').replace(/\/+$/, '');

/**
 * The relay to start on. An invite link's relay is switched to by itself only
 * when the app already knows it (the suggested relays, your own, the one you
 * were on); an unknown one is handed back in `confirm` and you stay on
 * `saved` until you say yes, so a link can't quietly point you at someone's relay.
 */
export function inviteRelayStart(
  inviteRelay: string | null, urlRelay: string | null, known: readonly string[], saved: string,
): { relay: string; confirm: string | null } {
  if (!inviteRelay) return { relay: urlRelay ?? saved, confirm: null };
  if (known.some((k) => relayKey(k) === relayKey(inviteRelay))) return { relay: inviteRelay, confirm: null };
  return { relay: saved, confirm: inviteRelay };
}

// ── the relay's minter API (NIP-98), for "Invite people" ─────────────────

/** Why this account may invite on a relay; null: it may not. */
export type InviteBasis = 'owner' | 'admin' | 'reference' | 'grant' | null;

export interface InviteRedemption {
  pubkey: string;
  npub?: string;
  at: number;
  /** Set when an admin removed this person afterwards. */
  evicted_at?: number | null;
}

export interface InviteCode {
  code: string;
  label?: string | null;
  status: 'active' | 'revoked' | 'expired' | 'exhausted';
  max_uses: number | null;
  uses: number;
  expires_at: number | null;
  revoked_at?: number | null;
  created_at?: number;
  redemptions: InviteRedemption[];
}

export interface InviteStatus {
  /** Missing on a relay older than the allowance; `can_mint` decides there. */
  basis?: InviteBasis;
  admits_total?: number | null;
  admits_used?: number | null;
  admits_left: number | null;
  codes_left: number | null;
  can_mint: boolean;
  is_admin: boolean;
  invited_by?: { code: string; pubkey: string; npub?: string; at: number } | null;
  grant?: { max_ttl_secs?: number | null } | null;
  codes: InviteCode[];
}

export interface CreateInviteOptions {
  label?: string;
  max_uses?: number;
  expires_in?: number;
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

/** `GET /api/invites/me`, signed for `relay`'s own URL; throws when it fails. */
export function loadInviteStatus(sign: Sign, relay: string): Promise<InviteStatus> {
  return call<InviteStatus>(sign, relay, '/me', 'GET').then((me) => ({ ...me, codes: Array.isArray(me?.codes) ? me.codes : [] }));
}

/** Null on a relay with no invite API, or when the request fails. */
export function inviteStatus(sign: Sign, relay: string): Promise<InviteStatus | null> {
  return loadInviteStatus(sign, relay).catch(() => null);
}

/**
 * Whether "Invite people" is offered: the relay gives this account a basis
 * (even with the allowance spent, to see who joined), or it has links.
 */
export function mayInvite(me: InviteStatus | null): boolean {
  if (!me) return false;
  return (me.basis !== undefined ? me.basis !== null : me.can_mint) || me.codes.length > 0;
}

/** The relay clamps every field to what the account has left. */
export function createInvite(sign: Sign, relay: string, opts: CreateInviteOptions = {}): Promise<InviteCode> {
  const body: CreateInviteOptions = { expires_in: opts.expires_in ?? RELAY_INVITE_DEFAULT_TTL_SECS };
  if (opts.label?.trim()) body.label = opts.label.trim();
  if (opts.max_uses) body.max_uses = opts.max_uses;
  return call<InviteCode>(sign, relay, '', 'POST', body);
}

export function revokeInvite(sign: Sign, relay: string, code: string): Promise<void> {
  return call<void>(sign, relay, `/${encodeURIComponent(code)}`, 'DELETE');
}

/** The link to share: sky's own `/invite/<code>`. */
export function skyInviteLink(origin: string, code: string, relay: string): string {
  return `${origin.replace(/\/+$/, '')}/invite/${encodeURIComponent(code)}?relay=${encodeURIComponent(relay.replace(/^wss?:\/\//, '').replace(/\/+$/, ''))}`;
}
