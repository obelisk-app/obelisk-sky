// The plaza landmark, built from Obelisk's own mark.
//
// Proportions are the logo's exact ones, as obelisk-media's costume plan
// gives them (disfraz-obelisk, "proporciones originales", OB-01): 180 tall,
// a 48.21 square base narrowing to 28.93 at 157.5, then a 22.5 pyramidion;
// height = 3.73 × base. Colours follow the same plan: light green (#d9ff9e)
// front and back, lime (#b4f953) on the sides, each pyramidion triangle the
// colour of the face below it. No dark side.

import * as THREE from 'three';

export const LOGO_PROPORTIONS = { base: 48.21, top: 28.93, shaft: 157.5, height: 180 } as const;
export const LIME = 0xb4f953;
export const LIGHT_GREEN = 0xd9ff9e;

export interface Obelisk {
  group: THREE.Group;
  /** Drive the glow: 0 day … 1 night, plus a 0..1 message pulse. */
  setGlow(night: number, pulse: number): void;
}

/** The shaft and pyramidion dimensions for a given height. */
export function obeliskShape(height: number) {
  const k = height / LOGO_PROPORTIONS.height;
  return {
    base: (LOGO_PROPORTIONS.base / 2) * k,
    top: (LOGO_PROPORTIONS.top / 2) * k,
    shaftH: LOGO_PROPORTIONS.shaft * k,
    apex: height,
  };
}

/** Quad (as two triangles) with flat UVs, appended to arrays. */
function quad(pos: number[], uv: number[], a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3): void {
  for (const v of [a, b, c, a, c, d]) pos.push(v.x, v.y, v.z);
  uv.push(0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1);
}

function meshOf(pos: number[], uv: number[] | null, mat: THREE.Material): THREE.Mesh {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  if (uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return new THREE.Mesh(g, mat);
}

/** The stepped plinth under an obelisk this tall: each step's half width
 *  and the height of its top (people bump into it and can jump up it). */
export function plinthSteps(height: number): { half: number; top: number }[] {
  const { base } = obeliskShape(height);
  let y = 0;
  return ([[2.9, 0.16], [2.4, 0.16], [1.9, 0.18]] as const).map(([k, h]) => ({ half: (base * k) / 2, top: (y += h) }));
}

/** `lights: false` leaves out the uplight and the tip light (an indoor model:
 *  its emissive faces carry the glow, and the light budget stays free);
 *  `plinth: false` stands the body on the ground (the plinth's steps are
 *  sized for people, too tall under a small obelisk). */
export function buildObelisk(height = 8, opts: { lights?: boolean; plinth?: boolean } = {}): Obelisk {
  const { lights = true, plinth = true } = opts;
  const { base, top, shaftH, apex } = obeliskShape(height);
  const group = new THREE.Group();
  const body = new THREE.Group();
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

  // Shaft faces in order +z, +x, -z, -x (counter-clockwise seen from above):
  // light green front and back, lime sides, like the logo and the costume.
  const corners = (h: number, y: number) => [V(-h, y, h), V(h, y, h), V(h, y, -h), V(-h, y, -h)];
  const lo = corners(base, 0), hi = corners(top, shaftH);
  const lightFace = new THREE.MeshStandardMaterial({ color: LIGHT_GREEN, emissive: LIGHT_GREEN, emissiveIntensity: 0.1, roughness: 0.55, flatShading: true });
  const limeFace = new THREE.MeshStandardMaterial({ color: LIME, emissive: LIME, emissiveIntensity: 0.12, roughness: 0.55, flatShading: true });
  const faceMats = [lightFace, limeFace, lightFace, limeFace];
  const tip = V(0, apex, 0);
  for (let i = 0; i < 4; i++) {
    const pos: number[] = [], uv: number[] = [];
    quad(pos, uv, lo[i], lo[(i + 1) % 4], hi[(i + 1) % 4], hi[i]);
    const m = meshOf(pos, uv, faceMats[i]);
    m.castShadow = true;
    m.receiveShadow = true;
    body.add(m);
    // The pyramidion triangle above this face, in its colour.
    const tri: number[] = [];
    for (const v of [hi[i], hi[(i + 1) % 4], tip]) tri.push(v.x, v.y, v.z);
    const t = meshOf(tri, null, faceMats[i]);
    t.castShadow = true;
    body.add(t);
  }

  // Pale edge strips up the four corners and on to the point.
  const edgeMat = new THREE.MeshBasicMaterial({ color: 0xf2ffd9, transparent: true, opacity: 0.5 });
  const strip = (a: THREE.Vector3, b: THREE.Vector3) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.035, a.distanceTo(b), 0.035), edgeMat);
    m.position.copy(a).lerp(b, 0.5);
    m.quaternion.setFromUnitVectors(V(0, 1, 0), b.clone().sub(a).normalize());
    m.name = 'edge';
    body.add(m);
  };
  for (let i = 0; i < 4; i++) {
    strip(lo[i], hi[i]);
    strip(hi[i], tip);
  }

  // Stepped plinth; the body sits on top of it.
  const plinthMat = new THREE.MeshStandardMaterial({ color: 0xd9d2c4, roughness: 0.8, flatShading: true });
  let y = 0;
  for (const st of plinth ? plinthSteps(height) : []) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(st.half * 2, st.top - y, st.half * 2), plinthMat);
    s.position.y = (y + st.top) / 2;
    s.castShadow = true;
    s.receiveShadow = true;
    group.add(s);
    y = st.top;
  }
  body.position.y = y;
  group.add(body);

  // Green uplight from the plinth and a glow at the tip.
  const up = new THREE.SpotLight(LIME, 0, 14, Math.PI / 9, 0.6, 1.2);
  up.position.set(0, y + 0.05, 0);
  up.target.position.set(0, y + apex, 0);
  const tipLight = new THREE.PointLight(LIME, 0, 9, 1.8);
  tipLight.position.set(0, y + apex + 0.3, 0);
  if (lights) group.add(up, up.target, tipLight);

  return {
    group,
    setGlow(night: number, pulse: number) {
      // Kept under the bloom threshold by day; at night only the tip and the
      // edges bloom, so the monument glows without washing the island.
      lightFace.emissiveIntensity = 0.1 + night * 0.15 + pulse * 0.3;
      limeFace.emissiveIntensity = 0.12 + night * 0.16 + pulse * 0.35;
      edgeMat.opacity = 0.5 + night * 0.2;
      // The uplight grazes the shaft from a few centimetres: at 6 cd the whole
      // monument burnt lime-white and bloomed over the plaza.
      up.intensity = night * 1.2 + pulse * 3;
      tipLight.intensity = night * 1.2 + pulse * 2;
    },
  };
}
