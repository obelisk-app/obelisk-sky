// Content-hashed models, and precompressed static files.
//
//   node scripts/hash-assets.mjs manifest   (before `vite build`)
//     Hashes every model, texture and skin under client/public/models and
//     writes client/src/generated/model-manifest.json:
//     { "town/wall.glb": "town/wall.1a2b3c4d.glb", … }. The client asks for
//     the hashed name (client/src/world/assetUrl.ts), so the server, the
//     browser and Cloudflare can keep each one a year: a changed model gets a
//     new name, never a stale copy.
//   node scripts/hash-assets.mjs emit       (after `vite build`)
//     Writes those hashed copies into dist/client/models, then a .br and a
//     .gz beside every compressible file in dist/client (server/index.ts
//     serves them to browsers that accept them).
//
// A GLB that names an external texture (the Kenney town's
// Textures/colormap.png) is rewritten to name the texture's hashed copy, so
// the GLB's own hash covers its texture too.

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, extname, posix } from 'node:path';
import { brotliCompressSync, gzipSync, constants } from 'node:zlib';

const SRC = 'client/public/models';
const DIST = 'dist/client';
const MANIFEST = 'client/src/generated/model-manifest.json';
const HASHED = /\.(glb|png|webp|jpg)$/;
const COMPRESSIBLE = new Set(['.js', '.mjs', '.css', '.json', '.html', '.svg', '.xml', '.txt', '.glb', '.wasm', '.webmanifest']);

export const hash8 = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 8);
export const hashedName = (rel, buf) => rel.replace(/(\.[a-z0-9]+)$/i, `.${hash8(buf)}$1`);

function walk(dir, base = dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, base));
    else out.push(posix.normalize(p.slice(base.length + 1).split('\\').join('/')));
  }
  return out.sort();
}

/** A GLB with its JSON chunk replaced (re-padded to 4 bytes with spaces). */
export function glbWithJson(glb, json) {
  const oldLen = glb.readUInt32LE(12);
  const rest = glb.subarray(20 + oldLen);
  let text = Buffer.from(JSON.stringify(json));
  if (text.length % 4) text = Buffer.concat([text, Buffer.alloc(4 - (text.length % 4), 0x20)]);
  const head = Buffer.alloc(20);
  head.writeUInt32LE(0x46546c67, 0); // glTF
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(20 + text.length + rest.length, 8);
  head.writeUInt32LE(text.length, 12);
  head.writeUInt32LE(0x4e4f534a, 16); // JSON
  return Buffer.concat([head, text, rest]);
}

export function glbJson(glb) {
  if (glb.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB');
  return JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString('utf8'));
}

/** Every hashed file: { rel, out, buf } (textures before the GLBs that name them). */
export function hashModels(src = SRC) {
  const files = walk(src).filter((f) => HASHED.test(f));
  const names = new Map();
  const out = [];
  for (const rel of files.filter((f) => !f.endsWith('.glb'))) {
    const buf = readFileSync(join(src, rel));
    names.set(rel, hashedName(rel, buf));
    out.push({ rel, out: names.get(rel), buf });
  }
  for (const rel of files.filter((f) => f.endsWith('.glb'))) {
    let buf = readFileSync(join(src, rel));
    const json = glbJson(buf);
    let changed = false;
    for (const img of json.images ?? []) {
      if (!img.uri || img.uri.startsWith('data:')) continue;
      const target = posix.join(posix.dirname(rel), decodeURIComponent(img.uri));
      const hashed = names.get(target);
      if (!hashed) throw new Error(`${rel}: texture ${img.uri} not found under ${src}`);
      img.uri = posix.relative(posix.dirname(rel), hashed);
      changed = true;
    }
    if (changed) buf = glbWithJson(buf, json);
    names.set(rel, hashedName(rel, buf));
    out.push({ rel, out: names.get(rel), buf });
  }
  return out;
}

function writeManifest() {
  const files = hashModels();
  mkdirSync(dirname(MANIFEST), { recursive: true });
  writeFileSync(MANIFEST, JSON.stringify(Object.fromEntries(files.map((f) => [f.rel, f.out])), null, 1) + '\n');
  console.log(`model manifest: ${files.length} files`);
}

function emit() {
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  for (const f of hashModels()) {
    if (manifest[f.rel] !== f.out) throw new Error(`${f.rel} changed since the manifest was written; rebuild`);
    const dest = join(DIST, 'models', f.out);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, f.buf);
  }
  let n = 0, raw = 0, br = 0;
  for (const rel of walk(DIST)) {
    if (!COMPRESSIBLE.has(extname(rel))) continue;
    const p = join(DIST, rel);
    const buf = readFileSync(p);
    if (buf.length < 1024) continue;
    const b = brotliCompressSync(buf, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: buf.length } });
    if (b.length >= buf.length * 0.95) continue; // not worth it
    writeFileSync(`${p}.br`, b);
    writeFileSync(`${p}.gz`, gzipSync(buf, { level: 9 }));
    n++; raw += buf.length; br += b.length;
  }
  console.log(`models hashed into ${DIST}/models; ${n} files precompressed, ${(raw / 1048576).toFixed(1)} MB → ${(br / 1048576).toFixed(1)} MB brotli`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const cmd = process.argv[2];
  if (cmd === 'manifest') writeManifest();
  else if (cmd === 'emit') emit();
  else { console.error('usage: hash-assets.mjs manifest|emit'); process.exit(1); }
}
