// The village: builds the scene from the island plan and the channel list,
// and turns Director commands into walking, talking, sitting and effects.

import * as THREE from 'three';
import { shortNpub } from '../nostr/sanitize';
import type { WireGroup, WireMessage, WireProfile } from '../nostr/wire';
import { renderContent } from '../ui/content';
import { pingReason } from '../nostr/pings';
import { model } from './assets';
import { buildBuilding, tierFor, type Building } from './buildings';
import { Cameraman } from './cameraman';
import { Character, pubkeyColor, CHAR_HEIGHT, PERSON_SCALE, SIT_SEAT_HEIGHT, registerClip, setBadgeResolution } from './character';
import { buildExerciseClip, repsDone, type ExerciseKind } from './anim/exercises';
import { buildPerson, skinTone } from '../people/people';
import { FpHands, newArmPose } from './fpHands';
import type { Command } from './director';
import { buildIsland, WATER_Y, type IslandMeshes } from './island';
import { carrierOf, reachOf, stepRound, type Round } from './mateRound';
import { bridgeHeightAt, bridgeSpecs, buildBridge, type BridgeSpec } from './bridge';
import {
  assignByDistrict, buildNavGrid, circleSpots, dist, distToPolyline, hashStr, inFootprint, inWater, onTrack, planIsland, rng, trackSite, TRACK,
  type District, type IslandPlan, type NavGrid, type Slot, type Vec2,
  millBlocked, type MillSite, turnedHalf, waterworks, parkSite, PLINTH_HALF, CELL as NAV_CELL, plazaLanterns,
} from './layout';
import { fbm2 } from './noise';
import { CALISTHENICS_LAMPS, CALISTHENICS_STATIONS, PARK_MAT, TRACK_LANES, TRACK_TOP, buildArcadeCabinet, buildCalisthenics, buildChoripan, buildCup, buildLaptop, buildPopcorn, buildMate, buildTrack, trackLap } from './districts';
import { buildBarbell, buildGym, pickGymChannel, type GymBuild } from './gym';
import { Flock } from './nostrich';
import { WalkPin } from './walkPin';
import { buildMarshmallow } from './campfire';
import { findDynamic, mergeStatic } from './merge';
import { chooseLights, lampLevel, lightBudget, LightScan, scanOnChange, type LightSpot } from './lightBudget';
import { buildObelisk, obeliskShape, plinthSteps, type Obelisk } from './obelisk';
import { Overlay } from './overlay';
import { Pet, buildHat } from './pet';
import { LANDMARKS, onLandmarkLawn, reserveLandmarkSlots, type LandmarkBuild, type LandmarkId, type LandmarkInterior, type SeatProp } from './landmarks';
import { THEATER, type TheaterHall } from './landmarks/theater';
import { buildMill, type Mill } from './mill';
import type { Avatar } from '../nostr/avatars';
import { laneSpotId, parseSpot, seatSpotId, stationSpotId, type Activity, type Claim } from '../nostr/activity';
import { extrapolate, type Motion } from '../nostr/motion';
import { RUN_SPEED as PLAYER_RUN, FOOT_SPEEDS, RIDE_SPEEDS, type Solid } from '../player/controller';
import { Post } from './post';
import { PropBatch } from './props';
import { Sky, type TimeOverride } from './sky';
import type { Prefs } from '../prefs';
import { ZAP_STALE_MS, ZapFlights } from './zapFlight';
import { builtClipName, emoteAnchor, emoteOf, EMOTE_SYNC_M, type EmoteKind } from './emotes';
import { parseHaunts, pickIdle, type PlaceId } from './places';
import { vw } from '../i18n/village';
import { YoutubeStage } from './youtubeStage';
import { TOTEM, OcclusionProbe, TotemStage, buildTotemMonitor, totemInView, type TotemMonitor } from './totemMonitor';
import { DomScreen } from './domScreen';
import { LABITCONF } from './landmarks/labitconf';

/** Tops of what's laid on the lawn: the plaza paving, cobbles (their mean), floors indoors. */
const PAVING_TOP = 0.03, COBBLE_TOP = 0.02, FLOOR_TOP = 0.006;

interface ConvoSpot { center: Vec2; groupId: string; members: string[]; fire: THREE.Object3D | null; sitting: boolean }

interface Effect { obj: THREE.Object3D; age: number; life: number; tick: (e: Effect, dt: number) => void }

export interface Seat {
  pos: Vec2; face: number; y: number; taken: string | null; dynamic?: boolean; prop?: SeatProp; landmark?: LandmarkId; laptop?: boolean; indoor?: boolean;
  /** Seats on one bench or sofa share one mate when two or more sit there (mateRound.ts). */
  bench?: string;
  /** A chair under a voice channel's tree (that channel's id). */
  tree?: string;
  /** Its solid is kept with the furniture (moved benches, tree chairs), not added per seat. */
  managed?: boolean;
}

/** What a station offers: an exercise, or running laps (a track lane). */
export type StationKind = ExerciseKind | 'run';

/** A place to train: the park (districts.ts CALISTHENICS_STATIONS), a gym machine (gym.ts) or a track lane. */
export interface Station {
  pos: Vec2; face: number; grip: number; half?: number; kinds: StationKind[]; taken: string | null;
  /** A lane of the running track (spot `lane:<i>`). */
  lane?: number;
  /** A machine in this channel's gym. */
  gym?: string;
  /** Where you step on and off (else a spot in front of it). */
  approach?: Vec2;
  /** The bar resting on the machine, hidden while it's in use. */
  rest?: THREE.Object3D;
}

export interface WorldHooks {
  onSay?: (pk: string, groupId: string, text: string, to: string | null, instant: boolean) => void;
  /** Is `pk`'s message in `groupId` for you to see and hear (same place)? No: no bubble, feed line or sound. */
  hears?: (pk: string, groupId: string) => boolean;
  onPersonClick?: (pk: string) => void;
  /** Any tap on the world, before it's dispatched; true: don't walk for it. */
  onTap?: () => boolean;
  onGroupClick?: (groupId: string) => void;
  /** A zap landed on `to` (the coin sound). */
  onZap?: (to: string, sats: number) => void;
  /** The WebGL context was lost (false) or came back (true). */
  onContext?: (ok: boolean) => void;
  onArrive?: () => void;
  /** Someone new is drawn in the village (walked in live, a claim, a resident): fetch their profile. */
  onPersonMade?: (pk: string) => void;
  onGroundClick?: (p: Vec2) => void;
  onGameClick?: (gameId: string) => void;
  onLandmarkClick?: (id: LandmarkId) => void;
  /** A free seat was clicked: walk there and sit. */
  onSeatClick?: (seat: Seat) => void;
  /** The theater's big screen was clicked. */
  onTheaterScreenClick?: () => void;
  /** The totem monitor's screen was clicked (main.ts: focus it, as the theater's screen opens Watch mode). */
  onTotemScreenClick?: () => void;
  onBubbleClick?: (msgId: string) => void;
}

/** Farther than this (or with no path) a claimed person fades across instead of running. */
const CLAIM_RUN_RANGE = 30;
/** Live movement: seconds without an update before someone stops being live. */
const MOVER_STALE_S = 75;
/** How far past a key-walker's last update to keep them walking (s). */
const MOVER_LEAD_S = 2.5;
/** Farther than this from where they really are: fade across. */
const MOVER_BLINK_M = 4;
/** Water deeper than this (m, below the surface) is swum, shallower waded (World.swimmingAt). */
const SWIM_DEPTH = 0.2;
/** How far below the surface a swimmer's root (their feet's level when standing) floats: the shoulders stay just out. */
export const SWIM_SINK = 0.47;

const TREE_MODELS = ['nature/tree_default', 'nature/tree_oak', 'nature/tree_fat', 'nature/tree_detailed', 'nature/tree_cone',
  'nature/tree_pineDefaultA', 'nature/tree_pineRoundA', 'nature/tree_pineTallA', 'nature/tree_default', 'nature/tree_oak',
  'nature/tree_oak_fall', 'nature/tree_fat_fall'];
const FLOWERS = ['nature/flower_redA', 'nature/flower_yellowA', 'nature/flower_purpleA', 'nature/flower_redB', 'nature/flower_yellowB', 'nature/flower_purpleB'];
const BUSHES = ['nature/plant_bush', 'nature/plant_bushLarge', 'nature/plant_bushDetailed', 'nature/plant_bushSmall'];
const GRASS = ['nature/grass', 'nature/grass_large', 'nature/grass_leafs'];
const ROCKS = ['nature/rock_largeA', 'nature/rock_largeB', 'nature/rock_tallA', 'nature/rock_smallA', 'nature/rock_smallB', 'nature/stone_smallA'];

/** Height of `personAnchor` above the ground a person stands on. */
export const ANCHOR_Y = 0.5;

export class World {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly cam: Cameraman;
  readonly sky: Sky;
  readonly post: Post;
  readonly overlay: Overlay;
  readonly plan: IslandPlan;
  private island!: IslandMeshes;
  private grid!: NavGrid;
  private bridges: Vec2[] = [];
  private bridgeSpecs: BridgeSpec[] = [];
  private pathCells = new Set<number>();
  private staticRoot = new THREE.Group();
  private buildingRoot = new THREE.Group();
  readonly groups = new Map<string, WireGroup>();
  private slotOf = new Map<string, number>();
  readonly buildings = new Map<string, Building>();
  readonly people = new Map<string, Character>();
  private leaving = new Set<Character>();
  readonly profiles = new Map<string, WireProfile>();
  private convoOf = new Map<string, number>();
  private convos = new Map<number, ConvoSpot>();
  private pendingSit = new Set<string>();
  private effects: Effect[] = [];
  /** Zaps in the air and their coins (`zapFlight.ts`). */
  readonly zaps = new ZapFlights(this.scene, {
    groundAt: (x, z) => this.groundAt({ x, z }),
    landed: (to, at, sats) => this.zapLands(to, at, sats),
  });
  /** When the camera last turned to a landing: a burst of zaps turns it once. */
  private zapCamAt = -Infinity;
  private swaying: THREE.InstancedMesh[] = [];
  private lampGlow: THREE.MeshStandardMaterial;
  private lampLights: THREE.PointLight[] = [];
  private obelisk!: Obelisk;
  private pulse = 0;
  private fireflies!: THREE.Points;
  private homeward = new Map<string, number>(); // pk → seconds left inside
  private clock = new THREE.Clock();
  private elapsed = 0;
  private raycaster = new THREE.Raycaster();
  private wanderRng = rng(99);
  hooks: WorldHooks = {};
  /** The signed-in viewer's own character, steered by the controller. */
  playerPk: string | null = null;
  /** Channel → themed district (sky-only config, see nostr/themes.ts). */
  private districtOf = new Map<string, District>();
  readonly track: { c: Vec2; rot: number } | null;
  private lastActivity = new Map<string, number>();
  private districtRoot = new THREE.Group();
  private gameRoot = new THREE.Group();
  /** Places to sit (and drink mate). */
  readonly seats: Seat[] = [];
  private seatOf = new Map<string, Seat>();
  /** First-person eye: smoothed height above the feet (eyeOf). */
  private eyeHeight = -1;
  private eyeAt = 0;
  private eyeTmp = new THREE.Vector3();
  /** Your hands in first person. */
  private readonly hands = new FpHands();
  private handsT = 0;
  private readonly armPose = newArmPose();
  private readonly handsEye = new THREE.Vector3();
  private needsResize = false;
  /** LABITCONF's video over its LED wall, made the first time you walk in. */
  private stage: YoutubeStage | null = null;
  /** The theater's film over its screen, made the first time one plays while you're in the hall. */
  private film: DomScreen | null = null;
  /** The totem monitor on LABITCONF's lawn, built with the landmarks, and its live page (world/totemMonitor.ts). */
  private totem: TotemMonitor | null = null;
  private totemStage: TotemStage | null = null;
  private totemProbe = new OcclusionProbe();
  /** The totem's focus is open (main.ts): its page is there, not on the monitor. */
  private totemFocused = false;
  /** LABITCONF's video may sound (main.ts: the Sound switch, after a gesture). */
  stageSound = false;
  /** Furniture the player bumps into but can jump onto (see PlayerController). */
  readonly solids: Solid[] = [];
  private laptops = new Map<string, THREE.Object3D>();
  readonly stations: Station[] = [];
  private trainingAt = new Map<string, { station: Station; kind: StationKind; since: number; wall: number }>();
  /** The running track's lanes (inside to outside), like stations. */
  readonly lanes: Station[] = [];
  /** The channel whose house is the gym, and its hall. */
  private gymId: string | null = null;
  private gym: GymBuild | null = null;
  private gymSolids: Solid[] = [];
  /** Where your click-to-walk is heading. */
  private walkPin: { pin: WalkPin; at: Vec2 } | null = null;
  private fadingPins: WalkPin[] = [];
  /** Wild nostriches running about the island. */
  private flock: Flock | null = null;
  private frustum = new THREE.Frustum();
  private projView = new THREE.Matrix4();
  private cullSphere = new THREE.Sphere(new THREE.Vector3(), 1.2);
  /** Every lamp and glow that is a real light, and when the budget was last applied. */
  private budgeted: (THREE.PointLight | THREE.SpotLight)[] = [];
  private lightsAt = -99;
  /** Looks for lights again as soon as something joins the scene (lightBudget.ts). */
  private lightScan = new LightScan();
  private readonly coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  /** Slots held by landmarks (La Crypta, the nostr-wot HQ, the café, the parrilla). */
  readonly landmarkSlots: Map<LandmarkId, Slot>;
  private landmarks = new Map<LandmarkId, LandmarkBuild>();
  private millSite: MillSite | null = null;
  private mill: Mill | null = null;
  private avatars = new Map<string, Avatar>();
  private pets = new Map<string, Pet>();
  private built = false;
  /** The browser took the WebGL context away (see the constructor). */
  contextLost = false;

  constructor(private canvas: HTMLCanvasElement, overlayEl: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.08, 900);
    this.cam = new Cameraman(this.camera, canvas);
    this.sky = new Sky(this.scene);
    this.post = new Post(this.renderer, this.scene, this.camera, this.sky.sun);
    // Grass follows the quality level "auto" settles on, not just the preference.
    this.post.onLevel = (level) => {
      const want = grassFor(this.grassPref, level);
      if (this.built && Math.abs((this.grass?.count ?? 0) - want) > 500) this.buildGrass(want);
      this.grassWanted = want;
      setBadgeResolution(level === 'high' || level === 'ultra' ? 256 : 128);
    };
    this.overlay = new Overlay(overlayEl, this.camera);
    this.plan = planIsland();
    this.track = trackSite(this.plan);
    // Landmarks hold their slots before any channel is placed; channels never get them.
    this.landmarkSlots = reserveLandmarkSlots(
      this.plan.slots.filter((s) => !this.track || !onTrack(s.pos, this.track, s.w * 0.7 + 0.6)),
      this.plan.plaza.c,
    );
    this.lampGlow = new THREE.MeshStandardMaterial({ color: 0xffe2a8, emissive: 0xffb84d, emissiveIntensity: 0 });
    this.scene.add(this.staticRoot, this.buildingRoot, this.districtRoot, this.gameRoot, this.hands.group);
    scanOnChange(this.lightScan, [this.scene, this.staticRoot, this.buildingRoot, this.districtRoot, this.gameRoot]);
    this.installPicking();
    this.resize();
    // Resized at the start of the next frame: resizing clears the canvas, and
    // a cleared canvas shown before the redraw is a black flash.
    window.addEventListener('resize', () => { this.needsResize = true; });
    // A phone short of GPU memory can take the WebGL context away (black,
    // nothing draws). Ask for it back, and come back one quality level lower.
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.contextLost = true;
      console.warn('[sky] WebGL context lost');
      this.hooks.onContext?.(false);
    });
    canvas.addEventListener('webglcontextrestored', () => {
      this.contextLost = false;
      console.warn('[sky] WebGL context restored');
      this.post.stepDown();
      this.needsResize = true;
      this.hooks.onContext?.(true);
    });
  }

  resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Narrow screens: widen the lens so the island still fits.
    this.camera.fov = w < h ? 46 : 32;
    this.camera.updateProjectionMatrix();
    this.post.setSize(w, h);
    this.stage?.setSize(w, h);
    this.totemStage?.setSize(w, h);
    this.film?.setSize(w, h);
  }

  // ── building the village ──────────────────────────────────────────────

  setGroups(groups: WireGroup[], activity: Map<string, number>): void {
    const ids = new Set(groups.map((g) => g.id));
    for (const g of groups) this.groups.set(g.id, g);
    for (const id of [...this.groups.keys()]) if (!ids.has(id)) this.removeGroup(id);

    this.lastActivity = activity;
    // Themed districts first, then busiest nearest the plaza. Existing
    // channels never move; new ones take the best free slot for their theme.
    const used = new Set(this.slotOf.values());
    const fresh = [...ids].filter((id) => !this.slotOf.has(id));
    if (fresh.length) {
      const held = new Set([...this.landmarkSlots.values()].map((sl) => sl.index));
      const freePlan = { ...this.plan, slots: this.plan.slots.filter((s) => !used.has(s.index) && !held.has(s.index)) };
      const order = assignByDistrict(fresh.map((id) => ({ id, district: this.districtFor(id), activity: activity.get(id) ?? 0 })), freePlan, this.track);
      for (const [id, i] of order) this.slotOf.set(id, i);
    }
    if (!this.built) {
      this.buildGround();
      this.buildStatic();
      this.built = true;
    }
    const gymId = pickGymChannel(groups.filter((g) => this.slotOf.has(g.id)), (id) => this.districtFor(id), (id) => this.slotFor(id)?.w ?? 0);
    if (gymId !== this.gymId) this.setGym(null);
    for (const g of groups) {
      if (!this.slotOf.has(g.id)) continue;
      const tier = tierFor(activity.get(g.id) ?? 0);
      const existing = this.buildings.get(g.id);
      const district = this.districtFor(g.id);
      const gym = g.id === gymId;
      if (existing && existing.group.userData.tier === tier && existing.group.userData.kind === g.kind && existing.group.userData.district === district && !!existing.group.userData.gym === gym) {
        this.setSign(g);
        continue;
      }
      if (existing) existing.group.removeFromParent();
      const slot = this.plan.slots[this.slotOf.get(g.id)!];
      const b = gym ? buildGym(slot, buildBuilding(g, slot, tier, district).roofColor) : buildBuilding(g, slot, tier, district);
      if (gym) {
        const gb = b as GymBuild;
        const moving = findDynamic(gb.group, (mark) => {
          gb.interior.setDoor(1); mark(); gb.interior.setInside(true); mark(); gb.interior.setInside(false); gb.interior.setDoor(0);
        });
        this.meshesMerged += mergeStatic(gb.group, (m) => moving.has(m) || m.name === 'roof' || gb.windows.includes(m));
        this.setGym(gb, g.id, slot);
      }
      // A house is dozens of little pieces: draw them as a handful (the roof
      // lights up for mentions and the windows at night, so they stay apart).
      else this.meshesMerged += mergeStatic(b.group, (m) => m.name === 'roof' || b.windows.includes(m) || underCampfire(m));
      this.setTreeSeats(g.id, slot, b.tree ?? null);
      b.group.userData = { groupId: g.id, tier, kind: g.kind, district, gym };
      this.buildingRoot.add(b.group);
      this.buildings.set(g.id, b);
      this.setSign(g);
    }
    this.placeBenches();
    this.rebuildGrid();
    this.syncSlotDecor();
    this.buildDistrictProps();
  }

  districtFor(groupId: string): District {
    return this.districtOf.get(groupId) ?? 'plaza';
  }

  /** New theme config: re-lay the village if any channel changed district. */
  setDistricts(map: Map<string, District>): void {
    let changed = false;
    for (const id of new Set([...map.keys(), ...this.districtOf.keys()])) {
      if ((map.get(id) ?? 'plaza') !== (this.districtOf.get(id) ?? 'plaza') && this.groups.has(id)) changed = true;
    }
    this.districtOf = new Map(map);
    if (!changed || !this.built) return;
    for (const b of this.buildings.values()) b.group.removeFromParent();
    this.buildings.clear();
    this.slotOf.clear();
    this.setGroups([...this.groups.values()], this.lastActivity);
  }

  /** Arcade cabinets by gaming yards, a stool to drink mate at every yard. */
  private buildDistrictProps(): void {
    this.districtRoot.clear();
    for (let i = this.seats.length - 1; i >= 0; i--) if (this.seats[i].dynamic && !this.seats[i].taken) this.seats.splice(i, 1);
    for (const [id] of this.buildings) {
      const s = this.slotFor(id);
      if (!s) continue;
      const side = { x: Math.cos(s.rot), z: -Math.sin(s.rot) };
      const fwd = { x: Math.sin(s.rot), z: Math.cos(s.rot) };
      if (this.districtFor(id) === 'gaming') {
        for (const k of [-1, 1]) {
          const cab = buildArcadeCabinet(hashStr(id) + k + 1);
          cab.position.set(s.yard.x + side.x * 1.5 * k - fwd.x * 0.6, 0, s.yard.z + side.z * 1.5 * k - fwd.z * 0.6);
          cab.rotation.y = s.rot + Math.PI;
          this.districtRoot.add(cab);
        }
      }
      const stoolAt = { x: s.yard.x - side.x * 1.2 + fwd.x * 0.5, z: s.yard.z - side.z * 1.2 + fwd.z * 0.5 };
      if (!this.grid.isWalkable(stoolAt)) continue;
      const stool = model('town/stall-stool');
      stool.position.set(stoolAt.x, 0, stoolAt.z);
      this.districtRoot.add(stool);
      this.seats.push({ pos: stoolAt, face: Math.atan2(s.yard.x - stoolAt.x, s.yard.z - stoolAt.z), y: 0.2, taken: null, dynamic: true });
    }
  }

  private setSign(g: WireGroup): void {
    const b = this.buildings.get(g.id);
    const slot = this.slotFor(g.id);
    if (!b || !slot) return;
    this.overlay.setSign(g.id, new THREE.Vector3(slot.pos.x, b.height + 0.55, slot.pos.z), g.name, g.kind, () => this.hooks.onGroupClick?.(g.id));
  }

  /** Forget every channel and its slot (logout / account switch). */
  clearGroups(): void {
    for (const id of [...this.groups.keys()]) this.removeGroup(id);
    this.slotOf.clear();
    this.rebuildGrid();
    this.syncSlotDecor();
  }

  private removeGroup(id: string): void {
    if (id === this.gymId) this.setGym(null);
    this.setTreeSeats(id, null, null);
    this.groups.delete(id);
    this.buildings.get(id)?.group.removeFromParent();
    this.buildings.delete(id);
    if (this.built) this.placeBenches();
    this.overlay.removeSign(id);
    // The slot stays reserved so other buildings don't shuffle.
  }

  slotFor(groupId: string): Slot | null {
    const i = this.slotOf.get(groupId);
    return i === undefined ? null : this.plan.slots[i];
  }

  private usedSlots(): Slot[] {
    const used = [...this.slotOf.entries()].filter(([id]) => this.groups.has(id)).map(([, i]) => this.plan.slots[i]);
    return [...used, ...this.landmarkSlots.values()];
  }

  /** Channel slots only: landmarks block their real buildings, not the whole slot. */
  private gridSlots(): Slot[] {
    const held = new Set([...this.landmarkSlots.values()].map((s) => s.index));
    // A voice tree's plot is open ground: only its trunk is in the way (rebuildGrid).
    return this.usedSlots().filter((s) => !held.has(s.index) && !this.treeAt(s.index));
  }

  private treeAt(slotIndex: number): Building['tree'] | null {
    const id = this.groupAtSlot(slotIndex);
    return (id && this.buildings.get(id)?.tree) || null;
  }

  private markLandmarks(grid: NavGrid): void {
    for (const d of LANDMARKS) {
      const s = this.landmarkSlots.get(d.id);
      if (!s) continue;
      const f = d.footprint;
      const c = Math.cos(s.rot), sn = Math.sin(s.rot);
      const ox = s.pos.x + sn * d.forward, oz = s.pos.z + c * d.forward;
      grid.mark((p) => {
        // World → landmark local (inverse of landmarkToWorld).
        const dx = p.x - ox, dz = p.z - oz;
        const lx = dx * c - dz * sn, lz = dx * sn + dz * c;
        return lx > f.minX && lx < f.maxX && lz > f.minZ && lz < f.maxZ;
      }, 1);
    }
  }

  private rebuildGrid(): void {
    this.grid = buildNavGrid(this.plan, this.gridSlots(), this.bridges);
    this.markLandmarks(this.grid);
    for (const k of this.pathCells) if (!this.grid.blocked[k]) this.grid.cost[k] = 6;
    // Trees and props are obstacles too.
    for (const k of this.obstacles) this.grid.blocked[k] = 1;
    // Voice trees: just the trunk.
    for (const [id, b] of this.buildings) {
      const slot = this.slotFor(id);
      if (!b.tree || !slot) continue;
      const tr = b.tree.trunkR;
      this.grid.mark((p) => dist(p, slot.pos) < tr + 0.2, 1);
    }
  }

  private obstacles: number[] = [];
  private slotDecor = new Map<number, THREE.Object3D>();

  private buildSlotDecor(sl: Slot): THREE.Object3D {
    const g = new THREE.Group();
    const r = rng(sl.index * 31 + 7);
    const place = (o: THREE.Object3D, lx: number, lz: number, rot = sl.rot, scale = 1) => {
      const c = Math.cos(sl.rot), sn = Math.sin(sl.rot);
      o.position.set(sl.pos.x + lx * c + lz * sn, 0, sl.pos.z - lx * sn + lz * c);
      o.rotation.y = rot;
      o.scale.setScalar(scale);
      g.add(o);
    };
    const kind = hashStr(String(sl.index)) % 3;
    if (kind === 0) {
      for (let i = 0; i < 5; i++) for (let j = 0; j < 3; j++) {
        place(model(j === 1 ? 'nature/crops_wheatStageB' : 'nature/crops_cornStageD'), (i - 2) * 0.38, (j - 1) * 0.5, sl.rot, 0.8);
      }
    } else if (kind === 1) {
      place(model('nature/tent_detailedOpen'), 0, 0, sl.rot, 1.6);
      place(model('nature/log_stack'), 0.9, 0.4);
    } else {
      for (let i = 0; i < 4; i++) place(model(TREE_MODELS[(sl.index + i) % 4]), (r() - 0.5) * 1.6, (r() - 0.5) * 1.6, r() * 6, 1 + r() * 0.4);
    }
    this.staticRoot.add(g);
    return g;
  }

  /** Show decorations only on slots no channel holds. */
  private syncSlotDecor(): void {
    const used = new Set(this.usedSlots().map((sl) => sl.index));
    for (const [i, o] of this.slotDecor) o.visible = !used.has(i);
  }

  /** The bare island (ground, river, mountains, waterfall): procedural, no
   *  models, so the loading screen can show it from above while they load. */
  buildGround(): void {
    if (this.island) return;
    // A landmark bigger than its slot (LABITCONF) sinks the lawn under all of it.
    const reach = new Map<number, number>();
    for (const d of LANDMARKS) {
      const s = this.landmarkSlots.get(d.id);
      if (!s) continue;
      const f = d.footprint;
      reach.set(s.index, Math.hypot(Math.max(-f.minX, f.maxX), Math.max(-(f.minZ + d.forward), f.maxZ + d.forward)) + 0.5);
    }
    const footprints = this.plan.slots.map((s) => ({ pos: s.pos, r: Math.max(s.w * 0.8 + 1.0, reach.get(s.index) ?? 0) }));
    this.island = buildIsland(this.plan, footprints);
    this.staticRoot.add(this.island.group);
  }

  /** Everything on the island that comes from models. Needs buildGround(). */
  private buildStatic(): void {
    const plan = this.plan;

    // Bridges where the paths will cross the river (one on the line from the
    // obelisk to the Liberture house, one beside the watermill's wheel).
    const ww = waterworks(plan, this.island.riverPts, this.landmarkSlots.get('liberture')?.pos ?? null, millBlocked(plan, this.track));
    this.bridges = ww.bridges;
    this.millSite = ww.mill;
    // Arched footbridges: their deck is raised ground (groundAt).
    this.bridgeSpecs = bridgeSpecs(plan, this.bridges);
    for (const b of this.bridgeSpecs) this.staticRoot.add(buildBridge(b));

    this.grid = buildNavGrid(plan, this.gridSlots(), this.bridges);
    this.markLandmarks(this.grid);
    this.layPaths();
    this.buildPlaza();
    this.buildMarket();
    this.decorate();
    this.buildSportsGround();
    this.buildLandmarks();
    this.buildTotem();
    // Every seat (bench, stool, log, chair) is solid up to its seat height.
    for (const seat of this.seats) {
      if (seat.dynamic || seat.managed) continue;
      const r = 0.13;
      this.solids.push({ minX: seat.pos.x - r, maxX: seat.pos.x + r, minZ: seat.pos.z - r, maxZ: seat.pos.z + r, top: seat.y });
    }
    this.buildFireflies();
    this.buildFlock();
    if (this.grassWanted) this.buildGrass(this.grassWanted);
  }

  /**
   * The street market: three stalls in a little square of its own, away from
   * the obelisk. Kenney's stalls carry their awning on two posts of their own
   * (mid-way along the ridge); don't add more. The tables are solid (walk
   * round, or jump up).
   */
  private buildMarket(): void {
    const plan = this.plan;
    const free = (p: Vec2, pad: number) =>
      dist(p, plan.plaza.c) > plan.plaza.r + 1.5
      && !plan.slots.some((sl) => inFootprint(p, sl, 0.8 + pad) || dist(p, sl.yard) < 1.4 + pad)
      && distToPolyline(p, this.island.riverPts) > plan.riverWidth + 0.6 + pad
      && dist(p, plan.pond.c) > plan.pond.r + 0.8 + pad
      && !plan.mountains.some((m) => dist(p, m.pos) < m.r + pad)
      && (!this.track || !onTrack(p, this.track, 1 + pad))
      && Math.hypot(p.x, p.z) < plan.radiusAt(Math.atan2(p.z, p.x)) - 2
      && [...this.landmarkSlots.values()].every((sl) => dist(p, sl.pos) > 3.6);
    let best = null as Vec2 | null, bd = Infinity;
    // The roomiest clearance that fits somewhere, nearest the plaza.
    for (const pad of [1.9, 1.6, 1.3, 1.0]) {
      for (let r = 5; r < 12; r += 0.5) for (let k = 0; k < 48; k++) {
        const a = (k / 48) * Math.PI * 2;
        const p = { x: plan.plaza.c.x + Math.cos(a) * r, z: plan.plaza.c.z + Math.sin(a) * r };
        if (!free(p, pad) || this.onPath(p, 0.2)) continue;
        if (r < bd) { bd = r; best = p; }
      }
      if (best) break;
    }
    if (!best) return;
    this.marketAt = best;
    const toPlaza = Math.atan2(plan.plaza.c.x - best.x, plan.plaza.c.z - best.z);
    const stalls = ['town/stall-red', 'town/stall-green', 'town/stall-red'];
    for (let i = 0; i < 3; i++) {
      // An arc facing the way back to the plaza.
      const a = toPlaza + Math.PI + (i - 1) * 0.85;
      const pos = { x: best.x + Math.sin(a) * 1.75, z: best.z + Math.cos(a) * 1.75 };
      const st = model(stalls[i]);
      const S = 1.15;
      st.position.set(pos.x, 0.0, pos.z);
      st.rotation.y = a + Math.PI;
      st.scale.setScalar(S);
      this.staticRoot.add(st);
      st.updateMatrixWorld(true);
      // The table top only (not the awning), 0.64 × 1.0 turned with the
      // stall: its bounding box is solid up to table height.
      const { hx, hz } = turnedHalf(0.32 * S, 0.5 * S, st.rotation.y);
      this.solids.push({ minX: pos.x - hx, maxX: pos.x + hx, minZ: pos.z - hz, maxZ: pos.z + hz, top: 0.42 * S });
    }
  }

  /** Where the market square is (for residents to browse). */
  marketAt: Vec2 | null = null;

  /** A placed prop becomes solid: its footprint, up to its top. */
  private addSolidObject(o: THREE.Object3D, shrink = 0.04): void {
    o.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(o);
    if (box.isEmpty()) return;
    this.solids.push({ minX: box.min.x + shrink, maxX: box.max.x - shrink, minZ: box.min.z + shrink, maxZ: box.max.z - shrink, top: box.max.y });
  }

  /** Is p under a landmark (its real footprint, which can overhang the slot), with a margin? */
  private underLandmark(p: Vec2, margin: number): boolean {
    for (const d of LANDMARKS) {
      const l = this.toLandmarkLocal(d.id, p);
      const f = d.footprint;
      if (l && l.x > f.minX - margin && l.x < f.maxX + margin && l.z > f.minZ - margin && l.z < f.maxZ + margin) return true;
    }
    return false;
  }

  /** Slot-local → world, for a landmark standing in slot `s` pushed `forward`. */
  private landmarkToWorld(s: Slot, forward: number, p: Vec2): Vec2 {
    const c = Math.cos(s.rot), sn = Math.sin(s.rot);
    const ox = s.pos.x + sn * forward, oz = s.pos.z + c * forward;
    return { x: ox + p.x * c + p.z * sn, z: oz - p.x * sn + p.z * c };
  }

  private buildLandmarks(): void {
    for (const d of LANDMARKS) {
      const s = this.landmarkSlots.get(d.id);
      if (!s) continue;
      this.slotDecor.get(s.index)?.removeFromParent();
      this.slotDecor.delete(s.index);
      const b = d.build();
      const fwd = { x: Math.sin(s.rot), z: Math.cos(s.rot) };
      b.group.position.set(s.pos.x + fwd.x * d.forward, 0, s.pos.z + fwd.z * d.forward);
      b.group.rotation.y = s.rot;
      // Fewer draw calls: merge what never moves (see findDynamic).
      const moving = findDynamic(b.group, (mark) => {
        for (const t of [0.4, 2.9, 7.3, 13.1]) { b.update?.(0.016, t); mark(); }
        b.setNight(1, 1); mark();
        b.interior?.setDoor(1); mark();
        b.interior?.setInside(true); mark();
        b.pulse?.(); mark();
        b.update?.(0.5, 17); mark();
        b.interior?.setInside(false);
        b.interior?.setDoor(0);
        b.setNight(0, 1);
      });
      // The theater's screen changes picture and shape on its own, LABITCONF's
      // places its video (youtubeStage.ts): never merged.
      this.meshesMerged += mergeStatic(b.group, (m) => moving.has(m) || m.name === 'roof' || m.name === 'theater-screen' || m.name === 'labitconf-screen');
      b.group.traverse((o) => { o.userData.landmark = d.id; });
      this.staticRoot.add(b.group);
      this.landmarks.set(d.id, b);
      for (const so of b.solids ?? []) this.solids.push(this.landmarkSolid(s, d.forward, so));
      for (const seat of b.seats ?? []) {
        this.seats.push({ pos: this.landmarkToWorld(s, d.forward, seat.pos), face: seat.face + s.rot, y: seat.y, taken: null, prop: seat.prop, landmark: d.id, laptop: seat.laptop, indoor: seat.indoor, bench: seat.bench ? `${d.id}:${seat.bench}` : undefined });
      }
    }
  }

  /** A landmark's local solid (axis-aligned in its frame) as a world solid. */
  private landmarkSolid(s: Slot, forward: number, so: { x: number; z: number; hx: number; hz: number; top: number }): Solid {
    const c = this.landmarkToWorld(s, forward, { x: so.x, z: so.z });
    const cs = Math.abs(Math.cos(s.rot)), sn = Math.abs(Math.sin(s.rot));
    const hx = so.hx * cs + so.hz * sn, hz = so.hx * sn + so.hz * cs;
    return { minX: c.x - hx, maxX: c.x + hx, minZ: c.z - hz, maxZ: c.z + hz, top: so.top };
  }

  /** The totem monitor on LABITCONF's lawn, facing the plaza as the hall does (world/totemMonitor.ts). */
  private buildTotem(): void {
    const s = this.landmarkSlots.get('labitconf');
    const d = LANDMARKS.find((x) => x.id === 'labitconf');
    if (!s || !d || this.totem) return;
    const m = buildTotemMonitor();
    const at = this.landmarkToWorld(s, d.forward, { x: TOTEM.X, z: TOTEM.Z });
    m.group.position.set(at.x, 0, at.z);
    m.group.rotation.y = s.rot;
    this.staticRoot.add(m.group);
    this.solids.push(this.landmarkSolid(s, d.forward, { ...m.solid, x: TOTEM.X + m.solid.x, z: TOTEM.Z + m.solid.z }));
    this.totem = m;
  }

  /** World → a landmark's local frame. */
  private toLandmarkLocal(id: LandmarkId, p: Vec2): Vec2 | null {
    const d = LANDMARKS.find((x) => x.id === id);
    const s = this.landmarkSlots.get(id);
    if (!d || !s) return null;
    const c = Math.cos(s.rot), sn = Math.sin(s.rot);
    const dx = p.x - (s.pos.x + sn * d.forward), dz = p.z - (s.pos.z + c * d.forward);
    return { x: dx * c - dz * sn, z: dx * sn + dz * c };
  }

  /** Slot-local → world, for a channel's building (no forward offset). */
  private buildingToWorld(s: Slot, p: Vec2): Vec2 {
    return this.landmarkToWorld(s, 0, p);
  }

  /** The gym hall: its machines become stations, its furniture solid. */
  private setGym(b: GymBuild | null, id: string | null = null, slot: Slot | null = null): void {
    for (const st of this.stations) if (st.gym && st.taken && !st.taken.startsWith('pending:')) this.stopTraining(st.taken);
    for (let i = this.stations.length - 1; i >= 0; i--) {
      const st = this.stations[i];
      if (!st.gym) continue;
      if (st.taken?.startsWith('pending:')) this.releasePending(st.taken.slice('pending:'.length));
      this.stations.splice(i, 1);
    }
    for (const s of this.gymSolids) { const i = this.solids.indexOf(s); if (i >= 0) this.solids.splice(i, 1); }
    this.gymSolids = [];
    this.gym = b;
    this.gymId = b ? id : null;
    if (!b || !id || !slot) return;
    for (const st of b.stations) {
      this.stations.push({
        pos: this.buildingToWorld(slot, st.at), face: st.face + slot.rot, grip: st.grip, kinds: st.kinds, taken: null,
        gym: id, approach: this.buildingToWorld(slot, st.approach), rest: st.rest,
      });
    }
    for (const so of b.solids) {
      const c = this.buildingToWorld(slot, { x: so.x, z: so.z });
      const cs = Math.abs(Math.cos(slot.rot)), sn = Math.abs(Math.sin(slot.rot));
      const hx = so.hx * cs + so.hz * sn, hz = so.hx * sn + so.hz * cs;
      const solid = { minX: c.x - hx, maxX: c.x + hx, minZ: c.z - hz, maxZ: c.z + hz, top: so.top };
      this.solids.push(solid);
      this.gymSolids.push(solid);
    }
  }

  /** Buildings you can walk into: landmarks with an interior, and the gym. */
  private *enterables(): Generator<{ it: LandmarkInterior; local: (p: Vec2) => Vec2 | null; world: (l: Vec2) => Vec2; groundAt?: (l: Vec2) => number }> {
    for (const [id, b] of this.landmarks) {
      const d = LANDMARKS.find((x) => x.id === id);
      const s = this.landmarkSlots.get(id);
      if (b.interior && d && s) yield { it: b.interior, local: (p) => this.toLandmarkLocal(id, p), world: (l) => this.landmarkToWorld(s, d.forward, l), groundAt: b.groundAt };
    }
    const slot = this.gymId ? this.slotFor(this.gymId) : null;
    if (this.gym && slot) {
      const c = Math.cos(slot.rot), sn = Math.sin(slot.rot);
      yield {
        it: this.gym.interior,
        local: (p) => { const dx = p.x - slot.pos.x, dz = p.z - slot.pos.z; return { x: dx * c - dz * sn, z: dx * sn + dz * c }; },
        world: (l) => this.buildingToWorld(slot, l),
        groundAt: this.gym.groundAt,
      };
    }
  }

  /** The building you can enter that p is in (its room or doorway), with its door's inside and outside spots. */
  private enterableAt(p: Vec2): { key: LandmarkInterior; inside: Vec2; outside: Vec2 } | null {
    for (const e of this.enterables()) {
      const l = e.local(p);
      if (!l || !e.it.rooms.some((r) => l.x > r.minX && l.x < r.maxX && l.z > r.minZ && l.z < r.maxZ)) continue;
      const d = e.it.door;
      return { key: e.it, inside: e.world({ x: d.x, z: d.z - 0.45 }), outside: e.world({ x: d.x, z: d.z + 0.75 }) };
    }
    return null;
  }

  /**
   * A walk for the player from `from` to `to`, in and out of buildings: the
   * nav grid outside, through the door (just outside it, just inside it) and
   * straight across the room inside. Null when there's no way.
   */
  routeFor(from: Vec2, to: Vec2): Vec2[] | null {
    const a = this.enterableAt(from), b = this.enterableAt(to);
    if (a && b && a.key === b.key) return [to];
    const out: Vec2[] = [];
    let start = from;
    if (a) { out.push(a.inside, a.outside); start = a.outside; }
    const end = b ? b.outside : to;
    const mid = this.grid.findPath(start, end);
    if (!mid) return null;
    out.push(...mid);
    if (b) out.push(b.outside, b.inside, to);
    return out;
  }

  /** Inside a building you can enter (its room or doorway): walkable for the player. */
  /** On the obelisk's plinth, round its shaft: the grid blocks it (villagers
   *  walk round), people walk up its steps (stair solids). */
  /** Water you can swim into: the river and the pond, not past the rim (where it falls off). */
  swimmable(p: Vec2): boolean {
    return inWater(this.plan, p);
  }

  /** Deep enough here to swim (not wading at the bank). On a bridge you aren't,
   *  unless you're `afloat` already: then you swim on under it. */
  swimmingAt(p: Vec2, afloat = false): boolean {
    return this.swimmable(p) && this.groundAt(p, afloat) < WATER_Y - SWIM_DEPTH;
  }

  /** Is `pk` swimming now? */
  isSwimming(pk: string): boolean {
    return !!this.people.get(pk)?.swimming;
  }

  /** Float `c` if they're in deep water (their stroke built for their body once), else put them back on their feet. */
  private updateSwim(c: Character): void {
    const swim = !c.riding && !this.seatOf.has(c.pk) && !this.trainingAt.has(c.pk) && this.swimmingAt(c.pos, c.swimming);
    if (swim && !c.swimClip) {
      const name = builtClipName('swim', c.look.body);
      if (!this.builtClips.has(name)) {
        const model = buildPerson(c.look)?.root;
        if (!model) return;
        registerClip(buildExerciseClip('swim', model, 0, name));
        this.builtClips.add(name);
      }
      c.swimClip = name;
    }
    if (swim && c.emote) c.setEmote(null);
    c.swimming = swim;
    // Men swim shirtless.
    c.setShirtless(swim && c.look.body === 'm');
    c.swimY = WATER_Y - SWIM_SINK;
  }

  onPlinth(p: Vec2): boolean {
    const c = this.plan.plaza.c;
    const d = Math.max(Math.abs(p.x - c.x), Math.abs(p.z - c.z));
    // Out to where the grid's blocked cells end (PLINTH_HALF + 0.2, rounded out to a cell).
    return d < PLINTH_HALF + 0.2 + NAV_CELL && d > obeliskShape(8).base;
  }

  /** Where a person (you, or someone live) may stand that the grid doesn't
   *  know: inside buildings you can enter, and on the obelisk's steps. */
  playerWalkable(p: Vec2): boolean {
    return this.insideWalkable(p) || this.onPlinth(p);
  }

  /** How high someone standing at p is: the ground, or the step of a stair under them. */
  standHeight(p: Vec2): number {
    let h = this.groundAt(p);
    for (const s of this.solids) if (s.stair && p.x >= s.minX && p.x <= s.maxX && p.z >= s.minZ && p.z <= s.maxZ && s.top > h) h = s.top;
    return h;
  }

  insideWalkable(p: Vec2): boolean {
    for (const e of this.enterables()) {
      const l = e.local(p);
      if (l && e.it.rooms.some((r) => l.x > r.minX && l.x < r.maxX && l.z > r.minZ && l.z < r.maxZ)) return true;
    }
    return false;
  }

  /** How high the ground is at p: the lawn as drawn (island.ts
   *  terrainHeight), the plaza's paving and the cobbled paths over it, a
   *  building's floor inside, raised where a landmark has stairs or a floor
   *  up a storey (La Crypta's steps and living room) or on the arch of a
   *  bridge. `underBridges`: a swimmer's ground, the riverbed under a bridge
   *  rather than its deck (you swim under it). */
  groundAt(p: Vec2, underBridges = false): number {
    let h = this.island ? this.island.heightAt(p) : 0;
    const plaza = this.plan?.plaza;
    if (plaza && dist(p, plaza.c) < plaza.r) h = Math.max(h, PAVING_TOP);
    else if (this.grid && this.pathCells.size) {
      const [i, j] = this.grid.cellOf(p);
      if (this.grid.inBounds(i, j) && this.pathCells.has(this.grid.idx(i, j))) h = Math.max(h, COBBLE_TOP);
    }
    if (h < FLOOR_TOP && this.insideWalkable(p)) h = FLOOR_TOP;
    // The running track and the park's mat are drawn above the lawn: stand on them.
    if (this.track && onTrack(p, this.track)) h = Math.max(h, TRACK_TOP);
    else if (this.parkMat && this.onParkMat(p)) h = Math.max(h, PARK_MAT.top);
    // Raised ground counts only where there is some: off a bridge's deck or a
    // landmark's steps these say 0, which isn't "the lawn is at 0" (the lawn
    // dips below 0 in places, and under every building).
    const raise = (r: number) => { if (r > 1e-4) h = Math.max(h, r); };
    if (!underBridges) raise(bridgeHeightAt(this.bridgeSpecs, p));
    for (const [id, b] of this.landmarks) {
      if (!b.groundAt) continue;
      const l = this.toLandmarkLocal(id, p);
      if (l) raise(b.groundAt(l));
    }
    const slot = this.gym && this.gymId ? this.slotFor(this.gymId) : null;
    if (slot && Math.abs(p.x - slot.pos.x) < slot.w && Math.abs(p.z - slot.pos.z) < slot.d) {
      const c = Math.cos(slot.rot), sn = Math.sin(slot.rot), dx = p.x - slot.pos.x, dz = p.z - slot.pos.z;
      raise(this.gym!.groundAt({ x: dx * c - dz * sn, z: dx * sn + dz * c }));
    }
    return h;
  }

  /** Where the park's mat lies (buildSportsGround). */
  private parkMat: { at: Vec2; rot: number } | null = null;

  private onParkMat(p: Vec2): boolean {
    const { at, rot } = this.parkMat!;
    const dx = p.x - at.x, dz = p.z - at.z, c = Math.cos(rot), s = Math.sin(rot);
    // World to the park's own frame (the inverse of the stations' turn).
    return Math.abs(dx * c - dz * s) <= PARK_MAT.halfX && Math.abs(dx * s + dz * c) <= PARK_MAT.halfZ;
  }

  /** Debugging: how far each standing person's lowest point (shoe soles,
   *  skinned) is from the ground they should stand on, and from whatever
   *  static surface is really drawn under them (a ray straight down). */
  groundAudit(): { pk: string; x: number; z: number; sole: number; ground: number; drawn: number | null; on: string }[] {
    const out: { pk: string; x: number; z: number; sole: number; ground: number; drawn: number | null; on: string }[] = [];
    const box = new THREE.Box3();
    const ray = new THREE.Raycaster();
    const targets: THREE.Object3D[] = [];
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || (m as THREE.SkinnedMesh).isSkinnedMesh || !m.visible || (m as THREE.InstancedMesh).isInstancedMesh) return;
      // Glows and decals (see-through, no depth) are light, not floor.
      const mat = m.material as THREE.Material;
      if (!Array.isArray(m.material) && mat.transparent && !mat.depthWrite) return;
      targets.push(m);
    });
    for (const c of this.people.values()) {
      if (this.seatOf.has(c.pk) || c.jumpY > 0.02 || c.offscreen) continue;
      box.setFromObject(c.body, true);
      const ground = this.groundAt(c.pos);
      ray.set(new THREE.Vector3(c.pos.x, box.min.y + 0.6, c.pos.z), new THREE.Vector3(0, -1, 0));
      ray.far = 1.2;
      const hit = ray.intersectObjects(targets, false).find((h) => !this.isPartOf(h.object, c.root));
      out.push({ pk: c.pk.slice(0, 8), x: +c.pos.x.toFixed(2), z: +c.pos.z.toFixed(2), sole: +box.min.y.toFixed(3), ground: +ground.toFixed(3), drawn: hit ? +hit.point.y.toFixed(3) : null, on: hit ? this.describe(hit.object) : '' });
    }
    return out;
  }

  private describe(o: THREE.Object3D): string {
    const names: string[] = [];
    for (let p: THREE.Object3D | null = o; p && names.length < 4; p = p.parent) if (p.name) names.push(p.name);
    const m = (o as THREE.Mesh).geometry?.type ?? '';
    return `${names.join('<')}${m ? ` (${m})` : ''}`;
  }

  private isPartOf(o: THREE.Object3D, root: THREE.Object3D): boolean {
    for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p === root) return true;
    return false;
  }

  /** Doors open for the player and for people walking live from another
   *  browser; the building you're in shows its inside. */
  private updateInteriors(): void {
    const me = this.playerPk ? this.people.get(this.playerPk) : null;
    const walkers = [me, ...[...this.movers.keys()].map((pk) => this.people.get(pk))].filter((c): c is Character => !!c);
    for (const e of this.enterables()) {
      const it = e.it;
      const l = me ? e.local(me.pos) : null;
      let d = 99;
      for (const c of walkers) {
        const w = e.local(c.pos);
        if (w) d = Math.min(d, Math.hypot(w.x - it.door.x, w.z - it.door.z));
      }
      it.setDoor(THREE.MathUtils.clamp((1.3 - d) / 0.5, 0, 1));
      const r = it.rooms[0];
      // The cutaway is for the follow camera; in first person the room stays whole.
      it.setInside(!this.cam.firstPerson && !!l && l.x > r.minX && l.x < r.maxX && l.z > r.minZ && l.z < r.maxZ);
    }
  }

  /** A landmark's slot (for walking there) and where its resident stands. */
  landmarkSlot(id: LandmarkId): Slot | null {
    return this.landmarkSlots.get(id) ?? null;
  }

  landmarkResidentSpot(id: LandmarkId): { pos: Vec2; face: number } | null {
    const d = LANDMARKS.find((x) => x.id === id);
    const s = this.landmarkSlots.get(id);
    const at = this.landmarks.get(id)?.residentLocal;
    if (!d || !s || !at) return null;
    return { pos: this.landmarkToWorld(s, d.forward, at), face: s.rot };
  }

  /** Light up the landmarks that react to the village (the HQ's graph). */
  pulseLandmarks(): void {
    for (const b of this.landmarks.values()) b.pulse?.();
  }

  /** The running track and calisthenics park (always there; sports
   *  channels gather around it). */
  private buildSportsGround(): void {
    if (!this.track) return;
    this.staticRoot.add(buildTrack(this.track));
    // The park goes beside or past the end of the track (layout.ts parkSite).
    const t = this.track;
    const parkAt = parkSite(this.plan, t, this.island.riverPts);
    const park = buildCalisthenics(parkAt, -t.rot);
    this.staticRoot.add(park);
    this.parkMat = { at: parkAt, rot: -t.rot };
    this.blockAround(parkAt, 0.9);
    // Its training spots, in world space.
    const r = -t.rot, cos = Math.cos(r), sin = Math.sin(r);
    // Lamps at the two corners of the mat farthest from the track, for training after dark.
    const lamps = CALISTHENICS_LAMPS.map((l) => ({ x: parkAt.x + l.x * cos + l.z * sin, z: parkAt.z - l.x * sin + l.z * cos }))
      .filter((p) => !onTrack(p, t, 0.5))
      .sort((a, b) => dist(b, t.c) - dist(a, t.c))
      .slice(0, 2);
    for (const p of lamps) this.lantern(p);
    for (const st of CALISTHENICS_STATIONS) {
      this.stations.push({
        pos: { x: parkAt.x + st.at.x * cos + st.at.z * sin, z: parkAt.z - st.at.x * sin + st.at.z * cos },
        face: st.face + r,
        grip: st.grip,
        half: st.half,
        kinds: st.kinds,
        taken: null,
      });
    }
    for (const p of trackLapPoints(this.track)) {
      const [i, j] = this.grid.cellOf(p);
      if (this.grid.inBounds(i, j)) this.pathCells.add(this.grid.idx(i, j));
    }
    // Three lanes, one runner each, like seats.
    for (let lane = 0; lane < TRACK_LANES; lane++) {
      this.lanes.push({ pos: trackLap(this.track, 1, lane)[0], face: 0, grip: 0, kinds: ['run'], taken: null, lane });
    }
  }

  /** Mark where a click-to-walk is going (`ok`: a path was found). */
  showWalkTarget(p: Vec2, ok: boolean): void {
    this.clearWalkTarget();
    const pin = new WalkPin(ok);
    pin.group.position.set(p.x, this.groundAt(p), p.z);
    this.scene.add(pin.group);
    if (ok) this.walkPin = { pin, at: { ...p } };
    else this.fadingPins.push(pin);
  }

  /** Steering by keys (or a new destination): the pin goes. */
  clearWalkTarget(): void {
    if (!this.walkPin) return;
    this.walkPin.pin.dismiss();
    this.fadingPins.push(this.walkPin.pin);
    this.walkPin = null;
  }

  private updateWalkPins(dt: number): void {
    const me = this.playerPk ? this.people.get(this.playerPk) : null;
    if (this.walkPin && me && dist(me.pos, this.walkPin.at) < 0.35) this.clearWalkTarget();
    this.walkPin?.pin.update(dt);
    this.fadingPins = this.fadingPins.filter((p) => { const alive = p.update(dt); if (!alive) p.dispose(); return alive; });
  }

  /** Keep only a budget of point and spot lights on, nearest where you look (lightBudget.ts). */
  private budgetLights(force = false): void {
    if (force) this.lightScan.mark();
    if (this.lightScan.due(this.elapsed)) {
      const found: (THREE.PointLight | THREE.SpotLight)[] = [];
      this.scene.traverse((o) => { if ((o as THREE.PointLight).isPointLight || (o as THREE.SpotLight).isSpotLight) found.push(o as THREE.PointLight); });
      this.budgeted = found;
      this.lightsAt = -99;
    }
    if (this.elapsed - this.lightsAt < 0.25) return;
    this.lightsAt = this.elapsed;
    const p = new THREE.Vector3();
    const spots: LightSpot[] = this.budgeted.map((l) => {
      l.getWorldPosition(p);
      return { x: p.x, y: p.y, z: p.z, kind: (l as THREE.SpotLight).isSpotLight ? 'spot' : 'point', lit: l.intensity > 0.01 };
    });
    const t = this.cam.controls.target;
    const keep = chooseLights(spots, { x: t.x, y: t.y, z: t.z }, lightBudget(this.coarse, this.post.level));
    this.budgeted.forEach((l, i) => { l.visible = keep.has(i); });
  }

  /** Two pairs of wild nostriches, on open ground away from the plaza. */
  private buildFlock(): void {
    const R = this.plan.R;
    const r = rng(this.plan.seed + 77);
    const homes: Vec2[] = [];
    for (let tries = 0; homes.length < 2 && tries < 40; tries++) {
      const a = r() * Math.PI * 2, d = R * (0.45 + r() * 0.25);
      const p = this.grid.nearestWalkable({ x: Math.cos(a) * d, z: Math.sin(a) * d });
      if (p && dist(p, this.plan.plaza.c) > 5 && homes.every((h) => dist(h, p) > 6)) homes.push(p);
    }
    this.flock = new Flock({
      spotNear: (p, rad) => this.grid.nearestWalkable({ x: p.x + (r() - 0.5) * 2 * rad, z: p.z + (r() - 0.5) * 2 * rad }),
      path: (from, to) => this.grid.findPath(from, to),
      groundAt: (p) => this.groundAt(p),
    }, homes, 2, r);
    this.staticRoot.add(this.flock.root);
  }

  /** A lap of `lane` from the point nearest `from`, back round to it. */
  lanePath(lane: number, from: Vec2): Vec2[] {
    if (!this.track) return [];
    const lap = trackLap(this.track, 40, lane);
    let k = 0;
    for (let i = 1; i < lap.length; i++) if (dist(lap[i], from) < dist(lap[k], from)) k = i;
    return [...lap.slice(k), ...lap.slice(0, k + 1)];
  }

  /** The free lane you're standing on or beside (within `within` of its line). */
  nearestLane(p: Vec2, within = 0.45): Station | null {
    if (!this.track) return null;
    let best: Station | null = null, bd = within;
    for (const st of this.lanes) {
      if (st.taken && st.taken !== this.playerPk) continue;
      for (const q of trackLap(this.track, 60, st.lane)) {
        const d = dist(p, q);
        if (d < bd) { bd = d; best = st; }
      }
    }
    return best;
  }

  /** Cobbled paths from the plaza to every building slot (used or not, so
   *  later channels already have a road). */
  private layPaths(): void {
    const plan = this.plan;
    const grid = buildNavGrid(plan, plan.slots, this.bridges);
    // The watermill's house stands by a bridge: roads go round it.
    const mill = this.millSite;
    if (mill) grid.mark((p) => dist(p, mill.house) < 1.0, 1);
    const cells = new Set<number>();
    const track = this.track;
    const ordered = plan.slots
      .filter((s) => !track || !onTrack(s.pos, track, s.w * 0.7 + 0.6))
      .sort((a, b) => dist(a.yard, plan.plaza.c) - dist(b.yard, plan.plaza.c));
    for (const s of ordered) {
      // Reuse existing road: make laid cells cheap before routing the next.
      const path = grid.findPath({ x: plan.plaza.c.x, z: plan.plaza.c.z + plan.plaza.r - 0.5 }, s.door);
      if (!path) continue;
      let prev = { x: plan.plaza.c.x, z: plan.plaza.c.z + plan.plaza.r - 0.5 };
      for (const p of path) {
        const steps = Math.ceil(dist(prev, p) / 0.25);
        for (let k = 0; k <= steps; k++) {
          const q = { x: prev.x + (p.x - prev.x) * (k / steps), z: prev.z + (p.z - prev.z) * (k / steps) };
          const [i, j] = grid.cellOf(q);
          if (!grid.inBounds(i, j)) continue;
          for (const [di, dj] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
            const kk = grid.idx(i + di, j + dj);
            cells.add(kk);
            grid.cost[kk] = 4;
          }
        }
        prev = p;
      }
    }
    this.pathCells = cells;
    // Cobblestones: little flattened stones, instanced.
    const r = rng(5);
    const stoneGeo = new THREE.CylinderGeometry(0.075, 0.085, 0.04, 6);
    const pts: THREE.Matrix4[] = [];
    for (const k of cells) {
      if (grid.blocked[k] && !this.bridges.some((b) => dist(grid.centerOf(k % grid.n, Math.floor(k / grid.n)), b) < 1)) continue;
      const c = grid.centerOf(k % grid.n, Math.floor(k / grid.n));
      if (dist(c, plan.plaza.c) < plan.plaza.r - 0.2) continue;
      if (distToPolyline(c, this.island.riverPts) < plan.riverWidth * 0.75) continue;
      for (let n = 0; n < 3; n++) {
        const m = new THREE.Matrix4().compose(
          new THREE.Vector3(c.x + (r() - 0.5) * 0.45, 0.01, c.z + (r() - 0.5) * 0.45),
          new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * 3),
          new THREE.Vector3(0.8 + r() * 0.6, 1, 0.8 + r() * 0.6),
        );
        pts.push(m);
      }
    }
    const inst = new THREE.InstancedMesh(stoneGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 0.9 }), pts.length);
    const col = new THREE.Color();
    pts.forEach((m, i) => {
      inst.setMatrixAt(i, m);
      inst.setColorAt(i, col.setHSL(0.02 + r() * 0.06, 0.3 + r() * 0.2, 0.58 + r() * 0.12));
    });
    inst.receiveShadow = true;
    this.staticRoot.add(inst);
  }

  private buildPlaza(): void {
    const c = this.plan.plaza.c;
    // Plaza paving ring.
    const pave = new THREE.Mesh(
      new THREE.CylinderGeometry(this.plan.plaza.r, this.plan.plaza.r + 0.1, 0.06, 28),
      new THREE.MeshStandardMaterial({ color: 0xd9c6a8, flatShading: true, roughness: 0.95 }),
    );
    pave.position.set(c.x, 0.0, c.z);
    pave.receiveShadow = true;
    this.staticRoot.add(pave);

    // The landmark: Obelisk's own mark, in its real proportions, lit lime.
    this.obelisk = buildObelisk(8);
    this.obelisk.group.position.set(c.x, 0, c.z);
    this.obelisk.group.rotation.y = 0;
    this.staticRoot.add(this.obelisk.group);
    // Its steps are stairs: walked up and down (the grid keeps villagers off
    // them; you walk them through playerWalkable). The shaft is a wall.
    for (const st of plinthSteps(8)) this.solids.push({ minX: c.x - st.half, maxX: c.x + st.half, minZ: c.z - st.half, maxZ: c.z + st.half, top: st.top, stair: true });
    const shaft = obeliskShape(8).base;
    this.solids.push({ minX: c.x - shaft, maxX: c.x + shaft, minZ: c.z - shaft, maxZ: c.z + shaft, top: 99 });

    // Lanterns around the plaza.
    for (const p of plazaLanterns(this.plan)) {
      if (onLandmarkLawn(p, this.landmarkSlots)) continue; // a landmark's stairs or terrace come down here
      this.lantern(p);
    }
    // Three long benches, three places each, sharing a mate. They stand
    // round the voice tree nearest the plaza (placeBenches), or here when
    // there's none.
    for (let i = 0; i < 3; i++) {
      const a = 0.9 + i * 0.55;
      const b = model('town/stall-bench');
      b.scale.set(1, 1, 1.35);
      this.staticRoot.add(b);
      const home = { x: c.x + Math.cos(a) * (this.plan.plaza.r - 0.55), z: c.z + Math.sin(a) * (this.plan.plaza.r - 0.55) };
      const seats = [0, 1, 2].map((): Seat => ({ pos: { ...home }, face: 0, y: 0.22, taken: null, bench: `plaza:${i}`, managed: true }));
      this.seats.push(...seats);
      this.benches.push({ model: b, seats, solid: null, home, homeFace: Math.atan2(home.x - c.x, home.z - c.z) });
    }
    this.placeBenches();
  }

  /** The plaza's benches: where they stand now, their seats and solid. */
  private benches: { model: THREE.Object3D; seats: Seat[]; solid: Solid | null; home: Vec2; homeFace: number }[] = [];

  /** Benches round the voice tree nearest the plaza, else back at the plaza. */
  private placeBenches(): void {
    let best: { slot: Slot; b: Building } | null = null;
    for (const [id, b] of this.buildings) {
      const slot = this.slotFor(id);
      if (!b.tree || !slot) continue;
      if (!best || dist(slot.pos, this.plan.plaza.c) < dist(best.slot.pos, this.plan.plaza.c)) best = { slot, b };
    }
    this.benches.forEach((bench, i) => {
      const spot = best?.b.tree?.benchSpots[i];
      const mid = spot && best ? this.buildingToWorld(best.slot, spot.pos) : bench.home;
      const face = spot && best ? spot.face + best.slot.rot : bench.homeFace;
      const same = bench.seats[1] && dist(bench.seats[1].pos, mid) < 1e-6 && bench.seats[1].face === face;
      if (same) return;
      // Anyone on it gets up first.
      for (const s of bench.seats) {
        if (!s.taken) continue;
        if (s.taken.startsWith('pending:')) this.releasePending(s.taken.slice('pending:'.length));
        else this.stand(s.taken);
      }
      bench.model.position.set(mid.x, 0.03, mid.z);
      bench.model.rotation.y = face - Math.PI / 2;
      const along = { x: Math.sin(face - Math.PI / 2), z: Math.cos(face - Math.PI / 2) }; // its long axis
      bench.seats.forEach((s, k) => {
        const o = [-0.4, 0, 0.4][k];
        s.pos = { x: mid.x + along.x * o, z: mid.z + along.z * o };
        s.face = face;
      });
      if (bench.solid) { const j = this.solids.indexOf(bench.solid); if (j >= 0) this.solids.splice(j, 1); }
      bench.model.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(bench.model);
      bench.solid = box.isEmpty() ? null : { minX: box.min.x + 0.04, maxX: box.max.x - 0.04, minZ: box.min.z + 0.04, maxZ: box.max.z - 0.04, top: box.max.y };
      if (bench.solid) this.solids.push(bench.solid);
    });
  }

  /** A voice tree's chairs: seats sharing a mate round the trunk, each a little solid. */
  private treeSolids = new Map<string, Solid[]>();
  private setTreeSeats(id: string, slot: Slot | null, tree: Building['tree'] | null): void {
    for (let i = this.seats.length - 1; i >= 0; i--) {
      const s = this.seats[i];
      if (s.tree !== id) continue;
      if (s.taken?.startsWith('pending:')) this.releasePending(s.taken.slice('pending:'.length));
      else if (s.taken) this.stand(s.taken);
      this.seats.splice(i, 1);
    }
    for (const so of this.treeSolids.get(id) ?? []) { const j = this.solids.indexOf(so); if (j >= 0) this.solids.splice(j, 1); }
    this.treeSolids.delete(id);
    if (!tree || !slot) return;
    const solids: Solid[] = [];
    for (const ch of tree.seats) {
      const pos = this.buildingToWorld(slot, ch.pos);
      this.seats.push({ pos, face: ch.face + slot.rot, y: ch.y, taken: null, prop: ch.prop, tree: id, managed: true });
      const r = 0.1;
      const so = { minX: pos.x - r, maxX: pos.x + r, minZ: pos.z - r, maxZ: pos.z + r, top: ch.y };
      this.solids.push(so);
      solids.push(so);
    }
    this.treeSolids.set(id, solids);
  }

  /** A street lamp. Every one has a real light: the light budget
   *  (budgetLights) keeps only the nearest few on, so more lamps cost nothing. */
  private lantern(p: Vec2): void {
    const l = model('town/lantern');
    l.position.set(p.x, 0, p.z);
    l.scale.setScalar(0.6);
    this.staticRoot.add(l);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 4), this.lampGlow);
    bulb.position.set(p.x, 0.85, p.z);
    this.staticRoot.add(bulb);
    const pl = new THREE.PointLight(0xffb45a, 0, 5, 1.6);
    pl.position.set(p.x, 0.95, p.z);
    this.lampLights.push(pl);
    this.staticRoot.add(pl);
    // A thin post: you walk around it and can't jump over it.
    this.solids.push({ minX: p.x - 0.06, maxX: p.x + 0.06, minZ: p.z - 0.06, maxZ: p.z + 0.06, top: 3 });
  }

  private blockAround(p: Vec2, r: number): void {
    const [ci, cj] = this.grid.cellOf(p);
    const k = Math.ceil(r / 0.5);
    for (let dj = -k; dj <= k; dj++) for (let di = -k; di <= k; di++) {
      const c = this.grid.centerOf(ci + di, cj + dj);
      if (dist(c, p) <= r + 0.25 && this.grid.inBounds(ci + di, cj + dj)) this.obstacles.push(this.grid.idx(ci + di, cj + dj));
    }
  }

  private decorate(): void {
    const plan = this.plan;
    const props = new PropBatch();
    const r = rng(plan.seed + 77);
    const used = new Set(this.usedSlots().map((s) => s.index));
    const occupied = (p: Vec2, pad: number) =>
      dist(p, plan.plaza.c) < plan.plaza.r + 0.6 + pad
      || (!!this.millSite && dist(p, this.millSite.house) < 1.15 + pad)
      || (!!this.marketAt && dist(p, this.marketAt) < 2.4 + pad)
      || plan.slots.some((s) => inFootprint(p, s, 0.6 + pad) || dist(p, s.yard) < 1.2 + pad)
      || this.underLandmark(p, 0.6 + pad)
      || distToPolyline(p, this.island.riverPts) < plan.riverWidth * 0.7 + pad
      || dist(p, plan.pond.c) < plan.pond.r + 0.3 + pad
      || plan.mountains.some((m) => dist(p, m.pos) < m.r * 0.9 + pad)
      || this.onPath(p, pad)
      || (!!this.track && onTrack(p, this.track, 1.2 + pad));

    // Trees: denser toward the rim and in noise-driven groves.
    for (let n = 0; n < 2600; n++) {
      const th = r() * Math.PI * 2;
      const rr = Math.sqrt(r()) * (plan.radiusAt(th) - 0.9);
      const p = { x: Math.cos(th) * rr, z: Math.sin(th) * rr };
      const grove = fbm2(p.x * 0.16 + 4, p.z * 0.16) + (rr / plan.R) * 0.55;
      if (grove < 0.38) continue;
      if (occupied(p, 0.35)) continue;
      const nearMountain = plan.mountains.some((m) => dist(p, m.pos) < m.r + 2);
      const pool = nearMountain ? TREE_MODELS.filter((t) => t.includes('pine') || t.includes('cone')) : TREE_MODELS;
      const t = pool[Math.floor(r() * pool.length)];
      props.add(t, p.x, 0, p.z, r() * 6.28, 0.9 + r() * 0.7);
      this.blockAround(p, 0.2);
      if (r() < 0.25) props.add(BUSHES[Math.floor(r() * BUSHES.length)], p.x + (r() - 0.5) * 0.9, 0, p.z + (r() - 0.5) * 0.9, r() * 6.28, 0.8 + r() * 0.5);
    }
    // Flowers, grass tufts, rocks, mushrooms — walkable dressing.
    for (let n = 0; n < 1500; n++) {
      const th = r() * Math.PI * 2;
      const rr = Math.sqrt(r()) * (plan.radiusAt(th) - 0.6);
      const p = { x: Math.cos(th) * rr, z: Math.sin(th) * rr };
      if (occupied(p, 0)) continue;
      const k = r();
      if (k < 0.4) props.add(GRASS[Math.floor(r() * GRASS.length)], p.x, 0, p.z, r() * 6.28, 0.8 + r() * 0.6);
      else if (k < 0.75) {
        const f = FLOWERS[Math.floor(fbm2(p.x * 0.3, p.z * 0.3) * 3 + 3) % FLOWERS.length];
        props.add(f, p.x, 0, p.z, r() * 6.28, 0.9 + r() * 0.6);
      } else if (k < 0.88) props.add(ROCKS[Math.floor(r() * ROCKS.length)], p.x, -0.02, p.z, r() * 6.28, 0.35 + r() * 0.4);
      else if (k < 0.94) props.add(r() < 0.5 ? 'nature/mushroom_red' : 'nature/mushroom_redGroup', p.x, 0, p.z, r() * 6.28, 0.7);
      else props.add(BUSHES[Math.floor(r() * BUSHES.length)], p.x, 0, p.z, r() * 6.28, 0.8 + r() * 0.4);
    }
    // Pond: lilies and reeds; rocks along the rim of the island top.
    for (let i = 0; i < 9; i++) {
      const a = r() * 6.28, d = r() * (plan.pond.r - 0.4);
      props.add(r() < 0.5 ? 'nature/lily_large' : 'nature/lily_small', plan.pond.c.x + Math.cos(a) * d, -0.12, plan.pond.c.z + Math.sin(a) * d, r() * 6.28, 1);
    }
    for (let i = 0; i < 70; i++) {
      const th = r() * Math.PI * 2;
      const rr = plan.radiusAt(th) - 0.35 - r() * 0.4;
      props.add(ROCKS[Math.floor(r() * ROCKS.length)], Math.cos(th) * rr, -0.1, Math.sin(th) * rr, r() * 6.28, 0.4 + r() * 0.6);
    }
    // Empty slots become gardens, camps and groves (slotDecor), removed the
    // moment a channel takes the slot.
    for (const sl of plan.slots) {
      if (this.track && onTrack(sl.pos, this.track, sl.w * 0.7 + 0.6)) continue;
      this.slotDecor.set(sl.index, this.buildSlotDecor(sl));
    }
    // Landmarks.
    if (this.millSite) {
      this.mill = buildMill(this.millSite, plan.riverWidth * 0.62);
      this.staticRoot.add(this.mill.group);
      this.blockAround(this.millSite.house, 0.85);
    }
    const fire = model('nature/campfire_logs');
    fire.position.set(plan.campfire.x, 0, plan.campfire.z);
    this.staticRoot.add(fire);
    for (let i = 0; i < 3; i++) {
      const pos = { x: plan.campfire.x + Math.cos(i * 2.1) * 0.8, z: plan.campfire.z + Math.sin(i * 2.1) * 0.8 };
      props.add('nature/log', pos.x, 0, pos.z, i * 2.1 + 1.57, 0.8);
      this.seats.push({ pos, face: Math.atan2(plan.campfire.x - pos.x, plan.campfire.z - pos.z), y: 0.12, taken: null });
    }
    // Two stools by the pond.
    for (const a of [2.4, 2.9]) {
      const pos = { x: plan.pond.c.x + Math.cos(a) * (plan.pond.r + 0.7), z: plan.pond.c.z + Math.sin(a) * (plan.pond.r + 0.7) };
      const st = model('town/stall-stool');
      st.position.set(pos.x, 0, pos.z);
      this.staticRoot.add(st);
      this.seats.push({ pos, face: Math.atan2(plan.pond.c.x - pos.x, plan.pond.c.z - pos.z), y: 0.2, taken: null });
    }

    props.build(this.staticRoot, { sway: (p) => p.includes('tree_') || p.includes('plant_') });
    this.swaying = props.swaying;
    this.installSway();
    this.rebuildGrid();
  }

  private onPath(p: Vec2, pad: number): boolean {
    if (!this.pathCells.size) return false;
    const [i, j] = this.grid.cellOf(p);
    const k = Math.ceil((pad + 0.25) / 0.5);
    for (let dj = -k; dj <= k; dj++) for (let di = -k; di <= k; di++) {
      if (this.pathCells.has(this.grid.idx(i + di, j + dj))) return true;
    }
    return false;
  }

  /** Wind: a vertex-shader sway on tree and bush materials. */
  private swayUniform = { value: 0 };
  private installSway(): void {
    const seen = new Set<THREE.Material>();
    for (const inst of this.swaying) {
      const mats = Array.isArray(inst.material) ? inst.material : [inst.material];
      for (const m of mats) {
        if (seen.has(m)) continue;
        seen.add(m);
        m.onBeforeCompile = (shader) => {
          shader.uniforms.uWind = this.swayUniform;
          shader.vertexShader = shader.vertexShader
            .replace('#include <common>', '#include <common>\nuniform float uWind;')
            .replace('#include <begin_vertex>', `#include <begin_vertex>
              #ifdef USE_INSTANCING
                vec3 ip = vec3(instanceMatrix[3][0], 0.0, instanceMatrix[3][2]);
                float sw = sin(uWind * 1.3 + ip.x * 0.7 + ip.z * 0.5) * 0.06 + sin(uWind * 2.7 + ip.z) * 0.02;
                transformed.x += sw * max(position.y, 0.0);
                transformed.z += sw * 0.5 * max(position.y, 0.0);
              #endif`);
        };
        m.needsUpdate = true;
      }
    }
  }

  private grass: THREE.InstancedMesh | null = null;

  /** A field of grass blades over the open ground, swaying in the wind
   *  (High and Ultra; it costs one draw call but many vertices). */
  private buildGrass(count: number): void {
    this.grass?.removeFromParent();
    this.grass = null;
    if (!count) return;
    const blade = grassTuft();
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.85, side: THREE.DoubleSide });
    const inst = new THREE.InstancedMesh(blade, mat, count);
    const r = rng(1234);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const col = new THREE.Color();
    let n = 0;
    for (let tries = 0; tries < count * 4 && n < count; tries++) {
      const th = r() * Math.PI * 2;
      const rr = Math.sqrt(r()) * (this.plan.R - 1.2);
      const p = { x: Math.cos(th) * rr, z: Math.sin(th) * rr };
      if (dist(p, this.plan.plaza.c) < this.plan.plaza.r + 0.3) continue;
      if (distToPolyline(p, this.island.riverPts) < this.plan.riverWidth) continue;
      if (dist(p, this.plan.pond.c) < this.plan.pond.r + 0.6) continue;
      if (this.plan.mountains.some((mt) => dist(p, mt.pos) < mt.r)) continue;
      if (this.track && onTrack(p, this.track, 0.1)) continue;
      if (this.plan.slots.some((s) => inFootprint(p, s, 0.1))) continue;
      if (this.underLandmark(p, 0.1)) continue; // no grass through a landmark's floor
      if (this.onPath(p, 0)) continue;
      if (this.marketAt && dist(p, this.marketAt) < 2.1) continue;
      // Tufts grow in clumps: thin out where the clump noise is low.
      if (fbm2(p.x * 0.9 + 31, p.z * 0.9) < -0.12 && r() < 0.7) continue;
      q.setFromEuler(new THREE.Euler((r() - 0.5) * 0.25, r() * 6.28, (r() - 0.5) * 0.25));
      const s = 0.65 + r() * 0.8;
      m.compose(new THREE.Vector3(p.x, 0, p.z), q, new THREE.Vector3(s, s * (0.8 + r() * 0.6), s));
      inst.setMatrixAt(n, m);
      inst.setColorAt(n, col.setHSL(0.22 + r() * 0.07, 0.5 + r() * 0.2, 0.36 + r() * 0.16));
      n++;
    }
    inst.count = n;
    inst.receiveShadow = true;
    inst.instanceMatrix.needsUpdate = true;
    this.swaying.push(inst);
    this.installSway();
    this.staticRoot.add(inst);
    this.grass = inst;
  }

  /** Local preferences → the scene (see prefs.ts). */
  applyPrefs(p: Prefs): void {
    this.post.configure({ quality: p.quality, resolution: p.resolution, shadows: p.shadows, ambientOcclusion: p.ambientOcclusion, bloom: p.bloom, tiltShift: p.tiltShift });
    this.sky.override = p.timeOfDay as TimeOverride;
    this.overlay.showSigns = p.signs;
    this.overlay.showBubbles = p.bubbles;
    this.cam.auto = p.autoDirector;
    this.cam.sensitivity = p.mouseSensitivity;
    this.cam.invertY = p.invertY;
    this.fpFov = p.fov;
    this.cam.fpFov = p.fov;
    const level = this.post.level;
    this.grassPref = p.grass;
    const want = grassFor(p.grass, level);
    if (this.built && (this.grass?.count ?? 0) !== want && Math.abs((this.grass?.count ?? 0) - want) > 500) this.buildGrass(want);
    this.grassWanted = want;
    // Sharper textures at a glancing angle.
    const aniso = level === 'ultra' ? 16 : level === 'high' ? 8 : 1;
    this.scene.traverse((o) => {
      const mat = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (mat && !Array.isArray(mat) && mat.map && mat.map.anisotropy !== aniso) { mat.map.anisotropy = aniso; mat.map.needsUpdate = true; }
    });
  }

  fpFov = 70;
  private grassWanted = 0;
  private grassPref = true;
  /** How many house pieces were folded into merged meshes (__sky.perf). */
  meshesMerged = 0;

  private buildFireflies(): void {
    const r = rng(3);
    const pos: number[] = [];
    for (let i = 0; i < 160; i++) {
      const th = r() * 6.28, rr = Math.sqrt(r()) * (this.plan.R - 2);
      pos.push(Math.cos(th) * rr, 0.3 + r() * 1.2, Math.sin(th) * rr);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this.fireflies = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xe8ff7a, size: 0.09, transparent: true, opacity: 0, depthWrite: false }));
    this.staticRoot.add(this.fireflies);
  }

  // ── people ────────────────────────────────────────────────────────────

  private repaintQueued = false;

  setProfile(p: WireProfile): void {
    this.profiles.set(p.pubkey, p);
    this.people.get(p.pubkey)?.setProfile(p.name, p.avatar);
    // Bubbles already on screen may mention this person by npub: redraw them
    // once per frame at most.
    if (!this.repaintQueued) {
      this.repaintQueued = true;
      requestAnimationFrame(() => { this.repaintQueued = false; this.overlay.repaintBubbles(); });
    }
  }

  nameOf(pk: string): string {
    return this.profiles.get(pk)?.name ?? shortNpub(pk);
  }

  private yardSpot(groupId: string, spread = 1.5): Vec2 {
    const s = this.slotFor(groupId);
    const base = s ? s.yard : this.plan.plaza.c;
    for (let i = 0; i < 12; i++) {
      const a = this.wanderRng() * 6.28, d = this.wanderRng() * spread;
      const p = { x: base.x + Math.cos(a) * d, z: base.z + Math.sin(a) * d };
      if (this.grid.isWalkable(p)) return p;
    }
    return this.grid.nearestWalkable(base) ?? base;
  }

  private doorOf(groupId: string): Vec2 {
    const b = this.buildings.get(groupId);
    if (!b) return this.yardSpot(groupId, 0.5);
    const v = b.doorLocal.clone().applyMatrix4(b.group.matrixWorld);
    return { x: v.x, z: v.z };
  }

  private walkTo(c: Character, to: Vec2, opts: { instant?: boolean; run?: boolean; then?: () => void } = {}): void {
    if (opts.instant) {
      c.place(this.grid.nearestWalkable(to) ?? to);
      opts.then?.();
      return;
    }
    const path = this.grid.findPath(c.pos, to);
    if (!path) { c.place(this.grid.nearestWalkable(to) ?? to); opts.then?.(); return; }
    const far = dist(c.pos, to) > 9;
    c.walk(path, opts.run ?? far, opts.then);
  }

  private spawn(pk: string, groupId: string, arrival: 'instant' | 'balloon' | 'door'): void {
    let c = this.people.get(pk);
    if (c && this.leaving.has(c)) {
      this.leaving.delete(c);
      c.targetOpacity = 1;
      return;
    }
    if (c) { this.claimSpawned.delete(pk); return; }
    c = this.makePerson(pk);
    if (arrival === 'door') {
      c.place(this.doorOf(groupId));
      this.walkTo(c, this.yardSpot(groupId));
    } else if (arrival === 'balloon') {
      c.place(this.yardSpot(groupId, 1));
      this.balloon(c);
      this.hooks.onArrive?.();
    } else {
      c.place(this.yardSpot(groupId, 2.2));
      c.body.rotation.y = this.wanderRng() * 6.28;
    }
  }

  private makePerson(pk: string): Character {
    const prof = this.profiles.get(pk);
    const c = new Character(pk, prof?.name ?? vw.someone);
    c.setProfile(prof?.name ?? shortNpub(pk), prof?.avatar ?? null);
    this.people.set(pk, c);
    this.applyAvatar(c);
    this.scene.add(c.root);
    this.hooks.onPersonMade?.(pk);
    c.idleFor = this.wanderRng() * 8;
    return c;
  }

  /** People who live at a landmark: they stay put and never leave. */
  private residents = new Set<string>();

  /** Put someone at a landmark for good (the nostr-wot account at its HQ). */
  addResident(pk: string, at: LandmarkId, badge?: string): void {
    const spot = this.landmarkResidentSpot(at);
    if (!spot || this.people.has(pk)) return;
    const prof = this.profiles.get(pk);
    const c = new Character(pk, prof?.name ?? shortNpub(pk));
    c.setProfile(prof?.name ?? shortNpub(pk), prof?.avatar ?? null);
    if (badge) c.setBadgeMark(badge);
    this.people.set(pk, c);
    this.residents.add(pk);
    this.applyAvatar(c);
    this.scene.add(c.root);
    c.place(spot.pos);
    c.body.rotation.y = spot.face;
    c.faceToward({ x: spot.pos.x + Math.sin(spot.face), z: spot.pos.z + Math.cos(spot.face) });
  }

  private despawn(pk: string): void {
    if (this.residents.has(pk)) return;
    if (this.pinned(pk)) { this.despawnLater.add(pk); return; }
    const c = this.people.get(pk);
    if (!c) return;
    this.stopTraining(pk);
    this.stand(pk);
    this.dismount(pk);
    this.people.delete(pk);
    this.pets.get(pk)?.dispose();
    this.pets.delete(pk);
    this.leaving.add(c);
    c.targetOpacity = 0;
    this.convoOf.delete(pk);
  }

  apply(cmds: Command[]): void {
    for (const cmd of cmds) {
      switch (cmd.c) {
        case 'spawn': this.spawn(cmd.pk, cmd.groupId, cmd.arrival); break;
        case 'despawn': if (cmd.pk !== this.playerPk) this.despawn(cmd.pk); break;
        case 'goto-yard': {
          const c = this.people.get(cmd.pk);
          if (!c || cmd.pk === this.playerPk || this.pinned(cmd.pk)) break;
          this.stand(cmd.pk);
          this.stopTraining(cmd.pk);
          this.leaveConvoSpot(cmd.pk);
          c.stand();
          this.homeward.delete(cmd.pk);
          c.targetOpacity = 1;
          this.walkTo(c, this.yardSpot(cmd.groupId), { instant: cmd.instant });
          break;
        }
        case 'goto-convo': {
          const c = this.people.get(cmd.pk);
          if (!c) break;
          if (cmd.pk === this.playerPk) { this.convoOf.set(cmd.pk, cmd.convoId); break; }
          if (this.pinned(cmd.pk)) break;
          this.stand(cmd.pk);
          this.stopTraining(cmd.pk);
          this.homeward.delete(cmd.pk);
          c.targetOpacity = 1;
          const spot = this.convoSpot(cmd.convoId, cmd.groupId);
          if (!spot.members.includes(cmd.pk)) spot.members.push(cmd.pk);
          this.leaveConvoSpot(cmd.pk, cmd.convoId);
          this.convoOf.set(cmd.pk, cmd.convoId);
          const spots = circleSpots(spot.center, cmd.size, spot.sitting ? 0.75 : 0.5);
          const target = spots[cmd.slot % spots.length];
          c.stand();
          this.walkTo(c, target, {
            instant: cmd.instant,
            then: () => {
              c.faceToward(spot.center);
              if (spot.sitting || this.pendingSit.has(cmd.pk)) { this.pendingSit.delete(cmd.pk); c.sit(); }
            },
          });
          break;
        }
        case 'say': this.say(cmd.pk, cmd.msg, cmd.to, cmd.instant); break;
        case 'face': {
          const c = this.people.get(cmd.pk), t = this.people.get(cmd.target);
          if (c && t && !c.path.length) c.faceToward(t.pos);
          break;
        }
        case 'sit': {
          const spot = this.convos.get(cmd.convoId);
          if (!spot) break;
          spot.sitting = true;
          if (!spot.fire) {
            spot.fire = model('nature/campfire_logs');
            spot.fire.position.set(spot.center.x, 0, spot.center.z);
            spot.fire.scale.setScalar(0.01);
            this.scene.add(spot.fire);
            this.grow(spot.fire, 1);
          }
          // Spread out a little to make room for the fire.
          cmd.members.forEach((pk, i) => {
            const c = this.people.get(pk);
            if (!c || this.pinned(pk)) return;
            const spots = circleSpots(spot.center, cmd.members.length, 0.75);
            this.walkTo(c, spots[i], { instant: cmd.instant, then: () => { c.faceToward(spot.center); c.sit(); } });
          });
          break;
        }
        case 'convo-end': {
          const spot = this.convos.get(cmd.convoId);
          if (spot?.fire) this.shrinkAndRemove(spot.fire);
          this.convos.delete(cmd.convoId);
          for (const pk of cmd.members) {
            if (this.convoOf.get(pk) === cmd.convoId) this.convoOf.delete(pk);
            const c = this.people.get(pk);
            if (c && !this.pinned(pk)) { c.stand(); c.idleFor = 2 + this.wanderRng() * 6; }
          }
          break;
        }
        case 'react': {
          const from = this.people.get(cmd.from), to = this.people.get(cmd.to);
          if (cmd.instant) break;
          from?.cheer();
          this.pulseLandmarks();
          if (from && to && !from.path.length) from.faceToward(to.pos);
          if (to) this.overlay.pop(this.headAnchor(cmd.to, 0.3), cmd.emoji);
          this.pets.get(cmd.to)?.dance();
          break;
        }
        case 'zap': {
          if (cmd.instant || Date.now() - cmd.queued > ZAP_STALE_MS) break;
          this.zapEffect(cmd.from, cmd.to, cmd.sats);
          break;
        }
      }
    }
  }

  private convoSpot(id: number, groupId: string): ConvoSpot {
    let s = this.convos.get(id);
    if (s) {
      // A circle that includes you gathers where you stand.
      const me = this.playerPk ? this.people.get(this.playerPk) : null;
      if (me && this.convoOf.get(this.playerPk!) === id) s.center = this.grid.nearestWalkable(me.pos) ?? me.pos;
      return s;
    }
    const others = [...this.convos.values()].filter((c) => c.groupId === groupId).length;
    const slot = this.slotFor(groupId);
    let base = slot ? slot.yard : this.plan.plaza.c;
    if (others > 0 && slot) {
      // Second and later conversations at the same channel spread sideways.
      const side = { x: Math.cos(slot.rot), z: -Math.sin(slot.rot) };
      const k = (others % 2 ? 1 : -1) * Math.ceil(others / 2) * 2.0;
      base = { x: base.x + side.x * k, z: base.z + side.z * k };
    }
    const center = this.grid.nearestWalkable(base) ?? base;
    s = { center, groupId, members: [], fire: null, sitting: false };
    this.convos.set(id, s);
    return s;
  }

  private leaveConvoSpot(pk: string, except?: number): void {
    const prev = this.convoOf.get(pk);
    if (prev === undefined || prev === except) return;
    const s = this.convos.get(prev);
    if (s) s.members = s.members.filter((m) => m !== pk);
    this.convoOf.delete(pk);
  }

  headAnchor(pk: string, extra = 0): { get(): THREE.Vector3 | null } {
    return {
      get: () => {
        const c = this.people.get(pk);
        if (!c || !c.root.visible) return null;
        // Over the head itself, so bubbles rise with a jump or a pull-up.
        return c.headTop(new THREE.Vector3()).add(new THREE.Vector3(0, 0.18 + extra, 0));
      },
    };
  }

  private say(pk: string, msg: WireMessage, to: string | null, instant: boolean): void {
    const { groupId, text } = msg;
    if (this.hooks.hears && !this.hooks.hears(pk, groupId)) return;
    this.hooks.onSay?.(pk, groupId, text, to, instant);
    if (instant) return;
    this.pulse = 1;
    const c = this.people.get(pk);
    if (!c) return;
    c.targetOpacity = 1;
    this.homeward.delete(pk);
    const seconds = Math.min(9, 3.5 + [...text].length * 0.05);
    c.talk(seconds);
    const g = this.groups.get(groupId);
    const header = `${this.nameOf(pk)} · ${g?.name ?? ''}`.toUpperCase();
    this.overlay.say(pk, this.headAnchor(pk), header, text, {
      accent: pubkeyColor(pk),
      seconds,
      reply: to ? this.nameOf(to) : null,
      render: (el) => renderContent(el, msg.content ?? text, { nameOf: (p) => this.nameOf(p), images: msg.images, emojis: msg.emojis, onMention: (p) => this.hooks.onPersonClick?.(p) }),
      headerOf: () => `${this.nameOf(pk)} · ${g?.name ?? ''}`.toUpperCase(),
      replyOf: () => (to ? this.nameOf(to) : null),
      onClick: () => this.hooks.onBubbleClick?.(msg.id),
      // For you (a reply or your name in it): it stands out.
      ping: !!this.playerPk && pingReason(msg, this.playerPk) !== null,
    });
    const pts = [c.root.position.clone()];
    const partner = to ? this.people.get(to) : null;
    if (partner) pts.push(partner.root.position.clone());
    this.cam.interest(pts);
  }

  // ── effects ───────────────────────────────────────────────────────────

  private grow(obj: THREE.Object3D, to: number): void {
    this.effects.push({ obj, age: 0, life: 0.6, tick: (e) => obj.scale.setScalar(Math.max(0.01, to * easeOutBack(e.age / e.life))) });
  }

  private shrinkAndRemove(obj: THREE.Object3D): void {
    const s0 = obj.scale.x;
    this.effects.push({
      obj, age: 0, life: 0.5,
      tick: (e) => {
        obj.scale.setScalar(Math.max(0.001, s0 * (1 - e.age / e.life)));
        if (e.age >= e.life) obj.removeFromParent();
      },
    });
  }

  private balloon(c: Character): void {
    c.lift = 7;
    const g = new THREE.Group();
    const color = new THREE.Color(pubkeyColor(c.pk));
    const envelope = new THREE.Mesh(new THREE.SphereGeometry(0.42, 10, 8), new THREE.MeshStandardMaterial({ color, flatShading: true }));
    envelope.scale.y = 1.15;
    envelope.position.y = 1.45;
    const basket = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.2, 0.34), new THREE.MeshStandardMaterial({ color: 0x8a5a33, flatShading: true }));
    basket.position.y = -0.05;
    const ropeMat = new THREE.LineBasicMaterial({ color: 0x5a4030 });
    for (const [x, z] of [[-0.15, -0.15], [0.15, -0.15], [-0.15, 0.15], [0.15, 0.15]]) {
      const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x, 0.05, z), new THREE.Vector3(x * 2, 1.15, z * 2)]);
      g.add(new THREE.Line(geo, ropeMat));
    }
    g.add(envelope, basket);
    envelope.castShadow = true;
    this.scene.add(g);
    let released = false;
    this.effects.push({
      obj: g, age: 0, life: 12,
      tick: (e, dt) => {
        if (!released) {
          g.position.set(c.root.position.x, c.lift, c.root.position.z);
          if (c.lift <= 0) { released = true; c.cheer(1.4); }
        } else {
          g.position.y += dt * 1.4;
          g.position.x += dt * 0.6;
          g.rotation.y += dt * 0.3;
          if (e.age > e.life - 0.1) g.removeFromParent();
        }
      },
    });
  }

  /** A zap flies from the sender (or out of the sky) to the recipient and bursts into coins. */
  private zapEffect(from: string | null, to: string, sats: number): void {
    const t = this.people.get(to);
    if (!t) return;
    const head = (c: Character, y: number) => c.root.position.clone().setY(c.root.position.y + y);
    const f = from ? this.people.get(from) : null;
    const end = head(t, CHAR_HEIGHT + 0.2);
    const start = f ? head(f, CHAR_HEIGHT + 0.4) : end.clone().add(new THREE.Vector3(1.5, 8, 0.5));
    f?.cheer();
    if (f) f.faceToward(t.pos);
    // Aim at where the recipient is now, not where they stood (while they're still here).
    this.zaps.launch(to, start, () => (this.people.get(to) === t ? head(t, CHAR_HEIGHT + 0.2) : null), sats);
  }

  private zapLands(to: string, end: THREE.Vector3, sats: number): void {
    this.pulseLandmarks();
    const t = this.people.get(to);
    t?.cheer(2);
    this.pets.get(to)?.dance(3.5);
    if (t) this.overlay.pop(this.headAnchor(to, 0.35), `⚡ ${sats.toLocaleString()} sats`, 'pop zap');
    const now = performance.now();
    if (now - this.zapCamAt > 1500) this.cam.interest([end], true);
    this.zapCamAt = now;
    this.hooks.onZap?.(to, sats);
  }

  // ── idle life ─────────────────────────────────────────────────────────

  private idleLife(c: Character, dt: number): void {
    if (c.pk === this.playerPk || this.pinned(c.pk)) return;
    const inside = this.homeward.get(c.pk);
    if (inside !== undefined) {
      const left = inside - dt;
      if (left <= 0) {
        this.homeward.delete(c.pk);
        c.targetOpacity = 1;
        const g = this.homeGroup(c.pk);
        if (g) this.walkTo(c, this.yardSpot(g));
      } else this.homeward.set(c.pk, left);
      return;
    }
    const until = this.seatedUntil.get(c.pk);
    if (until !== undefined) {
      if (this.elapsed > until) { this.stand(c.pk); c.idleFor = 0; }
      return;
    }
    const trainEnd = this.trainUntil.get(c.pk);
    if (trainEnd !== undefined) {
      if (this.elapsed > trainEnd) { this.stopTraining(c.pk); c.idleFor = 0; }
      return;
    }
    if (this.convoOf.has(c.pk) || c.path.length || c.talkingFor > 0 || c.activity === 'sit') return;
    const threshold = 7 + (hashStr(c.pk) % 13);
    if (c.idleFor < threshold) return;
    c.idleFor = 0;
    const home = this.homeGroup(c.pk);
    const daylight = 1 - this.sky.day < 0.3;
    // Their favourite places first, about two times in three (world/places.ts).
    const { roll, haunt } = pickIdle(this.wanderRng, { haunts: this.hauntsOf(c.pk), daylight, night: this.sky.night, hasHome: !!home });
    if (haunt && this.goHaunt(c, haunt, home)) return;
    // By day, a coffee at the café now and then.
    if (daylight && roll >= 0.6 && roll < 0.68) {
      const seat = this.seats.find((x) => x.landmark === 'coffee' && !x.taken);
      if (seat) { this.goSit(c, seat, 25, 35); return; }
    }
    // Evenings at the parrilla: some neighbours take a place at the table.
    if (!daylight && roll >= 0.35 && roll < 0.55) {
      const seat = this.seats.find((x) => x.landmark === 'parrilla' && !x.taken);
      if (seat) { this.goSit(c, seat, 40, 60); return; }
    }
    // At night most idle folk head indoors for a while.
    if (this.sky.night && home && roll < 0.35) {
      this.walkTo(c, this.doorOf(home), {
        then: () => { c.targetOpacity = 0; this.homeward.set(c.pk, 40 + this.wanderRng() * 80); },
      });
      return;
    }
    // Sports folk run laps, each in a lane of their own…
    const sporty = !!home && this.districtFor(home) === 'sports';
    if (sporty && roll < 0.35 && this.goLane(c)) return;
    // …or lift at the gym: in through the door, then straight to a free machine…
    if (sporty && roll >= 0.35 && roll < 0.45 && this.goGym(c)) return;
    // …and do a set in the park.
    if (sporty && roll >= 0.4 && roll < 0.6 && this.goPark(c)) return;
    // Some sit down with a mate for a while.
    if (roll > 0.88) {
      const seat = this.nearestFreeSeat(c.pos, 9, true);
      if (seat) { this.goSit(c, seat, 25, 40); return; }
    }
    let target: Vec2;
    if (roll < 0.5 && home) target = this.yardSpot(home, 2.2);
    else if (roll < 0.68) target = this.spotNear(this.plan.plaza.c, this.plan.plaza.r - 0.4, 1.2);
    else if (roll < 0.78) target = this.spotNear(this.plan.pond.c, this.plan.pond.r + 0.6, 0.4);
    else if (roll < 0.86) target = this.spotNear(this.plan.campfire, 1.1, 0.2);
    else {
      const slots = this.usedSlots();
      target = slots.length ? this.yardSpot(this.groupAtSlot(slots[Math.floor(this.wanderRng() * slots.length)].index) ?? '', 1.5) : this.plan.plaza.c;
    }
    this.walkTo(c, target, { run: false });
  }

  /** Walk over and sit for `base` + up to `span` seconds. */
  private goSit(c: Character, seat: Seat, base: number, span: number): void {
    this.reserve(c.pk, seat);
    this.walkTo(c, seat.pos, {
      then: () => {
        this.releasePending(c.pk);
        this.sit(c.pk, seat);
        this.seatedUntil.set(c.pk, this.elapsed + base + this.wanderRng() * span);
      },
    });
  }

  /** Laps in a free lane of the track; false when every lane is taken. */
  private goLane(c: Character): boolean {
    const lane = this.lanes.find((x) => !x.taken);
    if (!lane) return false;
    this.reserve(c.pk, lane);
    this.walkTo(c, this.lanePath(lane.lane!, c.pos)[0], {
      then: () => {
        this.releasePending(c.pk);
        if (this.train(c.pk, lane, 'run')) this.trainUntil.set(c.pk, this.elapsed + 20 + this.wanderRng() * 30);
      },
    });
    return true;
  }

  /** A free machine in the gym, in through its door; false with no gym or none free. */
  private goGym(c: Character): boolean {
    const machine = this.stations.find((x) => x.gym && !x.taken);
    const slot = this.gymId ? this.slotFor(this.gymId) : null;
    if (!machine || !this.gym || !this.gymId || !slot) return false;
    this.reserve(c.pk, machine);
    const inside = this.buildingToWorld(slot, { x: 0, z: slot.d / 2 - 0.35 });
    this.walkTo(c, this.doorOf(this.gymId), {
      then: () => c.walk([inside, this.stationApproach(machine)], false, () => {
        this.releasePending(c.pk);
        const kind = machine.kinds[0];
        if (this.train(c.pk, machine, kind)) this.trainUntil.set(c.pk, this.elapsed + 12 + this.wanderRng() * 16);
      }),
    });
    return true;
  }

  /** A set at a free station in the park. */
  private goPark(c: Character): boolean {
    const st = this.stations.find((x) => !x.taken && !x.gym);
    if (!st) return false;
    this.reserve(c.pk, st);
    const kind = st.kinds[Math.floor(this.wanderRng() * st.kinds.length)];
    this.walkTo(c, this.stationApproach(st), {
      then: () => {
        this.releasePending(c.pk);
        if (this.train(c.pk, st, kind)) this.trainUntil.set(c.pk, this.elapsed + 10 + this.wanderRng() * 14);
      },
    });
    return true;
  }

  // ── favourite places (world/places.ts) ────────────────────────────────

  /** Haunts set by other sources (a guest island's scripted people). */
  private scriptedHaunts = new Map<string, PlaceId[]>();

  /** Give `pk` favourite places from outside their avatar (an empty list clears them). */
  setHaunts(pk: string, list: readonly string[]): void {
    const h = parseHaunts(list);
    if (h.length) this.scriptedHaunts.set(pk, h);
    else this.scriptedHaunts.delete(pk);
  }

  /** Where `pk` likes to hang around: their saved avatar's, else any set from outside. */
  hauntsOf(pk: string): PlaceId[] {
    const own = this.avatars.get(pk)?.haunts;
    return own?.length ? own : this.scriptedHaunts.get(pk) ?? [];
  }

  /** Free seats near `at` (outdoor only: indoor seats are for players). */
  private freeSeatNear(at: Vec2, within: number, test: (s: Seat) => boolean = () => true): Seat | null {
    let best: Seat | null = null, bd = Infinity;
    for (const s of this.seats) {
      if (s.taken || s.indoor || !test(s)) continue;
      const d = dist(s.pos, at);
      if (d <= within && d < bd) { best = s; bd = d; }
    }
    return best;
  }

  /** Open ground in front of a landmark (its yard), for those that have no seat to offer. */
  private landmarkYard(id: LandmarkId): Vec2 | null {
    const s = this.landmarkSlots.get(id);
    if (!s) return null;
    return this.spotNear(s.yard, 0.5, 0.8);
  }

  /**
   * Send `c` to one of their favourite places: a free seat or station there
   * when there is one, else a spot to stand about. False when the place
   * isn't on this island (no gym, no market) or has no room just now.
   */
  private goHaunt(c: Character, id: PlaceId, home: string | null): boolean {
    const walk = (to: Vec2 | null) => { if (to) this.walkTo(c, to, { run: false }); return !!to; };
    const sitOr = (seat: Seat | null, base: number, span: number, to: Vec2 | null) => {
      if (seat && this.wanderRng() < 0.6) { this.goSit(c, seat, base, span); return true; }
      return walk(to);
    };
    switch (id) {
      case 'coffee': return sitOr(this.seats.find((x) => x.landmark === 'coffee' && !x.taken) ?? null, 25, 35, this.landmarkYard('coffee'));
      case 'parrilla': return sitOr(this.seats.find((x) => x.landmark === 'parrilla' && !x.taken) ?? null, 40, 60, this.landmarkYard('parrilla'));
      case 'nostrwot': case 'lacrypta': return walk(this.landmarkYard(id));
      case 'campfire': {
        // The logs by the plaza's fire, or a voice tree's chairs.
        const at = this.plan.campfire;
        const seat = this.freeSeatNear(at, 1.5) ?? this.freeSeatNear(c.pos, 30, (s) => !!s.tree);
        return sitOr(seat, 30, 40, this.spotNear(at, 1.1, 0.2));
      }
      case 'pond': {
        const { c: at, r } = this.plan.pond;
        return sitOr(this.freeSeatNear(at, r + 1.2), 25, 35, this.spotNear(at, r + 0.6, 0.4));
      }
      case 'plaza': {
        const seat = this.freeSeatNear(this.plan.plaza.c, this.plan.plaza.r + 0.5, (s) => !!s.bench?.startsWith('plaza:'));
        return sitOr(seat, 25, 40, this.spotNear(this.plan.plaza.c, this.plan.plaza.r - 0.4, 1.2));
      }
      case 'park': return this.goPark(c);
      case 'track': return this.goLane(c);
      case 'gym': return this.goGym(c);
      case 'market': return walk(this.marketAt ? this.spotNear(this.marketAt, 0.6, 0.8) : null);
      case 'home': return walk(home ? this.yardSpot(home, 2.2) : null);
    }
  }

  private spotNear(c: Vec2, r: number, jitter: number): Vec2 {
    const a = this.wanderRng() * 6.28;
    const rr = r + (this.wanderRng() - 0.5) * jitter;
    const p = { x: c.x + Math.cos(a) * rr, z: c.z + Math.sin(a) * rr };
    return this.grid.nearestWalkable(p) ?? p;
  }

  private groupAtSlot(i: number): string | null {
    for (const [g, s] of this.slotOf) if (s === i) return g;
    return null;
  }

  homeOf = new Map<string, string>();
  private homeGroup(pk: string): string | null {
    return this.homeOf.get(pk) ?? null;
  }

  // ── avatars and pets ──────────────────────────────────────────────────

  /** Someone's chosen look (or a live preview of yours in the creator). */
  setAvatar(pk: string, a: Avatar): void {
    this.avatars.set(pk, a);
    const c = this.people.get(pk);
    if (c) this.applyAvatar(c);
  }

  private applyAvatar(c: Character): void {
    const a = this.avatars.get(c.pk);
    if (!a) return;
    if (a.look) c.setLook(a.look);
    else c.setSkin(a.skin);
    c.setHat(buildHat(a.hat, a.hatColor));
    const pet = this.pets.get(c.pk);
    if (pet && (!a.pet || pet.kind !== a.pet.kind || pet.name !== a.pet.name)) { pet.dispose(); this.pets.delete(c.pk); }
    if (a.pet && !this.pets.has(c.pk)) {
      const p = new Pet(a.pet.kind, a.pet.name, c);
      this.pets.set(c.pk, p);
      this.scene.add(p.root);
    }
  }

  // ── voice ─────────────────────────────────────────────────────────────

  private speakRings = new Map<string, THREE.Mesh>();
  private ringMat = new THREE.MeshBasicMaterial({ color: 0xb4f953, transparent: true, opacity: 0.85, depthWrite: false });

  /** Lime rings under whoever is talking in the call. */
  setSpeaking(pks: Set<string>): void {
    for (const [pk, ring] of this.speakRings) if (!pks.has(pk)) { ring.removeFromParent(); this.speakRings.delete(pk); }
    for (const pk of pks) {
      if (this.speakRings.has(pk)) continue;
      const c = this.people.get(pk);
      if (!c) continue;
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.28, 0.36, 28), this.ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.03;
      c.root.add(ring);
      this.speakRings.set(pk, ring);
    }
  }

  // ── the theater ───────────────────────────────────────────────────────

  /** The channel the theater is showing (its call gathers in the hall), or null. */
  private theaterChannel: string | null = null;

  /** The channel whose house is the gym (dressed as openGym), or null. */
  get gymChannel(): string | null {
    return this.gymId;
  }

  /** The theater's screen, marquee and house lights, if the island has one. */
  get theaterHall(): TheaterHall | null {
    return this.landmarks.get('theater')?.hall ?? null;
  }

  /** Is p in the theater's hall (its room, not the doorway)? */
  inTheater(p: Vec2): boolean {
    const b = this.landmarks.get('theater');
    const l = b?.interior ? this.toLandmarkLocal('theater', p) : null;
    const r = b?.interior?.rooms[0];
    return !!(l && r && l.x > r.minX && l.x < r.maxX && l.z > r.minZ && l.z < r.maxZ);
  }

  /** Is p in LABITCONF's hall (its room, not the doorway)? */
  inLabitconf(p: Vec2): boolean {
    const r = this.landmarks.get('labitconf')?.interior?.rooms[0];
    const l = r ? this.toLandmarkLocal('labitconf', p) : null;
    return !!(l && r && l.x > r.minX && l.x < r.maxX && l.z > r.minZ && l.z < r.maxZ);
  }

  /** LABITCONF's video plays over its LED wall while you're in the hall. */
  private updateStage(dt: number): void {
    const screen = this.landmarks.get('labitconf')?.screen;
    if (!screen) return;
    const me = this.playerPk ? this.people.get(this.playerPk) : null;
    const inside = !!me && this.inLabitconf(me.pos);
    if (!this.stage) {
      if (!inside) return;
      const parent = this.canvas.parentElement;
      if (!parent) return;
      this.stage = new YoutubeStage(parent, this.canvas, screen, LABITCONF.SCREEN_W, LABITCONF.SCREEN_H);
      this.stage.setSize(this.canvas.clientWidth || window.innerWidth, this.canvas.clientHeight || window.innerHeight);
    }
    this.stage.setSound(this.stageSound);
    this.stage.update(this.camera, inside, dt);
  }

  /** The totem's live page is on the monitor while the camera is near enough and nothing hides the screen; never while its focus is open. */
  private updateTotem(dt: number): void {
    if (!this.totem) return;
    const at = new THREE.Vector3().setFromMatrixPosition(this.totem.screen.matrixWorld);
    const on = !this.totemFocused && totemInView(this.camera.position.distanceTo(at), !!this.totemStage?.live);
    if (!this.totemStage) {
      if (!on) return;
      const parent = this.canvas.parentElement;
      if (!parent) return;
      this.totemStage = new TotemStage(parent, this.canvas, this.totem.screen, TOTEM.W, TOTEM.H);
      this.totemStage.setSize(this.canvas.clientWidth || window.innerWidth, this.canvas.clientHeight || window.innerHeight);
    }
    // What can stand between the camera and the screen: houses, landmarks, the obelisk.
    const clear = on && this.totemProbe.clear(dt, this.camera, this.totem.screen, [this.buildingRoot, ...[...this.landmarks.values()].map((b) => b.group), this.obelisk.group]);
    this.totemStage.update(this.camera, on, clear);
  }

  /** main.ts opens (or closes) the totem's focus: one page at a time, so the monitor's goes meanwhile. */
  setTotemFocused(on: boolean): void {
    this.totemFocused = on;
    if (on) this.totemStage?.update(this.camera, false, false);
  }

  /** p in the totem monitor's frame (x across its screen, z out of its face), for main.ts's focus; null without it. */
  totemLocal(p: Vec2): Vec2 | null {
    if (!this.totem) return null;
    const l = this.toLandmarkLocal('labitconf', p);
    return l && { x: l.x - TOTEM.X, z: l.z - TOTEM.Z };
  }

  /** Is `pk` sitting in the theater? */
  inTheaterSeat(pk: string): boolean {
    return this.seatOf.get(pk)?.landmark === 'theater';
  }

  /**
   * What the theater shows: the channel (its call gathers in the hall), the
   * marquee's words, the shared screen (or a card) and whether a film plays.
   */
  setTheater(t: { channel: string | null; marquee: string; stream: MediaStream | null; card: [string, string] }): void {
    const hall = this.theaterHall;
    this.theaterChannel = t.channel;
    if (!hall) return;
    hall.setMarquee(t.marquee);
    hall.screen.showCard(t.card[0], t.card[1]);
    hall.screen.attach(t.stream);
    hall.setPlaying(!!t.stream);
  }

  /** Keep the film running only while you're near enough to see it. */
  private updateTheater(): void {
    const hall = this.theaterHall;
    const s = this.landmarkSlots.get('theater');
    if (!hall || !s) return;
    const from = this.camera.position;
    // Near enough to see it, or in the hall (however far the camera is pulled back).
    const me = this.playerPk ? this.people.get(this.playerPk) : null;
    hall.screen.setActive(Math.hypot(from.x - s.pos.x, from.z - s.pos.z) < 14 || (!!me && this.inTheater(me.pos)));
    hall.screen.tick();
  }

  /**
   * In the hall the film plays in its own <video> over the screen
   * (world/domScreen.ts), at its own frame rate rather than the world's;
   * the screen draws black meanwhile. After each frame's draw.
   */
  private updateFilm(): void {
    const hall = this.theaterHall;
    if (!hall) return;
    const v = hall.screen.element;
    const me = this.playerPk ? this.people.get(this.playerPk) : null;
    const on = !!v && !!me && this.inTheater(me.pos);
    if (!this.film) {
      if (!on) return;
      const parent = this.canvas.parentElement;
      if (!parent) return;
      this.film = new DomScreen(parent, this.canvas, hall.screenBack, THEATER.SCREEN_W, THEATER.SCREEN_H, 'film-video', 1024);
      this.film.setSize(this.canvas.clientWidth || window.innerWidth, this.canvas.clientHeight || window.innerHeight);
    }
    // The film's <video> joins the overlay once and stays (taking it out of the page would pause it).
    if (v && v.parentElement !== this.film.holder) {
      this.film.holder.replaceChildren(v);
      v.style.cssText = 'width:100%;height:100%;object-fit:contain;display:block;pointer-events:none';
      void v.play().catch(() => {});
    }
    hall.screen.setOverlaid(this.film.update(this.camera, on));
  }

  /** People in the theater's call take its seats (the hall has no path in: they fade across). */
  private gatherInTheater(pks: string[]): void {
    const chairs = this.seats.filter((s) => s.landmark === 'theater');
    for (const pk of pks) {
      if (pk === this.playerPk || !this.people.has(pk) || this.pinned(pk)) continue;
      if (this.inTheaterSeat(pk) || this.pendingOf.get(pk)) continue;
      const seat = chairs.find((s) => !s.taken);
      if (!seat) return;
      const c = this.people.get(pk)!;
      this.stand(pk);
      this.reserve(pk, seat);
      this.blink(c, seat.pos, () => { this.releasePending(pk); this.sit(pk, seat); });
    }
  }

  /** People in a channel's call gather in its pavilion (or in the theater, when it shows that channel). */
  gatherForCall(channelId: string, pks: string[]): void {
    if (channelId === this.theaterChannel && this.theaterHall) { this.gatherInTheater(pks); return; }
    const slot = this.slotFor(channelId);
    if (!slot) return;
    const others = pks.filter((pk) => pk !== this.playerPk && this.people.has(pk) && !this.pinned(pk));
    const spots = circleSpots(slot.pos, Math.max(2, others.length), 0.7);
    const chairs = this.seats.filter((s) => s.tree === channelId);
    others.forEach((pk, i) => {
      const c = this.people.get(pk)!;
      // Under the tree: take a free chair round the trunk.
      if (chairs.length) {
        if (this.seatOf.get(pk)?.tree === channelId || this.pendingOf.get(pk)) return;
        const seat = chairs.find((s) => !s.taken);
        if (seat) {
          this.stand(pk);
          this.reserve(pk, seat);
          this.walkTo(c, seat.pos, { then: () => { this.releasePending(pk); this.sit(pk, seat); } });
          return;
        }
      }
      if (dist(c.pos, slot.pos) < 1.2) return;
      this.stand(pk);
      this.walkTo(c, spots[i], { then: () => c.faceToward(slot.pos) });
    });
  }

  // ── game tables ───────────────────────────────────────────────────────

  /**
   * Live tables (waiting or in play) stand in their channel's yard: a round
   * table with the board painted on top, seat colours and all.
   */
  setGameTables(tables: { gameId: string; channelId: string; board: { rows: number; cols: number; cells: { count: number; owner: number | null }[] } | null; waiting: boolean }[]): void {
    this.gameRoot.clear();
    const perChannel = new Map<string, number>();
    for (const t of tables) {
      const slot = this.slotFor(t.channelId);
      if (!slot) continue;
      const k = perChannel.get(t.channelId) ?? 0;
      if (k >= 2) continue;
      perChannel.set(t.channelId, k + 1);
      const side = { x: Math.cos(slot.rot), z: -Math.sin(slot.rot) };
      const fwd = { x: Math.sin(slot.rot), z: Math.cos(slot.rot) };
      const at = { x: slot.yard.x + side.x * (k ? -0.9 : 0.9) + fwd.x * 0.9, z: slot.yard.z + side.z * (k ? -0.9 : 0.9) + fwd.z * 0.9 };
      const table = buildGameTable(t.board, t.waiting);
      table.position.set(at.x, 0, at.z);
      table.rotation.y = slot.rot;
      table.traverse((o) => { o.userData.gameId = t.gameId; });
      this.gameRoot.add(table);
    }
  }

  // ── sitting and mate ──────────────────────────────────────────────────

  private seatedUntil = new Map<string, number>();

  nearestFreeSeat(p: Vec2, within: number, npc = false): Seat | null {
    let best: Seat | null = null;
    let bestScore = Infinity;
    const inside = !npc && this.insideWalkable(p);
    for (const s of this.seats) {
      if (s.taken) continue;
      // Sofas indoors are for players, and only offered from inside the room.
      if (s.indoor && !inside) continue;
      const d = dist(s.pos, p);
      // A landmark's tables stand on its terrace, which you can't walk onto:
      // they count as near from the path in front.
      const reach = s.landmark ? within + 1 : within;
      if (d > reach) continue;
      // Neighbours would rather join a bench where a mate is already going round.
      const score = d - (npc && s.bench && this.benchSeated(s.bench).length ? 2.5 : 0);
      if (score < bestScore) { best = s; bestScore = score; }
    }
    return best;
  }

  isSeated(pk: string): boolean {
    return this.seatOf.has(pk);
  }

  /** Sit `pk` on `seat` with a mate in hand. */
  sit(pk: string, seat: Seat): void {
    const c = this.people.get(pk);
    if (!c || seat.taken) return;
    this.dismount(pk);
    this.stand(pk);
    seat.taken = pk;
    this.seatOf.set(pk, seat);
    // The sitting clip draws the hips back about 25 cm: stand the person a
    // little forward so the hips land on the seat and the legs hang in front.
    c.place({ x: seat.pos.x + Math.sin(seat.face) * 0.1, z: seat.pos.z + Math.cos(seat.face) * 0.1 });
    c.body.rotation.y = seat.face;
    c.faceToward({ x: seat.pos.x + Math.sin(seat.face), z: seat.pos.z + Math.cos(seat.face) });
    // The sitting clip lowers the pelvis to a 45 cm seat: raise or sink the
    // whole person so that lands on this seat.
    c.seatY = seat.y - SIT_SEAT_HEIGHT;
    // Sitting replaces any jump, run or standing-on-furniture state.
    c.resetDrive();
    c.sit();
    // On a bench someone's already drinking from, you join their round
    // (updateRounds hands you the mate in turn).
    const sharing = !!seat.bench && this.benchSeated(seat.bench).length > 1;
    if (!c.mate && !sharing) {
      // A mate, a coffee or a choripán: the character keeps it in the left
      // hand and lifts it to sip or bite (Character.update).
      const prop = seat.prop ?? 'mate';
      if (prop !== 'none') {
        c.mate = prop === 'coffee' ? buildCup() : prop === 'asado' ? buildChoripan() : prop === 'marshmallow' ? buildMarshmallow() : prop === 'popcorn' ? buildPopcorn() : buildMate();
        // A little larger than life so it reads at village distance.
        c.mate.scale.setScalar(0.75);
        c.body.add(c.mate);
      }
    }
    // At the café, a laptop opens on the table in front of you (a prop only).
    if (seat.laptop && !this.laptops.has(pk)) {
      const lap = buildLaptop();
      const ahead = 0.17;
      lap.position.set(seat.pos.x + Math.sin(seat.face) * ahead, 0.322, seat.pos.z + Math.cos(seat.face) * ahead);
      lap.rotation.y = seat.face;
      this.staticRoot.add(lap);
      this.laptops.set(pk, lap);
    }
  }

  /**
   * Where you stand up to: the nearest spot you can walk from, clear of
   * furniture (seats on a café terrace or under the quincho are inside a
   * building's footprint, and the seat itself is solid).
   */
  exitSpot(from: Vec2, prefer?: number): Vec2 {
    const clear = (p: Vec2) => (this.grid.isWalkable(p) || this.insideWalkable(p))
      && !this.solids.some((b) => p.x > b.minX - 0.2 && p.x < b.maxX + 0.2 && p.z > b.minZ - 0.2 && p.z < b.maxZ + 0.2);
    for (let r = 0.35; r <= 3.5; r += 0.15) {
      const n = Math.max(8, Math.round(r * 16));
      for (let i = 0; i < n; i++) {
        // Try straight back from the table first, then around.
        const a = (prefer ?? 0) + Math.PI + ((i % 2 ? 1 : -1) * Math.ceil(i / 2) * 2 * Math.PI) / n;
        const p = { x: from.x + Math.sin(a) * r, z: from.z + Math.cos(a) * r };
        if (clear(p)) return p;
      }
    }
    return this.grid.nearestWalkable(from) ?? from;
  }

  // ── training (calisthenics park) ──────────────────────────────────────

  private trainUntil = new Map<string, number>();

  /** A walkable spot just outside the park, in front of a station. */
  stationApproach(st: Station): Vec2 {
    if (st.approach) return st.approach;
    if (st.lane !== undefined) return st.pos;
    const out = { x: st.pos.x - Math.sin(st.face) * 1.3, z: st.pos.z - Math.cos(st.face) * 1.3 };
    return this.grid.isWalkable(out) ? out : this.grid.nearestWalkable?.(out) ?? out;
  }

  nearestStation(p: Vec2, radius: number): Station | null {
    let best: Station | null = null, bd = radius;
    for (const st of this.stations) {
      if (st.taken && st.taken !== this.playerPk) continue;
      const d = dist(p, st.pos);
      if (d < bd) { bd = d; best = st; }
    }
    return best;
  }

  isTraining(pk: string): boolean {
    return this.trainingAt.has(pk);
  }

  /** What `pk` is training and how many reps (laps, running) so far. */
  training(pk: string): { kind: StationKind; reps: number } | null {
    const t = this.trainingAt.get(pk);
    if (!t) return null;
    if (t.kind === 'run') {
      const { halfLength: L, radius: R } = TRACK;
      return { kind: 'run', reps: Math.floor(((this.elapsed - t.since) * PLAYER_RUN) / (4 * L + 2 * Math.PI * (R - 0.45))) };
    }
    return { kind: t.kind, reps: repsDone(t.kind, this.elapsed - t.since) };
  }

  /** The lane `pk` is running laps in, if any. */
  laneOf(pk: string): number | null {
    return this.trainingAt.get(pk)?.station.lane ?? null;
  }

  /** Start a looping exercise at a station, or laps in a lane (false if its clip can't be built yet). */
  train(pk: string, st: Station, kind: StationKind): boolean {
    const c = this.people.get(pk);
    if (!c) return false;
    this.dismount(pk);
    this.stand(pk);
    this.stopTraining(pk);
    if (kind === 'run') {
      st.taken = pk;
      this.trainingAt.set(pk, { station: st, kind, since: this.elapsed, wall: Date.now() });
      // Your own laps are run by the controller (main.ts); everyone else loops here.
      if (pk !== this.playerPk) {
        const lap = () => { if (this.trainingAt.get(pk)?.station === st) c.walk(this.lanePath(st.lane!, c.pos), true, lap); };
        lap();
      }
      return true;
    }
    const name = `${kind}@${st.grip.toFixed(2)}/${st.half ?? 0}:${c.look.body}`;
    if (!this.builtClips.has(name)) {
      const model = buildPerson(c.look)?.root;
      if (!model) return false;
      registerClip(buildExerciseClip(kind, model, st.grip / PERSON_SCALE, name, st.half ? st.half / PERSON_SCALE : undefined));
      this.builtClips.add(name);
    }
    st.taken = pk;
    c.resetDrive();
    c.place(st.pos);
    c.body.rotation.y = st.face;
    c.faceToward({ x: st.pos.x + Math.sin(st.face), z: st.pos.z + Math.cos(st.face) });
    c.exercise = name;
    // Gym lifts: the bar comes off the rack and into your hands.
    if (st.gym && kind !== 'pushup' && kind !== 'pullup' && kind !== 'muscleup' && kind !== 'dip') {
      if (st.rest) st.rest.visible = false;
      c.heldBar = buildBarbell(kind === 'curl' ? 0.34 : 0.68, kind === 'curl' ? 0.045 : 0.07);
      c.body.add(c.heldBar);
    }
    this.trainingAt.set(pk, { station: st, kind, since: this.elapsed, wall: Date.now() });
    return true;
  }

  /** Play an emote where they stand (emotes.ts), or stop it (null).
   *  Not while seated or training. Returns whether it's playing. */
  setEmote(pk: string, kind: EmoteKind | null, since = Date.now()): boolean {
    const c = this.people.get(pk);
    if (!c) return false;
    const e = emoteOf(kind);
    if (!e || this.seatOf.has(pk) || this.trainingAt.has(pk) || c.exercise || c.riding || c.swimming) { c.setEmote(null); return false; }
    let { lower, upper } = e;
    if (e.built) {
      // Built for this body's skeleton, once (push-ups on the floor: grip 0).
      lower = upper = builtClipName(e.built, c.look.body);
      if (!this.builtClips.has(lower)) {
        const model = buildPerson(c.look)?.root;
        if (!model) return false;
        registerClip(buildExerciseClip(e.built, model, 0, lower));
        this.builtClips.add(lower);
      }
    }
    // In step with the others (emotes.ts sync): the grid, or whoever near began first.
    const near: (number | null)[] = [];
    if (e.sync === 'leader') for (const o of this.people.values()) if (o !== c && o.emote?.kind === e.kind && dist(o.pos, c.pos) <= EMOTE_SYNC_M) near.push(o.emoteAnchor);
    c.setEmote({ kind: e.kind, lower, upper, grounded: e.grounded, seconds: e.seconds, since, anchor: emoteAnchor(e, since, near) });
    return true;
  }

  /** When someone's emote began (wall clock, ms), if they're playing one. */
  emoteSinceOf(pk: string): number | null {
    const c = this.people.get(pk);
    return c?.emote ? c.emoteSince : null;
  }

  /** Everyone playing an emote, where, and since when (audio/emoteMusic.ts picks the music);
   *  and you while you train at the park or the gym ('train': workout music for you alone,
   *  not for people passing; running laps has none). */
  dancers(): { pk: string; x: number; z: number; kind: EmoteKind | 'train'; since: number; anchor: number | null }[] {
    const out: { pk: string; x: number; z: number; kind: EmoteKind | 'train'; since: number; anchor: number | null }[] = [];
    const me = this.playerPk ? this.people.get(this.playerPk) : null;
    const training = this.playerPk ? this.trainingAt.get(this.playerPk) : undefined;
    if (me && training && training.kind !== 'run') out.push({ pk: me.pk, x: me.pos.x, z: me.pos.z, kind: 'train', since: training.wall, anchor: null });
    for (const c of this.people.values()) {
      if (!c.emote || c.opacity < 0.5) continue;
      out.push({ pk: c.pk, x: c.pos.x, z: c.pos.z, kind: c.emote.kind as EmoteKind, since: c.emoteSince, anchor: c.emoteAnchor });
    }
    return out;
  }

  /** Where places with music are (audio/placeMusic.ts): the parrilla, every campfire (the logs by the pond, each voice tree's) and everyone swimming. */
  musicPlaces(): { kind: 'parrilla' | 'campfire' | 'swim'; x: number; z: number }[] {
    const out: { kind: 'parrilla' | 'campfire' | 'swim'; x: number; z: number }[] = [{ kind: 'campfire', x: this.plan.campfire.x, z: this.plan.campfire.z }];
    // Whoever is swimming carries the swim song with them.
    for (const c of this.people.values()) if (c.swimming && c.opacity > 0.5) out.push({ kind: 'swim', x: c.pos.x, z: c.pos.z });
    const grill = this.landmarkSlots.get('parrilla');
    if (grill) out.push({ kind: 'parrilla', x: grill.pos.x, z: grill.pos.z });
    const p = new THREE.Vector3();
    for (const b of this.buildings.values()) {
      if (!b.tree) continue;
      b.tree.fire.group.getWorldPosition(p);
      out.push({ kind: 'campfire', x: p.x, z: p.z });
    }
    return out;
  }

  /** The landmarks without music (café, HQ, La Crypta, Liberture…) and every channel's house: place music keeps out of their ground. */
  quietPlaces(): Vec2[] {
    const out = [...this.landmarkSlots].filter(([id]) => id !== 'parrilla').map(([, s]) => ({ x: s.pos.x, z: s.pos.z }));
    const p = new THREE.Vector3();
    for (const b of this.buildings.values()) {
      if (b.tree) continue;
      b.group.getWorldPosition(p);
      out.push({ x: p.x, z: p.z });
    }
    return out;
  }

  /** The emote someone is playing, if any. */
  emoteOf(pk: string): EmoteKind | null {
    return (this.people.get(pk)?.emote?.kind as EmoteKind | undefined) ?? null;
  }

  stopTraining(pk: string): void {
    const t = this.trainingAt.get(pk);
    this.trainUntil.delete(pk);
    if (!t) return;
    this.trainingAt.delete(pk);
    if (t.station.taken === pk) t.station.taken = null;
    if (t.station.rest) t.station.rest.visible = true;
    const c = this.people.get(pk);
    if (c) {
      if (c.heldBar) { c.heldBar.removeFromParent(); c.heldBar = null; }
      // Out of the lane: stop where you are.
      if (t.kind === 'run' && pk !== this.playerPk) c.halt();
      c.exercise = null;
      // Step off the equipment.
      if (c.pos.x === t.station.pos.x && c.pos.z === t.station.pos.z) c.place(this.stationApproach(t.station));
    }
  }

  private builtClips = new Set<string>();

  stand(pk: string): void {
    this.releasePending(pk);
    const seat = this.seatOf.get(pk);
    if (seat) seat.taken = null;
    this.seatOf.delete(pk);
    this.seatedUntil.delete(pk);
    const c = this.people.get(pk);
    if (!c) return;
    c.seatY = 0;
    c.stand();
    c.reachK = 0;
    if (c.mate) { c.mate.removeFromParent(); c.mate = null; }
    this.laptops.get(pk)?.removeFromParent();
    this.laptops.delete(pk);
  }

  // ── sharing a mate on a bench (mateRound.ts) ──────────────────────────

  private rounds = new Map<string, Round>();

  /** Who sits on a bench, in seat order. */
  private benchSeated(bench: string): string[] {
    const out: string[] = [];
    for (const s of this.seats) if (s.bench === bench && s.taken && this.seatOf.get(s.taken) === s) out.push(s.taken);
    return out;
  }

  private benchIds: string[] = [];
  private benchIdsFor = -1;

  /** One mate per shared bench: it goes round, changing hands between neighbours. */
  private updateRounds(dt: number): void {
    // Seats come and go (the island builds after the first frames, yard stools later).
    if (this.benchIdsFor !== this.seats.length) {
      this.benchIdsFor = this.seats.length;
      this.benchIds = [...new Set(this.seats.flatMap((s) => (s.bench ? [s.bench] : [])))];
    }
    for (const bench of this.benchIds) {
      const prev = this.rounds.get(bench) ?? null;
      const seated = this.benchSeated(bench);
      if (!prev && seated.length < 2) continue;
      const r = stepRound(prev, seated, dt);
      if (!r) {
        // Back to one (or none): whoever's left gets a mate of their own.
        this.rounds.delete(bench);
        for (const pk of seated) {
          const c = this.people.get(pk);
          if (c && !c.mate) { c.reachK = 0; this.giveMate(c); }
        }
        continue;
      }
      this.rounds.set(bench, r);
      const carrier = carrierOf(r);
      // Exactly one mate on the bench, in the carrier's hand: move it there.
      let mate: THREE.Object3D | null = null;
      for (const pk of seated) {
        const c = this.people.get(pk);
        if (!c?.mate) continue;
        if (!mate) mate = c.mate;
        else c.mate.removeFromParent(); // someone sat down with their own: one is enough
        c.mate = null;
      }
      const cc = this.people.get(carrier);
      if (cc) {
        if (!mate) this.giveMate(cc);
        else {
          if (mate.parent !== cc.body) { mate.removeFromParent(); cc.body.add(mate); }
          cc.mate = mate;
        }
      }
      // A new holder sips at once; the giver rests while handing it over.
      if (r.phase === 'sip' && (!prev || prev.phase === 'pass' || prev.holder !== r.holder) && cc) cc.sipClock = 0;
      // Both arms reach toward the middle while it changes hands.
      const k = reachOf(r);
      for (const pk of seated) {
        const c = this.people.get(pk);
        if (!c) continue;
        const passing = r.phase === 'pass' && (pk === r.holder || pk === r.to);
        c.reachK = passing ? k : 0;
        if (passing && r.to) {
          const a = this.people.get(r.holder), b = this.people.get(r.to);
          const seat = this.seatOf.get(pk);
          if (a && b && seat) {
            c.reach.copy(a.root.position).add(b.root.position).multiplyScalar(0.5);
            c.reach.x += Math.sin(seat.face) * 0.12;
            c.reach.z += Math.cos(seat.face) * 0.12;
            c.reach.y = seat.y + 0.17;
          }
        }
      }
    }
  }

  private giveMate(c: Character): void {
    c.mate = buildMate();
    c.mate.scale.setScalar(0.75);
    c.body.add(c.mate);
  }

  // ── live activities (nostr/activity.ts) ───────────────────────────────

  /** Spots held for someone on their way to them (an NPC's coffee, a claim). */
  private pendingOf = new Map<string, Seat | Station>();

  private reserve(pk: string, place: Seat | Station): void {
    this.releasePending(pk);
    place.taken = `pending:${pk}`;
    this.pendingOf.set(pk, place);
  }

  private releasePending(pk: string): void {
    const place = this.pendingOf.get(pk);
    this.pendingOf.delete(pk);
    if (place?.taken === `pending:${pk}`) place.taken = null;
  }

  /** People placed by a live activity event rather than by their local life. */
  private claims = new Map<string, Claim & { place: Seat | Station | null }>();
  /** Spawned only for a claim (they haven't posted): they leave when it ends. */
  private claimSpawned = new Set<string>();
  /** The Director let them go while they were pinned. */
  private despawnLater = new Set<string>();
  /** Fading out to reappear elsewhere: runs once the character is invisible. */
  private blinks = new Map<string, () => void>();

  /** Steered from elsewhere (a live claim or live movement): local life and the Director leave them be. */
  private pinned(pk: string): boolean {
    return !!this.claims.get(pk)?.place || this.movers.has(pk);
  }

  /** What `pk` is doing, named the way it is published. */
  activityOf(pk: string): Activity | null {
    const seat = this.seatOf.get(pk);
    if (seat) return { spot: seatSpotId(seat.pos), kind: 'sit' };
    const t = this.trainingAt.get(pk);
    if (t) return { spot: t.station.lane !== undefined ? laneSpotId(t.station.lane) : stationSpotId(this.stations.indexOf(t.station)), kind: t.kind };
    return null;
  }

  /** The seat or station a spot id names in this village, if any. */
  spotPlace(id: string): Seat | Station | null {
    const s = parseSpot(id);
    if (!s) return null;
    if (s.type === 'station') return this.stations[s.index] ?? null;
    if (s.type === 'lane') return this.lanes[s.index] ?? null;
    if (s.type === 'here') return null;
    let best: Seat | null = null, bd = 0.5;
    for (const seat of this.seats) {
      if (seatSpotId(seat.pos) === id) return seat;
      const d = dist(seat.pos, s.pos);
      if (d < bd) { bd = d; best = seat; }
    }
    return best;
  }

  /** Whoever holds a live claim on a seat or station near `p`. */
  claimedNear(p: Vec2, within: number): string | null {
    for (const [pk, c] of this.claims) if (c.held && c.place && dist(c.place.pos, p) <= within) return pk;
    return null;
  }

  /**
   * Everyone's live activities (ActivityStore.live): each person runs, or
   * fades across, to their spot and stays there; whoever drops out goes back
   * to their own life.
   */
  syncClaims(list: Claim[]): void {
    // Emotes on the spot aren't a place to go: main.ts plays them as movement.
    const next = new Map(list.filter((c) => c.pk !== this.playerPk && !this.residents.has(c.pk) && !c.kind.startsWith('emote:')).map((c) => [c.pk, c]));
    for (const pk of [...this.claims.keys()]) if (!next.has(pk)) this.releaseClaim(pk);
    for (const c of next.values()) {
      const cur = this.claims.get(c.pk);
      if (cur && cur.spot === c.spot && cur.kind === c.kind && cur.held === c.held) continue;
      this.applyClaim(c);
    }
  }

  private applyClaim(cl: Claim): void {
    const pk = cl.pk;
    if (this.claims.has(pk)) this.releaseClaim(pk, true);
    const place = this.spotPlace(cl.spot);
    const station = place && 'kinds' in place ? place : null;
    const seat = place && !station ? (place as Seat) : null;
    if (!place || (station && !station.kinds.includes(cl.kind as StationKind)) || (seat && cl.kind !== 'sit')) {
      // A spot this village doesn't have (a yard stool of another channel set).
      this.claims.set(pk, { ...cl, place: null });
      if (this.claimSpawned.delete(pk)) this.despawn(pk);
      return;
    }
    this.claims.set(pk, { ...cl, place });
    let c = this.people.get(pk);
    const fresh = !c;
    if (!c) { c = this.makePerson(pk); this.claimSpawned.add(pk); }
    this.stand(pk);
    this.stopTraining(pk);
    this.leaveConvoSpot(pk);
    this.convoOf.delete(pk);
    this.homeward.delete(pk);
    if (cl.held) {
      if (place.taken && place.taken !== pk) this.evict(place.taken);
      this.reserve(pk, place);
    }
    // The winner goes to the equipment; someone who lost the race waits beside it.
    const dest = station?.lane !== undefined ? this.lanePath(station.lane, c.pos)[0] : station ? this.stationApproach(station) : cl.held ? seat!.pos : this.exitSpot(seat!.pos, seat!.face);
    const arrive = () => {
      const ch = this.people.get(pk);
      if (!ch || this.claims.get(pk)?.place !== place) return;
      if (!cl.held) { ch.faceToward(place.pos); return; }
      this.releasePending(pk);
      if (seat) this.sit(pk, seat);
      // No clip yet (the body is still loading): the next sync tries again.
      else if (!this.train(pk, station!, cl.kind as StationKind)) this.claims.delete(pk);
    };
    if (fresh) {
      // New in the village: fade in right there.
      c.place(this.grid.nearestWalkable(dest) ?? dest);
      arrive();
      return;
    }
    const path = c.opacity > 0.5 && dist(c.pos, dest) < CLAIM_RUN_RANGE ? this.grid.findPath(c.pos, dest) : null;
    if (path) { c.targetOpacity = 1; c.walk(path, true, arrive); }
    else this.blink(c, dest, arrive);
  }

  /** Fade out, reappear at `to`, fade back in: a soft teleport. */
  private blink(c: Character, to: Vec2, then: () => void): void {
    c.halt();
    c.targetOpacity = 0;
    this.blinks.set(c.pk, () => {
      c.place(this.grid.nearestWalkable(to) ?? to);
      c.targetOpacity = 1;
      then();
    });
  }

  /** Move a villager off a seat or station (or out of its reservation) for a live claim. */
  private evict(holder: string): void {
    const pending = holder.startsWith('pending:');
    const pk = pending ? holder.slice('pending:'.length) : holder;
    if (pk === this.playerPk) return;
    const c = this.people.get(pk);
    if (pending) { this.releasePending(pk); c?.halt(); }
    else {
      const seat = this.seatOf.get(pk);
      this.stand(pk);
      this.stopTraining(pk);
      if (c && seat) c.place(this.exitSpot(seat.pos, seat.face));
    }
    // Off they go, somewhere else.
    if (c) c.idleFor = 99;
  }

  private releaseClaim(pk: string, reapply = false): void {
    const cl = this.claims.get(pk);
    this.claims.delete(pk);
    this.blinks.delete(pk);
    if (!cl?.place || pk === this.playerPk) return;
    const c = this.people.get(pk);
    const seat = this.seatOf.get(pk);
    this.stand(pk);
    this.stopTraining(pk);
    if (c) {
      c.halt();
      c.targetOpacity = 1;
      if (seat) c.place(this.exitSpot(seat.pos, seat.face));
      c.idleFor = 0;
    }
    if (reapply || this.movers.has(pk)) return;
    const spawned = this.claimSpawned.delete(pk);
    if (this.despawnLater.delete(pk) || spawned) this.despawn(pk);
  }

  // ── riding nostriches (world/nostrich.ts) ────────────────────────────

  /** Who rides which bird of the flock (its index). */
  private riders = new Map<string, number>();

  /** A free nostrich within `r` of `p` (its index), for the "Press F to ride" prompt. */
  rideableNear(p: Vec2, r = 1.6): number | null {
    return this.flock?.nearestFree(p, r) ?? null;
  }

  ridingOf(pk: string): number | null {
    return this.riders.get(pk) ?? null;
  }

  /** `pk` climbs on bird `bird` (default: the nearest free one, else a spare made for them). */
  mount(pk: string, bird?: number): boolean {
    const c = this.people.get(pk);
    if (!c || !this.flock || this.riders.has(pk)) return false;
    const i = bird ?? this.flock.nearestFree(c.pos, Infinity) ?? this.flock.spare(c.pos);
    if (!this.flock.mount(i, pk)) return false;
    this.stopTraining(pk);
    this.stand(pk);
    this.setEmote(pk, null);
    this.riders.set(pk, i);
    c.resetDrive();
    c.riding = true;
    this.flock.ride(i, c.pos, c.body.rotation.y, 0);
    return true;
  }

  /** Off the bird, a step to its side (null when they weren't riding). */
  dismount(pk: string): Vec2 | null {
    const i = this.riders.get(pk);
    if (i === undefined) return null;
    this.riders.delete(pk);
    this.flock?.release(i);
    const c = this.people.get(pk);
    if (!c) return null;
    c.riding = false;
    const yaw = c.body.rotation.y;
    const side = { x: c.pos.x - Math.cos(yaw) * 0.5, z: c.pos.z + Math.sin(yaw) * 0.5 };
    const out = this.grid.isWalkable(side) || this.insideWalkable(side) ? side : c.pos;
    c.place(out);
    return out;
  }

  /** Ridden birds go where their riders are (before the flock steps). */
  private carryRiders(): void {
    if (!this.flock) return;
    for (const [pk, i] of this.riders) {
      const c = this.people.get(pk);
      if (!c) { this.riders.delete(pk); this.flock.release(i); continue; }
      this.flock.ride(i, c.pos, c.body.rotation.y, c.speed, c.jumpY);
    }
  }

  // ── live movement (nostr/motion.ts) ───────────────────────────────────

  /** People walking live in another browser → when their motion goes stale (elapsed s). */
  private movers = new Map<string, number>();

  /**
   * Someone's latest movement, `ageS` seconds old: walk them where they are
   * going at their own pace, or fade them across when this screen has them
   * far from where they really are. A live claim (sitting, training) wins.
   */
  applyMotion(pk: string, m: Motion, ageS: number): void {
    if (pk === this.playerPk || this.residents.has(pk)) return;
    this.movers.set(pk, this.elapsed + MOVER_STALE_S);
    if (this.claims.get(pk)?.place) return;
    const age = THREE.MathUtils.clamp(ageS, 0, 1.5);
    const speeds = m.ride ? RIDE_SPEEDS : FOOT_SPEEDS;
    const now = this.walkable(extrapolate(m, age, speeds));
    // Keys: keep walking a little past the next correction; a click: its destination.
    const target = m.moving ? this.walkable(m.dest ?? this.straightAhead(m.p, extrapolate(m, age + MOVER_LEAD_S, speeds))) : now;
    let c = this.people.get(pk);
    if (!c) {
      c = this.makePerson(pk);
      this.claimSpawned.add(pk);
      c.place(now);
    }
    c.pace = speeds;
    if (this.seatOf.has(pk)) this.stand(pk);
    this.stopTraining(pk);
    // On a nostrich over there: on one here too (a bird nearby, else one of their own).
    if (m.ride && !this.riders.has(pk) && this.flock) this.mount(pk, this.flock.nearestFree(c.pos, 8) ?? this.flock.spare(c.pos));
    else if (!m.ride) this.dismount(pk);
    this.releasePending(pk);
    this.leaveConvoSpot(pk);
    this.convoOf.delete(pk);
    this.homeward.delete(pk);
    this.blinks.delete(pk);
    const go = () => {
      const ch = this.people.get(pk);
      if (!ch) return;
      const far = dist(ch.pos, target) > 0.05;
      let path = far ? this.grid.findPath(ch.pos, target) : null;
      // Inside a building the grid stops at its door (it ends on the nearest
      // cell it knows): walk the rest straight in, or straight out of the room.
      if (far && this.insideWalkable(target) && !this.grid.isWalkable(target)) path = [...(path ?? []), target];
      else if (far && !path && this.insideWalkable(ch.pos)) path = [target];
      // In the water too (the grid has none): swim the rest straight there, or straight out to the bank.
      else if (far && this.swimmable(target) && !this.grid.isWalkable(target)) path = [...(path ?? []), target];
      else if (far && !path && this.swimmable(ch.pos)) path = [target];
      // Standing still with an emote: play it once they're there.
      const emote = m.moving ? null : m.emote ?? null;
      // Standing, they face where they face over there (and look up or down).
      const settle = () => { if (!m.moving && m.yaw !== undefined) ch.face(m.yaw); this.setEmote(pk, emote, m.emoteSince); };
      ch.lookPitch = m.pitch ?? 0;
      if (path) { ch.walk(path, m.run, settle); if (!m.moving) ch.setEmote(null); }
      else { ch.halt(); if (!m.moving && m.yaw !== undefined) ch.face(m.yaw); if (ch.emote?.kind !== emote) this.setEmote(pk, emote, m.emoteSince); }
    };
    if (c.opacity < 0.5 && c.targetOpacity === 1) { go(); return; }
    if (dist(c.pos, now) > MOVER_BLINK_M) this.blink(c, now, go);
    else { c.targetOpacity = 1; go(); }
    // They jumped (and it's fresh): jump here too.
    if (m.jump && ageS < 1.2) c.jump();
  }

  /** Forget movers whose movement went quiet: back to local life, or gone if they only came to move. */
  expireMotion(): void {
    for (const [pk, until] of this.movers) {
      if (until > this.elapsed) continue;
      this.movers.delete(pk);
      this.dismount(pk);
      const c = this.people.get(pk);
      if (c) { c.pace = null; c.idleFor = 0; c.lookPitch = 0; }
      if (this.claims.get(pk)?.place) continue;
      const spawned = this.claimSpawned.delete(pk);
      if (this.despawnLater.delete(pk) || spawned) this.despawn(pk);
    }
  }

  private walkable(p: Vec2): Vec2 {
    return this.grid.isWalkable(p) || this.playerWalkable(p) ? p : this.grid.nearestWalkable(p) ?? p;
  }

  /** As far towards `to` as the ground allows in a straight line (keys don't walk through walls). */
  private straightAhead(from: Vec2, to: Vec2): Vec2 {
    const d = dist(from, to);
    const steps = Math.ceil(d / 0.25);
    let last = from;
    for (let i = 1; i <= steps; i++) {
      const p = { x: from.x + ((to.x - from.x) * i) / steps, z: from.z + ((to.z - from.z) * i) / steps };
      if (!this.grid.isWalkable(p) && !this.insideWalkable(p)) break;
      last = p;
    }
    return last;
  }

  // ── picking ───────────────────────────────────────────────────────────

  private installPicking(): void {
    let down: { x: number; y: number } | null = null;
    this.canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
    this.canvas.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return;
      // In first person a click grabs the mouse for looking around.
      if (this.cam.firstPerson) return;
      const rect = this.canvas.getBoundingClientRect();
      const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      this.raycaster.setFromCamera(ndc, this.camera);
      const ground = this.staticRoot.getObjectByName('ground');
      const targets: THREE.Object3D[] = [...[...this.people.values()].map((c) => c.root), this.gameRoot, this.buildingRoot, ...[...this.landmarks.values()].map((b) => b.group), ...(this.totem ? [this.totem.group] : []), ...(ground ? [ground] : [])];
      const hit = this.raycaster.intersectObjects(targets, true)[0];
      const noWalk = this.hooks.onTap?.() ?? false;
      if (!hit) return;
      if (hit.object === ground) { if (!noWalk) this.hooks.onGroundClick?.({ x: hit.point.x, z: hit.point.z }); return; }
      let o: THREE.Object3D | null = hit.object;
      if (o.name === 'theater-screen' || o.name === 'theater-screen-back') { this.hooks.onTheaterScreenClick?.(); return; }
      if (o.name === 'totem-screen') { this.hooks.onTotemScreenClick?.(); return; }
      let person = false;
      for (let q: THREE.Object3D | null = o; q; q = q.parent) if (q.userData.pk) person = true;
      if (!person && !noWalk) {
        // A chair: walk to it and sit. A building's floor you can walk on (seen through its walls): walk there.
        const at = { x: hit.point.x, z: hit.point.z };
        const seat = this.seatAt(at, hit.point.y);
        if (seat) { this.hooks.onSeatClick?.(seat); return; }
        if (this.insideWalkable(at) && hit.point.y < this.groundAt(at) + 0.12) { this.hooks.onGroundClick?.(at); return; }
      }
      while (o) {
        if (o.userData.pk) { this.hooks.onPersonClick?.(o.userData.pk); return; }
        if (o.userData.gameId) { this.hooks.onGameClick?.(o.userData.gameId); return; }
        if (o.userData.landmark) { this.hooks.onLandmarkClick?.(o.userData.landmark as LandmarkId); return; }
        if (o.userData.groupId) { this.hooks.onGroupClick?.(o.userData.groupId); return; }
        o = o.parent;
      }
    });
  }

  /** The free seat a click at p (height y) lands on: on its cushion or its back. */
  seatAt(p: Vec2, y: number): Seat | null {
    let best: Seat | null = null, bd = 0.2;
    for (const s of this.seats) {
      if (s.taken) continue;
      // The cushion and the back behind it.
      const back = { x: s.pos.x - Math.sin(s.face) * 0.08, z: s.pos.z - Math.cos(s.face) * 0.08 };
      const d = Math.min(dist(p, s.pos), dist(p, back));
      if (d < bd && y > s.y - 0.25 && y < s.y + 0.4) { bd = d; best = s; }
    }
    return best;
  }

  /** First person: hide your own body (you are its eyes). */
  setFirstPerson(on: boolean): void {
    const c = this.playerPk ? this.people.get(this.playerPk) : null;
    if (!c) { this.cam.setFirstPerson(false); this.hands.group.visible = false; return; }
    this.cam.setFirstPerson(on, c.body.rotation.y);
    this.eyeHeight = -1;
    this.cam.eye = on ? () => this.eyeOf(c) : null;
    // Your body stays in the world for its shadow, but draws nothing for you.
    this.setBodyDrawn(c, !on);
    c.badge.visible = !on;
    this.hands.setColors(skinTone(c.look), c.look.top);
    this.hands.group.visible = on && !this.cam.isWatching;
  }

  private setBodyDrawn(c: Character, drawn: boolean): void {
    c.bodyDrawn = drawn;
    c.body.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (!m) return;
      // Materials props share between bodies (sangre.ts) are hidden by Character instead.
      for (const mat of Array.isArray(m) ? m : [m]) if (!mat.userData.shared) { mat.colorWrite = drawn; mat.depthWrite = drawn; }
    });
  }

  /** Online / AFK / offline marks over the characters (main.ts decides who is which). */
  setPresence(pk: string, p: 'online' | 'afk' | 'offline'): void {
    this.people.get(pk)?.setPresence(p);
  }

  /** First person, but doing something you'd want to see (training, sitting):
   *  the camera steps out and your body shows; back in when you're done. */
  setSelfView(on: boolean): void {
    if (!this.cam.firstPerson || on === this.cam.isWatching) return;
    const c = this.playerPk ? this.people.get(this.playerPk) : null;
    if (!c) return;
    // Three-quarters from the front: you see the exercise, not your back.
    this.cam.setWatching(on, c.body.rotation.y + Math.PI * 0.8);
    this.setBodyDrawn(c, on);
    this.hands.group.visible = !on;
  }

  /** Eyes: just in front of the head bone (it carries walking, sitting, lifting, jumping). */
  private eyeOf(c: Character): THREE.Vector3 | null {
    const h = c.bonePosition('Head', this.eyeTmp);
    if (!h) return null;
    // The head bone bobs and sways with every step of the walk clip; your
    // eyes shouldn't. Height above your feet is low-passed (crouches, sitting
    // and lifting still come through, a stride doesn't); across, the eye
    // stays over your body. Jumps and slopes come with the body itself.
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.eyeAt) / 1000);
    this.eyeAt = now;
    const above = h.y - c.root.position.y;
    this.eyeHeight = this.eyeHeight < 0 || dt <= 0 ? above : this.eyeHeight + (above - this.eyeHeight) * (1 - Math.exp(-dt * 3));
    const yaw = c.body.rotation.y;
    return new THREE.Vector3(c.root.position.x + Math.sin(yaw) * 0.06, c.root.position.y + this.eyeHeight + 0.045, c.root.position.z + Math.cos(yaw) * 0.06);
  }


  /** Make `pk` the viewer's character (or none), spawning it at the plaza. */
  setPlayer(pk: string | null): void {
    const prev = this.playerPk ? this.people.get(this.playerPk) : null;
    if (prev) prev.external = null;
    // Your own activity from another tab doesn't steer you here.
    if (pk) this.releaseClaim(pk);
    this.playerPk = pk;
    if (!pk) return;
    if (!this.people.has(pk)) this.spawn(pk, '', 'instant');
    const c = this.people.get(pk)!;
    c.targetOpacity = 1;
    this.homeward.delete(pk);
  }

  playerSpawnPoint(): Vec2 {
    const c = this.plan.plaza.c;
    return this.grid.nearestWalkable({ x: c.x, z: c.z + this.plan.plaza.r - 0.6 }) ?? c;
  }

  navGrid(): NavGrid {
    return this.grid;
  }

  /** Channel yards, for place detection. */
  yards(): { groupId: string; yard: Vec2 }[] {
    const out: { groupId: string; yard: Vec2 }[] = [];
    for (const id of this.groups.keys()) {
      const s = this.slotFor(id);
      if (s) out.push({ groupId: id, yard: s.yard });
    }
    return out;
  }

  /** Camera yaw (look direction on the ground, atan2(dx, dz)). */
  cameraYaw(): number {
    if (this.cam.firstPerson) return this.cam.fpYaw;
    const t = this.cam.controls.target, p = this.camera.position;
    return Math.atan2(t.x - p.x, t.z - p.z);
  }

  personAnchor(pk: string): () => THREE.Vector3 | null {
    return () => {
      const c = this.people.get(pk);
      // Half a metre above the floor under them (raised floors, upstairs). Not
      // groundY: your own character's height arrives through drive() instead.
      return c ? c.root.position.clone().setY(this.groundAt(c.pos) + ANCHOR_Y) : null;
    };
  }

  groupAnchor(groupId: string): () => THREE.Vector3 | null {
    return () => {
      const s = this.slotFor(groupId);
      return s ? new THREE.Vector3((s.pos.x + s.yard.x) / 2, 0.8, (s.pos.z + s.yard.z) / 2) : null;
    };
  }

  // ── warm-up ───────────────────────────────────────────────────────────

  /** Show everything hidden in the scene (people still faded out, their
   *  badges and props, night windows, your hands) but lights; returns what
   *  to hide again. Opacity is left alone: a material's shader is chosen the
   *  first time it's drawn, and a fading body must get its see-through one. */
  private showHidden(): THREE.Object3D[] {
    const shown: THREE.Object3D[] = [];
    this.scene.traverse((o) => {
      if (o.visible || (o as THREE.Light).isLight || (o as THREE.Camera).isCamera) return;
      o.visible = true;
      shown.push(o);
    });
    return shown;
  }

  /**
   * Compile every shader the first seconds will use while the loading screen
   * still covers the island, so the intro never stalls: the lights budgeted
   * now (their count is part of each shader), everything hidden shown for the
   * moment, the scene's materials compiled against the target the frames
   * really draw into (in parallel where the GPU allows), then real frames
   * through the post chain: shadows, ambient occlusion and bodies drawn from
   * above and from where the intro lands. Everything is put back as it was,
   * and the last frame drawn is the plain view from above.
   */
  async warmUp(progress?: (f: number) => void): Promise<void> {
    if (this.contextLost) return;
    const r = this.renderer;
    // Nobody on the island yet (logged out, a feed still on its way): a
    // stand-in body, so the first person to arrive doesn't stall a frame.
    let standIn: Character | null = null;
    if (!this.people.size) {
      standIn = new Character('warm-up', '');
      standIn.place(this.plan.plaza.c);
      this.scene.add(standIn.root);
    }
    this.budgetLights(true);
    progress?.(0.05);
    let shown: THREE.Object3D[] = [];
    let compiling: Promise<unknown> = Promise.resolve();
    const prevTarget = r.getRenderTarget();
    try {
      shown = this.showHidden();
      r.setRenderTarget(this.post.sceneTarget);
      compiling = r.compileAsync(this.scene, this.camera);
    } catch (e) {
      console.warn('[sky] warm-up compile', e);
    } finally {
      r.setRenderTarget(prevTarget);
      for (const o of shown) o.visible = false;
    }
    await compiling.catch(() => {});
    await this.gpuDone();
    progress?.(0.5);
    // Let the bar show where it is before the frames hold the page.
    await new Promise((res) => requestAnimationFrame(() => res(null)));
    if (this.contextLost) return;
    const cam = this.camera;
    const pos = cam.position.clone(), quat = cam.quaternion.clone(), up = cam.up.clone();
    const shadows = r.shadowMap;
    const draw = (): void => {
      shadows.needsUpdate = true;
      this.post.render(0);
    };
    shown = [];
    try {
      shown = this.showHidden();
      draw(); // from above: every body and prop, and their shadows
      const land = this.cam.introLanding();
      cam.up.set(0, 1, 0);
      cam.position.copy(land.pos);
      cam.lookAt(land.target);
      cam.updateMatrixWorld();
      draw(); // where the intro lands, close up
    } catch (e) {
      console.warn('[sky] warm-up frame', e);
    } finally {
      for (const o of shown) o.visible = false;
      cam.position.copy(pos);
      cam.quaternion.copy(quat);
      cam.up.copy(up);
      cam.updateMatrixWorld();
      if (standIn) {
        standIn.dispose();
        standIn.badge.material.map?.dispose();
        standIn.badge.material.dispose();
      }
    }
    // What stays on screen behind the fading loader: the view from above, as it is.
    try { draw(); } catch { /* the frame loop draws the next one */ }
    progress?.(0.8);
    // The GPU works behind the page's back: drawing only queues the work
    // (and some drivers compile at the first draw). Done means done.
    await this.gpuDone();
    progress?.(1);
  }

  /** Resolves once the GPU has finished everything asked of it so far (a
   *  WebGL2 fence, polled without blocking the page), or after `capMs`. */
  private gpuDone(capMs = 20_000): Promise<void> {
    const gl = this.renderer.getContext();
    if (this.contextLost || typeof WebGL2RenderingContext === 'undefined' || !(gl instanceof WebGL2RenderingContext)) return Promise.resolve();
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    if (!sync) return Promise.resolve();
    gl.flush();
    const t0 = performance.now();
    return new Promise((resolve) => {
      const poll = (): void => {
        const s = this.contextLost ? gl.WAIT_FAILED : gl.clientWaitSync(sync, 0, 0);
        if (s === gl.TIMEOUT_EXPIRED && performance.now() - t0 < capMs) { setTimeout(poll, 30); return; }
        gl.deleteSync(sync);
        resolve();
      };
      poll();
    });
  }

  // ── frame ─────────────────────────────────────────────────────────────

  /** One frame. `dtIn`: the caller's frame time (main.ts steps your character first). */
  frame(dtIn?: number): number {
    const dt = dtIn ?? Math.min(this.clock.getDelta(), 0.1);
    // No context, nothing to draw with: wait for it to come back.
    if (this.contextLost) return dt;
    if (this.needsResize) { this.needsResize = false; this.resize(); }
    // Whatever goes wrong updating, the frame is still drawn: a resize may
    // have cleared the canvas, and an undrawn frame stays black.
    try {
      this.update(dt);
    } finally {
      this.cam.guard();
      this.post.render(dt);
      this.updateStage(dt);
      this.updateTotem(dt);
      this.updateFilm();
    }
    return dt;
  }

  private update(dt: number): void {
    this.elapsed += dt;
    this.sky.update(dt, this.elapsed);
    const night01 = 1 - this.sky.day;
    for (const m of this.island?.water ?? []) {
      m.uniforms.uTime.value = this.elapsed;
      m.uniforms.uDay.value = this.sky.day;
    }
    this.swayUniform.value = this.elapsed;
    const lamps = lampLevel(night01);
    this.lampGlow.emissiveIntensity = lamps * 3;
    for (const l of this.lampLights) l.intensity = lamps * 6;
    this.pulse = Math.max(0, this.pulse - dt * 0.8);
    this.obelisk?.setGlow(night01, this.pulse + (Math.sin(this.elapsed * 2) * 0.5 + 0.5) * 0.08);
    for (const b of this.landmarks.values()) { b.setNight(night01, this.elapsed); b.update?.(dt, this.elapsed); }
    this.updateInteriors();
    this.updateTheater();
    this.mill?.setNight(night01);
    this.mill?.update(dt, this.elapsed);
    for (const b of this.buildings.values()) for (const w of b.windows) w.visible = night01 > 0.4;
    if (this.fireflies) {
      (this.fireflies.material as THREE.PointsMaterial).opacity = night01 * (0.7 + Math.sin(this.elapsed * 3) * 0.3);
      this.fireflies.rotation.y = this.elapsed * 0.01;
    }
    this.post.setNight(night01);

    for (const p of this.pets.values()) p.update(dt, (q) => this.groundAt(q));
    this.updateRounds(dt);
    this.updateWalkPins(dt);
    for (const b of this.buildings.values()) b.tree?.update(this.elapsed, night01);
    this.gym?.group.userData.setNight?.(night01);
    this.projView.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projView);
    this.budgetLights();
    if (this.flock) {
      this.carryRiders();
      // Runners startle them; off screen they keep moving but aren't posed.
      const runners: Vec2[] = [];
      for (const c of this.people.values()) if (c.external ? c.external.moving && c.external.running : c.path.length && c.running) runners.push(c.pos);
      const v = new THREE.Vector3();
      this.flock.update(dt, runners, (p) => this.frustum.containsPoint(v.set(p.x, 0.4, p.z)));
    }
    for (const [pk, then] of [...this.blinks]) {
      const c = this.people.get(pk);
      if (!c) this.blinks.delete(pk);
      else if (c.opacity === 0) { this.blinks.delete(pk); then(); }
    }
    for (const c of this.people.values()) {
      // The viewer's own height comes with drive(); seats carry their own height.
      c.groundY = c.external || this.seatOf.has(c.pk) ? 0 : this.standHeight(c.pos);
      this.updateSwim(c);
      // Off screen (with a margin for their shadow): not drawn, not posed.
      this.cullSphere.center.set(c.root.position.x, c.root.position.y + 0.4, c.root.position.z);
      const seen = c.pk === this.playerPk || this.frustum.intersectsSphere(this.cullSphere);
      c.offscreen = !seen;
      c.root.visible = seen;
      c.update(dt);
      if (!this.residents.has(c.pk)) this.idleLife(c, dt);
    }
    for (const c of [...this.leaving]) {
      if (!c.update(dt)) { c.dispose(); this.leaving.delete(c); }
    }
    this.zaps.tick(dt);
    for (const e of [...this.effects]) {
      e.age += dt;
      e.tick(e, dt);
      if (e.age >= e.life) this.effects = this.effects.filter((x) => x !== e);
    }
    this.cam.update(dt);
    this.handsT += dt;
    if (this.hands.group.visible) {
      // Your arms are your body's (the clip it plays this frame), hung from
      // your eyes without the camera's own bob and landing dip.
      const me = this.playerPk ? this.people.get(this.playerPk) : null;
      const eye = this.handsEye.copy(this.camera.position).sub(this.cam.feelOffset);
      this.hands.update(this.camera, { ...this.cam.feelState, t: this.handsT, eye }, me?.armPose(this.armPose) ? this.armPose : null);
    }
    // The miniature lens is for looking down on the island, not through your own eyes.
    this.post.setTiltAmount(this.cam.firstPerson && !this.cam.isWatching ? 0 : this.cam.introProgress);
    this.overlay.update();
  }
}

/** A campfire's flames flicker every frame: never merged away. */
function underCampfire(o: THREE.Object3D): boolean {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p.name === 'campfire') return true;
  return false;
}

/** Grass tufts for a quality level (0: none). */
function grassFor(on: boolean, level: string): number {
  return !on || level === 'low' ? 0 : level === 'medium' ? 5000 : level === 'high' ? 12000 : 22000;
}

function easeOutBack(t: number): number {
  const c1 = 1.70158, c3 = c1 + 1;
  const x = Math.min(1, t);
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}

function trackLapPoints(site: { c: Vec2; rot: number }): Vec2[] {
  return trackLap(site, 48);
}

const SEAT_HEX = [0xff4d5e, 0xb4f953, 0x38bdf8, 0xfbbf24, 0xc084fc, 0xf472b6, 0xfb923c, 0x2dd4bf];

/** A round table with a Chain Reaction board painted on its top. */
function buildGameTable(board: { rows: number; cols: number; cells: { count: number; owner: number | null }[] } | null, waiting: boolean): THREE.Group {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x8a5a33, flatShading: true });
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.05, 16), wood);
  top.position.y = 0.42;
  top.castShadow = true;
  g.add(top);
  const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 0.42, 8), wood);
  leg.position.y = 0.21;
  g.add(leg);
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#121212';
  ctx.fillRect(0, 0, 128, 128);
  if (board) {
    const cell = Math.min(120 / board.cols, 120 / board.rows);
    const ox = (128 - cell * board.cols) / 2, oy = (128 - cell * board.rows) / 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    for (let r = 0; r < board.rows; r++) for (let q = 0; q < board.cols; q++) {
      ctx.strokeRect(ox + q * cell, oy + r * cell, cell, cell);
      const v = board.cells[r * board.cols + q];
      if (!v || !v.count || v.owner === null) continue;
      ctx.fillStyle = `#${SEAT_HEX[v.owner % SEAT_HEX.length].toString(16).padStart(6, '0')}`;
      for (let k = 0; k < Math.min(v.count, 3); k++) {
        ctx.beginPath();
        ctx.arc(ox + q * cell + cell / 2 + (k - (Math.min(v.count, 3) - 1) / 2) * cell * 0.22, oy + r * cell + cell / 2, cell * 0.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  } else {
    ctx.fillStyle = waiting ? '#b4f953' : '#555';
    ctx.font = 'bold 22px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(waiting ? vw.tableJoin : '…', 64, 72);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const face = new THREE.Mesh(new THREE.CircleGeometry(0.38, 24), new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.35 }));
  face.rotation.x = -Math.PI / 2;
  face.position.y = 0.447;
  g.add(face);
  if (waiting) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.015, 6, 32), new THREE.MeshBasicMaterial({ color: 0xb4f953 }));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.45;
    g.add(ring);
  }
  return g;
}

/**
 * One tuft of grass: five curved, tapered blades fanned around a point, each
 * three segments tall, dark at the root and light at the tip (vertex colour,
 * multiplied by the instance's tint). Bend grows toward the tip, so the
 * wind sway (which scales with height) reads as a real blade flexing.
 */
function grassTuft(): THREE.BufferGeometry {
  const pos: number[] = [];
  const colr: number[] = [];
  const idx: number[] = [];
  const BLADES = 5, SEG = 3;
  const r = rng(77);
  for (let b = 0; b < BLADES; b++) {
    const yaw = (b / BLADES) * Math.PI * 2 + r() * 0.8;
    const h = 0.12 + r() * 0.09, w = 0.022 + r() * 0.01, lean = 0.03 + r() * 0.06;
    const ox = (r() - 0.5) * 0.05, oz = (r() - 0.5) * 0.05;
    const dir = { x: Math.sin(yaw), z: Math.cos(yaw) };
    const side = { x: dir.z, z: -dir.x };
    const base = pos.length / 3;
    for (let i = 0; i <= SEG; i++) {
      const f = i / SEG;
      const half = (w / 2) * (1 - f * 0.92);
      const bend = lean * f * f;
      const cx = ox + dir.x * bend, cz = oz + dir.z * bend, y = h * f;
      pos.push(cx - side.x * half, y, cz - side.z * half, cx + side.x * half, y, cz + side.z * half);
      const shade = 0.42 + f * 0.62;
      colr.push(shade * 0.92, shade, shade * 0.8, shade * 0.92, shade, shade * 0.8);
      if (i > 0) {
        const k = base + i * 2;
        idx.push(k - 2, k - 1, k, k - 1, k + 1, k);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
  g.setIndex(idx);
  // Lit like the lawn it grows from: thin blades with sideways normals go
  // black on their shadow side.
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length / 3).fill(0).flatMap(() => [0, 1, 0]), 3));
  return g;
}
