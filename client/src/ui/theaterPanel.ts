// The theater's watch mode. The hall's controls are the call bar's (main.ts
// renderCall): pick a voice channel, join its call, share your screen, watch,
// chat. Everyone in the call is equal, as in obelisk-dex's voice channels.

import { vw } from '../i18n/village';

export const isVoiceKind = (kind: string): boolean => kind.startsWith('voice');

/** The layout width of a page watched in the village, in CSS pixels: wider than the 700 px where totemcillo
 *  draws its phone layout, so no device is ever shown that layout here. The totem monitor's page (world/totemMonitor.ts)
 *  is a 16:9 box of this size, scaled onto its screen; Watch mode's page is laid out at this width and the watch
 *  view's own height (fitPage), so it fills the box with no bands, and scaled whole. */
export const PAGE_VIEWPORT = { W: 1600, H: 900 } as const;

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

const btn = (text: string, cls: string, on: () => void, title = ''): HTMLButtonElement => {
  const b = h('button', `account-btn ${cls}`.trim(), text);
  b.type = 'button';
  if (title) b.title = title;
  b.addEventListener('click', on);
  return b;
};

/** A page in an <iframe>, to be looked at, not used: its scripts and its own storage, no popups, no navigating the village away;
 *  no pointer and no focus (Esc stays with the village; a page's QR is the way in). Its layout width is a desktop's
 *  (`pxW` — wider than the 700 px where totemcillo draws its phone layout), so the village never draws that layout, whatever
 *  device it runs on; Watch mode's page takes the watch view's own height from `fitPage`, the monitor's the 16:9 `pxH`. */
export function lookOnlyFrame(src: string, title: string, pxW = PAGE_VIEWPORT.W, pxH = PAGE_VIEWPORT.H): HTMLIFrameElement {
  const f = h('iframe');
  f.title = title;
  f.setAttribute('sandbox', 'allow-scripts allow-same-origin');
  f.allow = 'autoplay';
  f.tabIndex = -1;
  Object.assign(f.style, { pointerEvents: 'none', border: '0', display: 'block', width: `${pxW}px`, height: `${pxH}px` });
  f.src = src; // set last: the page's first layout is already the desktop box
  return f;
}

/** Fill `box` with `f`: laid out at a desktop width (`PAGE_VIEWPORT.W`) and the box's own height, so the page fills
 *  the box — no letterbox bands on any side, and still never the phone layout — then scaled whole by the width. */
function fitPage(f: HTMLIFrameElement, box: HTMLElement): () => void {
  const fit = () => {
    const w = box.clientWidth, h = box.clientHeight;
    if (w <= 0 || h <= 0) return;
    f.style.height = `${Math.round((PAGE_VIEWPORT.W * h) / w)}px`;
    f.style.transform = `scale(${w / PAGE_VIEWPORT.W})`;
  };
  fit();
  window.addEventListener('resize', fit);
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fit) : null;
  ro?.observe(box);
  return () => { window.removeEventListener('resize', fit); ro?.disconnect(); };
}

/**
 * Watch mode: the film fills the page under the chat and the call bar; the 3D village isn't drawn (main.ts skips the frame) until
 * you come back. `show` swaps the stream (or a card's words when nothing
 * plays). Given a `page` instead (the totem monitor, world/totemMonitor.ts),
 * it holds that page in an iframe, made here and gone on `close`.
 */
export class WatchView {
  readonly el: HTMLElement;
  private video: HTMLVideoElement;
  private card: HTMLElement;
  private stream: MediaStream | null = null;
  private key = (e: KeyboardEvent) => { if (e.key === 'Escape') this.onClose(); };
  /** Stops the fitted page's resize watch (the `page` view only). */
  private unfit: (() => void) | null = null;

  /** `parent` is the village's own layer (#app), so the chat and the call bar stay over the film. */
  constructor(private onClose: () => void, parent: HTMLElement = document.body, page?: string) {
    this.el = h('div', page ? 'theater-watch theater-watch-page' : 'theater-watch');
    this.video = h('video');
    this.video.muted = true; // the sound plays through the call
    this.video.autoplay = true;
    this.video.playsInline = true;
    this.card = h('div', 'theater-watch-card');
    const back = btn(vw.backToVillage, 'theater-watch-back', () => this.onClose(), 'Esc');
    let frame: HTMLIFrameElement | null = null;
    if (page) {
      frame = lookOnlyFrame(page, 'Totem LABITCONF');
      this.el.append(frame, back);
    } else this.el.append(this.video, this.card, back);
    parent.prepend(this.el);
    if (frame) this.unfit = fitPage(frame, this.el);
    document.body.classList.add('watching');
    window.addEventListener('keydown', this.key);
  }

  show(stream: MediaStream | null, words: [string, string]): void {
    if (stream !== this.stream) {
      this.stream = stream;
      this.video.srcObject = stream;
      if (stream) void this.video.play().catch(() => {});
    }
    this.video.hidden = !stream;
    this.card.hidden = !!stream;
    this.card.replaceChildren(h('div', 'theater-watch-title', words[0]), h('div', 'theater-watch-line', words[1]));
  }

  close(): void {
    window.removeEventListener('keydown', this.key);
    this.unfit?.();
    this.unfit = null;
    this.video.srcObject = null;
    this.el.remove();
    document.body.classList.remove('watching');
  }
}
