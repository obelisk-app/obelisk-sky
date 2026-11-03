// Shrinks the Kenney Cube Pets in client/public/models/pets in place:
// meshes and animation keyframes meshopt-compressed (quantized), the shared
// colormap embedded so a pet is one request. Already-compressed files are
// skipped, so it is safe to run again after `npm run assets`.
//
// Town and nature are left as they are: world/merge.ts only merges Float32
// geometry, and quantized houses would stop merging (more draw calls). They
// are small and served brotli-compressed instead (scripts/hash-assets.mjs).
//
//   node scripts/optimize-models.mjs

import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, resample, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';

const DIR = 'client/public/models/pets';

await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

let before = 0, after = 0;
for (const f of readdirSync(DIR).filter((n) => n.endsWith('.glb')).sort()) {
  const path = join(DIR, f);
  const doc = await io.read(path);
  if (doc.getRoot().listExtensionsUsed().some((e) => e.extensionName === 'EXT_meshopt_compression')) continue;
  const size = statSync(path).size;
  await doc.transform(resample(), dedup(), prune({ keepLeaves: true }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  // Writing a .glb embeds the external Textures/colormap.png.
  for (const t of doc.getRoot().listTextures()) t.setURI('');
  await io.write(path, doc);
  const out = statSync(path).size;
  before += size; after += out;
  console.log(`${f}: ${(size / 1024).toFixed(0)} KB → ${(out / 1024).toFixed(0)} KB`);
}
console.log(before ? `pets: ${(before / 1048576).toFixed(2)} MB → ${(after / 1048576).toFixed(2)} MB` : 'pets already compressed');
