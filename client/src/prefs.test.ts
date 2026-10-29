import { describe, it, expect } from 'vitest';
import { PrefsStore, normalizePrefs, DEFAULT_PREFS, PREFS_KEY } from './prefs';

function mem(): Storage {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k), clear: () => m.clear(), key: () => null, length: 0 } as Storage;
}

describe('prefs', () => {
  it('fills defaults and clamps or rejects bad values', () => {
    const p = normalizePrefs({ quality: 'insane', resolution: 9, fov: 10, shadows: 'yes', chatOpacity: -1, volume: 0.3, extra: 1 });
    expect(p.quality).toBe('auto');
    expect(p.resolution).toBe(1.5);
    expect(p.fov).toBe(50);
    expect(p.shadows).toBe(true);
    expect(p.chatOpacity).toBe(0.15);
    expect(p.volume).toBe(0.3);
    expect('extra' in p).toBe(false);
    expect(normalizePrefs({ chatOpen: 'sometimes' }).chatOpen).toBe('ask');
    expect(normalizePrefs({ chatOpen: 'off' }).chatOpen).toBe('off');
  });
  it('ambient sounds and footsteps are their own switches, on by default', () => {
    expect(DEFAULT_PREFS.ambience).toBe(true);
    expect(DEFAULT_PREFS.footsteps).toBe(true);
    expect(DEFAULT_PREFS.placeMusic).toBe(true);
    expect(normalizePrefs({ placeMusic: false }).placeMusic).toBe(false);
    const p = normalizePrefs({ ambience: false, footsteps: 'no', emoteMusic: true });
    expect(p.ambience).toBe(false);
    expect(p.footsteps).toBe(true);
    expect(p.emoteMusic).toBe(true);
  });
  it('persists, survives junk, notifies, and resets', () => {
    const s = mem();
    s.setItem(PREFS_KEY, '{not json');
    const store = new PrefsStore(s);
    expect(store.get()).toEqual(DEFAULT_PREFS);
    let seen = 0;
    store.onChange(() => seen++);
    store.set({ quality: 'ultra', bloom: false });
    expect(new PrefsStore(s).get()).toMatchObject({ quality: 'ultra', bloom: false });
    store.reset();
    expect(store.get()).toEqual(DEFAULT_PREFS);
    expect(s.getItem(PREFS_KEY)).toBeNull();
    expect(seen).toBe(2);
  });
});
