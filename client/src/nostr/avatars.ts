// Your 3D look in the village: body, hat and pet, and the places your
// character likes to hang around (`haunts`, world/places.ts).
//
// Replaceable kind 30078, d=`obelisk:avatar3d:v1` (no other obelisk d-tag
// collides), JSON content, published to the group relay so everyone there
// sees it. Everything read from a relay goes through `parseAvatar`: unknown
// fields are dropped, every value is checked against a fixed list, names
// are clipped. A person without one wears the look their pubkey picks.
// v2 carries a full look for the Quaternius people (people/people.ts); v1
// (a Kenney skin letter) still parses and maps to a stable look.
//
// Your own signed event is also kept in localStorage, so your look and pet
// show at once and follow you to another relay: if that relay has none (or
// an older one), the same signed event is published there (`syncOwn`).

import type { Event as NostrEvent, EventTemplate } from 'nostr-tools';
import type { RelayHub } from '@nostr-wot/relay/hub';
import { activeRelay } from './hub';
import { parseLook, type PersonLook } from '../people/people';
import { parseHaunts, type PlaceId } from '../world/places';

export const AVATAR_D_TAG = 'obelisk:avatar3d:v1';

export const SKINS = 'abcdefghijklmnopqr'.split('');
export const HATS = ['none', 'cap', 'beanie', 'tophat', 'crown', 'headband', 'boina'] as const;
export const PETS = [
  'beaver', 'bee', 'bunny', 'caterpillar', 'cat', 'chick', 'cow', 'crab', 'deer', 'dog', 'elephant', 'fish',
  'fox', 'giraffe', 'hog', 'koala', 'lion', 'monkey', 'panda', 'parrot', 'penguin', 'pig', 'polar', 'tiger',
  // Nostr's purple ostrich: built in code (world/nostrich.ts), not a Kenney model.
  'nostrich',
] as const;
export const HAT_COLORS = ['#b4f953', '#ff4d5e', '#38bdf8', '#fbbf24', '#c084fc', '#f472b6', '#fafafa', '#171717'] as const;

export type Hat = (typeof HATS)[number];
export type PetKind = (typeof PETS)[number];

export interface Avatar {
  /** 1: a blocky skin letter only; 2: a full look (body, hair, clothes). */
  v: 1 | 2;
  /** v1's skin letter, kept so a v1 avatar maps to the same look every time. */
  skin: string;
  look: PersonLook | null;
  hat: Hat;
  hatColor: string;
  pet: { kind: PetKind; name: string } | null;
  /** Up to three favourite places your character hangs around (world/places.ts). */
  haunts?: PlaceId[];
}

export const DEFAULT_AVATAR: Avatar = { v: 1, skin: 'a', look: null, hat: 'none', hatColor: HAT_COLORS[0], pet: null };

const oneOf = <T extends string>(list: readonly T[], v: unknown, fallback: T): T => (list.includes(v as T) ? (v as T) : fallback);

/** Strict parse of relay content; null when it isn't an avatar at all. */
export function parseAvatar(content: string): Avatar | null {
  let j: Record<string, unknown>;
  try { j = JSON.parse(content); } catch { return null; }
  if (!j || typeof j !== 'object' || (j.v !== 1 && j.v !== 2)) return null;
  const look = j.v === 2 ? parseLook(j.look) : null;
  if (j.v === 2 && !look) return null;
  const petRaw = j.pet as Record<string, unknown> | null | undefined;
  const pet = petRaw && typeof petRaw === 'object' && (PETS as readonly string[]).includes(petRaw.kind as string)
    ? { kind: petRaw.kind as PetKind, name: cleanPetName(petRaw.name) }
    : null;
  const haunts = parseHaunts(j.haunts);
  return {
    v: look ? 2 : 1,
    skin: oneOf(SKINS, j.skin, 'a'),
    look,
    hat: oneOf(HATS, j.hat, 'none'),
    hatColor: oneOf(HAT_COLORS, j.hatColor, HAT_COLORS[0]),
    pet,
    ...(haunts.length ? { haunts } : {}),
  };
}

export function cleanPetName(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return [...raw.replace(/[\u0000-\u001f\u007f​-‏‪-‮]/g, '').trim()].slice(0, 24).join('');
}

export function avatarTemplate(a: Avatar, prevCreatedAt = 0): EventTemplate {
  const haunts = parseHaunts(a.haunts);
  const extra = haunts.length ? { haunts } : {};
  return {
    kind: 30078,
    tags: [['d', AVATAR_D_TAG]],
    content: JSON.stringify(a.look
      ? { v: 2, skin: a.skin, look: a.look, hat: a.hat, hatColor: a.hatColor, pet: a.pet, ...extra }
      : { v: 1, skin: a.skin, hat: a.hat, hatColor: a.hatColor, pet: a.pet, ...extra }),
    created_at: Math.max(Math.floor(Date.now() / 1000), prevCreatedAt + 1),
  };
}

export const AVATAR_CACHE_PREFIX = 'obelisk-sky/avatar/';

function storage(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

/** Your latest avatar event as this browser last saw it (checked, or null). */
export function loadCachedAvatar(pk: string, store: Storage | null = storage()): NostrEvent | null {
  let ev: NostrEvent;
  try { ev = JSON.parse(store?.getItem(AVATAR_CACHE_PREFIX + pk) ?? 'null'); } catch { return null; }
  if (!ev || typeof ev !== 'object' || ev.pubkey !== pk || ev.kind !== 30078 || typeof ev.sig !== 'string' || typeof ev.created_at !== 'number') return null;
  if (!Array.isArray(ev.tags) || !ev.tags.some((t) => t[0] === 'd' && t[1] === AVATAR_D_TAG)) return null;
  return parseAvatar(ev.content) ? ev : null;
}

/** Keep `ev` if it is newer than what's cached for its author. */
export function cacheAvatar(ev: NostrEvent, store: Storage | null = storage()): void {
  const prev = loadCachedAvatar(ev.pubkey, store);
  if (prev && prev.created_at >= ev.created_at) return;
  const { id, pubkey, kind, tags, content, created_at, sig } = ev;
  try { store?.setItem(AVATAR_CACHE_PREFIX + ev.pubkey, JSON.stringify({ id, pubkey, kind, tags, content, created_at, sig })); } catch { /* full or private */ }
}

/**
 * Your newest look on `relays` (the public profile relays, where a refused
 * account's look goes), kept in this browser's cache when newer than the
 * one there. Null when none came.
 */
export async function fetchOwnLook(hub: Pick<RelayHub, 'query'>, pk: string, relays: readonly string[], store: Storage | null = storage()): Promise<NostrEvent | null> {
  if (!relays.length) return null;
  const r = await hub.query({
    relays: [...relays],
    filters: [{ kinds: [30078], authors: [pk], '#d': [AVATAR_D_TAG] }],
    maxWaitMs: 5000,
    cache: { mode: 'bypass' },
    label: 'sky-avatar-own-public',
  });
  let best: NostrEvent | null = null;
  for (const ev of r.events) {
    if (ev.pubkey !== pk || !parseAvatar(ev.content)) continue;
    if (!best || ev.created_at > best.created_at) best = ev;
  }
  if (best) cacheAvatar(best, store);
  return best;
}

/** The relay is missing your look, or has an older one than you saved. */
export function shouldRepublish(cached: NostrEvent | null, relayAt: number): boolean {
  return !!cached && cached.created_at > relayAt;
}

/** Avatars for the people in the village, fetched in batches as they appear. */
export class AvatarStore {
  private byPk = new Map<string, { a: Avatar; at: number }>();
  private asked = new Set<string>();
  private listeners = new Set<(pk: string, a: Avatar) => void>();
  /** Your pubkey: your events are cached in this browser. */
  private own: string | null = null;
  private sub: { release(): void } | null = null;

  constructor(private hub: RelayHub, private store: Storage | null = storage()) {}

  onChange(cb: (pk: string, a: Avatar) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  get(pk: string): Avatar | null {
    return this.byPk.get(pk)?.a ?? null;
  }

  createdAt(pk: string): number {
    return this.byPk.get(pk)?.at ?? 0;
  }

  ingest(ev: NostrEvent): void {
    if (ev.kind !== 30078 || !ev.tags.some((t) => t[0] === 'd' && t[1] === AVATAR_D_TAG)) return;
    const prev = this.byPk.get(ev.pubkey);
    if (prev && prev.at >= ev.created_at) return;
    const a = parseAvatar(ev.content);
    if (!a) return;
    this.byPk.set(ev.pubkey, { a, at: ev.created_at });
    if (ev.pubkey === this.own) cacheAvatar(ev, this.store);
    for (const l of this.listeners) l(ev.pubkey, a);
  }

  /**
   * Your look on this relay: show the cached one at once, ask the relay for
   * its copy (and `elsewhere`, the public profile relays, for one saved while
   * refused on another device), and hand the newest event to `republish`
   * when the relay is missing it or behind. Resolves to what happened.
   */
  async syncOwn(pk: string, republish: (ev: NostrEvent) => Promise<boolean>, elsewhere: readonly string[] = []): Promise<'republished' | 'current' | 'none' | 'failed'> {
    this.own = pk;
    const cached = loadCachedAvatar(pk, this.store);
    if (cached) this.ingest(cached);
    this.asked.add(pk);
    let relayAt = 0;
    try {
      const [r, outside] = await Promise.all([
        this.hub.query({
          relays: [activeRelay()],
          filters: [{ kinds: [30078], authors: [pk], '#d': [AVATAR_D_TAG] }],
          maxWaitMs: 5000,
          cache: { mode: 'bypass' },
          label: 'sky-avatar-own',
        }),
        fetchOwnLook(this.hub, pk, elsewhere, this.store).catch(() => null),
      ]);
      if (outside) this.ingest(outside);
      for (const ev of r.events) {
        if (ev.pubkey !== pk) continue;
        this.ingest(ev);
        relayAt = Math.max(relayAt, ev.created_at);
      }
    } catch {
      return 'failed';
    }
    // Re-read: a newer event from the relay replaced the cache.
    const best = loadCachedAvatar(pk, this.store);
    if (!shouldRepublish(best, relayAt)) return best || relayAt ? 'current' : 'none';
    return (await republish(best!)) ? 'republished' : 'failed';
  }

  /**
   * Looks saved from now on, by anyone: someone already in the village who
   * changes body or clothes is redrawn on every screen, not after a reload.
   */
  start(nowS = Math.floor(Date.now() / 1000)): void {
    this.sub?.release();
    this.sub = this.hub.subscribe({
      relays: [activeRelay()],
      filters: [{ kinds: [30078], '#d': [AVATAR_D_TAG], since: nowS - 60 }],
      priority: 'background',
      label: 'sky-avatars-live',
      onEvent: (ev) => this.ingest(ev),
    });
  }

  stop(): void {
    this.sub?.release();
    this.sub = null;
  }

  /** Ask the relay for anyone we haven't asked about yet. A query that
   *  didn't finish (AUTH still pending, a timeout) is asked again later. */
  want(pubkeys: Iterable<string>): void {
    const fresh = [...pubkeys].filter((p) => !this.asked.has(p)).slice(0, 200);
    if (!fresh.length) return;
    for (const p of fresh) this.asked.add(p);
    const retry = () => { for (const p of fresh) if (!this.byPk.has(p)) this.asked.delete(p); };
    void this.hub.query({
      relays: [activeRelay()],
      filters: [{ kinds: [30078], authors: fresh, '#d': [AVATAR_D_TAG] }],
      maxWaitMs: 5000,
      cache: { mode: 'bypass' },
      label: 'sky-avatars',
    }).then((r) => {
      for (const ev of r.events) this.ingest(ev);
      if (!r.complete) retry();
    }).catch(retry);
  }
}
