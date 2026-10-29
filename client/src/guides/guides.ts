// The guides (/guides, /es/guides; pages built by scripts/build-guides.mjs): the
// header's frosting and the articles' clips. The pages read fine without this.

import { mountHeader, mountOrbit } from '../landing/landing';

/** Each clip, in an article or a guide's card, plays like the landing page's orbit: muted
 *  and looping, only while on screen, never under reduced motion or Save-Data (the poster stays). */
export function mountGuide(doc: Document): void {
  const nav = doc.querySelector<HTMLElement>('.nav');
  if (nav) mountHeader(nav);
  for (const video of doc.querySelectorAll<HTMLVideoElement>('.g-clip video, .g-card video')) mountOrbit(video);
}

if (typeof document !== 'undefined' && document.body.classList.contains('g-page')) mountGuide(document);
