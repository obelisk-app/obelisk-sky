// Copy the CC0 Kenney models the client uses from _dl/ into client/public/models.
import { cpSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DL = '_dl';
const OUT = 'client/public/models';
const town = join(DL, 'kenney_fantasy-town-kit_2.0/Models/GLB format');
const nature = join(DL, 'kenney_nature-kit/Models/GLTF format');

const TOWN = [
  'wall', 'wall-door', 'wall-window-shutters', 'wall-window-glass', 'wall-window-round', 'wall-corner',
  'wall-wood', 'wall-wood-door', 'wall-wood-window-shutters', 'wall-wood-window-glass', 'wall-wood-window-round', 'wall-wood-corner',
  'roof', 'roof-corner', 'roof-gable', 'roof-gable-end', 'roof-high', 'roof-high-corner', 'roof-high-gable', 'roof-high-point', 'roof-point',
  'chimney', 'banner-green', 'banner-red', 'lantern', 'stall', 'stall-green', 'stall-red', 'stall-bench', 'stall-stool',
  'fountain-round', 'fountain-round-detail', 'fountain-center', 'windmill', 'watermill', 'watermill-wide', 'cart', 'wheel',
  'fence', 'hedge', 'pillar-stone', 'planks', 'overhang',
];
const NATURE = [
  'tree_default', 'tree_oak', 'tree_fat', 'tree_detailed', 'tree_cone', 'tree_pineDefaultA', 'tree_pineRoundA', 'tree_pineTallA',
  'tree_default_fall', 'tree_oak_fall', 'tree_fat_fall', 'tree_cone_fall', 'tree_blocks',
  'plant_bush', 'plant_bushLarge', 'plant_bushDetailed', 'plant_bushSmall', 'grass', 'grass_large', 'grass_leafs',
  'flower_redA', 'flower_yellowA', 'flower_purpleA', 'flower_redB', 'flower_yellowB', 'flower_purpleB',
  'rock_largeA', 'rock_largeB', 'rock_tallA', 'rock_smallA', 'rock_smallB', 'stone_smallA', 'stone_tallB',
  'mushroom_red', 'mushroom_redGroup', 'log', 'log_stack', 'stump_round', 'campfire_stones', 'campfire_logs',
  'tent_detailedOpen', 'bridge_wood', 'lily_large', 'lily_small', 'sign', 'statue_obelisk', 'hanging_moss',
  'crops_cornStageD', 'crops_wheatStageB', 'pot_large',
];
mkdirSync(join(OUT, 'town', 'Textures'), { recursive: true });
mkdirSync(join(OUT, 'nature'), { recursive: true });
for (const n of TOWN) cpSync(join(town, `${n}.glb`), join(OUT, 'town', `${n}.glb`));
cpSync(join(town, 'Textures'), join(OUT, 'town', 'Textures'), { recursive: true });
for (const n of NATURE) {
  const f = join(nature, `${n}.glb`);
  if (existsSync(f)) cpSync(f, join(OUT, 'nature', `${n}.glb`));
  else console.warn('missing', n);
}
// Pets (Kenney Cube Pets, CC0) and the character previews the creator shows.
const pets = join(DL, 'kenney_cube-pets/Models/GLB format');
mkdirSync(join(OUT, 'pets', 'Textures'), { recursive: true });
for (const f of readdirSync(pets)) if (f.endsWith('.glb')) cpSync(join(pets, f), join(OUT, 'pets', f.replace(/^animal-/, '')));
cpSync(join(pets, 'Textures'), join(OUT, 'pets', 'Textures'), { recursive: true });
mkdirSync('client/public/avatars', { recursive: true });
cpSync(join(DL, 'kenney_blocky-characters_20/Previews'), 'client/public/avatars', { recursive: true });
mkdirSync('client/public/pets', { recursive: true });
for (const f of readdirSync(join(DL, 'kenney_cube-pets/Previews'))) cpSync(join(DL, 'kenney_cube-pets/Previews', f), join('client/public/pets', f.replace(/^animal-/, '')));
console.log('assets copied; now run node scripts/optimize-models.mjs (meshopt for the pets)');
