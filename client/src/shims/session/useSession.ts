// @/hooks/session/useSession for the re-hosted login modal: login goes to
// sky's SessionManager; a generated key's first profile is published the way
// obelisk-dex does it (src/services/session/login.ts publishGeneratedProfile);
// the profile editor's save is dex's updateSessionProfile
// (src/services/session/profile.ts) over sky's host.

import { finalizeEvent } from 'nostr-tools/pure';
import { getPool, nsecToBytes } from '@nostr-wot/data';
import { randomProfileName } from '@/utils/identity/display-name';
import { CodedError } from '@/utils/errors/codes';
import { GENERATED_PROFILE_PUBLISH_TIMEOUT_MS } from '@/constants/session/login';
import type { ProfileFormValues, ProfileUploading } from '@/types/session/profile';
import type { GeneratedProfileDraft } from '@/types/session/login';
import { publicProfileRelays } from '../../nostr/hub';
import { uploadToBlossom } from '../blossom';
import { getHost } from '../host';

/** obelisk-dex's (src/services/session/login.ts), with the relays sky reads
 *  profiles from. Not the group relay: it admits no new key. */
const DEX_GENERATED_PROFILE_RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.nostr.band', 'wss://purplepag.es'];
export function generatedProfileRelays(): string[] {
  return [...new Set([...DEX_GENERATED_PROFILE_RELAYS, ...publicProfileRelays()])];
}

/** A new key's first kind 0, as obelisk-dex makes it: the name (else a made-up one), about, picture and banner. */
export function generatedProfileContent(profile: GeneratedProfileDraft): Record<string, string> {
  const name = profile.name?.trim() || randomProfileName();
  const about = profile.about?.trim();
  return {
    name,
    display_name: name,
    ...(about ? { about } : {}),
    ...(profile.picture ? { picture: profile.picture } : {}),
    ...(profile.banner ? { banner: profile.banner } : {}),
  };
}

/**
 * Publish a freshly generated key's kind 0, as obelisk-dex does: done when
 * one relay takes it, an error when none does within the time (the modal then
 * offers a retry and holds "Enter" back). The signed event goes to sky's host,
 * so the village shows it the moment the account logs in.
 */
export async function publishGeneratedProfile(nsec: string, profile: GeneratedProfileDraft): Promise<void> {
  const secretKey = nsecToBytes(nsec);
  if (!secretKey) throw new Error('Invalid nsec');
  const event = finalizeEvent({ kind: 0, created_at: Math.floor(Date.now() / 1000), tags: [], content: JSON.stringify(generatedProfileContent(profile)) }, secretKey);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.any(getPool().publish(generatedProfileRelays(), event)),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Profile publish timed out')), GENERATED_PROFILE_PUBLISH_TIMEOUT_MS); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
  getHost().ownProfileSigned?.(event);
}

/**
 * Upload the picked picture and banner (Blossom, sky's signer), then merge
 * the fields into your kind 0 through the host. Dropped with an AbortError
 * when the account changes on the way.
 */
export async function updateProfile(values: ProfileFormValues, onUploading?: (which: ProfileUploading) => void): Promise<void> {
  const host = getHost();
  const pubkey = host.pubkey();
  if (!pubkey || !host.editProfile) throw new CodedError('not-logged-in', 'Not logged in');
  const generation = host.generation?.() ?? 0;
  const assertCurrent = () => {
    if (host.pubkey() !== pubkey || (host.generation?.() ?? 0) !== generation) {
      throw new DOMException('Session operation was superseded', 'AbortError');
    }
  };
  try {
    let picture = values.picture.trim();
    let banner = values.banner.trim();
    // Signed as your own profile's (the guest island allows it to a refused account).
    const sign = host.signOwn ? (t: Parameters<NonNullable<typeof host.signOwn>>[0]) => host.signOwn!(t) : undefined;
    if (values.pictureFile) {
      onUploading?.('picture');
      picture = await uploadToBlossom(values.pictureFile, undefined, sign);
      assertCurrent();
    }
    if (values.bannerFile) {
      onUploading?.('banner');
      banner = await uploadToBlossom(values.bannerFile, undefined, sign);
      assertCurrent();
    }
    onUploading?.(null);
    const name = values.name.trim();
    await host.editProfile({
      name, displayName: name, about: values.about.trim(), picture, banner,
      nip05: values.nip05.trim(), lud16: values.lud16.trim(), website: values.website.trim(),
    }, assertCurrent);
  } finally {
    onUploading?.(null);
  }
}

export function useSessionActions() {
  return {
    login: (args: unknown) => getHost().login(args),
    publishGeneratedProfile,
    updateProfile,
    logout: () => {},
  };
}

export function useSessionNotice(): null {
  return null;
}

export function useMyPubkey(): string | null {
  return getHost().pubkey();
}

export function useIsLoggedIn(): boolean {
  return !!getHost().pubkey();
}

/** Whether something can sign now: sky's session holds its signer once logged in. */
export function useSignerReady(): boolean {
  return !!getHost().pubkey();
}

export function useSessionGeneration(): number {
  return getHost().generation?.() ?? 0;
}
