// @vitest-environment jsdom
import { beforeEach, describe, it, expect, vi } from 'vitest';

vi.mock('qrcode', () => ({ default: { toCanvas: vi.fn(async () => {}) } }));
import { openTicketDialog, type TicketDialogDeps } from './ticketDialog';

const HASH = 'e'.repeat(64);
const STATE = { ended: false, full: false, spotsLeft: 7, priceAmount: 60000, paymentDiscounts: { lightning: 21 }, satsBack: { percent: 50 }, maxTicketsPerOrder: 10 };
const COUPON = { valid: true, code: 'LLOPO', discount_type: 'percent', discount_value: 30 };

function setup(route: (path: string, body: unknown) => unknown, payer: TicketDialogDeps['payer'] = async () => null) {
  document.body.innerHTML = '<aside id="card" class="card" hidden><div class="card-body"></div></aside>';
  const card = document.getElementById('card')!;
  const posted: { path: string; body: unknown }[] = [];
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const path = url.replace('/api/lacrypta-tickets/', '');
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    posted.push({ path, body });
    return new Response(JSON.stringify(route(path, body)), { status: 200 });
  });
  const dialog = openTicketDialog({
    card,
    openCard: (build) => { const b = card.querySelector('.card-body') as HTMLElement; b.replaceChildren(); build(b); card.hidden = false; },
    npc: () => ({ name: 'La Crypta', avatar: null }),
    buyerName: () => 'Satoshi',
    payer,
    toast: vi.fn(),
    fetch: fetch as unknown as typeof globalThis.fetch,
  });
  return { card, posted, dialog };
}

const text = (card: HTMLElement) => card.textContent ?? '';
const chip = (card: HTMLElement, label: RegExp) => [...card.querySelectorAll<HTMLElement>('.tk-chip')].find((b) => label.test(b.textContent ?? ''))!;
function type(card: HTMLElement, s: string) {
  const input = card.querySelector<HTMLInputElement>('.tk-input input')!;
  input.value = s;
  card.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
}
const base = (p: string) => (p === 'checkout-state' ? STATE : p === 'coupons/check' ? COUPON : null);

describe('the talk with La Crypta', () => {
  beforeEach(() => { localStorage.clear(); });

  it('speaks Spanish first, with the coupon price, and switches to English', async () => {
    const { card } = setup((p) => base(p) ?? {});
    expect(card.classList.contains('halloween')).toBe(true);
    expect(text(card)).toMatch(/¿Venís a nuestra fiesta/);
    await vi.waitFor(() => expect(text(card)).toMatch(/\$33\.180 ARS/));
    expect(text(card)).toMatch(/Cupón LLOPO \(−30%\)/);
    [...card.querySelectorAll('button')].find((b) => b.textContent === 'EN')!.click();
    expect(text(card)).toMatch(/Coming to our Halloween party/);
    expect(localStorage.getItem('obelisk-sky/halloween-lang')).toBe('"en"');
  });

  it('answers typed questions and keeps game keys out of the input', async () => {
    const { card } = setup((p) => base(p) ?? {});
    const input = card.querySelector<HTMLInputElement>('.tk-input input')!;
    const seen = vi.fn();
    window.addEventListener('keydown', seen);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', bubbles: true }));
    expect(seen).not.toHaveBeenCalled();
    type(card, '¿dónde queda?');
    expect(text(card)).toMatch(/Villanueva 1367, CABA \(Belgrano\)/);
    expect(input.value).toBe('');
  });

  it('sells tickets by talking: the right keyboard for each question, the coupon in the order', async () => {
    let paid = false;
    const { card, posted, dialog } = setup((p) => base(p) ?? (p === 'register'
      ? { status: 'awaiting_payment', bolt11: 'lnbc10n1test', payment_hash: HASH, amount_sats: 18000 }
      : p.startsWith('payment-status') ? (paid ? { status: 'paid', ticket_codes: ['HW-1', 'HW-2'], total_tickets: 2 } : { status: 'pending' }) : {}));
    await vi.waitFor(() => expect(text(card)).toMatch(/33\.180/));
    chip(card, /Comprar entradas/).click();
    const input = card.querySelector<HTMLInputElement>('.tk-input input')!;
    expect(input.autocomplete).toBe('name');
    chip(card, /^Satoshi$/).click();
    expect(input.type).toBe('email');
    expect(input.inputMode).toBe('email');
    type(card, 'sat@example.com');
    expect(input.inputMode).toBe('numeric');
    expect(dialog.engaged).toBe(true);
    chip(card, /^2$/).click();
    expect(text(card)).toMatch(/2 entradas a nombre de Satoshi/);
    chip(card, /Sí, generá la factura/).click();
    await vi.waitFor(() => expect(card.querySelector('.tk-qr')).not.toBeNull());
    expect(posted.find((x) => x.path === 'register')?.body).toMatchObject({ name: 'Satoshi', email: 'sat@example.com', quantity: 2, coupon_code: 'LLOPO' });
    expect((card.querySelector('a.tk-qr-link') as HTMLAnchorElement).href).toBe('lightning:lnbc10n1test');
    paid = true;
    await vi.waitFor(() => expect(text(card)).toMatch(/HW-2/), { timeout: 4000 });
    expect(text(card)).toMatch(/Tenés 2 entradas/);
    expect(dialog.engaged).toBe(true); // still typing
    input.blur();
    expect(dialog.engaged).toBe(false);
    expect(JSON.parse(localStorage.getItem('obelisk-sky/halloween-buyer')!)).toEqual({ name: 'Satoshi', email: 'sat@example.com' });
  });

  it('pays from the wallet once and lets go when the card closes', async () => {
    const pay = vi.fn(async () => ({ preimage: 'f'.repeat(64) }));
    const { card, posted } = setup((p) => base(p) ?? (p === 'register'
      ? { status: 'awaiting_payment', bolt11: 'lnbc1w', payment_hash: HASH, amount_sats: 9000 }
      : p === 'claim' ? { status: 'paid', ticket_code: 'W-1' } : { status: 'pending' }), async () => ({ kind: 'nwc', pay }));
    await vi.waitFor(() => expect(text(card)).toMatch(/33\.180/));
    chip(card, /Comprar entradas/).click();
    type(card, 'Ana');
    type(card, 'a@b.co');
    type(card, '1');
    type(card, 'si');
    await vi.waitFor(() => expect(chip(card, /Pagar con mi billetera/)).toBeDefined());
    chip(card, /Pagar con mi billetera/).click();
    await vi.waitFor(() => expect(text(card)).toMatch(/W-1/));
    expect(pay).toHaveBeenCalledTimes(1);
    expect(posted.find((x) => x.path === 'claim')?.body).toEqual({ payment_hash: HASH, preimage: 'f'.repeat(64) });
    expect(card.querySelector('.tk-invoice .tk-chip')).toBeNull();
    card.hidden = true;
    await new Promise((r) => setTimeout(r, 0));
    expect(card.classList.contains('halloween')).toBe(false);
  });

  it('counts as closed the moment the card hides, and a click on La Crypta brings the same talk back', async () => {
    const { card, dialog } = setup((p) => base(p) ?? {});
    expect(dialog.open).toBe(true);
    expect(dialog.talked).toBe(false);
    type(card, 'hola');
    expect(dialog.talked).toBe(true);
    card.hidden = true; // a tap on the world
    expect(dialog.open).toBe(false);
    expect(dialog.reopen()).toBe(true);
    expect(dialog.open).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(text(card)).toMatch(/hola/);
    card.hidden = true;
    await new Promise((r) => setTimeout(r, 0)); // the observer lets go
    expect(dialog.reopen()).toBe(false);
  });
});
