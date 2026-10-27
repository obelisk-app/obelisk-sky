// The signed-in user: their signer, sealed persistence and the hub identity.
//
// Mirrors obelisk-dex's session (src/services/nostr-bridge/session/): the
// SDK login widget hands over `{signer, pubkey, method, nsec?, bunkerUri?,
// clientNsec?}`, secrets are sealed with the app's session vault (one
// non-extractable AES-GCM key in IndexedDB, src/lib/crypto) before anything
// is written, and the hub identity is installed before any relay can send an
// AUTH challenge. Sky is its own origin, so its vault and record are its own.

import { SESSION_IDENTITY_ID, type RelayHub } from '@nostr-wot/relay/hub';
import { Nip07Signer, Nip46Signer, PrivateKeySigner, isNip07Available, type NostrSigner } from '@nostr-wot/signers';
import { nsecToHex } from '@nostr-wot/data';
import type { EventTemplate, VerifiedEvent } from 'nostr-tools';
import { isSealedBox, openSessionVault, type SealedBox } from '@/lib/crypto';
import { ANONYMOUS_IDENTITY, activeRelay } from './hub';
import { RemoteSigner } from './remoteSigner';
import { isGuest, isOwnWrite, ownWritesAllowed } from './guest';

export const SESSION_KEY = 'obelisk-sky/session';
const AAD = 'obelisk-sky/session/v1';

export type LoginMethod = 'nip07' | 'nip46' | 'nsec';

export interface LoginArgs {
  signer: NostrSigner;
  pubkey: string;
  method: string;
  nsec?: string;
  bunkerUri?: string;
  clientNsec?: string;
}

interface Secrets {
  skHex?: string;
  bunkerUri?: string;
  clientSecretHex?: string;
}

interface StoredSession {
  v: 1;
  pubkey: string;
  method: LoginMethod;
  sealed?: SealedBox;
}

export interface Session {
  pubkey: string;
  method: LoginMethod;
  signer: NostrSigner;
}

type Listener = (s: Session | null) => void;

export function methodOf(sdkMethod: string): LoginMethod {
  if (sdkMethod === 'nip07') return 'nip07';
  if (sdkMethod === 'nip46') return 'nip46';
  return 'nsec'; // 'generate' | 'import'
}

export function parseStored(raw: string | null): StoredSession | null {
  if (!raw) return null;
  try {
    const j = JSON.parse(raw) as Partial<StoredSession>;
    if (j.v !== 1 || typeof j.pubkey !== 'string' || !/^[0-9a-f]{64}$/.test(j.pubkey)) return null;
    if (j.method !== 'nip07' && j.method !== 'nip46' && j.method !== 'nsec') return null;
    if (j.method !== 'nip07' && !isSealedBox(j.sealed)) return null;
    return j as StoredSession;
  } catch {
    return null;
  }
}

export class SessionManager {
  current: Session | null = null;
  private listeners = new Set<Listener>();
  private lease: { release(): void } | null = null;

  constructor(private hub: RelayHub, private storage: Storage = localStorage) {}

  onChange(cb: Listener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** Sign anything as the user (kind 9, 7, 30078, ...). */
  sign(template: EventTemplate): Promise<VerifiedEvent> {
    if (!this.current) return Promise.reject(new Error('not logged in'));
    // The guest island signs nothing (nostr/guest.ts).
    if (isGuest()) return Promise.reject(new Error('guest island: nothing is signed'));
    return this.current.signer.signEvent(template) as Promise<VerifiedEvent>;
  }

  /**
   * Sign your own profile, look or a profile picture's upload grant
   * (`isOwnWrite`): as `sign`, and on the island too when the relay refused
   * the account (it holds a real key, and these are its own).
   */
  signOwn(template: EventTemplate): Promise<VerifiedEvent> {
    if (!this.current) return Promise.reject(new Error('not logged in'));
    if (!isOwnWrite(template)) return Promise.reject(new Error('not your profile or look'));
    if (!ownWritesAllowed()) return Promise.reject(new Error('guest island: nothing is signed'));
    return this.current.signer.signEvent(template) as Promise<VerifiedEvent>;
  }

  /** From the SDK widget's onLogin. */
  async login(args: LoginArgs): Promise<void> {
    const method = methodOf(args.method);
    const secrets: Secrets = {};
    if (method === 'nsec' && args.nsec) secrets.skHex = nsecToHex(args.nsec) ?? undefined;
    if (method === 'nip46') {
      secrets.bunkerUri = args.bunkerUri;
      if (args.clientNsec) secrets.clientSecretHex = nsecToHex(args.clientNsec) ?? undefined;
    }
    // A remote signer: our own, on the client key the widget paired (its own
    // one is closed when the login modal goes away). nostr/remoteSigner.ts.
    let signer = args.signer;
    if (method === 'nip46' && args.bunkerUri && secrets.clientSecretHex) {
      signer = await RemoteSigner.fromPairing(args.bunkerUri, secrets.clientSecretHex, args.pubkey);
    }
    this.install({ pubkey: args.pubkey, method, signer });
    await this.persist(args.pubkey, method, secrets).catch((e) => {
      console.warn('[sky] session kept in memory only', e);
    });
  }

  /** Page reload: rebuild the signer from the sealed record. */
  async restore(): Promise<boolean> {
    const stored = parseStored(this.storage.getItem(SESSION_KEY));
    if (!stored) return false;
    try {
      let signer: NostrSigner;
      if (stored.method === 'nip07') {
        if (!isNip07Available()) return false;
        signer = new Nip07Signer();
      } else {
        const vault = await openSessionVault();
        const bytes = await vault.open(stored.sealed!, AAD);
        const secrets = JSON.parse(new TextDecoder().decode(bytes)) as Secrets;
        if (stored.method === 'nsec' && secrets.skHex) signer = new PrivateKeySigner(secrets.skHex);
        else if (stored.method === 'nip46' && secrets.bunkerUri) {
          signer = secrets.clientSecretHex
            ? await RemoteSigner.restore(secrets.bunkerUri, secrets.clientSecretHex, stored.pubkey)
            : await Nip46Signer.fromBunkerUri(secrets.bunkerUri);
        } else return false;
      }
      // An extension can switch accounts between visits: trust only a match.
      const pk = await signer.getPublicKey();
      if (pk !== stored.pubkey) { this.storage.removeItem(SESSION_KEY); return false; }
      this.install({ pubkey: pk, method: stored.method, signer });
      return true;
    } catch (e) {
      console.warn('[sky] could not restore session', e);
      return false;
    }
  }

  /** Browsing another relay: answer AUTH there, and nowhere else. */
  setRelay(): void {
    if (!this.current) return;
    this.lease?.release();
    this.lease = this.hub.acquireAuthLease(activeRelay(), 'active');
  }

  logout(): void {
    this.storage.removeItem(SESSION_KEY);
    void this.current?.signer.close?.();
    this.current = null;
    this.lease?.release();
    this.lease = null;
    this.hub.setIdentity(ANONYMOUS_IDENTITY);
    for (const l of this.listeners) l(null);
  }

  private install(s: Session): void {
    this.current = s;
    // Identity before lease before any REQ: a challenge must never arrive
    // to a socket with no signer (obelisk-dex session/identity.ts).
    this.hub.setIdentity({
      id: SESSION_IDENTITY_ID,
      pubkey: s.pubkey,
      signer: (t) => s.signer.signEvent(t) as Promise<VerifiedEvent>,
      authPolicy: 'auth-when-challenged',
      localSigner: s.method === 'nsec',
    });
    this.lease ??= this.hub.acquireAuthLease(activeRelay(), 'active');
    for (const l of this.listeners) l(s);
  }

  private async persist(pubkey: string, method: LoginMethod, secrets: Secrets): Promise<void> {
    const record: StoredSession = { v: 1, pubkey, method };
    if (method !== 'nip07') {
      const vault = await openSessionVault();
      record.sealed = await vault.seal(new TextEncoder().encode(JSON.stringify(secrets)), AAD);
    }
    this.storage.setItem(SESSION_KEY, JSON.stringify(record));
  }
}
