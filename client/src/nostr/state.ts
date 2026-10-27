// The village's memory: visible groups, a 30-day message ring, reactions,
// zaps and the profiles of people who appear in them. Pure: feed.ts feeds it
// relay events through the user's own RelayHub, main.ts consumes what it
// emits.
//
// Visibility: the relay already decides what this user may read (NIP-29
// private groups, NIP-42 AUTH as them), so a logged-in client shows every
// group it is sent, like obelisk.ar does. `publicOnly` keeps v1's stricter
// rule (no `private` / `hidden`, parent chain included) for any view that
// might be shown to someone other than the signed-in user.

import { voiceNoteFromTags, type MessageVoiceNote } from '@/utils/media/tags/voice-note-tags';
import type { Event as NostrEvent } from 'nostr-tools';
import { getSatoshisAmountFromBolt11 } from 'nostr-tools/nip57';
import { validateZapReceipt } from '@nostr-wot/wallet';
import { isVisible, parseGroupMeta, type GroupMeta } from './groups';
import { cleanName, mentionedPubkeys, sanitizeText, shortNpub } from './sanitize';
import type { ServerMsg, WireGroup, WireMessage, WireProfile, WireReaction, WireZap } from './wire';

export const HISTORY_SECONDS = 30 * 24 * 3600;
export const MAX_MESSAGES = 4000;
export const MAX_REACTIONS = 3000;
export const MAX_ZAPS = 1000;

interface StoredMessage {
  id: string;
  pubkey: string;
  groupId: string;
  content: string;
  replyToId: string | null;
  replyHint: string | null; // first p-tag, used when the parent isn't in the ring
  images: string[];
  emojis: Record<string, string>;
  /** Everyone the message names (mentions and p tags), for profile fetches. */
  mentions: string[];
  createdAt: number;
  /** A zap bot's announcement (the chat shows it, the world flies it as a zap). */
  zapNote?: boolean;
  voiceNote?: MessageVoiceNote;
}

const HTTPS = /^https:\/\/[^\s"'<>]+$/i;

/** NIP-92 imeta image URLs and NIP-30 emoji, https only. */
export function mediaFromTags(tags: string[][]): { images: string[]; emojis: Record<string, string> } {
  const images: string[] = [];
  const emojis: Record<string, string> = {};
  for (const t of tags) {
    if (t[0] === 'imeta') {
      const url = t.find((x) => x.startsWith('url '))?.slice(4);
      const mime = t.find((x) => x.startsWith('m '))?.slice(2) ?? '';
      if (url && HTTPS.test(url) && (!mime || mime.startsWith('image/'))) images.push(url);
    } else if (t[0] === 'emoji' && /^[\w-]{1,64}$/.test(t[1] ?? '') && HTTPS.test(t[2] ?? '')) {
      emojis[t[1]] = t[2];
    }
  }
  return { images, emojis };
}

/** obelisk-dex's voice note: a `["voice", url, seconds]` tag on a message that is just that URL (https only, as all media here). */
export function voiceNoteOf(content: string, tags: string[][]): { voiceNote?: MessageVoiceNote } {
  const v = voiceNoteFromTags(content, tags);
  return v && HTTPS.test(v.url) ? { voiceNote: v } : {};
}

interface Profile {
  name: string | null;
  picture: string | null;
  nip05: string | null;
  /** Lightning address (kind 0 `lud16`): where a zap is paid. */
  lud16: string | null;
  createdAt: number;
}

/** A Lightning address, `name@host`, or null. */
export function cleanLud16(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim().toLowerCase();
  return /^[a-z0-9._+-]{1,64}@[a-z0-9.-]{1,253}\.[a-z]{2,}$/.test(v) ? v : null;
}

/** Sats an invoice is for, or 0 (no amount, or not an invoice). */
export function bolt11Sats(bolt11: string | undefined): number {
  if (!bolt11) return 0;
  try { return Math.max(0, Math.floor(getSatoshisAmountFromBolt11(bolt11))); } catch { return 0; }
}

/**
 * obelisk-dex's zap marker (services/wallet/send-zap.ts): after the wallet
 * pays, the zapper posts a kind 7 "⚡" reaction to the channel with the
 * recipient (`p`), the message (`e`, when a message was zapped), `amount` in
 * msat and the `bolt11`. That is how a zap from Obelisk reaches the channel,
 * so it flies as a zap here, not as a ⚡ emoji. Null for an ordinary reaction.
 * The amount is the invoice's (what was paid), as dex reads it, else the tags'.
 */
export function parseZapMarker(tags: string[][], content: string): { target: string; targetId: string | null; sats: number; bolt11: string | null } | null {
  if (!content.includes('⚡')) return null;
  const target = tags.find((t) => t[0] === 'p' && /^[0-9a-f]{64}$/.test(t[1] ?? ''))?.[1];
  if (!target) return null;
  const bolt11 = tags.find((t) => t[0] === 'bolt11')?.[1] || null;
  let sats = bolt11Sats(bolt11 ?? undefined);
  for (const name of ['amount', 'msat', 'msats', 'sat', 'sats']) {
    if (sats) break;
    const t = tags.find((x) => x[0] === name);
    const n = Number(t?.[1]);
    if (!t || !Number.isFinite(n) || n <= 0) continue;
    const unit = (t[2] || (name.startsWith('sat') ? 'sat' : 'msat')).toLowerCase();
    sats = Math.floor(unit.startsWith('sat') ? n : n / 1000);
  }
  if (sats <= 0) return null;
  return { target, targetId: tags.find((t) => t[0] === 'e')?.[1] ?? null, sats, bolt11 };
}

/**
 * The zap bot's kind 9 announcement ("⚡ @alice sent 420 satoshis to @bob",
 * obelisk-agents' zap-bot): `p` tags sender then recipient (only the
 * recipient for an anonymous zap, or for a zap to yourself), `e` the zapped
 * message.
 */
export function parseZapAnnouncement(content: string, tags: string[][]): { from: string | null; target: string; sats: number; targetId: string | null } | null {
  const m = /^\s*⚡\s*(.+?)\s+sent\s+(\d[\d,.]*)\s+(?:satoshis?|sats?)\s+to\s+(\S+)/is.exec(content);
  if (!m) return null;
  const ps = tags.filter((t) => t[0] === 'p' && /^[0-9a-f]{64}$/.test(t[1] ?? '')).map((t) => t[1]);
  const sats = Number(m[2].replace(/[,.]/g, ''));
  if (!ps.length || !Number.isFinite(sats) || sats <= 0) return null;
  const anonymous = /^@?anonymous$/i.test(m[1].trim());
  // One `p` and a named sender: a zap to yourself ("@a sent 21 sats to @a").
  const self = !anonymous && ps.length === 1 && m[1].trim().toLowerCase() === m[3].trim().toLowerCase();
  if (!anonymous && !self && ps.length < 2) return null;
  return {
    from: anonymous ? null : ps[0],
    target: ps[ps.length - 1],
    sats,
    targetId: tags.find((t) => t[0] === 'e')?.[1] ?? null,
  };
}

/** How long a bot announcement waits for its marker or receipt before it counts on its own. */
export const ANNOUNCE_GRACE_S = 10;

/** Per message: the sats zapped to it, how many zaps and who. */
export interface ZapTotal { sats: number; count: number; zappers: string[] }

/** What one message got from these zaps (dex's useMessageZaps totals). */
export function zapTotal(zaps: readonly WireZap[]): ZapTotal | null {
  if (!zaps.length) return null;
  const zappers: string[] = [];
  for (const z of zaps) if (z.from && !zappers.includes(z.from)) zappers.push(z.from);
  return { sats: zaps.reduce((n, z) => n + z.sats, 0), count: zaps.length, zappers };
}

/** A zap we hold proof of (marker or receipt), for matching the bot's announcement to it. */
interface ProvenZap { target: string; targetId: string | null; sats: number; createdAt: number; announced: boolean }

/** Sats from different sources of one zap (invoice vs requested amount) may differ by rounding. */
function sameSats(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(1, Math.min(a, b) * 0.01);
}

export type Emit = (msg: ServerMsg) => void;

export class SkyState {
  private meta = new Map<string, GroupMeta>();
  private visible = new Set<string>();
  /** Private groups whose member list (kind 39002) the relay sent us: it only
   *  sends that to members, so these are the private groups we may read. */
  private readable = new Set<string>();
  /** The relay refused a private group anyway: read none for this feed. */
  private privateRefused = false;
  private messages = new Map<string, StoredMessage>();
  private reactions = new Map<string, WireReaction>();
  private zaps = new Map<string, WireZap>();
  /** One zap arrives up to three ways (dex's marker, the NIP-57 receipt, the
   *  bot's announcement): marker and receipt share the invoice (`b:<bolt11>`,
   *  dex's dedupe key); an announcement is matched to them (`proven`). */
  private zapKeys = new Set<string>();
  /** Zaps with proof, newest last, for matching announcements. */
  private proven: ProvenZap[] = [];
  /** Announcements still waiting for their proof (`ANNOUNCE_GRACE_S`), by message id. */
  private pendingAnn = new Map<string, { z: WireZap; seenAt: number }>();
  private profiles = new Map<string, Profile>();
  /** Pubkeys that showed up in visible content — the only profiles we expose. */
  private people = new Set<string>();

  constructor(
    private emit: Emit,
    private now: () => number = () => Math.floor(Date.now() / 1000),
    private opts: { publicOnly?: boolean } = { publicOnly: true },
  ) {}

  visibleGroupIds(): string[] {
    return [...this.visible];
  }

  /** The visible groups a content REQ may name: asking for a private group
   *  we aren't in gets the whole REQ closed ("Access denied to private group"). */
  readableGroupIds(): string[] {
    return [...this.visible].filter((id) => this.meta.get(id)?.isPublic !== false || this.readable.has(id));
  }

  /** Visible private groups we don't yet know we may read: ask for their 39002. */
  unknownPrivateGroupIds(): string[] {
    if (this.privateRefused) return [];
    return [...this.visible].filter((id) => this.meta.get(id)?.isPublic === false && !this.readable.has(id));
  }

  /** A kind 39002 reached us: true when it opens a private group to us. */
  ingestMembers(ev: NostrEvent): boolean {
    if (ev.kind !== 39002) return false;
    const id = ev.tags.find((t) => t[0] === 'd')?.[1];
    if (!id || this.privateRefused || this.readable.has(id)) return false;
    this.readable.add(id);
    return this.meta.get(id)?.isPublic === false && this.visible.has(id);
  }

  /** The relay refused a private group after all (we were removed): read
   *  only public groups from now on, rather than ask again and be refused again. */
  forgetPrivateReads(): void {
    this.privateRefused = true;
    this.readable.clear();
  }

  /** Ids of the messages we hold, oldest first (only those since `since`, if given). */
  messageIds(since = 0): string[] {
    return [...this.messages.values()].filter((m) => m.createdAt >= since).sort((a, b) => a.createdAt - b.createdAt).map((m) => m.id);
  }

  /** People we've seen but hold no kind 0 for yet. */
  missingProfiles(): string[] {
    return [...this.people].filter((p) => !this.profiles.has(p));
  }

  /** Everyone whose kind 0 we want (held or not: held ones are refreshed). */
  knownPeople(): string[] {
    return [...this.people];
  }

  hasProfile(pk: string): boolean {
    return this.profiles.has(pk);
  }

  // ── groups ─────────────────────────────────────────────────────────────

  /** Returns true when the visible set changed (relay.ts re-subscribes). */
  ingestGroupMeta(ev: NostrEvent): boolean {
    if (ev.kind !== 39000) return false;
    const g = parseGroupMeta(ev.tags, ev.created_at);
    if (!g) return false;
    const prev = this.meta.get(g.id);
    if (prev && prev.createdAt > g.createdAt) return false;
    this.meta.set(g.id, g);
    return this.recomputeVisible();
  }

  private recomputeVisible(): boolean {
    let changed = false;
    for (const id of this.meta.keys()) {
      const vis = this.opts.publicOnly === false ? true : isVisible(id, this.meta);
      if (vis && !this.visible.has(id)) {
        this.visible.add(id);
        this.emit({ t: 'group', group: this.wireGroup(id)! });
        changed = true;
      } else if (!vis && this.visible.has(id)) {
        this.visible.delete(id);
        this.purgeGroup(id);
        this.emit({ t: 'group-removed', id });
        changed = true;
      } else if (vis) {
        // Rename etc. — cheap to resend.
        this.emit({ t: 'group', group: this.wireGroup(id)! });
      }
    }
    return changed;
  }

  private purgeGroup(id: string): void {
    for (const [k, m] of this.messages) if (m.groupId === id) this.messages.delete(k);
    for (const [k, r] of this.reactions) if (r.groupId === id) this.reactions.delete(k);
    for (const [k, z] of this.zaps) if (z.groupId === id) this.zaps.delete(k);
    for (const [k, a] of this.pendingAnn) if (a.z.groupId === id) this.pendingAnn.delete(k);
  }

  private wireGroup(id: string): WireGroup | null {
    const g = this.meta.get(id);
    if (!g) return null;
    return { id: g.id, name: g.name, about: g.about, kind: g.kind, open: g.isOpen, ...(g.parent ? { parent: g.parent } : {}) };
  }

  // ── messages ───────────────────────────────────────────────────────────

  ingestMessage(ev: NostrEvent): void {
    if (ev.kind !== 9 || this.messages.has(ev.id)) return;
    const groupId = ev.tags.find((t) => t[0] === 'h')?.[1];
    if (!groupId || !this.visible.has(groupId)) return;
    if (ev.created_at < this.now() - HISTORY_SECONDS || ev.created_at > this.now() + 300) return;
    const replyToId = ev.tags.find((t) => t[0] === 'e' && t[3] === 'reply')?.[1] ?? null;
    // The author can't announce a zap they're part of: only a third party (the bot) vouches.
    const parsed = parseZapAnnouncement(ev.content, ev.tags);
    const ann = parsed && ev.pubkey !== parsed.target && ev.pubkey !== parsed.from ? parsed : null;
    const m: StoredMessage = {
      id: ev.id,
      pubkey: ev.pubkey,
      groupId,
      content: ev.content,
      replyToId,
      replyHint: replyToId ? (ev.tags.find((t) => t[0] === 'p')?.[1] ?? null) : null,
      ...mediaFromTags(ev.tags),
      mentions: mentionedPubkeys(ev.content, ev.tags).slice(0, 20),
      createdAt: ev.created_at,
      ...(ann ? { zapNote: true } : {}),
      ...voiceNoteOf(ev.content, ev.tags),
    };
    this.messages.set(ev.id, m);
    this.notePerson(ev.pubkey);
    for (const pk of m.mentions) this.notePerson(pk);
    this.trim(this.messages, MAX_MESSAGES);
    const wire = this.wireMessage(m);
    if (wire.replyTo) this.notePerson(wire.replyTo);
    this.emit({ t: 'msg', msg: wire });
    if (ann) {
      this.notePerson(ann.target);
      this.announce({ id: `zap:${ev.id}`, from: ann.from, target: ann.target, targetId: ann.targetId, groupId, sats: ann.sats, createdAt: ev.created_at });
    }
  }

  private wireMessage(m: StoredMessage): WireMessage {
    let replyTo: string | null = null;
    if (m.replyToId) {
      const parent = this.messages.get(m.replyToId);
      replyTo = parent ? parent.pubkey : m.replyHint;
      if (replyTo && !/^[0-9a-f]{64}$/.test(replyTo)) replyTo = null;
    }
    const out: WireMessage = {
      id: m.id,
      pubkey: m.pubkey,
      groupId: m.groupId,
      text: sanitizeText(m.content, (pk) => this.nameOf(pk)),
      content: m.content.slice(0, 8000),
      images: m.images,
      emojis: m.emojis,
      replyTo,
      replyToId: m.replyToId,
      createdAt: m.createdAt,
    };
    if (m.zapNote) out.zapNote = true;
    if (m.voiceNote) out.voiceNote = m.voiceNote;
    if (m.mentions.length) out.mentions = m.mentions;
    return out;
  }

  /** Kind 5 from the author: drop their message or reaction (`k` 9 / 7). */
  ingestDeletion(ev: NostrEvent): void {
    if (ev.kind !== 5) return;
    for (const t of ev.tags) {
      if (t[0] !== 'e' || !t[1]) continue;
      const m = this.messages.get(t[1]);
      if (m && m.pubkey === ev.pubkey) {
        this.messages.delete(t[1]);
        this.emit({ t: 'msg-removed', id: t[1], groupId: m.groupId });
        continue;
      }
      const r = this.reactions.get(t[1]);
      if (r && r.pubkey === ev.pubkey) {
        this.reactions.delete(t[1]);
        this.emit({ t: 'reaction-removed', id: t[1], targetId: r.targetId });
        continue;
      }
      // A deleted ⚡ marker takes its zap with it (the receipt, if any, still counts).
      const z = this.zaps.get(`marker:${t[1]}`);
      if (z && z.from === ev.pubkey) {
        this.zaps.delete(z.id);
        this.emit({ t: 'zap-removed', id: z.id, targetId: z.targetId });
      }
    }
  }

  // ── reactions / zaps ───────────────────────────────────────────────────

  ingestReaction(ev: NostrEvent): void {
    if (ev.kind !== 7 || this.reactions.has(ev.id)) return;
    const groupId = ev.tags.find((t) => t[0] === 'h')?.[1];
    if (!groupId || !this.visible.has(groupId)) return;
    // A zap from Obelisk (its ⚡ marker): a zap, flown, counted once with its receipt.
    const marker = parseZapMarker(ev.tags, ev.content);
    if (marker) {
      if (this.zaps.has(`marker:${ev.id}`)) return;
      this.addZap({ id: `marker:${ev.id}`, from: ev.pubkey, target: marker.target, targetId: marker.targetId, groupId, sats: marker.sats, createdAt: ev.created_at }, marker.bolt11 ? `b:${marker.bolt11}` : `m:${ev.id}`);
      return;
    }
    const targetId = [...ev.tags].reverse().find((t) => t[0] === 'e')?.[1];
    if (!targetId) return;
    const parent = this.messages.get(targetId);
    const target = parent?.pubkey ?? ev.tags.find((t) => t[0] === 'p')?.[1];
    if (!target || !/^[0-9a-f]{64}$/.test(target)) return;
    const r: WireReaction = {
      id: ev.id,
      pubkey: ev.pubkey,
      target,
      targetId,
      groupId,
      emoji: reactionEmoji(ev.content),
      createdAt: ev.created_at,
    };
    this.reactions.set(ev.id, r);
    this.trim(this.reactions, MAX_REACTIONS);
    this.notePerson(ev.pubkey);
    this.notePerson(target);
    this.emit({ t: 'reaction', reaction: r });
  }

  /** NIP-57 receipt whose `e` points at a message we hold, checked as dex
   *  checks it (`validateZapReceipt`: paid to the message's author). Only the
   *  zapped message's group decides visibility — never the receipt's own tags. */
  ingestZap(ev: NostrEvent): void {
    if (ev.kind !== 9735 || this.zaps.has(ev.id)) return;
    const targetId = ev.tags.find((t) => t[0] === 'e')?.[1];
    const msg = targetId ? this.messages.get(targetId) : undefined;
    if (!msg) return;
    const ok = validateZapReceipt(ev, msg.pubkey);
    if (!ok || !/^[0-9a-f]{64}$/.test(ok.senderPubkey)) return;
    const sats = bolt11Sats(ok.bolt11) || Math.floor(ok.amountMsat / 1000);
    if (sats <= 0) return;
    this.addZap({ id: ev.id, from: ok.senderPubkey, target: msg.pubkey, targetId: msg.id, groupId: msg.groupId, sats, createdAt: ev.created_at }, `b:${ok.bolt11}`);
  }

  /** A zap with proof, once per invoice (`key`); it answers a waiting announcement. */
  private addZap(z: WireZap, key: string): void {
    if (this.zapKeys.has(key)) return;
    this.zapKeys.add(key);
    if (this.zapKeys.size > MAX_ZAPS * 2) this.zapKeys.delete(this.zapKeys.values().next().value!);
    const p: ProvenZap = { target: z.target, targetId: z.targetId, sats: z.sats, createdAt: z.createdAt, announced: false };
    for (const [id, a] of this.pendingAnn) {
      if (this.matches(p, a.z)) { this.pendingAnn.delete(id); p.announced = true; break; }
    }
    this.proven.push(p);
    if (this.proven.length > MAX_ZAPS) this.proven.shift();
    this.keep(z);
  }

  /** The bot's announcement: the zap it vouches for, unless we hold (or soon get) its proof. */
  private announce(z: WireZap): void {
    if (this.zaps.has(z.id) || this.pendingAnn.has(z.id)) return;
    const p = this.proven.find((x) => !x.announced && this.matches(x, z));
    if (p) { p.announced = true; return; }
    this.pendingAnn.set(z.id, { z, seenAt: this.now() });
  }

  private matches(p: ProvenZap, ann: WireZap): boolean {
    return p.target === ann.target
      && sameSats(p.sats, ann.sats)
      && (p.targetId === ann.targetId || !p.targetId || !ann.targetId)
      && Math.abs(p.createdAt - ann.createdAt) < 30 * 60;
  }

  /** Announcements whose proof never came (a wallet that posts no marker, a
   *  receipt on a relay we don't read) count on their own. Call every few seconds. */
  flushAnnouncements(): void {
    const now = this.now();
    for (const [id, a] of this.pendingAnn) {
      if (now - a.seenAt < ANNOUNCE_GRACE_S) continue;
      this.pendingAnn.delete(id);
      if (this.messages.has(id.slice(4))) this.keep(a.z);
    }
  }

  private keep(z: WireZap): void {
    this.zaps.set(z.id, z);
    this.trim(this.zaps, MAX_ZAPS);
    if (z.from) this.notePerson(z.from);
    this.emit({ t: 'zap', zap: z });
  }

  // ── profiles ───────────────────────────────────────────────────────────

  ingestProfile(ev: NostrEvent): void {
    if (ev.kind !== 0) return;
    const prev = this.profiles.get(ev.pubkey);
    if (prev && prev.createdAt >= ev.created_at) return;
    let j: Record<string, unknown> = {};
    try { j = JSON.parse(ev.content); } catch { return; }
    const pic = typeof j.picture === 'string' && /^https:\/\/[^\s]+$/i.test(j.picture) && j.picture.length < 1000
      ? j.picture : null;
    this.profiles.set(ev.pubkey, {
      name: cleanName(j.display_name) ?? cleanName(j.displayName) ?? cleanName(j.name),
      picture: pic,
      nip05: cleanName(j.nip05),
      lud16: cleanLud16(j.lud16),
      createdAt: ev.created_at,
    });
    if (this.people.has(ev.pubkey)) this.emit({ t: 'profile', profile: this.wireProfile(ev.pubkey) });
  }

  private notePerson(pk: string): void {
    if (this.people.has(pk)) return;
    this.people.add(pk);
    if (this.profiles.has(pk)) this.emit({ t: 'profile', profile: this.wireProfile(pk) });
  }

  /** Someone the UI wants a name for (a mention chip): fetch their kind 0. */
  watch(pk: string): void {
    if (/^[0-9a-f]{64}$/.test(pk)) this.notePerson(pk);
  }

  nameOf(pk: string): string {
    return this.profiles.get(pk)?.name ?? shortNpub(pk);
  }

  private wireProfile(pk: string): WireProfile {
    const p = this.profiles.get(pk);
    return {
      pubkey: pk,
      name: p?.name ?? shortNpub(pk),
      avatar: p?.picture ?? null,
      nip05: p?.nip05 ?? null,
      lud16: p?.lud16 ?? null,
      loaded: !!p,
    };
  }

  /** Avatar URLs we've handed out — the avatar proxy fetches nothing else. */
  isKnownPicture(url: string): boolean {
    for (const pk of this.people) if (this.profiles.get(pk)?.picture === url) return true;
    return false;
  }

  // ── snapshot / housekeeping ────────────────────────────────────────────

  snapshot(relay: string): ServerMsg {
    const messages = [...this.messages.values()]
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((m) => this.wireMessage(m));
    const involved = new Set<string>();
    for (const m of messages) { involved.add(m.pubkey); if (m.replyTo) involved.add(m.replyTo); }
    for (const m of this.messages.values()) for (const pk of m.mentions) involved.add(pk);
    for (const r of this.reactions.values()) { involved.add(r.pubkey); involved.add(r.target); }
    for (const z of this.zaps.values()) { if (z.from) involved.add(z.from); involved.add(z.target); }
    return {
      t: 'snapshot',
      relay,
      groups: [...this.visible].map((id) => this.wireGroup(id)!).filter(Boolean),
      profiles: [...involved].map((pk) => this.wireProfile(pk)),
      messages,
      reactions: [...this.reactions.values()].sort((a, b) => a.createdAt - b.createdAt),
      zaps: [...this.zaps.values()].sort((a, b) => a.createdAt - b.createdAt),
      now: this.now(),
    };
  }

  /** Drop anything older than the history window. */
  prune(): void {
    const cutoff = this.now() - HISTORY_SECONDS;
    for (const [k, m] of this.messages) if (m.createdAt < cutoff) this.messages.delete(k);
    for (const [k, r] of this.reactions) if (r.createdAt < cutoff) this.reactions.delete(k);
    for (const [k, z] of this.zaps) if (z.createdAt < cutoff) this.zaps.delete(k);
  }

  private trim<V extends { createdAt: number }>(map: Map<string, V>, cap: number): void {
    if (map.size <= cap) return;
    const sorted = [...map.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt);
    for (const [k] of sorted.slice(0, map.size - cap)) map.delete(k);
  }
}

export function reactionEmoji(content: string): string {
  const c = content.trim();
  if (c === '' || c === '+') return '❤️';
  if (c === '-') return '👎';
  if (/^:[\w-]+:$/.test(c)) return '✨'; // NIP-30 custom emoji — image not proxied
  const first = new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(c)[Symbol.iterator]().next().value?.segment ?? '';
  return /\p{Extended_Pictographic}/u.test(first) ? first : '❤️';
}
