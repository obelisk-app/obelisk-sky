// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { SidePanel, type SidePanelDeps } from './sidePanel';

const flush = () => new Promise((r) => setTimeout(r, 0));

function panel(over: Partial<SidePanelDeps> = {}) {
  const deps: SidePanelDeps = {
    channels: () => [
      { id: 'a', name: 'general', kind: 'chat', unread: 0, mention: false, here: 0 },
      { id: 'b', name: 'gym', kind: 'chat', unread: 0, mention: false, here: 0 },
    ],
    layout: () => ({ categories: [], channels: [], updatedAt: 0 }),
    defaultChannel: () => 'a',
    loadMembers: vi.fn(async (id: string) => ({ admins: [], members: id === 'a' ? ['p1'] : ['p2', 'p3'] })),
    posters: () => [],
    loadRanks: async () => ({}),
    presenceOf: () => 'online',
    profile: (pk) => ({ name: pk, avatar: null, nip05: null }),
    colorOf: () => '#fff',
    me: () => null,
    onChannel: () => {},
    onMember: () => {},
    ...over,
  };
  const host = document.createElement('div');
  document.body.append(host);
  return { side: new SidePanel(host, deps), deps, host };
}

describe('the members panel', () => {
  it('lists connected and disconnected people together, with where the connected ones stand', async () => {
    const presence: Record<string, 'online' | 'afk' | 'offline'> = { p2: 'offline', p3: 'online', p4: 'afk' };
    const { side, host } = panel({
      defaultChannel: () => 'b',
      loadMembers: vi.fn(async () => ({ admins: [], members: ['p2', 'p3', 'p4'] })),
      presenceOf: (pk) => presence[pk] ?? 'offline',
      whereIs: (pk) => (pk === 'p3' ? 'gym' : pk === 'p4' ? 'around' : 'should not show'),
    });
    side.toggle('members');
    await vi.waitFor(() => expect(host.querySelectorAll('.side-row.member')).toHaveLength(3));
    expect(host.querySelectorAll('.side-section')).toHaveLength(0);
    const rows = [...host.querySelectorAll('.side-row.member')];
    expect(rows.map((r) => r.querySelector('.side-name')?.textContent)).toEqual(['p3', 'p4', 'p2']);
    expect(rows.map((r) => r.querySelector('.side-where')?.textContent ?? null)).toEqual(['gym', 'around', null]);
  });

  it('keeps the same channel picker across refreshes', async () => {
    const { side, host } = panel();
    side.toggle('members');
    await flush();
    const pick = host.querySelector('select')!;
    const rows = host.querySelector('.side-list')!.firstElementChild;
    for (let i = 0; i < 3; i++) { side.refresh(); await flush(); }
    expect(host.querySelector('select')).toBe(pick);
    // Nothing changed: the rows weren't redrawn either.
    expect(host.querySelector('.side-list')!.firstElementChild).toBe(rows);
  });

  it('does not touch the picker while it is open', async () => {
    const { side, host, deps } = panel();
    side.toggle('members');
    await flush();
    const pick = host.querySelector('select')!;
    pick.focus();
    (deps.loadMembers as ReturnType<typeof vi.fn>).mockClear();
    side.refresh();
    await flush();
    expect(deps.loadMembers).not.toHaveBeenCalled();
  });

  it('loads the channel picked', async () => {
    const { side, host } = panel();
    side.toggle('members');
    await flush();
    const pick = host.querySelector('select')!;
    pick.value = 'b';
    pick.dispatchEvent(new Event('change'));
    expect(host.querySelector('.side-list')!.textContent).toContain('Loading');
    await flush();
    expect(host.querySelector('.side-title')!.textContent).toBe('Members · 2');
    expect(pick.value).toBe('b');
  });
});

describe('the channel list', () => {
  const layout = {
    categories: [{ id: 'c1', name: 'Fitness', position: 0 }, { id: 'c2', name: '', position: 1 }],
    channels: [{ id: 'b', categoryId: 'c1', position: 0 }],
    updatedAt: 1,
  };

  it('groups channels under the operator\'s categories, the rest under Uncategorized', () => {
    const { side, host } = panel({ layout: () => layout });
    side.toggle('channels');
    const cats = [...host.querySelectorAll('.side-cat-name')].map((e) => e.textContent);
    expect(cats).toEqual(['Fitness', 'Untitled category', 'Uncategorized']);
    const names = [...host.querySelectorAll('.side-list > *')].map((e) => e.querySelector('.side-cat-name, .side-name')!.textContent);
    expect(names).toEqual(['Fitness', 'gym', 'Untitled category', 'Uncategorized', 'general']);
  });

  it('folds a category on a click', () => {
    const { side, host } = panel({ layout: () => layout });
    side.toggle('channels');
    (host.querySelector('.side-cat') as HTMLButtonElement).click();
    expect([...host.querySelectorAll('.side-name')].map((e) => e.textContent)).toEqual(['general']);
  });

  it('leaves the list unheaded when there are no categories, and stands where the chat sits', () => {
    const { side, host } = panel();
    side.toggle('channels');
    expect(host.querySelector('.side-cat')).toBeNull();
    expect(side.el.classList.contains('at-chat')).toBe(true);
    expect(document.body.classList.contains('channels-open')).toBe(true);
    side.close();
    expect(document.body.classList.contains('channels-open')).toBe(false);
  });

  it('draws a rank as obelisk-dex does: its colour on a tint of itself', async () => {
    const { side, host } = panel({ loadRanks: async () => ({ p1: [{ id: 'mod', name: 'Mod', tier: 5, color: '#ff0000', emoji: '' }] }) });
    side.toggle('members');
    await flush(); await flush();
    const badge = host.querySelector('.side-rank') as HTMLElement;
    expect(badge.textContent).toBe('Mod');
    expect(badge.style.color).toBe('rgb(255, 0, 0)');
    expect(badge.style.backgroundColor).toBe('rgba(255, 0, 0, 0.12)');
  });
});


describe('a forum in the channel list', () => {
  const rows = () => [
    { id: 'pubs', name: 'Publications', kind: 'forum', unread: 3, mention: false, here: 0, threads: [
      { id: 't1', name: 'Mate recipes', kind: 'text', unread: 2, mention: false, here: 0 },
      { id: 't2', name: 'Asado tips', kind: 'text', unread: 0, mention: true, here: 0 },
    ] },
    { id: 'a', name: 'general', kind: 'chat', unread: 0, mention: false, here: 0 },
  ];

  it('nests its publications under it and opens one on a click', () => {
    localStorage.clear();
    const onChannel = vi.fn();
    const { side, host } = panel({ channels: rows, onChannel });
    side.toggle('channels');
    const threads = [...host.querySelectorAll<HTMLButtonElement>('.side-thread')];
    expect(threads.map((t) => t.querySelector('.side-name')!.textContent)).toEqual(['Mate recipes', 'Asado tips']);
    expect(threads[1].querySelector('.side-badge.ping')).not.toBeNull();
    threads[0].click();
    expect(onChannel).toHaveBeenCalledWith('t1');
  });

  it('folds them away, and remembers it', () => {
    localStorage.clear();
    const { side, host } = panel({ channels: rows });
    side.toggle('channels');
    host.querySelector<HTMLButtonElement>('.side-fold')!.click();
    expect(host.querySelectorAll('.side-thread')).toHaveLength(0);
    const again = panel({ channels: rows });
    again.side.toggle('channels');
    expect(again.host.querySelectorAll('.side-thread')).toHaveLength(0);
  });
});

describe('who is in the village', () => {
  const channels = (total: number, around: number, skyOnly = true, toggleCount?: () => void) => {
    const { side, host } = panel({ village: () => ({ total, around, skyOnly }), ...(toggleCount ? { toggleCount } : {}) });
    side.toggle('channels');
    return host.querySelector('.side-village');
  };

  it('heads the channel list with everyone connected and how many are around', () => {
    expect(channels(5, 2)?.textContent).toBe('5 in the village · 2 around');
  });

  it('leaves "around" out when everyone is at a channel, and the line out when nobody is connected', () => {
    expect(channels(3, 0)?.textContent).toBe('3 in the village');
    expect(channels(0, 0)).toBeNull();
  });

  it('counts the whole relay by default, as a switch to Sky only', () => {
    const toggle = vi.fn();
    const line = channels(7, 3, false, toggle) as HTMLButtonElement;
    expect(line.querySelector('.side-village-n')?.textContent).toBe('7 active on the relay');
    expect(line.querySelector('.side-village-switch')?.textContent).toBe('in Sky only');
    expect(line.getAttribute('aria-pressed')).toBe('false');
    line.click();
    expect(toggle).toHaveBeenCalledOnce();
  });

  it('shows no switch where the count can only be Sky\'s (the guest island)', () => {
    const { side, host } = panel({ village: () => ({ total: 2, around: 1, skyOnly: true, canToggle: false }), toggleCount: () => {} });
    side.toggle('channels');
    const line = host.querySelector('.side-village');
    expect(line?.tagName).toBe('DIV');
    expect(line?.textContent).toBe('2 in the village · 1 around');
  });

  it('switches back to the whole relay from Sky only, and stays a tap away at 0', () => {
    const line = channels(0, 0, true, () => {}) as HTMLButtonElement;
    expect(line.querySelector('.side-village-n')?.textContent).toBe('0 in the village');
    expect(line.querySelector('.side-village-switch')?.textContent).toBe('whole relay');
    expect(line.getAttribute('aria-pressed')).toBe('true');
  });
});

