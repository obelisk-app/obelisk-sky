import { describe, it, expect } from 'vitest';
import { HALLOWEEN_WORDS } from './halloweenWords';

function shape(v: unknown, at = ''): string[] {
  if (typeof v === 'function') return [`${at}()${v.length}`];
  if (Array.isArray(v)) return [`${at}[${v.length}]`];
  if (v && typeof v === 'object') return Object.entries(v).flatMap(([k, x]) => shape(x, at ? `${at}.${k}` : k));
  return [`${at}:${typeof v}`];
}

describe('La Crypta’s Halloween words', () => {
  it('say the same things in English and Spanish', () => {
    expect(shape(HALLOWEEN_WORDS.es)).toEqual(shape(HALLOWEEN_WORDS.en));
  });
  it('speak voseo and count right', () => {
    const { es, en } = HALLOWEEN_WORDS;
    expect(es.greet).toMatch(/Venís/);
    expect(es.done(1)).toMatch(/Tenés 1 entrada\./);
    expect(es.done(3)).toMatch(/3 entradas\./);
    expect(en.done(1)).toMatch(/1 ticket\./);
    expect(es.sats(47400)).toBe('47.400 sats');
    expect(es.priceCoupon(60000, 33180, 21, 'LLOPO', 30)).toMatch(/\$33\.180 ARS/);
  });
});
