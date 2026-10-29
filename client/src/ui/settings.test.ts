// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { LANG_NAMES, openSettings, SETTINGS_WORDS } from './settings';
import { PrefsStore } from '../prefs';

describe('settings in the village’s language', () => {
  it('has every word in Spanish', () => {
    expect(Object.keys(SETTINGS_WORDS.es).sort()).toEqual(Object.keys(SETTINGS_WORDS.en).sort());
  });
  it('draws the panel in Spanish when the landing page chose Spanish', () => {
    const root = document.createElement('div');
    openSettings(root, new PrefsStore(), () => 'medium', 'es');
    const text = root.textContent ?? '';
    expect(text).toContain('Ajustes');
    expect(text).toContain('Gráficos');
    expect(text).toContain('Listo');
    expect(text).not.toContain('Graphics');
  });
  it('switches the language from its first row', () => {
    const root = document.createElement('div');
    const onLang = vi.fn();
    openSettings(root, new PrefsStore(), () => 'medium', 'en', onLang);
    const sel = root.querySelector<HTMLSelectElement>('.settings-lang')!;
    expect(sel.closest('label')!.textContent).toContain('Language · Idioma');
    expect([...sel.options].map((o) => o.textContent)).toEqual([LANG_NAMES.en, LANG_NAMES.es]);
    expect(sel.value).toBe('en');
    sel.value = 'es';
    sel.dispatchEvent(new Event('change'));
    expect(onLang).toHaveBeenCalledWith('es');
  });
  it('shows the language row in Spanish as Idioma', () => {
    const root = document.createElement('div');
    openSettings(root, new PrefsStore(), () => 'medium', 'es', () => {});
    const sel = root.querySelector<HTMLSelectElement>('.settings-lang')!;
    expect(sel.value).toBe('es');
    expect(sel.closest('label')!.textContent).toContain('Idioma');
  });
  it('offers Invite people only when given, closing settings to open it', () => {
    const root = document.createElement('div');
    openSettings(root, new PrefsStore(), () => 'medium', 'en', () => {});
    expect(root.querySelector('[data-act="invite"]')).toBeNull();
    const invite = vi.fn();
    openSettings(root, new PrefsStore(), () => 'medium', 'en', () => {}, { invite });
    const btn = root.querySelector<HTMLButtonElement>('[data-act="invite"]')!;
    expect(btn.closest('label')!.textContent).toContain('Invite people');
    btn.click();
    expect(invite).toHaveBeenCalledOnce();
    expect(root.querySelector('.settings')).toBeNull();
  });
});

describe('the look editor in the village’s language', () => {
  it('has every word in Spanish', async () => {
    const { CREATOR_WORDS } = await import('./creator');
    expect(Object.keys(CREATOR_WORDS.es).sort()).toEqual(Object.keys(CREATOR_WORDS.en).sort());
    for (const k of ['hair_', 'outfit_', 'hat_', 'place_'] as const) expect(Object.keys(CREATOR_WORDS.es[k]).sort()).toEqual(Object.keys(CREATOR_WORDS.en[k]).sort());
  });
});
