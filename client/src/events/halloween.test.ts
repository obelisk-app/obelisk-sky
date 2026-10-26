import { describe, it, expect, vi } from 'vitest';
import { HALLOWEEN, TicketCheckout, halloweenOn, lightningPrice, parseCoupon, parseSale, ticketCodes, type Checkout } from './halloween';

const HASH = 'c'.repeat(64);
const PRE = 'd'.repeat(64);
const STATE = { ended: false, full: false, spotsLeft: 105, priceAmount: 60000, paymentDiscounts: { lightning: 21 }, satsBack: { percent: 50 }, maxTicketsPerOrder: 10 };

type Route = (path: string, init?: RequestInit) => { status?: number; body: unknown };

function server(route: Route) {
  const calls: { path: string; body: unknown }[] = [];
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const path = url.replace('/api/lacrypta-tickets/', '');
    calls.push({ path, body: init?.body ? JSON.parse(init.body as string) : undefined });
    const r = route(path, init);
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
}

function checkout(route: Route) {
  const s = server(route);
  const timers: (() => void)[] = [];
  const seen: Checkout['kind'][] = [];
  let n = 0;
  const c = new TicketCheckout({
    fetch: s.fetch,
    uuid: () => `00000000-0000-4000-8000-00000000000${n++}`,
    setInterval: (f) => { timers.push(f); return timers.length - 1; },
    clearInterval: () => { timers.length = 0; },
  }, (st) => seen.push(st.kind));
  return { c, calls: s.calls, timers, seen };
}

const buyer = { name: 'Ana', email: 'Ana@x.com', quantity: 2 };

describe('Halloween at La Crypta', () => {
  it('is on until the morning after the party', () => {
    expect(halloweenOn(Date.parse('2026-10-25T12:00:00Z'))).toBe(true);
    expect(halloweenOn(HALLOWEEN.startsAt + 3 * 3600_000)).toBe(true);
    expect(halloweenOn(Date.parse('2026-11-01T10:00:00Z'))).toBe(false);
  });

  it('reads the sale and the Lightning price', () => {
    const s = parseSale(STATE);
    expect(s).toMatchObject({ spotsLeft: 105, priceArs: 60000, lightningOff: 21, satsBack: 50, maxPerOrder: 10, ended: false, full: false });
    expect(lightningPrice(s)).toBe(47400);
    expect(lightningPrice({ ...s, couponOff: 30 })).toBe(33180);
    expect(parseCoupon({ valid: true, discount_type: 'percent', discount_value: 30 })).toBe(30);
    expect(parseCoupon({ valid: false })).toBe(0);
    expect(HALLOWEEN.site).toBe('https://halloween.lacrypta.ar/?coupon=LLOPO');
    expect(parseSale(null)).toMatchObject({ priceArs: 60000, spotsLeft: null });
    expect(ticketCodes({ ticket_codes: ['A1', '', 3] })).toEqual(['A1']);
    expect(ticketCodes({ ticket_code: 'B2' })).toEqual(['B2']);
  });

  it('registers, polls the invoice and finishes when paid', async () => {
    let paid = false;
    const { c, calls, timers, seen } = checkout((p) => {
      if (p === 'checkout-state') return { body: STATE };
      if (p === 'register') return { body: { status: 'awaiting_payment', bolt11: 'lnbc1x', payment_hash: HASH, amount_sats: 9000 } };
      if (p.startsWith('payment-status')) return { body: paid ? { status: 'paid', ticket_codes: ['T1', 'T2'], total_tickets: 2 } : { status: 'pending' } };
      return { status: 404, body: {} };
    });
    await c.load();
    await c.register(buyer);
    expect(c.state).toMatchObject({ kind: 'invoice', bolt11: 'lnbc1x', sats: 9000, quantity: 2 });
    expect(calls.find((x) => x.path === 'register')?.body).toEqual({ name: 'Ana', email: 'ana@x.com', quantity: 2, idempotency_key: '00000000-0000-4000-8000-000000000000' });
    await vi.waitFor(() => expect(calls.filter((x) => x.path.startsWith('payment-status')).length).toBe(1));
    await new Promise((r) => setTimeout(r, 5)); // the first look has come back
    paid = true;
    timers[0]();
    await vi.waitFor(() => expect(c.state.kind).toBe('confirmed'));
    expect(c.state).toMatchObject({ codes: ['T1', 'T2'], total: 2 });
    expect(timers.length).toBe(0);
    expect(seen).toEqual(['loading', 'ready', 'submitting', 'invoice', 'confirmed']);
  });

  it('claims with the preimage once the invoice settles', async () => {
    const { c, calls } = checkout((p) => {
      if (p === 'checkout-state') return { body: STATE };
      if (p === 'register') return { body: { status: 'awaiting_payment', bolt11: 'lnbc1x', payment_hash: HASH, amount_sats: 1 } };
      if (p.startsWith('payment-status')) return { body: { settled: true, preimage: PRE } };
      if (p === 'claim') return { body: { status: 'paid', ticket_code: 'Z9' } };
      return { status: 404, body: {} };
    });
    await c.load();
    await c.register({ ...buyer, quantity: 1 });
    await vi.waitFor(() => expect(c.state.kind).toBe('confirmed'));
    expect(calls.find((x) => x.path === 'claim')?.body).toEqual({ payment_hash: HASH, preimage: PRE });
    expect(c.state).toMatchObject({ codes: ['Z9'], total: 1 });
  });

  it('claims at once with the wallet\'s preimage, and never offers a retry after', async () => {
    let claimOk = false;
    const { c } = checkout((p) => {
      if (p === 'checkout-state') return { body: STATE };
      if (p === 'register') return { body: { status: 'awaiting_payment', bolt11: 'lnbc1x', payment_hash: HASH, amount_sats: 1 } };
      if (p.startsWith('payment-status')) return { body: { status: 'pending' } };
      if (p === 'claim') return claimOk ? { body: { status: 'paid', ticket_code: 'W1' } } : { status: 500, body: { error: 'later' } };
      return { status: 404, body: {} };
    });
    await c.load();
    await c.register(buyer);
    c.walletPaying(true);
    await c.walletPaid(PRE);
    // The claim failed: back on the invoice, paid, still polling, no error to retry from.
    expect(c.state).toMatchObject({ kind: 'invoice', walletPaid: true });
    claimOk = true;
    await c.walletPaid(PRE);
    expect(c.state).toMatchObject({ kind: 'confirmed', codes: ['W1'] });
  });

  it('asks again with a new key when the email already has an order', async () => {
    let n = 0;
    const { c, calls } = checkout((p) => {
      if (p === 'checkout-state') return { body: STATE };
      if (p === 'register') return { body: n++ === 0 ? { status: 'already_registered' } : { status: 'awaiting_payment', bolt11: 'lnbc1y', payment_hash: HASH, amount_sats: 2 } };
      return { body: { status: 'pending' } };
    });
    await c.load();
    await c.register(buyer);
    const keys = calls.filter((x) => x.path === 'register').map((x) => (x.body as { idempotency_key: string }).idempotency_key);
    expect(new Set(keys).size).toBe(2);
    expect(c.state.kind).toBe('invoice');
    c.close();
  });

  it('sends a verification to their login, and errors back to the form', async () => {
    let mode = 'verify';
    const { c } = checkout((p) => {
      if (p === 'checkout-state') return { body: STATE };
      if (mode === 'verify') return { body: { status: 'verification_required', login_url: '/o/la-crypta/login' } };
      return { status: 400, body: { error: 'Email inválido' } };
    });
    await c.load();
    await c.register(buyer);
    expect(c.state).toMatchObject({ kind: 'verify', loginUrl: 'https://halloween.lacrypta.ar/o/la-crypta/login' });
    const d = checkout(() => ({ status: 400, body: { error: 'Email inválido' } }));
    mode = 'err';
    await d.c.load();
    await d.c.register(buyer);
    expect(d.c.state).toMatchObject({ kind: 'error', message: 'Email inválido', canRetry: true });
    d.c.reset();
    expect(d.c.state.kind).toBe('ready');
  });

  it('falls back to the page\'s numbers when the state can\'t be read, and goes quiet once closed', async () => {
    const { c, seen } = checkout(() => ({ status: 502, body: { error: 'down' } }));
    await c.load();
    expect(c.state).toMatchObject({ kind: 'ready', sale: { priceArs: 60000 } });
    c.close();
    await c.load();
    expect(seen).toEqual(['loading', 'ready']);
  });
});
