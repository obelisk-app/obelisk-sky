// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, waitFor } from '@testing-library/react';
import { renderInvitePanel, type InvitePanelDeps } from './invitePanel';
import { VILLAGE_WORDS } from '../i18n/village';
import type { InviteStatus } from '../nostr/invite';

const ME: InviteStatus = {
  can_mint: true, is_admin: false, codes_left: 2, admits_left: 5,
  codes: [
    { code: 'live', status: 'active', max_uses: 10, uses: 3, expires_at: 2e9, redemptions: [{ pubkey: 'a', at: 1 }] },
    { code: 'done', status: 'exhausted', max_uses: 1, uses: 1, expires_at: 2e9, redemptions: [{ pubkey: 'b', at: 1 }] },
  ],
};

function deps(over: Partial<InvitePanelDeps> = {}): InvitePanelDeps {
  return {
    relayHost: 'public.obelisk.ar',
    load: vi.fn(async () => ME),
    create: vi.fn(async () => ({ ...ME.codes[0], code: 'new' })),
    linkFor: (code) => `https://sky.obelisk.ar/invite/${code}`,
    copy: vi.fn(),
    toast: vi.fn(),
    ...over,
  };
}

describe('invite panel', () => {
  it('shows the quota and each live link as its code with one Copy link', async () => {
    const body = document.createElement('div');
    const d = deps();
    await renderInvitePanel(body, d);
    expect(body.textContent).toContain('5 people');
    expect(body.textContent).toContain('3 of 10 used');
    const row = body.querySelector('[data-code="live"]')!;
    expect(row.querySelector('code')!.textContent).toBe('live');
    const buttons = row.querySelectorAll('button');
    expect([...buttons].map((b) => b.textContent)).toEqual([VILLAGE_WORDS.en.invite.copy]);
    fireEvent.click(buttons[0]);
    expect(d.copy).toHaveBeenCalledWith('https://sky.obelisk.ar/invite/live');
    expect(body.querySelector('[data-code="done"]')).toBeNull();
  });

  it('creates a link and copies it at once', async () => {
    const body = document.createElement('div');
    const d = deps();
    await renderInvitePanel(body, d);
    fireEvent.click(body.querySelector('[data-testid="invite-create"]')!);
    await waitFor(() => expect(d.copy).toHaveBeenCalledWith('https://sky.obelisk.ar/invite/new'));
    expect(d.toast).toHaveBeenCalledWith(VILLAGE_WORDS.en.invite.copied);
  });

  it('speaks Spanish', async () => {
    const body = document.createElement('div');
    await renderInvitePanel(body, deps(), VILLAGE_WORDS.es);
    expect(body.textContent).toContain('Invitar personas');
    expect(body.textContent).toContain('3 de 10 usados');
  });
});
