// The conversation with La Crypta at its door (ui/ticketDialog.ts draws it):
// La Crypta talks, you tap a reply or type one, and buying tickets is part of
// the talk (your name, your email, how many, "shall I make the invoice?"),
// then the invoice and the tickets arrive as messages. Typed text is matched
// to the same topics by keywords, in Spanish or English.
//
// Messages are kept as keys, not text, so the ES | EN switch redraws the
// whole conversation in the other language. Pure: the checkout is injected
// (events/halloween.ts TicketCheckout) and its states arrive by `onCheckout`.

import { HALLOWEEN, lightningPrice, type Buyer, type Checkout, type SaleInfo } from './halloween';
import type { HalloweenWords } from './halloweenWords';

export type Topic = 'when' | 'where' | 'price' | 'pay' | 'what' | 'costume';
export type ChipId = Topic | 'buy' | 'buyMore' | 'yes' | 'edit' | 'cancel' | 'retry' | `fill:${string}` | `qty:${number}`;
export type Mode = 'chat' | 'name' | 'email' | 'qty' | 'confirm' | 'busy';

export type Line =
  | { from: 'npc'; say: (w: HalloweenWords) => string }
  | { from: 'me'; text?: string; chip?: ChipId }
  | { from: 'npc'; card: 'event' }
  | { from: 'npc'; card: 'invoice'; bolt11: string; sats: number }
  | { from: 'npc'; card: 'tickets'; codes: string[]; total: number }
  | { from: 'npc'; card: 'link'; href: string };

export interface ChatDeps {
  sale(): SaleInfo;
  register(b: Buyer): void;
  reset(): void;
  /** What we already know about you (your village name, a remembered email). */
  known(): { name: string; email: string };
}

const TOPICS: Topic[] = ['when', 'where', 'price', 'pay', 'what', 'costume'];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Accents and case away, so "¿Cuándo?" and "cuando" match the same. */
export function norm(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9@. ]+/g, ' ');
}

const KEYWORDS: [Topic | 'buy' | 'hi' | 'thanks', RegExp][] = [
  ['buy', /\b(entrada|entradas|ticket|tickets|comprar|compro|quiero ir|anot|reserv|buy|purchase|sign up|get in)\w*/],
  ['price', /\b(cuanto|precio|sale|cuesta|valor|price|cost|how much|ars|pesos)\b/],
  ['pay', /\b(pago|pagar|pagas|lightning|sats|bitcoin|btc|mercadopago|efectivo|cash|pay|paying|wallet|billetera|cashback|devuel|lawallet|tarjeta|fiat)\w*/],
  ['when', /\b(cuando|fecha|dia|hora|horario|when|date|time|day|what time|empieza|start)\b/],
  ['where', /\b(donde|lugar|direccion|ubicacion|queda|where|address|place|location|map|mapa|belgrano|villanueva)\b/],
  ['costume', /\b(disfraz|disfraces|concurso|premio|premios|costume|contest|prize|dress)\w*/],
  ['what', /\b(que hay|musica|dj|barra|tragos|comida|pista|what s on|whats on|music|drinks|food|bar|dance|bailar)\b/],
  ['hi', /\b(hola|buenas|buen dia|hi|hello|hey|que tal)\b/],
  ['thanks', /\b(gracias|genial|joya|chau|nos vemos|thanks|thank you|bye|cool|great)\b/],
];

/** What a typed line is about, if anything. */
export function topicOf(text: string): Topic | 'buy' | 'hi' | 'thanks' | null {
  const t = ` ${norm(text)} `;
  for (const [k, re] of KEYWORDS) if (re.test(t)) return k;
  return null;
}

export class HalloweenChat {
  lines: Line[] = [];
  mode: Mode = 'chat';
  buyer: Buyer = { name: '', email: '', quantity: 1 };
  /** The last checkout state we spoke about (one message per change). */
  private seen: Checkout['kind'] | null = null;
  private walletPaidSaid = false;
  private bought = false;
  private canRetry = false;

  constructor(private deps: ChatDeps, private onChange: () => void = () => {}) {}

  private npc(say: (w: HalloweenWords) => string): void { this.lines.push({ from: 'npc', say }); }

  start(again = false): void {
    this.npc((w) => (again ? w.greetAgain : w.greet));
    this.lines.push({ from: 'npc', card: 'event' });
    this.npc((w) => w.menu);
    this.onChange();
  }

  /** The replies to offer right now. */
  chips(): ChipId[] {
    const k = this.deps.known();
    switch (this.mode) {
      case 'name': return [...(k.name ? [`fill:${k.name}` as ChipId] : []), 'cancel'];
      case 'email': return [...(k.email ? [`fill:${k.email}` as ChipId] : []), 'cancel'];
      case 'qty': return [1, 2, 3, 4].filter((n) => n <= this.max()).map((n) => `qty:${n}` as ChipId).concat('cancel');
      case 'confirm': return ['yes', 'edit', 'cancel'];
      case 'busy': return this.canRetry ? ['retry', 'cancel'] : TOPICS;
      default: return [this.bought ? 'buyMore' : 'buy', ...TOPICS];
    }
  }

  /** In the middle of buying: walking away shouldn't close it. */
  get engaged(): boolean {
    return this.mode !== 'chat' && !(this.mode === 'busy' && this.seen === 'confirmed');
  }

  private max(): number {
    const s = this.deps.sale();
    return Math.max(1, Math.min(s.maxPerOrder, s.spotsLeft ?? s.maxPerOrder));
  }

  pick(id: ChipId): void {
    this.lines.push({ from: 'me', chip: id });
    this.act(id);
  }

  private act(id: ChipId): void {
    if (id.startsWith('fill:')) { this.answer(id.slice(5)); return; }
    if (id.startsWith('qty:')) { this.answer(id.slice(4)); return; }
    switch (id) {
      case 'buy': case 'buyMore': this.beginBuy(); break;
      case 'yes': this.mode = 'busy'; this.seen = null; this.canRetry = false; this.deps.register({ ...this.buyer }); break;
      case 'edit': this.mode = 'name'; this.npc((w) => w.askName); break;
      case 'cancel': this.mode = 'chat'; this.canRetry = false; this.deps.reset(); this.npc((w) => w.cancelled); break;
      case 'retry': this.mode = 'confirm'; this.canRetry = false; this.deps.reset(); this.sayConfirm(); break;
      default: this.topic(id as Topic);
    }
    this.onChange();
  }

  /** You typed something and sent it. */
  say(text: string): void {
    const t = text.trim();
    if (!t) return;
    this.lines.push({ from: 'me', text: t });
    this.answer(t);
  }

  private answer(t: string): void {
    switch (this.mode) {
      case 'name':
        if (t.length < 1 || t.length > 120 || /@/.test(t)) { this.npc((w) => w.badName); break; }
        this.buyer.name = t;
        this.mode = 'email';
        this.npc((w) => w.askEmail(t));
        break;
      case 'email':
        if (!EMAIL.test(t) || t.length > 254) { this.npc((w) => w.badEmail); break; }
        this.buyer.email = t.toLowerCase();
        this.mode = 'qty';
        this.npc((w) => w.askQty);
        break;
      case 'qty': {
        const n = Number(norm(t).match(/\d+/)?.[0] ?? NaN);
        const max = this.max();
        if (!Number.isInteger(n) || n < 1 || n > max) { this.npc((w) => w.badQty(max)); break; }
        this.buyer.quantity = n;
        this.mode = 'confirm';
        this.sayConfirm();
        break;
      }
      case 'confirm': {
        const k = norm(t);
        if (/\b(si|dale|ok|okay|yes|sure|genera|generala|listo|va)\b/.test(k)) { this.act('yes'); return; }
        if (/\b(no|cancel|cancela|cancelar|cambiar|edit)\b/.test(k)) { this.act(/cambiar|edit/.test(k) ? 'edit' : 'cancel'); return; }
        this.sayConfirm();
        break;
      }
      default: {
        const k = topicOf(t);
        if (k === 'buy') { if (this.mode === 'chat') this.beginBuy(); else this.npc((w) => w.menu); }
        else if (k === 'hi') this.npc((w) => w.hi);
        else if (k === 'thanks') this.npc((w) => w.thanks);
        else if (k) this.topic(k);
        else this.npc((w) => w.noIdea);
      }
    }
    this.onChange();
  }

  private sayConfirm(): void {
    const { name, email, quantity } = this.buyer;
    const total = lightningPrice(this.deps.sale()) * quantity;
    this.npc((w) => w.confirm(quantity, name, email, total));
    this.npc((w) => w.privacy);
  }

  private beginBuy(): void {
    const s = this.deps.sale();
    if (s.ended) { this.npc((w) => w.ended); return; }
    if (s.full) { this.npc((w) => w.closed); return; }
    this.mode = 'name';
    this.buyer.quantity = 1;
    this.npc((w) => w.askName);
  }

  private topic(t: Topic): void {
    const s = this.deps.sale();
    switch (t) {
      case 'when': this.npc((w) => w.when); break;
      case 'where':
        this.npc((w) => w.where);
        this.lines.push({ from: 'npc', card: 'link', href: 'maps' });
        break;
      case 'price':
        if (s.couponOff > 0) this.npc((w) => w.priceCoupon(s.priceArs, lightningPrice(s), s.lightningOff, HALLOWEEN.coupon, s.couponOff));
        else this.npc((w) => w.price(s.priceArs, lightningPrice(s), s.lightningOff));
        if (s.spotsLeft !== null && !s.full && !s.ended) { const n = s.spotsLeft; this.npc((w) => w.spots(n)); }
        break;
      case 'pay': this.npc((w) => w.pay(s.satsBack)); break;
      case 'what': this.npc((w) => w.what); break;
      case 'costume': this.npc((w) => w.costume); break;
    }
  }

  /** The checkout moved on: say so, once per change. */
  onCheckout(c: Checkout): void {
    if (this.mode !== 'busy') return;
    if (c.kind === 'invoice' && c.walletPaid && !this.walletPaidSaid) {
      this.walletPaidSaid = true;
      this.npc((w) => w.paid);
      this.onChange();
      return;
    }
    if (c.kind === this.seen) return;
    this.seen = c.kind;
    switch (c.kind) {
      case 'submitting': this.npc((w) => w.creating); break;
      case 'invoice':
        this.walletPaidSaid = false;
        this.npc((w) => w.invoice(c.sats));
        this.lines.push({ from: 'npc', card: 'invoice', bolt11: c.bolt11, sats: c.sats });
        break;
      case 'confirmed':
        this.bought = true;
        this.npc((w) => w.done(c.total));
        if (c.codes.length) this.lines.push({ from: 'npc', card: 'tickets', codes: c.codes, total: c.total });
        this.mode = 'chat';
        break;
      case 'registered': this.npc((w) => w.registered); this.mode = 'chat'; break;
      case 'waitlist': this.npc((w) => w.waitlist); this.mode = 'chat'; break;
      case 'verify':
        this.npc((w) => w.verify);
        this.lines.push({ from: 'npc', card: 'link', href: c.loginUrl });
        this.mode = 'chat';
        break;
      case 'error': {
        const m = c.message;
        this.npc((w) => (m === 'network' ? w.errNetwork : m === 'server' ? w.errServer : `${w.errServer} (${m})`));
        this.canRetry = c.canRetry;
        if (!c.canRetry) this.mode = 'chat';
        break;
      }
      default: return;
    }
    this.onChange();
  }

  /** The input's job right now. */
  input(): 'chat' | 'name' | 'email' | 'qty' {
    return this.mode === 'name' || this.mode === 'email' || this.mode === 'qty' ? this.mode : 'chat';
  }
}
