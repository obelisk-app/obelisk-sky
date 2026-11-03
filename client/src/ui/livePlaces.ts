// Who is really at a place, and whose messages show there.
//
// The channel list counts, by default, everyone active on the relay
// (`relayTally`): whoever wrote in one of its channels lately, from Sky or
// any other app, plus everyone connected to Obelisk Sky right now. Each
// channel's "N here" is who wrote in it lately or stands at its place now.
// The count line toggles to Sky only (`liveTally`, prefs `countSkyOnly`):
// people connected to Obelisk Sky right now (live motion or a live activity
// claim, plus you when logged in), all of them once in "N in the village",
// then each at the one place they stand in or "around" when they stand at
// none. The villagers the director walks over from posts are not people in
// the village, so they don't count there.
//
// A message's speech bubble shows only when its speaker is at the same
// place as you: a connected person by where they really stand, anyone else
// (walked over by the director) at the channel they posted in.

import type { Vec2 } from '../world/layout';

/** Everyone counted, once each in `total`: how many at each place, and how many at none (on the plaza, a road,
 *  between yards, at a landmark, or not drawn yet). For `liveTally` the total is the places' sum plus `around`;
 *  for `relayTally` one person can count at several channels (they wrote in each lately). */
export interface LiveTally { total: number; byPlace: Map<string, number>; around: number }

export function liveTally(
  livePks: Iterable<string>,
  positionOf: (pk: string) => Vec2 | null,
  placeOf: (pos: Vec2) => string | null,
): LiveTally {
  const byPlace = new Map<string, number>();
  const seen = new Set<string>();
  let around = 0;
  for (const pk of livePks) {
    if (seen.has(pk)) continue;
    seen.add(pk);
    const pos = positionOf(pk);
    const at = pos ? placeOf(pos) : null;
    if (at) byPlace.set(at, (byPlace.get(at) ?? 0) + 1);
    else around++;
  }
  return { total: seen.size, byPlace, around };
}

/** How long after their last message someone still counts as active on the relay. */
export const RELAY_ACTIVE_MS = 15 * 60_000;

/** A message on the relay, for the relay-wide count: who, when (seconds), and the channel it counts toward. */
export interface RelayPost { pubkey: string; created_at: number; channel: string }

/**
 * Everyone active on the relay: who wrote in a channel since `sinceSec`, plus
 * everyone connected to Sky (`livePks`). A channel counts who wrote in it
 * lately or stands at its place now, once each; `around` is whoever is in
 * the total but counted at no channel (connected, standing at none, and
 * quiet lately).
 */
export function relayTally(
  posts: Iterable<RelayPost>,
  sinceSec: number,
  livePks: Iterable<string>,
  positionOf: (pk: string) => Vec2 | null,
  placeOf: (pos: Vec2) => string | null,
): LiveTally {
  const at = new Map<string, Set<string>>();
  const everyone = new Set<string>();
  const add = (place: string, pk: string) => {
    let set = at.get(place);
    if (!set) at.set(place, (set = new Set()));
    set.add(pk);
  };
  for (const p of posts) {
    if (p.created_at < sinceSec) continue;
    everyone.add(p.pubkey);
    add(p.channel, p.pubkey);
  }
  for (const pk of livePks) {
    everyone.add(pk);
    const pos = positionOf(pk);
    const place = pos ? placeOf(pos) : null;
    if (place) add(place, pk);
  }
  const placed = new Set<string>();
  const byPlace = new Map<string, number>();
  for (const [place, set] of at) {
    byPlace.set(place, set.size);
    for (const pk of set) placed.add(pk);
  }
  return { total: everyone.size, byPlace, around: everyone.size - placed.size };
}

/** Where a speaker is for their message: a live person where they stand, anyone else at the channel they posted in. */
export function speakerPlace(live: boolean, standing: string | null, postedIn: string): string | null {
  return live ? standing : postedIn;
}

/** Show the bubble only to someone at the same place as the speaker (nowhere matches nothing); the relay's general chat (`general`)
 *  to everyone, wherever they are. */
export function bubbleShown(yourPlace: string | null, speakerAt: string | null, general = false): boolean {
  return general || (!!yourPlace && yourPlace === speakerAt);
}
