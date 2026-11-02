// Pets (Kenney Cube Pets, CC0, animated) that follow their owner around,
// wander a little while the owner stands still, and dance when the owner
// gets a reaction or a zap. Plus the hats people pick in the creator.

import * as THREE from 'three';
import { nameTag } from './nameTag';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { loadGltf } from './assets';
import type { Character } from './character';
import { CHAR_HEIGHT } from './character';
import type { Hat } from '../nostr/avatars';
import { Nostrich, NOSTRICH_HEIGHT } from './nostrich';

const PET_HEIGHT = 0.32;

/** Where a pet is and how it's going (pure: see `stepPet`). */
export interface PetMotion { x: number; z: number; yaw: number; vel: number; anim: 'idle' | 'walk' | 'run' }

/** Turn `a` toward `b` (radians) the short way, eased. */
function dampAngle(a: number, b: number, rate: number, dt: number): number {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + d * (1 - Math.exp(-rate * dt));
}

/**
 * Follow `target`: the farther behind, the faster (up to a sprint), with
 * speed eased so it settles at its owner's pace instead of lagging and
 * lunging; turns eased; walk/run chosen with a margin so the clip never
 * flickers between the two. Returns the distance moved.
 */
export function stepPet(m: PetMotion, target: { x: number; z: number }, dt: number): number {
  const dx = target.x - m.x, dz = target.z - m.z;
  const d = Math.hypot(dx, dz);
  const want = d < 0.15 ? 0 : Math.min(4.2, (d - 0.1) * 3);
  m.vel += (want - m.vel) * (1 - Math.exp(-dt * 7));
  const step = Math.min(d, Math.max(0, m.vel) * dt);
  if (d > 1e-4 && step > 0) {
    m.x += (dx / d) * step;
    m.z += (dz / d) * step;
    m.yaw = dampAngle(m.yaw, Math.atan2(dx, dz), 10, dt);
  }
  if (m.anim === 'run') { if (m.vel < 1.4) m.anim = m.vel > 0.12 ? 'walk' : 'idle'; }
  else if (m.anim === 'walk') { if (m.vel > 1.9) m.anim = 'run'; else if (m.vel < 0.08) m.anim = 'idle'; }
  else if (m.vel > 0.2) m.anim = m.vel > 1.9 ? 'run' : 'walk';
  return step;
}
/** Pets with wings fly beside you instead of walking. */
export const FLYING_PETS = new Set(['bee', 'parrot']);
/** How high a flying pet hovers (m), and its gentle bob. */
export const FLY_HEIGHT = 0.5;

/** How high a pet is off the ground at its own time `t` (s): fliers hover and bob, walkers hop in
 *  step with their speed, the nostrich none (its legs do the walking). `t` is the pet's clock, the
 *  frames' `dt` added up, never the page's (a frame-stepped recording or a slow frame would make
 *  it jump about: the pet flashed up and down). */
export function petLift(t: number, vel: number, flying: boolean, bird: boolean, phase = 0): number {
  if (flying) return FLY_HEIGHT + Math.sin(t * 2.6 + phase) * 0.06;
  return bird ? 0 : Math.abs(Math.sin(t * 9)) * 0.04 * Math.min(1, vel / 1.5);
}

/** A pet nostrich is long-legged: taller than the cube pets. */
const NOSTRICH_PET_HEIGHT = 0.5;

export class Pet {
  readonly root = new THREE.Group();
  private mixer: THREE.AnimationMixer | null = null;
  private actions = new Map<string, THREE.AnimationAction>();
  private current: THREE.AnimationAction | null = null;
  private wander: { x: number; z: number } | null = null;
  private danceFor = 0;
  private wanderIn = 2;
  readonly label: THREE.Sprite;

  private hopY = 0;
  /** The pet's own clock (s), from the frames' `dt`: its hop and hover keep to it. */
  private clock = 0;
  private motion: PetMotion;
  /** The owner's heading, eased: the heel spot doesn't swing round on a quick turn. */
  private heelYaw: number;
  /** The nostrich has no model file: it is built and animated in code. */
  private bird: Nostrich | null = null;
  private moved = 0;

  constructor(readonly kind: string, readonly name: string, private owner: Character) {
    this.root.position.copy(owner.root.position).add(new THREE.Vector3(0.5, 0, 0.4));
    this.motion = { x: this.root.position.x, z: this.root.position.z, yaw: 0, vel: 0, anim: 'idle' };
    this.heelYaw = owner.body.rotation.y;
    if (kind === 'nostrich') {
      this.bird = new Nostrich();
      this.bird.root.scale.setScalar(NOSTRICH_PET_HEIGHT / NOSTRICH_HEIGHT);
      this.root.add(this.bird.root);
    } else void loadGltf(`pets/${kind}`).then((g) => {
      const model = skeletonClone(g.scene);
      model.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(model);
      const s = PET_HEIGHT / Math.max(0.001, box.max.y - box.min.y);
      model.scale.setScalar(s);
      model.position.y = -box.min.y * s;
      model.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
      this.root.add(model);
      this.mixer = new THREE.AnimationMixer(model);
      for (const clip of g.animations) this.actions.set(clip.name, this.mixer.clipAction(clip));
      this.play('idle');
    }).catch(() => { /* no model: no pet */ });
    this.label = nameTag(name);
    this.label.position.y = (this.bird ? NOSTRICH_PET_HEIGHT : PET_HEIGHT) + 0.16;
    if (name) this.root.add(this.label);
  }

  dance(seconds = 2.5): void {
    this.danceFor = seconds;
  }

  private play(name: string): void {
    if (this.bird) { this.bird.mode = name as 'idle' | 'walk' | 'run' | 'dance'; return; }
    const a = this.actions.get(name);
    if (!a || a === this.current) return;
    a.reset().fadeIn(0.2).play();
    this.current?.fadeOut(0.2);
    this.current = a;
  }

  /** `groundAt`: raised ground (a bridge's arch, steps) the pet walks on. */
  update(dt: number, groundAt: (p: { x: number; z: number }) => number = () => 0): void {
    const o = this.owner.root.position;
    const p = this.root.position;
    // Heel position: a little behind and to the side of the owner.
    this.heelYaw = dampAngle(this.heelYaw, this.owner.body.rotation.y, 4, dt);
    const heading = this.heelYaw;
    const heel = { x: o.x - Math.sin(heading) * 0.55 + Math.cos(heading) * 0.3, z: o.z - Math.cos(heading) * 0.55 - Math.sin(heading) * 0.3 };
    let target = heel;
    const ownerMoving = this.owner.path.length > 0 || !!this.owner.external?.moving;
    if (!ownerMoving) {
      this.wanderIn -= dt;
      if (this.wanderIn <= 0) {
        this.wanderIn = 3 + Math.random() * 5;
        const a = Math.random() * Math.PI * 2;
        this.wander = { x: o.x + Math.cos(a) * 0.9, z: o.z + Math.sin(a) * 0.9 };
      }
      if (this.wander) target = this.wander;
    } else this.wander = null;
    const d = Math.hypot(target.x - p.x, target.z - p.z);
    this.danceFor = Math.max(0, this.danceFor - dt);
    const m = this.motion;
    m.x = p.x; m.z = p.z;
    this.moved = stepPet(m, target, dt);
    p.x = m.x; p.z = m.z;
    this.root.rotation.y = m.yaw;
    this.play(m.anim === 'idle' ? (this.danceFor > 0 ? 'dance' : 'idle') : m.anim);
    // The clip keeps pace with the feet.
    if (this.current && m.anim !== 'idle') this.current.timeScale = m.anim === 'run' ? THREE.MathUtils.clamp(m.vel / 2.6, 0.7, 1.6) : THREE.MathUtils.clamp(m.vel / 0.9, 0.5, 1.8);
    else if (this.current) this.current.timeScale = 1;
    // A little hop in step with its speed; fliers hover and bob instead.
    this.clock += dt;
    const flying = FLYING_PETS.has(this.kind);
    if (flying) this.root.rotation.z = Math.sin(this.clock * 2.1) * 0.08 - m.vel * 0.05;
    p.y = groundAt(p) + petLift(this.clock, m.vel, flying, !!this.bird, this.name.length);
    // The owner jumps: the pet jumps along, a beat later and a bit lower.
    this.hopY = THREE.MathUtils.damp(this.hopY, this.owner.jumpY * 0.6, 14, dt);
    p.y += this.hopY;
    if (d > 8) { p.set(heel.x, groundAt(heel), heel.z); m.vel = 0; } // teleported owner: catch up at once
    this.mixer?.update(dt);
    if (this.bird) {
      // Its own stride: the legs do the work.
      this.bird.update(dt, dt > 0 ? this.moved / dt / (NOSTRICH_PET_HEIGHT / NOSTRICH_HEIGHT) : 0);
      this.moved = 0;
    }
  }

  dispose(): void {
    this.mixer?.stopAllAction();
    this.root.removeFromParent();
  }
}

/** A hat on top of a blocky head. */
export function buildHat(kind: Hat, color: string): THREE.Object3D | null {
  if (kind === 'none') return null;
  const g = new THREE.Group();
  const m = new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.7 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x171717, flatShading: true });
  const gold = new THREE.MeshStandardMaterial({ color: 0xf2c94c, metalness: 0.7, roughness: 0.3, flatShading: true });
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    g.add(mesh);
    return mesh;
  };
  switch (kind) {
    case 'cap':
      add(new THREE.BoxGeometry(0.27, 0.07, 0.27), m, 0, 0.035, 0);
      add(new THREE.BoxGeometry(0.25, 0.015, 0.12), m, 0, 0.008, 0.18);
      break;
    case 'beanie':
      add(new THREE.SphereGeometry(0.15, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), m, 0, 0, 0).scale.set(1, 0.8, 1);
      add(new THREE.CylinderGeometry(0.155, 0.155, 0.045, 12), m, 0, 0.0, 0);
      add(new THREE.SphereGeometry(0.035, 6, 4), m, 0, 0.13, 0);
      break;
    case 'tophat':
      add(new THREE.CylinderGeometry(0.18, 0.18, 0.015, 16), dark, 0, 0.008, 0);
      add(new THREE.CylinderGeometry(0.11, 0.11, 0.2, 16), dark, 0, 0.11, 0);
      add(new THREE.CylinderGeometry(0.112, 0.112, 0.035, 16), m, 0, 0.035, 0);
      break;
    case 'crown':
      add(new THREE.CylinderGeometry(0.13, 0.13, 0.06, 10, 1, true), gold, 0, 0.03, 0);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        add(new THREE.ConeGeometry(0.03, 0.07, 4), gold, Math.cos(a) * 0.12, 0.09, Math.sin(a) * 0.12);
      }
      break;
    case 'headband':
      add(new THREE.CylinderGeometry(0.152, 0.152, 0.035, 12, 1, true), m, 0, -0.06, 0);
      break;
    case 'boina':
      add(new THREE.SphereGeometry(0.17, 12, 6), m, 0.02, 0.01, 0).scale.set(1, 0.32, 1);
      add(new THREE.CylinderGeometry(0.008, 0.008, 0.03, 5), m, 0.02, 0.06, 0);
      break;
  }
  g.position.y = CHAR_HEIGHT + 0.005;
  return g;
}
