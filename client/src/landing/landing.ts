// The landing page at /: the language switch and the hero's island orbit. No
// Three.js, no React; the village itself lives at /app.

import { COPY, LANGS, pickLang, rememberLang, storedLang, type CopyKey, type Lang } from './copy';

/** Put `lang`'s words into every `[data-i18n]` element under `root`. */
export function applyLang(doc: Document, lang: Lang): void {
  const words = COPY[lang];
  doc.documentElement.lang = lang;
  doc.title = words['meta.title'];
  for (const el of doc.querySelectorAll<HTMLElement>('[data-i18n]')) {
    const w = words[el.dataset.i18n as CopyKey];
    if (w) el.textContent = w;
    if (w && el.dataset.glow) glowWord(el, el.dataset.glow);
  }
  for (const b of doc.querySelectorAll<HTMLButtonElement>('[data-lang]')) b.setAttribute('aria-pressed', String(b.dataset.lang === lang));
}

/** Wrap each `word` in `el`'s text in a `.glow-word` span (the hero's shimmering "Nostr"). */
export function glowWord(el: HTMLElement, word: string): void {
  const text = el.textContent ?? '';
  const parts = text.split(word);
  if (parts.length < 2) return;
  el.textContent = '';
  parts.forEach((part, i) => {
    if (i > 0) {
      const span = el.ownerDocument.createElement('span');
      span.className = 'glow-word';
      span.textContent = word;
      el.append(span);
    }
    if (part) el.append(part);
  });
}

/** The hero's island orbit (`video.orbit`): it plays only while it's on
 *  screen, and never under reduced motion or Save-Data. Until it plays, the
 *  picture under it (its first frame) shows; it fades in once playing, and a
 *  browser that can't play it keeps the picture. Nothing is downloaded until
 *  it first plays (`preload="none"` in the page). */
export function mountOrbit(video: HTMLVideoElement, win: Window & typeof globalThis = window): void {
  const still = win.matchMedia?.('(prefers-reduced-motion: reduce)');
  const saveData = (win.navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
  let inView = false;
  video.addEventListener('playing', () => video.classList.add('playing'), { once: true });
  const sync = (): void => {
    if (inView && !still?.matches && !saveData) {
      video.preload = 'auto';
      // Refused autoplay (a browser's power saving) leaves the picture.
      video.play()?.catch(() => {});
    } else if (!video.paused) video.pause();
  };
  still?.addEventListener?.('change', sync);
  if (typeof win.IntersectionObserver !== 'function') { inView = true; sync(); return; }
  new win.IntersectionObserver((entries) => {
    inView = entries.some((e) => e.isIntersecting);
    sync();
  }).observe(video);
}

export function mountLanding(doc: Document): void {
  applyLang(doc, pickLang(location.search, storedLang(), navigator.languages ?? [navigator.language]));
  const orbit = doc.querySelector<HTMLVideoElement>('video.orbit');
  if (orbit) mountOrbit(orbit);
  for (const b of doc.querySelectorAll<HTMLButtonElement>('[data-lang]')) {
    b.addEventListener('click', () => {
      const lang = b.dataset.lang as Lang;
      if (!LANGS.includes(lang)) return;
      rememberLang(lang);
      applyLang(doc, lang);
    });
  }
}

if (typeof document !== 'undefined' && document.querySelector('.hero')) mountLanding(document);
