// People: Quaternius' Universal Base Characters dressed in the Modular
// Character Outfits, with their hairstyles, all on one 65-bone skeleton and
// animated by the Universal Animation Library (CC0; built into
// public/models/people by scripts/build-people.mjs).
//
// A person is the body (head, hands, skin) plus parts skinned to the same
// skeleton: an outfit, hair and eyebrows. Each part's skinned meshes are
// re-bound to the body's bones by name, so one AnimationMixer on the body
// moves everything. Clothes are recoloured in the shader: the fabric's
// texture is turned to grey (keeping its folds and seams) and multiplied by
// the chosen colour, so any colour works on any garment.

import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { modelUrl } from '../world/assetUrl';

export type BodyType = 'm' | 'f';
export type Outfit = 'peasant' | 'ranger';
export type Hair = 'none' | 'buzzed' | 'simpleparted' | 'long' | 'buns' | 'buzzedfemale';

export interface PersonLook {
  body: BodyType;
  /** 'light' or 'dark' base skin, then a tint for tones in between. */
  skin: 'light' | 'dark';
  skinTint: string;
  hair: Hair;
  beard: boolean;
  hairColor: string;
  outfit: Outfit;
  hood: boolean;
  /** No shirt (men only): the top garments off, the bare torso shown. Left out when false. */
  shirtless?: boolean;
  top: string;
  bottom: string;
  shoes: string;
}

/** Height of a grown-up in metres in the source models (UE scale). */
export const MODEL_HEIGHT = 1.8;

const url = (file: string) => modelUrl(`people/${file}`);
export const FILES = {
  body: { m: 'body-m.glb', f: 'body-f.glb' },
  outfit: { 'm-peasant': 'outfit-m-peasant.glb', 'm-ranger': 'outfit-m-ranger.glb', 'f-peasant': 'outfit-f-peasant.glb', 'f-ranger': 'outfit-f-ranger.glb' },
  hair: {
    buzzed: 'hair-buzzed.glb', simpleparted: 'hair-simpleparted.glb', long: 'hair-long.glb', buns: 'hair-buns.glb',
    buzzedfemale: 'hair-buzzedfemale.glb', beard: 'hair-beard.glb',
  },
  brows: { m: 'eyebrows-regular.glb', f: 'eyebrows-female.glb' },
  anims: ['anims-1.glb', 'anims-2.glb'],
} as const;

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const cache = new Map<string, Promise<GLTF>>();
const done = new Map<string, GLTF>();
const textures = new Map<string, THREE.Texture>();

// At most two files decode at once: dozens of 1024² textures decoding in
// parallel can exhaust a phone's (or a software renderer's) image memory.
// Downloads are not limited: they all start at once, so a phone's round trips
// overlap instead of queueing two by two.
let running = 0;
const waiting: (() => void)[] = [];
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= 2) await new Promise<void>((r) => waiting.push(r));
  running++;
  try { return await fn(); } finally { running--; waiting.shift()?.(); }
}

function load(file: string): Promise<GLTF> {
  let p = cache.get(file);
  if (!p) {
    const bytes = fetch(url(file)).then((r) => {
      if (!r.ok) throw new Error(`${file}: HTTP ${r.status}`);
      return r.arrayBuffer();
    });
    bytes.catch(() => {}); // reported through p
    p = bytes.then((b) => slot(() => loader.parseAsync(b, ''))).then((g) => { done.set(file, g); return g; });
    p.catch(() => cache.delete(file)); // a failed file may be retried
    cache.set(file, p);
  }
  return p;
}

const skinLoads = new Map<string, Promise<THREE.Texture>>();

/** A skin tone's texture for a body; loaded with the look (see loadLook). */
function loadSkin(body: BodyType, tone: 'light' | 'dark'): Promise<THREE.Texture> {
  const key = `skin-${body}-${tone}.webp`;
  let p = skinLoads.get(key);
  if (!p) {
    p = new THREE.TextureLoader().loadAsync(url(key)).then((t) => {
      t.flipY = false; // glTF UV convention
      t.colorSpace = THREE.SRGBColorSpace;
      textures.set(key, t);
      return t;
    });
    p.catch(() => skinLoads.delete(key));
    skinLoads.set(key, p);
  }
  return p;
}

function skinTexture(body: BodyType, tone: 'light' | 'dark'): THREE.Texture | null {
  return textures.get(`skin-${body}-${tone}.webp`) ?? null;
}

/** Every file a look needs. */
export function filesFor(look: PersonLook): string[] {
  const f: string[] = [FILES.body[look.body], FILES.brows[look.body], FILES.outfit[`${look.body}-${look.outfit}`], ...FILES.anims];
  if (look.hair !== 'none') f.push(FILES.hair[look.hair]);
  if (look.beard && look.body === 'm') f.push(FILES.hair.beard);
  return f;
}

/** Fetch everything the village's default looks use, ahead of time. */
export function preloadPeople(progress?: (done: number, total: number) => void): Promise<unknown> {
  const all = [
    ...FILES.anims, ...Object.values(FILES.body), ...Object.values(FILES.brows),
    ...Object.values(FILES.outfit), ...Object.values(FILES.hair),
  ];
  const skins = (['m', 'f'] as const).flatMap((b) => (['light', 'dark'] as const).map((t) => () => loadSkin(b, t)));
  let n = 0;
  const total = all.length + skins.length;
  return Promise.all([
    ...all.map((f) => load(f).catch(() => null).finally(() => progress?.(++n, total))),
    ...skins.map((go) => go().catch(() => null).finally(() => progress?.(++n, total))),
  ]);
}

export function lookReady(look: PersonLook): boolean {
  return filesFor(look).every((f) => done.has(f)) && !!skinTexture(look.body, look.skin);
}

export function loadLook(look: PersonLook): Promise<unknown> {
  return Promise.all([...filesFor(look).map(load), loadSkin(look.body, look.skin)]);
}

let clipCache: THREE.AnimationClip[] | null = null;

/** The animation clips (loaded with `loadLook`/`preloadPeople`). */
export function peopleClips(): THREE.AnimationClip[] {
  if (clipCache) return clipCache;
  const list: THREE.AnimationClip[] = [];
  for (const f of FILES.anims) list.push(...(done.get(f)?.animations ?? []));
  if (list.length) clipCache = list;
  return list;
}

// ── recolouring ─────────────────────────────────────────────────────────

/** sRGB byte → linear light. */
const toLinear = (b: number) => { const c = b / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };

/**
 * Mean linear luminance of the texels at `uvs` (pairs, glTF orientation: v
 * down) in an RGBA image: how bright a garment's cloth is on average.
 */
export function meanLinearLuma(rgba: ArrayLike<number>, width: number, height: number, uvs: ArrayLike<number>): number {
  let sum = 0, n = 0;
  for (let i = 0; i + 1 < uvs.length; i += 2) {
    const u = uvs[i] - Math.floor(uvs[i]), v = uvs[i + 1] - Math.floor(uvs[i + 1]);
    const x = Math.min(width - 1, Math.floor(u * width)), y = Math.min(height - 1, Math.floor(v * height));
    const k = (y * width + x) * 4;
    sum += 0.2126 * toLinear(rgba[k]) + 0.7152 * toLinear(rgba[k + 1]) + 0.0722 * toLinear(rgba[k + 2]);
    n++;
  }
  return n ? sum / n : 0;
}

/** A mid-grey cloth, for when the texture can't be read back (tests, odd browsers). */
const FALLBACK_LUMA = 0.2;
const lumaCache = new Map<string, number>();
const sampler = typeof document !== 'undefined' ? document.createElement('canvas') : null;

/** How bright this garment's cloth is (cached per file and mesh). */
function garmentLuma(m: THREE.Mesh, base: THREE.MeshStandardMaterial, key: string): number {
  const hit = lumaCache.get(key);
  if (hit !== undefined) return hit;
  let luma = FALLBACK_LUMA;
  try {
    const img = base.map?.image as CanvasImageSource & { width: number; height: number } | undefined;
    const uv = m.geometry.getAttribute('uv');
    const ctx = sampler?.getContext('2d', { willReadFrequently: true });
    if (img && uv && ctx && sampler) {
      const size = 128;
      sampler.width = sampler.height = size;
      ctx.drawImage(img, 0, 0, size, size);
      const px = ctx.getImageData(0, 0, size, size).data;
      // Only the vertices this mesh draws (the face keeps a few of the body's).
      const index = m.geometry.index;
      const ids = index ? [...new Set(Array.from({ length: index.count }, (_, i) => index.getX(i)))] : null;
      const n = ids ? ids.length : uv.count;
      const uvs = new Float32Array(n * 2);
      for (let i = 0; i < n; i++) { const v = ids ? ids[i] : i; uvs[i * 2] = uv.getX(v); uvs[i * 2 + 1] = uv.getY(v); }
      const l = meanLinearLuma(px, size, size, uvs);
      if (l > 0.002) luma = l;
    }
  } catch { /* keep the fallback */ }
  lumaCache.set(key, luma);
  return luma;
}

/**
 * Fabric recolour: `uTintAmt` 0 shows the texture as authored, 1 replaces
 * its colour by `uTint` while keeping its light and dark (folds, seams).
 * The cloth's brightness is divided by its own average (`uRef`, linear), so
 * a garment shows the chosen colour itself, not a darker shade of it: dark
 * trousers and light shirts dye the same.
 */
function tintable(base: THREE.MeshStandardMaterial, tint: string, amount: number, ref: number): THREE.MeshStandardMaterial {
  const m = base.clone();
  const uTint = { value: new THREE.Color(tint) };
  const uTintAmt = { value: amount };
  const uRef = { value: ref };
  m.userData.tint = uTint;
  m.userData.ref = ref;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTint = uTint;
    shader.uniforms.uTintAmt = uTintAmt;
    shader.uniforms.uRef = uRef;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uTint;\nuniform float uTintAmt;\nuniform float uRef;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        float lum = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
        vec3 dyed = uTint * clamp(lum / uRef, 0.0, 1.6);
        diffuseColor.rgb = mix(diffuseColor.rgb, dyed, uTintAmt);`);
  };
  m.customProgramCacheKey = () => 'tintable2';
  return m;
}

// ── assembly ────────────────────────────────────────────────────────────

/** Bones whose skin shows above a collar. */
const BARE = new Set(['Head', 'neck_01']);
/** A man's chest, back and arms (not the hands: the outfit brings those): shown bare while swimming. */
export const TORSO = new Set(['spine_01', 'spine_02', 'spine_03', 'clavicle_l', 'clavicle_r', 'upperarm_l', 'upperarm_r', 'lowerarm_l', 'lowerarm_r']);
const cuts = new Map<Set<string>, WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>>();
/** The name of a man's bare torso mesh, and the flag on the garments it stands in for. */
export const BARE_TORSO = 'bare-torso';
export const TOP_GARMENT = 'topGarment';
/** Hair kept hidden under a hood. */
const UNDER_HOOD = 'underHood';

/** Shirt off or on: the top garments hide and the bare torso shows, or back. */
export function setBare(root: THREE.Object3D, bare: boolean): void {
  root.traverse((o) => {
    if (o.name === BARE_TORSO) o.visible = bare;
    else if (o.userData[TOP_GARMENT]) o.visible = !bare;
    else if (o.userData[UNDER_HOOD]) o.visible = bare;
  });
}

/**
 * The body mesh cut down to head and neck. Every outfit covers the rest
 * and brings its own hands, and the base body is broader than the clothes
 * were tailored for, so anything left underneath would poke through. A
 * triangle stays if any corner is mostly moved by a bare bone.
 */
export function headAndNeck(geo: THREE.BufferGeometry, boneNames: string[]): THREE.BufferGeometry {
  return bodyPart(geo, boneNames, BARE);
}

/** The body mesh cut down to the triangles moved mostly by `bare` bones (cached per geometry and set). */
export function bodyPart(geo: THREE.BufferGeometry, boneNames: string[], BARE: Set<string>): THREE.BufferGeometry {
  let cache = cuts.get(BARE);
  if (!cache) cuts.set(BARE, (cache = new WeakMap()));
  const hit = cache.get(geo);
  if (hit) return hit;
  const si = geo.getAttribute('skinIndex'), sw = geo.getAttribute('skinWeight');
  const bare = new Uint8Array(si.count);
  for (let v = 0; v < si.count; v++) {
    let best = 0, bone = -1;
    for (let k = 0; k < 4; k++) {
      const w = sw.getComponent(v, k);
      if (w > best) { best = w; bone = si.getComponent(v, k); }
    }
    bare[v] = BARE.has(boneNames[bone] ?? '') ? 1 : 0;
  }
  const src = geo.index;
  const keep: number[] = [];
  const n = src ? src.count : si.count;
  for (let i = 0; i < n; i += 3) {
    const a = src ? src.getX(i) : i, b = src ? src.getX(i + 1) : i + 1, c = src ? src.getX(i + 2) : i + 2;
    if (bare[a] || bare[b] || bare[c]) keep.push(a, b, c);
  }
  const out = geo.clone();
  out.setIndex(keep);
  cache.set(geo, out);
  return out;
}

/** The face texture's average skin colour, per body and tone (sampled from the textures). */
const SKIN_BASE: Record<string, string> = { 'm-light': '#d9a37e', 'm-dark': '#8a5638', 'f-light': '#e0ae8c', 'f-dark': '#8f5c3e' };

/** How much of the face is the dyed tone (the rest is the painted texture). */
const SKIN_DYE = 0.8;

/** A look's skin colour: the base tone of its body and texture, tinted. */
export function skinTone(look: PersonLook): string {
  const tone = new THREE.Color(SKIN_BASE[`${look.body}-${look.skin}`]).multiply(new THREE.Color(look.skinTint));
  return `#${tone.getHexString()}`;
}

export interface Person {
  /** The model, its feet at y = 0, MODEL_HEIGHT tall (scale it to fit). */
  root: THREE.Object3D;
  bones: Map<string, THREE.Bone>;
  materials: THREE.Material[];
}

/** Re-bind a part's skinned meshes to the body's bones and add them to it. */
function attachPart(part: THREE.Object3D, bodyRoot: THREE.Object3D, bones: Map<string, THREE.Bone>, onMesh: (m: THREE.Mesh) => void): void {
  const meshes: THREE.Mesh[] = [];
  part.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
  part.updateMatrixWorld(true);
  for (const mesh of meshes) {
    const skinned = mesh as THREE.SkinnedMesh;
    if (skinned.isSkinnedMesh) {
      const sk = skinned.skeleton;
      const mapped = sk.bones.map((b) => bones.get(b.name) ?? b);
      skinned.bind(new THREE.Skeleton(mapped, sk.boneInverses), skinned.bindMatrix);
      bodyRoot.add(skinned);
    } else {
      // Rigid pieces parented to a bone in their file (hair "rigged to head"):
      // keep their offset from that bone, under the body's bone of that name.
      let bone: THREE.Object3D | null = mesh.parent;
      while (bone && !bones.has(bone.name)) bone = bone.parent;
      const target = bone ? bones.get(bone.name)! : bones.get('Head');
      if (!target) continue;
      const local = new THREE.Matrix4().copy(bone ? bone.matrixWorld : new THREE.Matrix4()).invert().multiply(mesh.matrixWorld);
      mesh.removeFromParent();
      local.decompose(mesh.position, mesh.quaternion, mesh.scale);
      target.add(mesh);
    }
    onMesh(mesh);
  }
}

/** Build a person for a look whose files are loaded (see `loadLook`). */
export function buildPerson(look: PersonLook): Person | null {
  if (!lookReady(look)) return null;
  const bodyG = done.get(FILES.body[look.body])!;
  const root = SkeletonUtils.clone(bodyG.scene);
  const bones = new Map<string, THREE.Bone>();
  root.traverse((o) => { if ((o as THREE.Bone).isBone) bones.set(o.name, o as THREE.Bone); });
  const materials: THREE.Material[] = [];

  // Body: skin tone texture + tint; eyes as they are.
  const torsos: [THREE.SkinnedMesh, THREE.Object3D][] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.castShadow = true;
    m.frustumCulled = false;
    let mat = (m.material as THREE.MeshStandardMaterial).clone();
    if (/Superhero/i.test(mat.name)) {
      mat.map = skinTexture(look.body, look.skin);
      const sk = (m as THREE.SkinnedMesh).skeleton;
      const full = m.geometry;
      if (sk) m.geometry = headAndNeck(full, sk.bones.map((b) => b.name));
      // The face dyed to the same tone as the hands (outfit "Regular" parts),
      // at the texture's own average brightness: the painted skin alone is
      // half as bright as dyed clothes and read as a dark face next to them.
      // A little of the painting stays for lips and cheeks.
      mat = tintable(mat, skinTone(look), SKIN_DYE, garmentLuma(m, mat, `skin-${look.body}-${look.skin}`));
      if (sk && look.body === 'm') {
        // A man's bare chest and arms, for swimming (Character.setShirtless): off until then.
        const torso = new THREE.SkinnedMesh(bodyPart(full, sk.bones.map((b) => b.name), TORSO), mat);
        torso.name = BARE_TORSO;
        torso.bind(sk, (m as THREE.SkinnedMesh).bindMatrix);
        torso.castShadow = true;
        torso.frustumCulled = false;
        torso.visible = false;
        if (m.parent) torsos.push([torso, m.parent]);
      }
    } else if (/Hair/i.test(mat.name)) {
      mat.color.set(look.hairColor);
    }
    m.material = mat;
    materials.push(mat);
  });
  for (const [torso, parent] of torsos) parent.add(torso);

  const dress = (file: string, style: (m: THREE.Mesh) => void) => {
    const g = done.get(file);
    if (!g) return;
    attachPart(SkeletonUtils.clone(g.scene), root, bones, (m) => {
      m.castShadow = true;
      m.frustumCulled = false;
      style(m);
      materials.push(m.material as THREE.Material);
    });
  };

  // Outfit: per garment colour. Skin pieces in the outfit take the skin tint.
  dress(FILES.outfit[`${look.body}-${look.outfit}`], (m) => {
    const base = m.material as THREE.MeshStandardMaterial;
    const n = m.name.toLowerCase();
    if (/regular/i.test(base.name)) {
      // The outfit's own hands and wrists: dyed to the face's skin tone.
      m.material = tintable(base, skinTone(look), 1, garmentLuma(m, base, `${look.body}-${look.outfit}:${m.name}`));
      return;
    }
    if (n.includes('hood') && !look.hood) { m.visible = false; return; }
    // What a man takes off to swim: shirt, sleeves and what's worn over them.
    if (/body|arms|belt|pauldron|bracer|hood/.test(n)) m.userData[TOP_GARMENT] = true;
    const colour = n.includes('legs') ? look.bottom : n.includes('feet') ? look.shoes : look.top;
    const amount = n.includes('belt') || n.includes('bracer') || n.includes('pauldron') ? 0.35 : 0.85;
    m.material = tintable(base, colour, amount, garmentLuma(m, base, `${look.body}-${look.outfit}:${m.name}`));
  });
  // Hair, beard, eyebrows: one colour.
  const hairStyle = (m: THREE.Mesh) => {
    const c = (m.material as THREE.MeshStandardMaterial).clone();
    c.color.set(look.hairColor);
    m.material = c;
  };
  // Under a hood the hair is there but hidden: it shows when the hood comes off with the shirt (setBare).
  const hooded = look.outfit === 'ranger' && look.hood;
  if (look.hair !== 'none') dress(FILES.hair[look.hair], hooded ? (m) => { hairStyle(m); m.visible = false; m.userData[UNDER_HOOD] = true; } : hairStyle);
  if (look.beard && look.body === 'm') dress(FILES.hair.beard, hairStyle);
  dress(FILES.brows[look.body], hairStyle);
  if (look.shirtless && look.body === 'm') setBare(root, true);

  return { root, bones, materials };
}

// ── looks ───────────────────────────────────────────────────────────────

/** Skin tones: a base texture and a tint over it, lightest to darkest. */
export const SKIN_TONES = [
  { skin: 'light', tint: '#ffffff' }, { skin: 'light', tint: '#f2d9c4' }, { skin: 'light', tint: '#e2b896' },
  { skin: 'dark', tint: '#ffffff' }, { skin: 'dark', tint: '#d6b39a' }, { skin: 'dark', tint: '#a97c5f' },
] as const;
export const HAIRS: readonly Hair[] = ['none', 'buzzed', 'simpleparted', 'long', 'buns', 'buzzedfemale'];
export const OUTFITS: readonly Outfit[] = ['peasant', 'ranger'];
export const HAIR_COLORS = ['#2a1d16', '#4b2f1e', '#7a4a24', '#b07a3c', '#d9b26a', '#a33a1f', '#e8e2d6', '#3b3f4a'];
export const CLOTH_COLORS = [
  '#b4f953', '#3d7bd9', '#d94a3d', '#e8b83a', '#7a4fd1', '#2f9b8f', '#f2f2ee', '#2b2b2f',
  '#8a5a3c', '#c96fa8', '#5f7f3a', '#e07b2c',
];
export const BOTTOM_COLORS = ['#6b7280', '#8a6a4a', '#4b5563', '#9a9f86', '#4f6f9f', '#c2b280', '#2b2b2f', '#f2f2ee'];
export const SHOE_COLORS = ['#3b2a1c', '#2b2b2f', '#5a3a22', '#8a6a4a', '#f2f2ee'];

/** A stable default look from a pubkey (before anyone picks their own). */
export function defaultLook(seed: number): PersonLook {
  const r = (n: number) => { seed = (Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0; return seed % n; };
  const body: BodyType = r(2) ? 'm' : 'f';
  const hairs: Hair[] = body === 'm' ? ['buzzed', 'simpleparted', 'long', 'none'] : ['long', 'buns', 'buzzedfemale', 'simpleparted'];
  const tone = SKIN_TONES[r(SKIN_TONES.length)];
  return {
    body,
    skin: tone.skin,
    skinTint: tone.tint,
    hair: hairs[r(hairs.length)],
    beard: body === 'm' && r(3) === 0,
    hairColor: HAIR_COLORS[r(HAIR_COLORS.length)],
    outfit: r(3) ? 'peasant' : 'ranger',
    hood: false,
    top: CLOTH_COLORS[r(CLOTH_COLORS.length)],
    bottom: BOTTOM_COLORS[r(BOTTOM_COLORS.length)],
    shoes: SHOE_COLORS[r(3)],
  };
}

/** Strict check of a look read from a relay: every value from a fixed list, or null. */
export function parseLook(raw: unknown): PersonLook | null {
  if (!raw || typeof raw !== 'object') return null;
  const j = raw as Record<string, unknown>;
  const pick = <T>(list: readonly T[], v: unknown): T | undefined => (list.includes(v as T) ? (v as T) : undefined);
  const body = pick<BodyType>(['m', 'f'], j.body);
  const tone = SKIN_TONES.find((t) => t.skin === j.skin && t.tint === j.skinTint);
  const hair = pick(HAIRS, j.hair);
  const hairColor = pick(HAIR_COLORS, j.hairColor);
  const outfit = pick(OUTFITS, j.outfit);
  const top = pick(CLOTH_COLORS, j.top);
  const bottom = pick(BOTTOM_COLORS, j.bottom);
  const shoes = pick(SHOE_COLORS, j.shoes);
  if (!body || !tone || !hair || !hairColor || !outfit || !top || !bottom || !shoes) return null;
  return {
    body, skin: tone.skin, skinTint: tone.tint, hair, beard: j.beard === true && body === 'm', hairColor,
    outfit, hood: j.hood === true && outfit === 'ranger', top, bottom, shoes,
    ...(j.shirtless === true && body === 'm' ? { shirtless: true } : {}),
  };
}
