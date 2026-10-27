// The page's RelayHub, set up the way obelisk-dex does it
// (src/services/nostr-bridge/facade/page-hub.ts): one socket per relay per
// identity, NIP-42 AUTH only where a lease is held, REQs re-issued on
// reconnect. Sky never opens its own SimplePool.

import { getRelayHub, SESSION_IDENTITY_ID, type Identity, type RelayHub } from '@nostr-wot/relay/hub';
import { TextCoercingWebSocket } from '@nostr-wot/data';
import { DEFAULT_PROFILE_LOOKUP_RELAYS } from '@/constants/nostr-bridge/profile';
import { DEFAULT_SOCIAL_RELAYS } from '@/constants/social/relays';

/** Obelisk's default group relay (obelisk-dex DEFAULT_RELAY). */
export const DEFAULT_GROUP_RELAY = 'wss://public.obelisk.ar';

/** Relays offered in the picker before the user adds their own
 *  (obelisk-dex src/constants/nostr-bridge/relay.ts). */
export const SUGGESTED_RELAYS = ['wss://public.obelisk.ar', 'wss://lacrypta-relay.obelisk.ar'];

let active = DEFAULT_GROUP_RELAY;

/** The relay being browsed. Groups live on one relay at a time (obelisk-dex's
 *  single-relay rule): everything group-related reads this at call time. */
export function activeRelay(): string {
  return active;
}

export function setActiveRelay(url: string): void {
  active = normalizeRelay(url) ?? active;
}

/** `wss://host[:port][/path]`, lowercase host, no trailing slash; null if not a relay URL. */
export function normalizeRelay(raw: string): string | null {
  let s = raw.trim();
  if (!s) return null;
  if (!/^wss?:\/\//i.test(s)) s = `wss://${s}`;
  try {
    const u = new URL(s);
    if (u.protocol !== 'wss:' && !(u.protocol === 'ws:' && /^(localhost|127\.)/.test(u.hostname))) return null;
    if (!u.hostname.includes('.') && u.hostname !== 'localhost') return null;
    return `${u.protocol}//${u.host.toLowerCase()}${u.pathname.replace(/\/+$/, '')}`;
  } catch {
    return null;
  }
}

/** Kind 0 lookups, both tiers obelisk-dex's `useAuthor` merges: the group
 *  relays' profile lookup set and the default social relays (people who only
 *  publish their profile to the wider network). No AUTH lease on any of them
 *  except the group relay, so the user's pubkey stays off the rest. */
const BASE_PROFILE_RELAYS = [...DEFAULT_PROFILE_LOOKUP_RELAYS, ...DEFAULT_SOCIAL_RELAYS];
export function profileRelays(): string[] {
  return [...new Set([active, ...BASE_PROFILE_RELAYS])];
}

/** The profile relays other than the group relay: open to any key, where a
 *  refused account's profile and look go (and a new account's first profile). */
export function publicProfileRelays(): string[] {
  return profileRelays().filter((r) => r !== active);
}

export const ANONYMOUS_IDENTITY: Identity = { id: SESSION_IDENTITY_ID, pubkey: null, signer: null, authPolicy: 'auth-when-challenged' };

let hub: RelayHub | null = null;

export function pageHub(): RelayHub {
  hub ??= getRelayHub({
    connectTimeoutMs: 8000,
    transport: { websocketImplementation: TextCoercingWebSocket as unknown as typeof WebSocket, enablePing: true },
  });
  return hub;
}
