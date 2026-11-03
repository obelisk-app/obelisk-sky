// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { maybeShowControlsGuide } from './controlsGuide';

const pointer = (coarse: boolean) => vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('coarse') ? coarse : false, media: q, addEventListener() {}, removeEventListener() {} }));

describe('the controls guide on first login', () => {
  beforeEach(() => { localStorage.clear(); document.body.replaceChildren(); });

  it('opens once by itself on a computer', () => {
    pointer(false);
    expect(maybeShowControlsGuide(document.body)).toBe(true);
    expect(document.querySelector('.guide')).not.toBeNull();
    expect(maybeShowControlsGuide(document.body)).toBe(false);
  });

  it('never opens by itself on a touch screen (the help button still opens it)', () => {
    pointer(true);
    expect(maybeShowControlsGuide(document.body)).toBe(false);
    expect(document.querySelector('.guide')).toBeNull();
  });
});
