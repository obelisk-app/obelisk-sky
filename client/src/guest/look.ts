// Your look on the guest island: kept in this browser only for a logged-out
// guest (nothing is published there). A refused account signs its look as
// anywhere else (main.ts `openLook`: the signed copy nostr/avatars.ts caches,
// also sent to the public profile relays); a look kept here is only the
// fallback for when that signature fails.

import { avatarTemplate, loadCachedAvatar, parseAvatar, type Avatar } from '../nostr/avatars';

export const GUEST_LOOK_PREFIX = 'obelisk-sky/guest-look/';

function storage(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

export function loadGuestLook(pk: string, store: Storage | null = storage()): Avatar | null {
  try {
    const raw = store?.getItem(GUEST_LOOK_PREFIX + pk);
    const own = raw ? parseAvatar(raw) : null;
    if (own) return own;
  } catch { /* storage blocked */ }
  const cached = loadCachedAvatar(pk, store);
  return cached ? parseAvatar(cached.content) : null;
}

export function saveGuestLook(pk: string, a: Avatar, store: Storage | null = storage()): void {
  try { store?.setItem(GUEST_LOOK_PREFIX + pk, avatarTemplate(a).content); } catch { /* full or private */ }
}

/** A signed look was saved: the local-only one would hide it from now on. */
export function clearGuestLook(pk: string, store: Storage | null = storage()): void {
  try { store?.removeItem(GUEST_LOOK_PREFIX + pk); } catch { /* storage blocked */ }
}
