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

  it('frames a page to be looked at, not used: its scripts and storage only, no pointer, no focus (Esc stays with the village)', async () => {
    const { lookOnlyFrame } = await import('./theaterPanel');
    const f = lookOnlyFrame('https://totemcillo.vercel.app/', 'Totem LABITCONF');
    expect(f.src).toBe('https://totemcillo.vercel.app/');
    expect(f.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin');
    expect(f.tabIndex).toBe(-1);
    expect(f.style.pointerEvents).toBe('none');
  });
});
