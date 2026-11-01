// The map's marks: a coloured disc with a small white pictogram for every
// landmark, the gym and the island's public places (the plaza, the park, the
// track, the pond, the campfire, the mill). Pictograms are drawn on a 24-unit
// grid centred on (12, 12): `fill` shapes and `stroke` lines.

import type { LandmarkId } from '../world/landmarks';

export type PlaceMarkId = 'gym' | 'plaza' | 'park' | 'track' | 'pond' | 'campfire' | 'mill';
export type MapMarkId = LandmarkId | PlaceMarkId;

export interface MapMark {
  /** The disc. */
  color: string;
  /** The pictogram's colour (white unless the brand says otherwise). */
  ink?: string;
  fill?: string;
  stroke?: string;
  /** A character instead of a drawing (La Crypta's ₿). */
  glyph?: string;
}

/** A small circle as a path (for pictograms made of dots). */
const dot = (x: number, y: number, r: number) => `M${x - r} ${y}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;

export const MAP_MARKS: Record<MapMarkId, MapMark> = {
  lacrypta: { color: '#f7931a', glyph: '₿' },
  // A web of trust: three people and the lines between them.
  nostrwot: { color: '#7c5cff', stroke: 'M6 17L12 6.5L18 17Z', fill: `${dot(12, 6.5, 2.6)}${dot(6, 17, 2.6)}${dot(18, 17, 2.6)}` },
  // A cup with its handle and steam.
  coffee: { color: '#8a5a3b', fill: 'M5 10h11v4a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5z', stroke: 'M16 11.5h1.3a2.3 2.3 0 0 1 0 4.6H15.5M8.5 4v3M12.5 4v3' },
  // The grill: a bowl over two legs, smoke above.
  parrilla: { color: '#d8452b', fill: 'M4 10h16a8 6.5 0 0 1-16 0z', stroke: 'M8.5 15.5L6.5 21M15.5 15.5L17.5 21M9 3.5c1.5 1.5-1 2.5.5 4M14 3.5c1.5 1.5-1 2.5.5 4' },
  // Liberture's ring of orbs.
  liberture: { color: '#e0b43a', stroke: dot(12, 12, 6.5), fill: [0, 1, 2, 3, 4, 5].map((i) => dot(12 + Math.sin((i * Math.PI) / 3) * 6.5, 12 - Math.cos((i * Math.PI) / 3) * 6.5, 2.1)).join('') },
  // The cinema: play.
  theater: { color: '#b3202f', fill: 'M8.5 5.5v13l10.5-6.5z' },
  // The conference: a microphone on its stand.
  labitconf: { color: '#ff2d55', fill: 'M9.5 3h5v9.5a2.5 2.5 0 0 1-5 0z', stroke: 'M6.5 11.5a5.5 5.5 0 0 0 11 0M12 17v3.5M8.5 20.5h7' },
  // openGym: its dumbbell, lime on its near-black.
  gym: { color: '#0c0e12', ink: '#a3e635', fill: 'M2.5 9.5h2v5h-2zM5.5 7h3v10h-3zM15.5 7h3v10h-3zM19.5 9.5h2v5h-2zM8.5 11h7v2h-7z' },
  // The obelisk on its steps.
  plaza: { color: '#7d8a96', fill: 'M10.6 3.5h2.8l1.4 14h-5.6zM7 17.5h10v3H7z' },
  // The calisthenics park: a pull-up bar and someone hanging from it.
  park: { color: '#2f9b8f', stroke: 'M4.5 21V5M19.5 21V5M4.5 6.5h15M9.5 6.5l1.5 4.5M14.5 6.5l-1.5 4.5M12 14v5', fill: dot(12, 12.3, 2) },
  // The running track.
  track: { color: '#c8503c', stroke: 'M8 6.5h8a5.5 5.5 0 0 1 0 11H8a5.5 5.5 0 0 1 0-11zM8 10h8a2 2 0 0 1 0 4H8a2 2 0 0 1 0-4z' },
  // Water.
  pond: { color: '#3b9ad9', stroke: 'M3.5 9.5c2.5-2 4.5-2 7 0s4.5 2 7 0 2.5-1.2 3 0M3.5 15c2.5-2 4.5-2 7 0s4.5 2 7 0 2.5-1.2 3 0' },
  // A flame over crossed logs.
  campfire: { color: '#ea7a1a', fill: 'M12 2.5c1.2 3.8 5 4.8 5 9.3a5 5 0 0 1-10 0c0-2.8 1.8-3.8 2-5.8 1.4 1 2 2.5 2 3.6.6-1.6 1.5-4 1-7.1z', stroke: 'M5 21l14-3.2M5 17.8L19 21' },
  // The water wheel.
  mill: { color: '#5b7fa6', stroke: `${dot(12, 12, 7)}M12 5v14M5 12h14M7 7l10 10M17 7L7 17` },
};

/** Every landmark has a mark (world/landmarks LANDMARKS); kept in step by mapIcons.test.ts. */
export const PLACE_MARKS: readonly PlaceMarkId[] = ['gym', 'plaza', 'park', 'track', 'pond', 'campfire', 'mill'];
