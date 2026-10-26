// The hologram ring an official resident stands in (nostr-wot at its HQ, La
// Crypta at its door): a turning veil between two hoops over a tinted floor
// pad, all additive and unlit, so it glows by day and night without a light.
// `near` (you're close enough to talk) brightens it.

import * as THREE from 'three';

export interface Aura {
  group: THREE.Group;
  update(dt: number, t: number, near?: boolean): void;
  /** Something nice happened: a short flash. */
  pulse(): void;
}

export function buildAura(color: number, pad: number, r = 0.32, h = 0.55): Aura {
  const group = new THREE.Group();
  group.name = 'aura';
  const veilMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
  const ring = new THREE.Group();
  const veil = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 32, 1, true), veilMat);
  veil.position.y = h / 2 + 0.005;
  ring.add(veil);
  const hoopMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  const hoops: THREE.Mesh[] = [];
  for (const y of [0.04, h]) {
    const m = new THREE.Mesh(new THREE.TorusGeometry(r, 0.008, 6, 40), hoopMat);
    m.rotation.x = Math.PI / 2;
    m.position.y = y;
    ring.add(m);
    hoops.push(m);
  }
  group.add(ring);
  const padMat = new THREE.MeshBasicMaterial({ color: pad, transparent: true, opacity: 0.35, depthWrite: false });
  const floor = new THREE.Mesh(new THREE.CircleGeometry(r + 0.04, 32), padMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.012;
  group.add(floor);

  let flash = 0;
  let glow = 0;
  return {
    group,
    pulse() { flash = 1; },
    update(dt, t, near = false) {
      flash = Math.max(0, flash - dt * 1.2);
      glow += ((near ? 1 : 0) - glow) * Math.min(1, dt * 4);
      ring.rotation.y = t * (0.6 + glow * 0.6);
      veilMat.opacity = 0.08 + Math.sin(t * 2.4) * 0.04 + flash * 0.2 + glow * 0.12;
      padMat.opacity = 0.35 + glow * 0.25;
      hoops[1].position.y = h - 0.1 + Math.sin(t * 1.3) * 0.1;
    },
  };
}
