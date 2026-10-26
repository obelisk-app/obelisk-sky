// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { COPY, LANGS, pickLang, type CopyKey } from './copy';
import { applyLang } from './landing';

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
  it('sends every call to action to the village', () => {
    document.documentElement.innerHTML = html.replace(/^<!doctype html>/i, '');
    for (const k of ['nav.enter', 'hero.enter', 'cta.enter']) expect(document.querySelector(`[data-i18n="${k}"]`)!.getAttribute('href')).toBe('/app');
  });
  it('links the family at the foot: Obelisk, nostr-wot, Liberture, La Crypta, and the code on GitHub', () => {
    document.documentElement.innerHTML = html.replace(/^<!doctype html>/i, '');
    const hrefs = [...document.querySelectorAll('.foot a')].map((a) => a.getAttribute('href'));
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

describe('pickLang', () => {
  it('prefers ?lang=, then the saved choice, then the browser', () => {
    expect(pickLang('?lang=es', 'en', ['en-US'])).toBe('es');
    expect(pickLang('', 'es', ['en-US'])).toBe('es');
    expect(pickLang('', null, ['es-AR', 'en'])).toBe('es');
    expect(pickLang('?lang=fr', 'xx', ['pt-BR', 'de'])).toBe('en');
  });
});
