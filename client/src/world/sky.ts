// Sky dome, sun, clouds and stars. The sun follows the real time in Buenos
// Aires (where Obelisk lives), so the village has sunrise, a pink sunset and
// lit windows at night. A manual override is available from the UI.

import * as THREE from 'three';
import { rng } from './layout';

export type TimeOverride = 'auto' | 'day' | 'sunset' | 'night';

interface Palette { top: THREE.Color; horizon: THREE.Color; bottom: THREE.Color; sun: THREE.Color; sunI: number; hemiSky: THREE.Color; hemiGround: THREE.Color; hemiI: number }

const P = (top: number, horizon: number, bottom: number, sun: number, sunI: number, hemiSky: number, hemiGround: number, hemiI: number): Palette => ({
  top: new THREE.Color(top), horizon: new THREE.Color(horizon), bottom: new THREE.Color(bottom),
  sun: new THREE.Color(sun), sunI, hemiSky: new THREE.Color(hemiSky), hemiGround: new THREE.Color(hemiGround), hemiI,
});

// Night keeps a cool moonlit fill: faces turned from the moon (people,
// building sides) must stay readable, not go black under the tone mapping.
// The moon itself is soft (0.55): at 0.8 the night was a quarter of the day.
export const NIGHT = P(0x070b24, 0x283063, 0x141a3a, 0x9fb4ff, 0.55, 0x7080c0, 0x433e62, 1.15);
// The fill (hemisphere) light is what faces turned from the sun get: faces,
// pets' bellies, building sides. Kept bright enough that they read.
export const DUSK = P(0x6c74c4, 0xf7b694, 0xf1a2a0, 0xffa66b, 1.5, 0xc9a7d8, 0x8a6a66, 1.1);
export const DAY = P(0x4f9fe0, 0xd3ecf7, 0xb3daf0, 0xfff1d6, 1.8, 0xcfe6ff, 0x8f9474, 1.25);

function mix(a: Palette, b: Palette, t: number): Palette {
  const c = (x: THREE.Color, y: THREE.Color) => x.clone().lerp(y, t);
  return {
    top: c(a.top, b.top), horizon: c(a.horizon, b.horizon), bottom: c(a.bottom, b.bottom), sun: c(a.sun, b.sun),
    sunI: a.sunI + (b.sunI - a.sunI) * t, hemiSky: c(a.hemiSky, b.hemiSky), hemiGround: c(a.hemiGround, b.hemiGround),
    hemiI: a.hemiI + (b.hemiI - a.hemiI) * t,
  };
}

/** Hours (0–24, fractional) in Buenos Aires (UTC−3, no DST). */
export function baHours(d = new Date()): number {
  return (((d.getUTCHours() - 3 + 24) % 24) + d.getUTCMinutes() / 60);
}

/** −1 (midnight) … 1 (noon); ~0 at 6:30 and 19:30. */
export function sunElevation(hours: number): number {
  return Math.sin(((hours - 6.5) / 13) * Math.PI) * (hours > 6.5 && hours < 19.5 ? 1 : 0.6);
}

export class Sky {
  readonly sun = new THREE.DirectionalLight(0xffffff, 2);
  readonly hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
  private dome: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private stars: THREE.Points;
  private clouds: THREE.Group[] = [];
  private cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 1, emissive: 0xffffff, emissiveIntensity: 0.15 });
  override: TimeOverride = 'auto';
  /** 0 = night, 1 = full day — consumed by water, windows, lamps. */
  day = 1;
  night = false;
  private elevation = NaN;

  constructor(private scene: THREE.Scene) {
    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(400, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          uTop: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uBottom: { value: new THREE.Color() },
          uSunDir: { value: new THREE.Vector3() }, uSun: { value: new THREE.Color() },
        },
        vertexShader: /* glsl */ `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uTop, uHorizon, uBottom, uSun, uSunDir; varying vec3 vDir;
          void main(){
            float y = vDir.y;
            vec3 c = y > 0.0 ? mix(uHorizon, uTop, pow(y, 0.6)) : mix(uHorizon, uBottom, pow(-y, 0.5));
            float s = max(dot(vDir, normalize(uSunDir)), 0.0);
            c += uSun * (pow(s, 64.0) * 0.8 + pow(s, 6.0) * 0.18);
            gl_FragColor = vec4(c, 1.0);
            #include <colorspace_fragment>
          }`,
      }),
    );
    this.dome.renderOrder = -10;
    scene.add(this.dome);

    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -24; sc.right = 24; sc.top = 24; sc.bottom = -24; sc.near = 1; sc.far = 120;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    scene.add(this.sun, this.sun.target, this.hemi);

    const r = rng(42);
    const starPos: number[] = [];
    for (let i = 0; i < 900; i++) {
      const th = r() * Math.PI * 2, ph = Math.acos(r() * 1.6 - 0.6);
      starPos.push(Math.sin(ph) * Math.cos(th) * 350, Math.cos(ph) * 350, Math.sin(ph) * Math.sin(th) * 350);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, fog: false }));
    scene.add(this.stars);

    this.buildClouds();
    scene.fog = new THREE.Fog(0xffffff, 80, 260);
  }

  private buildClouds(): void {
    const r = rng(11);
    const geo = new THREE.IcosahedronGeometry(1, 1);
    for (let i = 0; i < 16; i++) {
      const c = new THREE.Group();
      const n = 4 + Math.floor(r() * 5);
      for (let k = 0; k < n; k++) {
        const m = new THREE.Mesh(geo, this.cloudMat);
        const s = 0.8 + r() * 1.4;
        m.scale.set(s * 1.3, s * 0.8, s);
        m.position.set((k - n / 2) * 1.1 + r() * 0.6, r() * 0.6, r() * 1.2);
        c.add(m);
      }
      const below = i < 9;
      const rad = below ? 16 + r() * 20 : 34 + r() * 25;
      const a = r() * Math.PI * 2;
      c.position.set(Math.cos(a) * rad, below ? -12 - r() * 8 : 2 + r() * 12, Math.sin(a) * rad);
      c.scale.setScalar(below ? 1 + r() * 1.2 : 0.8 + r() * 0.8);
      c.userData = { a, rad, speed: 0.004 + r() * 0.006, y: c.position.y };
      this.clouds.push(c);
      this.scene.add(c);
    }
  }

  update(dt: number, t: number): void {
    const hours = this.override === 'auto' ? baHours()
      : this.override === 'day' ? 12.5 : this.override === 'sunset' ? 18.9 : 23.5;
    const target = sunElevation(hours);
    // Ease toward the target so overrides animate.
    if (Number.isNaN(this.elevation)) this.elevation = target;
    this.elevation += (target - this.elevation) * Math.min(1, dt * 1.5);
    const e = this.elevation;
    const pal = e < 0 ? mix(DUSK, NIGHT, THREE.MathUtils.smoothstep(-e, 0.0, 0.3))
      : mix(DUSK, DAY, THREE.MathUtils.smoothstep(e, 0.08, 0.55));
    const u = this.dome.material.uniforms;
    u.uTop.value.copy(pal.top);
    u.uHorizon.value.copy(pal.horizon);
    u.uBottom.value.copy(pal.bottom);
    u.uSun.value.copy(pal.sun);

    // Sun arcs east→west; at night the "sun" light is the moon, opposite.
    const az = ((hours - 6.5) / 13) * Math.PI;
    const elevAngle = Math.max(0.18, Math.abs(e)) * (Math.PI / 2.4);
    const dir = new THREE.Vector3(Math.cos(az) * Math.cos(elevAngle), Math.sin(elevAngle), 0.55 * Math.cos(elevAngle)).normalize();
    if (e < 0) dir.x *= -1;
    u.uSunDir.value.copy(dir);
    this.sun.position.copy(dir).multiplyScalar(60);
    this.sun.color.copy(pal.sun);
    this.sun.intensity = pal.sunI;
    this.hemi.color.copy(pal.hemiSky);
    this.hemi.groundColor.copy(pal.hemiGround);
    this.hemi.intensity = pal.hemiI;

    this.day = THREE.MathUtils.smoothstep(e, -0.2, 0.15);
    this.night = e < -0.05;
    (this.stars.material as THREE.PointsMaterial).opacity = 1 - THREE.MathUtils.smoothstep(e, -0.25, 0.0);
    (this.scene.fog as THREE.Fog).color.copy(pal.horizon);
    this.cloudMat.color.copy(pal.horizon).lerp(new THREE.Color(0xffffff), 0.75);
    this.cloudMat.emissive.copy(pal.horizon);
    this.cloudMat.emissiveIntensity = 0.35;

    for (const c of this.clouds) {
      const d = c.userData as { a: number; rad: number; speed: number; y: number };
      d.a += d.speed * dt;
      c.position.x = Math.cos(d.a) * d.rad;
      c.position.z = Math.sin(d.a) * d.rad;
      c.position.y = d.y + Math.sin(t * 0.2 + d.rad) * 0.3;
    }
  }
}
