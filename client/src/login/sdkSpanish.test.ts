// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { spanishFor, translateSdk, watchSdk } from './sdkSpanish';
import { attachGeneratedProfileEnhancements } from '@/services/shell/desktop/generated-profile';
import type { Translate } from '@/i18n/keys';

describe("the login SDK's words in Spanish", () => {
  it('keeps the spaces around a text', () => {
    expect(spanishFor('Back this up ')).toBe('Guardá esto ');
    expect(spanishFor(" you continue. Lose it and your identity is gone — there's no recovery.")).toBe(' de seguir. Si la perdés, perdés tu identidad: no hay forma de recuperarla.');
    expect(spanishFor('Something else')).toBeNull();
  });
  it('translates texts, placeholders and labels inside the SDK only', () => {
    document.body.innerHTML = `
      <div class="nui-modal" aria-label="Sign in to Nostr">
        <span class="nui-method-label">Create a new account</span>
        <input class="nui-input" placeholder="nsec1… or 64-char hex" />
        <button class="nui-back">← Back</button>
      </div>
      <p class="mine">Create a new account</p>`;
    translateSdk(document.body);
    expect(document.querySelector('.nui-method-label')!.textContent).toBe('Crear una cuenta nueva');
    expect(document.querySelector('input')!.getAttribute('placeholder')).toBe('nsec1… o hex de 64 caracteres');
    expect(document.querySelector('.nui-modal')!.getAttribute('aria-label')).toBe('Conectate a Nostr');
    expect(document.querySelector('.nui-back')!.textContent).toBe('← Volver');
    expect(document.querySelector('.mine')!.textContent).toBe('Create a new account');
  });
  it('keeps translating what the SDK renders later', async () => {
    document.body.innerHTML = '<div class="nui-modal"></div>';
    const stop = watchSdk(document.body);
    const b = document.createElement('button');
    b.className = 'nui-primary';
    b.textContent = 'Sign in';
    document.querySelector('.nui-modal')!.append(b);
    await new Promise((r) => setTimeout(r, 0));
    expect(b.textContent).toBe('Entrar');
    b.firstChild!.nodeValue = 'Continue';
    await new Promise((r) => setTimeout(r, 0));
    expect(b.textContent).toBe('Continuar');
    stop();
  });
  it("leaves the new account's profile step to dex, so its about is saved", async () => {
    // The SDK's generated-profile step, as it renders (English), with dex's enhancements and the Spanish swap both watching.
    document.body.innerHTML = `
      <div class="nui-modal-overlay"><div class="nui-modal obelisk-login-modal">
        <h3 class="nui-form-title">Set up your profile</h3>
        <p class="nui-form-sub">Optional. You can fill these in later from any Nostr client.</p>
        <span class="nui-profile-field-label">Display name</span><input class="nui-input" placeholder="Satoshi" />
        <span class="nui-profile-field-label">About</span><input class="nui-input" placeholder="Builder, chef, occasional cyclist." />
      </div></div>`;
    const stop = watchSdk(document.body);
    const draft: Record<string, string> = {};
    const t = ((k: string) => (k === 'shell.login.profile.aboutOptional' ? 'Sobre vos (opcional)' : k)) as unknown as Translate;
    const detach = attachGeneratedProfileEnhancements(t, (patch) => Object.assign(draft, patch));
    await new Promise((r) => setTimeout(r, 0));
    const [, about] = [...document.querySelectorAll<HTMLInputElement>('input')];
    expect(about.dataset.obeliskTracked).toBe('true');
    // Swapped once dex has the field.
    expect(about.placeholder).toBe('Programo, cocino, ando en bici.');
    about.value = 'Hago mate';
    about.dispatchEvent(new Event('input'));
    expect(draft.about).toBe('Hago mate');
    // Dex's own words for the label, its "optional" line hidden; the rest in Spanish.
    expect([...document.querySelectorAll('.nui-profile-field-label')].map((l) => l.textContent)).toEqual(['Nombre', 'Sobre vos (opcional)']);
    expect(document.querySelector<HTMLElement>('.nui-form-sub')!.hidden).toBe(true);
    expect(document.querySelector('.nui-form-title')!.textContent).toBe('Armá tu perfil');
    detach();
    stop();
  });
});
