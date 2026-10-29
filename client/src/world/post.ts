// Post-processing and the quality ladder.
//
//   render → ambient occlusion (GTAO) → bloom → tilt-shift → grade → output
//
// Each level picks resolution, shadow-map size, AO and anti-aliasing (MSAA
// on the composer target; FXAA on the cheapest level). "auto" starts high and
// steps down while frames are slow; a fixed level stays put.

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { maskAo } from './aoMask';
import { FXAAPass } from 'three/examples/jsm/postprocessing/FXAAPass.js';

/** The tilt-shift's strongest blur (texels per unit of the kernel) and its taps either side. */
export const TILT_MAX_RADIUS = 3.2;
export const TILT_TAPS = 4;
/** Kernel units between taps: with the per-pixel jitter, taps never sit more than ~3 texels apart. */
export const TILT_STEP = 0.9;

// Toy-town blur above and below a sharp band. Nine taps, each pixel's set
// shifted by a little noise: five sparse taps turned every bright point
// (a star, an orb, a badge's glow) into a grid of dots.
const TiltShift = (horizontal: boolean) => ({
  uniforms: {
    tDiffuse: { value: null },
    uAmount: { value: 1.0 },
    uFocus: { value: 0.5 },
    uBand: { value: 0.22 },
    uTexel: { value: new THREE.Vector2(1 / 1024, 1 / 1024) },
  },
  vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uAmount, uFocus, uBand; uniform vec2 uTexel; varying vec2 vUv;
    void main(){
      float d = max(abs(vUv.y - uFocus) - uBand, 0.0);
      float r = clamp(d * 9.0, 0.0, 1.0) * ${TILT_MAX_RADIUS.toFixed(1)} * uAmount;
      if (r < 0.01) { gl_FragColor = texture2D(tDiffuse, vUv); return; }
      vec2 dir = ${horizontal ? 'vec2(uTexel.x, 0.0)' : 'vec2(0.0, uTexel.y)'} * r * ${TILT_STEP.toFixed(2)};
      // Interleaved gradient noise: a different half-step shift for each pixel.
      float n = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) - 0.5;
      vec4 s = vec4(0.0); float wsum = 0.0;
      for (int i = -${TILT_TAPS}; i <= ${TILT_TAPS}; i++) {
        float t = float(i) + n;
        float w = exp(-t * t / 8.0);
        s += texture2D(tDiffuse, vUv + dir * t) * w;
        wsum += w;
      }
      gl_FragColor = s / wsum;
    }`,
});

/**
 * Right after the scene (and again after the AO): no pixel brighter than a bright highlight, and no
 * NaN. The scene renders into half floats (max 65504), and a sun glint on
 * very smooth glass or metal (three's GGX peaks near 40000× the light) can
 * overflow to infinity; the bloom blur turns that into NaN and NaN spreads
 * over the whole frame: a black flash. One cheap pass makes it impossible.
 */
export const SafeColor = {
  uniforms: { tDiffuse: { value: null }, uMax: { value: 8 } },
  vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uMax; varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      // NaN fails every comparison, so it falls to 0 here; ±infinity clamps.
      vec3 ok = vec3(greaterThanEqual(c.rgb, vec3(0.0)));
      c.rgb = clamp(c.rgb * ok, 0.0, uMax);
      c.a = c.a >= 0.0 ? min(c.a, 1.0) : 1.0;
      gl_FragColor = c;
    }`,
};

/** A light colour grade: a touch more saturation and contrast, soft vignette.
 *  It drops NaN and clamps too, so the cheapest level needs no SafeColor pass.
 *  `uTrip` (0–1, a magic mushroom: world/mushrooms.ts) bends it: the picture
 *  waves and slowly swirls, its colours split at the edges, saturate and
 *  turn round the hue wheel, rings of colour breathing out from the middle. */
export const Grade = {
  uniforms: { tDiffuse: { value: null }, uSat: { value: 1.08 }, uContrast: { value: 1.04 }, uVignette: { value: 0.22 }, uTrip: { value: 0 }, uTime: { value: 0 } },
  vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uSat, uContrast, uVignette, uTrip, uTime; varying vec2 vUv;
    vec3 hueTurn(vec3 c, float a){
      const vec3 k = vec3(0.57735);
      float ca = cos(a);
      return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
    }
    void main(){
      vec2 uv = vUv;
      float r = distance(vUv, vec2(0.5));
      vec4 c;
      if (uTrip > 0.001) {
        uv += uTrip * 0.011 * vec2(sin(uv.y * 13.0 + uTime * 1.7), cos(uv.x * 11.0 + uTime * 1.3));
        float a = uTrip * 0.09 * sin(uTime * 0.5) * (1.0 - r);
        uv = vec2(0.5) + mat2(cos(a), -sin(a), sin(a), cos(a)) * (uv - vec2(0.5));
        vec2 split = (uv - vec2(0.5)) * 0.012 * uTrip;
        c = texture2D(tDiffuse, uv);
        c.r = texture2D(tDiffuse, uv + split).r;
        c.b = texture2D(tDiffuse, uv - split).b;
      } else c = texture2D(tDiffuse, uv);
      c.rgb = clamp(c.rgb * vec3(greaterThanEqual(c.rgb, vec3(0.0))), 0.0, 8.0);
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      c.rgb = mix(vec3(l), c.rgb, uSat + uTrip * 0.8);
      if (uTrip > 0.001) {
        c.rgb = mix(c.rgb, max(hueTurn(c.rgb, uTime * 0.7 + r * 5.0), 0.0), uTrip * 0.7);
        float ring = 0.5 + 0.5 * sin(r * 28.0 - uTime * 2.2);
        c.rgb += uTrip * 0.06 * ring * (0.5 + 0.5 * cos(vec3(0.0, 2.1, 4.2) + uTime + r * 9.0));
      }
      c.rgb = (c.rgb - 0.5) * uContrast + 0.5;
      float v = 1.0 - smoothstep(0.25, 0.85, r);
      c.rgb *= mix(1.0 - uVignette * (1.0 + uTrip), 1.0, v);
      gl_FragColor = c;
    }`,
};

import { adaptStep, lowScaleStep, newAdapt, startLevel, ORDER, type Adapt, type Level } from './quality';
export type { Level };

export interface PostSettings {
  quality: 'auto' | Level;
  resolution: number;
  shadows: boolean;
  ambientOcclusion: boolean;
  bloom: boolean;
  tiltShift: boolean;
}

/** Give render targets a new MSAA sample count: each one that changes is
 *  disposed, so three.js builds it again on next use (changing the count of
 *  a target it already set up throws on the next draw). */
export function setSamples(targets: THREE.WebGLRenderTarget[], samples: number): number {
  let changed = 0;
  for (const t of targets) {
    if (t.samples === samples) continue;
    t.samples = samples;
    t.dispose();
    changed++;
  }
  return changed;
}

const LEVELS: Record<Level, { pixelRatio: number; shadowMap: number; ao: 'off' | 'half' | 'full'; msaa: number }> = {
  low: { pixelRatio: 1, shadowMap: 1024, ao: 'off', msaa: 0 },
  medium: { pixelRatio: 1.25, shadowMap: 2048, ao: 'off', msaa: 4 },
  high: { pixelRatio: 1.75, shadowMap: 2048, ao: 'half', msaa: 4 },
  ultra: { pixelRatio: 2, shadowMap: 4096, ao: 'full', msaa: 4 },
};

export class Post {
  readonly composer: EffectComposer;
  private target: THREE.WebGLRenderTarget;
  private gtao: GTAOPass;
  private bloom: UnrealBloomPass;
  private tiltH: ShaderPass;
  private tiltV: ShaderPass;
  private grade: ShaderPass;
  private safeScene: ShaderPass;
  private safeAo: ShaderPass;
  /** A level change waiting for the start of the next frame (see render). */
  private pendingLevel = false;
  /** Below "low": the resolution "auto" gives up when even low is slow (phones). */
  private lowScale = 1;
  /** A touch device: smaller, less frequent shadows. */
  private coarse = false;
  private lowTimes: number[] = [];
  private fxaa: FXAAPass;
  level: Level = 'high';
  settings: PostSettings = { quality: 'auto', resolution: 1, shadows: true, ambientOcclusion: true, bloom: true, tiltShift: true };
  private auto: Adapt;
  private held = false;
  private frameNo = 0;
  /** The level changed (by "auto" or by prefs): things sized by it follow (grass). */
  onLevel?: (level: Level) => void;
  private size = new THREE.Vector2(1, 1);

  constructor(
    private renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    private sun: THREE.DirectionalLight,
  ) {
    // "Automatic" starts from a guess for this device, then follows the frame times.
    const nav = (typeof navigator === 'undefined' ? {} : navigator) as Navigator & { deviceMemory?: number };
    this.coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    this.level = startLevel({
      coarse: this.coarse,
      memory: nav.deviceMemory,
      cores: nav.hardwareConcurrency,
      short: typeof screen === 'undefined' ? 1080 : Math.min(screen.width, screen.height),
    });
    this.auto = newAdapt(this.level);
    this.target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, this.target);
    this.composer.addPass(new RenderPass(scene, camera));
    this.safeScene = new ShaderPass(SafeColor);
    this.composer.addPass(this.safeScene);
    this.gtao = new GTAOPass(scene, camera, 1, 1);
    // Sprites and glows would be drawn as opaque squares into the AO's normals.
    maskAo(this.gtao as unknown as Parameters<typeof maskAo>[0]);
    this.gtao.updateGtaoMaterial({ radius: 0.35, distanceExponent: 1.3, thickness: 1.5, scale: 1.1, samples: 12 });
    this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
    // Soft: strong AO turns pets' bellies and people's undersides black.
    this.gtao.blendIntensity = 0.6;
    this.composer.addPass(this.gtao);
    // GTAO divides by depths and normalises normals: it can make NaN of its own.
    this.safeAo = new ShaderPass(SafeColor);
    this.composer.addPass(this.safeAo);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.32, 0.5, 0.88);
    this.composer.addPass(this.bloom);
    this.tiltH = new ShaderPass(TiltShift(true));
    this.tiltV = new ShaderPass(TiltShift(false));
    this.composer.addPass(this.tiltH);
    this.composer.addPass(this.tiltV);
    this.grade = new ShaderPass(Grade);
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
    this.fxaa = new FXAAPass();
    this.composer.addPass(this.fxaa);
  }

  /** Preferences changed: pick the level and re-apply everything. */
  configure(s: PostSettings): void {
    const was = this.level;
    this.settings = s;
    if (s.quality !== 'auto') this.level = s.quality;
    this.auto = newAdapt(this.level, this.auto?.ceiling ?? null);
    this.applyLevel();
    if (this.level !== was) this.onLevel?.(this.level);
  }

  private applyLevel(): void {
    const L = LEVELS[this.level];
    const dpr = Math.min(window.devicePixelRatio || 1, L.pixelRatio);
    const ratio = Math.max(0.5, dpr * this.settings.resolution * (this.level === 'low' ? this.lowScale : 1));
    if (this.renderer.getPixelRatio() !== ratio) this.renderer.setPixelRatio(ratio);
    this.renderer.shadowMap.enabled = this.settings.shadows && this.level !== 'low';
    this.sun.castShadow = this.renderer.shadowMap.enabled;
    const mapSize = this.coarse ? Math.min(L.shadowMap, 1024) : L.shadowMap;
    if (this.sun.shadow.mapSize.x !== mapSize) {
      this.sun.shadow.mapSize.set(mapSize, mapSize);
      this.sun.shadow.map?.dispose();
      (this.sun.shadow as { map: THREE.WebGLRenderTarget | null }).map = null;
    }
    this.sun.shadow.radius = this.level === 'ultra' ? 3 : 2;
    // MSAA on or off. A render target three.js has already set up can't
    // change its sample count in place (the next draw throws, and a frame
    // that throws after a resize leaves the screen black): both of the
    // composer's targets take the new count and are rebuilt on next use.
    setSamples([this.composer.renderTarget1, this.composer.renderTarget2], L.msaa);
    this.gtao.enabled = this.settings.ambientOcclusion && L.ao !== 'off';
    this.fxaa.enabled = L.msaa === 0;
    this.setSize(this.size.x, this.size.y);
  }

  setSize(w: number, h: number): void {
    this.size.set(w, h);
    this.composer.setSize(w, h);
    const px = this.renderer.getPixelRatio();
    for (const p of [this.tiltH, this.tiltV]) p.uniforms.uTexel.value.set(1 / (w * px), 1 / (h * px));
    // Half-resolution AO on "high" keeps it affordable.
    const aoScale = LEVELS[this.level].ao === 'half' ? 0.5 : 1;
    this.gtao.setSize(Math.max(1, w * px * aoScale), Math.max(1, h * px * aoScale));
  }

  /** Scale the miniature-lens blur (0 = off): the loading view and the intro
   *  look straight down, where a blurred top and bottom just look smeared. */
  setTiltAmount(k: number): void {
    this.tiltH.uniforms.uAmount.value = this.tiltV.uniforms.uAmount.value = k;
  }

  /** How far into the night (0 day … 1 night), from `setNight`. */
  private night = 0;

  /** Night lets glowing things bloom a little more: bulbs, signs, the
   *  obelisk's tip. The threshold stays over the lamp-lit ground (at 0.65 the
   *  pools themselves bloomed, a haze over the whole plaza). */
  setNight(night01: number): void {
    this.night = night01;
    this.bloom.strength = 0.25 + night01 * 0.2;
    this.bloom.threshold = 0.9 - night01 * 0.08;
  }

  /** How strong the trip is (0–1) and the time it moves with (world/mushrooms.ts). */
  setTrip(level: number, time: number): void {
    this.grade.uniforms.uTrip.value = level;
    this.grade.uniforms.uTime.value = time;
  }

  render(dt: number): void {
    // Resizing the canvas clears it: do it before drawing, never after (a
    // level stepped at the end of a frame showed that frame blank, black).
    if (this.pendingLevel) { this.pendingLevel = false; this.applyLevel(); }
    this.tiltH.enabled = this.tiltV.enabled = this.settings.tiltShift && this.level !== 'low';
    this.bloom.enabled = this.settings.bloom && this.level !== 'low';
    // NaN only spreads through the blurs: guard what feeds them (Grade guards the rest).
    this.safeScene.enabled = this.gtao.enabled || this.bloom.enabled;
    this.safeAo.enabled = this.gtao.enabled && this.bloom.enabled;
    // On medium the sun's shadows refresh every other frame (people move
    // little in one), every third on a phone; on a phone, high skips one too.
    // At night the moon's are faint: every other frame at most, anywhere.
    this.frameNo++;
    if (this.renderer.shadowMap.enabled) {
      const day = this.level === 'medium' ? (this.coarse ? 3 : 2) : this.coarse && this.level === 'high' ? 2 : 1;
      const every = this.night > 0.85 ? Math.max(2, day) : day;
      this.renderer.shadowMap.autoUpdate = every === 1;
      if (every > 1 && this.frameNo % every === 0) this.renderer.shadowMap.needsUpdate = true;
    }
    this.composer.render(dt);
    this.adapt(dt);
  }

  /** The GPU gave up once (context lost): one level lower from now on, and
   *  "auto" never climbs back to where it was. */
  stepDown(): void {
    const i = ORDER.indexOf(this.level);
    const ceiling = this.level;
    if (i > 0) this.level = ORDER[i - 1];
    else this.lowScale = Math.max(0.6, this.lowScale * 0.85);
    this.auto = newAdapt(this.level, ceiling);
    this.pendingLevel = true;
    console.info('[sky] quality →', this.level, '(after a lost context)');
    this.onLevel?.(this.level);
  }

  /** Where the scene is drawn (the chain's first target, linear, no tone
   *  mapping): shaders compiled against it are the ones the frames use, while
   *  compiling against the canvas makes variants nothing draws. */
  get sceneTarget(): THREE.WebGLRenderTarget {
    return this.composer.readBuffer;
  }

  /** Hold the "auto" level (while models load, slow frames say nothing about the GPU). */
  holdLevel(on: boolean): void {
    this.held = on;
    this.auto = newAdapt(this.level, this.auto.ceiling);
  }

  /** Still slow on "low" (a phone): render fewer pixels, down to 60 %. */
  private adaptLow(dt: number): void {
    this.lowTimes.push(dt);
    if (this.lowTimes.length < 120) return;
    const avg = this.lowTimes.reduce((s, x) => s + x, 0) / this.lowTimes.length;
    this.lowTimes = [];
    const next = lowScaleStep(this.lowScale, avg);
    if (next === this.lowScale) return;
    this.lowScale = next;
    this.pendingLevel = true;
    console.info('[sky] resolution →', Math.round(next * 100) + '%');
  }

  /** "auto": down a level when frames are slow, back up with plenty of headroom (quality.ts). */
  private adapt(dt: number): void {
    if (this.settings.quality !== 'auto' || this.held) return;
    if (this.level === 'low') this.adaptLow(dt);
    const next = adaptStep(this.auto, dt);
    if (!next) return;
    this.level = next;
    this.pendingLevel = true;
    console.info('[sky] quality →', this.level);
    this.onLevel?.(this.level);
  }
}
