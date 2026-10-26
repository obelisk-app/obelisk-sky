import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { claimBody, couponBody, handleTickets, registerBody, ticketRoute, TICKETS_UPSTREAM } from './ticketProxy';

const HASH = 'a'.repeat(64);
const KEY = '123e4567-e89b-42d3-a456-426614174000';

function fakeReq(method: string, body?: unknown, ip = `10.0.0.${Math.floor(Math.random() * 250)}`): IncomingMessage {
  const r = new EventEmitter() as unknown as IncomingMessage & { destroy(): void };
  Object.assign(r, { method, headers: { 'cf-connecting-ip': ip }, destroy() {} });
  setTimeout(() => {
    if (body !== undefined) r.emit('data', Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)));
    r.emit('end');
  }, 0);
  return r;
}

function fakeRes() {
  const out = { status: 0, headers: {} as Record<string, string>, body: '' };
  const res = {
    headersSent: false,
    writeHead(s: number, h: Record<string, string> = {}) { out.status = s; out.headers = h; return res; },
    end(b?: string) { out.body = b ?? ''; return res; },
  };
  return { res: res as unknown as ServerResponse, out };
}

const upstream = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

async function call(method: string, path: string, body?: unknown, fetchFn = upstream(200, { ok: true })) {
  const { res, out } = fakeRes();
  await handleTickets(fakeReq(method, body), res, new URL(path, 'http://x'), fetchFn as unknown as typeof fetch);
  return { out, fetchFn, json: out.body ? JSON.parse(out.body) : null };
}

describe('the ticket proxy', () => {
  it('checks only the coupon, Lightning only, and passes a valid one with the order', () => {
    expect(ticketRoute('/api/lacrypta-tickets/coupons/check')).toBe('coupons/check');
    expect(couponBody({ code: 'LLOPO', quantity: 2, payment_method: 'mercadopago', email: 'x' })).toEqual({ code: 'LLOPO', quantity: 2, payment_method: 'lightning' });
    expect(couponBody({ code: 'bad code!', quantity: 1 })).toBeNull();
    expect(registerBody({ name: 'A', email: 'a@b.co', quantity: 1, idempotency_key: KEY, coupon_code: 'LLOPO' })).toMatchObject({ coupon_code: 'LLOPO' });
    expect(registerBody({ name: 'A', email: 'a@b.co', quantity: 1, idempotency_key: KEY, coupon_code: '../x' })).toBeNull();
  });

  it('knows exactly its routes', () => {
    expect(ticketRoute('/api/lacrypta-tickets/checkout-state')).toBe('checkout-state');
    expect(ticketRoute('/api/lacrypta-tickets/register')).toBe('register');
    expect(ticketRoute('/api/lacrypta-tickets/payment-status')).toBe('payment-status');
    expect(ticketRoute('/api/lacrypta-tickets/claim')).toBe('claim');
    for (const bad of ['/api/lacrypta-tickets/', '/api/lacrypta-tickets/../auth', '/api/lacrypta-tickets/toString', '/api/other']) expect(ticketRoute(bad), bad).toBeNull();
  });

  it('rebuilds a register from known fields, Lightning only', () => {
    expect(registerBody({ name: ' Ana ', email: 'Ana@Mail.com', quantity: 2, idempotency_key: KEY, payment_method: 'mercadopago', coupon_code: 'X', attribution: {} }))
      .toEqual({ name: 'Ana', email: 'ana@mail.com', quantity: 2, payment_method: 'lightning', idempotency_key: KEY, coupon_code: 'X' });
    for (const bad of [null, 'x', {}, { name: 'A', email: 'nope', quantity: 1, idempotency_key: KEY }, { name: '', email: 'a@b.co', quantity: 1, idempotency_key: KEY },
      { name: 'A', email: 'a@b.co', quantity: 0, idempotency_key: KEY }, { name: 'A', email: 'a@b.co', quantity: 11, idempotency_key: KEY },
      { name: 'A', email: 'a@b.co', quantity: 1.5, idempotency_key: KEY }, { name: 'A', email: 'a@b.co', quantity: 1, idempotency_key: 'k' }]) {
      expect(registerBody(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it('claims only with a hex hash and preimage', () => {
    expect(claimBody({ payment_hash: HASH.toUpperCase(), preimage: 'b'.repeat(64), extra: 1 })).toEqual({ payment_hash: HASH, preimage: 'b'.repeat(64) });
    expect(claimBody({ payment_hash: 'zz', preimage: 'b'.repeat(64) })).toBeNull();
  });

  it('asks the fixed upstream and passes its status and JSON through', async () => {
    const f = upstream(200, { spotsLeft: 105 });
    const { out, json } = await call('GET', '/api/lacrypta-tickets/checkout-state', undefined, f);
    expect(f).toHaveBeenCalledWith(TICKETS_UPSTREAM + 'checkout-state', expect.objectContaining({ method: 'GET' }));
    expect(out.status).toBe(200);
    expect(out.headers['cache-control']).toBe('no-store');
    expect(json).toEqual({ spotsLeft: 105 });
    const err = await call('POST', '/api/lacrypta-tickets/claim', { payment_hash: HASH, preimage: HASH }, upstream(402, { error: 'not paid' }));
    expect(err.out.status).toBe(402);
    expect(err.json).toEqual({ error: 'not paid' });
  });

  it('sends only the rebuilt body, no client headers', async () => {
    const f = upstream(200, { bolt11: 'lnbc1', payment_hash: HASH, amount_sats: 1 });
    await call('POST', '/api/lacrypta-tickets/register', { name: 'A', email: 'a@b.co', quantity: 1, idempotency_key: KEY, payment_method: 'mercadopago' }, f);
    const [, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ name: 'A', email: 'a@b.co', quantity: 1, payment_method: 'lightning', idempotency_key: KEY });
    expect(Object.keys(init.headers as object).sort()).toEqual(['accept', 'content-type']);
  });

  it('refuses wrong methods, bad hashes, bad bodies and broken upstreams', async () => {
    expect((await call('POST', '/api/lacrypta-tickets/checkout-state')).out.status).toBe(405);
    expect((await call('GET', '/api/lacrypta-tickets/register')).out.status).toBe(405);
    expect((await call('GET', '/api/lacrypta-tickets/payment-status?payment_hash=../x')).out.status).toBe(400);
    expect((await call('POST', '/api/lacrypta-tickets/register', '{not json')).out.status).toBe(400);
    expect((await call('GET', '/api/lacrypta-tickets/nope')).out.status).toBe(404);
    const html = vi.fn(async () => new Response('<html>', { status: 500 }));
    expect((await call('GET', '/api/lacrypta-tickets/checkout-state', undefined, html)).out.status).toBe(502);
    const down = vi.fn(async () => { throw new Error('down'); });
    expect((await call('GET', `/api/lacrypta-tickets/payment-status?payment_hash=${HASH}`, undefined, down)).out.status).toBe(502);
  });

  it('keeps a per-IP budget', async () => {
    const f = upstream(200, {});
    let last = 0;
    for (let i = 0; i < 21; i++) {
      const { res, out } = fakeRes();
      await handleTickets(fakeReq('POST', { name: 'A', email: 'a@b.co', quantity: 1, idempotency_key: KEY }, '9.9.9.9'), res, new URL('/api/lacrypta-tickets/register', 'http://x'), f as unknown as typeof fetch);
      last = out.status;
    }
    expect(last).toBe(429);
  });
});
