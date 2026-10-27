// Your own kind 0, edited the way obelisk-dex does it
// (src/services/nostr-bridge/profile/profile-own.ts OwnProfileModule.edit):
// the relays' newest copy is read past every cache, the edited fields are
// merged into it (keys the editor doesn't know are kept), and nothing is
// published when the current profile couldn't be loaded, so an edit never
// wipes a profile. Sky's own profile cache keeps only a few fields, which is
// why the raw event is read again here.
//
// A refused account (the guest island, nostr/guest.ts) edits its profile the
// same way, through the public profile relays only: the group relay would
// refuse it, and `syncOwnProfile` copies it there once you're admitted.

import type { Event as NostrEvent, EventTemplate, VerifiedEvent } from 'nostr-tools';
import type { RelayHub } from '@nostr-wot/relay/hub';
import { CodedError } from '@/utils/errors/codes';
import { PROFILE_LOOKUP_MAX_WAIT_MS } from '@/constants/nostr-bridge/profile';
import type { ProfileEditorInitial } from '@/types/session/profile';
import { activeRelay, profileRelays, publicProfileRelays } from './hub';
import { publishSigned } from './publish';
import { isGuest, ownWritesAllowed } from './guest';

/** The fields the editor sets (obelisk-dex EditUserMetadataOptions). */
export interface ProfileEdit {
  name?: string;
  displayName?: string;
  about?: string;
  picture?: string;
  banner?: string;
  nip05?: string;
  website?: string;
  lud16?: string;
}

export interface OwnProfileDeps {
  hub: Pick<RelayHub, 'query' | 'publish'>;
  pubkey: string;
  sign(t: EventTemplate): Promise<VerifiedEvent>;
}

/** The newest of the events (latest `created_at`, ties broken by id as dex's newestEvent). */
export function newestKind0(events: readonly NostrEvent[], pubkey: string): NostrEvent | null {
  let best: NostrEvent | null = null;
  for (const e of events) {
    if (e.kind !== 0 || e.pubkey !== pubkey) continue;
    if (!best || e.created_at > best.created_at || (e.created_at === best.created_at && e.id < best.id)) best = e;
  }
  return best;
}

function parseContent(ev: NostrEvent | null): Record<string, unknown> {
  if (!ev) return {};
  try {
    const j = JSON.parse(ev.content) as unknown;
    return j && typeof j === 'object' && !Array.isArray(j) ? (j as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** The existing profile with the edited fields over it; unknown keys stay. */
export function mergeProfile(existing: Record<string, unknown>, edit: ProfileEdit): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...existing };
  if (edit.name !== undefined) merged.name = edit.name;
  if (edit.displayName !== undefined) merged.display_name = edit.displayName;
  if (edit.about !== undefined) merged.about = edit.about;
  if (edit.picture !== undefined) merged.picture = edit.picture;
  if (edit.banner !== undefined) merged.banner = edit.banner;
  if (edit.nip05 !== undefined) merged.nip05 = edit.nip05;
  if (edit.website !== undefined) merged.website = edit.website;
  if (edit.lud16 !== undefined) merged.lud16 = edit.lud16;
  return merged;
}

/** A kind 0's content as the editor reads it. */
export function profileInitial(content: Record<string, unknown>): ProfileEditorInitial {
  const s = (k: string) => (typeof content[k] === 'string' ? (content[k] as string) : null);
  return {
    displayName: s('display_name') ?? s('displayName'),
    name: s('name'),
    about: s('about'),
    picture: s('picture'),
    banner: s('banner'),
    nip05: s('nip05'),
    lud16: s('lud16'),
    website: s('website'),
  };
}

/** A kind 0 event as the editor reads it. */
export function initialOf(ev: NostrEvent | null): ProfileEditorInitial | null {
  return ev ? profileInitial(parseContent(ev)) : null;
}

/** Where your kind 0 is read and written: every profile relay, or on the
 *  guest island (refused) the public ones, which don't ask for AUTH. */
export function ownProfileRelays(): string[] {
  return isGuest() ? publicProfileRelays() : profileRelays();
}

/** The relays' newest copy of your kind 0, read past every cache. */
export async function fetchOwnProfile(deps: Pick<OwnProfileDeps, 'hub' | 'pubkey'>): Promise<{ event: NostrEvent | null; complete: boolean }> {
  const r = await deps.hub.query({
    relays: ownProfileRelays(),
    filters: [{ kinds: [0], authors: [deps.pubkey], limit: 5 }],
    maxWaitMs: PROFILE_LOOKUP_MAX_WAIT_MS,
    cache: { mode: 'bypass' },
    label: 'sky-own-profile',
  });
  return { event: newestKind0(r.events, deps.pubkey), complete: r.complete };
}

/**
 * Merge the edit into your newest kind 0, sign it and publish it to the
 * profile relays (the group relay with sky's AUTH retry; on the guest island
 * the public ones only). Throws `profile-load-failed` when no profile was
 * found and not every relay answered, and when no relay took the event.
 */
export async function editOwnProfile(deps: OwnProfileDeps, edit: ProfileEdit, assertCurrent: () => void = () => {}): Promise<VerifiedEvent> {
  // A logged-out guest has no profile to edit (nostr/guest.ts).
  if (!ownWritesAllowed()) throw new CodedError('profile-load-failed', 'Not available on the guest island.');
  const { event: existing, complete } = await fetchOwnProfile(deps);
  assertCurrent();
  if (!existing && !complete) throw new CodedError('profile-load-failed', 'Could not load your current profile. Try again.');
  const merged = mergeProfile(parseContent(existing), edit);
  const created = Math.floor(Date.now() / 1000);
  const event = await deps.sign({
    kind: 0,
    // A replaceable event: never older than the one it replaces.
    created_at: existing && existing.created_at >= created ? existing.created_at + 1 : created,
    tags: [],
    content: JSON.stringify(merged),
  });
  assertCurrent();
  // Refused: not to the group relay (it would refuse; `syncOwnProfile` copies it once you're in).
  const others = publicProfileRelays();
  const [onGroup, rest] = await Promise.all([
    isGuest() ? { ok: false } : publishSigned(deps.hub as RelayHub, event).catch(() => ({ ok: false })),
    deps.hub.publish({ relays: others, event, authMode: 'never' }).catch(() => []),
  ]);
  if (!onGroup.ok && !rest.some((r) => r.status === 'ok')) throw new Error('No relay accepted the profile.');
  return event;
}

/**
 * Your kind 0 follows you to the relay you switch to, as your look does
 * (avatars.ts `syncOwn`): the newest copy on the other profile relays (or the
 * one you just saved, `known`) is published, unchanged, to the group relay
 * when it lacks it or holds an older one. No new event is signed.
 */
export async function syncOwnProfile(
  deps: Pick<OwnProfileDeps, 'hub' | 'pubkey'>,
  known: NostrEvent | null = null,
): Promise<'republished' | 'current' | 'none' | 'failed'> {
  if (isGuest()) return 'none';
  const group = activeRelay();
  const others = publicProfileRelays();
  const ask = (relays: string[], label: string) => deps.hub.query({
    relays,
    filters: [{ kinds: [0], authors: [deps.pubkey], limit: 5 }],
    maxWaitMs: PROFILE_LOOKUP_MAX_WAIT_MS,
    cache: { mode: 'bypass' },
    label,
  });
  let onGroup: NostrEvent | null;
  let best: NostrEvent | null;
  try {
    const [g, o] = await Promise.all([ask([group], 'sky-own-profile-group'), ask(others, 'sky-own-profile-others')]);
    onGroup = newestKind0(g.events, deps.pubkey);
    best = newestKind0([...o.events, ...g.events, ...(known ? [known] : [])], deps.pubkey);
  } catch {
    return 'failed';
  }
  if (!best) return 'none';
  if (onGroup && onGroup.created_at >= best.created_at) return 'current';
  if (group !== activeRelay()) return 'failed';
  const out = await publishSigned(deps.hub as RelayHub, best as VerifiedEvent).catch(() => ({ ok: false }));
  return out.ok ? 'republished' : 'failed';
}
