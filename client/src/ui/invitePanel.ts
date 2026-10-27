/**
 * "Invite people" in the account menu, for accounts the relay lets invite
 * (nostr/invite.ts, obelisk-relay's /api/invites): make a link (copied at
 * once), and each live link as its code with one Copy link. Links that are
 * off, used up or expired are left out. Drawn into the card.
 */
import { vw as words, type VillageWords } from '../i18n/village';
import type { InviteCode, InviteStatus } from '../nostr/invite';

export interface InvitePanelDeps {
  relayHost: string;
  load(): Promise<InviteStatus | null>;
  create(): Promise<InviteCode>;
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
    root.append(el('div', 'invite-quota', me.is_admin ? w.invite.quotaAdmin : w.invite.quota(me.admits_left ?? 0, me.codes_left ?? 0)));
    const create = el('button', 'pill primary invite-create', w.invite.create);
    create.disabled = busy || !me.can_mint;
    create.dataset.testid = 'invite-create';
    create.addEventListener('click', () => void act(async () => {
      const code = await deps.create();
      deps.copy(deps.linkFor(code.code));
      deps.toast(w.invite.copied);
    }));
    root.append(create);
    const list = el('div', 'invite-codes');
    for (const c of me.codes.filter((x) => x.status === 'active')) {
      const row = el('div', 'invite-code');
      row.dataset.code = c.code;
      const info = el('div', 'invite-code-info');
      const code = el('code', '', c.code);
      code.title = deps.linkFor(c.code);
      info.append(code, el('div', 'invite-code-use', `${w.invite.uses(c.uses, c.max_uses)} · ${w.invite.joined(c.redemptions.length)}`));
      const copy = el('button', 'pill', w.invite.copy);
      copy.addEventListener('click', () => { deps.copy(deps.linkFor(c.code)); deps.toast(w.invite.copied); });
      row.append(info, copy);
      list.append(row);
    }
    if (list.childElementCount) root.append(list);
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

  root.append(el('div', 'invite-quota', w.invite.loading));
  current = await deps.load();
  draw(current);
}
