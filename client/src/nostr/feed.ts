// The user's own view of the group relay, through the RelayHub, fed into
// SkyState. Replaces v1's server proxy: nothing is read with any key but the
// signed-in user's.
//
// Before the first EOSE the state fills silently; then main.ts gets one
// snapshot, and every later event live.

import type { Event as NostrEvent } from 'nostr-tools';
import type { RelayHub, SubscriptionHandle } from '@nostr-wot/relay/hub';
import { HISTORY_SECONDS, SkyState } from './state';
import type { ServerMsg } from './wire';
import { getDefaultRelays } from '@nostr-wot/data';
import { isImportableRelayUrl } from '@/services/nostr-bridge/relay/relay-list';
import { activeRelay, profileRelays } from './hub';

export type FeedAccess = 'connecting' | 'open' | 'refused' | 'offline';

export interface FeedHooks {
  onMsg(m: ServerMsg): void;
  onAccess(a: FeedAccess, reason?: string): void;
  /** Kind 2390 game ops (obelisk-dex tables), straight from the relay. */
  onGame?(ev: NostrEvent): void;
}

/** A relay CLOSED reason that means "this key is not admitted here". */
export function isAccessRefusal(reason: string): boolean {
  // "Access denied to private group" is one channel, not the relay: an
  // admitted account sent there would land on the guest island.
  if (isPrivateGroupRefusal(reason)) return false;
  return /^restricted:/i.test(reason) && /whitelist|not allowed|access denied|not admitted|blocked from this relay|web of trust|wot/i.test(reason);
}

/** A relay CLOSED reason that means "a private group in this REQ isn't yours to read". */
export function isPrivateGroupRefusal(reason: string): boolean {
  return /^restricted:/i.test(reason) && /private group/i.test(reason);
}

/** A relay set may miss a kind 0 (or a new account publishes it minutes
 *  after it first shows up): ask again after 30 s, 1 min, 2 min, then every 5 min. */
export function nextProfileRetry(tries: number, now: number): number {
  const waits = [30_000, 60_000, 120_000, 300_000];
  return now + waits[Math.min(tries - 1, waits.length - 1)];
}

/** A kind 0 we hold is asked for again after this (obelisk-dex refreshes
 *  others' after 6 h; a village session is shorter, and a new account often
 *  adds its picture a few seconds after its name). */
export const PROFILE_REFRESH_MS = 20 * 60_000;

export type ProfileAsks = Map<string, { tries: number; next: number }>;

/**
 * Who to ask for now, and when to ask each again: people with no kind 0 on
 * the miss backoff, people with one after PROFILE_REFRESH_MS (missing ones
 * first). Updates `asks`.
 */
export function profilesDue(people: readonly string[], has: (pk: string) => boolean, asks: ProfileAsks, now: number, max = 150): string[] {
  const due = people.filter((p) => (asks.get(p)?.next ?? 0) <= now);
  due.sort((a, b) => Number(has(a)) - Number(has(b)));
  const out = due.slice(0, max);
  for (const p of out) {
    if (has(p)) { asks.set(p, { tries: 0, next: now + PROFILE_REFRESH_MS }); continue; }
    const tries = (asks.get(p)?.tries ?? 0) + 1;
    asks.set(p, { tries, next: nextProfileRetry(tries, now) });
  }
  return out;
}

export class Feed {
  readonly state: SkyState;
  private ready = false;
  private groupSub: SubscriptionHandle | null = null;
  private contentSub: SubscriptionHandle | null = null;
  private resubTimer: ReturnType<typeof setTimeout> | null = null;
  private timers: ReturnType<typeof setInterval>[] = [];
  /** Profile lookups so far: tries made and when the next may go out. */
  private requested: ProfileAsks = new Map();
  private zapSince = 0;
  private stopped = false;
  private unStatus: (() => void) | null = null;

  constructor(private hub: RelayHub, private hooks: FeedHooks) {
    this.state = new SkyState((m) => { if (this.ready) hooks.onMsg(m); }, undefined, { publicOnly: false });
  }

  start(): void {
    this.hooks.onAccess('connecting');
    this.unStatus = this.hub.onStatus((s) => {
      if (s.url.replace(/\/$/, '') !== activeRelay()) return;
      if (s.connection === 'offline' || s.connection === 'failed') this.hooks.onAccess('offline', s.lastError ?? undefined);
      if (s.auth === 'refused') this.hooks.onAccess('refused', s.authError ?? undefined);
    });
    void this.hub.connect(activeRelay()).catch(() => { /* the hub keeps retrying */ });
    this.groupSub = this.hub.subscribe({
      relays: [activeRelay()],
      filters: [{ kinds: [39000] }],
      priority: 'active',
      watchdogMs: 8000,
      label: 'sky-groups',
      onEvent: (ev) => { if (this.state.ingestGroupMeta(ev)) this.scheduleContent(); },
      onEose: () => {
        this.hooks.onAccess('open');
        if (!this.state.visibleGroupIds().length) this.finishSnapshot();
      },
      onRelayClosed: (_r, reason) => { if (isAccessRefusal(reason)) this.hooks.onAccess('refused', reason); },
    });
    this.timers.push(setInterval(() => this.fetchProfiles(), 2500));
    this.timers.push(setInterval(() => this.fetchZaps(), 30_000));
    this.timers.push(setInterval(() => this.state.flushAnnouncements(), 2000));
    this.timers.push(setInterval(() => this.state.prune(), 10 * 60_000));
    // Never leave the user on a blank island if an EOSE goes missing.
    setTimeout(() => this.finishSnapshot(), 12_000);
  }

  stop(): void {
    this.stopped = true;
    for (const t of this.timers) clearInterval(t);
    this.groupSub?.release();
    this.contentSub?.release();
    this.unStatus?.();
  }

  private scheduleContent(): void {
    if (this.resubTimer) clearTimeout(this.resubTimer);
    this.resubTimer = setTimeout(() => this.subscribeContent(), 400);
  }

  private subscribeContent(): void {
    this.resubTimer = null;
    if (this.stopped) return;
    const ids = this.state.readableGroupIds();
    // The relay sends a private group's member list only to its members.
    const unknown = this.state.unknownPrivateGroupIds();
    const prev = this.contentSub;
    if (!ids.length && !unknown.length) { prev?.release(); this.contentSub = null; return; }
    const members = unknown.length ? [{ kinds: [39002], '#d': unknown }] : [];
    if (!ids.length) {
      this.contentSub = this.hub.subscribe({
        relays: [activeRelay()],
        filters: members,
        priority: 'active',
        watchdogMs: 8000,
        label: 'sky-content',
        onEvent: (ev: NostrEvent) => { if (this.state.ingestMembers(ev)) this.scheduleContent(); },
        onEose: () => { if (!this.resubTimer) this.finishSnapshot(); },
      });
      prev?.release();
      return;
    }
    const since = Math.floor(Date.now() / 1000) - HISTORY_SECONDS;
    this.contentSub = this.hub.subscribe({
      relays: [activeRelay()],
      filters: [
        { kinds: [9], '#h': ids, since, limit: 4000 },
        { kinds: [7], '#h': ids, since, limit: 4000 },
        { kinds: [5], '#h': ids, since, limit: 2000 },
        // Game tables live a day (the app's GAME_LOG_WINDOW_SECONDS).
        { kinds: [2390], '#h': ids, since: Math.floor(Date.now() / 1000) - 24 * 3600, limit: 3000 },
        ...members,
      ],
      priority: 'active',
      watchdogMs: 8000,
      label: 'sky-content',
      onEvent: (ev: NostrEvent) => {
        if (ev.kind === 9) this.state.ingestMessage(ev);
        else if (ev.kind === 7) this.state.ingestReaction(ev);
        else if (ev.kind === 5) this.state.ingestDeletion(ev);
        else if (ev.kind === 2390) this.hooks.onGame?.(ev);
        else if (ev.kind === 39002 && this.state.ingestMembers(ev)) this.scheduleContent();
      },
      // A private group just opened to us: its history comes with the next REQ, before the snapshot.
      onEose: () => { if (!this.resubTimer) this.finishSnapshot(); this.fetchZaps(true); },
      onRelayClosed: (_r, reason) => {
        if (isAccessRefusal(reason)) this.hooks.onAccess('refused', reason);
        else if (isPrivateGroupRefusal(reason)) { this.state.forgetPrivateReads(); this.scheduleContent(); }
      },
    });
    // Release the old REQ only after the new one holds the socket.
    prev?.release();
  }

  private finishSnapshot(): void {
    if (this.ready || this.stopped) return;
    this.ready = true;
    this.hooks.onMsg(this.state.snapshot(activeRelay()));
  }

  /** Zap receipts point at messages, not groups: poll by `#e`. The group
   *  relay for every message we hold; the default relays (where zap requests
   *  ask providers to publish, as dex's useMessageZaps reads) for the last two
   *  days' messages. The window only moves on once a poll came back. */
  private fetchZaps(full = false): void {
    const now = Math.floor(Date.now() / 1000);
    const since = full || !this.zapSince ? now - HISTORY_SECONDS : this.zapSince - 120;
    const asks = zapAsks(this.state.messageIds(), this.state.messageIds(now - 2 * 86400), activeRelay(), getDefaultRelays().filter(isImportableRelayUrl));
    if (!asks.length) return;
    void Promise.allSettled(asks.map((a) => this.hub.query({
      relays: a.relays,
      filters: [{ kinds: [9735], '#e': a.ids, since }],
      maxWaitMs: 6000,
      cache: { mode: 'bypass' },
      label: 'sky-zaps',
    }).then((r) => { for (const ev of r.events) this.state.ingestZap(ev); }))).then((out) => {
      if (out.every((x) => x.status === 'fulfilled')) this.zapSince = Math.max(this.zapSince, now);
    });
  }

  private fetchProfiles(): void {
    const due = profilesDue(this.state.knownPeople(), (p) => this.state.hasProfile(p), this.requested, Date.now());
    if (!due.length) return;
    void this.hub.query({
      relays: profileRelays(),
      filters: [{ kinds: [0], authors: due }],
      maxWaitMs: 5000,
      cache: { mode: 'bypass' },
      label: 'sky-profiles',
    }).then((r) => { for (const ev of r.events) this.state.ingestProfile(ev); }).catch(() => {});
  }
}

/** The receipt queries for a poll: every held id on the group relay, recent ones on the defaults too (250 ids a query). */
export function zapAsks(ids: string[], recent: string[], group: string, defaults: string[]): { relays: string[]; ids: string[] }[] {
  const out: { relays: string[]; ids: string[] }[] = [];
  for (let i = 0; i < ids.length; i += 250) out.push({ relays: [group], ids: ids.slice(i, i + 250) });
  const others = [...new Set(defaults)].filter((r) => r.replace(/\/$/, '') !== group.replace(/\/$/, ''));
  const few = recent.slice(-500);
  if (others.length) for (let i = 0; i < few.length; i += 250) out.push({ relays: others, ids: few.slice(i, i + 250) });
  return out;
}
