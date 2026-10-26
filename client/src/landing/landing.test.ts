// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { COPY, LANGS, pickLang, type CopyKey } from './copy';
import { applyLang, mountHeader, mountLanding, mountOrbit, nextLang } from './landing';

const html = readFileSync(join(__dirname, '../../index.html'), 'utf8');
const css = readFileSync(join(__dirname, 'landing.css'), 'utf8');

describe('landing copy', () => {
  it('has every word in both languages', () => {
    const keys = Object.keys(COPY.en).sort();
    for (const l of LANGS) {
      expect(Object.keys(COPY[l]).sort()).toEqual(keys);
      for (const k of keys) expect(COPY[l][k as CopyKey].trim(), `${l} ${k}`).not.toBe('');
    }
  });
  it('covers every key the page uses, and the page carries the English', () => {
    document.documentElement.innerHTML = html.replace(/^<!doctype html>/i, '');
    const els = [...document.querySelectorAll<HTMLElement>('[data-i18n]')];
    expect(els.length).toBeGreaterThan(20);
    for (const el of els) expect(el.textContent).toBe(COPY.en[el.dataset.i18n as CopyKey]);
  });
  it('switches the page to Spanish and back', () => {
    document.documentElement.innerHTML = html.replace(/^<!doctype html>/i, '');
    applyLang(document, 'es');
    expect(document.documentElement.lang).toBe('es');
    expect(document.querySelector('h1')!.textContent).toBe(COPY.es['hero.title']);
    expect(document.querySelector('[data-lang="es"]')!.getAttribute('aria-pressed')).toBe('true');
    applyLang(document, 'en');
    expect(document.querySelector('h1')!.textContent).toBe(COPY.en['hero.title']);
  });
  it('keeps "Nostr" in the headline its own shimmering word, in both languages', () => {
    document.documentElement.innerHTML = html.replace(/^<!doctype html>/i, '');
    expect(document.querySelector('h1 .glow-word')!.textContent).toBe('Nostr');
    for (const l of LANGS) {
      applyLang(document, l);
      const glow = document.querySelectorAll('h1 .glow-word');
      expect(glow).toHaveLength(1);
      expect(glow[0].textContent).toBe('Nostr');
    }
    expect(COPY.es['hero.title']).toBe('Entrá al mundo de Nostr, caminando.');
  });
  it('closes on the mark in a sky-blue pill and "island" shimmering violet like "Nostr", in both languages', () => {
    document.documentElement.innerHTML = html.replace(/^<!doctype html>/i, '');
    expect(document.querySelector('.cta > .cta-mark > img')!.getAttribute('src')).toBe('/brand/sky-mark.svg');
    expect(css).toMatch(/\.cta-mark \{[^}]*border-radius: 999px;[^}]*background: linear-gradient/);
    expect(css).toMatch(/\.cta-mark \{[^}]*animation: float/);
    expect(css).toMatch(/prefers-reduced-motion: reduce\)[^@]*\.cta-mark[^{]*\{ animation: none; \}/);
    expect(document.querySelector('.cta h2 .glow-word')!.textContent).toBe('island');
    for (const [l, word] of [['es', 'isla'], ['en', 'island']] as const) {
      applyLang(document, l);
      const h2 = document.querySelector('.cta h2')!;
      expect(h2.textContent).toBe(COPY[l]['cta.title']);
      const glow = h2.querySelectorAll('.glow-word');
      expect(glow).toHaveLength(1);
      expect(glow[0].textContent).toBe(word);
    }
  });
  it('keeps the header at the top while scrolling, frosted once the page has moved', () => {
    document.documentElement.innerHTML = html.replace(/^<!doctype html>/i, '');
    expect(css).toMatch(/\.nav \{[^}]*position: sticky; top: 0; z-index: 10;/);
    expect(css).toMatch(/\.nav\.scrolled \{[^}]*backdrop-filter/);
    const nav = document.querySelector<HTMLElement>('header.nav')!;
    // Everything the header had is still in it.
    for (const sel of ['.nav-brand', '.nav-links', '.lang', 'a.gh', '[data-i18n="nav.enter"]']) expect(nav.querySelector(sel), sel).not.toBeNull();
    let onScroll = (): void => {};
    const win = { scrollY: 0, addEventListener: (_: string, f: () => void) => { onScroll = f; } } as unknown as Window;
    mountHeader(nav, win);
    expect(nav.classList.contains('scrolled')).toBe(false);
    (win as { scrollY: number }).scrollY = 300;
    onScroll();
    expect(nav.classList.contains('scrolled')).toBe(true);
    (win as { scrollY: number }).scrollY = 0;
    onScroll();
    expect(nav.classList.contains('scrolled')).toBe(false);
  });
  it('switches language on any click of the EN | ES pill, wherever it lands', () => {
    document.documentElement.innerHTML = html.replace(/^<!doctype html>/i, '');
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    localStorage.clear();
    mountLanding(document);
    const h1 = () => document.querySelector('h1')!.textContent;
    const btn = (l: string) => document.querySelector<HTMLButtonElement>(`[data-lang="${l}"]`)!;
    expect(document.documentElement.lang).toBe('en');
    btn('en').click(); // the side already on
    expect(document.documentElement.lang).toBe('es');
    expect(h1()).toBe(COPY.es['hero.title']);
    btn('es').click();
    expect(document.documentElement.lang).toBe('en');
    document.querySelector<HTMLElement>('.lang')!.click(); // the pill's edge
    expect(document.documentElement.lang).toBe('es');
    btn('en').click(); // the other side still picks it
    expect(document.documentElement.lang).toBe('en');
    expect(btn('en').getAttribute('aria-pressed')).toBe('true');
    expect(nextLang('en')).toBe('es');
    expect(nextLang('es')).toBe('en');
    localStorage.clear();
    vi.restoreAllMocks();
  });
  it('sends every call to action to the village', () => {
    document.documentElement.innerHTML = html.replace(/^<!doctype html>/i, '');
    for (const k of ['nav.enter', 'hero.enter', 'cta.enter']) expect(document.querySelector(`[data-i18n="${k}"]`)!.getAttribute('href')).toBe('/app');
  });
  it('links the family at the foot: Obelisk, nostr-wot, Liberture, La Crypta, and the code on GitHub', () => {
    document.documentElement.innerHTML = html.replace(/^<!doctype html>/i, '');
    const hrefs = [...document.querySelectorAll('.foot > a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['https://obelisk.ar', 'https://nostr-wot.com', 'https://liberture.com', 'https://lacrypta.ar', GITHUB]);
  });
  it('draws every feature as its own animated icon, stilled for reduced motion', () => {
    document.documentElement.innerHTML = html.replace(/^<!doctype html>/i, '');
    const icons = [...document.querySelectorAll<SVGElement>('.feature > svg')];
    expect(icons).toHaveLength(10);
    for (const svg of icons) {
      expect(svg.classList.contains('ico')).toBe(true);
      expect(svg.getAttribute('viewBox')).toBe('0 0 32 32');
      const name = [...svg.classList].find((c) => c.startsWith('ico-'))!.slice(4);
      expect(svg.parentElement!.querySelector('h3')!.dataset.i18n).toBe(`f.${name}.t`);
      expect(css, name).toMatch(new RegExp(`\\.ico-${name} [^{]*\\{[^}]*animation:`));
    }
    expect(css).toMatch(/prefers-reduced-motion: reduce\)[^@]*\.ico \* \{ animation: none; \}/);
  });
  it('has a GitHub button in the header', () => {
    document.documentElement.innerHTML = html.replace(/^<!doctype html>/i, '');
    const gh = document.querySelector('.nav a.gh');
    expect(gh?.getAttribute('href')).toBe(GITHUB);
    expect(gh?.getAttribute('target')).toBe('_blank');
  });
});

const GITHUB = 'https://github.com/obelisk-app/obelisk-sky';

describe('the hero orbit', () => {
  /** A window whose reduced-motion and Save-Data settings and the video's
   *  visibility the test sets. */
  function setup({ reduce = false, saveData = false, io = true } = {}) {
    document.documentElement.innerHTML = html.replace(/^<!doctype html>/i, '');
    const video = document.querySelector<HTMLVideoElement>('video.orbit')!;
    let paused = true;
    Object.defineProperty(video, 'paused', { get: () => paused });
    const play = vi.fn(() => { paused = false; return Promise.resolve(); });
    const pause = vi.fn(() => { paused = true; });
    Object.assign(video, { play, pause });
    const mq = { matches: reduce, listeners: [] as (() => void)[], addEventListener(_: string, f: () => void) { this.listeners.push(f); } };
    let seen: ((e: { isIntersecting: boolean }[]) => void) | null = null;
    const win = {
      matchMedia: () => mq,
      navigator: { connection: { saveData } },
      IntersectionObserver: io ? class { constructor(f: typeof seen) { seen = f; } observe() {} } : undefined,
    } as unknown as Window & typeof globalThis;
    mountOrbit(video, win);
    return { video, play, pause, mq, show: (v: boolean) => seen!([{ isIntersecting: v }]) };
  }

  it('shows the first frame as a picture, the silent looping video over it, loading nothing up front', () => {
    document.documentElement.innerHTML = html.replace(/^<!doctype html>/i, '');
    const [img, v] = [...document.querySelector('.porthole')!.children] as [HTMLImageElement, HTMLVideoElement];
    expect(img.getAttribute('src')).toMatch(/^\/landing\/island\.webp\?v=\d+$/);
    expect(img.alt).toBeTruthy();
    expect(v.classList.contains('orbit')).toBe(true);
    expect(v.getAttribute('aria-hidden')).toBe('true');
    for (const a of ['muted', 'loop', 'playsinline']) expect(v.hasAttribute(a), a).toBe(true);
    expect(v.hasAttribute('autoplay')).toBe(false);
    expect(v.getAttribute('preload')).toBe('none');
    // H.264 only: a browser without it keeps the picture.
    expect([...v.querySelectorAll('source')].map((x) => x.getAttribute('src')!.replace(/\?v=\d+$/, ''))).toEqual(['/landing/island-orbit.mp4']);
    expect(css).toMatch(/\.porthole video \{ opacity: 0;/);
    expect(css).toMatch(/\.porthole video\.playing \{ opacity: 1; \}/);
  });
  it('plays while on screen and pauses off it', () => {
    const { video, play, pause, show } = setup();
    expect(play).not.toHaveBeenCalled();
    show(true);
    expect(play).toHaveBeenCalledTimes(1);
    expect(video.preload).toBe('auto');
    // It fades in over the picture once it really plays.
    expect(video.classList.contains('playing')).toBe(false);
    video.dispatchEvent(new Event('playing'));
    expect(video.classList.contains('playing')).toBe(true);
    show(false);
    expect(pause).toHaveBeenCalledTimes(1);
  });
  it('stays on the poster under reduced motion, and stops if it is turned on', () => {
    const r = setup({ reduce: true });
    r.show(true);
    expect(r.play).not.toHaveBeenCalled();
    const m = setup();
    m.show(true);
    m.mq.matches = true;
    m.mq.listeners.forEach((f) => f());
    expect(m.pause).toHaveBeenCalledTimes(1);
  });
  it('stays on the poster with Save-Data, and plays at once without IntersectionObserver', () => {
    const s = setup({ saveData: true });
    s.show(true);
    expect(s.play).not.toHaveBeenCalled();
    expect(setup({ io: false }).play).toHaveBeenCalledTimes(1);
  });
});

describe('pickLang', () => {
  it('prefers ?lang=, then the saved choice, then the browser', () => {
    expect(pickLang('?lang=es', 'en', ['en-US'])).toBe('es');
    expect(pickLang('', 'es', ['en-US'])).toBe('es');
    expect(pickLang('', null, ['es-AR', 'en'])).toBe('es');
    expect(pickLang('?lang=fr', 'xx', ['pt-BR', 'de'])).toBe('en');
  });
});

describe('the social cards', () => {
  it("links Obelisk's official accounts, each in a new tab", () => {
    document.documentElement.innerHTML = html.replace(/^<!doctype html>/i, '');
    const links = [...document.querySelectorAll<HTMLAnchorElement>('#social a.social-card')];
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      'https://www.instagram.com/obelisk.ar',
      'https://www.youtube.com/@obelisk_ar',
      'https://x.com/obelisk_ar',
    ]);
    expect(links.map((a) => a.querySelector('.handle')!.textContent)).toEqual(['@obelisk.ar', '@obelisk_ar', '@obelisk_ar']);
    for (const a of links) {
      expect(a.target).toBe('_blank');
      expect(a.rel).toContain('noopener');
    }
  });
  it('repeats them as named icons in the footer, after the closing call to action', () => {
    document.documentElement.innerHTML = html.replace(/^<!doctype html>/i, '');
    const icons = [...document.querySelectorAll<HTMLAnchorElement>('.foot-social a')];
    expect(icons.map((a) => a.getAttribute('aria-label'))).toEqual(['Instagram @obelisk.ar', 'YouTube @obelisk_ar', 'X @obelisk_ar']);
    const sections = [...document.querySelectorAll('main > section')].map((s) => s.id || s.className);
    expect(sections.slice(-2)).toEqual(['cta', 'social']);
  });
});
