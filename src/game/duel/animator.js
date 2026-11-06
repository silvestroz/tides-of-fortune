// Procedural fencing animation for a CaptainFigure: body Euler poses + 2-bone IK for both arms and legs,
// sabre aligned by blade/edge directions. Everything is specified in the figure's local frame
// (+Z forward, +Y up, right hand on -X, feet at y=0, unscaled metres).
import * as THREE from 'three';

const _S = new THREE.Vector3(), _T = new THREE.Vector3(), _E = new THREE.Vector3(), _d = new THREE.Vector3(), _p = new THREE.Vector3();
const _q = new THREE.Quaternion(), _qp = new THREE.Quaternion(), _m = new THREE.Matrix4();
const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3(), _tmp = new THREE.Vector3();
const _fwd = new THREE.Vector3(), _up = new THREE.Vector3();
const ease = k => k * k * (3 - 2 * k);
const easeOut = k => 1 - (1 - k) * (1 - k);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const v3 = (x, y, z) => new THREE.Vector3(x, y, z);

// bone world orientation: local -Y along `dir` (world), local +Z as close as possible to `ref` (world)
function setBoneWorld(bone, dir, ref) {
  _y.copy(dir).normalize().negate();
  _z.copy(ref).addScaledVector(_y, -ref.dot(_y));
  if (_z.lengthSq() < 1e-6) { _z.set(0, 0, 1).addScaledVector(_y, -_y.z); if (_z.lengthSq() < 1e-6) _z.set(1, 0, 0); }
  _z.normalize(); _x.crossVectors(_y, _z);
  _m.makeBasis(_x, _y, _z); _q.setFromRotationMatrix(_m);
  bone.parent.getWorldQuaternion(_qp).invert();
  bone.quaternion.copy(_qp.multiply(_q));
  bone.updateMatrixWorld(true);
}
// bone world orientation from explicit basis: +Z = zdir, +Y ≈ ydir
function setBoneBasis(bone, zdir, ydir) {
  _z.copy(zdir).normalize();
  _y.copy(ydir).addScaledVector(_z, -ydir.dot(_z));
  if (_y.lengthSq() < 1e-6) _y.set(0, 1, 0).addScaledVector(_z, -_z.y);
  _y.normalize(); _x.crossVectors(_y, _z);
  _m.makeBasis(_x, _y, _z); _q.setFromRotationMatrix(_m);
  bone.parent.getWorldQuaternion(_qp).invert();
  bone.quaternion.copy(_qp.multiply(_q));
  bone.updateMatrixWorld(true);
}
function ik(a, b, target, pole, L1, L2, ref) {
  a.getWorldPosition(_S);
  _d.subVectors(target, _S);
  const dist = clamp(_d.length(), Math.abs(L1 - L2) + 1e-3, (L1 + L2) * 0.999);
  _d.normalize();
  const A = (L1 * L1 - L2 * L2 + dist * dist) / (2 * dist), h = Math.sqrt(Math.max(0, L1 * L1 - A * A));
  _p.copy(pole).addScaledVector(_d, -pole.dot(_d));
  if (_p.lengthSq() < 1e-6) _p.set(0, -1, 0); _p.normalize();
  _E.copy(_S).addScaledVector(_d, A).addScaledVector(_p, h);
  _T.copy(_S).addScaledVector(_d, dist);
  _tmp.subVectors(_E, _S); setBoneWorld(a, _tmp, ref);
  _tmp.subVectors(_T, _E); setBoneWorld(b, _tmp, ref);
}

// ---------------------------------------------------------------- key poses (figure-local)
// hand = grip position, dir = blade direction, edge = cutting edge direction
const P = {
  guard:   { hand: v3(-0.18, 1.14, 0.44), dir: v3(0.1, 0.42, 1), edge: v3(0, -1, 0.3) },
  // parries: three silhouettes — blade flat overhead / blade upright at the flank / point dropped to the deck
  pHigh:   { hand: v3(-0.12, 1.84, 0.34), dir: v3(1, 0.16, 0.22), edge: v3(0, 1, 0.15) },
  pMid:    { hand: v3(-0.36, 1.2, 0.4), dir: v3(0.05, 1, 0.18), edge: v3(-0.2, 0, 1) },
  pLow:    { hand: v3(-0.34, 0.88, 0.4), dir: v3(0.22, -1, 0.34), edge: v3(-0.1, 0, 1) },
  // wind-ups (tells): over the shoulder / chambered back at the hip / dropped low behind the knee
  wHigh:   { hand: v3(-0.22, 2.02, -0.16), dir: v3(0.2, 0.5, -1), edge: v3(0, 0.6, 0.2) },
  sHigh:   { hand: v3(0.0, 1.36, 0.8), dir: v3(0.25, -0.6, 0.9), edge: v3(0, -1, 0.2) },
  wMid:    { hand: v3(-0.64, 1.3, -0.22), dir: v3(-0.8, 0.12, -0.55), edge: v3(0.6, 0, 0.5) },
  sMid:    { hand: v3(0.16, 1.22, 0.78), dir: v3(0.8, 0.04, 0.62), edge: v3(0.4, 0, -1) },
  wLow:    { hand: v3(-0.5, 0.82, -0.14), dir: v3(-0.3, -0.75, -0.6), edge: v3(0.4, -0.3, 0.6) },
  sLow:    { hand: v3(0.08, 0.76, 0.74), dir: v3(0.5, -0.45, 0.8), edge: v3(0.5, 0.2, -0.6) },
  taunt:   { hand: v3(-0.38, 1.8, 0.12), dir: v3(-0.1, 1, 0.12), edge: v3(0, 0, 1) },
  victory: { hand: v3(-0.24, 2.1, 0.1), dir: v3(0.05, 1, 0.25), edge: v3(0, 0, 1) },
  down:    { hand: v3(-0.42, 0.42, 0.25), dir: v3(-0.4, -0.2, 0.9), edge: v3(0, -1, 0) },
  hurt:    { hand: v3(-0.42, 1.0, 0.18), dir: v3(-0.3, 0.4, 0.9), edge: v3(0, -1, 0) },
  cheer:   { hand: v3(-0.28, 1.95, 0.15), dir: v3(0, 1, 0.3), edge: v3(0, 0, 1) },
  rest:    { hand: v3(-0.28, 0.86, 0.12), dir: v3(0, -0.4, 1), edge: v3(0, -1, 0) },
  // more crowd attitudes — hands on the hips, pointing at the fight, a hand cupped to shout
  akimbo:  { hand: v3(-0.27, 1.02, -0.02), dir: v3(0.6, -0.2, -0.5), edge: v3(0, -1, 0) },
  point:   { hand: v3(-0.24, 1.46, 0.6), dir: v3(0.1, 0.12, 1), edge: v3(0, 1, 0) },
  shout:   { hand: v3(-0.1, 1.66, 0.26), dir: v3(0.6, 0.6, 0.3), edge: v3(0, 0, 1) },
};
for (const k in P) { P[k].dir.normalize(); P[k].edge.normalize(); }
export const POSES = P;

const WIND = { high: 'wHigh', mid: 'wMid', low: 'wLow' }, STRIKE = { high: 'sHigh', mid: 'sMid', low: 'sLow' }, PARRY = { high: 'pHigh', mid: 'pMid', low: 'pLow' };

function mixHand(out, a, b, k) {
  out.hand.lerpVectors(a.hand, b.hand, k);
  out.dir.lerpVectors(a.dir, b.dir, k).normalize();
  out.edge.lerpVectors(a.edge, b.edge, k).normalize();
  return out;
}
const mkH = () => ({ hand: new THREE.Vector3(), dir: new THREE.Vector3(), edge: new THREE.Vector3() });

// ---------------------------------------------------------------- animator
export class FencerAnimator {
  constructor(fig, { lefty = false } = {}) {
    this.fig = fig; this.j = fig.j;
    this.h = mkH(); this._h2 = mkH(); this._tgt = mkH();
    this.cur = mkH(); mixHand(this.cur, P.guard, P.guard, 0);
    this.body = { lunge: 0, crouch: 0.06, twist: 0, lean: 0, side: 0, headYaw: 0, headPitch: 0, hipsDrop: 0, back: 0, kneel: 0, rise: 0, slide: 0 };
    this.bodyS = { ...this.body };
    this.feet = { rz: 0.3, lz: -0.3, lift: 0, liftSide: 0 };
    this.left = { hand: v3(0.32, 1.12, -0.18) };
    this.leftS = v3(0.32, 1.12, -0.18);
    this.vel = 9;    // hand smoothing speed
    this.t = 0;
    this.lefty = lefty;
    this.swingK = 0;
    this.bodySnap = 12;
    this.stance = 1;   // 1 = fencer's guard (wide, knees bent); crowd figures set 0
    this.coat = { a: 0, v: 0, b: 0, vb: 0, px: null, pz: null };   // coat-tail spring (secondary motion)
  }

  // drive from a sim Fighter state. f: Fighter, dt real seconds
  fromFighter(f, dt, extra = {}) {
    this.t += dt;
    const t = this.t, b = this.body;
    const k = f.dur > 0 ? clamp(f.t / f.dur, 0, 1) : 0;
    let tgt = this._tgt;
    let snap = 10;
    this.bodySnap = 12;
    b.lunge = 0; b.crouch = 0.2 + Math.sin(t * 2.1) * 0.018; b.twist = 0.12; b.lean = 0.1; b.side = 0; b.headYaw = 0.1; b.headPitch = 0; b.hipsDrop = 0; b.back = 0; b.kneel = 0; b.rise = 0; b.slide = 0;
    this.feet.lift = 0;
    let left = this.left.hand.set(0.34, 1.14 + Math.sin(t * 1.6) * 0.02, -0.22);
    this.swingK = 0;
    const idleBob = Math.sin(t * 2.6) * 0.025;
    switch (f.state) {
      case 'idle':
        mixHand(tgt, P.guard, P.guard, 0); tgt.hand.y += idleBob; tgt.hand.x += Math.sin(t * 1.3) * 0.03;
        snap = 7; break;
      case 'parry': {
        const pk = PARRY[f.height];
        mixHand(tgt, P[pk], P[pk], 0); snap = 26; this.bodySnap = 22;
        const ph = f.height;
        b.crouch = ph === 'low' ? 0.36 : ph === 'high' ? 0.15 : 0.22;
        b.twist = ph === 'mid' ? 0.4 : 0.2; b.lean = ph === 'high' ? -0.08 : ph === 'low' ? 0.22 : 0.06;
        b.back = 0.05; b.headPitch = ph === 'high' ? -0.2 : ph === 'low' ? 0.2 : 0;
        if (ph === 'high') left.set(0.3, 1.3, 0.1);
        else if (ph === 'low') left.set(0.5, 1.0, -0.2);
        break;
      }
      case 'windup': {
        const w = P[WIND[f.height]];
        // the tell: the whole body loads up in a height-specific silhouette, readable from the first ~0.1 s
        const ke = easeOut(clamp(k * 1.35, 0, 1)); this.bodySnap = 20;
        mixHand(tgt, P.guard, w, ke); snap = 22;
        b.back = 0.12 * ke; b.headYaw = 0.1 - 0.3 * ke;
        if (f.height === 'high') { b.crouch = 0.2 - 0.1 * ke; b.lean = -0.28 * ke; b.twist = 0.12 + 0.55 * ke; b.headPitch = -0.12 * ke; left.set(0.4, 1.3 + 0.3 * ke, 0.35); }
        else if (f.height === 'mid') { b.crouch = 0.26 + 0.04 * ke; b.lean = 0.02; b.twist = 0.12 + 1.05 * ke; left.set(0.5, 1.2 + 0.1 * ke, 0.4); }
        else { b.crouch = 0.2 + 0.22 * ke; b.lean = 0.26 * ke; b.twist = 0.12 + 0.75 * ke; b.headPitch = 0.1 * ke; left.set(0.55, 1.15, 0.3); }
        break;
      }
      case 'strike': {
        const w = P[WIND[f.height]], s = P[STRIKE[f.height]];
        // lunge: front foot shoots forward, back leg straightens, hips drop, off-hand flung back for balance
        mixHand(tgt, w, s, ease(k)); snap = 60; this.swingK = 1; this.bodySnap = 30;
        const lo = f.height === 'low';
        b.twist = 0.9 - 1.6 * easeOut(k); b.lunge = 0.4 + 0.08 * Math.sin(k * Math.PI); b.lean = lo ? 0.36 : 0.26; b.crouch = lo ? 0.34 : 0.28; b.headYaw = -0.3 + 0.3 * k;
        left.set(0.42, 1.2, -0.55);
        break;
      }
      case 'recover': {
        const s = P[STRIKE[f.height]];
        const rk = ease(clamp((k - 0.25) / 0.75, 0, 1));   // hold the lunge a beat, then push back to guard
        mixHand(tgt, s, P.guard, ease(k)); snap = 10; this.swingK = 1 - k; this.bodySnap = 16;
        b.twist = -0.7 + 0.82 * rk; b.lunge = 0.4 * (1 - rk); b.lean = 0.1 + 0.2 * (1 - rk); b.crouch = 0.2 + 0.08 * (1 - rk);
        left.set(0.42, 1.2 - 0.06 * rk, -0.55 + 0.33 * rk);
        break;
      }
      case 'hit': {
        const a = Math.sin(k * Math.PI);
        mixHand(tgt, P.hurt, P.guard, ease(k)); snap = 14;
        b.lean = -0.32 * a; b.back = 0.22 * a; b.twist = 0.5 * a; b.headPitch = -0.35 * a; b.crouch = 0.12 + 0.08 * a;
        left.set(0.2, 1.3, 0.15);
        break;
      }
      case 'stagger': {
        const a = Math.sin(k * Math.PI), wob = Math.sin(k * 18) * (1 - k);
        const s = P[STRIKE[f.height]];
        mixHand(tgt, P.wMid, P.guard, ease(k)); tgt.hand.x -= 0.22 * a; tgt.hand.y += 0.25 * a;
        void s; snap = 12;
        b.lean = -0.22 * a; b.back = 0.28 * a; b.side = 0.08 * wob; b.twist = 0.7 * a; b.headPitch = -0.2 * a; b.crouch = 0.06;
        left.set(0.62, 1.32 + 0.1 * a, -0.15);
        break;
      }
      case 'step': {
        mixHand(tgt, P.guard, P.guard, 0); snap = 9;
        const dir = f.stepDir;
        this.feet.lift = Math.sin(k * Math.PI); this.feet.liftSide = dir > 0 ? 1 : -1;
        b.crouch = 0.2 + 0.04 * Math.sin(k * Math.PI); b.lean = 0.1 + 0.08 * dir;
        break;
      }
      case 'dodge': {
        // esquive: hop back / sidestep out of the line / jump over a low cut / duck under a high one
        const a = Math.sin(clamp(k * 1.15, 0, 1) * Math.PI), kind = f.dodgeKind;
        this.bodySnap = 30; snap = 20;
        if (kind === 'jump') {
          mixHand(tgt, P.guard, P.pHigh, a * 0.5); b.rise = 0.42 * a; b.crouch = 0.12 + 0.2 * a; b.lean = 0.12; b.headPitch = 0.15 * a;
          left.set(0.55, 1.5 + 0.2 * a, 0.0);
        } else if (kind === 'duck') {
          mixHand(tgt, P.guard, P.pLow, a * 0.6); b.crouch = 0.2 + 0.36 * a; b.lean = 0.2 + 0.42 * a; b.headPitch = 0.3 * a; b.twist = 0.3 * a;
          left.set(0.5, 0.8, 0.2);
        } else if (kind === 'side') {
          mixHand(tgt, P.guard, P.pMid, a * 0.4); b.slide = 0.42 * a; b.side = -0.16 * a; b.crouch = 0.28; b.twist = 0.5 * a; b.lean = 0.05;
          this.feet.lift = a; this.feet.liftSide = 1; left.set(0.6, 1.25, -0.1);
        } else {
          mixHand(tgt, P.guard, P.pMid, a * 0.3); b.back = 0.3 * a; b.lean = -0.18 * a; b.crouch = 0.26; b.rise = 0.08 * a;
          this.feet.lift = a; this.feet.liftSide = -1; left.set(0.6, 1.3, -0.3);
        }
        break;
      }
      case 'taunt': {
        const a = Math.sin(clamp(k * 1.25, 0, 1) * Math.PI);
        mixHand(tgt, P.guard, P.taunt, a); snap = 8;
        // twirl the point in a little circle while posturing
        tgt.dir.x += Math.sin(t * 9) * 0.25 * a; tgt.dir.z += Math.cos(t * 9) * 0.25 * a; tgt.dir.normalize();
        b.lean = -0.2 * a; b.crouch = 0.02; b.twist = -0.15 * a; b.headPitch = -0.15 * a; b.headYaw = 0.25 * a;
        left.set(0.42 + 0.1 * Math.sin(t * 6) * a, 1.15 + 0.55 * a, 0.35 * a);    // beckoning hand
        break;
      }
      case 'down': {
        const a = easeOut(clamp(f.t / 0.9, 0, 1));
        mixHand(tgt, P.hurt, P.down, a); snap = 6;
        b.kneel = a; b.lean = 0.45 * a; b.back = 0.2 * a; b.headPitch = 0.5 * a; b.twist = 0.15;
        left.set(0.3, 0.45 + 0.4 * (1 - a), 0.35);
        break;
      }
      case 'victory': {
        const a = easeOut(clamp(f.t / 0.7, 0, 1));
        mixHand(tgt, P.guard, P.victory, a); snap = 8;
        b.lean = -0.12 * a; b.crouch = 0.02; b.headPitch = -0.2 * a; b.twist = 0;
        left.set(0.45, 1.05, 0.0);
        break;
      }
    }
    if (extra.pressure) b.lean -= extra.pressure * 0.05;
    this._apply(tgt, snap, dt);
  }

  // crowd / generic pose by name with optional oscillation
  fromPose(name, dt, { bob = 0, leftHand = null, crouch = 0.03, twist = 0, lean = 0, lunge = 0, kneel = 0 } = {}) {
    this.t += dt;
    const tgt = mixHand(this._tgt, P[name], P[name], 0);
    tgt.hand.y += bob;
    const b = this.body;
    this.stance = 0; this.bodySnap = 12;
    Object.assign(b, { lunge, crouch, twist, lean, side: 0, headYaw: 0, headPitch: -0.1, hipsDrop: 0, back: 0, kneel });
    this.feet.lift = 0;
    if (leftHand) this.left.hand.copy(leftHand); else this.left.hand.set(0.3, 0.9, 0.05);
    this._apply(tgt, 10, dt);
  }

  _apply(tgt, snap, dt) {
    const fig = this.fig, j = this.j, b = this.body, bs = this.bodyS;
    const kH = dt > 0 ? 1 - Math.exp(-snap * dt) : 1, kB = dt > 0 ? 1 - Math.exp(-this.bodySnap * dt) : 1;
    mixHand(this.cur, this.cur, tgt, kH);
    for (const key in b) bs[key] += (b[key] - bs[key]) * kB;
    this.leftS.lerp(this.left.hand, kB);

    // ---- body ----
    const sign = this.lefty ? -1 : 1;
    const kneel = bs.kneel;
    j.root.position.set(sign * bs.slide, bs.rise, bs.lunge * 0.6 - bs.back);
    j.hips.position.y = 0.98 - bs.crouch - kneel * 0.42;
    j.hips.rotation.set(0.05 + kneel * 0.1, sign * (0.35 + bs.twist * 0.4), bs.side);
    j.spine.rotation.set(bs.lean * 0.5 + 0.04, sign * bs.twist * 0.5, -sign * bs.twist * 0.04);
    j.chest.rotation.set(bs.lean * 0.5, sign * bs.twist * 0.48, -bs.side * 0.5 - sign * bs.twist * 0.05);
    j.neck.rotation.set(bs.headPitch * 0.4, -sign * (0.35 + bs.twist * 0.8) * 0.5 + bs.headYaw * 0.5, 0);
    j.head.rotation.set(bs.headPitch * 0.6 - bs.lean * 0.5, -sign * (0.35 + bs.twist * 0.8) * 0.5 + bs.headYaw * 0.5, 0);
    if (j.skirt) j.skirt.rotation.set(-bs.lean * 0.6 + bs.lunge * 0.5 + Math.sin(this.t * 3.1) * 0.03, 0, 0);
    if (j.tailL || j.tailR) {
      // coat tails: a damped spring driven by the figure's motion (steps, lunges, jumps) + a sea-breeze flutter
      const cs = this.coat, gp = fig.group.position;
      const mv = cs.px === null || !(dt > 0) ? 0 : ((gp.x - cs.px) * Math.sin(fig.group.rotation.y) + (gp.z - cs.pz) * Math.cos(fig.group.rotation.y)) / dt;
      cs.px = gp.x; cs.pz = gp.z;
      const drive = clamp(mv * 0.35, -0.8, 0.8) + bs.lunge * 0.9 + bs.rise * 1.6 + bs.back * 0.8 + Math.abs(bs.slide) * 0.8;
      if (dt > 0) { const sdt = Math.min(dt, 0.05); cs.v += ((drive - cs.a) * 60 - cs.v * 9) * sdt; cs.a += cs.v * sdt; }
      const fl = Math.sin(this.t * 5.3) * 0.04 + Math.sin(this.t * 8.9 + 1) * 0.025;
      const base = -bs.lean * 0.6 + bs.lunge * 0.3;
      if (j.tailL) j.tailL.rotation.set(base + clamp(cs.a, -0.3, 1.1) * 0.55 + fl, 0, 0.1 * clamp(cs.a, 0, 1));
      if (j.tailR) j.tailR.rotation.set(base + clamp(cs.a, -0.3, 1.1) * 0.5 - fl * 0.8, 0, -0.1 * clamp(cs.a, 0, 1));
    }
    fig.group.updateMatrixWorld(true);

    const s = fig.group.getWorldScale(_tmp).x;
    fig.group.getWorldDirection(_fwd);   // +Z of the group in world
    _up.set(0, 1, 0).transformDirection(fig.group.matrixWorld);

    // ---- right arm IK to grip target ----
    const c = this.cur;
    const gripW = _T.copy(c.hand); gripW.x *= sign; gripW.z += bs.lunge * 0.75 - bs.back * 0.8;
    gripW.y -= kneel * 0.15;
    fig.group.localToWorld(gripW);
    const dirW = _d.copy(c.dir); dirW.x *= sign; dirW.transformDirection(fig.group.matrixWorld);
    const edgeW = _E.copy(c.edge); edgeW.x *= sign; edgeW.transformDirection(fig.group.matrixWorld);
    const dirC = dirW.clone(), edgeC = edgeW.clone();
    // wrist target: grip offset (0,-0.085,0.02) expressed in the desired wrist basis
    _z.copy(dirC).normalize(); _y.copy(edgeC).negate().addScaledVector(_z, edgeC.dot(_z)).normalize(); _x.crossVectors(_y, _z);
    const wristT = gripW.clone().addScaledVector(_y, 0.085 * s).addScaledVector(_z, -0.02 * s);
    const poleR = new THREE.Vector3(-0.6 * sign, -0.7, -0.2).transformDirection(fig.group.matrixWorld);
    const L_ = this.lefty;
    ik(L_ ? j.lShoulder : j.rShoulder, L_ ? j.lElbow : j.rElbow, wristT, poleR, 0.29 * s, 0.26 * s, _fwd);
    setBoneBasis(L_ ? j.lWrist : j.rWrist, dirC, edgeC.clone().negate());

    // ---- left arm ----
    const lT = _p.copy(this.leftS); lT.x *= sign; lT.z += bs.lunge * 0.3; lT.y -= kneel * 0.3;
    fig.group.localToWorld(lT);
    const poleL = new THREE.Vector3(0.7 * sign, -0.5, -0.4).transformDirection(fig.group.matrixWorld);
    ik(L_ ? j.rShoulder : j.lShoulder, L_ ? j.rElbow : j.lElbow, lT.clone(), poleL, 0.29 * s, 0.25 * s, _fwd);
    setBoneBasis(L_ ? j.rWrist : j.lWrist, _fwd.clone().addScaledVector(_up, -0.3), _fwd.clone().negate().addScaledVector(_up, 0.5));

    // ---- legs ----
    const f = this.feet;
    const lift = f.lift * 0.12;
    const kneelZ = kneel * 0.25;
    const st = this.stance;
    const rFoot = v3((-0.13 - 0.04 * st) * sign + sign * bs.slide, 0.07 + bs.rise + (f.liftSide > 0 ? lift : 0), 0.32 + 0.12 * st + bs.lunge * 1.1 - bs.back * 0.3 - kneelZ * 0.2);
    const lFoot = v3((0.15 + 0.05 * st) * sign + sign * bs.slide, 0.07 + bs.rise + (f.liftSide < 0 ? lift : 0), -0.3 - 0.1 * st - bs.back * 0.9 + kneelZ * 0.3);
    if (kneel > 0.01) lFoot.y = 0.07 + kneel * 0.08;
    const pole = _fwd.clone();
    for (const [hip, knee, ankle, foot, yaw] of (L_ ? [[j.lHip, j.lKnee, j.lAnkle, rFoot, 0.1 * sign], [j.rHip, j.rKnee, j.rAnkle, lFoot, 0.9 * sign]] : [[j.rHip, j.rKnee, j.rAnkle, rFoot, 0.1 * sign], [j.lHip, j.lKnee, j.lAnkle, lFoot, 0.9 * sign]])) {
      fig.group.localToWorld(foot);
      // knee pole: forward and slightly out
      ik(hip, knee, foot, pole.clone().addScaledVector(_up, 0.05), 0.45 * s, 0.45 * s, _fwd);
      const fy = _fwd.clone().applyAxisAngle(_up, yaw);
      setBoneBasis(ankle, fy, _up);
    }

    // ---- coat tails clear the legs: in a lunge the back thigh used to pierce the frock and the front one,
    // swung sideways by the hip twist, cut through the tail's front edge. Each tail swings back at least as far as the
    // thigh on its side; a thigh driving forward flares its tail's front edge back and out of the way.
    if (j.skirt && (j.tailL || j.tailR)) {
      const sk = j.skirt;
      for (const [tail, hip, knee, side] of [[j.tailL, j.lHip, j.lKnee, 1], [j.tailR, j.rHip, j.rKnee, -1]]) {
        if (!tail) continue;
        hip.getWorldPosition(_S); sk.worldToLocal(_S);
        knee.getWorldPosition(_tmp); sk.worldToLocal(_tmp);
        const th = Math.atan2(-(_tmp.z - _S.z), Math.max(0.05, _S.y - _tmp.y));   // > 0: knee behind the hip
        const az = Math.atan2(_tmp.x, _tmp.z);                                       // knee azimuth around the coat
        const r = tail.rotation;
        if (th > 0.02) r.x = Math.max(r.x, th * 0.95 + 0.08);
        else if (th < -0.05) {
          const f = Math.min(0.75, -th * 0.6 + Math.max(0, Math.abs(az) - 0.45) * 1.3);
          r.y += side * f; r.z += side * f * 0.3; r.x = Math.max(r.x, 0.06);
        }
      }
    }
  }
}
