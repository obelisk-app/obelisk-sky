// Calisthenics clips, built from pose descriptions on the people's skeleton.
//
// The animation library has no push-ups, pull-ups, muscle-ups or dips, so
// each is a handful of key poses. A pose aims limbs in character space
// ("upper arm points up and a little out") and may pitch the whole body;
// each aimed bone is rotated from its rest pose onto its target direction,
// parents first. Then the body is moved so the hands land where they grip
// (the bar, the parallel bars, the floor): the clips are built for a given
// bar height, so a grip meets the real bar whatever the skeleton's
// proportions. For push-ups the body's pitch is also solved so hands and
// toes both touch the floor.
//
// Aims are in the body's own frame (y toward the head, z toward the chest,
// x to the character's left), so they pitch with the body; the frame is
// checked against the skeleton itself when building.

import * as THREE from 'three';

export type ExerciseKind = 'pushup' | 'pullup' | 'muscleup' | 'dip' | 'benchpress' | 'squat' | 'curl' | 'deadlift';

type Dir = [number, number, number];
export interface PoseSpec {
  /** Forward pitch of the whole body, radians (+ leans the head forward). */
  pitch?: number;
  /** Bone → direction its first child should lie along. */
  aim: Record<string, Dir>;
  /** The left hand (the right mirrors it): which way it points, which way the
   *  palm faces, and how far the fingers curl (radians per joint). */
  hands?: { dir: Dir; palm: Dir; curl: number };
  /** Standing poses only: lift the whole body (a hop) and shift it sideways
   *  (a sway), as fractions of its height. */
  rise?: number;
  sway?: number;
}
interface Key { t: number; pose: PoseSpec }

/** Mirror a left-side aim onto the right (x flips). */
const both = (bone: string, d: Dir): Record<string, Dir> => ({ [`${bone}_l`]: d, [`${bone}_r`]: [-d[0], d[1], d[2]] });
const merge = (...parts: Record<string, Dir>[]): Record<string, Dir> => Object.assign({}, ...parts);

// Hands. Hanging: pointing up past the bar, palm forward, fingers over it.
// On a bar from above: pointing down, palm to the bar. On parallel bars:
// pointing down the inside of the bar, palm facing in, fingers round it.
// Push-ups: flat on the floor, fingers forward.
const OVER_BAR = { dir: [0, 1, 0] as Dir, palm: [0, 0, 1] as Dir, curl: 0.85 };
const ON_BAR = { dir: [0, -1, 0.3] as Dir, palm: [0, 0.3, 1] as Dir, curl: 0.8 };
const ON_PARALLEL = { dir: [0.15, -1, 0.15] as Dir, palm: [-1, -0.1, 0] as Dir, curl: 0.95 };
/** Bones at the ends of fingers and toes (the people's `*_03`, `*_04_leaf`, `ball_leaf`). */
const FLOOR_TIP = /^(thumb|index|middle|ring|pinky)_0[34](_leaf)?_[lr]$|^ball_leaf_[lr]$/;
/** How far those tips stay above the floor (model units: 4 cm, 1.6 cm in the village). */
const FLOOR_SKIN = 0.04;
const FLAT = { dir: [0, 1, 0] as Dir, palm: [0, 0, 1] as Dir, curl: 0.08 };

const STRAIGHT_LEGS = merge(both('thigh', [0.03, -1, 0]), both('calf', [0, -1, -0.02]));
const HANG_LEGS = merge(both('thigh', [0.04, -1, 0.15]), both('calf', [0, -1, -0.35]));
const TUCK_LEGS = merge(both('thigh', [0.05, -1, 0.35]), both('calf', [0, -0.6, -0.8]));

const HANG: PoseSpec = { hands: OVER_BAR, aim: merge(both('upperarm', [0.15, 1, 0]), both('lowerarm', [0.08, 1, 0]), HANG_LEGS) };
const PULLED: PoseSpec = { hands: OVER_BAR, aim: merge(both('upperarm', [0.8, -0.5, 0.15]), both('lowerarm', [-0.05, 1, 0.05]), TUCK_LEGS) };
// Kipping: the body swings under the bar, chest through (arch), then legs
// forward (hollow), and the swing back drives the pull.
const KIP_ARCH: PoseSpec = { pitch: -0.3, hands: OVER_BAR, aim: merge(both('upperarm', [0.15, 1, 0]), both('lowerarm', [0.08, 1, 0]), both('thigh', [0.04, -1, -0.35]), both('calf', [0, -1, -0.45])) };
const KIP_HOLLOW: PoseSpec = { pitch: 0.28, hands: OVER_BAR, aim: merge(both('upperarm', [0.15, 1, 0]), both('lowerarm', [0.08, 1, 0]), both('thigh', [0.05, -0.75, 0.65]), both('calf', [0, -0.9, 0.3])) };
const TRANSITION: PoseSpec = { pitch: 0.45, hands: { dir: [0, 0.7, 1], palm: [0, -1, 0.7], curl: 0.8 }, aim: merge(both('upperarm', [0.3, -0.5, -0.8]), both('lowerarm', [0.05, 0.25, 1]), TUCK_LEGS) };
const SUPPORT: PoseSpec = { pitch: 0.12, hands: ON_BAR, aim: merge(both('upperarm', [0.14, -1, -0.08]), both('lowerarm', [0.06, -1, 0.1]), HANG_LEGS) };
const DIP_TOP: PoseSpec = { pitch: 0.1, hands: ON_PARALLEL, aim: merge(both('upperarm', [0.12, -1, -0.05]), both('lowerarm', [0.06, -1, 0.1]), both('thigh', [0.03, -1, 0.25]), both('calf', [0, -0.35, -1])) };
const DIP_LOW: PoseSpec = { pitch: 0.35, hands: ON_PARALLEL, aim: merge(both('upperarm', [0.15, -0.4, -1]), both('lowerarm', [0.05, -1, 0.2]), both('thigh', [0.03, -1, 0.35]), both('calf', [0, -0.3, -1])) };
// Push-ups are lying down: in the body's own frame "forward" is toward the floor.
const PLANK_UP: PoseSpec = { hands: FLAT, aim: merge(both('upperarm', [0.15, 0.05, 1]), both('lowerarm', [0.03, 0, 1]), STRAIGHT_LEGS) };
const PLANK_DOWN: PoseSpec = { hands: FLAT, aim: merge(both('upperarm', [0.8, -0.45, 0.3]), both('lowerarm', [0.05, 0.2, 1]), STRAIGHT_LEGS) };

// The gym (world/gym.ts), with a barbell in both hands (Character.heldBar).
// Bench press: lying on the back, so the chest's "forward" is up; the feet
// go down to the floor beside the bench.
const PRESS_HANDS = { dir: [0, 0, 1] as Dir, palm: [0, -1, 0] as Dir, curl: 0.85 };
const BENCH_LEGS = merge(both('thigh', [0.3, -1, -0.1]), both('calf', [0.05, -0.15, -1]));
const PRESS_UP: PoseSpec = { pitch: -Math.PI / 2, hands: PRESS_HANDS, aim: merge(both('upperarm', [0.35, 0.12, 1]), both('lowerarm', [0.08, 0.04, 1]), BENCH_LEGS) };
const PRESS_DOWN: PoseSpec = { pitch: -Math.PI / 2, hands: PRESS_HANDS, aim: merge(both('upperarm', [1, 0.12, -0.2]), both('lowerarm', [0.05, 0.06, 1]), BENCH_LEGS) };
// Squat: the bar across the upper back, hands just outside the shoulders.
// Aims pitch with the torso, so the low squat's thighs are written in the
// leaning body's frame (they end up about level in the world).
const BAR_ON_BACK = merge(both('upperarm', [1, 0.3, -0.3]), both('lowerarm', [0.05, 1, -0.25]));
const BACK_HANDS = { dir: [0, 1, 0] as Dir, palm: [0, 0, 1] as Dir, curl: 0.8 };
const SQUAT_UP: PoseSpec = { pitch: 0.06, hands: BACK_HANDS, aim: merge(BAR_ON_BACK, STRAIGHT_LEGS) };
const SQUAT_LOW: PoseSpec = { pitch: 0.55, hands: BACK_HANDS, aim: merge(BAR_ON_BACK, both('thigh', [0.18, 0.27, 1]), both('calf', [0, -1.04, 0.22])) };
// Curls: elbows at the sides, forearms up to the shoulders and down.
const CURL_DOWN: PoseSpec = { hands: { dir: [0, -1, 0.15], palm: [0, 0.15, 1], curl: 0.85 }, aim: merge(both('upperarm', [0.12, -1, 0.05]), both('lowerarm', [0.06, -1, 0.2]), STRAIGHT_LEGS) };
const CURL_UP: PoseSpec = { hands: { dir: [0, 0.45, 1], palm: [0, 1, -0.45], curl: 0.85 }, aim: merge(both('upperarm', [0.12, -1, 0.12]), both('lowerarm', [0.05, 0.45, 1]), STRAIGHT_LEGS) };

// Deadlift: the bar from the floor to the hips. At the bottom the body hinges
// forward (pitch), so the aims are written in the leaning body's frame: there
// world-down is (0, -cos p, sin p). Arms hang straight down to the bar, thighs
// go down and a little forward, shins lean the knees over the bar.
const DL_HANDS_TOP = { dir: [0, -1, 0.05] as Dir, palm: [0, 0.05, -1] as Dir, curl: 0.9 };
const DL_TOP: PoseSpec = { pitch: 0.04, hands: DL_HANDS_TOP, aim: merge(both('upperarm', [0.1, -1, 0.06]), both('lowerarm', [0.06, -1, 0.1]), STRAIGHT_LEGS) };
const DL_HANDS_LOW = { dir: [0, -0.455, 0.89] as Dir, palm: [0, -0.87, -0.5] as Dir, curl: 0.9 };
const DL_LOW: PoseSpec = { pitch: 1.05, hands: DL_HANDS_LOW, aim: merge(both('upperarm', [0.1, -0.455, 0.89]), both('lowerarm', [0.06, -0.455, 0.89]), both('thigh', [0.08, 0.4, 0.92]), both('calf', [0.02, -0.73, 0.68])) };

// The lotus pose (an emote, not an exercise): sitting cross-legged on the
// ground, knees out to the sides, each shin crossed in front of the other,
// the backs of the hands resting on the knees, palms up. It breathes: the
// chest lifts and the arms ease out a touch.
const LOTUS_LEGS = merge(both('thigh', [0.85, -0.12, 0.55]), both('calf', [-0.95, -0.04, -0.12]));
const LOTUS_HANDS = { dir: [0.3, -0.25, 1] as Dir, palm: [0, 1, 0.1] as Dir, curl: 0.25 };
const LOTUS_IN: PoseSpec = { pitch: 0.02, hands: LOTUS_HANDS, aim: merge(both('upperarm', [0.32, -1, 0.18]), both('lowerarm', [0.35, -0.35, 1]), LOTUS_LEGS) };
const LOTUS_OUT: PoseSpec = { pitch: -0.02, hands: LOTUS_HANDS, aim: merge(both('upperarm', [0.36, -1, 0.2]), both('lowerarm', [0.4, -0.33, 1]), LOTUS_LEGS) };
export const LOTUS: { keys: Key[]; grip: 'ground' } = {
  grip: 'ground',
  keys: [{ t: 0, pose: LOTUS_IN }, { t: 2.4, pose: LOTUS_OUT }, { t: 4.8, pose: LOTUS_IN }],
};

// Jumping jacks (an emote): feet together and arms down, a hop, feet apart
// and arms overhead, a hop back. One jack a second.
const JACK_HANDS_DOWN = { dir: [0.05, -1, 0] as Dir, palm: [-1, 0, 0.1] as Dir, curl: 0.3 };
const JACK_HANDS_UP = { dir: [0.25, 1, 0] as Dir, palm: [0, 0, 1] as Dir, curl: 0.2 };
const JACK_CLOSED: PoseSpec = { hands: JACK_HANDS_DOWN, aim: merge(both('upperarm', [0.14, -1, 0.02]), both('lowerarm', [0.08, -1, 0.06]), STRAIGHT_LEGS) };
const JACK_MID: PoseSpec = { rise: 0.07, hands: JACK_HANDS_DOWN, aim: merge(both('upperarm', [1, 0.05, 0.02]), both('lowerarm', [1, 0.25, 0]), both('thigh', [0.2, -1, 0]), both('calf', [0.18, -1, -0.02])) };
const JACK_OPEN: PoseSpec = { hands: JACK_HANDS_UP, aim: merge(both('upperarm', [0.5, 1, 0.02]), both('lowerarm', [0.25, 1, 0]), both('thigh', [0.36, -1, 0]), both('calf', [0.34, -1, -0.02])) };
export const JACKS: { keys: Key[]; grip: 'stand' } = {
  grip: 'stand',
  keys: [
    { t: 0, pose: JACK_CLOSED }, { t: 0.18, pose: JACK_MID }, { t: 0.36, pose: JACK_OPEN }, { t: 0.5, pose: JACK_OPEN },
    { t: 0.68, pose: JACK_MID }, { t: 0.86, pose: JACK_CLOSED }, { t: 1.0, pose: JACK_CLOSED },
  ],
};

// A groove (the dance emote): two bars at 120 BPM, a key on every beat.
// The knees bounce on each beat; the arms go point-up left, pump, point-up
// right, pump, raise the roof twice and roll. The hips sway to the side
// that points. Timed to the dance loop (audio/synthLoops.ts DANCE_BPM).
const BOUNCE_LEGS = merge(both('thigh', [0.06, -1, 0.3]), both('calf', [0, -1, -0.3]));
const OPEN_HANDS = { dir: [0.1, 1, 0.3] as Dir, palm: [0, 0, 1] as Dir, curl: 0.15 };
const FIST = { dir: [0, 0.4, 1] as Dir, palm: [-1, 0, 0] as Dir, curl: 1.1 };
const PUMP: PoseSpec = { rise: -0.03, pitch: 0.06, hands: FIST, aim: merge(both('upperarm', [0.5, -0.75, 0.35]), both('lowerarm', [-0.15, 0.55, 1]), BOUNCE_LEGS) };
const POINT_L: PoseSpec = {
  sway: 0.06, hands: OPEN_HANDS,
  aim: merge(
    { upperarm_l: [0.45, 1, 0.25], lowerarm_l: [0.3, 1, 0.2], upperarm_r: [-0.25, -1, 0.2], lowerarm_r: [0.2, -0.6, 0.8] },
    { thigh_l: [0.18, -1, 0.05], calf_l: [0.1, -1, -0.02], thigh_r: [-0.04, -1, 0.15], calf_r: [0, -1, -0.15] },
  ),
};
const POINT_R: PoseSpec = {
  sway: -0.06, hands: OPEN_HANDS,
  aim: merge(
    { upperarm_r: [-0.45, 1, 0.25], lowerarm_r: [-0.3, 1, 0.2], upperarm_l: [0.25, -1, 0.2], lowerarm_l: [-0.2, -0.6, 0.8] },
    { thigh_r: [-0.18, -1, 0.05], calf_r: [-0.1, -1, -0.02], thigh_l: [0.04, -1, 0.15], calf_l: [0, -1, -0.15] },
  ),
};
const ROOF: PoseSpec = { rise: 0.01, pitch: -0.05, hands: { dir: [0, 1, 0], palm: [0, 1, 0.2], curl: 0.1 }, aim: merge(both('upperarm', [0.75, 0.45, 0.1]), both('lowerarm', [0.15, 1, 0.05]), STRAIGHT_LEGS) };
const ROLL: PoseSpec = { rise: -0.03, pitch: 0.1, hands: FIST, aim: merge({ upperarm_l: [0.45, -0.3, 1], lowerarm_l: [-0.7, 0.35, 0.5], upperarm_r: [-0.45, -0.45, 1], lowerarm_r: [0.7, 0.1, 0.6] }, BOUNCE_LEGS) };
export const GROOVE: { keys: Key[]; grip: 'stand' } = {
  grip: 'stand',
  keys: [
    { t: 0, pose: PUMP }, { t: 0.5, pose: POINT_L }, { t: 1.0, pose: PUMP }, { t: 1.5, pose: POINT_R },
    { t: 2.0, pose: ROOF }, { t: 2.5, pose: PUMP }, { t: 3.0, pose: ROOF }, { t: 3.5, pose: ROLL }, { t: 4.0, pose: PUMP },
  ],
};

// "Sangreee...": a knife in each fist (world/sangre.ts). Fists low, then
// both arms thrown up in a V, chest out and head back, trembling there
// until the scream ends; seven seconds, the length of its sound.
const KNIFE_FIST = { dir: [0.3, 1, 0.15] as Dir, palm: [-1, 0, 0.2] as Dir, curl: 1.1 };
const KNIFE_LOW: PoseSpec = { pitch: 0.08, hands: { dir: [0.1, -0.3, 1], palm: [-1, 0, 0], curl: 1.1 }, aim: merge(both('upperarm', [0.25, -1, 0.15]), both('lowerarm', [0.15, -0.6, 1]), { neck_01: [0, 1, 0.3] }, BOUNCE_LEGS) };
const V_HIGH: PoseSpec = { rise: 0.01, pitch: -0.1, hands: KNIFE_FIST, aim: merge(both('upperarm', [0.6, 1, 0.12]), both('lowerarm', [0.45, 1, 0.12]), { neck_01: [0, 1, -0.3] }, STRAIGHT_LEGS) };
const V_SHAKE: PoseSpec = { rise: -0.01, pitch: -0.06, hands: KNIFE_FIST, aim: merge(both('upperarm', [0.7, 0.9, 0.2]), both('lowerarm', [0.55, 1, 0.22]), { neck_01: [0, 1, -0.2] }, BOUNCE_LEGS) };
export const SANGRE: { keys: Key[]; grip: 'stand' } = {
  grip: 'stand',
  keys: [
    { t: 0, pose: KNIFE_LOW }, { t: 0.45, pose: KNIFE_LOW }, { t: 0.8, pose: V_HIGH },
    ...Array.from({ length: 22 }, (_, i) => ({ t: 1.05 + i * 0.25, pose: i % 2 ? V_HIGH : V_SHAKE })),
    { t: 6.6, pose: V_HIGH }, { t: 7, pose: KNIFE_LOW },
  ],
};

// Swimming (world.ts, in deep water): a breaststroke, the body leaning far
// forward on the water with the head up. In the body's frame +y runs up the
// spine (ahead, in the water) and +z out of the chest (down). Glide with the
// arms out front, sweep them wide, pull the hands in under the chin while the
// knees draw up (frog), then shoot the arms forward as the legs kick back.
const PADDLE = { dir: [0.1, 1, 0.15] as Dir, palm: [0, 0, 1] as Dir, curl: 0.12 };
const HEAD_UP = { neck_01: [0, 1, -0.75] as Dir };
const LONG_LEGS = merge(both('thigh', [0.06, -1, -0.05]), both('calf', [0, -1, -0.1]));
const SWIM_GLIDE: PoseSpec = { pitch: 1.2, hands: PADDLE, aim: merge(both('upperarm', [0.18, 1, 0.12]), both('lowerarm', [0.08, 1, 0.1]), HEAD_UP, LONG_LEGS) };
const SWIM_SWEEP: PoseSpec = { pitch: 1.18, hands: { dir: [1, 0.5, 0.2], palm: [-0.3, 0.4, 1], curl: 0.12 }, aim: merge(both('upperarm', [1, 0.55, 0.2]), both('lowerarm', [0.8, 0.6, 0.35]), HEAD_UP, LONG_LEGS) };
const SWIM_PULL: PoseSpec = {
  pitch: 1.1, hands: { dir: [-0.4, 0.8, 0.4], palm: [-0.6, 0, 1], curl: 0.15 },
  aim: merge(both('upperarm', [0.75, -0.15, 0.9]), both('lowerarm', [-0.55, 0.75, 0.3]), HEAD_UP, both('thigh', [0.45, -0.75, 0.35]), both('calf', [0.15, -0.35, -1])),
};
const SWIM_KICK: PoseSpec = { pitch: 1.16, hands: PADDLE, aim: merge(both('upperarm', [0.25, 1, 0.3]), both('lowerarm', [0.1, 1, 0.15]), HEAD_UP, both('thigh', [0.3, -1, -0.05]), both('calf', [0.12, -1, -0.15])) };
export const SWIM: { keys: Key[]; grip: 'float' } = {
  grip: 'float',
  keys: [
    { t: 0, pose: SWIM_GLIDE }, { t: 0.4, pose: SWIM_SWEEP }, { t: 0.72, pose: SWIM_PULL },
    { t: 0.98, pose: SWIM_KICK }, { t: 1.4, pose: SWIM_GLIDE },
  ],
};

/** Clips built like the exercises that aren't training: the emotes, and swimming. */
export const EMOTE_CLIPS = { lotus: LOTUS, jacks: JACKS, groove: GROOVE, sangre: SANGRE, swim: SWIM } as const;
export type EmoteClipKind = keyof typeof EMOTE_CLIPS;

/**
 * Key poses and timing (seconds) of one repetition; the last key returns to
 * the first. Grip: hands on a bar at its height, hands on the floor, feet on
 * the floor ('stand', the hands go where the pose puts them) or lying on a
 * bench whose top is at the grip height ('lie').
 */
export const EXERCISES: Record<ExerciseKind, { keys: Key[]; grip: 'bar' | 'floor' | 'stand' | 'lie'; label: string }> = {
  pullup: { label: 'Pull-ups', grip: 'bar', keys: [{ t: 0, pose: HANG }, { t: 0.9, pose: PULLED }, { t: 1.3, pose: PULLED }, { t: 2.3, pose: HANG }] },
  muscleup: {
    label: 'Muscle-ups', grip: 'bar',
    keys: [
      { t: 0, pose: HANG }, { t: 0.45, pose: KIP_ARCH }, { t: 0.95, pose: KIP_HOLLOW }, { t: 1.4, pose: KIP_ARCH },
      { t: 1.85, pose: PULLED }, { t: 2.2, pose: TRANSITION }, { t: 2.65, pose: SUPPORT }, { t: 3.3, pose: SUPPORT },
      { t: 3.9, pose: PULLED }, { t: 4.5, pose: HANG },
    ],
  },
  dip: { label: 'Dips', grip: 'bar', keys: [{ t: 0, pose: DIP_TOP }, { t: 0.9, pose: DIP_LOW }, { t: 1.2, pose: DIP_LOW }, { t: 2.1, pose: DIP_TOP }] },
  pushup: { label: 'Push-ups', grip: 'floor', keys: [{ t: 0, pose: PLANK_UP }, { t: 0.8, pose: PLANK_DOWN }, { t: 1.0, pose: PLANK_DOWN }, { t: 1.8, pose: PLANK_UP }] },
  benchpress: { label: 'Bench press', grip: 'lie', keys: [{ t: 0, pose: PRESS_UP }, { t: 1.1, pose: PRESS_DOWN }, { t: 1.35, pose: PRESS_DOWN }, { t: 2.3, pose: PRESS_UP }, { t: 2.7, pose: PRESS_UP }] },
  squat: { label: 'Squats', grip: 'stand', keys: [{ t: 0, pose: SQUAT_UP }, { t: 1.2, pose: SQUAT_LOW }, { t: 1.4, pose: SQUAT_LOW }, { t: 2.4, pose: SQUAT_UP }, { t: 2.8, pose: SQUAT_UP }] },
  deadlift: { label: 'Deadlifts', grip: 'stand', keys: [{ t: 0, pose: DL_TOP }, { t: 0.5, pose: DL_TOP }, { t: 1.5, pose: DL_LOW }, { t: 1.75, pose: DL_LOW }, { t: 2.7, pose: DL_TOP }] },
  curl: { label: 'Curls', grip: 'stand', keys: [{ t: 0, pose: CURL_DOWN }, { t: 0.9, pose: CURL_UP }, { t: 1.1, pose: CURL_UP }, { t: 2.0, pose: CURL_DOWN }] },
};

interface Rest { bone: THREE.Bone; q: THREE.Quaternion; p: THREE.Vector3 }

/**
 * Build the looping clip for `kind`, gripping at `gripY` (model units above
 * the feet: the bar's height, or 0 for the floor). `model` is a person's
 * model in its rest pose (not animated), unscaled.
 */
export function buildExerciseClip(
  kind: ExerciseKind | EmoteClipKind, model: THREE.Object3D, gripY: number, name = `${kind}@${gripY.toFixed(2)}`,
  /** Half the distance between the two grips (parallel bars), model units. */
  gripHalf?: number,
  /** The bar's radius (model units): the fingers close round it. */
  barR = 0.06,
): THREE.AnimationClip {
  const bones = new Map<string, THREE.Bone>();
  model.traverse((o) => { if ((o as THREE.Bone).isBone) bones.set(o.name, o as THREE.Bone); });
  const rest: Rest[] = [...bones.values()].map((bone) => ({ bone, q: bone.quaternion.clone(), p: bone.position.clone() }));
  const root = bones.get('root') ?? rest[0].bone;
  const restore = () => { for (const r of rest) { r.bone.quaternion.copy(r.q); r.bone.position.copy(r.p); } model.updateMatrixWorld(true); };
  restore();

  // Which way is left and forward in this skeleton's own space?
  const wp = (n: string) => bones.get(n)!.getWorldPosition(new THREE.Vector3());
  const sx = Math.sign(wp('hand_l').x - wp('hand_r').x) || 1;
  const sz = Math.sign(wp('ball_l').z - wp('foot_l').z) || 1;
  const toModel = (d: Dir) => new THREE.Vector3(d[0] * sx, d[1], d[2] * sz).normalize();
  const pitchAxis = new THREE.Vector3(sx, 0, 0); // +pitch takes the head toward +z (forward)
  if (sz < 0) pitchAxis.negate();

  const alignForward = kind === 'pullup' || kind === 'muscleup';
  const onFloor = kind === 'pushup';
  const spec: { keys: Key[]; grip: 'bar' | 'floor' | 'stand' | 'lie' | 'ground' | 'float' } = kind in EMOTE_CLIPS ? EMOTE_CLIPS[kind as EmoteClipKind] : EXERCISES[kind as ExerciseKind];
  const grip = spec.grip;
  // Standing lifts keep the feet where they stand; lying ones put the back
  // on the bench. Measured at rest: the soles, and the back's depth below
  // the pelvis joint (about a sixteenth of the body's height).
  const feet = () => {
    const l = wp('foot_l'), r = wp('foot_r');
    return { x: (l.x + r.x) / 2, z: (l.z + r.z) / 2, y: Math.min(l.y, r.y, wp('ball_l').y, wp('ball_r').y) };
  };
  const restFeet = feet();
  const backDepth = Math.max(0.05, wp('Head').y - restFeet.y) / 16;
  // Each hand's palm normal, in the hand bone's own space: the side the thumb
  // sits on, square to the hand's length and its knuckle line.
  const palmLocal = new Map<'l' | 'r', THREE.Vector3>();
  for (const sd of ['l', 'r'] as const) {
    const hand = bones.get(`hand_${sd}`), mid = bones.get(`middle_01_${sd}`), idx = bones.get(`index_01_${sd}`), pk = bones.get(`pinky_01_${sd}`), th = bones.get(`thumb_02_${sd}`);
    if (!hand || !mid || !idx || !pk || !th) continue;
    const dir = wp(mid.name).sub(wp(hand.name)).normalize();
    const across = wp(idx.name).sub(wp(pk.name)).normalize();
    let n = new THREE.Vector3().crossVectors(dir, across).normalize();
    if (n.dot(wp(th.name).sub(wp(hand.name))) < 0) n.negate();
    palmLocal.set(sd, n.applyQuaternion(hand.getWorldQuaternion(new THREE.Quaternion()).invert()));
  }
  const child = (b: THREE.Bone) => b.children.find((c) => (c as THREE.Bone).isBone) as THREE.Bone | undefined;
  const order = [...bones.values()]; // traverse order: parents before children

  /** Turn bone `b` so the direction to its first child is `to` (world). */
  const aimTo = (b: THREE.Bone, to: THREE.Vector3) => {
    const c = child(b);
    if (!c) return;
    const from = c.getWorldPosition(new THREE.Vector3()).sub(b.getWorldPosition(new THREE.Vector3())).normalize();
    const delta = new THREE.Quaternion().setFromUnitVectors(from, to.clone().normalize());
    const world = b.getWorldQuaternion(new THREE.Quaternion()).premultiply(delta);
    b.quaternion.copy((b.parent as THREE.Object3D).getWorldQuaternion(new THREE.Quaternion()).invert().multiply(world));
    b.updateMatrixWorld(true);
  };
  /**
   * Where a hand holds what it grips (world): on a bar, just off the
   * knuckles on the palm side by the bar's radius (inside the curled
   * fingers); on the floor, under the middle of the palm.
   */
  const anchor = (sd: 'l' | 'r'): THREE.Vector3 => {
    const hand = bones.get(`hand_${sd}`)!, mid = bones.get(`middle_01_${sd}`), pl = palmLocal.get(sd);
    if (!mid || !pl) return wp(hand.name);
    const P = pl.clone().applyQuaternion(hand.getWorldQuaternion(new THREE.Quaternion()));
    if (onFloor) return wp(hand.name).lerp(wp(mid.name), 0.5).addScaledVector(P, 0.015);
    return wp(mid.name).addScaledVector(P, barR + 0.02);
  };
  /** Point a hand and face its palm, then curl the fingers toward the palm. */
  const poseHand = (sd: 'l' | 'r', h: NonNullable<PoseSpec['hands']>, frame: THREE.Quaternion) => {
    const hand = bones.get(`hand_${sd}`), mid = bones.get(`middle_01_${sd}`), pl = palmLocal.get(sd);
    if (!hand || !mid || !pl) return;
    const m = (d: Dir): Dir => (sd === 'l' ? d : [-d[0], d[1], d[2]]);
    const D = toModel(m(h.dir)).applyQuaternion(frame);
    const P = toModel(m(h.palm)).applyQuaternion(frame);
    P.addScaledVector(D, -P.dot(D)).normalize();
    // 1) the hand's length onto D
    const Q = hand.getWorldQuaternion(new THREE.Quaternion());
    const cur = wp(mid.name).sub(wp(hand.name)).normalize();
    const q1 = new THREE.Quaternion().setFromUnitVectors(cur, D);
    // 2) then roll about D until the palm faces P
    const palm = pl.clone().applyQuaternion(Q).applyQuaternion(q1);
    palm.addScaledVector(D, -palm.dot(D)).normalize();
    const ang = Math.atan2(new THREE.Vector3().crossVectors(palm, P).dot(D), palm.dot(P));
    const q2 = new THREE.Quaternion().setFromAxisAngle(D, ang);
    const world = Q.clone().premultiply(q1).premultiply(q2);
    hand.quaternion.copy((hand.parent as THREE.Object3D).getWorldQuaternion(new THREE.Quaternion()).invert().multiply(world));
    hand.updateMatrixWorld(true);
    // Fingers: each joint bends further toward the palm.
    for (const f of ['index', 'middle', 'ring', 'pinky']) {
      for (let k = 1; k <= 3; k++) {
        const b = bones.get(`${f}_0${k}_${sd}`);
        if (!b) continue;
        const a = h.curl * k * 0.95;
        aimTo(b, D.clone().multiplyScalar(Math.cos(a)).addScaledVector(P, Math.sin(a)));
      }
    }
    for (let k = 2; k <= 3; k++) {
      const b = bones.get(`thumb_0${k}_${sd}`);
      if (!b) continue;
      const tc = b.children.find((c) => (c as THREE.Bone).isBone);
      if (!tc) continue;
      const cur2 = tc.getWorldPosition(new THREE.Vector3()).sub(b.getWorldPosition(new THREE.Vector3())).normalize();
      aimTo(b, cur2.multiplyScalar(Math.cos(h.curl * 0.5)).addScaledVector(P, Math.sin(h.curl * 0.5)));
    }
  };

  const apply = (pose0: PoseSpec, pitch: number, spread = 0, clearTips = true) => {
    // `spread` pushes both arms outward (x) to reach grips wider than the pose's.
    const pose: PoseSpec = spread ? { ...pose0, aim: { ...pose0.aim } } : pose0;
    if (spread) {
      for (const [bone, d] of Object.entries(pose0.aim)) {
        if (!/^(upperarm|lowerarm)_/.test(bone)) continue;
        const out = bone.endsWith('_l') ? 1 : -1;
        pose.aim[bone] = [d[0] + out * spread, d[1], d[2]];
      }
    }
    restore();
    const bodyFrame = new THREE.Quaternion().setFromAxisAngle(pitchAxis, pitch);
    if (pitch) {
      const pq = new THREE.Quaternion().setFromAxisAngle(pitchAxis, pitch);
      // Pitch about the hips: rotate the root, then put the pelvis back where it was.
      const hip = wp('pelvis');
      root.quaternion.premultiply(pq);
      model.updateMatrixWorld(true);
      root.position.add(hip.sub(wp('pelvis')));
      model.updateMatrixWorld(true);
    }
    for (const b of order) {
      const target = pose.aim[b.name];
      if (!target) continue;
      const c = child(b);
      if (!c) continue;
      const from = c.getWorldPosition(new THREE.Vector3()).sub(b.getWorldPosition(new THREE.Vector3())).normalize();
      const delta = new THREE.Quaternion().setFromUnitVectors(from, toModel(target).applyQuaternion(bodyFrame));
      const world = b.getWorldQuaternion(new THREE.Quaternion()).premultiply(delta);
      const parentWorld = (b.parent as THREE.Object3D).getWorldQuaternion(new THREE.Quaternion());
      b.quaternion.copy(parentWorld.invert().multiply(world));
      b.updateMatrixWorld(true);
    }
    if (pose.hands) for (const sd of ['l', 'r'] as const) poseHand(sd, pose.hands, bodyFrame);
    if (grip === 'stand') {
      // Feet stay planted: the hips drop and push back over them.
      const f = feet();
      root.position.x += restFeet.x - f.x;
      root.position.z += restFeet.z - f.z;
      root.position.y += restFeet.y - f.y;
      // A hop or a sway: the whole body, by a share of its height.
      if (pose.rise || pose.sway) {
        const tall = wp('Head').y - restFeet.y;
        root.position.y += (pose.rise ?? 0) * tall;
        root.position.x += (pose.sway ?? 0) * tall * sx;
      }
      model.updateMatrixWorld(true);
      return;
    }
    if (grip === 'float') {
      // In the water: the hips stay where they are (the pitch turns about them); world.ts floats the body.
      model.updateMatrixWorld(true);
      return;
    }
    if (grip === 'ground') {
      // Sitting on the ground: the seat a hip's depth above the floor, and
      // nothing (feet, shins) below it.
      const low = Math.min(...['foot_l', 'foot_r', 'ball_l', 'ball_r', 'calf_l', 'calf_r'].filter((n) => bones.has(n)).map((n) => wp(n).y));
      root.position.y += Math.max(restFeet.y + backDepth * 1.3 - wp('pelvis').y, restFeet.y + 0.02 - low);
      model.updateMatrixWorld(true);
      return;
    }
    if (grip === 'lie') {
      // On the back: the pelvis rests a back's depth above the bench top.
      root.position.y += gripY + backDepth - wp('pelvis').y;
      model.updateMatrixWorld(true);
      return;
    }
    // Grip: move the body so the bar's centre sits where each hand holds it.
    const y = (anchor('l').y + anchor('r').y) / 2;
    root.position.y += gripY - y;
    if (onFloor && clearTips) {
      // The fingertips, thumb tips and toe tips hang below the palm and the
      // ball of the foot: keep them (and the skin and soles round them) above the floor.
      const tips = [...bones.values()].filter((b) => FLOOR_TIP.test(b.name)).map((b) => wp(b.name).y);
      const low = tips.length ? Math.min(...tips) : Infinity;
      if (low < gripY + FLOOR_SKIN) root.position.y += gripY + FLOOR_SKIN - low;
    }
    if (alignForward) {
      // The bar is straight above (or in front of) the spot: hold it there
      // front-to-back too, so the body swings under it and never through it.
      root.position.z -= (anchor('l').z + anchor('r').z) / 2;
    }
    model.updateMatrixWorld(true);
  };

  /** Push-ups: the pitch that puts toes on the floor when hands are. */
  const solvePitch = (pose: PoseSpec) => {
    let best = 1.4, bestErr = Infinity;
    for (let p = 1.0; p <= 1.62; p += 0.02) {
      apply(pose, p, 0, false);
      const toes = Math.min(wp('ball_l').y, wp('ball_r').y);
      const err = Math.abs(toes - gripY);
      if (err < bestErr) { bestErr = err; best = p; }
    }
    return best;
  };

  const times: number[] = [];
  const qs = new Map<string, number[]>();
  const rootPos: number[] = [];
  for (const k of spec.keys) {
    const pitch = grip === 'floor' ? solvePitch(k.pose) : (k.pose.pitch ?? 0);
    let spread = 0;
    if (gripHalf) {
      // Widen the arms until each palm sits over its bar.
      const half = () => Math.abs(anchor('l').x - anchor('r').x) / 2;
      let lo = -0.4, hi = 2.5;
      for (let i = 0; i < 24; i++) {
        spread = (lo + hi) / 2;
        apply(k.pose, pitch, spread);
        if (half() < gripHalf) lo = spread; else hi = spread;
      }
    }
    apply(k.pose, pitch, spread);
    times.push(k.t);
    for (const r of rest) {
      const arr = qs.get(r.bone.name) ?? [];
      arr.push(r.bone.quaternion.x, r.bone.quaternion.y, r.bone.quaternion.z, r.bone.quaternion.w);
      qs.set(r.bone.name, arr);
    }
    rootPos.push(root.position.x, root.position.y, root.position.z);
  }
  restore();
  const tracks: THREE.KeyframeTrack[] = [];
  for (const [bone, values] of qs) tracks.push(new THREE.QuaternionKeyframeTrack(`${bone}.quaternion`, times, values));
  tracks.push(new THREE.VectorKeyframeTrack(`${root.name}.position`, times, rootPos));
  return new THREE.AnimationClip(name, times[times.length - 1], tracks);
}

/** Repetitions completed after `seconds` of a looping exercise. */
export function repsDone(kind: ExerciseKind, seconds: number): number {
  const keys = EXERCISES[kind].keys;
  return Math.floor(seconds / keys[keys.length - 1].t);
}
