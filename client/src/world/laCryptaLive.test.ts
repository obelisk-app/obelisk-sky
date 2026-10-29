// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { LIVE, LA_CRYPTA_CHANNEL, LA_CRYPTA_LIVE_SOURCE, buildLiveScreen, liveEmbedUrl, liveInView, liveOn, liveVolume } from './laCryptaLive';
import { LA_CRYPTA_BACK_Z, LA_CRYPTA_ROOM } from './lacrypta';
import { CHAR_HEIGHT } from './character';
import { YoutubeStage } from './youtubeStage';

describe('when La Crypta is live', () => {
  it('is on Tuesday evenings in Buenos Aires, 18:00 to 23:00', () => {
    // 27 Oct 2026 is a Tuesday; Buenos Aires is UTC−3.
    expect(liveOn(Date.parse('2026-10-27T22:00:00Z'))).toBe(true); // Tue 19:00
    expect(liveOn(Date.parse('2026-10-27T21:00:00Z'))).toBe(true); // Tue 18:00
    expect(liveOn(Date.parse('2026-10-28T01:59:00Z'))).toBe(true); // Tue 22:59
    expect(liveOn(Date.parse('2026-10-27T20:59:00Z'))).toBe(false); // Tue 17:59
    expect(liveOn(Date.parse('2026-10-28T02:00:00Z'))).toBe(false); // Tue 23:00
    expect(liveOn(Date.parse('2026-10-28T22:00:00Z'))).toBe(false); // Wed 19:00
    expect(liveOn(Date.parse('2026-10-26T22:00:00Z'))).toBe(false); // Mon 19:00
    expect(liveOn(Date.parse('2026-11-03T22:00:00Z'))).toBe(true); // the next Tuesday
  });

  it('keeps the player in the page while the camera is near, with some slack once it plays', () => {
    expect(liveInView(LIVE.VIEW_M - 1, false)).toBe(true);
    expect(liveInView(LIVE.VIEW_M + 1, false)).toBe(false);
    expect(liveInView(LIVE.VIEW_M + 1, true)).toBe(true);
    expect(liveInView(LIVE.VIEW_M + LIVE.VIEW_PAD + 0.1, true)).toBe(false);
  });

  it('sounds only behind the house, louder the nearer the screen', () => {
    expect(liveVolume({ x: 0, z: 0.5 })).toBe(0); // in front of the house
    expect(liveVolume({ x: 0, z: LIVE.Z - 1 })).toBe(100);
    expect(liveVolume({ x: 0, z: LIVE.Z - LIVE.HEAR_M - 0.5 })).toBe(0);
    let last = 101;
    for (let d = 0.5; d < LIVE.HEAR_M + 1; d += 0.5) {
      const v = liveVolume({ x: 0, z: LIVE.Z - d });
      expect(v % 10).toBe(0);
      expect(v).toBeLessThanOrEqual(last);
      last = v;
    }
  });
});

describe('the live embed', () => {
  it('plays whatever La Crypta’s channel has live, muted and autoplaying, driven by messages', () => {
    const u = new URL(liveEmbedUrl('https://sky.obelisk.ar'));
    expect(u.origin).toBe('https://www.youtube-nocookie.com');
    expect(u.pathname).toBe('/embed/live_stream');
    expect(u.searchParams.get('channel')).toBe(LA_CRYPTA_CHANNEL);
    expect(u.searchParams.get('autoplay')).toBe('1');
    expect(u.searchParams.get('mute')).toBe('1');
    expect(u.searchParams.get('enablejsapi')).toBe('1');
    expect(u.searchParams.get('origin')).toBe('https://sky.obelisk.ar');
    expect(u.searchParams.has('loop')).toBe(false);
  });

  it('goes over the screen, stays playing while hidden, and sounds at the volume it is given', () => {
    const parent = document.createElement('div');
    const canvas = document.createElement('canvas');
    parent.append(canvas);
    document.body.append(parent);
    const { group, screen } = buildLiveScreen();
    group.updateMatrixWorld(true);
    const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.08, 100);
    camera.position.set(0, 1.4, LIVE.Z - 4);
    camera.lookAt(0, LIVE.Y, LIVE.Z);
    camera.updateMatrixWorld(true);
    const stage = new YoutubeStage(parent, canvas, screen, LIVE.W, LIVE.H, LA_CRYPTA_LIVE_SOURCE, 'lacrypta-live');
    stage.setSize(800, 450);
    stage.update(camera, true, 0, true);
    const layer = canvas.nextElementSibling as HTMLElement;
    expect(layer.className).toBe('lacrypta-live');
    const f = parent.querySelector('iframe')!;
    expect(f.src).toBe(liveEmbedUrl(location.origin));
    expect(f.title).toBe('La Crypta en vivo');
    expect(layer.style.display).toBe('');
    // Something in front: the layer hides, the player stays.
    stage.update(camera, true, 0, false);
    expect(layer.style.display).toBe('none');
    expect(parent.querySelectorAll('iframe')).toHaveLength(1);
    const sent: { func: string; args: unknown[] }[] = [];
    f.contentWindow!.postMessage = ((m: string) => { sent.push(JSON.parse(m)); }) as typeof window.postMessage;
    stage.setSound(true, 40);
    expect(sent.find((m) => m.func === 'setVolume')?.args).toEqual([40]);
    sent.length = 0;
    stage.setSound(true, 40);
    expect(sent).toHaveLength(0);
    stage.setSound(true, 70);
    expect(sent.find((m) => m.func === 'setVolume')?.args).toEqual([70]);
    stage.update(camera, false);
    expect(parent.querySelectorAll('iframe')).toHaveLength(0);
    parent.remove();
  });
});

describe('the screen on the back wall', () => {
  it('hangs on the back wall, facing out of it, over the heads and within the wall', () => {
    const { group, screen } = buildLiveScreen();
    group.updateMatrixWorld(true);
    expect(screen.name).toBe('lacrypta-live-screen');
    const normal = new THREE.Vector3(0, 0, 1).transformDirection(screen.matrixWorld);
    expect(normal.z).toBeCloseTo(-1);
    expect(screen.position.z).toBeLessThan(LA_CRYPTA_BACK_Z);
    expect(screen.position.z).toBeGreaterThan(LA_CRYPTA_BACK_Z - 0.1);
    expect(Math.abs(LIVE.X) + LIVE.W / 2 + 0.04).toBeLessThan(LA_CRYPTA_ROOM.maxX);
    expect(LIVE.Y - LIVE.H / 2).toBeGreaterThan(CHAR_HEIGHT + 0.2);
    expect(LIVE.W / LIVE.H).toBeCloseTo(16 / 9);
  });
});
