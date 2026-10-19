// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { vw } from '../i18n/village';

describe('watch mode', () => {
  it('covers the page with the film (or a card), hides the village’s controls, and closes on Esc', async () => {
    const { WatchView } = await import('./theaterPanel');
    let closed = 0;
    const w = new WatchView(() => { closed++; });
    expect(document.body.classList.contains('watching')).toBe(true);
    w.show(null, ['Cine', 'Nobody is sharing yet']);
    expect(w.el.textContent).toContain('Nobody is sharing yet');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(closed).toBe(1);
    w.close();
    expect(document.body.classList.contains('watching')).toBe(false);
    expect(document.querySelector('.theater-watch')).toBeNull();
  });

  it('can hold a page instead of the film (the totem): made on entering, gone (with its connections) on leaving', async () => {
    const { WatchView } = await import('./theaterPanel');
    let closed = 0;
    const w = new WatchView(() => { closed++; }, document.body, 'https://totemcillo.vercel.app/');
    const f = w.el.querySelector('iframe')!;
    expect(f.src).toBe('https://totemcillo.vercel.app/');
    expect(w.el.querySelector('video')).toBeNull();
    expect(w.el.classList.contains('theater-watch-page')).toBe(true);
    expect(w.el.textContent).toContain(vw.backToVillage);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(closed).toBe(1);
    w.close();
    expect(document.querySelectorAll('iframe')).toHaveLength(0);
    expect(document.body.classList.contains('watching')).toBe(false);
  });

  it('holds a page at a desktop layout viewport, not the watch view’s box: the village never draws its phone layout', async () => {
    const { WatchView, PAGE_VIEWPORT } = await import('./theaterPanel');
    const w = new WatchView(() => {}, document.body, 'https://totemcillo.vercel.app/');
    const f = w.el.querySelector('iframe')!;
    // Wider than the 700 px where totemcillo draws its phone layout, whatever the screen the village runs on.
    expect(PAGE_VIEWPORT.W).toBeGreaterThan(700);
    expect([f.style.width, f.style.height]).toEqual([`${PAGE_VIEWPORT.W}px`, `${PAGE_VIEWPORT.H}px`]);
    w.close();
  });

  it('fills the watch view’s box (no letterbox bands): a desktop layout width and the box’s own height, scaled whole', async () => {
    const { WatchView, PAGE_VIEWPORT } = await import('./theaterPanel');
    const w = new WatchView(() => {}, document.body, 'https://totemcillo.vercel.app/');
    const f = w.el.querySelector('iframe')!;
    // A short box (a phone held sideways, or a desktop window, with the chat open) is wider than 16:9.
    Object.defineProperty(w.el, 'clientWidth', { value: 1000, configurable: true });
    Object.defineProperty(w.el, 'clientHeight', { value: 500, configurable: true });
    window.dispatchEvent(new Event('resize'));
    const vh = Math.round((PAGE_VIEWPORT.W * 500) / 1000);
    // Laid out at a desktop width, the box's own height: the whole box, no bands on any side.
    expect(f.style.width).toBe(`${PAGE_VIEWPORT.W}px`);
    expect(f.style.height).toBe(`${vh}px`);
    expect(f.style.transform).toBe(`scale(${1000 / PAGE_VIEWPORT.W})`);
    expect(vh * (1000 / PAGE_VIEWPORT.W)).toBeCloseTo(500);
    w.close();
  });

  it('frames a page to be looked at, not used: its scripts and storage only, no pointer, no focus (Esc stays with the village)', async () => {
    const { lookOnlyFrame } = await import('./theaterPanel');
    const f = lookOnlyFrame('https://totemcillo.vercel.app/', 'Totem LABITCONF');
    expect(f.src).toBe('https://totemcillo.vercel.app/');
    expect(f.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin');
    expect(f.tabIndex).toBe(-1);
    expect(f.style.pointerEvents).toBe('none');
  });
});
