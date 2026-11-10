// Procedural locomotion for a CaptainFigure rig (or a clone of one): idle with breathing and weight shift, walk,
// sneak (crouched, careful steps, arms in), run (long stride, forward lean), crouched hiding, kneeling at a lock,
// kneeling over a comrade, knocked out on the back, sentry and searching head sweeps, carried props (musket shouldered
// or at port arms, a torch raised in the right hand), a quick overhand throw and two reactions (a startled flinch,
// pointing ahead with the right arm). Every state is a target the animator eases toward,
// so changes of state blend smoothly. The step phase advances with the distance travelled and the feet are placed
// by a two-bone leg IK on a footprint cycle whose stance sweep matches that distance: the feet do not slide.
//   const rig = cloneFigure(figure)            -> { group, j } sharing geometry and materials (one skeleton)
//   const a = new GaitAnimator(rig, { scale, seed })     scale = the group's scale (world metres per figure metre)
//   a.update(dt, { speed, dist, gait, pose, look, carry, lookYaw })
//     speed: ground speed (world m/s) · dist: distance travelled this frame (world m)
//     gait: 'walk' | 'sneak' | 'run'          pose: 'stand' | 'hide' | 'work' (kneeling at a lock) | 'kneel' | 'down'
//     look: 'calm' | 'sentry' | 'search'      carry: 'none' | 'musket' | 'port' | 'torch' (torch: right hand, musket on the left shoulder)
//     lookYaw: extra head turn (radians)
//   a.throw()                  quick overhand throw with the right arm
//   a.react(kind)              'flinch' (0.5 s: recoils, arms up) | 'point' (1.5 s: the right arm points ahead)
//   a.handPoint(side, out)     world position of the 'r' / 'l' fist after update (the group's world matrix must be current)
// Figure frame: +Z forward, +Y up, right hand on -X; joint lengths are CaptainFigure's (thigh and shin 0.45 m).
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

const TAU = Math.PI * 2, L = 0.45, LMAX = 0.895;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const frac = x => x - Math.floor(x);
const ease = (cur, tgt, rate, dt) => cur + (tgt - cur) * (1 - Math.exp(-rate * dt));

// a clone of a built figure: shares its geometry and materials; every skinned mesh of the clone uses one skeleton
export function cloneFigure(fig) {
  const group = cloneSkinned(fig.group), j = {};
  let sk = null;
  group.traverse(o => {
    if (o.isBone) j[o.name] = o;
    if (o.isSkinnedMesh) { if (!sk) sk = o.skeleton; else o.skeleton = sk; }
  });
  return { group, j };
}

// gait styles, figure metres. C0 + Ck·v: cycle length (two steps) at speed v, clamped to [Cmin, Cmax]; f: stance share
// of the cycle; lift: swing foot height; crouch: hips drop; lean / chest / pelvis: forward pitch; arm: swing;
// armFwd: arms carried forward; elbow (+elbowSwing when the arm swings forward); ab: arms out from the body;
// headP: head pitch (up < 0); bob: hips bounce; twist: pelvis yaw; sway: pelvis roll; shift: lateral weight shift
const STYLES = {
  walk:  { C0: 0.62, Ck: 0.5, Cmin: 0.8, Cmax: 1.5, f: 0.6, lift: 0.1, crouch: 0.0, lean: 0.05, chest: 0.0, pelvis: 0.02, arm: 0.38, armFwd: 0.04, elbow: 0.22, elbowSwing: 0.3, ab: 0.1, headP: 0, bob: 0.022, twist: 0.13, sway: 0.06, shift: 0.025 },
  sneak: { C0: 0.55, Ck: 0.42, Cmin: 0.8, Cmax: 1.35, f: 0.66, lift: 0.14, crouch: 0.17, lean: 0.3, chest: 0.12, pelvis: 0.14, arm: 0.16, armFwd: 0.4, elbow: 1.05, elbowSwing: 0.15, ab: 0.2, headP: -0.42, bob: 0.012, twist: 0.08, sway: 0.05, shift: 0.035 },
  run:   { C0: 1.0, Ck: 0.48, Cmin: 1.5, Cmax: 2.5, f: 0.36, lift: 0.3, crouch: 0.06, lean: 0.2, chest: 0.08, pelvis: 0.08, arm: 0.72, armFwd: 0.12, elbow: 1.45, elbowSwing: 0.25, ab: 0.14, headP: -0.24, bob: 0.05, twist: 0.2, sway: 0.03, shift: 0.015 },
};
const KEYS = Object.keys(STYLES.walk);
const JOINTS = ['root', 'hips', 'spine', 'chest', 'neck', 'head', 'rShoulder', 'rElbow', 'rWrist', 'lShoulder', 'lElbow', 'lWrist', 'rHip', 'rKnee', 'rAnkle', 'lHip', 'lKnee', 'lAnkle'];

const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion(), _qd = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
const _m = new THREE.Matrix4(), UP = new THREE.Vector3(0, 1, 0);
// props at the chest, in the chest's frame: direction of the musket (butt to muzzle) and where along it the left hand holds it
const SHOULDER_DIR = new THREE.Vector3(0.1, 1, -0.24).normalize(), PORT_DIR = new THREE.Vector3(0.72, 0.72, -0.02).normalize();
const PROP_AT = new THREE.Vector3(0, -0.1, 0.03);   // the prop bone's place in the wrist (CaptainFigure)

export class GaitAnimator {
  constructor(rig, { scale = 1, seed = 1 } = {}) {
    this.j = rig.j; this.group = rig.group; this.scale = scale;
    this.ph = (seed * 0.6180339) % 1 * TAU;   // own rhythm of the idle motions
    this.t = 0; this.phase = (seed * 0.37) % 1;
    // eased state: share of motion, of each gait style, of each pose, look and carry
    this.w = { move: 0, walk: 1, sneak: 0, run: 0, hide: 0, work: 0, kneel: 0, down: 0, sentry: 0, search: 0, musket: 0, port: 0, torch: 0 };
    this.thr = -1;   // time into a throw (-1: none)
    this.rx = { flinch: -1, point: -1 };   // time into a reaction (-1: none)
    this.P = {}; for (const k of JOINTS) this.P[k] = [0, 0, 0];
    this.par = {}; for (const k of KEYS) this.par[k] = STYLES.walk[k];
  }

  throw() { this.thr = 0; }
  react(kind) { if (kind in this.rx) this.rx[kind] = 0; }

  handPoint(side, out) {
    const wr = this.j[side === 'l' ? 'lWrist' : 'rWrist'];
    return out.set(0, -0.1, 0.03).applyMatrix4(wr.matrixWorld);
  }

  update(dt, s = {}) {
    const w = this.w, P = this.P, par = this.par, j = this.j;
    this.t += dt; const t = this.t, ph = this.ph;
    const v = (s.speed || 0) / this.scale, pose = s.pose || 'stand', gait = s.gait || 'walk', carry = s.carry || 'none', look = s.look || 'calm';
    // ---- eased weights ----
    const moving = pose === 'stand' ? clamp(v / 0.22, 0, 1) : 0;
    w.move = ease(w.move, moving, moving > w.move ? 7 : 9, dt);
    for (const g of ['walk', 'sneak', 'run']) w[g] = ease(w[g], gait === g ? 1 : 0, 6, dt);
    const ws = w.walk + w.sneak + w.run || 1;
    for (const k of KEYS) par[k] = (STYLES.walk[k] * w.walk + STYLES.sneak[k] * w.sneak + STYLES.run[k] * w.run) / ws;
    for (const q of ['hide', 'work', 'kneel']) w[q] = ease(w[q], pose === q ? 1 : 0, 7, dt);
    w.down = ease(w.down, pose === 'down' ? 1 : 0, pose === 'down' ? 3.2 : 2, dt);
    w.sentry = ease(w.sentry, look === 'sentry' ? 1 : 0, 3, dt);
    w.search = ease(w.search, look === 'search' ? 1 : 0, 3, dt);
    w.musket = ease(w.musket, carry === 'musket' || carry === 'torch' ? 1 : 0, 6, dt);
    w.port = ease(w.port, carry === 'port' ? 1 : 0, 6, dt);
    w.torch = ease(w.torch, carry === 'torch' ? 1 : 0, 6, dt);
    // ---- the step cycle: phase from the distance travelled ----
    const cyc = st => clamp(st.C0 + st.Ck * v, st.Cmin, st.Cmax);
    const C = (cyc(STYLES.walk) * w.walk + cyc(STYLES.sneak) * w.sneak + cyc(STYLES.run) * w.run) / ws;
    const d = Math.min(1, (s.dist || 0) / this.scale);
    if (pose === 'stand') this.phase = frac(this.phase + d / C);
    const a = w.move, f = par.f, sw = f * C * a, phi = this.phase, cR = Math.cos(TAU * phi);
    // feet: stance sweeps from +sw/2 to -sw/2 under the hip, the swing brings the foot back forward, lifted
    const foot = (p, out) => {
      if (p < f) { const u = p / f; out[0] = sw * (0.5 - u); out[1] = 0; out[2] = a * (-0.15 * (1 - smooth(0, 0.25, u)) + 0.45 * smooth(0.7, 1, u)); }
      else { const u = (p - f) / (1 - f), e = u * u * (3 - 2 * u); out[0] = sw * (-0.5 + e); out[1] = par.lift * a * Math.sin(Math.PI * Math.pow(u, 0.75)); out[2] = a * (0.5 * (1 - u) * (1 - u) - 0.12 * smooth(0.7, 1, u)); }
      return out;
    };
    const fr = foot(phi, this._fr ||= [0, 0, 0]), fl = foot(frac(phi + 0.5), this._fl ||= [0, 0, 0]);
    // standing: weight on the right leg, the left foot a little forward (contrapposto); hiding: one foot forward, one back
    const idle = 1 - a;
    fr[0] += idle * -0.03; fl[0] += idle * 0.09;
    for (const [ft, z] of [[fr, 0.2], [fl, -0.24]]) { ft[0] += (z - ft[0]) * w.hide; ft[1] *= 1 - w.hide; ft[2] *= 1 - w.hide; }
    for (const [ft, z] of [[fr, 0.32], [fl, -0.12]]) { ft[0] += (z - ft[0]) * w.work; ft[1] *= 1 - w.work; ft[2] *= 1 - w.work; }
    for (const [ft, z, r] of [[fr, 0.36, 0], [fl, -0.34, 0.9]]) { ft[0] += (z - ft[0]) * w.kneel; ft[1] *= 1 - w.kneel; ft[2] += (r - ft[2]) * w.kneel; }   // the left knee down, toes bent
    // ---- hips: height (bob, crouch, breathing), pitch, yaw twist, roll sway, lateral weight shift ----
    const breath = Math.sin(t * 1.7 + ph);
    const runBob = (1 - Math.cos(TAU * 2 * (phi - f / 2))) / 2, walkBob = (1 - Math.cos(TAU * 2 * (phi - f / 2))) / 2;
    let hipsY = 0.98 - par.crouch * (0.4 + 0.6 * a) - par.bob * a * (w.run / ws * -runBob + (1 - w.run / ws) * walkBob) + 0.004 * breath * idle;
    hipsY += (0.5 - hipsY) * w.hide; hipsY += (0.6 - hipsY) * w.work; hipsY += (0.5 - hipsY) * w.kneel;
    for (const ft of [fr, fl]) hipsY = Math.min(hipsY, 0.08 + ft[1] + Math.sqrt(Math.max(0, LMAX * LMAX - ft[0] * ft[0])));
    const lookSweep = w.sentry * 0.75 * Math.sin(t * 0.55 + ph) + w.search * (0.95 * Math.sin(t * 1.05 + ph) + 0.3 * Math.sin(t * 2.3 + ph * 2));
    const idleYaw = 0.22 * Math.sin(t * 0.37 + ph) * idle * (1 - w.sentry) * (1 - w.search);
    const hipsPitch = par.pelvis * (0.5 + 0.5 * a) + 0.3 * w.hide + 0.12 * w.work + 0.15 * w.kneel;
    const hipsYaw = par.twist * a * cR, hipsRoll = -par.sway * a * Math.sin(TAU * phi) + 0.035 * idle * (1 - w.hide) * (0.8 + 0.2 * Math.sin(t * 0.3 + ph));
    const rootX = -par.shift * a * Math.sin(TAU * phi) - 0.02 * idle * (1 - w.hide) * (0.8 + 0.2 * Math.sin(t * 0.3 + ph));
    set(P.root, 0, 0, 0);
    set(P.hips, hipsPitch, hipsYaw, hipsRoll);
    // ---- torso and head: forward lean, counter-twist, breathing; the head stays level and looks around ----
    const spineX = par.lean * (0.35 + 0.65 * a) + 0.4 * w.hide + 0.3 * w.work + 0.5 * w.kneel, chestX = par.chest * (0.4 + 0.6 * a) + 0.018 * breath + 0.12 * w.hide;
    const spineY = -hipsYaw * 0.5 + lookSweep * 0.18, chestY = -hipsYaw * 0.6 + lookSweep * 0.22;
    set(P.spine, spineX, spineY, -hipsRoll * 0.6);
    set(P.chest, chestX, chestY, -hipsRoll * 0.4);
    const lean = hipsPitch + spineX + chestX;
    const peek = w.hide * 0.55 * Math.sin(t * 0.5 + ph);
    set(P.neck, -lean * 0.35, 0, 0);
    set(P.head, par.headP * (0.4 + 0.6 * a) - lean * 0.45 + (w.search * 0.12 * Math.sin(t * 0.8 + ph)) + 0.25 * w.work + 0.35 * w.kneel,
      -(hipsYaw + spineY + chestY) + lookSweep * 0.6 + idleYaw + peek + (s.lookYaw || 0), 0);
    // ---- arms: counter-swing to the legs ----
    const arm = par.arm * a * (1 - 0.6 * w.port);
    set(P.rShoulder, -par.armFwd + arm * cR + 0.03 * breath * idle, 0, -par.ab);
    set(P.lShoulder, -par.armFwd - arm * cR + 0.03 * breath * idle, 0, par.ab);
    set(P.rElbow, -(par.elbow + par.elbowSwing * a * Math.max(0, -cR)), 0, 0);
    set(P.lElbow, -(par.elbow + par.elbowSwing * a * Math.max(0, cR)), 0, 0);
    set(P.rWrist, 0, 0, 0); set(P.lWrist, 0, 0, 0);
    // hiding: forearms on the knees, braced; at a lock: both hands forward, working
    if (w.hide > 0) { mix(P.rShoulder, w.hide, -0.95, 0, -0.25); mix(P.rElbow, w.hide, -1.35, 0, 0); mix(P.lShoulder, w.hide, -0.55, 0, 0.32); mix(P.lElbow, w.hide, -1.25, 0, 0); }
    if (w.work > 0) {
      const jig = 0.06 * Math.sin(t * 13 + ph);
      mix(P.rShoulder, w.work, -1.0 + jig, 0, 0.18); mix(P.rElbow, w.work, -1.05, 0, 0); mix(P.lShoulder, w.work, -0.95, 0, -0.16); mix(P.lElbow, w.work, -1.15 - jig, 0, 0);
    }
    // carried: musket at the shoulder (left), at port arms (both hands), torch raised (right)
    const sm = w.musket * (1 - w.port);
    if (sm > 0) { mix(P.lShoulder, sm, -0.12 - arm * 0.25 * cR, 0, 0.14); mix(P.lElbow, sm, -1.6, 0, 0); mix(P.lWrist, sm, 0, 0, 0.1); }
    if (w.port > 0) {
      const b = 0.06 * a * Math.sin(TAU * 2 * phi);
      mix(P.lShoulder, w.port, -0.95 + b, 0.1, 0.02); mix(P.lElbow, w.port, -1.1, 0, 0);
      mix(P.rShoulder, w.port * (1 - w.torch), -0.5 + b, 0, 0.42); mix(P.rElbow, w.port * (1 - w.torch), -1.45, 0, 0);
    }
    if (w.torch > 0) { const b = 0.08 * a * Math.sin(TAU * 2 * phi); mix(P.rShoulder, w.torch, -2.25 + b + lean * 0.4, 0, -0.32); mix(P.rElbow, w.torch, -0.5, 0, 0); }
    // throw: wind back, whip over, follow through (0.5 s)
    if (this.thr >= 0) {
      const u = this.thr / 0.5; this.thr += dt; if (this.thr > 0.5) this.thr = -1;
      const k = smooth(0, 0.15, u) * (1 - smooth(0.75, 1, u));
      const shx = u < 0.36 ? 0.8 * smooth(0, 0.36, u) : u < 0.62 ? 0.8 - 2.9 * smooth(0.36, 0.62, u) : -2.1 + 1.0 * smooth(0.62, 1, u);
      const elx = u < 0.36 ? -1.7 : -1.7 + 1.5 * smooth(0.36, 0.6, u);
      mix(P.rShoulder, k, shx, 0, -0.45); mix(P.rElbow, k, elx, 0, 0);
      P.chest[1] += k * (u < 0.4 ? 0.35 : 0.35 - 0.8 * smooth(0.4, 0.7, u));
    }
    // kneeling over a comrade: the right hand reaches down to him, the left forearm on the knee
    if (w.kneel > 0) { mix(P.rShoulder, w.kneel, -0.85, 0, -0.1); mix(P.rElbow, w.kneel, -0.25, 0, 0); mix(P.lShoulder, w.kneel, -0.5, 0, 0.2); mix(P.lElbow, w.kneel, -1.2, 0, 0); }
    // reactions: a startled recoil (arms up, leaning back), pointing ahead with the right arm
    const rx = this.rx;
    if (rx.flinch >= 0) {
      const u = rx.flinch / 0.5; rx.flinch += dt; if (rx.flinch > 0.5) rx.flinch = -1;
      const k = smooth(0, 0.12, u) * (1 - smooth(0.45, 1, u));
      P.chest[0] -= 0.35 * k; P.spine[0] -= 0.15 * k; P.head[0] -= 0.25 * k; hipsY -= 0.04 * k;
      mix(P.rShoulder, k * 0.8, -1.3, 0, -0.4); mix(P.rElbow, k * 0.8, -1.7, 0, 0); mix(P.lShoulder, k * 0.6, -1.1, 0, 0.4); mix(P.lElbow, k * 0.6, -1.6, 0, 0);
    }
    if (rx.point >= 0) {
      const u = rx.point / 1.5; rx.point += dt; if (rx.point > 1.5) rx.point = -1;
      const k = smooth(0, 0.12, u) * (1 - smooth(0.8, 1, u)), jab = 0.08 * Math.sin(rx.point * 14) * (1 - u);
      mix(P.rShoulder, k, -1.5 + jab, 0, -0.12); mix(P.rElbow, k, -0.08, 0, 0); P.chest[1] += 0.2 * k; P.head[0] -= 0.1 * k;
    }
    // ---- knocked out: falls on his back, arms flung out, head to the side ----
    let rootRx = 0, rootY = 0;
    if (w.down > 0.001) {
      const k = w.down, kf = k * k * (3 - 2 * k);
      rootRx = -Math.PI / 2 * kf; rootY = 0.13 * kf;
      mix(P.hips, k, 0, 0, 0); mix(P.spine, k, -0.05, 0, 0); mix(P.chest, k, 0, 0, 0); mix(P.neck, k, 0, 0, 0); mix(P.head, k, -0.2, 0.75, 0.1);
      mix(P.rShoulder, k, -0.3, 0, -1.25); mix(P.rElbow, k, -0.5, 0, 0); mix(P.lShoulder, k, 0.25, 0, 0.95); mix(P.lElbow, k, -0.9, 0, 0);
      hipsY += (0.98 - hipsY) * k;
    }
    // ---- legs: two-bone IK onto the feet (blended toward the lying pose when knocked out) ----
    const kd = w.down;
    this._leg(j.rHip, j.rKnee, j.rAnkle, fr, hipsY, hipsPitch, hipsRoll, -0.03 - 0.06 * w.hide, -0.08, kd, [-0.15, -0.2, -0.16, 0.35]);
    this._leg(j.lHip, j.lKnee, j.lAnkle, fl, hipsY, hipsPitch, hipsRoll, 0.03 + 0.08 * w.hide, 0.08, kd, [-0.55, 0.1, 0.22, 1.0]);
    // ---- write the joints ----
    for (const k of JOINTS) { if (k === 'rHip' || k === 'rKnee' || k === 'rAnkle' || k === 'lHip' || k === 'lKnee' || k === 'lAnkle') continue; const q = P[k]; j[k].rotation.set(q[0], q[1], q[2]); }
    j.root.rotation.x = rootRx; j.root.position.set(rootX * (1 - kd), rootY, 0);
    j.hips.position.y = hipsY;
    // the musket turns in the hand: shouldered or across the chest, given in the chest's frame
    if (j.prop) this._prop(w.musket + w.port > 0.01);
  }

  // thigh, shin and foot onto a footprint (z forward of the hip, y lift, foot pitch); kd blends toward a lying pose
  // [hip x, hip z, knee extra, ankle]
  _leg(hip, knee, ank, ft, hipsY, hipsPitch, hipsRoll, splay, toeOut, kd, lie) {
    const dy = 0.06 + ft[1] - (hipsY - 0.02), dz = ft[0];
    const D = clamp(Math.hypot(dz, dy), 0.12, LMAX);
    const aa = Math.atan2(-dz, -dy), beta = Math.acos(clamp(D / (2 * L), -1, 1)), k = Math.PI - Math.acos(clamp((2 * L * L - D * D) / (2 * L * L), -1, 1));
    const hx = aa - beta - hipsPitch, ax = -(aa - beta + k) + ft[2];
    hip.rotation.set(hx + (lie[0] - hx) * kd, toeOut, splay - hipsRoll + (lie[1] - splay + hipsRoll) * kd);
    knee.rotation.set(k + (lie[2] - k) * kd, 0, 0);
    ank.rotation.set(ax + (lie[3] - ax) * kd, 0, 0);
  }

  _prop(on) {
    const j = this.j, w = this.w, pr = j.prop;
    if (!on) { pr.quaternion.identity(); pr.position.copy(PROP_AT); return; }
    this.group.updateMatrixWorld(true);
    _m.copy(j.chest.matrixWorld).decompose(_p, _qa, _s);
    _m.copy(j.lWrist.matrixWorld).decompose(_p, _qb, _s);
    // the musket's axis (+Y): shouldered or at port arms; its +Z (the lock side) toward the chest's front
    const kp = w.port / (w.musket + w.port);
    _v.copy(SHOULDER_DIR).lerp(PORT_DIR, kp).normalize();
    _qd.setFromUnitVectors(UP, _v);
    _qd.premultiply(_qa);                                  // chest frame -> world
    pr.quaternion.copy(_qb).invert().multiply(_qd);        // world -> wrist frame
    // slide it along its axis so the hand holds the butt (shouldered) or the fore-stock (port arms)
    const slide = 0.04 + 0.58 * kp;
    _v.applyQuaternion(_qa).applyQuaternion(_qd.copy(_qb).invert()).multiplyScalar(-slide);
    pr.position.copy(PROP_AT).add(_v);
    pr.updateMatrixWorld(true);
  }
}
function set(q, x, y, z) { q[0] = x; q[1] = y; q[2] = z; }
function mix(q, k, x, y, z) { q[0] += (x - q[0]) * k; q[1] += (y - q[1]) * k; q[2] += (z - q[2]) * k; }
