// LABITCONF's stage plays its video while you're inside the hall (and La
// Crypta's back wall plays its live show, laCryptaLive.ts, through the same class). A YouTube
// player can't become a WebGL texture (cross-origin iframe), so the embed is
// a real <iframe> placed in 3D exactly over the LED wall (world/domScreen.ts).
// It is created when you walk in, looping, and removed when you walk out, so
// nothing loads or plays outside. It starts muted (browsers always
// let a muted video autoplay) and is unmuted through the player's own
// messages (enablejsapi) while sound is on: the page has had a gesture by
// then, and the iframe is allowed autoplay.

import * as THREE from 'three';
import { DomScreen } from './domScreen';

export const LABITCONF_VIDEO = 'UniEraIBJZQ';

/** The iframe's size in CSS pixels (16:9); the 3D object is scaled to the wall. */
const PX_W = 1280, PX_H = 720;

export const YT_ORIGIN = 'https://www.youtube-nocookie.com';

/** The embed: autoplay (muted, so it may), looped (YouTube loops a single video only through `playlist`), no controls, driven by messages. */
export function embedUrl(id: string = LABITCONF_VIDEO, origin?: string): string {
  const q = new URLSearchParams({
    autoplay: '1', mute: '1', loop: '1', playlist: id, controls: '0',
    playsinline: '1', modestbranding: '1', rel: '0', disablekb: '1', iv_load_policy: '3',
    enablejsapi: '1',
  });
  if (origin) q.set('origin', origin);
  return `${YT_ORIGIN}/embed/${id}?${q}`;
}

/** What a stage plays: the embed's address (given the page's origin) and the iframe's title. */
export interface StageSource {
  url: (origin?: string) => string;
  title: string;
}

export const LABITCONF_SOURCE: StageSource = { url: (origin) => embedUrl(LABITCONF_VIDEO, origin), title: 'LABITCONF' };

export class YoutubeStage {
  private layer: DomScreen;
  private iframe: HTMLIFrameElement | null = null;
  private sound = false;
  private volume = 100;
  /** Seconds left to keep telling a fresh player whether to sound (it ignores messages until ready). */
  private tell = 0;

  constructor(parent: HTMLElement, after: Element | null, screen: THREE.Object3D, width: number, height: number, private source = LABITCONF_SOURCE, className = 'stage-video') {
    this.layer = new DomScreen(parent, after, screen, width, height, className, PX_W);
  }

  /** Is the video's iframe in the page (you're inside)? */
  get playing(): boolean {
    return !!this.iframe;
  }

  /** Sound on (the Sound switch, and the page has had a gesture): unmuted at `volume` (0–100); off: muted. */
  setSound(on: boolean, volume = 100): void {
    if (on === this.sound && (!on || volume === this.volume)) return;
    this.sound = on;
    this.volume = volume;
    this.tell = 6;
    this.command();
  }

  private command(): void {
    const w = this.iframe?.contentWindow;
    if (!w) return;
    const send = (func: string, args: unknown[] = []) => w.postMessage(JSON.stringify({ event: 'command', func, args }), YT_ORIGIN);
    if (this.sound) { send('unMute'); send('setVolume', [this.volume]); } else send('mute');
    send('playVideo');
  }

  setSize(w: number, h: number): void {
    this.layer.setSize(w, h);
  }

  /** Once a frame, after the world drew: `inside` starts or stops the video, the camera places it; `show` false hides the layer
   *  (something stands in front) while the video goes on. */
  update(camera: THREE.PerspectiveCamera, inside: boolean, dt = 0, show = true): void {
    if (inside && !this.iframe) {
      const f = document.createElement('iframe');
      f.src = this.source.url(typeof location !== 'undefined' ? location.origin : undefined);
      f.addEventListener('load', () => { this.tell = 6; this.command(); });
      f.title = this.source.title;
      f.allow = 'autoplay; encrypted-media; picture-in-picture';
      f.referrerPolicy = 'strict-origin-when-cross-origin';
      f.style.cssText = `width:${PX_W}px;height:${PX_H}px;border:0;pointer-events:none;display:block`;
      f.tabIndex = -1;
      this.layer.holder.append(f);
      this.iframe = f;
    } else if (!inside && this.iframe) {
      this.iframe.remove();
      this.iframe = null;
    }
    // A fresh player only hears commands once it's ready: say it again each second for a while.
    if (this.iframe && this.tell > 0) {
      const before = Math.ceil(this.tell);
      this.tell -= dt;
      if (Math.ceil(this.tell) !== before) this.command();
    }
    this.layer.update(camera, inside && show);
  }

  dispose(): void {
    this.iframe?.remove();
    this.iframe = null;
    this.layer.dispose();
  }
}
