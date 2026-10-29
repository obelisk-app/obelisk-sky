// Every relay's general chat: the one channel whose messages show in the
// village wherever you stand (main.ts `hears`, ui/livePlaces.ts) and that T
// opens. Obelisk has no such setting, so it is picked from the channels: a
// text channel called "general", else one called like a chat room (chat,
// charla, lobby, off-topic: the guest island's "Mate & chat"), else the first
// text channel in the operator's layout (obelisk-dex's sidebar order), else
// the first text channel.

import type { ChannelLayout } from '@/services/relay/channel-layout';
import type { WireGroup } from './wire';
import { channelsOnly } from './forum';

export const GENERAL_RE = /\bgeneral\b/i;
export const CHAT_ROOM_RE = /\bchat\b|\bcharla\b|\blobby\b|off.?topic/i;

/** Channel ids in the sidebar's order: categories by position, their channels by position, then the rest. */
function layoutOrder(layout: ChannelLayout | undefined): Map<string, number> {
  const order = new Map<string, number>();
  if (!layout) return order;
  const cat = new Map(layout.categories.map((c) => [c.id, c.position]));
  const rank = (id: string | null) => (id !== null && cat.has(id) ? cat.get(id)! : Infinity);
  [...layout.channels]
    .sort((a, b) => rank(a.categoryId) - rank(b.categoryId) || a.position - b.position)
    .forEach((c, i) => order.set(c.id, i));
  return order;
}

/** The general chat's group id, or null with no text channel. */
export function pickGeneralChat(groups: readonly WireGroup[], layout?: ChannelLayout): string | null {
  const text = channelsOnly(groups).filter((g) => g.kind === 'text');
  if (!text.length) return null;
  const named = text.find((g) => GENERAL_RE.test(g.name)) ?? text.find((g) => CHAT_ROOM_RE.test(g.name));
  if (named) return named.id;
  const order = layoutOrder(layout);
  const at = (g: WireGroup) => order.get(g.id) ?? Infinity;
  return text.reduce((best, g) => (at(g) < at(best) ? g : best)).id;
}
