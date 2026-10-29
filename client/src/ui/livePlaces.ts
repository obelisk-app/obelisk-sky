// Who is really at a place, and whose messages show there.
//
// The channel list's "N here" counts only people connected to Obelisk Sky
// right now and publishing where they stand (live motion or a live
// activity claim, plus you when logged in), each counted at the one place
// they stand in. The villagers the director walks over from posts are not
// people in the village, so they don't count.
//
// A message's speech bubble shows only when its speaker is at the same
// place as you: a connected person by where they really stand, anyone else
// (walked over by the director) at the channel they posted in.

import type { Vec2 } from '../world/layout';

/** For each place, how many connected people stand there. */
export function hereCounts(
  people: Iterable<{ pk: string; pos: Vec2 }>,
  isLive: (pk: string) => boolean,
  placeOf: (pos: Vec2) => string | null,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const p of people) {
    if (!isLive(p.pk)) continue;
    const at = placeOf(p.pos);
    if (at) out.set(at, (out.get(at) ?? 0) + 1);
  }
  return out;
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
