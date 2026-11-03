// @vitest-environment jsdom
// The village's panels drawn in Spanish: modules read the language once, at
// import, so this file runs them with the language set to Spanish.
import { describe, it, expect, vi } from 'vitest';

vi.mock('../i18n/lang', async (orig) => ({ ...(await orig<typeof import('../i18n/lang')>()), lang: 'es' }));

const { SidePanel } = await import('./sidePanel');
const { openRelayModal } = await import('./relayModal');
const { openZapSheet } = await import('./zapSheet');
const { EmoteMenu } = await import('./emoteMenu');
const { WatchView } = await import('./theaterPanel');
const { vw } = await import('../i18n/village');
const { GamePanel } = await import('./gamePanel');
const { SPANS } = await import('./history');

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('the village in Spanish', () => {
  it('lists channels and members in Spanish', async () => {
    const host = document.createElement('div');
    const side = new SidePanel(host, {
      channels: () => [{ id: 'a', name: 'general', kind: 'chat', unread: 0, mention: false, here: 2 }],
      layout: () => ({ categories: [], channels: [], updatedAt: 0 }),
      defaultChannel: () => 'a',
      loadMembers: async () => ({ admins: [], members: ['p1', 'p2'] }),
      posters: () => [],
      loadRanks: async () => ({}),
      presenceOf: (pk) => (pk === 'p1' ? 'online' : 'offline'),
      whereIs: (pk) => (pk === 'p1' ? 'dando vueltas' : null),
      profile: (pk) => ({ name: pk, avatar: null, nip05: null }),
      colorOf: () => '#fff',
      me: () => 'p1',
      onChannel: () => {},
      onMember: () => {},
    });
    side.toggle('channels');
    expect(host.textContent).toContain('Canales · 1');
    expect(host.textContent).toContain('2 acá');
    side.toggle('members');
    await flush();
    expect(host.textContent).toContain('Miembros · 2');
    // One list, no sections: the connected member's row says where they stand.
    expect(host.querySelectorAll('.side-row.member')).toHaveLength(2);
    expect(host.querySelector('.side-where')?.textContent).toBe('dando vueltas');
    expect(host.textContent).toContain('p1 (vos)');
  });

  it('opens the relay switcher in Spanish', () => {
    const root = document.createElement('div');
    openRelayModal(root, {
      active: () => 'wss://public.obelisk.ar', relays: () => ['wss://public.obelisk.ar'], custom: () => [],
      addRelay: () => {}, removeRelay: () => {}, switchTo: () => {}, groups: () => [],
      categories: () => ({ names: {}, of: {} }), unread: () => 0, goTo: () => {},
    });
    expect(root.textContent).toContain('Estás acá');
    expect(root.textContent).toContain('Canales en public.obelisk.ar');
    expect(root.querySelector('input')!.placeholder).toBe('Agregá un relay: wss://…');
  });

  it('draws the zap sheet in Spanish', () => {
    openZapSheet(document.body, 'b'.repeat(64), 21, {
      name: () => 'Ana', lud16: () => null, walletKind: () => null, walletView: () => null,
      connect: async () => {}, send: async () => ({ markerError: null }), isUnconfirmed: () => false, toast: () => {},
    });
    const sheet = document.querySelector('.zap-sheet')!;
    expect(sheet.textContent).toContain('⚡ Zap a Ana');
    expect(sheet.textContent).toContain('Conectá una billetera Lightning');
    expect(sheet.textContent).toContain('No tiene una dirección Lightning');
    sheet.remove();
  });

  it('names the emotes in Spanish', () => {
    const root = document.createElement('div');
    new EmoteMenu(root, { pick: () => {}, current: () => null });
    expect(root.textContent).toContain('Bailar');
    expect(root.textContent).toContain('Loto');
    expect(root.textContent).not.toContain('Jumping jacks');
  });

  it('explains the theater in Spanish', () => {
    const w = new WatchView(() => {});
    w.show(null, [vw.cine, vw.nobodySharing]);
    expect(w.el.textContent).toContain('Nadie comparte todavía');
    expect(w.el.textContent).toContain('Volver a la aldea');
    w.close();
  });

  it('shows a missing game table in Spanish', () => {
    const root = document.createElement('div');
    const p = new GamePanel(root, {
      me: () => null, nameOf: (pk) => pk, session: () => null, join: () => {}, start: () => {}, move: () => {},
      resign: () => {}, cancel: () => {}, claimTimeout: () => {}, appLink: () => '',
    });
    p.open('x');
    expect(root.textContent).toContain('Mesa de juego');
    expect(root.textContent).toContain('todavía está cargando');
    p.close();
  });

  it('labels the history spans in Spanish', () => {
    expect(SPANS.map((s) => s.label)).toEqual(['24 h', '7 días', '30 días']);
  });
});
