// Local preferences: how this browser renders and plays the village. Kept in
// localStorage only (nothing here is published); every value is checked on
// load, so a hand-edited or old entry falls back to its default.

export const QUALITIES = ['auto', 'low', 'medium', 'high', 'ultra'] as const;
export type QualityPref = (typeof QUALITIES)[number];
export const TIMES = ['auto', 'day', 'sunset', 'night'] as const;
export type TimePref = (typeof TIMES)[number];
export { CHAT_OPEN_PREFS, type ChatOpenPref } from './ui/chatAuto';
import { CHAT_OPEN_PREFS, type ChatOpenPref } from './ui/chatAuto';

export interface Prefs {
  v: 1;
  // Graphics
  quality: QualityPref;
  resolution: number; // render scale, 0.5 .. 1.5 of the device pixel ratio cap
  shadows: boolean;
  ambientOcclusion: boolean;
  bloom: boolean;
  grass: boolean;
  // World
  timeOfDay: TimePref;
  signs: boolean;
  bubbles: boolean;
  feed: boolean;
  /** The minimap in the corner (ui/minimap.ts; N toggles it), and whether it turns with the camera. */
  minimap: boolean;
  minimapRotate: boolean;
  /** Publish where you walk so others see you move live (nostr/motion.ts). */
  shareMotion: boolean;
  // Camera and controls
  autoDirector: boolean;
  fov: number; // first-person field of view, degrees
  mouseSensitivity: number; // 0.25 .. 3
  invertY: boolean;
  // Chat
  chatOpacity: number; // 0.15 .. 1, the chat panel's background
  /** Walking into a channel's yard: open its chat, offer a button, or nothing. */
  chatOpen: ChatOpenPref;
  // Sound
  sound: boolean;
  volume: number; // 0 .. 1
  /** Music while people near you dance or work out (audio/emoteMusic.ts). */
  emoteMusic: boolean;
  /** The world's own sounds (crickets at night), apart from emotes and music. */
  ambience: boolean;
  /** Your steps, walking and running (sound.ts footstep). */
  footsteps: boolean;
  /** Music where it plays: cumbia at the parrilla, a guitar by the campfires (audio/placeMusic.ts). */
  placeMusic: boolean;
  // Relay
  relay: string; // the group relay being browsed ('' = Obelisk's default)
  customRelays: string[]; // relays you added to the picker
}

export const DEFAULT_PREFS: Prefs = {
  v: 1,
  quality: 'auto',
  resolution: 1,
  shadows: true,
  ambientOcclusion: true,
  bloom: true,
  grass: true,
  timeOfDay: 'auto',
  signs: true,
  bubbles: true,
  feed: true,
  minimap: true,
  minimapRotate: false,
  shareMotion: true,
  autoDirector: true,
  fov: 70,
  mouseSensitivity: 1,
  invertY: false,
  chatOpacity: 0.42,
  chatOpen: 'ask',
  sound: false,
  volume: 0.6,
  emoteMusic: true,
  ambience: true,
  footsteps: true,
  placeMusic: true,
  relay: '',
  customRelays: [],
};

export const PREFS_KEY = 'obelisk-sky/prefs';

const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
const num = (v: unknown, d: number, lo: number, hi: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;
const oneOf = <T extends string>(list: readonly T[], v: unknown, d: T): T => (list.includes(v as T) ? (v as T) : d);

/** Validate anything (stored JSON, a partial patch) into full prefs. */
export function normalizePrefs(raw: unknown): Prefs {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_PREFS;
  return {
    v: 1,
    quality: oneOf(QUALITIES, r.quality, d.quality),
    resolution: num(r.resolution, d.resolution, 0.5, 1.5),
    shadows: bool(r.shadows, d.shadows),
    ambientOcclusion: bool(r.ambientOcclusion, d.ambientOcclusion),
    bloom: bool(r.bloom, d.bloom),
    grass: bool(r.grass, d.grass),
    timeOfDay: oneOf(TIMES, r.timeOfDay, d.timeOfDay),
    signs: bool(r.signs, d.signs),
    bubbles: bool(r.bubbles, d.bubbles),
    feed: bool(r.feed, d.feed),
    minimap: bool(r.minimap, d.minimap),
    minimapRotate: bool(r.minimapRotate, d.minimapRotate),
    shareMotion: bool(r.shareMotion, d.shareMotion),
    autoDirector: bool(r.autoDirector, d.autoDirector),
    fov: num(r.fov, d.fov, 50, 100),
    mouseSensitivity: num(r.mouseSensitivity, d.mouseSensitivity, 0.25, 3),
    invertY: bool(r.invertY, d.invertY),
    chatOpacity: num(r.chatOpacity, d.chatOpacity, 0.15, 1),
    chatOpen: oneOf(CHAT_OPEN_PREFS, r.chatOpen, d.chatOpen),
    sound: bool(r.sound, d.sound),
    volume: num(r.volume, d.volume, 0, 1),
    emoteMusic: bool(r.emoteMusic, d.emoteMusic),
    ambience: bool(r.ambience, d.ambience),
    footsteps: bool(r.footsteps, d.footsteps),
    placeMusic: bool(r.placeMusic, d.placeMusic),
    relay: typeof r.relay === 'string' && /^wss?:\/\/[^\s]+$/i.test(r.relay) ? r.relay : '',
    customRelays: Array.isArray(r.customRelays)
      ? [...new Set(r.customRelays.filter((u): u is string => typeof u === 'string' && /^wss?:\/\/[^\s]+$/i.test(u)))].slice(0, 20)
      : [],
  };
}

export class PrefsStore {
  private value: Prefs;
  private listeners = new Set<(p: Prefs, prev: Prefs) => void>();

  constructor(private storage: Storage | null = safeStorage()) {
    let raw: unknown = null;
    try { raw = JSON.parse(this.storage?.getItem(PREFS_KEY) ?? 'null'); } catch { raw = null; }
    this.value = normalizePrefs(raw);
  }

  get(): Prefs {
    return this.value;
  }

  set(patch: Partial<Prefs>): void {
    const prev = this.value;
    this.value = normalizePrefs({ ...prev, ...patch });
    try { this.storage?.setItem(PREFS_KEY, JSON.stringify(this.value)); } catch { /* private mode: this visit only */ }
    for (const l of this.listeners) l(this.value, prev);
  }

  reset(): void {
    try { this.storage?.removeItem(PREFS_KEY); } catch { /* ignore */ }
    const prev = this.value;
    this.value = { ...DEFAULT_PREFS };
    for (const l of this.listeners) l(this.value, prev);
  }

  onChange(cb: (p: Prefs, prev: Prefs) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
}

function safeStorage(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}
