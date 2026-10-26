import { describe, it, expect, vi } from 'vitest';
import { HalloweenChat, norm, topicOf, type ChatDeps, type Line } from './halloweenChat';
import { FALLBACK_SALE, type Checkout, type SaleInfo } from './halloween';
import { HALLOWEEN_WORDS } from './halloweenWords';

const SALE: SaleInfo = { ...FALLBACK_SALE, spotsLeft: 105, couponOff: 30 };
const es = HALLOWEEN_WORDS.es;
const text = (l: Line) => ('say' in l ? l.say(es) : l.from === 'me' ? l.text ?? l.chip : `[${'card' in l ? l.card : ''}]`);
const last = (c: HalloweenChat) => text(c.lines[c.lines.length - 1]);

function chat(sale: SaleInfo = SALE) {
  const register = vi.fn();
  const deps: ChatDeps = { sale: () => sale, register, reset: vi.fn(), known: () => ({ name: 'Satoshi', email: '' }) };
  const c = new HalloweenChat(deps);
  c.start();
  return { c, register };
}

describe('talking to La Crypta', () => {
  it('reads typed questions in Spanish or English, accents or not', () => {
    expect(norm('¿Cuándo ES?')).toMatch(/cuando es/);
    expect(topicOf('¿Cuándo es la fiesta?')).toBe('when');
    expect(topicOf('donde queda')).toBe('where');
    expect(topicOf('cuanto sale?')).toBe('price');
    expect(topicOf('how much is it')).toBe('price');
    expect(topicOf('quiero comprar entradas')).toBe('buy');
    expect(topicOf('se puede pagar con mercadopago?')).toBe('pay');
    expect(topicOf('hay concurso de disfraces')).toBe('costume');
    expect(topicOf('que hay? musica?')).toBe('what');
    expect(topicOf('hola!')).toBe('hi');
    expect(topicOf('asdfgh')).toBeNull();
  });

  it('greets with the party and answers taps and typing', () => {
    const { c } = chat();
    expect(c.lines.map(text)).toEqual([es.greet, '[event]', es.menu]);
    expect(c.chips()).toEqual(['buy', 'when', 'where', 'price', 'pay', 'what', 'costume']);
    c.pick('when');
    expect(last(c)).toBe(es.when);
    c.say('cuánto sale?');
    expect(c.lines.map(text)).toContain(es.priceCoupon(60000, 33180, 21, 'LLOPO', 30));
    expect(last(c)).toBe(es.spots(105));
    c.say('qwerty');
    expect(last(c)).toBe(es.noIdea);
  });

  it('asks name, email and how many, checks each, then registers', () => {
    const { c, register } = chat();
    c.say('quiero entradas');
    expect(c.mode).toBe('name');
    expect(c.chips()).toEqual(['fill:Satoshi', 'cancel']);
    c.pick('fill:Satoshi');
    expect(c.mode).toBe('email');
    expect(c.input()).toBe('email');
    c.say('no-es-un-mail');
    expect(last(c)).toBe(es.badEmail);
    c.say('Sat@Example.com');
    expect(c.mode).toBe('qty');
    c.say('11');
    expect(last(c)).toBe(es.badQty(10));
    c.say('2 entradas');
    expect(c.mode).toBe('confirm');
    expect(c.lines.map(text)).toContain(es.confirm(2, 'Satoshi', 'sat@example.com', 66360));
    expect(c.engaged).toBe(true);
    c.say('dale');
    expect(register).toHaveBeenCalledWith({ name: 'Satoshi', email: 'sat@example.com', quantity: 2 });
    expect(c.mode).toBe('busy');
  });

  it('turns the checkout into messages: invoice, paid, tickets', () => {
    const { c } = chat();
    c.pick('buy'); c.say('Ana'); c.say('ana@x.co'); c.pick('qty:1'); c.pick('yes');
    const sale = SALE;
    const inv: Checkout = { kind: 'invoice', sale, bolt11: 'lnbc1', hash: 'h', sats: 9000, quantity: 1, walletPaying: false, walletPaid: false };
    c.onCheckout({ kind: 'submitting', sale });
    c.onCheckout(inv);
    c.onCheckout(inv);
    c.onCheckout({ ...inv, walletPaid: true });
    c.onCheckout({ kind: 'confirmed', sale, codes: ['HW-1'], total: 1 });
    const tail = c.lines.slice(-6).map(text);
    expect(tail).toEqual([es.creating, es.invoice(9000), '[invoice]', es.paid, es.done(1), '[tickets]']);
    expect(c.mode).toBe('chat');
    expect(c.engaged).toBe(false);
    expect(c.chips()[0]).toBe('buyMore');
  });

  it('offers a retry after an error, and cancel goes back to talking', () => {
    const { c } = chat();
    c.pick('buy'); c.say('Ana'); c.say('ana@x.co'); c.pick('qty:1'); c.pick('yes');
    c.onCheckout({ kind: 'error', sale: SALE, message: 'network', canRetry: true });
    expect(last(c)).toBe(es.errNetwork);
    expect(c.chips()).toEqual(['retry', 'cancel']);
    c.pick('cancel');
    expect(c.mode).toBe('chat');
    expect(last(c)).toBe(es.cancelled);
  });

  it('says so when tickets are gone', () => {
    const { c } = chat({ ...SALE, full: true });
    c.pick('buy');
    expect(last(c)).toBe(es.closed);
    expect(c.mode).toBe('chat');
  });
});
