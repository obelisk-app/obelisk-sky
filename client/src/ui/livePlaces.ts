// Who is really at a place, and whose messages show there.
//
// The channel list counts only people connected to Obelisk Sky right now
// (live motion or a live activity claim, plus you when logged in): all of
// them once in "N in the village", then each at the one place they stand in
// ("N here" on its channel) or "around" when they stand at none. The
// villagers the director walks over from posts are not people in the
// village, so they don't count.
//
// A message's speech bubble shows only when its speaker is at the same
// place as you: a connected person by where they really stand, anyone else
// (walked over by the director) at the channel they posted in.

import type { Vec2 } from '../world/layout';

/** Everyone connected, once each: the total, how many stand at each place, and how many at none (on the plaza, a road,
 *  between yards, at a landmark, or not drawn yet). `total` is always the places' sum plus `around`. */
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

/** Where a speaker is for their message: a live person where they stand, anyone else at the channel they posted in. */
export function speakerPlace(live: boolean, standing: string | null, postedIn: string): string | null {
  return live ? standing : postedIn;
}

/** Show the bubble only to someone at the same place as the speaker (nowhere matches nothing); the relay's general chat (`general`)
 *  to everyone, wherever they are. */
export function bubbleShown(yourPlace: string | null, speakerAt: string | null, general = false): boolean {
  return general || (!!yourPlace && yourPlace === speakerAt);
}
