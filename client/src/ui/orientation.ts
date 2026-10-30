// Phones play the village sideways. Upright, a card over everything asks you
// to turn the phone (CSS shows it: `.rotate`, phones in portrait); its button
// goes full screen and asks the browser to hold landscape, which Android
// allows in full screen and installed apps (the manifest asks too). iOS
// can't be locked: turning the phone is the only way there.

/** A phone held upright: the rotate card shows (the same query as the CSS). */
export const PORTRAIT_PHONE = '(pointer: coarse) and (orientation: portrait) and (max-width: 600px)';

import { t } from '../i18n/app';

type Lockable = ScreenOrientation & { lock?: (o: 'landscape') => Promise<void> };

/** Full screen, then landscape where the browser allows it. True when it held. */
export async function lockLandscape(doc: Document = document, scr: Screen = screen): Promise<boolean> {
  try {
    if (!doc.fullscreenElement) await doc.documentElement.requestFullscreen?.({ navigationUI: 'hide' });
  } catch { /* not allowed: the card stays until the phone turns */ }
  try {
    const o = scr.orientation as Lockable | undefined;
    if (!o?.lock) return false;
    await o.lock('landscape');
    return true;
  } catch {
    return false;
  }
}

/** Wire the rotate card's button. Where the browser can't go full screen
 *  (iPhone), the card only asks you to turn the phone, and has no button. */
export function initOrientation(card: HTMLElement, doc: Document = document): void {
  const canFull = !!doc.fullscreenEnabled && typeof doc.documentElement.requestFullscreen === 'function';
  if (!canFull) {
    card.classList.add('no-fullscreen');
    for (const [sel, key] of [['.rotate-title', 'rotate.turnTitle'], ['.rotate-text', 'rotate.turnText']] as const) {
      const el = card.querySelector<HTMLElement>(sel);
      if (el) { el.dataset.i18n = key; el.textContent = t(key); }
    }
    return;
  }
  card.querySelector('.rotate-go')?.addEventListener('click', () => { void lockLandscape(doc); });
}

/** What the upright card asks: to log in first, to turn the phone, or nothing (the login is open). */
export type TiltCard = 'login' | 'tilt' | 'none';

export interface TiltState {
  /** The login modal is showing, any of its steps. */
  loginOpen: boolean;
  /** An account is logged in, or a saved one is still being restored. */
  loggedIn: boolean;
  /** "Continue as guest" was picked on the card. */
  guestChosen: boolean;
}

export function tiltCardFor(s: TiltState): TiltCard {
  if (s.loginOpen) return 'none';
  return s.loggedIn || s.guestChosen ? 'tilt' : 'login';
}

/** Show the card's side for this state (the CSS still shows it only on a phone held upright). */
export function setTiltCard(card: HTMLElement, mode: TiltCard, body: HTMLElement = document.body): void {
  card.dataset.mode = mode === 'login' ? 'login' : 'tilt';
  card.setAttribute('aria-labelledby', mode === 'login' ? 'rotate-login-title' : 'rotate-title');
  body.classList.toggle('tilt-wait', mode === 'none');
}

/** Run `go` now if the phone isn't upright, else once it's turned. */
export function whenNotUpright(go: () => void, win: Pick<Window, 'matchMedia'> = window): void {
  const mq = win.matchMedia(PORTRAIT_PHONE);
  if (!mq.matches) { go(); return; }
  const turned = () => { if (mq.matches) return; mq.removeEventListener('change', turned); go(); };
  mq.addEventListener('change', turned);
}
