// A resident: a Quaternius humanoid (people/people.ts) dressed in their
// look, an avatar badge over the head, an animation mixer and a simple
// path follower.
//
// Animation runs in two layers on one mixer: the lower body (root, pelvis,
// legs) and the upper body (spine, arms, head) each play a clip, usually
// the same one. Splitting them lets someone sit and sip mate at once
// (sitting legs, drinking arms) without authoring a combined clip. Walk,
// jog and sprint are chosen by speed, with their playback rate matched to
// the ground speed measured from the library's root-motion versions, so
// feet don't slide.

import * as THREE from 'three';
import { GRAVITY, JUMP_SPEED, SWIM_SPEEDS } from '../player/controller';
import { buildPerson, defaultLook, loadLook, peopleClips, MODEL_HEIGHT, setBare, type PersonLook } from '../people/people';
import { hashStr, type Vec2 } from './layout';
import { SangreFx } from './sangre';
import { clipPhase } from './emotes';
import { SADDLE_HEIGHT } from './nostrich';
import { readArmPose, type ArmPose } from './fpHands';

export const CHAR_HEIGHT = 0.72;
const SCALE = CHAR_HEIGHT / MODEL_HEIGHT;
/** People's model units (metres) → world units. */
export const PERSON_SCALE = SCALE;
const WALK_SPEED = 0.62;
const RUN_SPEED = 2.4;

/** Badge height above the head bone (world units). */
const BADGE_ABOVE_HEAD = 0.3;

/** Smooth lift, bite/sip, and return; roasting has a longer resting interval. */
function propLift(clock: number, roast: boolean): number {
  const t = clock % (roast ? 9 : 6);
  const k = t < 0.5 ? t / 0.5 : t < 1.3 ? 1 : t < 1.8 ? 1 - (t - 1.3) / 0.5 : 0;
  return k * k * (3 - 2 * k);
}

/** How high the sitting clip expects the seat (≈0.45 m), in world units. */
export const SIT_SEAT_HEIGHT = 0.45 * SCALE;

/** Ground speed of each locomotion clip at playback rate 1, in world units/s. */
export const CLIP_SPEED = { Walk_Loop: 0.97 * SCALE, Jog_Fwd_Loop: 5.36 * SCALE, Sprint_Loop: 8.25 * SCALE } as const;

/** The locomotion clip for a ground speed, and the rate that matches it. */
export function gaitFor(speed: number, running = speed >= 1.0): { clip: keyof typeof CLIP_SPEED; rate: number } {
  // Walking is always the walk cycle; running jogs, or sprints when fast.
  const clip = !running ? 'Walk_Loop' : speed < 2.9 ? 'Jog_Fwd_Loop' : 'Sprint_Loop';
  return { clip, rate: THREE.MathUtils.clamp(speed / CLIP_SPEED[clip], 0.5, 2) };
}

const LOWER = /^(root|pelvis|thigh_|calf_|foot_|ball_)/;

/** One clip's tracks for the lower or the upper body. */
const halves = new Map<string, THREE.AnimationClip>();
function half(clip: THREE.AnimationClip, part: 'L' | 'U'): THREE.AnimationClip {
  const key = `${clip.name}|${part}`;
  let c = halves.get(key);
  if (!c) {
    const tracks = clip.tracks.filter((t) => LOWER.test(t.name.split('.')[0]) === (part === 'L'));
    c = new THREE.AnimationClip(key, clip.duration, tracks);
    halves.set(key, c);
  }
  return c;
}

/** One pose of a clip, held: every track sampled at time `t`. */
export function freezeClip(clip: THREE.AnimationClip, t: number, name: string): THREE.AnimationClip {
  const tracks = clip.tracks.map((tr) => {
    const v = (tr as unknown as { createInterpolant(): THREE.Interpolant }).createInterpolant().evaluate(t).slice();
    const T = tr.constructor as new (n: string, times: number[], values: number[]) => THREE.KeyframeTrack;
    return new T(tr.name, [0, 1], [...v, ...v]);
  });
  return new THREE.AnimationClip(name, 1, tracks);
}

/** Clips sky adds at runtime (keyframed exercises). */
const extraClips = new Map<string, THREE.AnimationClip>();
export function registerClip(clip: THREE.AnimationClip): void {
  extraClips.set(clip.name, clip);
}

export type Activity = 'idle' | 'walk' | 'run' | 'sit' | 'talk' | 'cheer' | 'hidden';

const badgeCache = new Map<string, THREE.Texture>();

/** Badge texture size: 256 on high and ultra (crisp at DPR 2), 128 below. */
let badgeRes = 128;
export function setBadgeResolution(px: number): void {
  if (px === badgeRes) return;
  badgeRes = px;
  // Badges already drawn keep theirs; new ones are drawn at the new size.
  badgeCache.clear();
}

/**
 * A badge's cache key. The ring is the person's own colour (or the official
 * mark), so two people with one picture don't share a texture.
 */
export function badgeCacheKey(pk: string, avatar: string, mark: string | null): string {
  return `${avatar}|${mark ?? ''}|${pk}|${badgeRes}`;
}

/** Where a picture is asked for after its host refused CORS: sky's own server (server/avatarProxy.ts). */
export function proxiedAvatar(url: string): string {
  return `/api/avatar?url=${encodeURIComponent(url)}`;
}

/**
 * Load a picture we can draw into WebGL: straight from its host when it sends
 * CORS, else through the server. Null when neither works (the letter stays).
 * One load per URL, shared by everyone wearing it.
 */
const pictures = new Map<string, Promise<HTMLImageElement | null>>();
export function loadPicture(url: string): Promise<HTMLImageElement | null> {
  let p = pictures.get(url);
  if (!p) {
    const one = (src: string) => new Promise<HTMLImageElement | null>((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.referrerPolicy = 'no-referrer';
      img.decoding = 'async';
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
    p = one(url).then((img) => img ?? (/^https?:/i.test(url) ? one(proxiedAvatar(url)) : null));
    pictures.set(url, p);
  }
  return p;
}

export function pubkeyColor(pk: string): string {
  const h = hashStr(pk) % 360;
  return `hsl(${h} 70% 58%)`;
}

function drawBadge(pk: string, name: string, img: HTMLImageElement | null, mark: string | null = null): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = badgeRes;
  const g = c.getContext('2d')!;
  // Drawn on a 128 grid, scaled to the texture size.
  g.scale(badgeRes / 128, badgeRes / 128);
  g.imageSmoothingQuality = 'high';
  g.beginPath();
  g.arc(64, 64, 60, 0, Math.PI * 2);
  g.fillStyle = '#fff';
  g.fill();
  g.save();
  g.beginPath();
  g.arc(64, 64, 52, 0, Math.PI * 2);
  g.clip();
  if (img) {
    // The centre square; an SVG without a size of its own just fills the circle.
    const w = img.naturalWidth, h = img.naturalHeight;
    if (w > 0 && h > 0) {
      const s = Math.min(w, h);
      g.drawImage(img, (w - s) / 2, (h - s) / 2, s, s, 12, 12, 104, 104);
    } else g.drawImage(img, 12, 12, 104, 104);
  } else {
    g.fillStyle = pubkeyColor(pk);
    g.fillRect(0, 0, 128, 128);
    g.fillStyle = '#fff';
    g.font = 'bold 60px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(([...name.replace(/^@/, '')][0] || '?').toUpperCase(), 64, 68);
  }
  g.restore();
  g.lineWidth = mark ? 9 : 6;
  g.strokeStyle = mark ?? pubkeyColor(pk);
  g.beginPath();
  g.arc(64, 64, 58, 0, Math.PI * 2);
  g.stroke();
  if (mark) {
    // A check seal at the lower right: this account is the official one.
    g.fillStyle = mark;
    g.beginPath();
    g.arc(104, 104, 20, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#fff';
    g.lineWidth = 6;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.beginPath();
    g.moveTo(94, 104);
    g.lineTo(101, 111);
    g.lineTo(115, 96);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const BAR_AXIS = new THREE.Vector3(1, 0, 0);

export class Character {
  readonly root = new THREE.Group();
  readonly body = new THREE.Group();
  private model: THREE.Object3D | null = null;
  private bones = new Map<string, THREE.Bone>();
  private materials: THREE.Material[] = [];
  private mixer: THREE.AnimationMixer | null = null;
  private actions = new Map<string, THREE.AnimationAction>();
  private lowerKey = '';
  private upperKey = '';
  readonly badge: THREE.Sprite;
  /** Online (a green dot) or away (an AFK tag) beside the badge; none when offline. */
  private presenceMark: THREE.Sprite | null = null;
  private presenceNow: 'online' | 'afk' | 'offline' = 'offline';
  private badgeKey = '';
  /** The body's fade (spawning, leaving): the badge follows it, dimmed further while AFK. */
  private fade = 1;
  path: Vec2[] = [];
  running = false;
  activity: Activity = 'idle';
  private facing: number | null = null;
  private onArrive: (() => void) | null = null;
  /** Seconds until an emote returns to idle/talk. */
  private emoteFor = 0;
  talkingFor = 0;
  opacity = 0;
  targetOpacity = 1;
  /** Seconds standing still; drives idle wandering in world.ts. */
  idleFor = 0;
  name: string;
  /** Vertical offset (balloon arrivals). */
  lift = 0;
  /** Height of the seat while sitting on a bench or stool. */
  seatY = 0;
  /** On a nostrich's back (world.ts riders): seated at SADDLE_HEIGHT, carried along. */
  riding = false;
  /** In deep water (world.ts): the body floats with its root at `swimY` and
   *  plays `swimClip` (a breaststroke built for this body), slower when idle. */
  swimming = false;
  swimY = 0;
  swimClip: string | null = null;
  /** Shirt off (setShirtless). */
  private shirtless = false;
  /** The mate (or cup) in hand while sitting, if any (kept in the left hand). */
  mate: THREE.Object3D | null = null;
  /** Passing the mate along a bench: the left hand reaches toward `reach`
   *  (world space) by `reachK` (0..1), mate in hand or not (world.ts rounds). */
  reach = new THREE.Vector3();
  reachK = 0;
  /** Out of view (world.ts): keep walking, skip posing; the mixer catches up when seen. */
  offscreen = false;
  /** Lift that puts this body's soles on the ground (measureSoles). */
  soleLift = 0;
  private skipped = 0;
  /** A barbell held in both hands (the gym): kept between the palms. */
  heldBar: THREE.Object3D | null = null;
  private hat: THREE.Object3D | null = null;
  look: PersonLook;
  private lookKey = '';
  /** Height of your feet (viewer-driven only): a jump, or standing on a bench. */
  jumpY = 0;
  /** How far the body floats (0 on land, 1 afloat), eased. */
  private floatK = 0;
  /** A remote person's jump (from their motion event): its vertical speed. */
  private hopVy = 0;
  /** Raised ground under someone the world walks (stairs, a floor up a
   *  storey); the viewer's comes with jumpY instead. Set by world.ts. */
  groundY = 0;
  /** In the air (viewer-driven): standing on a bench isn't. */
  private driveAirborne = false;
  private airborne = false;
  private landFor = 0;
  /** A looping exercise clip in progress (calisthenics), if any. */
  exercise: string | null = null;
  /** An emote played while standing still (emotes.ts); moving ends it. */
  emote: { kind: string; lower: string; upper: string; grounded?: boolean } | null = null;
  private emoteLeft = Infinity;
  /** When the current emote began (wall clock, ms; the sender's, for someone remote): the first dancer picks the music. */
  emoteSince = 0;
  /** The wall-clock time (ms) the emote's clip counts its rounds from, so every
   *  screen plays it on the same beat (emotes.ts emoteAnchor); null: unsynced. */
  emoteAnchor: number | null = null;
  /** The "Sangreee..." emote's knives and blood (sangre.ts), while it plays. */
  sangre: SangreFx | null = null;
  /** Called as each foot comes down walking or running (main.ts: your footsteps). */
  onStep: ((running: boolean) => void) | null = null;
  /** Which foot is lowest while walking (a change is a step), and whether it's walking at all this frame. */
  private lowFoot: 'l' | 'r' | null = null;
  private striding = false;
  /** False while first person hides this body (world.ts setBodyDrawn): its props hide too. */
  bodyDrawn = true;
  /** Ground speed this frame, for picking and pacing the gait. */
  /** Ground speed, measured (m/s, eased). */
  speed = 0;
  private lastPos = new THREE.Vector3();
  sipClock: number;

  constructor(readonly pk: string, name: string) {
    this.name = name;
    this.look = defaultLook(hashStr(pk));
    this.sipClock = (hashStr(pk) % 60) / 10;
    this.root.add(this.body);
    this.badge = new THREE.Sprite(new THREE.SpriteMaterial({ map: drawBadge(pk, name, null), depthWrite: false, transparent: true }));
    this.badge.scale.setScalar(0.32);
    this.badge.position.y = CHAR_HEIGHT + 0.22;
    this.badge.renderOrder = 5;
    this.root.add(this.badge);
    this.root.userData.pk = pk;
    this.setLook(this.look);
    this.setOpacity(0);
  }

  /** Dress this character (rebuilds the model once its files are loaded). */
  setLook(look: PersonLook): void {
    const key = JSON.stringify(look);
    if (key === this.lookKey && this.model) return;
    this.lookKey = key;
    this.look = look;
    const person = buildPerson(look);
    if (!person) {
      void loadLook(look).then(() => { if (this.lookKey === key) { this.lookKey = ''; this.setLook(look); } }).catch(() => {});
      return;
    }
    this.mixer?.stopAllAction();
    this.model?.removeFromParent();
    const model = person.root;
    model.scale.setScalar(SCALE);
    this.model = model;
    this.bones = person.bones;
    this.materials = person.materials;
    this.body.add(model);
    this.mixer = new THREE.AnimationMixer(model);
    this.actions.clear();
    this.lowerKey = this.upperKey = '';
    this.setOpacity(this.opacity);
    this.pose('Idle_Loop', 'Idle_Loop', 0);
    this.soleLift = this.measureSoles(model);
    if (this.shirtless) this.applyShirtless();
  }

  /** Shirt off (a man swimming, world.ts): the outfit's top hides and his bare chest and arms show.
   *  A look without a shirt (PersonLook.shirtless) stays bare either way. */
  setShirtless(on: boolean): void {
    if (on === this.shirtless) return;
    this.shirtless = on;
    this.applyShirtless();
  }

  private applyShirtless(): void {
    if (this.model) setBare(this.model, this.shirtless || (!!this.look.shirtless && this.look.body === 'm'));
  }

  /** How far this body's shoes reach below its origin standing idle (the
   *  clips crouch a touch): standing and walking lift it back by that much,
   *  so soles rest on the ground instead of in it. */
  private measureSoles(model: THREE.Object3D): number {
    this.mixer?.update(0);
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model, true);
    if (box.isEmpty()) return 0;
    const origin = this.body.getWorldPosition(new THREE.Vector3()).y;
    return THREE.MathUtils.clamp(origin - box.min.y, 0, 0.06);
  }

  /** Avatars v1 named a blocky skin: map the letter to a stable look. */
  setSkin(letter: string): void {
    this.setLook(defaultLook(hashStr(`${this.pk}:${letter}`)));
  }

  setHat(hat: THREE.Object3D | null): void {
    this.hat?.removeFromParent();
    this.hat = hat;
    if (hat) {
      // Hats were made for the old, larger blocky heads.
      hat.scale.setScalar(0.42);
      this.body.add(hat);
    }
    this.badge.position.y = CHAR_HEIGHT + 0.22 + (hat ? 0.06 : 0);
  }

  /** A ring colour that marks someone official (the nostr-wot account's indigo). */
  private mark: string | null = null;

  setBadgeMark(color: string): void {
    this.mark = color;
    this.badgeKey = '';
    this.setProfile(this.name, this.avatarUrl);
  }

  private avatarUrl: string | null = null;

  setProfile(name: string, avatar: string | null): void {
    this.name = name;
    this.avatarUrl = avatar;
    const key = `${name}|${avatar ?? ''}|${this.mark ?? ''}`;
    if (key === this.badgeKey) return;
    this.badgeKey = key;
    const cacheKey = avatar ? badgeCacheKey(this.pk, avatar, this.mark) : '';
    const cached = avatar ? badgeCache.get(cacheKey) : undefined;
    const mat = this.badge.material;
    if (cached) { mat.map = cached; mat.needsUpdate = true; return; }
    mat.map = drawBadge(this.pk, name, null, this.mark);
    mat.needsUpdate = true;
    if (avatar) {
      void loadPicture(avatar).then((img) => {
        // A newer name or picture came meanwhile: this one's stale.
        if (!img || this.badgeKey !== key) return;
        const t = badgeCache.get(cacheKey) ?? drawBadge(this.pk, name, img, this.mark);
        badgeCache.set(cacheKey, t);
        mat.map = t;
        mat.needsUpdate = true;
      });
    }
  }

  get pos(): Vec2 {
    return { x: this.root.position.x, z: this.root.position.z };
  }

  place(p: Vec2): void {
    this.root.position.set(p.x, 0, p.z);
    this.lastPos.copy(this.root.position);
    this.path = [];
  }

  walk(path: Vec2[], run = false, onArrive?: () => void): void {
    this.path = path;
    this.running = run;
    this.onArrive = onArrive ?? null;
    this.idleFor = 0;
    if (this.activity === 'sit') this.activity = 'idle';
    this.exercise = null;
    if (!path.length) { const cb = this.onArrive; this.onArrive = null; cb?.(); }
  }

  /** Walking and running speeds when someone real steers this character
   *  from another browser (their controller's, so both screens keep pace). */
  pace: { walk: number; run: number } | null = null;

  /** Stop where you are and forget where you were going (and why). */
  halt(): void {
    this.path = [];
    this.onArrive = null;
  }

  /** Set while the viewer steers this character (it ignores paths). */
  external: { moving: boolean; running: boolean } | null = null;

  /** Jump where you stand (someone jumping in another browser): the same
   *  take-off speed and gravity as the player's controller. */
  jump(): void {
    if (this.external || this.activity === 'sit' || this.exercise) return;
    if (this.jumpY > 0.02) return;
    this.hopVy = JUMP_SPEED;
  }

  /** Viewer-driven movement: position and heading come from the controller. */
  drive(x: number, z: number, heading: number, moving: boolean, running: boolean, jumpY = 0, airborne = jumpY > 0.015): void {
    this.root.position.x = x;
    this.root.position.z = z;
    this.jumpY = jumpY;
    this.driveAirborne = airborne;
    this.path = [];
    if (moving) {
      this.facing = heading;
      this.idleFor = 0;
      if (this.activity === 'sit') this.activity = 'idle';
      this.exercise = null;
      this.emote = null;
    }
    this.external = { moving, running };
  }

  /** Forget the viewer's last movement (moving, airborne, height) when the
   *  character is put somewhere by the world: a seat, a training station. */
  resetDrive(): void {
    this.external = null;
    this.jumpY = 0;
    this.driveAirborne = false;
    this.airborne = false;
    this.landFor = 0;
  }

  /** Turn to face `yaw` (radians, atan2(dx, dz)), as a remote player standing still does. */
  face(yaw: number): void {
    this.facing = yaw;
  }

  /** Where a remote player looks up (+) or down (−), radians: the head tilts that way (eased). */
  lookPitch = 0;
  private lookNow = 0;
  private lookQ = new THREE.Quaternion();
  private lookQp = new THREE.Quaternion();
  private lookAxis = new THREE.Vector3();

  /** Tilt the head (after the clip has posed it) about the body's sideways axis. */
  private tiltHead(dt: number): void {
    this.lookNow = THREE.MathUtils.damp(this.lookNow, this.lookPitch, 8, dt);
    if (Math.abs(this.lookNow) < 0.005) return;
    const head = this.bones.get('Head');
    if (!head?.parent) return;
    head.parent.updateMatrixWorld(true);
    const yaw = this.body.rotation.y;
    // The body's right, in the head's parent frame; a positive turn about it tips the face down.
    this.lookAxis.set(Math.cos(yaw), 0, -Math.sin(yaw)).applyQuaternion(head.parent.getWorldQuaternion(this.lookQp).invert()).normalize();
    head.quaternion.premultiply(this.lookQ.setFromAxisAngle(this.lookAxis, -this.lookNow * 0.8));
  }

  faceToward(p: Vec2): void {
    this.facing = Math.atan2(p.x - this.root.position.x, p.z - this.root.position.z);
  }

  sit(): void {
    this.path = [];
    this.activity = 'sit';
    this.exercise = null;
    this.emote = null;
  }

  /** Start an emote (or stop it with null). `seconds`: it ends on its own. */
  setEmote(e: { kind: string; lower: string; upper: string; grounded?: boolean; seconds?: number; since?: number; anchor?: number | null } | null): void {
    if (e && e.kind !== this.emote?.kind) {
      this.emoteSince = e.since ?? Date.now();
      this.emoteAnchor = e.anchor ?? null;
    }
    this.emote = e ? { kind: e.kind, lower: e.lower, upper: e.upper, grounded: e.grounded } : null;
    this.emoteLeft = e?.seconds ?? Infinity;
    if (e) { this.idleFor = 0; this.talkingFor = 0; }
  }

  stand(): void {
    if (this.activity === 'sit') this.activity = 'idle';
  }

  talk(seconds: number): void {
    this.talkingFor = Math.max(this.talkingFor, seconds);
    this.idleFor = 0;
  }

  cheer(seconds = 1.6): void {
    this.emoteFor = seconds;
  }

  /** Where speech bubbles and pops attach: just over the head, wherever it is. */
  headTop(out = new THREE.Vector3()): THREE.Vector3 {
    const h = this.model ? this.bonePosition('Head', out) : null;
    if (h) return h.setY(h.y + BADGE_ABOVE_HEAD);
    return out.copy(this.root.position).setY(this.root.position.y + CHAR_HEIGHT);
  }

  /** World position of a bone (the hand for a prop, the head for a hat). */
  bonePosition(name: string, out = new THREE.Vector3()): THREE.Vector3 | null {
    const b = this.bones.get(name);
    return b ? b.getWorldPosition(out) : null;
  }

  /**
   * Where this body's arms are now, in the body's own frame (world units, +z
   * ahead, +x to its left): shoulder, elbow, wrist, the knuckles, and how
   * closed the hand is. First person draws your arms from it (fpHands.ts).
   * False before the model has loaded.
   */
  armPose(out: ArmPose): boolean {
    return !!this.model && readArmPose((n) => this.bones.get(n), this.body, out);
  }

  /** Lower and upper body clips (clip names; the same one for the whole body). */
  private pose(lower: string, upper: string, fade = 0.25, rate = 1): void {
    if (!this.mixer) return;
    const want = [`${lower}|L`, `${upper}|U`];
    for (const [k, prev] of [[want[0], this.lowerKey], [want[1], this.upperKey]] as const) {
      const a = this.action(k);
      if (!a) continue;
      a.timeScale = rate;
      if (k === prev) continue;
      a.reset().setEffectiveWeight(1).fadeIn(fade).play();
      const old = this.actions.get(prev);
      old?.fadeOut(fade);
    }
    this.lowerKey = want[0];
    this.upperKey = want[1];
  }

  private action(key: string): THREE.AnimationAction | null {
    let a = this.actions.get(key);
    if (a) return a;
    const [name, part] = key.split('|') as [string, 'L' | 'U'];
    let clip = extraClips.get(name) ?? peopleClips().find((c) => c.name === name);
    if (!clip && name === 'Consume_Hold') {
      // Between sips: the drinking clip's moment the cup is up at the chest.
      const consume = peopleClips().find((c) => c.name === 'Consume');
      if (consume) { clip = freezeClip(consume, 0.2, name); registerClip(clip); }
    }
    if (!clip || !this.mixer) return null;
    a = this.mixer.clipAction(half(clip, part));
    if (/Jump_Land|Jump_Start|Consume|Yes|Sitting_Enter|Sitting_Exit/.test(name)) {
      a.setLoop(THREE.LoopOnce, 1);
      a.clampWhenFinished = true;
    }
    this.actions.set(key, a);
    return a;
  }

  private setOpacity(o: number): void {
    for (const m of this.materials) {
      m.transparent = o < 0.999;
      m.opacity = o;
    }
    this.fade = o;
    (this.badge.material as THREE.SpriteMaterial).opacity = o * (this.presenceNow === 'afk' ? 0.55 : 1);
    this.root.visible = o > 0.01;
  }

  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private tmp3 = new THREE.Vector3();
  private tmp4 = new THREE.Vector3();
  private tmp5 = new THREE.Vector3();
  private tmp6 = new THREE.Vector3();

  /** Returns true while the character still exists (false once faded out). */
  update(dt: number): boolean {
    if (this.opacity !== this.targetOpacity) {
      this.opacity = THREE.MathUtils.clamp(this.opacity + Math.sign(this.targetOpacity - this.opacity) * dt * 2.5, 0, 1);
      this.setOpacity(this.opacity);
      if (this.opacity === 0 && this.targetOpacity === 0) return false;
    }

    // Movement.
    let moving = false;
    if (this.path.length && this.activity !== 'sit') {
      const p = this.root.position;
      const speed = this.swimming ? (this.running ? SWIM_SPEEDS.run : SWIM_SPEEDS.walk) : this.running ? (this.pace?.run ?? RUN_SPEED) : (this.pace?.walk ?? WALK_SPEED);
      // Spend the whole frame's distance, including across waypoints and a
      // looping lap's arrival callback. Dropping a frame at every point made
      // runners alternate between the run and idle clips along the track.
      let remaining = speed * dt;
      for (let hops = 0; this.path.length && remaining > 0 && hops < 256; hops++) {
        const target = this.path[0];
        const dx = target.x - p.x, dz = target.z - p.z;
        const d = Math.hypot(dx, dz);
        if (d > 1e-7) {
          const step = Math.min(d, remaining);
          p.x += (dx / d) * step;
          p.z += (dz / d) * step;
          remaining -= step;
          this.facing = Math.atan2(dx, dz);
          moving = true;
          if (step < d) break;
        }
        this.path.shift();
        if (!this.path.length) {
          const cb = this.onArrive;
          this.onArrive = null;
          cb?.();
          if ((this.activity as Activity) === 'sit') break;
        }
      }
    }
    if (this.facing !== null) {
      const cur = this.body.rotation.y;
      let diff = this.facing - cur;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      this.body.rotation.y = cur + diff * Math.min(1, dt * 9);
      // Lean into turns a little.
      this.body.rotation.z = THREE.MathUtils.damp(this.body.rotation.z, moving || this.external?.moving ? -diff * 0.12 : 0, 6, dt);
    }

    // A remote jump in flight.
    if (!this.external && (this.hopVy !== 0 || this.jumpY > 0)) {
      this.hopVy -= GRAVITY * dt;
      this.jumpY = Math.max(0, this.jumpY + this.hopVy * dt);
      if (this.jumpY === 0 && this.hopVy < 0) { this.hopVy = 0; this.landFor = 0.28; }
    }
    // Lift (balloon arrivals) eases down.
    if (this.lift > 0) this.lift = Math.max(0, this.lift - dt * 1.6);
    if (this.emote && (moving || this.riding || this.swimming || this.exercise || this.activity === 'sit' || (this.emoteLeft -= dt) <= 0)) this.emote = null;
    const standing = this.activity !== 'sit' && !this.exercise && !this.emote?.grounded && !this.riding;
    const saddle = this.riding ? SADDLE_HEIGHT - SIT_SEAT_HEIGHT : 0;
    // Afloat, the water holds the body up (eased, so wading in from the bank doesn't jump).
    const onLand = this.lift + this.seatY + saddle + this.jumpY + this.groundY + (standing ? this.soleLift : 0);
    this.floatK = THREE.MathUtils.damp(this.floatK, this.swimming ? 1 : 0, 5, dt);
    this.root.position.y = this.floatK > 0.001 ? THREE.MathUtils.lerp(onLand, this.swimY, this.floatK) : onLand;

    // Ground speed, measured (works for paths and for the viewer's controller).
    const flat = this.tmp.set(this.root.position.x - this.lastPos.x, 0, this.root.position.z - this.lastPos.z);
    const inst = dt > 0 ? flat.length() / dt : 0;
    this.speed = THREE.MathUtils.damp(this.speed, inst, 12, dt);
    this.lastPos.copy(this.root.position);

    this.emoteFor = Math.max(0, this.emoteFor - dt);
    this.talkingFor = Math.max(0, this.talkingFor - dt);
    this.landFor = Math.max(0, this.landFor - dt);
    if (this.external?.moving) { moving = true; this.running = this.external.running; }

    const inAir = !this.swimming && (this.external ? this.driveAirborne : this.jumpY > 0.015);
    if (this.airborne && !inAir) this.landFor = 0.28;
    this.airborne = inAir;

    this.striding = !inAir && moving && !this.riding && !this.swimming;
    if (this.swimming && this.swimClip) {
      // A stroke a second and a half while swimming; treading water slower, in place.
      this.pose(this.swimClip, this.swimClip, 0.3, moving ? (this.running ? 1.35 : 1) : 0.45);
      if (moving) this.idleFor = 0;
    } else if (this.riding) {
      // In the saddle, moving or not (the bird does the running).
      this.pose('Sitting_Idle_Loop', this.talkingFor > 0 ? 'Sitting_Talking_Loop' : 'Sitting_Idle_Loop', 0.25);
    } else if (inAir) {
      this.pose('Jump_Loop', 'Jump_Loop', 0.08);
    } else if (this.landFor > 0 && !moving) {
      this.pose('Jump_Land', 'Jump_Land', 0.06);
    } else if (moving) {
      const g = gaitFor(Math.max(this.speed, 0.2), this.running);
      this.pose(g.clip, g.clip, 0.18, g.rate);
      this.idleFor = 0;
    } else if (this.exercise) {
      this.pose(this.exercise, this.exercise, 0.3);
    } else if (this.activity === 'sit') {
      // Sitting: legs stay seated; the arms talk, rest, or bring the mate up.
      this.sipClock += dt;
      // With a mate the left arm is posed by IK after the mixer (see holdProp).
      const upper = this.talkingFor > 0 && !this.mate ? 'Sitting_Talking_Loop' : 'Sitting_Idle_Loop';
      this.pose('Sitting_Idle_Loop', upper, 0.35);
    } else if (this.emote) {
      this.pose(this.emote.lower, this.emote.upper, 0.35);
    } else if (this.emoteFor > 0) {
      this.pose('Idle_Loop', 'Yes', 0.2);
    } else if (this.talkingFor > 0) {
      this.pose('Idle_Talking_Loop', 'Idle_Talking_Loop', 0.3);
    } else {
      this.pose('Idle_Loop', 'Idle_Loop', 0.3);
      this.idleFor += dt;
    }
    const sangre = this.emote?.kind === 'sangre' && !!this.model;
    if (sangre && !this.sangre) this.body.add((this.sangre = new SangreFx()).group);
    else if (!sangre && this.sangre) { this.sangre.dispose(); this.sangre = null; }
    if (this.offscreen) { this.skipped += dt; return true; }
    if (this.emote && this.emoteAnchor !== null) this.keepBeat(dt + this.skipped);
    this.mixer?.update(dt + this.skipped);
    this.skipped = 0;
    if ((this.mate || this.reachK > 0) && this.activity === 'sit' && this.model) this.holdProp();
    if (this.model && (this.lookPitch !== 0 || this.lookNow !== 0)) this.tiltHead(dt);

    // The name badge rides above the head (jumps, pull-ups, push-ups, sitting).
    if (this.model) {
      this.root.updateMatrixWorld(true);
      const h = this.bonePosition('Head', this.tmp2);
      if (h) {
        this.root.worldToLocal(h);
        this.badge.position.set(h.x, h.y + BADGE_ABOVE_HEAD + (this.hat ? 0.06 : 0), h.z);
        if (this.presenceMark) this.presenceMark.position.set(h.x, this.badge.position.y + (this.presenceNow === 'afk' ? 0.21 : 0.19), h.z);
      }
    }

    // A barbell sits across both palms, along the line between them.
    if (this.model && this.heldBar) {
      const l = this.bonePosition('hand_l', this.tmp2), r = this.bonePosition('hand_r', this.tmp3);
      const lk = this.bonePosition('middle_01_l', this.tmp4), rk = this.bonePosition('middle_01_r', this.tmp5);
      if (l && r) {
        if (lk) l.lerp(lk, 0.6);
        if (rk) r.lerp(rk, 0.6);
        this.body.worldToLocal(l);
        this.body.worldToLocal(r);
        this.heldBar.position.copy(l).add(r).multiplyScalar(0.5);
        this.heldBar.quaternion.setFromUnitVectors(BAR_AXIS, r.sub(l).normalize());
      }
    }
    if (this.onStep && this.model && !this.riding) this.feelSteps();
    if (this.sangre) {
      this.sangre.group.visible = this.bodyDrawn;
      // Blood pools on the ground under them, not on the bench they stand on.
      this.sangre.update(dt, (n, out) => {
        const p = this.bonePosition(n, out);
        return p && this.body.worldToLocal(p);
      }, -(this.lift + this.seatY + this.jumpY + this.soleLift));
    }
    // Props follow their bones: hat on the head, mate in the left hand.
    if (this.model && (this.hat || this.mate)) {
      if (this.hat) {
        const h = this.bonePosition('Head', this.tmp2);
        if (h) {
          this.body.worldToLocal(h);
          this.hat.position.set(h.x, h.y + 0.085, h.z);
        }
      }
      if (this.mate) {
        // In the left palm (the hand the drinking clip lifts), between the
        // wrist and the knuckles.
        const wrist = this.bonePosition('hand_l', this.tmp2);
        const knuckle = this.bonePosition('middle_01_l', this.tmp3);
        if (wrist) {
          if (knuckle) wrist.lerp(knuckle, 0.55);
          this.body.worldToLocal(wrist);
          this.mate.position.set(wrist.x, wrist.y - 0.01, wrist.z);
          // Sipping: as the hand nears the face, bring the mouth point (the
          // bombilla's tip, a cup's rim) to the lips and tilt it toward them.
          const head = this.bonePosition('Head', this.tmp3);
          const tip = this.mate.userData.mouth as THREE.Vector3 | undefined;
          if (head && tip) {
            this.body.worldToLocal(head);
            if (this.mate.userData.roast) {
              // Lift the far end to the mouth with the hand BELOW it. The
              // old cup pose put the handle at the face instead of the food.
              this.mate.rotation.set(-Math.PI / 2 * propLift(this.sipClock, true), 0, 0);
              // The whole shaft stays in front of the head, including while
              // the wrist/knuckles shift during the seated animation.
              this.mate.position.z = Math.max(this.mate.position.z, head.z + 0.09);
            } else {
              const lips = head.add(this.tmp4.set(0, 0.02, 0.04));
              const d = lips.distanceTo(this.mate.position);
              const w = 1 - THREE.MathUtils.smoothstep(d, 0.05, 0.11);
              this.mate.rotation.x = w * 0.35;
              const s = this.mate.scale.x;
              const tipNow = this.tmp5.copy(tip).multiplyScalar(s).applyEuler(this.mate.rotation);
              const at = this.tmp6.copy(lips).sub(tipNow);
              this.mate.position.lerp(at, w);
            }
          }
        }
      }
    }
    return true;
  }

  /**
   * The left arm holding a mate (or cup, or choripán): in front of the chest,
   * and every six seconds up to the lips for a sip. Two-bone IK over the
   * sitting clip, elbow kept down and out.
   */
  private holdProp(): void {
    const up = this.bones.get('upperarm_l'), lo = this.bones.get('lowerarm_l'), hand = this.bones.get('hand_l');
    const head = this.bones.get('Head'), chest = this.bones.get('spine_03') ?? this.bones.get('spine_02');
    if (!up || !lo || !hand || !head || !chest) return;
    this.root.updateMatrixWorld(true);
    const v = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3());
    const S = v(up), E0 = v(lo), H0 = v(hand);
    const a = S.distanceTo(E0), b = E0.distanceTo(H0);
    // Character axes in world space.
    const q = this.body.getWorldQuaternion(new THREE.Quaternion());
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    const upW = new THREE.Vector3(0, 1, 0);
    const side = new THREE.Vector3().subVectors(S, v(chest)).projectOnPlane(fwd).projectOnPlane(upW).normalize(); // toward the left shoulder
    const k = CHAR_HEIGHT / 0.72; // world units per "village person"
    const hold = v(chest).addScaledVector(fwd, 0.09 * k).addScaledVector(side, 0.03 * k).addScaledVector(upW, -0.09 * k);
    const roast = !!this.mate?.userData.roast;
    const lips = v(head).addScaledVector(fwd, (roast ? 0.09 : 0.04) * k).addScaledVector(upW, 0.02 * k);
    // Sip: up in 0.5 s, 0.8 s at the lips, down in 0.5 s, every 6 s (a
    // marshmallow: held out over the fire, eaten every 9 s).
    if (roast) hold.addScaledVector(fwd, 0.13 * k).addScaledVector(upW, 0.05 * k);
    const sip = this.mate ? propLift(this.sipClock, roast) : 0;
    // At the lips the hand sits a mate's height below them (the bombilla on top).
    const mouth = this.mate?.userData.mouth as THREE.Vector3 | undefined;
    const tip = (roast ? mouth?.z : mouth?.y) ?? 0.1;
    const target = hold.lerp(lips.addScaledVector(upW, -tip * (this.mate?.scale.y ?? 1) * (roast ? 1 : 0.9)), sip);
    // Handing the mate over (or taking it): out toward the neighbour.
    if (this.reachK > 0) target.lerp(this.reach, this.reachK);
    else if (!this.mate) return; // nothing in hand, nothing to pass: the clip's own arms
    // Elbow: in the plane toward the pole (down, out, a little back).
    const toT = new THREE.Vector3().subVectors(target, S);
    const d = THREE.MathUtils.clamp(toT.length(), Math.abs(a - b) + 1e-4, a + b - 1e-4);
    const dir = toT.normalize();
    const pole = new THREE.Vector3().addScaledVector(upW, -1).addScaledVector(side, 0.6).addScaledVector(fwd, -0.2);
    const perp = pole.clone().addScaledVector(dir, -pole.dot(dir)).normalize();
    const x = (a * a - b * b + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, a * a - x * x));
    const E = S.clone().addScaledVector(dir, x).addScaledVector(perp, h);
    const T = S.clone().addScaledVector(dir, d);
    const aim = (bone: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3) => {
      const delta = new THREE.Quaternion().setFromUnitVectors(from.normalize(), to.normalize());
      const world = bone.getWorldQuaternion(new THREE.Quaternion()).premultiply(delta);
      const parent = bone.parent!.getWorldQuaternion(new THREE.Quaternion());
      bone.quaternion.copy(parent.invert().multiply(world));
      bone.updateMatrixWorld(true);
    };
    aim(up, new THREE.Vector3().subVectors(E0, S), new THREE.Vector3().subVectors(E, S));
    aim(lo, new THREE.Vector3().subVectors(v(hand), v(lo)), new THREE.Vector3().subVectors(T, v(lo)));
  }

  /** Striding: a step is the other foot becoming the lower one (it just came down). */
  private feelSteps(): void {
    if (!this.striding) { this.lowFoot = null; return; }
    const l = this.bonePosition('foot_l', this.tmp2), r = this.bonePosition('foot_r', this.tmp3);
    if (!l || !r) return;
    const gap = l.y - r.y;
    if (Math.abs(gap) < 0.008) return; // too close to tell: wait
    const low = gap < 0 ? 'l' : 'r';
    if (this.lowFoot && low !== this.lowFoot) this.onStep!(this.running);
    this.lowFoot = low;
  }

  /** A synced emote: put its clips where the shared clock says (after this frame's step of `step` seconds). */
  private keepBeat(step: number): void {
    const e = this.emote!;
    if (this.lowerKey !== `${e.lower}|L`) return; // posing something else (a landing)
    for (const key of [this.lowerKey, this.upperKey]) {
      const a = this.actions.get(key);
      const d = a?.getClip().duration;
      if (!a || !d) continue;
      a.time = clipPhase(Date.now() - step * 1000 * a.timeScale, this.emoteAnchor!, d);
    }
  }

  /** Show whether the person behind this character is here right now. */
  setPresence(p: 'online' | 'afk' | 'offline'): void {
    if (p === this.presenceNow) return;
    this.presenceNow = p;
    this.presenceMark?.removeFromParent();
    this.presenceMark = null;
    (this.badge.material as THREE.SpriteMaterial).opacity = this.fade * (p === 'afk' ? 0.55 : 1);
    if (p === 'offline') return;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: presenceTexture(p), depthWrite: false, transparent: true }));
    s.scale.set(p === 'afk' ? 0.16 : 0.045, p === 'afk' ? 0.06 : 0.045, 1);
    s.renderOrder = 6;
    s.position.copy(this.badge.position).setY(this.badge.position.y + 0.2);
    this.root.add(s);
    this.presenceMark = s;
  }

  dispose(): void {
    this.mixer?.stopAllAction();
    this.sangre?.dispose();
    this.root.removeFromParent();
  }
}

const presenceTextures = new Map<string, THREE.Texture>();
/** A green dot (online) or a small amber AFK tag, drawn once and shared. */
function presenceTexture(p: 'online' | 'afk'): THREE.Texture {
  let t = presenceTextures.get(p);
  if (t) return t;
  const c = document.createElement('canvas');
  c.width = p === 'afk' ? 128 : 48;
  c.height = 48;
  const g = c.getContext('2d');
  if (g) {
    if (p === 'online') {
      g.fillStyle = '#171717';
      g.beginPath(); g.arc(24, 24, 22, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#b4f953';
      g.beginPath(); g.arc(24, 24, 15, 0, Math.PI * 2); g.fill();
    } else {
      g.fillStyle = 'rgba(23,23,23,0.9)';
      g.beginPath(); g.roundRect(2, 4, 124, 40, 20); g.fill();
      g.strokeStyle = '#ffc83d'; g.lineWidth = 3; g.stroke();
      g.fillStyle = '#ffc83d';
      g.font = '700 26px ui-monospace, monospace';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('💤 AFK', 64, 26);
    }
  }
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  presenceTextures.set(p, t);
  return t;
}
