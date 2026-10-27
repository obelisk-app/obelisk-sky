/**
 * "Invite people" in the account menu, for accounts the relay lets invite
 * (nostr/invite.ts, obelisk-relay's /api/invites): make a link, copy it, see
 * each link's use and turn one off. Drawn into the card.
 */
import { vw as words, type VillageWords } from '../i18n/village';
import type { InviteCode, InviteStatus } from '../nostr/invite';

export interface InvitePanelDeps {
  relayHost: string;
  load(): Promise<InviteStatus | null>;
  create(): Promise<InviteCode>;
  revoke(code: string): Promise<void>;
  linkFor(code: string): string;
  copy(text: string): void;
  toast(text: string): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Draw the panel into `body` and keep it current; returns once the first answer is drawn. */
export async function renderInvitePanel(body: HTMLElement, deps: InvitePanelDeps, w: VillageWords = words): Promise<void> {
  const root = el('div', 'invite-panel');
  body.append(el('h2', '', w.invite.title), el('div', 'about', w.invite.intro(deps.relayHost)), root);

  const draw = (me: InviteStatus | null, busy = false) => {
    root.replaceChildren();
    if (!me) return;
    root.append(el('div', 'sub', me.is_admin ? w.invite.quotaAdmin : w.invite.quota(me.admits_left ?? 0, me.codes_left ?? 0)));
    const create = el('button', 'pill primary', w.invite.create);
    create.disabled = busy || !me.can_mint;
    create.dataset.testid = 'invite-create';
    create.addEventListener('click', () => void act(async () => {
      const code = await deps.create();
      deps.copy(deps.linkFor(code.code));
      deps.toast(w.invite.copied);
    }));
    root.append(el('div', 'actions'));
    (root.lastChild as HTMLElement).append(create);
    for (const c of me.codes) {
      const row = el('div', 'invite-code');
      row.dataset.code = c.code;
      row.append(
        el('div', 'invite-link', deps.linkFor(c.code)),
        el('div', 'sub', `${w.invite.status[c.status] ?? c.status} · ${w.invite.uses(c.uses, c.max_uses)} · ${w.invite.joined(c.redemptions.length)}`),
      );
      if (c.status === 'active') {
        const actions = el('div', 'actions');
        const copy = el('button', 'pill', w.invite.copy);
        copy.addEventListener('click', () => { deps.copy(deps.linkFor(c.code)); deps.toast(w.invite.copied); });
        const off = el('button', 'pill', w.invite.revoke);
        off.disabled = busy;
        off.addEventListener('click', () => void act(() => deps.revoke(c.code)));
        actions.append(copy, off);
        row.append(actions);
      }
      root.append(row);
    }
  };

  let current: InviteStatus | null = null;
  const act = async (run: () => Promise<unknown>) => {
    draw(current, true);
    try {
      await run();
    } catch {
      deps.toast(w.invite.failed);
    }
    current = await deps.load();
    draw(current);
  };

  root.append(el('div', 'sub', w.invite.loading));
  current = await deps.load();
  draw(current);
}
