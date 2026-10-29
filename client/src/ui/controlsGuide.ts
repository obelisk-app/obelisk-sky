// "How to play": the controls, from the help button in the bottom bar, and
// once on first login. Touch screens get the touch version.

import { pick } from '../i18n/lang';

const SEEN_KEY = 'obelisk-sky/controls-seen';

interface Row { keys: string[]; text: string }

const DESKTOP_EN: { title: string; rows: Row[] }[] = [
  {
    title: 'Move',
    rows: [
      { keys: ['W', 'A', 'S', 'D'], text: 'Walk (arrow keys work too)' },
      { keys: ['Shift'], text: 'Hold to run' },
      { keys: ['W', 'W'], text: 'Double-tap a direction key to run; let go to walk again' },
      { keys: ['Space'], text: 'Jump (works while walking and running too); hold it to keep jumping' },
      { keys: ['Click'], text: 'Click the ground to walk there' },
      { keys: ['Drag'], text: 'Turn the camera; scroll to zoom' },
      { keys: ['V'], text: 'First-person view: click to look with the mouse; V or Esc to leave' },
      { keys: ['N'], text: 'Show or hide the minimap; click it to open it big and pick a house to walk to' },
    ],
  },
  {
    title: 'Talk',
    rows: [
      { keys: ['Walk in'], text: 'Stand in front of a building to open its channel' },
      { keys: ['T'], text: 'Open the general chat: everyone sees it, wherever they are; Esc closes it' },
      { keys: ['Enter'], text: 'Type a message in the channel you are in' },
      { keys: ['Click'], text: 'Click a speech bubble to reply; you walk over to them' },
      { keys: ['Click'], text: 'Click a sign or building to walk to that channel' },
    ],
  },
  {
    title: 'Hang out',
    rows: [
      { keys: ['E'], text: 'Sit on a nearby bench or stool and drink mate, at the café for a coffee and a laptop, or at the parrilla for asado; E again to stand' },
      { keys: ['E', '2'], text: 'In the sports park: E trains at the nearest bar (pull-ups, dips, push-ups), 2 does muscle-ups at the pull-up bar; walk off to stop' },
      { keys: ['F'], text: 'Ride a nostrich: walk up to one (they run from runners), F to climb on, run to gallop; F again to get off' },
      { keys: ['G'], text: 'Emotes: dance, sit in the lotus pose, nod, fold your arms… then 1–9 or 0 to pick; walk off to stop' },
      { keys: ['Join call'], text: 'In a voice channel’s pavilion, join the call' },
      { keys: ['/play'], text: 'Type it in a channel to start a game; click a table to play' },
      { keys: ['Your name'], text: 'Top right: change your look and your pet' },
    ],
  },
];

const TOUCH_EN: { title: string; rows: Row[] }[] = [
  {
    title: 'Move',
    rows: [
      { keys: ['Stick'], text: 'The thumb stick, bottom left; push all the way to run' },
      { keys: ['Tap'], text: 'Tap the ground to walk there' },
      { keys: ['Drag'], text: 'Turn the camera; pinch to zoom' },
      { keys: ['Eye'], text: 'First-person view: drag to look around' },
    ],
  },
  {
    title: 'Talk',
    rows: [
      { keys: ['Walk in'], text: 'Stand in front of a building to open its channel' },
      { keys: ['Tap'], text: 'Tap a speech bubble to reply; you walk over to them' },
    ],
  },
  {
    title: 'Hang out',
    rows: [
      { keys: ['Sit'], text: 'Near a bench or stool, tap Sit to drink mate' },
      { keys: ['Ride'], text: 'Near a nostrich, tap Ride to climb on and gallop' },
      { keys: ['Menu', 'Emotes'], text: 'Dance, sit in the lotus pose, nod…; walk off to stop' },
      { keys: ['Join call'], text: 'In a voice channel’s pavilion, join the call' },
      { keys: ['Your name'], text: 'Top right: change your look and your pet' },
    ],
  },
];


const DESKTOP_ES: { title: string; rows: Row[] }[] = [
  {
    title: 'Moverse',
    rows: [
      { keys: ['W', 'A', 'S', 'D'], text: 'Caminar (las flechas también sirven)' },
      { keys: ['Shift'], text: 'Mantenelo apretado para correr' },
      { keys: ['W', 'W'], text: 'Tocá dos veces una tecla de dirección para correr; soltala para volver a caminar' },
      { keys: ['Espacio'], text: 'Saltar (también caminando y corriendo); mantenelo para seguir saltando' },
      { keys: ['Clic'], text: 'Hacé clic en el suelo para caminar hasta ahí' },
      { keys: ['Arrastrar'], text: 'Girar la cámara; la rueda hace zoom' },
      { keys: ['V'], text: 'Primera persona: hacé clic para mirar con el mouse; V o Esc para salir' },
      { keys: ['N'], text: 'Mostrar u ocultar el minimapa; hacé clic para agrandarlo y elegir una casa adonde ir' },
    ],
  },
  {
    title: 'Hablar',
    rows: [
      { keys: ['Acercate'], text: 'Parate frente a una casa para abrir su canal' },
      { keys: ['T'], text: 'Abrí el chat general: lo ve todo el mundo, esté donde esté; Esc lo cierra' },
      { keys: ['Enter'], text: 'Escribí un mensaje en el canal donde estás' },
      { keys: ['Clic'], text: 'Hacé clic en un globo para responder; caminás hasta esa persona' },
      { keys: ['Clic'], text: 'Hacé clic en un cartel o una casa para ir a ese canal' },
    ],
  },
  {
    title: 'Pasarla bien',
    rows: [
      { keys: ['E'], text: 'Sentate en un banco o banquito cercano a tomar mate, en el café por un café y una laptop, o en la parrilla por un asado; E otra vez para pararte' },
      { keys: ['E', '2'], text: 'En el parque: E entrena en la barra más cercana (dominadas, fondos, flexiones), 2 hace muscle-ups en la barra; caminá para parar' },
      { keys: ['F'], text: 'Montá un nostrich: acercate despacio (huyen de los que corren), F para subirte, corré para galopar; F otra vez para bajarte' },
      { keys: ['G'], text: 'Gestos: bailar, la postura del loto, asentir, cruzarte de brazos… después 1–9 o 0 para elegir; caminá para parar' },
      { keys: ['Join call'], text: 'En la fogata de un canal de voz, sumate a la llamada' },
      { keys: ['/play'], text: 'Escribilo en un canal para empezar un juego; hacé clic en una mesa para jugar' },
      { keys: ['Tu nombre'], text: 'Arriba a la derecha: cambiá tu look y tu mascota' },
    ],
  },
];

const TOUCH_ES: { title: string; rows: Row[] }[] = [
  {
    title: 'Moverse',
    rows: [
      { keys: ['Palanca'], text: 'La palanca abajo a la izquierda; empujala hasta el borde para correr' },
      { keys: ['Tocar'], text: 'Tocá el suelo para caminar hasta ahí' },
      { keys: ['Arrastrar'], text: 'Girar la cámara; pellizcá para hacer zoom' },
      { keys: ['Ojo'], text: 'Primera persona: arrastrá para mirar alrededor' },
    ],
  },
  {
    title: 'Hablar',
    rows: [
      { keys: ['Acercate'], text: 'Parate frente a una casa para abrir su canal' },
      { keys: ['Tocar'], text: 'Tocá un globo para responder; caminás hasta esa persona' },
    ],
  },
  {
    title: 'Pasarla bien',
    rows: [
      { keys: ['Sit'], text: 'Cerca de un banco o banquito, tocá Sit para tomar mate' },
      { keys: ['Ride'], text: 'Cerca de un nostrich, tocá Ride para subirte y galopar' },
      { keys: ['Menu', 'Emotes'], text: 'Bailar, la postura del loto, asentir…; caminá para parar' },
      { keys: ['Join call'], text: 'En la fogata de un canal de voz, sumate a la llamada' },
      { keys: ['Tu nombre'], text: 'Arriba a la derecha: cambiá tu look y tu mascota' },
    ],
  },
];

const WORDS = {
  en: {
    desktop: DESKTOP_EN, touch: TOUCH_EN, label: 'Controls', title: 'How to play',
    sub: 'You are the character with your name above it. Walk to a channel’s building to join the conversation there.',
    hint: 'Open this again with the ? button.', ok: 'Got it',
  },
  es: {
    desktop: DESKTOP_ES, touch: TOUCH_ES, label: 'Controles', title: 'Cómo se juega',
    sub: 'Sos el personaje con tu nombre encima. Caminá hasta la casa de un canal para sumarte a la conversación.',
    hint: 'Volvé a abrir esto con el botón ?.', ok: 'Entendido',
  },
};

export const isTouch = () => matchMedia('(pointer: coarse)').matches;

export function openControlsGuide(parent: HTMLElement): void {
  const w = pick(WORDS);
  parent.querySelector('.guide')?.remove();
  const el = document.createElement('div');
  el.className = 'themes guide';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', w.label);
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
  for (const sec of isTouch() ? w.touch : w.desktop) {
    const h = document.createElement('div');
    h.className = 'themes-section';
    h.textContent = sec.title;
    body.append(h);
    for (const r of sec.rows) {
      const row = document.createElement('div');
      row.className = 'guide-row';
      const keys = document.createElement('div');
      keys.className = 'guide-keys';
      for (const k of r.keys) {
        const kbd = document.createElement('kbd');
        kbd.textContent = k;
        keys.append(kbd);
      }
      const text = document.createElement('div');
      text.className = 'guide-text';
      text.textContent = r.text;
      row.append(keys, text);
      body.append(row);
    }
  }
  const foot = document.createElement('div');
  foot.className = 'themes-foot';
  const hint = document.createElement('span');
  hint.className = 'themes-status';
  hint.textContent = w.hint;
  const ok = document.createElement('button');
  ok.type = 'button';
  ok.className = 'account-btn primary';
  ok.textContent = w.ok;
  const close = () => { el.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
  ok.addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  foot.append(hint, ok);
  el.append(head, body, foot);
  parent.append(el);
  ok.focus();
}

/** Show the guide once per browser, the first time someone logs in. */
export function maybeShowControlsGuide(parent: HTMLElement): boolean {
  try {
    if (localStorage.getItem(SEEN_KEY) === '1') return false;
    localStorage.setItem(SEEN_KEY, '1');
  } catch { /* private mode: show it anyway */ }
  openControlsGuide(parent);
  return true;
}
