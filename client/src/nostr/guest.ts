// The guest island (guest/): for people the relay doesn't let in, logged out
// or refused. While it is on, nothing is signed or published anywhere: the
// village runs on scripted events and the guest's own words stay in this tab.
//
// `setGuest` is the one switch. `publishToGroup` / `publishSigned` turn a
// template into a local unsigned event (`localEvent`), `SessionManager.sign`
// refuses, and `guardHub` makes the page hub's `publish` refuse too (DMs,
// profile edits, read-state and the voice bridge publish through it).

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

/** Make the hub refuse every publish while on the guest island (once per hub). */
export function guardHub(hub: RelayHub): RelayHub {
  const h = hub as GuardedHub;
  if (h[GUARDED]) return hub;
  const real = hub.publish.bind(hub);
  h[UNGUARDED] = real;
  h.publish = ((args: Parameters<RelayHub['publish']>[0]) => {
    if (!isGuest()) return real(args);
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
