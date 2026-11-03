// Fewer draw calls for things that never move: a channel's house is dozens of
// little Kenney pieces (walls, trims, doors), each drawn up to three times a
// frame (shadow, ambient occlusion, colour). Merging the pieces that share a
// material into one mesh draws the same house in a handful of calls.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const SIG_SKIP = new Set(['uuid', 'name', 'id', 'version', 'userData', '_listeners', 'color']);

/**
 * A material's settings as a string, colour left out unless `withColor`:
 * two materials with the same signature draw alike. Null when it can't be
 * told from its fields (a shader material, a patched shader, a field this
 * doesn't know how to read): such a material is only ever itself.
 */
export function materialSig(m: THREE.Material, withColor = false): string | null {
  const own = (k: string) => Object.prototype.hasOwnProperty.call(m, k);
  if ((m as THREE.ShaderMaterial).isShaderMaterial || own('onBeforeCompile') || own('customProgramCacheKey')) return null;
  const parts = [m.type];
  const rec = m as unknown as Record<string, unknown>;
  for (const k of Object.keys(m).sort()) {
    if (SIG_SKIP.has(k) && !(withColor && k === 'color')) continue;
    const v = rec[k];
    if (v === null || v === undefined || typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') parts.push(`${k}=${v}`);
    else if ((v as THREE.Color).isColor) { const c = v as THREE.Color; parts.push(`${k}=${c.r.toFixed(5)},${c.g.toFixed(5)},${c.b.toFixed(5)}`); }
    else if ((v as THREE.Texture).isTexture) parts.push(`${k}=${(v as THREE.Texture).uuid}`);
    else if (typeof (v as { toArray?: unknown }).toArray === 'function') parts.push(`${k}=${(v as { toArray(): unknown[] }).toArray().join(',')}`);
    else if (Array.isArray(v) && v.length === 0) parts.push(`${k}=[]`);
    else if (typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype && Object.values(v as object).every((x) => x === null || typeof x !== 'object')) parts.push(`${k}=${JSON.stringify(v)}`);
    else return null;
  }
  return parts.join(';');
}

export interface MergeOptions {
  /**
   * Opt in to merging by look: materials not in this set (they never change
   * after building, see `findDynamic`'s `materials`) are bucketed by their
   * settings instead of by identity, and pieces that differ only in colour
   * merge into one mesh with the colours baked in as vertex colours. Pieces
   * built with a fresh material each (most landmarks) merge this way.
   */
  live?: Set<THREE.Material>;
}

/** Can this mesh's material be merged by look (opaque, plain, unchanging, coloured by `color` alone)? */
function byLook(m: THREE.Mesh, mat: THREE.Material, live: Set<THREE.Material>): string | null {
  if (live.has(mat) || mat.transparent || (mat as THREE.MeshStandardMaterial).vertexColors || m.geometry.attributes.color) return null;
  if (!(mat as THREE.MeshStandardMaterial).color?.isColor) return null;
  return materialSig(mat);
}

/**
 * Merge `root`'s static meshes that share a material (and shadow flags) into
 * one mesh each, in `root`'s own frame. `keep` names meshes that must stay
 * separate (they move, hide or change on their own). With `opts.live`, look
 * alike materials count as one (see MergeOptions). Returns how many meshes
 * were folded away.
 */
export function mergeStatic(root: THREE.Object3D, keep: (m: THREE.Mesh) => boolean = () => false, opts: MergeOptions = {}): number {
  const hidden = (o: THREE.Object3D) => { for (let p: THREE.Object3D | null = o; p && p !== root; p = p.parent) if (!p.visible) return true; return false; };
  const found: THREE.Mesh[] = [];
  root.traverse((o) => { const m = o as THREE.Mesh; if (mergeable(m) && !hidden(m) && !keep(m)) found.push(m); });
  return mergeInto(root, found, () => '', opts).folded;
}

/** A plain mesh whose geometry can take a baked transform. */
function mergeable(m: THREE.Mesh): boolean {
  if (!m.isMesh || (m as THREE.SkinnedMesh).isSkinnedMesh || (m as THREE.InstancedMesh).isInstancedMesh || Array.isArray(m.material)) return false;
  const g = m.geometry;
  if (Object.keys(g.morphAttributes).length) return false;
  // Quantised positions (int16, normalised) can't take a baked transform.
  if (!(g.attributes.position?.array instanceof Float32Array)) return false;
  if (Object.values(g.attributes).some((a) => (a as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute)) return false;
  // A mirrored piece would turn inside out once baked: leave it be.
  m.updateWorldMatrix(true, false);
  return m.matrixWorld.determinant() >= 0;
}

/**
 * Bucket `meshes` (same material or, with opts.live, same look; same
 * attributes, shadow flags and `extra` key) and merge each bucket into one
 * mesh in `root`'s frame, added to `root`. `merged` lists each new mesh with
 * the meshes it replaced.
 */
function mergeInto(root: THREE.Object3D, meshes: THREE.Mesh[], extra: (m: THREE.Mesh) => string, opts: MergeOptions): { folded: number; merged: [THREE.Mesh, THREE.Mesh[]][] } {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const buckets = new Map<string, { mat: THREE.Material; cast: boolean; recv: boolean; look: boolean; meshes: THREE.Mesh[] }>();
  for (const m of meshes) {
    const g = m.geometry, mat = m.material as THREE.Material;
    const attrs = Object.keys(g.attributes).sort().map((k) => `${k}${g.attributes[k].itemSize}`).join(',');
    const look = opts.live ? byLook(m, mat, opts.live) : null;
    const key = `${look === null ? mat.uuid : `look:${look}`}|${attrs}|${g.index ? 'i' : 'n'}|${m.castShadow}|${m.receiveShadow}|${extra(m)}`;
    let b = buckets.get(key);
    if (!b) buckets.set(key, (b = { mat, cast: m.castShadow, recv: m.receiveShadow, look: look !== null, meshes: [] }));
    b.meshes.push(m);
  }
  let folded = 0;
  const out: [THREE.Mesh, THREE.Mesh[]][] = [];
  const local = new THREE.Matrix4();
  for (const b of buckets.values()) {
    if (b.meshes.length < 2) continue;
    // Alike but in different colours: one material, the colours per vertex.
    const colorOf = (m: THREE.Mesh) => (m.material as THREE.MeshStandardMaterial).color;
    const bake = b.look && b.meshes.some((m) => !colorOf(m).equals(colorOf(b.meshes[0])));
    // One material per mesh: draw groups don't matter once merged.
    const geos = b.meshes.map((m) => {
      const g = m.geometry.clone().applyMatrix4(local.multiplyMatrices(inv, m.matrixWorld));
      g.clearGroups();
      if (bake) {
        const c = colorOf(m), n = g.attributes.position.count, rgb = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) { rgb[i * 3] = c.r; rgb[i * 3 + 1] = c.g; rgb[i * 3 + 2] = c.b; }
        g.setAttribute('color', new THREE.BufferAttribute(rgb, 3));
      }
      return g;
    });
    const merged = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    if (!merged) continue;
    let mat = b.mat;
    if (bake) {
      mat = b.mat.clone();
      (mat as THREE.MeshStandardMaterial).color.set(0xffffff);
      (mat as THREE.MeshStandardMaterial).vertexColors = true;
    }
    const mesh = new THREE.Mesh(merged, mat);
    mesh.name = 'merged';
    mesh.castShadow = b.cast;
    mesh.receiveShadow = b.recv;
    root.add(mesh);
    for (const m of b.meshes) m.removeFromParent();
    folded += b.meshes.length - 1;
    out.push([mesh, b.meshes]);
  }
  return { folded, merged: out };
}

/**
 * Merge pieces that are only ever shown, hidden or shadowed, and always
 * together (`toggles`, from findDynamic: the same on/off at every step of the
 * poke), per parent and look. Code still holding a piece (a landmark's
 * `walls`, switched off for shadows while you're inside) keeps working: the
 * piece's `visible` and `castShadow` now set and read the merged mesh's.
 * Returns how many meshes were folded away.
 */
export function mergeToggling(toggles: Map<THREE.Object3D, string>, keep: (m: THREE.Mesh) => boolean = () => false, opts: MergeOptions = {}): number {
  const byParent = new Map<THREE.Object3D, THREE.Mesh[]>();
  for (const o of toggles.keys()) {
    const m = o as THREE.Mesh;
    if (!m.parent || m.children.length || !mergeable(m) || keep(m)) continue;
    const list = byParent.get(m.parent) ?? [];
    list.push(m);
    byParent.set(m.parent, list);
  }
  let folded = 0;
  for (const [parent, meshes] of byParent) {
    const r = mergeInto(parent, meshes, (m) => `${toggles.get(m)}|${m.visible}`, opts);
    folded += r.folded;
    for (const [mesh, from] of r.merged) {
      mesh.name = 'merged-toggle';
      mesh.visible = from[0].visible;
      for (const o of from) {
        Object.defineProperty(o, 'visible', { get: () => mesh.visible, set: (v: boolean) => { mesh.visible = v; }, configurable: true });
        Object.defineProperty(o, 'castShadow', { get: () => mesh.castShadow, set: (v: boolean) => { mesh.castShadow = v; }, configurable: true });
      }
    }
  }
  return folded;
}

/**
 * Merge `meshes` (one material, shown and hidden together: a house's window
 * panes) into one mesh named `name` in `root`'s frame, hidden or shown as the
 * first one is. Returns what to toggle from now on: the merged mesh, or the
 * meshes as they were when there is nothing to gain or they can't be merged.
 */
export function mergeTogether(root: THREE.Object3D, meshes: THREE.Mesh[], name: string): THREE.Mesh[] {
  if (meshes.length < 2) return meshes;
  root.updateMatrixWorld(true);
  const mat = meshes[0].material;
  if (Array.isArray(mat) || meshes.some((m) => m.material !== mat || m.matrixWorld.determinant() < 0)) return meshes;
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const local = new THREE.Matrix4();
  const geos = meshes.map((m) => { const g = m.geometry.clone().applyMatrix4(local.multiplyMatrices(inv, m.matrixWorld)); g.clearGroups(); return g; });
  const merged = mergeGeometries(geos, false);
  for (const g of geos) g.dispose();
  if (!merged) return meshes;
  const mesh = new THREE.Mesh(merged, mat);
  mesh.name = name;
  mesh.visible = meshes[0].visible;
  mesh.castShadow = meshes[0].castShadow;
  mesh.receiveShadow = meshes[0].receiveShadow;
  root.add(mesh);
  for (const m of meshes) m.removeFromParent();
  return [mesh];
}

/**
 * Merge what doesn't move inside each node that moves or hides as a whole
 * (`nodes`, from findDynamic): a door's leaf and its frame, the part of a
 * building that hides when you step in. The pieces keep moving with their
 * node, in its frame; a piece under a node that moves inside it stays apart.
 * Returns how many meshes were folded away.
 */
export function mergeWithinMoving(nodes: Set<THREE.Object3D>, keep: (m: THREE.Mesh) => boolean = () => false, opts: MergeOptions = {}): number {
  let folded = 0;
  for (const n of nodes) {
    if ((n as THREE.Mesh).isMesh) continue;
    const movesInside = (m: THREE.Mesh) => { for (let x: THREE.Object3D | null = m; x && x !== n; x = x.parent) if (nodes.has(x)) return true; return false; };
    folded += mergeStatic(n, (m) => movesInside(m) || keep(m), opts);
  }
  return folded;
}

/**
 * The meshes under `root` that change on their own: `poke` runs the thing's
 * own hooks (its frame update at a few times, night, doors, going inside),
 * and every mesh whose transform, visibility, shadow flag or geometry moved
 * meanwhile, or sits under a node that did, is reported. Merge the rest.
 * Hooks usually put things back at the end (a door opened, then closed), so
 * `poke` calls `mark()` after each hook: a change seen at any mark counts.
 */
export interface DynamicOut {
  /** Filled with the materials a hook changes (or brings in): merge them by identity only. */
  materials?: Set<THREE.Material>;
  /** Filled with the nodes that changed themselves, not just under one that did. */
  nodes?: Set<THREE.Object3D>;
  /** Filled with the nodes that were only shown, hidden or shadowed, each with its on/off at every step (mergeToggling). */
  toggles?: Map<THREE.Object3D, string>;
}

export function findDynamic(root: THREE.Object3D, poke: (mark: () => void) => void, out: DynamicOut = {}): Set<THREE.Object3D> {
  const { materials, nodes, toggles } = out;
  type Snap = { m: number[]; v: boolean; c: boolean; g: number; mat: string };
  const snap = new Map<THREE.Object3D, Snap>();
  const matId = (o: THREE.Object3D) => { const m = (o as THREE.Mesh).material; return !m ? '' : Array.isArray(m) ? m.map((x) => x.uuid).join(',') : m.uuid; };
  const read = (o: THREE.Object3D): Snap => {
    const g = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
    const ver = g ? Object.values(g.attributes).reduce((s, a) => s + ((a as THREE.BufferAttribute).version ?? 0), 0) : 0;
    o.updateMatrix();
    return { m: o.matrix.elements.slice(), v: o.visible, c: o.castShadow, g: ver, mat: matId(o) };
  };
  root.traverse((o) => { snap.set(o, read(o)); });
  // Each node's shown/shadowed at every step, and every way it changed.
  const onOff = new Map<THREE.Object3D, string>();
  const how = new Map<THREE.Object3D, Set<string>>();
  for (const [o, a] of snap) onOff.set(o, `${+a.v}${+a.c}`);
  // With `materials`: every material whose settings a hook changes (a glow at
  // night, a flash on a pulse) is added to it, so it is never merged by look.
  const matSnap = new Map<THREE.Material, string | null>();
  const eachMat = (fn: (m: THREE.Material) => void) => root.traverse((o) => { const m = (o as THREE.Mesh).material; if (m) for (const x of Array.isArray(m) ? m : [m]) fn(x); });
  if (materials) eachMat((m) => { if (!matSnap.has(m)) matSnap.set(m, materialSig(m, true)); });
  const changed = new Set<THREE.Object3D>();
  const mark = () => {
    root.traverse((o) => {
      const a = snap.get(o);
      if (!a) { changed.add(o); how.set(o, new Set(['added'])); return; } // added by a hook
      const b = read(o);
      onOff.set(o, `${onOff.get(o)},${+b.v}${+b.c}`);
      const h = how.get(o) ?? new Set<string>();
      if (a.v !== b.v) h.add('visible');
      if (a.c !== b.c) h.add('shadow');
      if (a.g !== b.g) h.add('geometry');
      if (a.mat !== b.mat) h.add('material');
      if (a.m.some((x, i) => Math.abs(x - b.m[i]) > 1e-7)) h.add('moved');
      if (h.size) { changed.add(o); how.set(o, h); }
    });
    if (materials) eachMat((m) => { if (!matSnap.has(m) || matSnap.get(m) !== materialSig(m, true)) materials.add(m); });
  };
  poke(mark);
  mark();
  if (nodes) for (const o of changed) if (o !== root) nodes.add(o);
  if (toggles) {
    for (const o of changed) {
      if (o === root || [...how.get(o)!].some((k) => k !== 'visible' && k !== 'shadow')) continue;
      // Under a node that changes too: it goes with that node (mergeWithinMoving).
      let under = false;
      for (let p = o.parent; p && p !== root; p = p.parent) if (changed.has(p)) under = true;
      if (!under) toggles.set(o, onOff.get(o)!);
    }
  }
  const dynamic = new Set<THREE.Object3D>();
  root.traverse((o) => {
    for (let p: THREE.Object3D | null = o; p && p !== root.parent; p = p.parent) if (changed.has(p) && p !== root) { dynamic.add(o); break; }
  });
  return dynamic;
}

/**
 * The materials a landmark's build hands out besides its group (`hall`,
 * `screen`, `interior`…, a few levels deep): World code may change them
 * later, so they must stay themselves.
 */
export function materialsIn(b: object): Set<THREE.Material> {
  const out = new Set<THREE.Material>();
  const seen = new Set<unknown>();
  const walk = (v: unknown, depth: number): void => {
    if (!v || typeof v !== 'object' || seen.has(v) || depth > 3) return;
    seen.add(v);
    if ((v as THREE.Material).isMaterial) { out.add(v as THREE.Material); return; }
    if ((v as THREE.Object3D).isObject3D) {
      (v as THREE.Object3D).traverse((o) => { const m = (o as THREE.Mesh).material; if (m) for (const x of Array.isArray(m) ? m : [m]) out.add(x); });
      return;
    }
    for (const x of Array.isArray(v) ? v : Object.values(v)) walk(x, depth + 1);
  };
  for (const [k, v] of Object.entries(b)) if (k !== 'group') walk(v, 0);
  return out;
}
