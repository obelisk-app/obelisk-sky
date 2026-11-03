import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error plain .mjs build script
import { hashModels, glbJson, glbWithJson, hashedName } from './hash-assets.mjs';
import { ALL_MODELS } from '../client/src/world/assets';
import { FILES } from '../client/src/people/people';
import { PETS } from '../client/src/nostr/avatars';

function glb(json: object, bin = Buffer.alloc(8, 7)): Buffer {
  const head = Buffer.alloc(20);
  head.writeUInt32LE(0x46546c67, 0);
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(0x4e4f534a, 16);
  const binHead = Buffer.alloc(8);
  binHead.writeUInt32LE(bin.length, 0);
  binHead.writeUInt32LE(0x004e4942, 4);
  return glbWithJson(Buffer.concat([head, binHead, bin]), json) as Buffer;
}

describe('hashed models', () => {
  it('names a file by its content', () => {
    expect(hashedName('town/wall.glb', Buffer.from('a'))).toMatch(/^town\/wall\.[0-9a-f]{8}\.glb$/);
    expect(hashedName('town/wall.glb', Buffer.from('a'))).not.toBe(hashedName('town/wall.glb', Buffer.from('b')));
  });

  it('points a GLB at its texture\'s hashed copy, so a changed texture renames the GLB too', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sky-models-'));
    mkdirSync(join(dir, 'town', 'Textures'), { recursive: true });
    const model = glb({ asset: { version: '2.0' }, images: [{ uri: 'Textures/colormap.png' }] });
    writeFileSync(join(dir, 'town', 'wall.glb'), model);
    writeFileSync(join(dir, 'town', 'Textures', 'colormap.png'), 'one');
    const first = hashModels(dir);
    const tex = first.find((f: { rel: string }) => f.rel === 'town/Textures/colormap.png');
    const wall = first.find((f: { rel: string }) => f.rel === 'town/wall.glb');
    expect(glbJson(wall.buf).images[0].uri).toBe(tex.out.replace('town/', ''));
    expect(wall.buf.subarray(-8)).toEqual(Buffer.alloc(8, 7)); // binary chunk kept
    expect(wall.buf.readUInt32LE(8)).toBe(wall.buf.length);
    writeFileSync(join(dir, 'town', 'Textures', 'colormap.png'), 'two');
    const again = hashModels(dir).find((f: { rel: string }) => f.rel === 'town/wall.glb');
    expect(again.out).not.toBe(wall.out);
  });

  it('hashes every model the client loads', () => {
    const names = new Set(hashModels().map((f: { rel: string }) => f.rel));
    const wanted = [
      ...ALL_MODELS.map((m) => `${m}.glb`),
      ...PETS.filter((p) => p !== 'nostrich').map((p) => `pets/${p}.glb`),
      ...[FILES.anims, FILES.body, FILES.brows, FILES.outfit, FILES.hair].flatMap((g) => Object.values(g)).map((f) => `people/${f}`),
      ...['m', 'f'].flatMap((b) => ['light', 'dark'].map((t) => `people/skin-${b}-${t}.webp`)),
    ];
    for (const w of wanted) expect(names.has(w), w).toBe(true);
  });
});
