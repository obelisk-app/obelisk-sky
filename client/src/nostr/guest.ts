// The guest island (guest/): for people the relay doesn't let in, logged out
// or refused. While it is on, nothing the village sees is signed or
// published: it runs on scripted events and the guest's own words stay in
// this tab.
//
// `setGuest` is the one switch. `publishToGroup` / `publishSigned` turn a
// template into a local unsigned event (`localEvent`), `SessionManager.sign`
// refuses, and `guardHub` makes the page hub's `publish` refuse too (DMs,
// read-state and the voice bridge publish through it).
//
// One exception, for a refused account (a real key the relay hasn't admitted
// yet): its own profile and look are its own, not the village's, so they are
// edited as anywhere else (`isOwnWrite`, `SessionManager.signOwn`) and go to
// the public profile relays; the group relay gets them once it admits you.

import { getEventHash, type EventTemplate, type VerifiedEvent } from 'nostr-tools';
import type { RelayHub } from '@nostr-wot/relay/hub';

export type GuestReason = 'logged-out' | 'refused';

let reason: GuestReason | null = null;
let author: string | null = null;

/** True on the guest island: nothing may be signed or published. */
export function isGuest(): boolean {
  return reason !== null;
}

export function guestReason(): GuestReason | null {
  return reason;
}

/** Who your local events are from: your own pubkey when refused, a per-tab one when logged out. */
export function guestAuthor(): string | null {
  return author;
}

/** Your look's d-tag (nostr/avatars.ts `AVATAR_D_TAG`; kept here so this
 *  module doesn't pull in the people models). */
const LOOK_D_TAG = 'obelisk:avatar3d:v1';

/**
 * Yours rather than the village's: your profile (kind 0), your look (kind
 * 30078 `obelisk:avatar3d:v1`) and the Blossom upload grant (kind 24242) for
 * its picture and banner.
 */
export function isOwnWrite(t: Pick<EventTemplate, 'kind' | 'tags'>): boolean {
  if (t.kind === 0 || t.kind === 24242) return true;
  return t.kind === 30078 && t.tags.some((x) => x[0] === 'd' && x[1] === LOOK_D_TAG);
}

/** May your profile and look be signed and published now? Off the island, and
 *  on it for a refused account (a logged-out guest has no key). */
export function ownWritesAllowed(): boolean {
  return reason !== 'logged-out';
}

/** On (with why, and whose your words are) or off (`null`). */
export function setGuest(r: GuestReason | null, pubkey: string | null = null): void {
  reason = r;
  author = r ? pubkey : null;
}

const GUEST_PK_KEY = 'obelisk-sky/guest-pk';

/** A pubkey for a logged-out visitor, the same for this tab. Random bytes, not
 *  a key anyone holds: it only names the guest's character and local words. */
export function guestPubkey(storage: Pick<Storage, 'getItem' | 'setItem'> | null = safeSession()): string {
  try {
    const kept = storage?.getItem(GUEST_PK_KEY);
    if (kept && /^[0-9a-f]{64}$/.test(kept)) return kept;
  } catch { /* storage blocked */ }
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const pk = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  try { storage?.setItem(GUEST_PK_KEY, pk); } catch { /* storage blocked */ }
  return pk;
}

function safeSession(): Storage | null {
  try { return typeof sessionStorage === 'undefined' ? null : sessionStorage; } catch { return null; }
}

/** A template as a local event: hashed id, no signature. Never leaves the page. */
export function localEvent(t: EventTemplate, pubkey: string): VerifiedEvent {
  const ev = { kind: t.kind, tags: t.tags.map((x) => [...x]), content: t.content, created_at: t.created_at, pubkey };
  return { ...ev, id: getEventHash(ev), sig: '' } as unknown as VerifiedEvent;
}

const GUARDED = Symbol('sky-guest-guard');
const UNGUARDED = Symbol('sky-guest-unguarded');

type GuardedHub = RelayHub & { [GUARDED]?: true; [UNGUARDED]?: RelayHub['publish'] };

/** Make the hub refuse every publish while on the guest island (once per hub),
 *  but a refused account's own profile and look (`isOwnWrite`). */
export function guardHub(hub: RelayHub): RelayHub {
  const h = hub as GuardedHub;
  if (h[GUARDED]) return hub;
  const real = hub.publish.bind(hub);
  h[UNGUARDED] = real;
  h.publish = ((args: Parameters<RelayHub['publish']>[0]) => {
    if (!isGuest()) return real(args);
    if (reason === 'refused' && args.event.pubkey === author && isOwnWrite(args.event)) return real(args);
    return Promise.resolve(args.relays.map((url) => ({ url, status: 'rejected' as const, reason: 'blocked: guest island (nothing is published)' })));
  }) as RelayHub['publish'];
  h[GUARDED] = true;
  return hub;
}

/**
 * Publish past the guest guard. One caller only: a relay invite claim
 * (`nostr/invite.ts`), the event a refused account must send to stop being
 * refused, and which the relay never stores or relays. Nothing else may use it.
 */
export function publishPastGuestGuard(hub: RelayHub, args: Parameters<RelayHub['publish']>[0]): ReturnType<RelayHub['publish']> {
  const real = (hub as GuardedHub)[UNGUARDED];
  return real ? real(args) : hub.publish(args);
}
