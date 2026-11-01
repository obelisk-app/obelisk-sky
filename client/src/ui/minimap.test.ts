// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { Minimap, arrowTurn, islandPlaces, mapTurn, markName, minimapView, MINIMAP_REACH, type MinimapState } from './minimap';
import { MAP_MARKS, PLACE_MARKS } from './mapIcons';
import { LANDMARKS } from '../world/landmarks';
import { planIsland } from '../world/layout';

const plan = planIsland();
const state = (over: Partial<MinimapState> = {}): MinimapState => ({
  houses: [{ id: 'g1', name: 'Bitcoin', pos: { x: 3, z: 2 }, unread: 2, ping: false }, { id: 'g2', name: 'Nostr', pos: { x: -3, z: 1 }, unread: 0, ping: true }],
  landmarks: [{ id: 'lacrypta', pos: { x: 0, z: -5 } }],
  people: [{ x: 1, z: 1 }],
  me: { pos: { x: 0, z: 0 }, heading: 0 },
  cameraYaw: 0,
  ...over,
});

describe('the minimap', () => {
  it('turns the map so the camera looks up, and points your arrow where you face', () => {
    // A camera looking along +z (down the map) turns the map half round.
    expect(Math.abs(mapTurn(0)) % 360).toBeCloseTo(180);
    // Looking along -z (up the map already): no turn.
    expect(((mapTurn(Math.PI) % 360) + 360) % 360).toBeCloseTo(0);
    // Facing +x (right on the map): the arrow turns a quarter clockwise.
    expect(arrowTurn(Math.PI / 2)).toBeCloseTo(90);
    expect(arrowTurn(Math.PI)).toBeCloseTo(0);
  });

  it('draws the houses with their unread and "@", the landmarks, the people and you', () => {
    const m = new Minimap(document.body, plan, () => {});
    m.update(state());
    expect(m.el.querySelectorAll('.mm-house')).toHaveLength(2);
    expect(m.el.querySelector('[data-house="g1"] .mm-dot')).not.toBeNull();
    expect(m.el.querySelector('[data-house="g2"] .mm-ping')!.textContent).toBe('@');
    // La Crypta, and the island's own places (plaza, park, track, pond, campfire, mill).
    expect(m.el.querySelectorAll('.mm-mark')).toHaveLength(1 + islandPlaces(plan).length);
    expect(m.el.querySelector('.mm-lacrypta .mm-glyph')!.textContent).toBe('₿');
    expect(m.el.querySelectorAll('.mm-person')).toHaveLength(1);
    expect(m.el.querySelector('.mm-me')).not.toBeNull();
    // The loading screen's made-up houses and villagers aren't on it.
    expect(m.el.querySelector('.lm-houses, .lm-people')).toBeNull();
  });

  it('opens big on a click, and a house there walks you to it', () => {
    const go = vi.fn();
    const m = new Minimap(document.body, plan, go);
    m.update(state());
    m.el.querySelector<SVGGElement>('[data-house="g1"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(go).not.toHaveBeenCalled();
    expect(m.big).toBe(true);
    m.update(state());
    expect(m.el.querySelector('[data-house="g1"] .mm-name')!.textContent).toBe('Bitcoin');
    m.el.querySelector<SVGGElement>('[data-house="g1"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(go).toHaveBeenCalledWith('g1');
    expect(m.big).toBe(false);
  });

  it('turns with the camera only when asked, and never when big', () => {
    const m = new Minimap(document.body, plan, () => {});
    const turned = () => m.el.querySelector('svg > g')!.getAttribute('transform');
    m.update(state({ cameraYaw: 0.5 }));
    expect(turned()).toBe('');
    m.rotate = true;
    m.update(state({ cameraYaw: 0.5 }));
    expect(turned()).toMatch(/^rotate/);
    m.setBig(true);
    m.update(state({ cameraYaw: 0.5 }));
    expect(turned()).toBe('');
  });

  it('zooms the corner map in round you, and shows the whole island big', () => {
    const near = minimapView(plan, { x: 4, z: -2 }, false);
    expect(near.size).toBe(2 * MINIMAP_REACH);
    expect(near.x + near.size / 2).toBeCloseTo(4);
    expect(near.y + near.size / 2).toBeCloseTo(-2);
    const all = minimapView(plan, { x: 4, z: -2 }, true);
    expect(all.size).toBeGreaterThan(2 * plan.R);
    const m = new Minimap(document.body, plan, () => {});
    m.update(state({ me: { pos: { x: 4, z: -2 }, heading: 0 } }));
    expect(m.el.querySelector('svg')!.getAttribute('viewBox')).toBe(`${(4 - MINIMAP_REACH).toFixed(2)} ${(-2 - MINIMAP_REACH).toFixed(2)} ${(2 * MINIMAP_REACH).toFixed(2)} ${(2 * MINIMAP_REACH).toFixed(2)}`);
  });

  it('draws the gym as openGym\'s dumbbell instead of a plain house', () => {
    const m = new Minimap(document.body, plan, () => {});
    m.update(state({ gym: { id: 'g1', pos: { x: 3, z: 2 } } }));
    expect(m.el.querySelector('[data-house="g1"]')).toBeNull();
    expect(m.el.querySelector('.mm-gym .mm-fill')).not.toBeNull();
  });

  it('names every mark on the big map, and a click on one walks you there', () => {
    const goPlace = vi.fn();
    const m = new Minimap(document.body, plan, () => {}, goPlace);
    m.setBig(true);
    m.update(state({ gym: { id: 'g1', pos: { x: 3, z: 2 } } }));
    const names = [...m.el.querySelectorAll('.mm-mark-name')].map((t) => t.textContent);
    expect(names).toContain('openGym');
    expect(names).toContain('La Crypta');
    expect(names).toContain('Pond');
    m.el.querySelector<SVGGElement>('.mm-gym')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(goPlace).toHaveBeenCalledWith({ id: 'gym', pos: { x: 3, z: 2 } });
    expect(m.big).toBe(false);
    // On the corner map a click only opens it big.
    m.update(state({ gym: { id: 'g1', pos: { x: 3, z: 2 } } }));
    m.el.querySelector<SVGGElement>('.mm-gym')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(goPlace).toHaveBeenCalledTimes(1);
    expect(m.big).toBe(true);
  });

  it('has an icon and a name for every landmark and place', () => {
    for (const id of [...LANDMARKS.map((d) => d.id), ...PLACE_MARKS]) {
      const mk = MAP_MARKS[id];
      expect(mk.color).toMatch(/^#[0-9a-f]{6}$/);
      expect(mk.glyph || mk.fill || mk.stroke).toBeTruthy();
      expect(markName(id)).toBeTruthy();
    }
  });
});
