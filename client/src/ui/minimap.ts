// The minimap: the island in a corner (the loading screen's drawing,
// ui/loading.ts), with the channels' houses (unread, "@"), the landmarks and
// the public places as icons (ui/mapIcons.ts), the people live in the village
// and you as an arrow. The corner map is zoomed in round you (north up, or
// turned with the camera); a click opens the whole island big, with every
// place named, and a click on a house or a place there walks you to it.
// The island is drawn once; the dots move a few times a second (main.ts).

import type { IslandPlan, Vec2 } from '../world/layout';
import type { LandmarkId } from '../world/landmarks';
import { islandMap, mapFeatures } from './loading';
import { MAP_MARKS, type MapMarkId } from './mapIcons';
import { vw } from '../i18n/village';

const NS = 'http://www.w3.org/2000/svg';

/** How far round you the corner map reaches (world units, its radius). */
export const MINIMAP_REACH = 9;
/** A mark's disc radius (world units): on the corner map, and on the big one. */
const MARK_R = 1.05, MARK_R_BIG = 0.95;

export interface MinimapHouse { id: string; name: string; pos: Vec2; unread: number; ping: boolean }
export interface MinimapState {
  houses: MinimapHouse[];
  landmarks: { id: LandmarkId; pos: Vec2 }[];
  /** The openGym hall (the gym channel's house), if the village has one. */
  gym?: { id: string; pos: Vec2 } | null;
  /** Everyone else connected and in the village. */
  people: Vec2[];
  /** You: where you are and which way you look, the camera's yaw (radians, like Math.atan2(dx, dz)). */
  me: { pos: Vec2; heading: number } | null;
  /** The camera's yaw (same measure), for the turning map. */
  cameraYaw: number;
}

/** A mark on the map: what it is and where. */
export interface MapPlace { id: MapMarkId; pos: Vec2 }

/** Degrees to turn the map so the camera's forward points up (world x right, z down on the map). */
export function mapTurn(cameraYaw: number): number {
  // Forward on the map is (sin yaw, cos yaw); up is (0, -1).
  return -90 - (Math.atan2(Math.cos(cameraYaw), Math.sin(cameraYaw)) * 180) / Math.PI;
}

/** Degrees to turn an arrow drawn pointing up so it points along `heading`. */
export function arrowTurn(heading: number): number {
  return (Math.atan2(Math.cos(heading), Math.sin(heading)) * 180) / Math.PI + 90;
}

/** The island's public places that never move (the plaza, park, track, pond, campfire, mill). */
export function islandPlaces(plan: IslandPlan): MapPlace[] {
  const f = mapFeatures(plan);
  const out: MapPlace[] = [{ id: 'plaza', pos: plan.plaza.c }];
  if (f.park) out.push({ id: 'park', pos: f.park });
  if (f.track) out.push({ id: 'track', pos: f.track.c });
  out.push({ id: 'pond', pos: plan.pond.c }, { id: 'campfire', pos: plan.campfire });
  if (f.mill) out.push({ id: 'mill', pos: f.mill });
  return out;
}

/** A mark's name on the map, in the village's language. */
export function markName(id: MapMarkId): string {
  return vw.mapPlaces[id];
}

/** The corner map's window round you (a square viewBox), or the whole island. */
export function minimapView(plan: IslandPlan, me: Vec2 | null, big: boolean): { x: number; y: number; size: number } {
  if (big || !me) {
    const R = plan.R + 1;
    return { x: -R, y: -R, size: 2 * R };
  }
  return { x: me.x - MINIMAP_REACH, y: me.z - MINIMAP_REACH, size: 2 * MINIMAP_REACH };
}

/** What to redraw: changes only when something on the map moved or changed. */
export function minimapSig(s: MinimapState, rotate: boolean): string {
  const r = (n: number) => n.toFixed(1);
  return [
    rotate ? r(s.cameraYaw * 10) : '',
    s.me ? `${r(s.me.pos.x)},${r(s.me.pos.z)},${r(s.me.heading * 10)}` : '',
    s.people.map((p) => `${r(p.x)},${r(p.z)}`).join(';'),
    s.houses.map((h) => `${h.id}:${r(h.pos.x)},${r(h.pos.z)}:${h.unread}:${h.ping ? 1 : 0}`).join(';'),
    s.landmarks.map((l) => l.id).join(','),
    s.gym ? `gym:${s.gym.id}` : '',
  ].join('|');
}

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, parent: Element): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  parent.appendChild(e);
  return e;
}

/** Draw a mark (disc and pictogram) at the origin of `g`, `r` world units across. */
export function drawMark(g: SVGGElement, id: MapMarkId, r: number): void {
  const m = MAP_MARKS[id];
  g.style.setProperty('--mk', m.color);
  g.style.setProperty('--ink', m.ink ?? '#ffffff');
  svgEl('circle', { class: 'mm-disc', r }, g);
  // The pictogram's 24-unit grid, scaled into the disc.
  const k = (r * 1.25) / 24;
  const pic = svgEl('g', { class: 'mm-pic', transform: `scale(${k.toFixed(4)}) translate(-12 -12)` }, g);
  if (m.glyph) svgEl('text', { x: 12, y: 19.5, 'text-anchor': 'middle', class: 'mm-glyph' }, pic).textContent = m.glyph;
  if (m.fill) svgEl('path', { d: m.fill, class: 'mm-fill' }, pic);
  if (m.stroke) svgEl('path', { d: m.stroke, class: 'mm-stroke' }, pic);
}

interface Label { g: SVGGElement; name: string; x: number; z: number; r: number; cls: string; fs: number }
interface Box { x0: number; x1: number; z0: number; z1: number }

/** Where a label goes round its mark (offsets from the mark, the text's anchor). */
function labelSpots(l: Label): { dx: number; dz: number; anchor: 'middle' | 'start' | 'end'; box: Box }[] {
  const w = l.name.length * l.fs * 0.6, h = l.fs * 1.05;
  const at = (dx: number, dz: number, anchor: 'middle' | 'start' | 'end') => {
    const x0 = l.x + dx - (anchor === 'middle' ? w / 2 : anchor === 'end' ? w : 0);
    return { dx, dz, anchor, box: { x0, x1: x0 + w, z0: l.z + dz - h * 0.8, z1: l.z + dz + h * 0.2 } };
  };
  return [at(0, l.r + l.fs * 1.15, 'middle'), at(0, -l.r - l.fs * 0.35, 'middle'), at(l.r + 0.3, l.fs * 0.35, 'start'), at(-l.r - 0.3, l.fs * 0.35, 'end')];
}

const overlaps = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.z0 < b.z1 && b.z0 < a.z1;

/** Name every mark and house on the big map, each where it covers the least (first come first served):
 *  a name over another name costs more than a name over an icon. */
export function placeLabels(labels: Label[], icons: { x: number; z: number; r: number }[]): void {
  const taken: { box: Box; cost: number }[] = icons.map((c) => ({ box: { x0: c.x - c.r, x1: c.x + c.r, z0: c.z - c.r, z1: c.z + c.r }, cost: 1 }));
  for (const l of labels) {
    const spots = labelSpots(l);
    let best = spots[0], least = Infinity;
    for (const sp of spots) {
      const n = taken.reduce((sum, t) => sum + (overlaps(t.box, sp.box) ? t.cost : 0), 0);
      if (n < least) { least = n; best = sp; }
      if (n === 0) break;
    }
    taken.push({ box: best.box, cost: 3 });
    svgEl('text', { class: l.cls, x: best.dx.toFixed(2), y: best.dz.toFixed(2), 'text-anchor': best.anchor }, l.g).textContent = l.name;
  }
}

export class Minimap {
  readonly el: HTMLElement;
  private svg: SVGSVGElement;
  /** Everything that turns with the camera. */
  private turn: SVGGElement;
  private dyn: SVGGElement;
  private sig = '';
  private places: MapPlace[];
  big = false;
  rotate = false;

  constructor(
    parent: HTMLElement,
    private plan: IslandPlan,
    private onHouse: (id: string) => void,
    /** A landmark or place clicked on the big map: go there. */
    private onPlace: (place: MapPlace) => void = () => {},
  ) {
    this.el = document.createElement('div');
    this.el.className = 'minimap';
    this.el.setAttribute('role', 'button');
    this.el.tabIndex = 0;
    this.el.title = vw.minimapOpen;
    this.el.setAttribute('aria-label', vw.minimapOpen);
    // The loading screen's island, without its made-up houses and villagers.
    this.svg = islandMap(plan);
    this.svg.setAttribute('class', 'minimap-svg');
    this.svg.querySelector('.lm-houses')?.remove();
    this.svg.querySelector('.lm-people')?.remove();
    this.places = islandPlaces(plan);
    this.setView(minimapView(plan, null, true));
    this.turn = document.createElementNS(NS, 'g');
    while (this.svg.firstChild) this.turn.appendChild(this.svg.firstChild);
    this.svg.appendChild(this.turn);
    this.dyn = svgEl('g', { class: 'mm-dyn' }, this.turn);
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'minimap-close';
    close.textContent = '×';
    close.title = vw.close;
    close.addEventListener('click', (e) => { e.stopPropagation(); this.setBig(false); });
    this.el.append(this.svg, close);
    // A click opens it big; on the big map a click on a house or a place goes there.
    this.el.addEventListener('click', (e) => {
      const target = e.target as Element;
      const house = target.closest('[data-house]');
      if (this.big && house) { this.onHouse(house.getAttribute('data-house')!); this.setBig(false); return; }
      const mark = target.closest('[data-place]');
      if (this.big && mark) {
        const i = Number(mark.getAttribute('data-place'));
        const place = this.shown[i];
        if (place) { this.onPlace(place); this.setBig(false); }
        return;
      }
      if (!this.big) this.setBig(true);
    });
    this.el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !this.big) { e.preventDefault(); this.setBig(true); }
      if (e.key === 'Escape' && this.big) { e.stopPropagation(); this.setBig(false); }
    });
    parent.appendChild(this.el);
  }

  /** The marks drawn last, in `data-place` order. */
  private shown: MapPlace[] = [];

  private setView(v: { x: number; y: number; size: number }): void {
    this.svg.setAttribute('viewBox', `${v.x.toFixed(2)} ${v.y.toFixed(2)} ${v.size.toFixed(2)} ${v.size.toFixed(2)}`);
  }

  setBig(on: boolean): void {
    this.big = on;
    this.el.classList.toggle('big', on);
    this.el.title = on ? '' : vw.minimapOpen;
    this.sig = '';
  }

  setShown(on: boolean): void {
    this.el.hidden = !on;
    if (!on) this.setBig(false);
  }

  /** Redraw what moved (a few times a second). */
  update(s: MinimapState): void {
    if (this.el.hidden) return;
    const sig = `${this.big ? 'B' : ''}${minimapSig(s, this.rotate)}`;
    if (sig === this.sig) return;
    this.sig = sig;
    const big = this.big;
    // The corner map follows you; the big one shows the whole island.
    this.setView(minimapView(this.plan, s.me?.pos ?? null, big));
    // Turned with the camera on the small map only (about you): the big one stays north up.
    const turn = this.rotate && !big ? mapTurn(s.cameraYaw) : 0;
    const pivot = s.me && !big ? s.me.pos : { x: 0, z: 0 };
    this.turn.setAttribute('transform', turn ? `rotate(${turn.toFixed(1)} ${pivot.x.toFixed(2)} ${pivot.z.toFixed(2)})` : '');
    // Labels and marks stay upright on a turned map.
    const up = (x: number, z: number) => (turn ? `translate(${x.toFixed(2)} ${z.toFixed(2)}) rotate(${(-turn).toFixed(1)})` : `translate(${x.toFixed(2)} ${z.toFixed(2)})`);
    this.dyn.replaceChildren();
    const labels: Label[] = [];
    const gymHouse = s.gym?.id ?? null;
    for (const h of s.houses) {
      // The gym's house is drawn as its mark instead.
      if (h.id === gymHouse) continue;
      const g = svgEl('g', { class: `mm-house${h.unread ? ' unread' : ''}${h.ping ? ' ping' : ''}`, transform: up(h.pos.x, h.pos.z), 'data-house': h.id }, this.dyn);
      svgEl('title', {}, g).textContent = h.name;
      svgEl('path', { d: 'M-0.8 -0.1L0 -0.9L0.8 -0.1V0.7H-0.8Z' }, g);
      if (h.ping) svgEl('text', { class: 'mm-ping', x: 0.9, y: -0.6, 'text-anchor': 'middle' }, g).textContent = '@';
      else if (h.unread) svgEl('circle', { class: 'mm-dot', cx: 0.75, cy: -0.75, r: 0.38 }, g);
      if (big) labels.push({ g, name: h.name, x: h.pos.x, z: h.pos.z, r: 0.85, cls: 'mm-name', fs: 0.8 });
    }
    // Landmarks and places: drawn over the houses, named on the big map.
    this.shown = [...this.places, ...s.landmarks, ...(s.gym ? [{ id: 'gym' as const, pos: s.gym.pos }] : [])];
    const r = big ? MARK_R_BIG : MARK_R;
    this.shown.forEach((p, i) => {
      const g = svgEl('g', { class: `mm-mark mm-${p.id}`, transform: up(p.pos.x, p.pos.z), 'data-place': i }, this.dyn);
      const name = markName(p.id);
      svgEl('title', {}, g).textContent = name;
      drawMark(g, p.id, r);
      if (big) labels.unshift({ g, name, x: p.pos.x, z: p.pos.z, r, cls: 'mm-name mm-mark-name', fs: 0.85 });
    });
    if (big) placeLabels(labels, [...this.shown.map((p) => ({ x: p.pos.x, z: p.pos.z, r })), ...s.houses.map((h) => ({ x: h.pos.x, z: h.pos.z, r: 0.85 }))]);
    for (const p of s.people) svgEl('circle', { class: 'mm-person', cx: p.x.toFixed(2), cy: p.z.toFixed(2), r: big ? 0.32 : 0.36 }, this.dyn);
    if (s.me) {
      const g = svgEl('g', { class: 'mm-me', transform: `translate(${s.me.pos.x.toFixed(2)} ${s.me.pos.z.toFixed(2)}) rotate(${arrowTurn(s.me.heading).toFixed(1)})${big ? '' : ' scale(1.2)'}` }, this.dyn);
      svgEl('path', { d: 'M0 -1.1L0.75 0.75L0 0.35L-0.75 0.75Z' }, g);
    }
  }
}
