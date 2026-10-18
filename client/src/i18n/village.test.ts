import { describe, it, expect } from 'vitest';
import { VILLAGE_WORDS, kindLabel } from './village';
import { EMOTES } from '../world/emotes';
import { EXERCISES } from '../world/anim/exercises';
import { THEMES } from '../nostr/themes';
import { pingTitle } from '../nostr/pings';
import { zapCommandMessage } from '../wallet/zapCommand';
import { micMessage, screenMessage } from '../voice/callRoom';

/** Every key, nested ones as a.b, with what kind of value sits there (functions with their arity). */
function shape(v: unknown, at = ''): string[] {
  if (typeof v === 'function') return [`${at}()${v.length}`];
  if (Array.isArray(v)) return [`${at}[${v.length}]`];
  if (v && typeof v === 'object') return Object.entries(v).flatMap(([k, x]) => shape(x, at ? `${at}.${k}` : k));
  return [`${at}:${typeof v}`];
}

/** Every word, functions called with sample arguments. */
function words(v: unknown): string[] {
  if (typeof v === 'function') {
    const args = Array.from({ length: v.length }, (_, i) => (i === 0 ? 'Ana' : i === 1 ? 2 : true));
    return [String((v as (...a: unknown[]) => unknown)(...args))];
  }
  if (Array.isArray(v)) return v.map(String);
  if (v && typeof v === 'object') return Object.values(v).flatMap(words);
  return [String(v)];
}

describe('the village’s words in each language', () => {
  const { en, es } = VILLAGE_WORDS;

  it('has every word in Spanish too, of the same kind', () => {
    expect(shape(es).sort()).toEqual(shape(en).sort());
  });

  it('leaves no Spanish word empty', () => {
    for (const w of words(es)) expect(w.trim()).not.toBe('');
  });

  it('names every emote, exercise and district in both', () => {
    for (const l of [en, es]) {
      for (const e of EMOTES) expect(l.emote[e.kind]).toBeTruthy();
      for (const k of [...Object.keys(EXERCISES), 'run']) expect(l.exercise[k]).toBeTruthy();
      for (const th of THEMES) expect(l.themes[th]).toBeTruthy();
    }
    expect(es.emote.groove).toBe('Bailar');
    expect(es.exercise.pullup).toBe('dominadas');
  });

  it('speaks voseo in the prompts', () => {
    expect(es.sitMate(false)).toBe('Apretá E para sentarte a tomar mate');
    expect(es.sitMate(true)).toBe('Sentarte a tomar mate');
    expect(es.ride(false)).toBe('Apretá F para montar el nostrich');
    expect(es.chatHint('plaza', false)).toBe('💬 Apretá C para abrir el chat de plaza');
    expect(es.laps(1, false)).toMatch(/^Corriendo · 1 vuelta ·/);
    expect(es.reps('dominadas', 3, true)).toBe('Dominadas · 3 repeticiones · tocá para parar');
  });

  it('never names a key to a touch screen: a prompt that says E, F or C on a keyboard says something else when its last argument (touch) is true', () => {
    const key = /\b(Press|Apretá)\b|\b[EFC]\b/;
    let prompts = 0;
    for (const lang of [en, es]) for (const [name, v] of Object.entries(lang)) {
      if (typeof v !== 'function' || v.length === 0) continue;
      const args = (touch: boolean) => Array.from({ length: v.length }, (_, i) => (i === v.length - 1 ? touch : i === 0 ? 'Ana' : 2));
      const call = (touch: boolean) => String((v as (...a: unknown[]) => unknown)(...args(touch)));
      if (!key.test(call(false))) continue;
      prompts++;
      expect(call(true), name).not.toMatch(key);
    }
    expect(prompts).toBeGreaterThan(10);
  });

  it('labels channel kinds', () => {
    expect(kindLabel('voice-sfu', es)).toBe('Canal de voz');
    expect(kindLabel('forum', es)).toBe('Publicación');
    expect(kindLabel('chat', en)).toBe('Text channel');
  });

  it('hands the pure helpers their words', () => {
    expect(pingTitle('Ana', 'reply', 'plaza', es)).toBe('Ana te respondió en #plaza');
    expect(pingTitle('Ana', 'mention', null, es)).toBe('Ana te mencionó');
    expect(zapCommandMessage('unknown-user', 'beto', es)).toBe('Acá no hay nadie llamado “beto”.');
    expect(zapCommandMessage('self', '', es)).toBe('No podés mandarte un zap a vos.');
    expect(micMessage(Object.assign(new Error(), { name: 'NotAllowedError' }), es)).toMatch(/^Micrófono bloqueado/);
    expect(screenMessage(new Error('screenTaken'), es)).toBe('Otra persona ya está compartiendo su pantalla.');
  });
});
