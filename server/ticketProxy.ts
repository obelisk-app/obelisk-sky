// /api/lacrypta-tickets/*: La Crypta's Halloween 5 checkout, same-origin.
// The NPC at La Crypta's door sells tickets (client/src/ui/ticketDialog.ts),
// but La Crypta's ticket API (halloween.lacrypta.ar) sends no CORS, so the
// browser asks here and we ask them. Nothing is kept and no key is held.
//
// Four routes only, against one fixed upstream (the client never picks it):
//   GET  checkout-state                       price, spots left, discounts
//   POST register                             name, email, quantity → a Lightning invoice
//   GET  payment-status?payment_hash=<hex>    polled until paid
//   POST claim                                payment_hash + preimage → the tickets
//   POST coupons/check                        is a discount code good (it creates nothing)
// Bodies are rebuilt from known fields (no cookies, no client headers go
// out), capped, timed out, and every route has its own per-IP budget.

import type { IncomingMessage, ServerResponse } from 'node:http';

export const TICKETS_PREFIX = '/api/lacrypta-tickets/';
export const TICKETS_UPSTREAM = 'https://halloween.lacrypta.ar/api/events/by-slug/halloween-5-fiesta-de-disfraces/';
const MAX_BODY = 4096;
const TIMEOUT_MS = 10_000;
export const MAX_TICKETS = 10;

const HEX64 = /^[0-9a-f]{64}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COUPON = /^[A-Z0-9_-]{1,32}$/;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

type Route = 'checkout-state' | 'register' | 'payment-status' | 'claim' | 'coupons/check';
const METHOD: Record<Route, 'GET' | 'POST'> = { 'checkout-state': 'GET', register: 'POST', 'payment-status': 'GET', claim: 'POST', 'coupons/check': 'POST' };
/** Requests per IP per 10 minutes: polling every 2.5 s for a while is fine, registering a hundred times is not. */
const BUDGET: Record<Route, number> = { 'checkout-state': 120, register: 20, 'payment-status': 600, claim: 30, 'coupons/check': 60 };
const WINDOW_MS = 10 * 60_000;
const hits = new Map<string, { count: number; resetAt: number }>();

export function ticketRoute(pathname: string): Route | null {
  if (!pathname.startsWith(TICKETS_PREFIX)) return null;
  const r = pathname.slice(TICKETS_PREFIX.length);
  return Object.hasOwn(METHOD, r) ? (r as Route) : null;
}

/** What goes to La Crypta for a register: only these fields, checked. */
export function registerBody(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object') return null;
  const b = raw as Record<string, unknown>;
  const name = typeof b.name === 'string' ? b.name.trim().slice(0, 120) : '';
  const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
  const quantity = b.quantity;
  if (!name || !EMAIL.test(email) || email.length > 254) return null;
  if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1 || quantity > MAX_TICKETS) return null;
  if (typeof b.idempotency_key !== 'string' || !UUID.test(b.idempotency_key)) return null;
  if (b.coupon_code !== undefined && (typeof b.coupon_code !== 'string' || !COUPON.test(b.coupon_code))) return null;
  return { name, email, quantity, payment_method: 'lightning', idempotency_key: b.idempotency_key, ...(b.coupon_code ? { coupon_code: b.coupon_code } : {}) };
}

export function couponBody(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object') return null;
  const b = raw as Record<string, unknown>;
  if (typeof b.code !== 'string' || !COUPON.test(b.code)) return null;
  const q = b.quantity;
  if (typeof q !== 'number' || !Number.isInteger(q) || q < 1 || q > MAX_TICKETS) return null;
  return { code: b.code, quantity: q, payment_method: 'lightning' };
}

export function claimBody(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object') return null;
  const b = raw as Record<string, unknown>;
  if (typeof b.payment_hash !== 'string' || !HEX64.test(b.payment_hash)) return null;
  if (typeof b.preimage !== 'string' || !HEX64.test(b.preimage)) return null;
  return { payment_hash: b.payment_hash.toLowerCase(), preimage: b.preimage.toLowerCase() };
}

function limited(key: string, max: number): boolean {
  const now = Date.now();
  const e = hits.get(key);
  if (!e || now > e.resetAt) {
    hits.set(key, { count: 1, resetAt: now + WINDOW_MS });
    if (hits.size > 5_000) for (const [k, v] of hits) if (now > v.resetAt) hits.delete(k);
    return false;
  }
  return ++e.count > max;
}

function clientIp(req: IncomingMessage): string {
  const h = (k: string) => { const v = req.headers[k]; return Array.isArray(v) ? v[0] : v; };
  return h('cf-connecting-ip') ?? h('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    let size = 0;
    const parts: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) { resolve(undefined); req.destroy(); return; }
      parts.push(c);
    });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(parts).toString('utf8'))); } catch { resolve(undefined); } });
    req.on('error', () => resolve(undefined));
  });
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(body));
}

export async function handleTickets(req: IncomingMessage, res: ServerResponse, url: URL, fetchFn: typeof fetch = fetch): Promise<void> {
  const route = ticketRoute(url.pathname);
  if (!route) { send(res, 404, { error: 'not found' }); return; }
  if (req.method !== METHOD[route]) { res.writeHead(405, { allow: METHOD[route] }).end(); return; }
  if (limited(`${route}:${clientIp(req)}`, BUDGET[route])) { send(res, 429, { error: 'too many requests' }); return; }

  let target = TICKETS_UPSTREAM + route;
  let body: Record<string, unknown> | null = null;
  if (route === 'checkout-state') {
    // no body
  } else if (route === 'payment-status') {
    const hash = url.searchParams.get('payment_hash') ?? '';
    if (!HEX64.test(hash)) { send(res, 400, { error: 'bad payment_hash' }); return; }
    target += `?payment_hash=${hash.toLowerCase()}`;
  } else {
    const raw = await readJson(req);
    body = route === 'register' ? registerBody(raw) : route === 'claim' ? claimBody(raw) : couponBody(raw);
    if (!body) { send(res, 400, { error: 'bad request' }); return; }
  }

  try {
    const r = await fetchFn(target, {
      method: METHOD[route],
      headers: body ? { 'content-type': 'application/json', accept: 'application/json' } : { accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await r.text();
    let json: unknown;
    try { json = JSON.parse(text); } catch { send(res, 502, { error: 'bad upstream response' }); return; }
    send(res, r.status, json);
  } catch {
    send(res, 502, { error: 'upstream unreachable' });
  }
}
