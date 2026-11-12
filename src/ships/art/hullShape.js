// HullShape: analytic loft of a 17th-century hull from cross-section curves.
// Parameter s in [0,1] runs bow (0, -Z) -> stern (1, +Z). y is height above the waterline.
//   hw(s,y)   half-breadth (superellipse bilge below max-breadth, tumblehome above, bluff bow, wineglass transom)
//   z(s,y)    longitudinal position incl. raked stem & transom
//   yBot(s)   keel / forefoot profile;  yTop(s) top of side (sheer + castles + bulwark)
//   deckY(s)  main-deck height;  deckLevel(s) highest deck at s;  sheerOff(s) sheer rise above midship freeboard
import * as THREE from 'three';
import { clamp01, smooth } from './noise.js';

export class HullShape {
  constructor(spec, d) {
    this.L = spec.length; this.B = spec.beam; this.D = spec.draft; this.d = d;
    this.fb = d.fb; this.bulH = d.bulH; this.sMax = d.sMax;
    this.Rb = d.bowRake * this.L; this.Rs = d.sternRake * this.L;
    this.ymb = this.fb * 0.25;
    this.Ht = this.fb + this.bulH + 1.5;
    this.c = d.castles;
  }
  sheerOff(s) {
    const d = this.d, m = this.sMax;
    if (s < m) { const q = (m - s) / m; return d.sheerF * q * q; }
    const q = (s - m) / (1 - m); return d.sheerA * q * q;
  }
  deckY(s) { return this.fb + this.sheerOff(s); }
  castleRaise(s) {
    const c = this.c; let r = 0; const e = 0.007;
    if (c.qd) r += smooth(c.qd.s - e, c.qd.s + e, s) * c.qd.h;
    if (c.poop) r += smooth(c.poop.s - e, c.poop.s + e, s) * c.poop.h;
    if (c.fc) r += (1 - smooth(c.fc.s - e, c.fc.s + e, s)) * c.fc.h;
    return r;
  }
  // flat deck heights for each deck (no smoothing): used for deck surfaces/props
  deckLevel(s) {
    const c = this.c; let y = this.deckY(s);
    if (c.fc && s < c.fc.s) y += c.fc.h;
    if (c.qd && s >= c.qd.s) y += c.qd.h;
    if (c.poop && s >= c.poop.s) y += c.poop.h;
    return y;
  }
  yTop(s) { return this.deckY(s) + this.castleRaise(s) + this.bulH; }
  yBot(s) {
    const D = this.D;
    if (s < 0.2) { const t = (0.2 - s) / 0.2; return -D * (0.18 + 0.82 * Math.sqrt(Math.max(0, 1 - t * t))); }
    if (s > 0.93) return -D * (1 - 0.14 * (s - 0.93) / 0.07);
    return -D;
  }
  hw(s, y) {
    const d = this.d, B2 = this.B / 2, yb = this.yBot(s);
    const hn = clamp01((y - yb) / (this.fb + this.D));
    // vertical section
    let v;
    if (y < this.ymb) {
      const mid = 1 - Math.min(1, Math.abs(s - this.sMax) / 0.55) ** 2;
      const pf = 1.8 + 2.2 * mid;   // fuller, rounder bilge (chunkier from the beam)
      const t = clamp01((this.ymb - y) / Math.max(0.05, this.ymb - yb));
      v = Math.pow(Math.max(0, 1 - Math.pow(t, pf)), 1 / pf);
    } else {
      const t = (y - this.ymb) / this.Ht;
      v = Math.max(0.55, 1 - d.tumble * Math.pow(Math.max(0, t), 1.6));
    }
    // lengthwise fullness
    let f;
    if (s < this.sMax) {
      const q = 1 - s / this.sMax; const pb = 1.8 + 1.4 * hn;
      f = 1 - Math.pow(q, pb);
      f = Math.pow(Math.max(0, f), 0.62 - 0.12 * Math.min(1, hn));   // full, rounded 'apple' bow
    } else {
      const q = (s - this.sMax) / (1 - this.sMax); const ps = 1.9 + 0.9 * hn;
      const tw = d.transomW * smooth(this.yBot(1) + 0.3, d.transomY, y);
      f = 1 - Math.pow(q, ps) * (1 - tw);
    }
    return B2 * Math.max(0, f) * v;
  }
  z(s, y) {
    const L = this.L;
    let z = -L / 2 + this.Rb + s * (L - this.Rb - this.Rs);
    const hb = Math.min(1.35, Math.max(0, (y - this.yBot(s)) / (this.fb + this.D)));
    if (s < 0.25) { const q = 1 - s / 0.25; z -= this.Rb * q * q * hb; }
    if (s > 0.8) { const q = (s - 0.8) / 0.2; z += this.Rs * q * q * hb * 1.6; }
    return z;
  }
  // outer surface point; side = -1 port, +1 starboard
  point(s, y, side, out = new THREE.Vector3()) {
    return out.set(side * this.hw(s, y), y, this.z(s, y));
  }
  // outward normal + tangents at (s,y)
  frame(s, y, side) {
    const e = 0.002, ey = 0.02;
    const s0 = Math.min(1 - e, Math.max(e, s));
    const a = this.point(s0 - e, y, side), b = this.point(s0 + e, y, side);
    const c = this.point(s0, y - ey, side), d = this.point(s0, y + ey, side);
    const ds = b.sub(a), dy = d.sub(c);
    const n = new THREE.Vector3().crossVectors(ds, dy);
    if (n.lengthSq() < 1e-12) n.set(side, 0, 0); n.normalize();
    // outward test: athwartships along the sides, but forward at the bluff bow, where the planking turns in to the
    // stem and n.x is close to zero (its sign alone flipped the first strakes inward: back-face culled, a gap each
    // side of the stem)
    const fwd = s < 0.12 ? 3 * (1 - s / 0.12) : 0;
    if (n.x * side - n.z * fwd < 0) n.negate();
    return { n, ds: ds.normalize(), dy: dy.normalize() };
  }
  // find s for a given z at height y (bisection)
  sAtZ(z, y) {
    let lo = 0, hi = 1;
    for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (this.z(m, y) < z) lo = m; else hi = m; }
    return (lo + hi) / 2;
  }
}
