// Time for the village: live, or replaying real history at a readable pace.
//
// Obelisk's public channels are quiet for hours at a time, so an empty
// "live" view would mostly show people standing still. When nothing is
// happening the player re-tells the most recent real conversation, paced
// for reading, and cuts back to live the moment a new event arrives.

import type { WireMessage, WireReaction, WireZap } from '../nostr/wire';
import type { Director } from './director';

export type Ev =
  | { k: 'msg'; at: number; m: WireMessage }
  | { k: 'react'; at: number; r: WireReaction }
  | { k: 'zap'; at: number; z: WireZap };

export const EPISODE_GAP = 10 * 60; // s between messages that splits episodes
export const CONTEXT_WINDOW = 20 * 60; // s of history re-applied silently on a seek
export const LIVE_IDLE_BEFORE_STORY = 75; // real s of quiet before a replay starts
/** A zap older than this when it reaches us (a receipt polled late, a channel
 *  subscribed after load) is counted but not flown: only live zaps fly. */
export const ZAP_LIVE_S = 120;

export interface Episode { start: number; end: number; count: number; groupId: string }

/** Put `ev` into `events` (sorted by time) after every event at or before its
 *  time, so equal times keep their arrival order. Returns its index. */
export function insertByTime(events: Ev[], ev: Ev): number {
  let i = events.length;
  while (i > 0 && events[i - 1].at > ev.at) i--;
  events.splice(i, 0, ev);
  return i;
}

export function findEpisodes(events: Ev[], minCount = 3): Episode[] {
  const msgs = events.filter((e): e is Extract<Ev, { k: 'msg' }> => e.k === 'msg');
  const out: Episode[] = [];
  let cur: { start: number; end: number; count: number; groups: Map<string, number> } | null = null;
  const flush = () => {
    if (cur && cur.count >= minCount) {
      const groupId = [...cur.groups.entries()].sort((a, b) => b[1] - a[1])[0][0];
      out.push({ start: cur.start, end: cur.end, count: cur.count, groupId });
    }
  };
  for (const e of msgs) {
    if (!cur || e.at - cur.end > EPISODE_GAP) {
      flush();
      cur = { start: e.at, end: e.at, count: 0, groups: new Map() };
    }
    cur.end = e.at;
    cur.count++;
    cur.groups.set(e.m.groupId, (cur.groups.get(e.m.groupId) ?? 0) + 1);
  }
  flush();
  return out;
}

/** Real seconds to wait before showing `next`, given what came before. */
export function paceDelay(prev: Ev | null, next: Ev): number {
  if (!prev) return 1;
  const gap = next.at - prev.at;
  const read = prev.k === 'msg' ? Math.min(7, 2 + [...prev.m.text].length * 0.04) : 1.2;
  if (next.k !== 'msg') return Math.min(1.5, Math.max(0.6, gap));
  return Math.max(Math.min(read, 7), Math.min(gap, 2.5));
}

export type PlayerMode = 'live' | 'replay';

export interface PlayerStatus {
  mode: PlayerMode;
  /** Sim time being shown (unix s). */
  at: number;
  episode: Episode | null;
  /** History mode is on (you browse the past; the present waits). */
  history: boolean;
  /** Messages that arrived live while you were in history mode. */
  missed: number;
}

export class Player {
  events: Ev[] = [];
  mode: PlayerMode = 'live';
  at = 0;
  private queue: Ev[] = [];
  private wait = 0;
  private prev: Ev | null = null;
  private episode: Episode | null = null;
  private quietFor = 0;
  private storyIdx = -1;
  private ids = new Set<string>();
  autoStory = true;
  /** History mode: live messages don't pull you back to the present, and a
   *  replay that ends stays where it ended. */
  history = false;
  missed = 0;

  constructor(
    private director: Director,
    private onStatus: (s: PlayerStatus) => void = () => {},
    private onSeek: () => void = () => {},
  ) {}

  load(events: Ev[], now: number): void {
    this.events = [...events].sort((a, b) => a.at - b.at);
    this.ids = new Set(this.events.map(evId));
    this.storyIdx = -1;
    this.seek(now, false);
    this.goLive(now);
    // Start straight into the latest story when the village is quiet.
    const last = this.events.at(-1);
    if (this.autoStory && (!last || now - last.at > 10 * 60)) this.playStory(now);
  }

  /** A new event from the relay. */
  push(ev: Ev, now: number): void {
    if (this.ids.has(evId(ev))) return;
    this.ids.add(evId(ev));
    // Kept in time order (the chat, unread counts and read cursors read it so):
    // a reconnect's catch-up or a channel listed late comes newest first.
    const at = insertByTime(this.events, ev);
    // Kept for history and the chat's totals, but news it isn't: no flight, no cut to live.
    if (ev.k === 'zap' && now - ev.at > ZAP_LIVE_S) return;
    // Backfill from before what's already here: kept, not acted out as if just said.
    if (at < this.events.length - 1 && now - ev.at > ZAP_LIVE_S) return;
    this.quietFor = 0;
    if (this.history) {
      // Kept for later; counted so you know the present moved on.
      this.missed++;
      this.status();
      return;
    }
    if (this.mode !== 'live') {
      this.seek(now, true);
      this.goLive(now);
    }
    this.at = now;
    this.apply(ev, false, 'balloon');
  }

  update(dtReal: number, now: number): void {
    if (this.mode === 'live') {
      this.at = now;
      this.director.tick(now);
      this.quietFor += dtReal;
      if (this.autoStory && this.quietFor > LIVE_IDLE_BEFORE_STORY) this.playStory(now);
      return;
    }
    this.wait -= dtReal;
    while (this.wait <= 0 && this.queue.length) {
      const ev = this.queue.shift()!;
      this.at = ev.at;
      this.apply(ev, false, 'door');
      this.director.tick(ev.at);
      this.prev = ev;
      this.wait += this.queue.length ? paceDelay(ev, this.queue[0]) : 0;
      this.status();
    }
    if (!this.queue.length && this.wait <= -8 && !this.history) {
      // Let the last line breathe, then return to the present.
      this.seek(now, true);
      this.goLive(now);
    }
  }

  /** Replay from `from` to `to` (default: now) at reading pace. */
  playFrom(from: number, to: number, now: number, episode: Episode | null = null): void {
    this.seek(from, true);
    this.mode = 'replay';
    this.episode = episode;
    this.queue = this.events.filter((e) => e.at >= from && e.at <= to);
    this.prev = null;
    this.wait = 0.8;
    this.quietFor = 0;
    if (!this.queue.length) { this.goLive(now); return; }
    this.status();
  }

  /** Cycle through recent episodes, newest first. */
  playStory(now: number): void {
    const eps = findEpisodes(this.events).reverse().slice(0, 6);
    if (!eps.length) { this.quietFor = 0; return; }
    this.storyIdx = (this.storyIdx + 1) % eps.length;
    const ep = eps[this.storyIdx];
    this.playFrom(ep.start - 1, ep.end, now, ep);
  }

  goLive(now: number): void {
    this.mode = 'live';
    this.missed = 0;
    this.queue = [];
    this.episode = null;
    this.at = now;
    this.quietFor = 0;
    this.status();
  }

  /** Rebuild the village as it was at `t`, without animation. */
  seek(t: number, transition: boolean): void {
    if (transition) this.onSeek();
    this.director.reset();
    const lastSeen = new Map<string, { groupId: string; at: number }>();
    for (const e of this.events) {
      if (e.at > t) break;
      if (e.k === 'msg') { if (!e.m.zapNote) lastSeen.set(e.m.pubkey, { groupId: e.m.groupId, at: e.at }); }
      else if (e.k === 'react') {
        if (!lastSeen.has(e.r.pubkey)) lastSeen.set(e.r.pubkey, { groupId: e.r.groupId, at: e.at });
      }
    }
    const residents = [...lastSeen.entries()].sort((a, b) => a[1].at - b[1].at);
    for (const [pk, s] of residents) this.director.addResident(pk, s.groupId, s.at);
    for (const e of this.events) {
      if (e.at > t) break;
      if (e.at < t - CONTEXT_WINDOW) continue;
      this.apply(e, true, 'instant');
    }
    this.director.tick(t);
    this.at = t;
  }

  private apply(e: Ev, instant: boolean, arrival: 'instant' | 'balloon' | 'door'): void {
    // The zap bot doesn't walk over to announce: its zap flies on its own.
    if (e.k === 'msg') { if (!e.m.zapNote) this.director.message(e.m, e.at, { instant, arrival }); }
    else if (e.k === 'react') this.director.reaction(e.r, e.at, instant);
    else this.director.zap(e.z, e.at, instant);
  }

  /** Tell the UI where things stand (mode, time, missed messages). */
  status(): void {
    this.onStatus({ mode: this.mode, at: this.at, episode: this.episode, history: this.history, missed: this.missed });
  }
}

function evId(e: Ev): string {
  return e.k === 'msg' ? e.m.id : e.k === 'react' ? e.r.id : e.z.id;
}
