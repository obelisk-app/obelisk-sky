// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, waitFor } from '@testing-library/react';
import { renderInvitePanel, type InvitePanelDeps } from './invitePanel';
import { VILLAGE_WORDS } from '../i18n/village';
import type { InviteStatus } from '../nostr/invite';

const PUBLIC = 'wss://public.obelisk.ar';
const CRYPTA = 'wss://lacrypta-relay.obelisk.ar';
const A = 'a'.repeat(64);
const B = 'b'.repeat(64);

const ME: InviteStatus = {
  basis: 'reference', admits_total: 10, admits_used: 3, admits_left: 7, codes_left: null,
  can_mint: true, is_admin: false,
  invited_by: { code: 'x', pubkey: B, at: 1 },
  grant: null,
  codes: [
    { code: 'live', label: 'meetup', status: 'active', max_uses: 5, uses: 2, expires_at: 2e9, created_at: 1,
      redemptions: [{ pubkey: A, at: 1.79e9 }, { pubkey: B, at: 1.79e9, evicted_at: 1.791e9 }] },
    { code: 'done', status: 'exhausted', max_uses: 1, uses: 1, expires_at: 2e9, redemptions: [{ pubkey: B, at: 1 }] },
  ],
};

const NOBODY: InviteStatus = { basis: null, admits_total: 0, admits_used: 0, admits_left: 0, codes_left: 0, can_mint: false, is_admin: false, codes: [] };

function deps(over: Partial<InvitePanelDeps> = {}): InvitePanelDeps {
  return {
    relays: [PUBLIC, CRYPTA],
    relay: PUBLIC,
    load: vi.fn(async (relay: string) => (relay === PUBLIC ? ME : NOBODY)),
    create: vi.fn(async () => ({ ...ME.codes[0], code: 'new' })),
    revoke: vi.fn(async () => undefined),
    linkFor: (code, relay) => `https://sky.obelisk.ar/invite/${code}?relay=${relay.replace('wss://', '')}`,
    copy: vi.fn(async () => true),
    share: null,
    nameOf: (pk) => (pk === A ? 'Ana' : pk === B ? 'Beto' : 'npub1…'),
    toast: vi.fn(),
    ...over,
  };
}

const en = VILLAGE_WORDS.en.invite;

describe('invite panel', () => {
  it('says which relay, why you may invite, what is left, and who invited you', async () => {
    const body = document.createElement('div');
    await renderInvitePanel(body, deps());
    const picker = body.querySelector('[data-testid="invite-relay"]') as HTMLSelectElement;
    expect(picker.value).toBe(PUBLIC);
    expect([...picker.options].map((o) => o.textContent)).toEqual(['public.obelisk.ar', 'lacrypta-relay.obelisk.ar']);
    expect(body.textContent).toContain(en.basis.reference('public.obelisk.ar'));
    expect(body.textContent).toContain('7 of 10 left');
    expect(body.textContent).toContain('Invited by Beto');
    const many = body.querySelector('input[name="max_uses"]') as HTMLInputElement;
    expect(many.value).toBe('7');
    expect(many.max).toBe('7');
    expect((body.querySelector('input[name="days"]') as HTMLInputElement).value).toBe('7');
  });

  it('switches relay in place: loads that relay and explains who can invite there', async () => {
    const body = document.createElement('div');
    const d = deps();
    await renderInvitePanel(body, d);
    const picker = body.querySelector('[data-testid="invite-relay"]') as HTMLSelectElement;
    picker.value = CRYPTA;
    fireEvent.change(picker);
    await waitFor(() => expect(body.textContent).toContain(en.basis.none));
    expect(d.load).toHaveBeenLastCalledWith(CRYPTA);
    expect(body.querySelector('[data-testid="invite-create"]')).toBeNull();
    // Created links are for the picked relay.
    picker.value = PUBLIC;
    fireEvent.change(picker);
    await waitFor(() => expect(body.querySelector('[data-testid="invite-create"]')).not.toBeNull());
  });

  it('lists each link with uses, who joined (removed ones marked), and folds past links', async () => {
    const body = document.createElement('div');
    await renderInvitePanel(body, deps());
    const row = body.querySelector('[data-code="live"]')!;
    expect(row.textContent).toContain('meetup');
    expect(row.textContent).toContain('2 of 5 used');
    const people = [...row.querySelectorAll('.invite-person')];
    expect(people.map((p) => p.querySelector('.invite-person-name')!.textContent)).toEqual(['Ana', 'Beto']);
    expect(people[1].classList.contains('removed')).toBe(true);
    expect(people[1].textContent).toContain(en.removed);
    const past = body.querySelector('details.invite-past')!;
    expect(past.querySelector('summary')!.textContent).toBe(en.pastLinks(1));
    expect(past.querySelector('[data-code="done"]')!.textContent).toContain(en.state.exhausted);
    expect(past.querySelector('[data-act="turn-off"]')).toBeNull();
  });

  it('turns a link off only after the inline confirm', async () => {
    const body = document.createElement('div');
    const d = deps();
    await renderInvitePanel(body, d);
    const row = () => body.querySelector('[data-code="live"]')!;
    fireEvent.click(row().querySelector('[data-act="turn-off"]')!);
    expect(row().textContent).toContain(en.turnOffAsk);
    fireEvent.click(row().querySelector('[data-act="cancel-off"]')!);
    expect(d.revoke).not.toHaveBeenCalled();
    expect(row().querySelector('[data-act="turn-off"]')).not.toBeNull();
    fireEvent.click(row().querySelector('[data-act="turn-off"]')!);
    fireEvent.click(row().querySelector('[data-act="confirm-off"]')!);
    await waitFor(() => expect(d.revoke).toHaveBeenCalledWith(PUBLIC, 'live'));
    expect(d.toast).toHaveBeenCalledWith(en.turnedOff);
  });

  it('creates a link with the form, shows it with Copy and Share, and toasts copied only on success', async () => {
    const body = document.createElement('div');
    const share = vi.fn(async () => true);
    const copy = vi.fn(async () => false);
    const d = deps({ share, copy });
    await renderInvitePanel(body, d);
    (body.querySelector('input[name="label"]') as HTMLInputElement).value = 'party';
    (body.querySelector('input[name="max_uses"]') as HTMLInputElement).value = '50';
    fireEvent.submit(body.querySelector('form')!);
    await waitFor(() => expect(body.querySelector('[data-testid="invite-fresh"]')).not.toBeNull());
    expect(d.create).toHaveBeenCalledWith(PUBLIC, { label: 'party', max_uses: 7, expires_in: 7 * 86400 });
    expect(d.copy).not.toHaveBeenCalled();
    const fresh = body.querySelector('[data-testid="invite-fresh"]')!;
    expect((fresh.querySelector('input') as HTMLInputElement).value).toBe('https://sky.obelisk.ar/invite/new?relay=public.obelisk.ar');
    fireEvent.click(fresh.querySelector('[data-act="copy"]')!);
    await waitFor(() => expect(d.toast).toHaveBeenCalledWith(en.copyFailed));
    expect(d.toast).not.toHaveBeenCalledWith(en.copied);
    fireEvent.click(fresh.querySelector('[data-act="share"]')!);
    expect(share).toHaveBeenCalledWith('https://sky.obelisk.ar/invite/new?relay=public.obelisk.ar', en.shareText('public.obelisk.ar'));
  });

  it('caps the expiry at the grant and says when the allowance is spent', async () => {
    const body = document.createElement('div');
    const grant: InviteStatus = { ...ME, basis: 'grant', admits_total: 3, admits_left: 0, can_mint: false, grant: { max_ttl_secs: 3 * 86400 } };
    await renderInvitePanel(body, deps({ load: vi.fn(async () => grant) }));
    expect(body.textContent).toContain(en.basis.grant('public.obelisk.ar', 3));
    expect(body.textContent).toContain(en.spent);
    expect(body.querySelector('form')).toBeNull();
    const ok: InviteStatus = { ...grant, admits_left: 2, can_mint: true };
    const body2 = document.createElement('div');
    await renderInvitePanel(body2, deps({ load: vi.fn(async () => ok) }));
    const days = body2.querySelector('input[name="days"]') as HTMLInputElement;
    expect(days.max).toBe('3');
    expect(days.value).toBe('3');
  });

  it('shows a load failure with Retry and asks again', async () => {
    const body = document.createElement('div');
    const load = vi.fn().mockRejectedValueOnce(new Error('HTTP 502')).mockResolvedValue(ME);
    await renderInvitePanel(body, deps({ load }));
    expect(body.textContent).toContain(en.loadFailed('public.obelisk.ar'));
    fireEvent.click(body.querySelector('[data-testid="invite-retry"]')!);
    await waitFor(() => expect(body.querySelector('[data-code="live"]')).not.toBeNull());
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('speaks Spanish', async () => {
    const body = document.createElement('div');
    await renderInvitePanel(body, deps(), VILLAGE_WORDS.es);
    expect(body.textContent).toContain('Invitar personas');
    expect(body.textContent).toContain('Quedan 7 de 10');
    expect(body.textContent).toContain('2 de 5 usados');
    expect(body.textContent).toContain('Te invitó Beto');
  });
});
