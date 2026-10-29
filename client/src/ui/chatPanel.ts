// The channel you're standing in: recent messages, reactions and obelisk-dex's
// message bar (chat/composer: emoji picker, @-mentions, bot commands, reply).
// Opens when your character walks into a building's yard (or when asked: see
// ui/chatAuto.ts for when), closes with × or when you walk out of a yard
// that opened it. Text is rendered through obelisk-dex's message components
// (chat/messageBody), or content.ts until they load (textContent only; images
// as <img>, never relay HTML).

import type { WireGroup, WireMessage, WireReaction } from '../nostr/wire';
import type { ZapTotal } from '../nostr/state';
import { pubkeyColor } from '../world/character';
import { renderContent } from './content';
import { kindLabel, vw } from '../i18n/village';
import { lang } from '../i18n/lang';
import type { MentionPerson, ReplyTarget } from '../chat/composer/useSkyComposer';
import { roleBadge } from './sidePanel';
import type { Rank } from './memberGroups';
import type { ThreadSummary } from '../nostr/forum';

export const QUICK_REACTIONS = ['❤️', '👍', '😂', '🔥', '🤙', '⚡', '👀', '🎉'];
const MAX_SHOWN = 60;

export interface ChatPanelDeps {
  me: () => string | null;
  nameOf: (pk: string) => string;
  avatarOf: (pk: string) => string | null;
  messages: (groupId: string) => WireMessage[];
  reactions: (msgId: string) => WireReaction[];
  /** The zaps a message got, if any: shown as "⚡ sats" by its reactions. */
  zaps?: (msgId: string) => ZapTotal | null;
  /** Publish a kind 9; `tags` are the bar's custom emoji / sticker / voice-note tags. */
  send: (groupId: string, text: string, replyTo: WireMessage | null, tags?: string[][]) => Promise<string | null>;
  react: (msg: WireMessage, emoji: string) => void;
  unreact: (r: WireReaction) => void;
  remove: (msg: WireMessage) => void;
  join: (groupId: string) => Promise<string | null>;
  onReplyPick?: (msg: WireMessage) => void;
  onGame?: (gameId: string) => void;
  /** A mention chip, an author's avatar or name was clicked. */
  onProfile?: (pubkey: string) => void;
  /** Their top relay rank, shown by their name as obelisk-dex does. */
  roleOf?: (pubkey: string) => Rank | null;
  /** A forum's publications (nostr/forum.ts): a forum's chat lists them instead of messages. */
  threads?: (forumId: string) => ThreadSummary[];
  /** The forum a group is a publication of: its chat's ‹ goes back there. */
  forumOf?: (groupId: string) => WireGroup | null;
  /** Unread messages in a group (a publication's badge). */
  unread?: (groupId: string) => number;
  newGame?: (groupId: string) => void;
  /** `/zap …` in this channel: open the zap sheet, or say why not. */
  zap?: (groupId: string, command: string, replyTo: { id: string; pubkey: string } | null) => string | null;
  /** Everyone the @-picker may offer (the relay's members, posters, people in the village). */
  people?: (groupId: string) => MentionPerson[];
  /** The group relay (bots advertise their commands per relay). */
  relay?: () => string;
  /** The relay's NIP-11 operator, whose emoji set the picker offers. */
  operator?: () => string | null;
}

type Bodies = typeof import('../chat/messageBody');
type Composer = typeof import('../chat/composer/mount');

export class ChatPanel {
  readonly el: HTMLElement;
  private list: HTMLElement;
  private title: HTMLElement;
  private sub: HTMLElement;
  private composerSlot: HTMLElement;
  private error: HTMLElement;
  private group: WireGroup | null = null;
  private replyTo: WireMessage | null = null;
  private pickerFor: string | null = null;
  minimised = false;
  /** Who opened the panel: walking into a yard, or the viewer. */
  openedBy: 'auto' | 'user' | null = null;
  /** The viewer closed the panel with ×. */
  onClose?: () => void;
  /** The header's ‹ (back to the channel list); hidden while unset. */
  onBack?: () => void;
  /** Escape in the message bar with nothing left to close there (main.ts: the general chat closes). */
  onEscape?: () => void;
  private back: HTMLButtonElement;

  constructor(parent: HTMLElement, private deps: ChatPanelDeps) {
    this.el = div('chat');
    this.el.hidden = true;
    const head = div('chat-head');
    this.back = button('chat-min chat-back', vw.backToChannels);
    this.back.textContent = '‹';
    this.back.addEventListener('click', () => {
      const forum = this.group ? this.deps.forumOf?.(this.group.id) : null;
      if (forum) this.open(forum, 'user');
      else this.onBack?.();
    });
    const titles = div('chat-titles');
    this.title = div('chat-title');
    this.sub = div('chat-sub');
    titles.append(this.title, this.sub);
    const min = button('chat-min', vw.minimise);
    min.textContent = '–';
    min.addEventListener('click', () => this.setMinimised(!this.minimised));
    const x = button('chat-min chat-close', vw.close);
    x.textContent = '×';
    x.addEventListener('click', () => { this.close(); this.onClose?.(); });
    // Games start from the message bar (/play), not a header button.
    head.append(this.back, titles, min, x);
    head.addEventListener('dblclick', () => this.setMinimised(!this.minimised));
    this.list = div('chat-list');
    this.list.addEventListener('scroll', () => this.onScroll(), { passive: true });
    this.error = div('chat-error');
    this.error.hidden = true;
    this.composerSlot = div('chat-composer chat-bar');
    this.el.append(head, this.list, this.error, this.composerSlot);
    parent.appendChild(this.el);
  }

  get groupId(): string | null {
    return this.group?.id ?? null;
  }

  open(g: WireGroup, by: 'auto' | 'user' = 'user'): void {
    const changed = this.group?.id !== g.id;
    this.group = g;
    if (changed || by === 'user') this.openedBy = by;
    this.el.hidden = false;
    document.body.classList.add('chat-open');
    const forum = this.deps.forumOf?.(g.id) ?? null;
    this.back.hidden = !forum && !this.onBack;
    this.back.title = forum ? vw.backToForum(forum.name) : vw.backToChannels;
    this.back.setAttribute('aria-label', this.back.title);
    this.title.textContent = g.name;
    this.sub.textContent = forum ? `${kindLabel(forum.kind)} · ${forum.name}` : kindLabel(g.kind);
    // A forum is read through its publications: no message bar of its own.
    this.el.classList.toggle('forum', g.kind === 'forum');
    this.composerSlot.hidden = g.kind === 'forum';
    // Another channel opens at its newest message.
    if (changed) { this.replyTo = null; this.error.hidden = true; this.setMinimised(false); this.stick = true; }
    this.renderComposer();
    this.render();
  }

  close(): void {
    this.group = null;
    this.openedBy = null;
    this.el.hidden = true;
    this.follow?.disconnect();
    this.bodies?.pruneBodies(new Set());
    document.body.classList.remove('chat-open');
    this.setReply(null);
  }

  setMinimised(m: boolean): void {
    this.minimised = m;
    this.el.classList.toggle('min', m);
  }

  focusComposer(): void {
    if (!this.group || this.el.hidden || this.group.kind === 'forum') return;
    this.setMinimised(false);
    if (this.composer) this.composer.focus();
    else this.focusWhenLoaded = true;
  }

  get replyingTo(): WireMessage | null {
    return this.replyTo;
  }

  setReply(m: WireMessage | null): void {
    this.replyTo = m;
    this.renderComposer();
    if (m) this.focusComposer();
  }

  /** Re-render if the panel shows `groupId` (or always, with no argument). */
  refresh(groupId?: string): void {
    if (!this.group) return;
    // A forum's list changes with any of its publications.
    if (groupId && groupId !== this.group.id && !(this.group.kind === 'forum' && this.deps.forumOf?.(groupId)?.id === this.group.id)) return;
    this.render();
  }

  /** obelisk-dex's message bar, loaded on the first open (React). */
  private composer: ReturnType<Composer['mountComposer']> | null = null;
  private composerLoading = false;
  private focusWhenLoaded = false;

  /** Fetch the message bar and renderer ahead of time (after the village is up), so opening a chat is instant. */
  preload(): void {
    void import('../chat/messageBody').catch(() => {});
    void import('../chat/composer/mount').catch(() => {});
  }

  private loadComposer(): void {
    if (this.composer || this.composerLoading) return;
    this.composerLoading = true;
    void import('../chat/composer/mount').then((c) => {
      this.composer = c.mountComposer(this.composerSlot);
      this.renderComposer();
      if (this.focusWhenLoaded) { this.focusWhenLoaded = false; queueMicrotask(() => this.composer?.focus()); }
    }).catch((e) => {
      this.composerLoading = false;
      console.warn('[sky] message bar failed to load', e);
    });
  }

  private renderComposer(): void {
    const g = this.group;
    if (!g) return;
    if (!this.composer) { this.loadComposer(); return; }
    const reply = this.replyTo;
    this.composer.render({
      groupId: g.id,
      groupName: g.name,
      relay: this.deps.relay?.() ?? '',
      operator: this.deps.operator?.() ?? null,
      replyingTo: reply ? { id: reply.id, pubkey: reply.pubkey, content: reply.content ?? reply.text } : null,
      setReplyingTo: (m: ReplyTarget | null) => {
        // The bar only ever clears the reply or puts back the one it had.
        this.setReply(m && reply && m.id === reply.id ? reply : null);
      },
      onSend: (text, tags, to) => this.submit(g, text, tags, to && reply && to.id === reply.id ? reply : null),
      onNewGame: () => this.deps.newGame?.(g.id),
      // null is "opened": only a missing handler is an error.
      onZap: (command, to) => (this.deps.zap ? this.deps.zap(g.id, command, to) : 'Zaps aren’t available here.'),
      people: () => this.deps.people?.(g.id) ?? [],
      onEscape: () => this.onEscape?.(),
    });
  }

  private async submit(g: WireGroup, text: string, tags: string[][], reply: WireMessage | null): Promise<string | null> {
    this.error.hidden = true;
    const err = await this.deps.send(g.id, text, reply, tags);
    if (err) this.showError(err);
    return err;
  }

  private showError(reason: string): void {
    this.error.hidden = false;
    this.error.replaceChildren();
    const msg = document.createElement('span');
    const needsJoin = /member/i.test(reason);
    msg.textContent = needsJoin ? vw.membersOnly : vw.notSent(reason);
    this.error.append(msg);
    if (needsJoin && this.group) {
      const g = this.group;
      const join = button('chat-join', vw.requestJoin);
      join.textContent = vw.requestJoin;
      join.addEventListener('click', async () => {
        const e = await this.deps.join(g.id);
        msg.textContent = e ? vw.joinFailed(e) : vw.joinRequested;
        join.remove();
      });
      this.error.append(join);
    }
  }

  /** obelisk-dex's message renderer, loaded on the first open (React, markdown). */
  private bodies: Bodies | null = null;
  private bodiesLoading = false;

  private loadBodies(): void {
    if (this.bodies || this.bodiesLoading) return;
    this.bodiesLoading = true;
    void import('../chat/messageBody').then((b) => {
      b.setBodyHandlers({ onGame: (id) => this.deps.onGame?.(id), onProfile: (pk) => this.deps.onProfile?.(pk) });
      this.bodies = b;
      this.render();
    }).catch((e) => {
      // Stay on the plain renderer.
      console.warn('[sky] message renderer failed to load', e);
    });
  }

  /** The list rests at the newest message and follows it as messages come
   *  and their bodies (drawn by React a moment later, images later still)
   *  grow. Let go only when you scroll up yourself. */
  private stick = true;
  /** Where the list was last scrolled to, to tell your scrolling up from content growing. */
  private lastTop = 0;
  private follow = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => { if (this.stick) this.toBottom(); });

  private nearBottom(): boolean {
    return this.list.scrollHeight - this.list.scrollTop - this.list.clientHeight < 40;
  }

  private onScroll(): void {
    const top = this.list.scrollTop;
    if (top < this.lastTop - 2) this.stick = this.nearBottom();
    else if (this.nearBottom()) this.stick = true;
    this.lastTop = top;
  }

  private toBottom(): void {
    if (this.group?.kind === 'forum') return;
    this.list.scrollTop = this.list.scrollHeight;
    this.lastTop = this.list.scrollTop;
  }

  private render(): void {
    if (!this.group) return;
    if (this.group.kind === 'forum') { this.follow?.disconnect(); this.renderForum(this.group); return; }
    this.loadBodies();
    const atBottom = this.stick;
    const msgs = this.deps.messages(this.group.id).slice(-MAX_SHOWN);
    this.list.replaceChildren();
    if (!msgs.length) {
      const empty = div('chat-empty');
      empty.textContent = vw.chatEmpty;
      this.list.append(empty);
    }
    const me = this.deps.me();
    this.follow?.disconnect();
    for (const m of msgs) {
      const row = this.row(m, me);
      this.list.append(row);
      this.follow?.observe(row);
    }
    this.bodies?.pruneBodies(new Set(msgs.map((m) => m.id)));
    if (atBottom || msgs.length < 8) { this.stick = true; this.toBottom(); }
  }

  private row(m: WireMessage, me: string | null): HTMLElement {
    const row = div('chat-msg');
    row.dataset.msgId = m.id;
    const av = this.profileLink(this.avatar(m.pubkey), m.pubkey);
    const body = div('chat-body');
    const meta = div('chat-meta');
    const who = this.profileLink(document.createElement('span'), m.pubkey);
    who.classList.add('chat-who');
    who.style.color = pubkeyColor(m.pubkey);
    who.textContent = this.deps.nameOf(m.pubkey);
    const when = document.createElement('span');
    when.className = 'chat-when';
    when.textContent = new Date(m.createdAt * 1000).toLocaleString(lang, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
    meta.append(who);
    const rank = this.deps.roleOf?.(m.pubkey);
    if (rank) meta.append(roleBadge(rank));
    meta.append(when);
    if (m.replyTo) {
      const r = this.profileLink(document.createElement('span'), m.replyTo);
      r.classList.add('chat-to');
      r.textContent = `↪ ${this.deps.nameOf(m.replyTo)}`;
      meta.append(r);
    }
    let content: HTMLElement;
    if (this.bodies) {
      content = this.bodies.messageBodyEl({
        id: m.id, content: m.content ?? m.text, groupId: m.groupId, images: m.images ?? [], emojis: m.emojis ?? {},
        voiceNote: m.voiceNote, picture: this.deps.avatarOf(m.pubkey), createdAt: m.createdAt,
      });
    } else {
      content = div('chat-text');
      renderContent(content, m.content ?? m.text, { nameOf: this.deps.nameOf, images: m.images ?? [], emojis: m.emojis, onGame: this.deps.onGame });
    }
    body.append(meta, content, this.reactionsRow(m, me));

    const actions = div('chat-actions');
    if (me) {
      const reply = button('chat-act', vw.reply);
      reply.textContent = vw.reply;
      reply.addEventListener('click', () => { this.setReply(m); this.deps.onReplyPick?.(m); });
      const react = button('chat-act', vw.react);
      react.textContent = vw.react;
      react.addEventListener('click', () => { this.pickerFor = this.pickerFor === m.id ? null : m.id; this.render(); });
      actions.append(reply, react);
      if (m.pubkey === me) {
        const del = button('chat-act danger', vw.delete);
        del.textContent = vw.delete;
        del.addEventListener('click', () => { if (confirm(vw.deleteConfirm)) this.deps.remove(m); });
        actions.append(del);
      }
    }
    row.append(av, body, actions);
    if (this.pickerFor === m.id) row.append(this.picker(m));
    return row;
  }

  /** A forum: its publications as cards, latest first (obelisk-dex's ForumView list). */
  private renderForum(forum: WireGroup): void {
    const threads = this.deps.threads?.(forum.id) ?? [];
    const scroll = this.list.scrollTop;
    this.list.replaceChildren();
    if (!threads.length) {
      const empty = div('chat-empty');
      empty.textContent = vw.forumEmpty;
      this.list.append(empty);
      return;
    }
    for (const t of threads) this.list.append(this.threadCard(t));
    this.list.scrollTop = scroll;
  }

  private threadCard(t: ThreadSummary): HTMLElement {
    const card = document.createElement('button');
    card.type = 'button';
    const unread = this.deps.unread?.(t.group.id) ?? 0;
    card.className = `chat-thread${unread ? ' unread' : ''}`;
    card.dataset.groupId = t.group.id;
    const head = div('chat-thread-head');
    const title = div('chat-thread-title');
    title.textContent = t.group.name;
    head.append(title);
    if (unread) { const b = div('chat-thread-badge'); b.textContent = String(unread); head.append(b); }
    const op = div('chat-thread-op');
    op.append(this.avatar(t.first.pubkey));
    const who = document.createElement('span');
    who.className = 'chat-thread-who';
    who.style.color = pubkeyColor(t.first.pubkey);
    who.textContent = vw.threadBy(this.deps.nameOf(t.first.pubkey));
    op.append(who);
    const snippet = div('chat-thread-snippet');
    snippet.textContent = (t.first.text || '').slice(0, 220);
    const foot = div('chat-thread-foot');
    const when = new Date(t.last.createdAt * 1000).toLocaleString(lang, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    foot.textContent = `💬 ${vw.threadReplies(t.count)} · ${vw.threadLast(this.deps.nameOf(t.last.pubkey))} · ${when}`;
    card.append(head, op, snippet, foot);
    card.addEventListener('click', () => this.open(t.group, 'user'));
    return card;
  }

  private reactionsRow(m: WireMessage, me: string | null): HTMLElement {
    const wrap = div('chat-reactions');
    const groups = new Map<string, WireReaction[]>();
    for (const r of this.deps.reactions(m.id)) {
      const list = groups.get(r.emoji) ?? [];
      list.push(r);
      groups.set(r.emoji, list);
    }
    const zapped = this.deps.zaps?.(m.id);
    if (zapped) {
      const names = zapped.zappers.map((pk) => this.deps.nameOf(pk)).join(', ');
      const chip = div(`chat-chip zap${me && zapped.zappers.includes(me) ? ' mine' : ''}`);
      chip.textContent = `⚡ ${zapped.sats.toLocaleString()}`;
      chip.title = `${zapped.sats.toLocaleString()} sats in ${zapped.count} zap${zapped.count === 1 ? '' : 's'}${names ? ` from ${names}` : ''}`;
      wrap.append(chip);
    }
    for (const [emoji, list] of groups) {
      const mine = me ? list.find((r) => r.pubkey === me) : undefined;
      const chip = button(`chat-chip${mine ? ' mine' : ''}`, list.map((r) => this.deps.nameOf(r.pubkey)).join(', '));
      chip.textContent = `${emoji} ${list.length}`;
      chip.disabled = !me;
      chip.addEventListener('click', () => (mine ? this.deps.unreact(mine) : this.deps.react(m, emoji)));
      wrap.append(chip);
    }
    return wrap;
  }

  private picker(m: WireMessage): HTMLElement {
    const p = div('chat-picker');
    for (const e of QUICK_REACTIONS) {
      const b = button('chat-pick', vw.reactWith(e));
      b.textContent = e;
      b.addEventListener('click', () => { this.pickerFor = null; this.deps.react(m, e); this.render(); });
      p.append(b);
    }
    return p;
  }

  /** Make `el` open `pk`'s card on a click or Enter, like a mention chip. */
  private profileLink<T extends HTMLElement>(el: T, pk: string): T {
    if (!this.deps.onProfile) return el;
    el.classList.add('chat-person');
    el.tabIndex = 0;
    el.setAttribute('role', 'button');
    el.title = vw.openProfile;
    const open = () => this.deps.onProfile?.(pk);
    el.addEventListener('click', open);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
    return el;
  }

  private avatar(pk: string): HTMLElement {
    const url = this.deps.avatarOf(pk);
    if (url) {
      const img = document.createElement('img');
      img.className = 'chat-av';
      img.alt = '';
      img.referrerPolicy = 'no-referrer';
      img.loading = 'lazy';
      img.src = url;
      img.onerror = () => img.replaceWith(this.profileLink(this.initial(pk), pk));
      return img;
    }
    return this.initial(pk);
  }

  private initial(pk: string): HTMLElement {
    const d = div('chat-av');
    d.style.background = pubkeyColor(pk);
    d.textContent = ([...this.deps.nameOf(pk).replace(/^@/, '')][0] ?? '?').toUpperCase();
    return d;
  }
}

function div(cls: string): HTMLDivElement {
  const d = document.createElement('div');
  d.className = cls;
  return d;
}

function button(cls: string, label: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = cls;
  b.type = 'button';
  b.setAttribute('aria-label', label);
  b.title = label;
  return b;
}
