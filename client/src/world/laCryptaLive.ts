// La Crypta's live show on the back of its house: a big screen on the back
// wall plays the channel's live stream (YouTube's `live_stream` embed:
// whatever the channel has live now, so each week's show needs no new id) on
// Tuesday evenings (`liveOn`: 18:00–23:00 in Buenos Aires, the show's night).
//
// Like the totem monitor (totemMonitor.ts), the player is a real <iframe>
// laid over the screen (youtubeStage.ts, domScreen.ts) while the camera is
// within `LIVE.VIEW_M`, hidden unless `OcclusionProbe` finds the whole screen
// clear; under it the screen's own texture is a painted card, an ordinary
// mesh that buildings hide. It starts muted and sounds while you stand behind
// the house within `LIVE.HEAR_M` of it, louder the nearer you are
// (`liveVolume`). World hangs it in La Crypta's frame (facade at z = 0).

import * as THREE from 'three';
import type { Vec2 } from './layout';
import { canvasTexture } from './landmarks/signs';
import { LA_CRYPTA_BACK_Z } from './lacrypta';
import { YT_ORIGIN, type StageSource } from './youtubeStage';

/** La Crypta's YouTube channel (@LaCryptaOk). */
export const LA_CRYPTA_CHANNEL = 'UCpZDn-b_pMRRDniII4hh37g';

export const LIVE = {
  /** The screen, 16:9, on the back wall (2.9 m wide, 2.7 m to the eaves). */
  W: 2.0,
  H: 1.125,
  /** Its centre's height: the bottom over the heads, the top under the gables. */
  Y: 1.55,
  X: 0,
  /** Out from the wall's face (the frame's depth). */
  Z: LA_CRYPTA_BACK_Z - 0.04,
  /** The show: Tuesdays (`getUTCDay` 2), from 18:00 to 23:00 in Buenos Aires (UTC−3, no summer time). */
  DAY: 2,
  FROM_H: 18,
  TO_H: 23,
  UTC_OFFSET_H: -3,
  /** The player is in the page while the camera is within VIEW_M of the screen, taken out past VIEW_M + VIEW_PAD. */
  VIEW_M: 10,
  VIEW_PAD: 2,
  /** Heard within HEAR_M of the screen (behind the house), at full volume within FULL_M. */
  HEAR_M: 8,
  FULL_M: 3,
} as const;

/** Is the show on at `now` (Tuesday evening in Buenos Aires)? */
export function liveOn(now = Date.now()): boolean {
  const ba = new Date(now + LIVE.UTC_OFFSET_H * 3_600_000);
  const h = ba.getUTCHours();
  return ba.getUTCDay() === LIVE.DAY && h >= LIVE.FROM_H && h < LIVE.TO_H;
}

/** Should the player be in the page, the camera `d` metres from the screen, `playing` if it is now? */
export function liveInView(d: number, playing: boolean): boolean {
  return d < LIVE.VIEW_M + (playing ? LIVE.VIEW_PAD : 0);
}

/** The volume (0–100, in steps of 10) for someone at `l` (house-local): only behind the house, louder the nearer the screen. */
export function liveVolume(l: Vec2): number {
  if (l.z > LIVE.Z) return 0;
  const d = Math.hypot(l.x - LIVE.X, l.z - LIVE.Z);
  const k = THREE.MathUtils.clamp((LIVE.HEAR_M - d) / (LIVE.HEAR_M - LIVE.FULL_M), 0, 1);
  return Math.round(k * 10) * 10;
}

/** The embed: the channel's live stream, autoplaying muted (so it may), no controls, driven by messages. */
export function liveEmbedUrl(origin?: string): string {
  const q = new URLSearchParams({
    channel: LA_CRYPTA_CHANNEL, autoplay: '1', mute: '1', controls: '0',
    playsinline: '1', modestbranding: '1', rel: '0', disablekb: '1', iv_load_policy: '3', enablejsapi: '1',
  });
  if (origin) q.set('origin', origin);
  return `${YT_ORIGIN}/embed/live_stream?${q}`;
}

export const LA_CRYPTA_LIVE_SOURCE: StageSource = { url: liveEmbedUrl, title: 'La Crypta en vivo' };

/** The screen's card (under the player, and the rest of the week): La Crypta's name and when it's live. Brand words, in English as other painted screens. */
export function drawLiveCard(c: CanvasRenderingContext2D, w: number, h: number): void {
  const grad = c.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, '#1a1210');
  grad.addColorStop(1, '#060403');
  c.fillStyle = grad;
  c.fillRect(0, 0, w, h);
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.shadowColor = '#ff6a1a';
  c.shadowBlur = w * 0.02;
  c.fillStyle = '#ffffff';
  c.font = `900 ${Math.round(h * 0.2)}px Inter, system-ui, sans-serif`;
  c.fillText('la crypta', w / 2, h * 0.42);
  c.shadowBlur = 0;
  // A red "live" dot and the night of the show.
  c.font = `800 ${Math.round(h * 0.075)}px Inter, system-ui, sans-serif`;
  const label = 'LIVE ON TUESDAYS';
  const tw = c.measureText(label).width, r = h * 0.03;
  c.fillStyle = '#ef4444';
  c.beginPath();
  c.arc(w / 2 - tw / 2 - r * 2.2, h * 0.66, r, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = '#ffb27a';
  c.fillText(label, w / 2 + r, h * 0.66);
}

export interface LiveScreen {
  /** In La Crypta's frame (put it where the house is, turned as it is). */
  group: THREE.Group;
  /** The screen (its front faces the house's −z, out of the back wall). */
  screen: THREE.Mesh;
}

/** The screen and its frame on the back wall, in the house's own frame. */
export function buildLiveScreen(): LiveScreen {
  const { W, H, Y, X, Z } = LIVE;
  const g = new THREE.Group();
  const depth = LA_CRYPTA_BACK_Z - Z;
  const frame = new THREE.Mesh(new THREE.BoxGeometry(W + 0.08, H + 0.08, depth), new THREE.MeshStandardMaterial({ color: 0x16171a, roughness: 0.85, flatShading: true }));
  frame.position.set(X, Y, Z + depth / 2);
  frame.castShadow = frame.receiveShadow = true;
  g.add(frame);
  const card = canvasTexture(1024, 576, (c) => drawLiveCard(c, 1024, 576));
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshBasicMaterial({ map: card, toneMapped: false }));
  screen.name = 'lacrypta-live-screen';
  screen.position.set(X, Y, Z - 0.002);
  screen.rotation.y = Math.PI;
  g.add(screen);
  return { group: g, screen };
}
