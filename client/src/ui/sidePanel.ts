// The drawer of the relay's channels (go there, see who's around), in the
// operator's categories as obelisk-dex's sidebar shows them (channelTree.ts),
// drawn where the chat panel sits: picking one opens its chat in its place,
// and the chat's Back comes here again. Or, on the left, a channel's members
// grouped by standing and presence (memberGroups.ts), as obelisk-dex lists them.

import type { Presence } from '../nostr/presence';
import { groupMembers, type Rank } from './memberGroups';
import { vw } from '../i18n/village';
import { channelSections } from './channelTree';
import type { ChannelLayout } from '@/services/relay/channel-layout';

export type SideTab = 'channels' | 'members';

export interface ChannelRow {
  id: string; name: string; kind: string; unread: number; mention: boolean; here: number;
  /** A forum's publications with messages, nested under it as obelisk-dex's sidebar shows them. */
  threads?: ChannelRow[];
}

const FOLD_KEY = 'obelisk-sky/forum-folded';
/** Forums folded shut in the list (remembered in this browser, as dex does; open by default). */
function readFolded(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(FOLD_KEY) ?? '[]') as string[]); } catch { return new Set(); }
}
function writeFolded(ids: Set<string>): void {
  try { localStorage.setItem(FOLD_KEY, JSON.stringify([...ids])); } catch { /* not remembered */ }
}

export interface SidePanelDeps {
  channels(): ChannelRow[];
  /** Everyone connected to the village, and how many of them stand at no channel's place. */
  village?(): { total: number; around: number };
  /** The operator's categories and channel order (obelisk:layout). */
  layout(): ChannelLayout;
  /** The channel the members list starts on (where you stand), else the first. */
  defaultChannel(): string | null;
  loadMembers(groupId: string): Promise<{ admins: string[]; members: string[] }>;
  /** People seen writing in the channel (open channels may publish no member list). */
  posters(groupId: string): string[];
  loadRanks(): Promise<Record<string, readonly Rank[]>>;
  presenceOf(pk: string): Presence;
  profile(pk: string): { name: string; avatar: string | null; nip05: string | null };
  colorOf(pk: string): string;
  me(): string | null;
  onChannel(id: string): void;
  onMember(pk: string): void;
}

export class SidePanel {
  readonly el: HTMLElement;
  private body: HTMLElement;
  private title: HTMLElement;
  /** The members tab's channel picker: built once, so a redraw never closes it while open. */
  private pick: HTMLSelectElement;
  private list: HTMLElement;
  tab: SideTab | null = null;
  private channel: string | null = null;
  private offlineOpen = false;
  /** Categories folded shut (by id; '' is the uncategorized list). */
  private folded = new Set<string>();
  /** Forums whose publications are folded away. */
  private forumsFolded = readFolded();
  /** Opened or closed: the host hides the chat while the list stands in its place. */
  onToggle?: () => void;
  private ranks: Record<string, readonly Rank[]> = {};
  private token = 0;
  /** What the list and picker last showed: a redraw with nothing new is skipped. */
  private shown = '';
  private options = '';

  constructor(parent: HTMLElement, private deps: SidePanelDeps) {
    this.el = div('side');
    this.el.hidden = true;
    const head = div('side-head');
    this.title = div('side-title');
    const x = document.createElement('button');
    x.className = 'chat-min';
    x.title = vw.close;
    x.textContent = '×';
    x.addEventListener('click', () => { this.close(); this.onToggle?.(); });
    head.append(this.title, x);
    this.body = div('side-body');
    this.pick = document.createElement('select');
    this.pick.className = 'themes-select side-pick';
    this.pick.addEventListener('change', () => this.choose(this.pick.value));
    this.list = div('side-list');
    this.body.append(this.pick, this.list);
    this.el.append(head, this.body);
    parent.appendChild(this.el);
  }

  /** Open on a tab (or close it, if that tab is already showing). */
  toggle(tab: SideTab): void {
    if (this.tab === tab && !this.el.hidden) { this.close(); return; }
    this.tab = tab;
    this.el.hidden = false;
    this.shown = '';
    this.el.classList.toggle('at-chat', tab === 'channels');
    document.body.classList.toggle('side-open', tab === 'members');
    document.body.classList.toggle('channels-open', tab === 'channels');
    if (tab === 'members') this.channel = this.channel && this.deps.channels().some((c) => c.id === this.channel) ? this.channel : this.deps.defaultChannel();
    this.render();
  }

  close(): void {
    this.tab = null;
    this.el.hidden = true;
    document.body.classList.remove('side-open', 'channels-open');
  }

  /** Show `groupId`'s members. */
  showMembers(groupId: string): void {
    if (this.tab !== 'members' || this.el.hidden) { this.channel = groupId; this.toggle('members'); }
    else this.choose(groupId);
  }

  /** Data changed (presence, unread, profiles): redraw what's showing. */
  refresh(): void {
    // A picker that's open (focused) keeps its list: rebuilding it would close it.
    if (this.el.hidden || document.activeElement === this.pick) return;
    this.render();
  }

  private choose(id: string): void {
    if (id === this.channel) return;
    this.channel = id;
    this.shown = '';
    this.list.replaceChildren(div('side-empty', vw.loadingMembers));
    void this.renderMembers();
  }

  private render(): void {
    if (this.tab === 'channels') this.renderChannels();
    else if (this.tab === 'members') void this.renderMembers();
  }

  /** Swap the list's rows in, unless they'd look just like what's there. */
  private show(sig: string, rows: () => HTMLElement[]): void {
    if (sig === this.shown) return;
    this.shown = sig;
    this.list.replaceChildren(...rows());
  }

  private renderChannels(): void {
    const rows = this.deps.channels();
    const sections = channelSections(rows, this.deps.layout());
    this.title.textContent = vw.channelsN(rows.length);
    this.pick.hidden = true;
    const v = this.deps.village?.() ?? { total: 0, around: 0 };
    this.show(`c|${v.total}|${v.around}|${[...this.folded].join(',')}|${[...this.forumsFolded].join(',')}|${JSON.stringify(sections)}`, () => {
      if (!rows.length) return [div('side-empty', vw.noChannelsRelay)];
      const out: HTMLElement[] = [];
      // Everyone connected first; each channel's row then says how many of them stand there.
      if (v.total) out.push(div('side-village', v.around ? `${vw.villageN(v.total)} · ${vw.aroundN(v.around)}` : vw.villageN(v.total)));
      for (const s of sections) {
        const key = s.id ?? '';
        const shut = this.folded.has(key);
        if (s.headed) {
          const h = document.createElement('button');
          h.className = 'side-section side-cat';
          h.setAttribute('aria-expanded', String(!shut));
          h.append(span('side-chev', shut ? '▸' : '▾'), span('side-cat-name', s.id === null ? vw.uncategorized : s.name.trim() || vw.untitledCategory), span('side-cat-n', String(s.rows.length)));
          h.addEventListener('click', () => { if (shut) this.folded.delete(key); else this.folded.add(key); this.renderChannels(); });
          out.push(h);
        }
        if (!shut) for (const c of s.rows) out.push(...this.channelRows(c));
      }
      return out;
    });
  }

  /** A channel's row, and for a forum its publications on an L-rail under it. */
  private channelRows(c: ChannelRow): HTMLElement[] {
    const threads = c.threads ?? [];
    const row = this.channelRow(c);
    if (!threads.length) return [row];
    const shut = this.forumsFolded.has(c.id);
    const fold = document.createElement('button');
    fold.className = 'side-mini side-fold';
    fold.textContent = shut ? '▸' : '▾';
    fold.title = shut ? vw.showPublications : vw.hidePublications;
    fold.setAttribute('aria-expanded', String(!shut));
    fold.addEventListener('click', (e) => {
      e.stopPropagation();
      if (shut) this.forumsFolded.delete(c.id); else this.forumsFolded.add(c.id);
      writeFolded(this.forumsFolded);
      this.renderChannels();
    });
    row.append(fold);
    if (shut) return [row];
    const rail = div('side-threads');
    for (const t of threads) {
      const b = document.createElement('button');
      b.className = `side-row side-thread${t.unread ? ' unread' : ''}`;
      b.dataset.groupId = t.id;
      b.append(span('side-name', t.name));
      if (t.unread || t.mention) b.append(span(`side-badge${t.mention ? ' ping' : ''}`, t.mention ? '@' : String(t.unread)));
      b.addEventListener('click', () => this.deps.onChannel(t.id));
      rail.append(b);
    }
    return [row, rail];
  }

  private channelRow(c: ChannelRow): HTMLElement {
    const b = document.createElement('button');
    b.className = `side-row${c.unread ? ' unread' : ''}`;
    const icon = span('side-ico', c.kind.startsWith('voice') ? '🔊' : c.kind === 'forum' ? '📰' : '#');
    const name = span('side-name', c.name);
    b.append(icon, name);
    if (c.here) b.append(span('side-here', vw.hereN(c.here)));
    if (c.unread || c.mention) b.append(span(`side-badge${c.mention ? ' ping' : ''}`, c.mention ? '@' : String(c.unread)));
    b.addEventListener('click', () => this.deps.onChannel(c.id));
    const members = document.createElement('button');
    members.className = 'side-mini';
    members.title = vw.members;
    members.textContent = '👥';
    members.addEventListener('click', (e) => { e.stopPropagation(); this.showMembers(c.id); this.onToggle?.(); });
    b.append(members);
    return b;
  }

  /** The picker's options, rebuilt only when the channels themselves change. */
  private fillPicker(): void {
    const channels = this.deps.channels();
    const sig = channels.map((c) => `${c.id}\u0000${c.name}`).join('\u0001');
    if (sig !== this.options) {
      this.options = sig;
      this.pick.replaceChildren(...channels.map((c) => {
        const o = document.createElement('option');
        o.value = c.id;
        o.textContent = c.name;
        return o;
      }));
    }
    if (this.channel && this.pick.value !== this.channel) this.pick.value = this.channel;
  }

  private async renderMembers(): Promise<void> {
    const token = ++this.token;
    const id = this.channel;
    this.pick.hidden = false;
    this.fillPicker();
    if (!id) { this.title.textContent = vw.members; this.show('m|none', () => [div('side-empty', vw.noChannelsYet)]); return; }
    if (!this.shown.startsWith(`m|${id}|`)) { this.title.textContent = vw.members; if (!this.list.querySelector('.side-empty')) this.list.replaceChildren(div('side-empty', vw.loadingMembers)); }
    const [m, ranks] = await Promise.all([this.deps.loadMembers(id), this.deps.loadRanks()]);
    if (token !== this.token || this.tab !== 'members') return;
    this.ranks = ranks;
    const pks = [...new Set([...m.members, ...this.deps.posters(id), ...(this.deps.me() ? [this.deps.me()!] : [])])];
    const sections = groupMembers(pks, new Set(m.admins), (pk) => this.ranks[pk], (pk) => this.deps.presenceOf(pk), (pk) => this.deps.profile(pk).name);
    this.title.textContent = vw.membersN(pks.length);
    const sig = `m|${id}|${this.offlineOpen}|${JSON.stringify(sections.map((s) => [s.key, s.rows.map((r) => [r.pk, r.admin, r.presence, r.rank?.name ?? '', this.deps.profile(r.pk)])]))}`;
    this.show(sig, () => {
      const out: HTMLElement[] = [];
      for (const s of sections) {
        const offline = s.key === 'offline';
        const h = document.createElement('button');
        h.className = 'side-section';
        h.textContent = `${offline ? (this.offlineOpen ? '▾ ' : '▸ ') : ''}${s.label} — ${s.rows.length}`;
        if (offline) h.addEventListener('click', () => { this.offlineOpen = !this.offlineOpen; void this.renderMembers(); });
        out.push(h);
        if (offline && !this.offlineOpen) continue;
        for (const r of s.rows) out.push(this.memberRow(r.pk, r.admin, r.presence, r.rank));
      }
      return out;
    });
  }

  private memberRow(pk: string, admin: boolean, presence: Presence, rank: Rank | null): HTMLElement {
    const p = this.deps.profile(pk);
    const b = document.createElement('button');
    b.className = `side-row member ${presence}`;
    const av = div('side-avatar');
    if (p.avatar) {
      const img = document.createElement('img');
      img.src = p.avatar;
      img.alt = '';
      img.referrerPolicy = 'no-referrer';
      av.append(img);
    } else {
      av.textContent = ([...p.name][0] ?? '?').toUpperCase();
      av.style.background = this.deps.colorOf(pk);
    }
    const dot = span(`side-dot ${presence}`, '');
    dot.title = vw.presence[presence];
    av.append(dot);
    const names = div('side-names');
    names.append(span('side-name', `${admin ? '🛡️ ' : ''}${p.name}${pk === this.deps.me() ? vw.you : ''}`));
    if (p.nip05) names.append(span('side-nip', p.nip05.replace(/^_@/, '')));
    b.append(av, names);
    if (rank) b.append(roleBadge(rank));
    if (presence === 'afk') b.append(span('side-afk', vw.afk));
    b.addEventListener('click', () => this.deps.onMember(pk));
    return b;
  }
}

/** A relay rank as obelisk-dex's RoleBadge draws it: its colour on a tint of itself. */
export function roleBadge(rank: Pick<Rank, 'name' | 'color' | 'emoji'>): HTMLSpanElement {
  const label = rank.emoji ? `${rank.emoji} ${rank.name}` : rank.name;
  const badge = span('side-rank', label);
  badge.title = vw.roleBadge(label);
  badge.style.color = rank.color;
  badge.style.borderColor = `${rank.color}59`;
  badge.style.backgroundColor = `${rank.color}1f`;
  return badge;
}

function div(cls: string, text?: string): HTMLDivElement {
  const d = document.createElement('div');
  d.className = cls;
  if (text !== undefined) d.textContent = text;
  return d;
}
function span(cls: string, text: string): HTMLSpanElement {
  const s = document.createElement('span');
  s.className = cls;
  s.textContent = text;
  return s;
}
