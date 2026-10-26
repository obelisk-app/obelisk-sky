// Halloween 5 at La Crypta (halloween.lacrypta.ar): the party, and buying
// tickets for it from the village. La Crypta's own account stands at its
// door with a sign; talking to it opens ui/ticketDialog.ts, which runs a
// TicketCheckout: La Crypta's checkout, as its page does it (register →
// a Lightning invoice → poll until paid → claim), through the server's
// same-origin proxy (server/ticketProxy.ts: their API sends no CORS).
//
// Pure apart from the injected fetch and timers: tested in halloween.test.ts.

/** La Crypta's account (_@lacrypta.ar, npub1rujdpkd8mwezrvpqd2rx2zphfaztqrtsfg6w3vdnljdghs2q8qrqtt9u68). */
export const LA_CRYPTA_PUBKEY = '1f24d0d9a7dbb221b0206a866508374f44b00d704a34e8b1b3fc9a8bc1403806';

export const HALLOWEEN = {
  name: 'Halloween 5 - Fiesta de Disfraces',
  /** The event page, with the village's coupon on it. */
  site: 'https://halloween.lacrypta.ar/?coupon=LLOPO',
  /** The village's discount code: checked when the dialog opens, sent with every order while it holds. */
  coupon: 'LLOPO',
  /** Sat 31 Oct 2026, 20:00 in Buenos Aires. */
  startsAt: Date.parse('2026-10-31T23:00:00Z'),
  /** The sign and the NPC go after the party: 1 Nov 2026, 06:00 in Buenos Aires. */
  endsAt: Date.parse('2026-11-01T09:00:00Z'),
  address: 'Villanueva 1367, CABA',
  maps: 'https://www.google.com/maps/search/?api=1&query=Villanueva+1367%2C+C1426BMI+Cdad.+Aut%C3%B3noma+de+Buenos+Aires&query_place_id=ChIJI9wMh8i1vJUR4LM5qmnTRck',
  cover: 'https://cloud.lacrypta.ar/organizations/00000000-0000-4000-8000-000000000001/events/covers/halloween-5-fiesta-de-disfraces-1791551494273-462c8c8d.png',
  /** What the page says, used until the live checkout state arrives. */
  priceArs: 60_000,
  lightningOff: 21,
  satsBack: 50,
  color: '#fb923c',
} as const;

export const TICKETS_API = '/api/lacrypta-tickets/';
export const POLL_MS = 2500;

export function halloweenOn(now = Date.now()): boolean {
  return now < HALLOWEEN.endsAt;
}

/** The live state of the sale (their checkout-state, the parts we show). */
export interface SaleInfo {
  ended: boolean;
  full: boolean;
  spotsLeft: number | null;
  priceArs: number;
  lightningOff: number;
  satsBack: number;
  maxPerOrder: number;
  /** The coupon's discount (percent, on top of Lightning's), 0 when it doesn't hold. */
  couponOff: number;
}

export function parseSale(j: unknown): SaleInfo {
  const o = (j && typeof j === 'object' ? j : {}) as Record<string, unknown>;
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const disc = (o.paymentDiscounts ?? {}) as Record<string, unknown>;
  const back = (o.satsBack ?? {}) as Record<string, unknown>;
  return {
    ended: o.ended === true,
    full: o.full === true,
    spotsLeft: typeof o.spotsLeft === 'number' ? o.spotsLeft : null,
    priceArs: num(o.priceAmount, HALLOWEEN.priceArs),
    lightningOff: num(disc.lightning, HALLOWEEN.lightningOff),
    satsBack: num(back.percent, HALLOWEEN.satsBack),
    maxPerOrder: Math.max(1, Math.min(10, num(o.maxTicketsPerOrder, 10))),
    couponOff: 0,
  };
}

/** The ticket codes in a response, as their page reads them. */
export function ticketCodes(j: Record<string, unknown>): string[] {
  if (Array.isArray(j.ticket_codes)) {
    const c = j.ticket_codes.filter((x): x is string => typeof x === 'string' && x.length > 0);
    if (c.length) return c;
  }
  return typeof j.ticket_code === 'string' && j.ticket_code ? [j.ticket_code] : [];
}

/** The price per ticket paying with Lightning (and the coupon, when it holds), as their checkout counts it. */
export function lightningPrice(s: Pick<SaleInfo, 'priceArs' | 'lightningOff'> & { couponOff?: number }): number {
  const ln = Math.round(s.priceArs * (1 - s.lightningOff / 100));
  return s.couponOff ? Math.round(ln * (1 - s.couponOff / 100)) : ln;
}

/** A coupon check's answer: the percent off, 0 if it doesn't hold. */
export function parseCoupon(j: unknown): number {
  const o = (j && typeof j === 'object' ? j : {}) as Record<string, unknown>;
  return o.valid === true && o.discount_type === 'percent' && typeof o.discount_value === 'number' && o.discount_value > 0 && o.discount_value < 100 ? o.discount_value : 0;
}

export interface Buyer { name: string; email: string; quantity: number }

export type Checkout =
  | { kind: 'loading' }
  | { kind: 'ready'; sale: SaleInfo }
  | { kind: 'submitting'; sale: SaleInfo }
  | { kind: 'invoice'; sale: SaleInfo; bolt11: string; hash: string; sats: number; quantity: number; walletPaying: boolean; walletPaid: boolean }
  | { kind: 'claiming'; sale: SaleInfo }
  | { kind: 'confirmed'; sale: SaleInfo; codes: string[]; total: number }
  | { kind: 'registered'; sale: SaleInfo }
  | { kind: 'verify'; sale: SaleInfo; loginUrl: string }
  | { kind: 'waitlist'; sale: SaleInfo }
  | { kind: 'error'; sale: SaleInfo | null; message: string; canRetry: boolean };

export type CheckoutError = 'network' | 'server' | 'claim' | 'wallet';

export interface CheckoutDeps {
  fetch: typeof fetch;
  uuid?: () => string;
  setInterval?: (f: () => void, ms: number) => unknown;
  clearInterval?: (h: unknown) => void;
}

export const FALLBACK_SALE: SaleInfo = { ended: false, full: false, spotsLeft: null, priceArs: HALLOWEEN.priceArs, lightningOff: HALLOWEEN.lightningOff, satsBack: HALLOWEEN.satsBack, maxPerOrder: 10, couponOff: 0 };

/**
 * One ticket purchase. `state` changes and `onChange` hears it. While an
 * invoice is out it polls every POLL_MS until paid, then claims; `close()`
 * stops it. Once a wallet has paid, nothing offers a retry (it could pay twice).
 */
export class TicketCheckout {
  state: Checkout = { kind: 'loading' };
  private poll: unknown = null;
  private polling = false;
  private closed = false;
  private verifyUrl: string | null = null;
  private readonly uuid: () => string;
  private readonly setI: (f: () => void, ms: number) => unknown;
  private readonly clearI: (h: unknown) => void;

  constructor(private deps: CheckoutDeps, private onChange: (s: Checkout) => void = () => {}) {
    this.uuid = deps.uuid ?? (() => crypto.randomUUID());
    this.setI = deps.setInterval ?? ((f, ms) => setInterval(f, ms));
    this.clearI = deps.clearInterval ?? ((h) => clearInterval(h as ReturnType<typeof setInterval>));
  }

  private set(s: Checkout): void {
    if (this.closed) return;
    this.state = s;
    this.onChange(s);
  }

  private get sale(): SaleInfo {
    return 'sale' in this.state && this.state.sale ? this.state.sale : FALLBACK_SALE;
  }

  private async api(path: string, body?: unknown): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
    const r = await this.deps.fetch(TICKETS_API + path, body === undefined
      ? { cache: 'no-store' }
      : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const json = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: r.ok, status: r.status, json: json && typeof json === 'object' ? json : {} };
  }

  async load(): Promise<void> {
    this.set({ kind: 'loading' });
    const [state, coupon] = await Promise.all([
      this.api('checkout-state').catch(() => null),
      this.api('coupons/check', { code: HALLOWEEN.coupon, quantity: 1 }).catch(() => null),
    ]);
    const sale = state?.ok ? parseSale(state.json) : { ...FALLBACK_SALE };
    sale.couponOff = coupon?.ok ? parseCoupon(coupon.json) : 0;
    this.set({ kind: 'ready', sale });
  }

  /** Back to the form after an error that allows it. */
  reset(): void {
    if (this.state.kind === 'error' && this.state.canRetry) this.set({ kind: 'ready', sale: this.sale });
  }

  async register(b: Buyer, retried = false): Promise<void> {
    const sale = this.sale;
    if (this.state.kind !== 'ready' && this.state.kind !== 'submitting') return;
    this.set({ kind: 'submitting', sale });
    let r: Awaited<ReturnType<TicketCheckout['api']>>;
    try {
      r = await this.api('register', {
        name: b.name.trim(), email: b.email.trim().toLowerCase(), quantity: b.quantity, idempotency_key: this.uuid(),
        ...(sale.couponOff > 0 ? { coupon_code: HALLOWEEN.coupon } : {}),
      });
    } catch {
      this.set({ kind: 'error', sale, message: 'network', canRetry: true });
      return;
    }
    const j = r.json;
    if (!r.ok) { this.set({ kind: 'error', sale, message: typeof j.error === 'string' ? j.error : 'server', canRetry: true }); return; }
    switch (j.status) {
      case 'awaiting_payment':
        if (typeof j.bolt11 !== 'string' || typeof j.payment_hash !== 'string') break;
        this.verifyUrl = typeof j.verify_url === 'string' && /^https:\/\//.test(j.verify_url) ? j.verify_url : null;
        this.set({ kind: 'invoice', sale, bolt11: j.bolt11, hash: j.payment_hash, sats: typeof j.amount_sats === 'number' ? j.amount_sats : 0, quantity: b.quantity, walletPaying: false, walletPaid: false });
        this.startPolling();
        return;
      case 'registered':
        this.set({ kind: 'registered', sale });
        return;
      case 'purchase_confirmed':
        this.set({ kind: 'confirmed', sale, codes: ticketCodes(j), total: typeof j.total_tickets === 'number' && j.total_tickets > 0 ? j.total_tickets : b.quantity });
        return;
      case 'already_registered':
        // Several orders per email are allowed: their page asks again with a new key.
        if (!retried) { await this.register(b, true); return; }
        break;
      case 'verification_required':
        this.set({ kind: 'verify', sale, loginUrl: typeof j.login_url === 'string' && /^\//.test(j.login_url) ? new URL(j.login_url, HALLOWEEN.site).href : HALLOWEEN.site });
        return;
      case 'confirmation_resent':
        this.set({ kind: 'registered', sale });
        return;
      case 'on_waitlist':
        this.set({ kind: 'waitlist', sale });
        return;
    }
    this.set({ kind: 'error', sale, message: 'server', canRetry: true });
  }

  private startPolling(): void {
    this.stopPolling();
    void this.check();
    this.poll = this.setI(() => { void this.check(); }, POLL_MS);
  }

  private stopPolling(): void {
    if (this.poll !== null) this.clearI(this.poll);
    this.poll = null;
  }

  /** One look at the invoice: paid (done), or settled with a preimage (claim it). */
  async check(): Promise<void> {
    const s = this.state;
    if (s.kind !== 'invoice' || this.polling) return;
    this.polling = true;
    try {
      const r = await this.api(`payment-status?payment_hash=${encodeURIComponent(s.hash)}`);
      if (this.state !== s && this.state.kind !== 'invoice') return;
      if (r.ok && r.json.status === 'paid') { this.done(r.json, s.quantity); return; }
      if (r.ok && r.json.settled === true && typeof r.json.preimage === 'string') { await this.claim(r.json.preimage); return; }
      if (this.verifyUrl) {
        // LUD-21 verify, as their page polls it when the invoice has one.
        const v = await this.deps.fetch(this.verifyUrl, { cache: 'no-store' }).then((x) => x.json()).catch(() => null) as Record<string, unknown> | null;
        if (v?.settled === true && typeof v.preimage === 'string') await this.claim(v.preimage);
      }
    } catch {
      // Keep polling: a dropped request is not a failed payment.
    } finally {
      this.polling = false;
    }
  }

  /** The wallet paid and handed back the preimage: claim at once. */
  async walletPaid(preimage: string | null): Promise<void> {
    const s = this.state;
    if (s.kind !== 'invoice') return;
    this.set({ ...s, walletPaying: false, walletPaid: true });
    if (preimage && /^[0-9a-f]{64}$/i.test(preimage)) await this.claim(preimage);
  }

  walletPaying(on: boolean): void {
    const s = this.state;
    if (s.kind === 'invoice') this.set({ ...s, walletPaying: on });
  }

  private async claim(preimage: string): Promise<void> {
    const s = this.state;
    if (s.kind !== 'invoice') return;
    this.stopPolling();
    const sale = s.sale;
    this.set({ kind: 'claiming', sale });
    try {
      const r = await this.api('claim', { payment_hash: s.hash, preimage });
      if (r.ok && r.json.status === 'paid') { this.done(r.json, s.quantity); return; }
      // Paid but not confirmed yet: back to the invoice, polling picks it up.
      this.set({ ...s, walletPaying: false });
      this.startPolling();
    } catch {
      this.set({ ...s, walletPaying: false });
      this.startPolling();
    }
  }

  private done(j: Record<string, unknown>, quantity: number): void {
    this.stopPolling();
    this.set({ kind: 'confirmed', sale: this.sale, codes: ticketCodes(j), total: typeof j.total_tickets === 'number' && j.total_tickets > 0 ? j.total_tickets : quantity });
  }

  close(): void {
    this.stopPolling();
    this.closed = true;
  }
}
