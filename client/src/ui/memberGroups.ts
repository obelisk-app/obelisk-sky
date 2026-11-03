// The member list: everyone in one list, connected and not. Connected people
// come first (online, then AFK), then everyone offline; within each, channel
// admins, then each relay rank by tier, then everyone else, by name. A
// connected person's row also says where they stand (sidePanel `whereIs`).

import type { Presence } from '../nostr/presence';
import { vw } from '../i18n/village';

export interface Rank { id: string; name: string; tier: number; color: string; emoji: string }

export interface MemberRow {
  pk: string;
  admin: boolean;
  presence: Presence;
  /** Their top relay rank, if any (the badge). */
  rank: Rank | null;
}

const PRESENCE_ORDER: Record<Presence, number> = { online: 0, afk: 1, offline: 2 };

/** Everyone in one list: connected first (online, then AFK), then offline; admins, then ranks by tier, then by name. */
export function listMembers(
  pks: readonly string[],
  admins: ReadonlySet<string>,
  ranksOf: (pk: string) => readonly Rank[] | undefined,
  presenceOf: (pk: string) => Presence,
  nameOf: (pk: string) => string,
): MemberRow[] {
  const rows: MemberRow[] = pks.map((pk) => ({ pk, admin: admins.has(pk), presence: presenceOf(pk), rank: ranksOf(pk)?.[0] ?? null }));
  const standing = (r: MemberRow) => (r.admin ? 1000 : r.rank ? r.rank.tier : -1);
  return rows.sort((a, b) =>
    PRESENCE_ORDER[a.presence] - PRESENCE_ORDER[b.presence]
    || standing(b) - standing(a)
    || nameOf(a.pk).localeCompare(nameOf(b.pk)));
}
