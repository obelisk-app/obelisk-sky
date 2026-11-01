// What you are doing in the village, live: sitting on a bench, dips at the
// parallel bars. The first step towards multiplayer.
//
// Replaceable kind 30078, d=`obelisk-sky:activity:v1`, one per person,
// published to the group relay. Shaped like obelisk-dex game ops (a `t`
// marker, an `op` tag, JSON content) and carries a NIP-40 `expiration`: the
// player re-publishes every HEARTBEAT_S while the activity lasts, so a closed
// tab frees the spot within ACTIVITY_TTL_S. `stop` replaces it when you get up.
//
// Spots are named so every client finds the same one: `station:<index>` in
// CALISTHENICS_STATIONS order, `seat:<x*10>:<z*10>` by the seat's position on
// the seeded island. Two live claims on one spot: the earliest `since` holds
// it (ties by event id); the other person stands nearby.

import type { Event as NostrEvent, EventTemplate } from 'nostr-tools';
import type { RelayHub } from '@nostr-wot/relay/hub';
import type { ExerciseKind } from '../world/anim/exercises';
import { activeRelay } from './hub';
import { EMOTE_KINDS, type EmoteKind } from '../world/emotes';

export const ACTIVITY_D_TAG = 'obelisk-sky:activity:v1';
export const ACTIVITY_T_TAG = 'obelisk-sky-activity';
/** Seconds a claim lives without a heartbeat. */
export const ACTIVITY_TTL_S = 90;
/** Seconds between re-publishes while the activity lasts. */
export const HEARTBEAT_S = 45;
/** Milliseconds an activity must hold before it is published (E pressed twice); short, so
 *  people watching you walk up don't see you stand there before you sit. */
export const DEBOUNCE_MS = 300;

/**
 * An emote standing on the spot (`here:<x*10>:<z*10>`). Only remote signers
 * send these: their live movement is off (a bunker can't sign every second),
 * so an emote rides on this slower event instead of motion's `e`.
 */
export type EmoteActivity = `emote:${EmoteKind}`;
/** `ride`: on a nostrich (remote signers only: everyone else says so in their motion). */
export type ActivityKind = ExerciseKind | 'sit' | 'run' | 'ride' | EmoteActivity;
const KINDS: readonly ActivityKind[] = ['pushup', 'pullup', 'muscleup', 'dip', 'benchpress', 'squat', 'curl', 'deadlift', 'sit', 'run'];

export interface Activity { spot: string; kind: ActivityKind }

/** A live claim on a spot. `held` is false for the loser of a race for it. */
export interface Claim extends Activity { pk: string; since: number; id: string; exp: number; held: boolean }

type Vec2 = { x: number; z: number };

const SPOT_RE = /^(?:station:(\d{1,2})|seat:(-?\d{1,6}):(-?\d{1,6})|lane:(\d)|here:(-?\d{1,6}):(-?\d{1,6}))$/;

export const stationSpotId = (index: number): string => `station:${index}`;
export const seatSpotId = (p: Vec2): string => `seat:${Math.round(p.x * 10)}:${Math.round(p.z * 10)}`;
/** A lane of the running track (0 inside … 2 outside). */
export const laneSpotId = (index: number): string => `lane:${index}`;

/** Wherever you stand (an emote, or where you got on a nostrich). */
export const hereSpotId = (p: Vec2): string => `here:${Math.round(p.x * 10)}:${Math.round(p.z * 10)}`;
export const emoteActivity = (kind: EmoteKind): EmoteActivity => `emote:${kind}`;
/** The emote an activity kind names, if it is one. */
export function emoteOfActivity(kind: string): EmoteKind | null {
  const k = kind.startsWith('emote:') ? kind.slice(6) : '';
  return EMOTE_KINDS.has(k) ? (k as EmoteKind) : null;
}
export type ParsedSpot = { type: 'station'; index: number } | { type: 'seat'; pos: Vec2 } | { type: 'lane'; index: number } | { type: 'here'; pos: Vec2 };

export function parseSpot(id: string): ParsedSpot | null {
  const m = SPOT_RE.exec(id);
  if (!m) return null;
  if (m[1] !== undefined) return { type: 'station', index: Number(m[1]) };
  if (m[4] !== undefined) return { type: 'lane', index: Number(m[4]) };
  if (m[5] !== undefined) return { type: 'here', pos: { x: Number(m[5]) / 10, z: Number(m[6]) / 10 } };
  return { type: 'seat', pos: { x: Number(m[2]) / 10, z: Number(m[3]) / 10 } };
}

/** A spot and a kind that belong together: exercises at stations, sitting on seats, running in lanes. */
export function validActivity(spot: string, kind: unknown): kind is ActivityKind {
  const s = parseSpot(spot);
  if (!s) return false;
  if (s.type === 'here') return kind === 'ride' || (typeof kind === 'string' && emoteOfActivity(kind) !== null);
  if (!KINDS.includes(kind as ActivityKind)) return false;
  if (s.type === 'seat') return kind === 'sit';
  if (s.type === 'lane') return kind === 'run';
  return kind !== 'sit' && kind !== 'run';
}

const nowS = () => Math.floor(Date.now() / 1000);

/** `start` (with the activity) or `stop` (null). `since` is when it began. */
export function activityTemplate(a: Activity | null, since: number, prevCreatedAt = 0, at = nowS()): EventTemplate {
  const created = Math.max(at, prevCreatedAt + 1);
  const tags = [['d', ACTIVITY_D_TAG], ['t', ACTIVITY_T_TAG], ['op', a ? 'start' : 'stop']];
  if (a) tags.push(['spot', a.spot]);
  tags.push(['expiration', String(created + (a ? ACTIVITY_TTL_S : 30))]);
  return {
    kind: 30078,
    tags,
    content: JSON.stringify(a ? { v: 1, op: 'start', spot: a.spot, kind: a.kind, since: Math.min(since, created) } : { v: 1, op: 'stop' }),
    created_at: created,
  };
}

export interface ActivityRecord { pk: string; id: string; at: number; exp: number; since: number; activity: Activity | null }

const tag = (ev: NostrEvent, k: string) => ev.tags.find((t) => t[0] === k)?.[1];

/** Strict parse of a relay event; null when it isn't an activity event at all. */
export function parseActivity(ev: NostrEvent): ActivityRecord | null {
  if (ev.kind !== 30078 || tag(ev, 'd') !== ACTIVITY_D_TAG) return null;
  const exp = Number(tag(ev, 'expiration'));
  if (!Number.isFinite(exp)) return null;
  let j: Record<string, unknown>;
  try { j = JSON.parse(ev.content); } catch { return null; }
  if (!j || typeof j !== 'object' || j.v !== 1) return null;
  const base = { pk: ev.pubkey, id: ev.id, at: ev.created_at, exp: Math.min(exp, ev.created_at + ACTIVITY_TTL_S) };
  if (j.op === 'stop') return { ...base, since: ev.created_at, activity: null };
  if (j.op !== 'start' || typeof j.spot !== 'string' || !validActivity(j.spot, j.kind)) return null;
  const since = typeof j.since === 'number' && Number.isFinite(j.since) && j.since > 0 ? Math.min(Math.floor(j.since), ev.created_at) : ev.created_at;
  return { ...base, since, activity: { spot: j.spot, kind: j.kind as ActivityKind } };
}

/** Earlier `since` wins a spot; ties go to the lower event id. */
const before = (a: { since: number; id: string }, b: { since: number; id: string }) =>
  a.since !== b.since ? a.since < b.since : a.id < b.id;

/** Everyone's latest activity event on this relay, and who holds which spot. */
export class ActivityStore {
  private byPk = new Map<string, ActivityRecord>();
  private listeners = new Set<() => void>();
  private sub: { release(): void } | null = null;

  constructor(private hub: RelayHub) {}

  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  createdAt(pk: string): number {
    return this.byPk.get(pk)?.at ?? 0;
  }

  ingest(ev: NostrEvent): boolean {
    const r = parseActivity(ev);
    if (!r) return false;
    const prev = this.byPk.get(r.pk);
    if (prev && (prev.at > r.at || (prev.at === r.at && prev.id <= r.id))) return false;
    this.byPk.set(r.pk, r);
    for (const l of this.listeners) l();
    return true;
  }

  /**
   * Live claims at `now`, each marked held or not. `local` is the viewer's
   * own activity as this browser sees it, which may not be published yet:
   * it races like anyone else's and replaces the viewer's relay record (a
   * stale one is not a claim once this browser has stood up).
   */
  live(now: number, local?: { pk: string; activity: Activity | null; since: number } | null): Claim[] {
    const out: Claim[] = [];
    for (const r of this.byPk.values()) {
      if (local && r.pk === local.pk) continue;
      if (!r.activity || r.exp <= now) continue;
      out.push({ pk: r.pk, ...r.activity, since: r.since, id: r.id, exp: r.exp, held: false });
    }
    if (local?.activity) {
      // Once published, race with the published id so every client agrees on ties.
      const mine = this.byPk.get(local.pk);
      const id = mine?.activity?.spot === local.activity.spot ? mine.id : '';
      out.push({ pk: local.pk, ...local.activity, since: local.since, id, exp: Infinity, held: false });
    }
    const winner = new Map<string, Claim>();
    for (const c of out) {
      const w = winner.get(c.spot);
      if (!w || before(c, w)) winner.set(c.spot, c);
    }
    for (const w of winner.values()) w.held = true;
    return out;
  }

  start(): void {
    this.sub?.release();
    this.sub = this.hub.subscribe({
      relays: [activeRelay()],
      filters: [{ kinds: [30078], '#d': [ACTIVITY_D_TAG], since: nowS() - ACTIVITY_TTL_S - 30 }],
      priority: 'background',
      label: 'sky-activity',
      onEvent: (ev) => void this.ingest(ev),
    });
  }

  stop(): void {
    this.sub?.release();
    this.sub = null;
  }
}

/**
 * When to publish the viewer's activity: once it has held for DEBOUNCE_MS,
 * again every HEARTBEAT_S, and a stop when it ends. Pure: feed it the
 * current activity every frame and publish what it returns.
 */
export class ActivityBeacon {
  private seenKey = '';
  private changedAt = 0;
  private sentKey = '';
  private sentAt = 0;
  /** Seconds (unix) when the current activity began. */
  since = 0;

  update(current: Activity | null, nowMs: number): { activity: Activity | null; since: number } | null {
    const key = current ? `${current.spot}|${current.kind}` : '';
    if (key !== this.seenKey) {
      this.seenKey = key;
      this.changedAt = nowMs;
      if (current) this.since = Math.floor(nowMs / 1000);
    }
    const due = key !== this.sentKey
      ? nowMs - this.changedAt >= DEBOUNCE_MS
      : !!current && nowMs - this.sentAt >= HEARTBEAT_S * 1000;
    if (!due) return null;
    this.sentKey = key;
    this.sentAt = nowMs;
    return { activity: current, since: this.since };
  }

  /** Whether a start is out there that a stop should replace. */
  get published(): boolean {
    return this.sentKey !== '';
  }

  /** Forget what was sent (a new relay or a new session). */
  reset(): void {
    this.seenKey = '';
    this.sentKey = '';
    this.changedAt = 0;
    this.sentAt = 0;
  }
}
