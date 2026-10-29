// Settings: this browser's preferences (prefs.ts), applied live, in the
// village's language (the landing page's choice, i18n/lang.ts), which the
// first row switches (remembered for the landing page too, then a reload).

import { CHAT_OPEN_PREFS, QUALITIES, TIMES, type Prefs, type PrefsStore } from '../prefs';
import { LANGS, lang, switchLang, type Lang } from '../i18n/lang';

const EN = {
  title: 'Settings', sub: 'Saved in this browser only.',
  language: 'Language · Idioma',
  graphics: 'Graphics', quality: 'Quality', renderingAt: 'Rendering at:', resolution: 'Resolution', shadows: 'Shadows',
  ao: 'Ambient occlusion', aoHint: '(soft contact shadows)', bloom: 'Glow (bloom)', tilt: 'Toy-town view',
  tiltHint: '(blurs the top and bottom so the island looks like a tiny model)', grass: 'Grass',
  world: 'World', time: 'Time of day', signs: 'Channel signs', bubbles: 'Speech bubbles', feed: 'Message feed', feedHint: '(bottom left)',
  minimap: 'Minimap', minimapHint: '(top left; N shows or hides it)', minimapRotate: 'Turn the minimap with the camera',
  share: 'Share my movement live', shareHint: '(others see you walk)',
  camera: 'Camera and controls', director: 'Auto camera', directorHint: '(follows conversations)', fov: 'First-person field of view',
  mouse: 'Mouse sensitivity', invert: 'Invert vertical look',
  chat: 'Chat', chatOpen: 'Walking into a channel', opacity: 'Panel opacity',
  soundSec: 'Sound', sound: 'Sound', volume: 'Volume', ambience: 'Ambient sounds', ambienceHint: '(crickets at night)',
  footsteps: 'Footsteps', footstepsHint: '(walking and running)', emoteMusic: 'Emote music', emoteMusicHint: '(heard near people dancing)',
  placeMusic: 'Music at places', placeMusicHint: '(the parrilla, the campfires)',
  reset: 'Reset to defaults', done: 'Done',
  account: 'Account', invite: 'Invite people', inviteHint: '(links that let new people into a relay)', inviteOpen: 'Open',
  quality_: { auto: 'Automatic (adapts to your device)', low: 'Low', medium: 'Medium', high: 'High', ultra: 'Ultra' } as Record<Prefs['quality'], string>,
  chatOpen_: { auto: 'Open it automatically', ask: 'Show a button to open it', off: 'Do nothing' } as Record<Prefs['chatOpen'], string>,
  time_: { auto: 'Buenos Aires time', day: 'Always day', sunset: 'Always sunset', night: 'Always night' } as Record<Prefs['timeOfDay'], string>,
};

const ES: typeof EN = {
  title: 'Ajustes', sub: 'Se guardan solo en este navegador.',
  language: 'Idioma · Language',
  graphics: 'Gráficos', quality: 'Calidad', renderingAt: 'Dibujando en:', resolution: 'Resolución', shadows: 'Sombras',
  ao: 'Oclusión ambiental', aoHint: '(sombras suaves de contacto)', bloom: 'Brillo (bloom)', tilt: 'Vista maqueta',
  tiltHint: '(desenfoca arriba y abajo para que la isla parezca una miniatura)', grass: 'Pasto',
  world: 'Mundo', time: 'Hora del día', signs: 'Carteles de los canales', bubbles: 'Globos de diálogo', feed: 'Mensajes', feedHint: '(abajo a la izquierda)',
  minimap: 'Minimapa', minimapHint: '(arriba a la izquierda; N lo muestra u oculta)', minimapRotate: 'Girar el minimapa con la cámara',
  share: 'Compartir mis movimientos en vivo', shareHint: '(los demás te ven caminar)',
  camera: 'Cámara y controles', director: 'Cámara automática', directorHint: '(sigue las conversaciones)', fov: 'Campo de visión en primera persona',
  mouse: 'Sensibilidad del mouse', invert: 'Invertir la mirada vertical',
  chat: 'Chat', chatOpen: 'Al entrar a un canal', opacity: 'Opacidad del panel',
  soundSec: 'Sonido', sound: 'Sonido', volume: 'Volumen', ambience: 'Sonidos ambientales', ambienceHint: '(grillos de noche)',
  footsteps: 'Pasos', footstepsHint: '(al caminar y correr)', emoteMusic: 'Música de los gestos', emoteMusicHint: '(se oye cerca de quien baila)',
  placeMusic: 'Música en los lugares', placeMusicHint: '(la parrilla, los fogones)',
  reset: 'Volver a lo predeterminado', done: 'Listo',
  account: 'Cuenta', invite: 'Invitar personas', inviteHint: '(enlaces que dejan entrar personas nuevas a un relay)', inviteOpen: 'Abrir',
  quality_: { auto: 'Automática (se adapta a tu equipo)', low: 'Baja', medium: 'Media', high: 'Alta', ultra: 'Ultra' },
  chatOpen_: { auto: 'Abrirlo solo', ask: 'Mostrar un botón para abrirlo', off: 'No hacer nada' },
  time_: { auto: 'Hora de Buenos Aires', day: 'Siempre de día', sunset: 'Siempre atardecer', night: 'Siempre de noche' },
};

export const SETTINGS_WORDS: Record<Lang, typeof EN> = { en: EN, es: ES };

/** Each language by its own name, the same on every screen. */
export const LANG_NAMES: Record<Lang, string> = { en: 'English', es: 'Español' };

/** What settings can open besides the prefs: `invite`, "Invite people", given only to an admitted account. */
export interface SettingsLinks {
  invite?: () => void;
}

/** `onLang`: a language was picked (by default it is remembered and the page reloads into it). */
export function openSettings(parent: HTMLElement, store: PrefsStore, currentLevel: () => string, l: Lang = lang, onLang: (l: Lang) => void = switchLang, links: SettingsLinks = {}): void {
  const w = SETTINGS_WORDS[l];
  parent.querySelector('.settings')?.remove();
  const el = document.createElement('div');
  el.className = 'themes settings';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', w.title);
  const head = document.createElement('div');
  head.className = 'themes-head';
  const title = document.createElement('div');
  title.className = 'themes-title';
  title.textContent = w.title;
  const sub = document.createElement('div');
  sub.className = 'themes-sub';
  sub.textContent = w.sub;
  head.append(title, sub);
  const body = document.createElement('div');
  body.className = 'themes-body';

  const section = (t: string) => {
    const h = document.createElement('div');
    h.className = 'themes-section';
    h.textContent = t;
    body.append(h);
  };
  const row = (label: string, control: HTMLElement, hint?: string) => {
    const r = document.createElement('label');
    r.className = 'themes-row settings-row';
    const l = document.createElement('span');
    l.textContent = label;
    if (hint) {
      const h = document.createElement('small');
      h.textContent = ` ${hint}`;
      l.append(h);
    }
    r.append(l, control);
    body.append(r);
  };
  const toggle = (key: keyof Prefs) => {
    const i = document.createElement('input');
    i.type = 'checkbox';
    i.className = 'settings-toggle';
    i.checked = store.get()[key] as boolean;
    i.addEventListener('change', () => store.set({ [key]: i.checked } as Partial<Prefs>));
    return i;
  };
  const slider = (key: keyof Prefs, min: number, max: number, step: number, fmt: (v: number) => string) => {
    const wrap = document.createElement('span');
    wrap.className = 'settings-slider';
    const i = document.createElement('input');
    i.type = 'range';
    i.min = String(min);
    i.max = String(max);
    i.step = String(step);
    i.value = String(store.get()[key]);
    const out = document.createElement('output');
    out.textContent = fmt(Number(i.value));
    i.addEventListener('input', () => { out.textContent = fmt(Number(i.value)); store.set({ [key]: Number(i.value) } as Partial<Prefs>); });
    wrap.append(i, out);
    return wrap;
  };
  const select = <T extends string>(key: keyof Prefs, options: readonly T[], labels: Record<T, string>) => {
    const s = document.createElement('select');
    s.className = 'themes-select';
    for (const o of options) {
      const opt = document.createElement('option');
      opt.value = o;
      opt.textContent = labels[o];
      s.append(opt);
    }
    s.value = store.get()[key] as string;
    s.addEventListener('change', () => store.set({ [key]: s.value } as Partial<Prefs>));
    return s;
  };

  // The language first, named in both, so it can be found whichever one is on.
  const langSel = document.createElement('select');
  langSel.className = 'themes-select settings-lang';
  for (const o of LANGS) {
    const opt = document.createElement('option');
    opt.value = o;
    opt.textContent = LANG_NAMES[o];
    langSel.append(opt);
  }
  langSel.value = l;
  langSel.addEventListener('change', () => { if (langSel.value !== l) onLang(langSel.value as Lang); });
  row(w.language, langSel);

  // Invite people, where people look for it too (also in the account menu).
  if (links.invite) {
    const open = links.invite;
    section(w.account);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pill settings-invite';
    b.dataset.act = 'invite';
    b.textContent = w.inviteOpen;
    b.addEventListener('click', (e) => { e.preventDefault(); close(); open(); });
    row(w.invite, b, w.inviteHint);
  }

  section(w.graphics);
  const levelHint = document.createElement('small');
  row(w.quality, select('quality', QUALITIES, w.quality_));
  levelHint.className = 'settings-hint';
  levelHint.textContent = `${w.renderingAt} ${currentLevel()}`;
  body.append(levelHint);
  row(w.resolution, slider('resolution', 0.5, 1.5, 0.05, (v) => `${Math.round(v * 100)}%`));
  row(w.shadows, toggle('shadows'));
  row(w.ao, toggle('ambientOcclusion'), w.aoHint);
  row(w.bloom, toggle('bloom'));
  row(w.tilt, toggle('tiltShift'), w.tiltHint);
  row(w.grass, toggle('grass'));

  section(w.world);
  row(w.time, select('timeOfDay', TIMES, w.time_));
  row(w.signs, toggle('signs'));
  row(w.bubbles, toggle('bubbles'));
  row(w.feed, toggle('feed'), w.feedHint);
  row(w.minimap, toggle('minimap'), w.minimapHint);
  row(w.minimapRotate, toggle('minimapRotate'));
  row(w.share, toggle('shareMotion'), w.shareHint);

  section(w.camera);
  row(w.director, toggle('autoDirector'), w.directorHint);
  row(w.fov, slider('fov', 50, 100, 1, (v) => `${v}°`));
  row(w.mouse, slider('mouseSensitivity', 0.25, 3, 0.05, (v) => `${v.toFixed(2)}×`));
  row(w.invert, toggle('invertY'));

  section(w.chat);
  row(w.chatOpen, select('chatOpen', CHAT_OPEN_PREFS, w.chatOpen_));
  row(w.opacity, slider('chatOpacity', 0.15, 1, 0.01, (v) => `${Math.round(v * 100)}%`));

  section(w.soundSec);
  row(w.sound, toggle('sound'));
  row(w.volume, slider('volume', 0, 1, 0.01, (v) => `${Math.round(v * 100)}%`));
  row(w.ambience, toggle('ambience'), w.ambienceHint);
  row(w.footsteps, toggle('footsteps'), w.footstepsHint);
  row(w.emoteMusic, toggle('emoteMusic'), w.emoteMusicHint);
  row(w.placeMusic, toggle('placeMusic'), w.placeMusicHint);

  const foot = document.createElement('div');
  foot.className = 'themes-foot';
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'account-btn';
  reset.textContent = w.reset;
  reset.addEventListener('click', () => { store.reset(); openSettings(parent, store, currentLevel, l, onLang, links); });
  const done = document.createElement('button');
  done.type = 'button';
  done.className = 'account-btn primary';
  done.textContent = w.done;
  const close = () => { el.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
  done.addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  foot.append(reset, document.createElement('span'), done);
  el.append(head, body, foot);
  parent.append(el);
  const tick = setInterval(() => { if (!el.isConnected) clearInterval(tick); else levelHint.textContent = `${w.renderingAt} ${currentLevel()}`; }, 1000);
}
