// obelisk-dex's own login modal (src/app/[locale]/app/login/LoginModal.tsx),
// re-hosted as a React island: same SDK props, copy, icons, signer-app link,
// pasted-key warning, generated-profile step and La Crypta styling. The app
// modules it reaches for (session actions, next-intl, routing, clipboard,
// Blossom) are sky shims, see client/vite.config.ts.

import { createRoot, type Root } from 'react-dom/client';
import LoginModal from '@/app/[locale]/app/login/LoginModal';
import { loginSignerStorage } from '@/services/session/signer-storage';
import { SIGNER_STORAGE_KEY_NIP46 } from '@nostr-wot/ui';
import '@nostr-wot/ui/styles.css';
import '../obelisk.generated.css';
import { lang } from '../i18n/lang';
import { watchSdk } from './sdkSpanish';

/** Sky's mark, centred over the title (dex's `.login-mark` slot). */
const SKY_MARK = <img src="/brand/sky-mark.svg" className="login-mark sky-login-mark" alt="Obelisk Sky" />;

let root: Root | null = null;

/** A field focused in the modal stays in view while a phone's keyboard opens (it takes about a third of a second). */
export function keepFieldInView(e: FocusEvent): void {
  const t = e.target as HTMLElement | null;
  if (!t || !t.closest('.nui-modal') || !t.matches('input, textarea, select')) return;
  const show = () => t.scrollIntoView({ block: 'center', behavior: 'smooth' });
  show();
  setTimeout(show, 350);
}
let watchingFocus = false;
/** Stops translating the SDK's words (Spanish only). */
let unwatch: (() => void) | null = null;

export function openLogin(onDone?: () => void): void {
  // The SDK modal portals to <body>, which carries the theme like the app's.
  document.body.setAttribute('data-nui-root', '');
  document.body.setAttribute('data-nui-theme', 'la-crypta');
  // Sky's colours over the La Crypta theme (styles.css `body.sky-login`).
  document.body.classList.add('sky-login');
  if (!watchingFocus) { watchingFocus = true; document.addEventListener('focusin', keepFieldInView); }
  if (!root) {
    const host = document.createElement('div');
    host.className = 'login-host';
    document.body.appendChild(host);
    root = createRoot(host);
  }
  // The SDK's own words are English only: swap them while the modal is open.
  if (lang === 'es') { unwatch?.(); unwatch = watchSdk(document.body); }
  const close = () => { root?.render(null); unwatch?.(); unwatch = null; };
  root.render(<LoginModal onClose={close} onSuccess={() => { close(); onDone?.(); }} headerSlot={SKY_MARK} keyFilePrefix="obelisk-sky" />);
}

/**
 * After logging out: close a modal left open and forget the remote-signer
 * pairing. The SDK keeps the NIP-46 client key in memory for its QR retry;
 * reused after a logout, a signer app that already knows that key ignores
 * the new connect, and the modal just waits until the page is reloaded.
 */
export function resetLogin(): void {
  root?.render(null);
  unwatch?.();
  unwatch = null;
  loginSignerStorage.removeItem(SIGNER_STORAGE_KEY_NIP46);
}
