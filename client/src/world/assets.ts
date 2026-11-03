// glTF loading and cloning. Every model is loaded once, then cloned per use;
// static props that repeat a lot (trees, flowers, rocks) are instanced by
// props.ts instead. URLs carry the file's content hash (assetUrl.ts).

import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { modelUrl } from './assetUrl';

// Pets are meshopt-compressed (scripts/optimize-models.mjs); town and nature are not.
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const cache = new Map<string, Promise<GLTF>>();

export function loadGltf(path: string): Promise<GLTF> {
  let p = cache.get(path);
  if (!p) {
    p = loader.loadAsync(modelUrl(`${path}.glb`));
    p.catch(() => cache.delete(path)); // a failed file may be retried
    cache.set(path, p);
  }
  return p;
}

export const loaded = new Map<string, GLTF>();

export async function preload(paths: string[], onProgress?: (done: number, total: number) => void): Promise<void> {
  let done = 0;
  await Promise.all(paths.map(async (p) => {
    try {
      loaded.set(p, await loadGltf(p));
    } catch (e) {
      console.warn('model failed', p, e);
    }
    onProgress?.(++done, paths.length);
  }));
}

/** A fresh copy of a loaded model, with shadows on. */
export function model(path: string): THREE.Object3D {
  const g = loaded.get(path);
  if (!g) return new THREE.Group();
  const o = g.scene.clone(true);
  o.traverse((c) => {
    if ((c as THREE.Mesh).isMesh) {
      c.castShadow = true;
      c.receiveShadow = true;
    }
  });
  return o;
}

export const TOWN = [
  'wall', 'wall-door', 'wall-window-shutters', 'wall-window-glass', 'wall-window-round', 'wall-corner',
  'wall-wood', 'wall-wood-door', 'wall-wood-window-shutters', 'wall-wood-window-glass', 'wall-wood-window-round', 'wall-wood-corner',
  'roof', 'roof-corner', 'roof-gable', 'roof-gable-end', 'roof-high', 'roof-high-corner', 'roof-high-gable', 'roof-high-point', 'roof-point',
  'chimney', 'banner-green', 'banner-red', 'lantern', 'stall', 'stall-green', 'stall-red', 'stall-bench', 'stall-stool',
  'fountain-round', 'fountain-round-detail', 'fountain-center', 'windmill', 'watermill', 'watermill-wide', 'cart', 'wheel',
  'fence', 'hedge', 'pillar-stone', 'planks', 'overhang',
].map((n) => `town/${n}`);

export const NATURE = [
  'tree_default', 'tree_oak', 'tree_fat', 'tree_detailed', 'tree_cone', 'tree_pineDefaultA', 'tree_pineRoundA', 'tree_pineTallA',
  'tree_default_fall', 'tree_oak_fall', 'tree_fat_fall', 'tree_cone_fall', 'tree_blocks',
  'plant_bush', 'plant_bushLarge', 'plant_bushDetailed', 'plant_bushSmall', 'grass', 'grass_large', 'grass_leafs',
  'flower_redA', 'flower_yellowA', 'flower_purpleA', 'flower_redB', 'flower_yellowB', 'flower_purpleB',
  'rock_largeA', 'rock_largeB', 'rock_tallA', 'rock_smallA', 'rock_smallB', 'stone_smallA', 'stone_tallB',
  'mushroom_red', 'mushroom_redGroup', 'log', 'log_stack', 'stump_round', 'campfire_stones', 'campfire_logs',
  'tent_detailedOpen', 'lily_large', 'lily_small', 'sign', 'statue_obelisk', 'hanging_moss',
  'crops_cornStageD', 'crops_wheatStageB', 'pot_large',
].map((n) => `nature/${n}`);

export const ALL_MODELS = [...TOWN, ...NATURE];
