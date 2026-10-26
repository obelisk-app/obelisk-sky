// Talking to La Crypta at its door: a conversation in the card (#card, with
// the event page's Halloween skin). It opens by itself as you walk up to La
// Crypta (main.ts); a click on La Crypta opens it too. La Crypta talks
// (events/halloweenChat.ts), you tap a reply or type one; buying tickets is
// part of the talk, and the invoice (QR, copy, open in a wallet, or pay with
// the account's own wallet, wallet/wallet.ts) and the tickets arrive as
// messages. Spanish by default; an ES | EN switch redraws everything.
//
// The input stays the same element while you talk, so a phone's keyboard
// stays up between messages: 16 px text so iOS doesn't zoom, the right
// keyboard for each question (email, numbers), and while the keyboard is up
// the card sits above it (visualViewport → --kb). Keys typed there never
// reach the game. Once a wallet has paid, nothing here offers to pay again.

import QRCode from 'qrcode';
import { FALLBACK_SALE, HALLOWEEN, TicketCheckout, lightningPrice, type SaleInfo } from '../events/halloween';
import { HalloweenChat, type ChipId, type Line } from '../events/halloweenChat';
import { HALLOWEEN_WORDS, type HalloweenLang, type HalloweenWords } from '../events/halloweenWords';
import type { Payer } from '../wallet/wallet';

const LANG_KEY = 'obelisk-sky/halloween-lang';
const BUYER_KEY = 'obelisk-sky/halloween-buyer';

export interface TicketDialogDeps {
  /** The card element (#card) and main.ts's openCard, which fills its body. */
  card: HTMLElement;
  openCard(build: (body: HTMLElement) => void): void;
  /** La Crypta as the village knows it (its kind 0, or the placeholder). */
  npc(): { name: string; avatar: string | null };
  /** Your name in the village, to offer for the ticket. */
  buyerName(): string;
  /** The account's wallet, if it has one (null for guests and logins without one). */
  payer(): Promise<Payer | null>;
  toast(text: string): void;
  /** Talked before in this visit: La Crypta says welcome back. */
  again?: boolean;
  fetch?: typeof fetch;
}

export interface TicketDialog {
  /** Still on screen. */
  readonly open: boolean;
  /** In the middle of buying (or typing): walking away leaves it open. */
  readonly engaged: boolean;
  /** You've said something (tapped or typed): walking off a little doesn't end the talk. */
  readonly talked: boolean;
  /** Back on screen if the card was only just hidden (a tap on the world hides it before a click on La Crypta lands): the same talk goes on. */
  reopen(): boolean;
  close(): void;
}

function load<T>(key: string): T | null {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) as T : null; } catch { return null; }
}
function save(key: string, v: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* private mode */ }
}

/** Spanish, unless you switched to English here before. */
export function startLang(): HalloweenLang {
  return load<string>(LANG_KEY) === 'en' ? 'en' : 'es';
}

const ars = (n: number) => `$${n.toLocaleString('es-AR')} ARS`;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function link(cls: string, text: string, href: string): HTMLAnchorElement {
  const a = h('a', cls, text);
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  return a;
}

/** What a reply chip says, in your bubble too. */
export function chipText(w: HalloweenWords, id: ChipId): string {
  if (id.startsWith('fill:')) return id.slice(5);
  if (id.startsWith('qty:')) return id.slice(4);
  return w.chips[id as keyof HalloweenWords['chips']];
}

type InputKind = 'chat' | 'name' | 'email' | 'qty';
const INPUT: Record<InputKind, { type: string; mode: string; auto: string; cap: string; hint: string }> = {
  chat: { type: 'text', mode: 'text', auto: 'off', cap: 'sentences', hint: 'send' },
  name: { type: 'text', mode: 'text', auto: 'name', cap: 'words', hint: 'next' },
  email: { type: 'email', mode: 'email', auto: 'email', cap: 'off', hint: 'next' },
  qty: { type: 'text', mode: 'numeric', auto: 'off', cap: 'off', hint: 'next' },
};

export function openTicketDialog(deps: TicketDialogDeps): TicketDialog {
  let L: HalloweenLang = startLang();
  const remembered = load<{ name: string; email: string }>(BUYER_KEY);
  let payer: Payer | null = null;
  let walletError = false;
  let closed = false;

  const sale = (): SaleInfo => ('sale' in checkout.state && checkout.state.sale) || FALLBACK_SALE;
  const checkout: TicketCheckout = new TicketCheckout({ fetch: deps.fetch ?? ((...a) => fetch(...a)) }, (s) => { chat.onCheckout(s); draw(); });
  const chat: HalloweenChat = new HalloweenChat({
    sale,
    register: (b) => {
      save(BUYER_KEY, { name: b.name, email: b.email });
      void checkout.register(b);
    },
    reset: () => checkout.reset(),
    known: () => ({ name: remembered?.name || deps.buyerName(), email: remembered?.email ?? '' }),
  }, () => draw());

  // The parts that stay: header, log, replies, input.
  const root = h('div', 'tk');
  const top = h('div', 'tk-top');
  const log = h('div', 'tk-log');
  log.setAttribute('role', 'log');
  log.setAttribute('aria-live', 'polite');
  const chips = h('div', 'tk-chips');
  const form = h('form', 'tk-input');
  const input = h('input');
  input.name = 'tk-say';
  input.maxLength = 254;
  input.spellcheck = false;
  const send = h('button', 'tk-send');
  send.type = 'submit';
  send.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h14M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  form.append(input, send);
  root.append(top, log, chips, form);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const t = input.value;
    if (!t.trim()) return;
    input.value = '';
    chat.say(t);
  });
  // Keys typed here are the conversation's, never the game's (E, WASD, G, Esc…).
  for (const t of ['keydown', 'keyup'] as const) {
    input.addEventListener(t, (e) => {
      e.stopPropagation();
      if (t === 'keydown' && e.key === 'Escape') input.blur();
    });
  }

  deps.openCard((body) => body.append(root));
  deps.card.classList.add('halloween');

  // The phone's keyboard: keep the card above it and the last message in view.
  const vv = typeof window !== 'undefined' ? window.visualViewport : null;
  const fitKeyboard = () => {
    const kb = vv && document.activeElement === input ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0;
    deps.card.style.setProperty('--kb', `${Math.round(kb)}px`);
    deps.card.classList.toggle('kb', kb > 60);
    log.scrollTop = log.scrollHeight;
  };
  vv?.addEventListener('resize', fitKeyboard);
  vv?.addEventListener('scroll', fitKeyboard);
  input.addEventListener('focus', () => { fitKeyboard(); setTimeout(fitKeyboard, 350); });
  input.addEventListener('blur', () => {
    setTimeout(fitKeyboard, 50);
    // iOS can leave the page scrolled after its keyboard closes.
    if (window.scrollY) window.scrollTo(0, 0);
  });

  const end = () => {
    if (closed) return;
    closed = true;
    checkout.close();
    observer.disconnect();
    vv?.removeEventListener('resize', fitKeyboard);
    vv?.removeEventListener('scroll', fitKeyboard);
    deps.card.classList.remove('kb');
    deps.card.style.removeProperty('--kb');
    // Another card took its place: its skin goes, unless it's a new talk.
    if (deps.card.hidden || !deps.card.querySelector('.tk')) deps.card.classList.remove('halloween');
  };
  const observer = new MutationObserver(() => { if (deps.card.hidden || !root.isConnected) end(); });
  observer.observe(deps.card, { attributes: true, attributeFilter: ['hidden'], childList: true, subtree: true });

  let drawnKind: InputKind | null = null;
  let drawnLines = 0;
  function draw(): void {
    if (closed) return;
    const w = HALLOWEEN_WORDS[L];
    header(w);
    // Only messages that are new this time slide in; the rest just redraw.
    log.replaceChildren(...chat.lines.map((l, i) => {
      const el = line(w, l);
      if (i >= drawnLines) el.classList.add('new');
      return el;
    }));
    drawnLines = chat.lines.length;
    chips.replaceChildren(...chat.chips().map((id) => {
      const b = h('button', `tk-chip${id === 'buy' || id === 'buyMore' || id === 'yes' ? ' primary' : ''}`, chipText(w, id));
      b.type = 'button';
      b.addEventListener('click', () => {
        chat.pick(id);
        // Asked for your name, email or how many: up comes the keyboard (the tap lets it).
        if (chat.input() !== 'chat') input.focus();
      });
      return b;
    }));
    const kind = chat.input();
    input.placeholder = w.placeholder[kind];
    send.setAttribute('aria-label', w.send);
    if (drawnKind !== kind) {
      drawnKind = kind;
      const spec = INPUT[kind];
      input.type = spec.type;
      input.inputMode = spec.mode;
      input.autocomplete = spec.auto as AutoFill;
      input.setAttribute('autocapitalize', spec.cap);
      input.setAttribute('autocorrect', kind === 'chat' ? 'on' : 'off');
      input.setAttribute('enterkeyhint', spec.hint);
    }
    log.scrollTop = log.scrollHeight;
  }

  function header(w: HalloweenWords): void {
    const npc = deps.npc();
    const face = h('img', 'tk-npc') as HTMLImageElement;
    face.src = npc.avatar || '/brand/lacrypta-iso.png';
    face.alt = '';
    face.addEventListener('error', () => { face.src = '/brand/lacrypta-iso.png'; }, { once: true });
    const who = h('div', 'tk-who');
    who.append(h('div', 'tk-name', npc.name), h('div', 'tk-tag', 'Halloween 5 🎃'));
    const langs = h('div', 'tk-lang');
    langs.setAttribute('role', 'group');
    for (const l of ['es', 'en'] as const) {
      const b = h('button', l === L ? 'on' : '', HALLOWEEN_WORDS[l].lang);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(l === L));
      b.addEventListener('click', () => { L = l; save(LANG_KEY, l); draw(); });
      langs.append(b);
    }
    top.replaceChildren(face, who, langs);
  }

  function line(w: HalloweenWords, l: Line): HTMLElement {
    if (l.from === 'me') return h('div', 'tk-msg me', l.text ?? (l.chip ? chipText(w, l.chip) : ''));
    if ('say' in l) return h('div', 'tk-msg npc', l.say(w));
    switch (l.card) {
      case 'event': return eventCard(w);
      case 'invoice': return invoiceCard(w, l.bolt11, l.sats);
      case 'tickets': return ticketsCard(w, l.codes);
      case 'link': {
        const box = h('div', 'tk-msg npc tk-links');
        box.append(l.href === 'maps' ? link('tk-link', `📍 ${w.map}`, HALLOWEEN.maps) : link('tk-link', w.verifyOpen, l.href));
        return box;
      }
    }
  }

  function eventCard(w: HalloweenWords): HTMLElement {
    const box = h('div', 'tk-msg npc tk-event');
    const cover = h('img', 'tk-cover') as HTMLImageElement;
    cover.src = HALLOWEEN.cover;
    cover.alt = HALLOWEEN.name;
    cover.addEventListener('error', () => cover.remove(), { once: true });
    const s = sale();
    const facts = h('div', 'tk-facts');
    facts.append(h('div', '', `📅 ${w.date}`), h('div', '', `📍 ${w.address}`));
    const price = h('div', 'tk-price');
    const full = h('div', 'tk-row');
    full.append(h('span', '', w.lnLabel(s.lightningOff) + (s.couponOff ? ` · ${w.couponLabel(HALLOWEEN.coupon, s.couponOff)}` : '')), h('s', '', ars(s.priceArs)));
    const ln = h('div', 'tk-row tk-ln');
    ln.append(h('span', '', '⚡'), h('b', '', ars(lightningPrice(s))));
    price.append(full, ln);
    box.append(cover, h('div', 'tk-eyebrow', w.eyebrow), h('div', 'tk-title', 'Halloween 5'), h('div', 'tk-sub', 'Fiesta de disfraces'), facts, price, link('tk-link', w.site, HALLOWEEN.site));
    return box;
  }

  function invoiceCard(w: HalloweenWords, bolt11: string, sats: number): HTMLElement {
    const box = h('div', 'tk-msg npc tk-invoice');
    const s = checkout.state;
    const live = s.kind === 'invoice' && s.bolt11 === bolt11 ? s : null;
    box.append(h('div', 'tk-amount', w.sats(sats)));
    const qr = h('canvas', 'tk-qr');
    void QRCode.toCanvas(qr, `lightning:${bolt11}`.toUpperCase(), { margin: 2, width: 440, color: { dark: '#090909', light: '#fff7ed' } })
      // Its own inline size would beat the stylesheet.
      .then(() => { qr.style.removeProperty('width'); qr.style.removeProperty('height'); })
      .catch(() => qr.remove());
    const qrLink = link('tk-qr-link', '', `lightning:${bolt11}`);
    qrLink.target = '_self';
    qrLink.append(qr);
    box.append(qrLink);
    if (!live) return box; // paid or replaced: the QR stays as a record, without buttons
    const btns = h('div', 'tk-btns');
    if (payer && !live.walletPaid) {
      const pay = h('button', 'tk-chip primary', live.walletPaying ? w.paying : w.payWallet);
      pay.type = 'button';
      pay.disabled = live.walletPaying;
      pay.addEventListener('click', () => {
        const p = payer;
        const now = checkout.state;
        if (!p || now.kind !== 'invoice' || now.walletPaying || now.walletPaid) return;
        walletError = false;
        checkout.walletPaying(true);
        p.pay(bolt11).then((r) => checkout.walletPaid(r.preimage)).catch(() => { walletError = true; checkout.walletPaying(false); });
      });
      btns.append(pay);
    }
    const copy = h('button', 'tk-chip', w.copy);
    copy.type = 'button';
    copy.addEventListener('click', () => { void navigator.clipboard?.writeText(bolt11).then(() => deps.toast(w.copied)).catch(() => {}); });
    const open = link('tk-chip', w.openWallet, `lightning:${bolt11}`);
    open.target = '_self';
    btns.append(copy, open);
    box.append(btns);
    if (!live.walletPaid) box.append(h('div', 'tk-wait', live.walletPaying ? w.paying : w.waiting));
    if (walletError && !live.walletPaid) box.append(h('div', 'tk-error', w.errWallet));
    return box;
  }

  function ticketsCard(w: HalloweenWords, codes: string[]): HTMLElement {
    const box = h('div', 'tk-msg npc tk-done');
    for (const c of codes) {
      const row = h('div', 'tk-code');
      row.append(h('span', '', w.code), h('b', '', c));
      box.append(row);
    }
    box.append(link('tk-link', w.site, HALLOWEEN.site));
    return box;
  }

  void deps.payer().then((p) => { payer = p; draw(); }).catch(() => {});
  void checkout.load();
  chat.start(!!deps.again);

  return {
    // The card can be hidden a moment before the observer hears it (a tap on the world): not open then.
    get open() { return !closed && !deps.card.hidden && root.isConnected; },
    get engaged() { return !closed && (chat.engaged || document.activeElement === input); },
    get talked() { return chat.lines.some((l) => l.from === 'me'); },
    reopen() {
      if (closed || !root.isConnected) return false;
      deps.card.hidden = false;
      return true;
    },
    close() { deps.card.hidden = true; end(); },
  };
}
