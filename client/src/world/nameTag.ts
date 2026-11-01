// A name in a dark pill, as a sprite: pets wear one over their heads, people
// over their profile orb. Long names are cut with an ellipsis to fit the pill.

import * as THREE from 'three';

const FONT = '600 30px Inter, system-ui, sans-serif';
const MAX_W = 240;

/** `name`, shortened with "…" until it fits `max` pixels in `g`'s font. */
export function fitName(g: { measureText(t: string): { width: number } }, name: string, max: number): string {
  if (g.measureText(name).width <= max) return name;
  const chars = [...name];
  while (chars.length > 1 && g.measureText(chars.join('') + '…').width > max) chars.pop();
  return chars.join('') + '…';
}

/** The pill's texture (256 × 64). */
export function nameTagTexture(name: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d');
  if (g) {
    g.font = FONT;
    const text = fitName(g, name, MAX_W - 28);
    const w = Math.min(MAX_W, g.measureText(text).width + 28);
    g.fillStyle = 'rgba(16,16,20,0.75)';
    g.beginPath();
    g.roundRect((256 - w) / 2, 10, w, 44, 22);
    g.fill();
    g.fillStyle = '#fafafa';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 128, 33);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A name pill, 0.5 × 0.125 world units (scale it to taste). */
export function nameTag(name: string): THREE.Sprite {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: nameTagTexture(name), depthWrite: false, transparent: true }));
  s.scale.set(0.5, 0.125, 1);
  return s;
}
