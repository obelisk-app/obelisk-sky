/**
 * "Invite people" (account menu and settings; nostr/invite.ts, obelisk-relay's
 * /api/invites). The relay the links are for is picked at the top, from the
 * relays you know, without leaving the one you are in. Then: why you may
 * invite there (owner, admin, reference account or an admin's grant; or who
 * can), what is left of the allowance, a form for a new link (label, how many
 * people, days), the new link with Copy and Share, and every link you made:
 * live ones first, past ones folded, each with who joined and Turn off.
 * Drawn into the card.
 */
import { vw as words, type VillageWords } from '../i18n/village';
import type { CreateInviteOptions, InviteCode, InviteStatus } from '../nostr/invite';

export interface InvitePanelDeps {
  /** The relays offered in the picker (wss:// URLs). */
  relays: string[];
  /** The one picked at first: the relay you are in. */
  relay: string;
  /** `/api/invites/me` for that relay, signed for its URL; throws when it fails. */
  load(relay: string): Promise<InviteStatus>;
  create(relay: string, opts: CreateInviteOptions): Promise<InviteCode>;
  revoke(relay: string, code: string): Promise<void>;
  linkFor(code: string, relay: string): string;
  /** Resolves true only when the text really reached the clipboard. */
  copy(text: string): Promise<boolean>;
  /** The system share sheet, when the browser has one; true once shared. */
  share?: ((url: string, text: string) => Promise<boolean>) | null;
  nameOf(pubkey: string): string;
  toast(text: string): void;
}

const DAY = 86_400;
const DEFAULT_DAYS = 7;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

const hostOf = (relay: string) => relay.replace(/^wss?:\/\//, '').replace(/\/+$/, '');

/** Draw the panel into `body` and keep it current; returns once the first answer is drawn. */
export async function renderInvitePanel(body: HTMLElement, deps: InvitePanelDeps, w: VillageWords = words): Promise<void> {
  const t = w.invite;
  let relay = deps.relay;
  let me: InviteStatus | null = null;
  let fresh: string | null = null; // the link made just now, shown on top
  let gen = 0;

  const picker = el('select', 'themes-select invite-relay');
  picker.dataset.testid = 'invite-relay';
  for (const r of [...new Set([relay, ...deps.relays])]) {
    const o = el('option', '', hostOf(r));
    o.value = r;
    picker.append(o);
  }
  picker.value = relay;
  const pick = el('label', 'invite-relay-row');
  pick.append(el('span', '', t.relayLabel), picker);
  const root = el('div', 'invite-panel');
  body.append(el('h2', '', t.title), pick, root);

  const date = (unix: number) => new Date(unix * 1000).toLocaleDateString(t.dateLocale, { day: 'numeric', month: 'short', year: 'numeric' });

  const copy = async (url: string) => {
    deps.toast((await deps.copy(url).catch(() => false)) ? t.copied : t.copyFailed);
  };
  const linkButtons = (url: string) => {
    const out: HTMLButtonElement[] = [];
    const c = el('button', 'pill', t.copy);
    c.type = 'button';
    c.dataset.act = 'copy';
    c.addEventListener('click', () => void copy(url));
    out.push(c);
    if (deps.share) {
      const s = el('button', 'pill', t.share);
      s.type = 'button';
      s.dataset.act = 'share';
      s.addEventListener('click', () => void deps.share!(url, t.shareText(hostOf(relay))).catch(() => false));
      out.push(s);
    }
    return out;
  };

  const explain = (m: InviteStatus): string => {
    const host = hostOf(relay);
    const basis = m.basis !== undefined ? m.basis : m.is_admin ? 'admin' : m.can_mint ? 'grant' : null;
    if (basis === 'grant') return t.basis.grant(host, m.admits_total ?? null);
    if (basis) return t.basis[basis](host);
    return t.basis.none;
  };

  const form = (m: InviteStatus) => {
    const f = el('form', 'invite-form');
    const field = (label: string, input: HTMLInputElement) => {
      const l = el('label', 'invite-field');
      l.append(el('span', '', label), input);
      f.append(l);
      return input;
    };
    const label = field(t.labelField, el('input'));
    label.type = 'text';
    label.maxLength = 60;
    label.placeholder = t.labelPlaceholder;
    label.name = 'label';
    const left = m.admits_left;
    const many = field(t.howMany, el('input'));
    many.type = 'number';
    many.name = 'max_uses';
    many.min = '1';
    if (left != null) many.max = String(left);
    many.value = String(left ?? 10);
    const maxDays = m.grant?.max_ttl_secs ? Math.max(1, Math.floor(m.grant.max_ttl_secs / DAY)) : null;
    const days = field(t.expiryDays, el('input'));
    days.type = 'number';
    days.name = 'days';
    days.min = '1';
    if (maxDays) days.max = String(maxDays);
    days.value = String(maxDays ? Math.min(DEFAULT_DAYS, maxDays) : DEFAULT_DAYS);
    const go = el('button', 'pill primary invite-create', t.create);
    go.type = 'submit';
    go.dataset.testid = 'invite-create';
    f.append(go);
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const clamp = (v: number, lo: number, hi: number | null) => Math.min(Math.max(Number.isFinite(v) ? Math.round(v) : lo, lo), hi ?? Infinity);
      const opts: CreateInviteOptions = {
        label: label.value,
        max_uses: clamp(Number(many.value), 1, left),
        expires_in: clamp(Number(days.value), 1, maxDays) * DAY,
      };
      void act(async () => {
        const code = await deps.create(relay, opts);
        fresh = deps.linkFor(code.code, relay);
      });
    });
    return f;
  };

  const linkRow = (c: InviteCode) => {
    const url = deps.linkFor(c.code, relay);
    const row = el('div', `invite-code${c.status === 'active' ? '' : ' past'}`);
    row.dataset.code = c.code;
    const info = el('div', 'invite-code-info');
    if (c.label) info.append(el('div', 'invite-code-label', c.label));
    const code = el('code', '', url);
    code.title = url;
    const when = c.status === 'active' ? (c.expires_at ? t.expires(date(c.expires_at)) : t.noExpiry) : (t.state[c.status] ?? c.status);
    info.append(code, el('div', 'invite-code-use', `${t.uses(c.uses, c.max_uses)} · ${when}`));
    row.append(info);

    const joined = el('div', 'invite-joined');
    joined.append(el('div', 'invite-joined-title', t.whoJoined));
    if (!c.redemptions.length) joined.append(el('div', 'invite-joined-none', t.nobodyYet));
    for (const r of c.redemptions) {
      const p = el('div', `invite-person${r.evicted_at ? ' removed' : ''}`);
      p.dataset.pubkey = r.pubkey;
      p.append(el('span', 'invite-person-name', deps.nameOf(r.pubkey)), el('span', 'invite-person-at', date(r.at)));
      if (r.evicted_at) p.append(el('span', 'invite-person-removed', t.removed));
      joined.append(p);
    }
    row.append(joined);

    if (c.status === 'active') {
      const actions = el('div', 'invite-code-actions');
      const off = el('button', 'pill invite-off', t.turnOff);
      off.type = 'button';
      off.dataset.act = 'turn-off';
      off.addEventListener('click', () => {
        // Asked in place: the link stays until "Turn off" is pressed again.
        const ask = el('div', 'invite-confirm');
        ask.append(el('div', 'invite-confirm-text', t.turnOffAsk));
        const yes = el('button', 'pill danger', t.turnOff);
        yes.type = 'button';
        yes.dataset.act = 'confirm-off';
        yes.addEventListener('click', () => void act(async () => {
          await deps.revoke(relay, c.code);
          deps.toast(t.turnedOff);
        }));
        const no = el('button', 'pill', w.cancel);
        no.type = 'button';
        no.dataset.act = 'cancel-off';
        no.addEventListener('click', () => ask.replaceWith(actions));
        const btns = el('div', 'invite-code-actions');
        btns.append(yes, no);
        ask.append(btns);
        actions.replaceWith(ask);
      });
      actions.append(...linkButtons(url), off);
      row.append(actions);
    }
    return row;
  };

  const draw = (state: 'loading' | 'error' | 'ready', busy = false) => {
    root.replaceChildren();
    if (state === 'loading') { root.append(el('div', 'invite-quota', t.loading)); return; }
    if (state === 'error' || !me) {
      const err = el('div', 'invite-error');
      err.append(el('div', 'invite-quota', t.loadFailed(hostOf(relay))));
      const retry = el('button', 'pill', t.retry);
      retry.type = 'button';
      retry.dataset.testid = 'invite-retry';
      retry.addEventListener('click', () => void load());
      err.append(retry);
      root.append(err);
      return;
    }
    const m = me;
    if (m.invited_by) root.append(el('div', 'invite-by', t.invitedBy(deps.nameOf(m.invited_by.pubkey))));
    root.append(el('div', 'about invite-basis', explain(m)));
    if (m.admits_total != null && m.admits_left != null && m.admits_total > 0) {
      const meter = el('div', 'invite-meter');
      meter.setAttribute('role', 'meter');
      meter.setAttribute('aria-valuemin', '0');
      meter.setAttribute('aria-valuemax', String(m.admits_total));
      meter.setAttribute('aria-valuenow', String(m.admits_left));
      const bar = el('div', 'invite-meter-bar');
      const fill = el('div', 'invite-meter-fill');
      fill.style.width = `${Math.round((m.admits_left / m.admits_total) * 100)}%`;
      bar.append(fill);
      meter.append(bar, el('span', 'invite-meter-text', t.left(m.admits_left, m.admits_total)));
      root.append(meter);
    }
    if (fresh) {
      const box = el('div', 'invite-fresh');
      box.dataset.testid = 'invite-fresh';
      const link = el('input', 'invite-fresh-link');
      link.readOnly = true;
      link.value = fresh;
      link.addEventListener('focus', () => link.select());
      const btns = el('div', 'invite-code-actions');
      btns.append(...linkButtons(fresh));
      box.append(el('div', 'invite-quota', t.ready), link, btns);
      root.append(box);
    }
    if (m.can_mint) {
      const f = form(m);
      if (busy) f.querySelectorAll('input, button').forEach((x) => { (x as HTMLInputElement).disabled = true; });
      root.append(f);
    } else if (m.basis) root.append(el('div', 'invite-quota', t.spent));

    const live = m.codes.filter((c) => c.status === 'active');
    const past = m.codes.filter((c) => c.status !== 'active');
    if (live.length || past.length) {
      root.append(el('div', 'themes-section', t.activeLinks));
      const list = el('div', 'invite-codes');
      if (!live.length) list.append(el('div', 'invite-quota', t.noLinks));
      for (const c of live) list.append(linkRow(c));
      root.append(list);
    }
    if (past.length) {
      const fold = el('details', 'invite-past');
      fold.append(el('summary', '', t.pastLinks(past.length)));
      const list = el('div', 'invite-codes');
      for (const c of past) list.append(linkRow(c));
      fold.append(list);
      root.append(fold);
    }
  };

  /** Load the picked relay's answer; a failure is shown with Retry, never kept. */
  const load = async () => {
    const mine = ++gen;
    const r = relay;
    draw('loading');
    try {
      const m = await deps.load(r);
      if (mine !== gen) return;
      me = m;
      draw('ready');
    } catch {
      if (mine !== gen) return;
      me = null;
      draw('error');
    }
  };

  const act = async (run: () => Promise<unknown>) => {
    draw('ready', true);
    try {
      await run();
    } catch {
      deps.toast(t.failed);
    }
    await load();
  };

  picker.addEventListener('change', () => {
    relay = picker.value;
    me = null;
    fresh = null;
    void load();
  });

  await load();
}
