// What the re-hosted obelisk-dex code asks of "the app": sky registers its
// session here once, and the shims below forward to it.

import type { EventTemplate, VerifiedEvent } from 'nostr-tools';
import type { ProfileEdit } from '../nostr/ownProfile';

export interface SkyHost {
  login(args: unknown): Promise<void>;
  sign(t: EventTemplate): Promise<VerifiedEvent>;
  /** Sign your own profile or its picture's upload grant: allowed on the guest island too when the relay refused you. */
  signOwn?(t: EventTemplate): Promise<VerifiedEvent>;
  pubkey(): string | null;
  /** Counts logins and logouts, so work begun for one account is dropped for the next. */
  generation?(): number;
  /** Merge, sign and publish your kind 0 (nostr/ownProfile.ts), then refresh sky's caches. */
  editProfile?(edit: ProfileEdit, assertCurrent: () => void): Promise<void>;
  /** A new account's first kind 0, signed in the login modal before it logs in. */
  ownProfileSigned?(ev: VerifiedEvent): void;
}

let host: SkyHost | null = null;

export function registerHost(h: SkyHost): void {
  host = h;
}

export function getHost(): SkyHost {
  if (!host) throw new Error('sky host not registered');
  return host;
}
