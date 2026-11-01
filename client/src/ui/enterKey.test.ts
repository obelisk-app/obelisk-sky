// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { enterAction, isControl } from './enterKey';

const base = { key: 'Enter', mod: false, dialog: false, onControl: false, chatOpen: false };

describe('Enter in the village (issue #6)', () => {
  it('opens the general chat when no chat is open, and types in the open one otherwise', () => {
    expect(enterAction(base)).toBe('open-general');
    expect(enterAction({ ...base, chatOpen: true })).toBe('focus-chat');
  });
  it('is left alone over a dialog, with a modifier, on a focused button, and for other keys (T no longer opens it)', () => {
    expect(enterAction({ ...base, dialog: true })).toBeNull();
    expect(enterAction({ ...base, mod: true })).toBeNull();
    expect(enterAction({ ...base, onControl: true })).toBeNull();
    expect(enterAction({ ...base, key: 't' })).toBeNull();
  });
  it('knows a focused control, the minimap included', () => {
    const b = document.createElement('button');
    const mm = document.createElement('div');
    mm.setAttribute('role', 'button');
    const span = document.createElement('span');
    mm.append(span);
    expect(isControl(b)).toBe(true);
    expect(isControl(span)).toBe(true);
    expect(isControl(document.createElement('canvas'))).toBe(false);
    expect(isControl(null)).toBe(false);
  });
});
