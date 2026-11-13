// Second-generation costume and hair for CaptainFigure (option `v2`, coated men): the pieces that make a captain's
// silhouette — a turned-down collar and wide revers, a long buttoned waistcoat, a lace cravat, deep cuffs with lace,
// a knotted sash with a pistol in it, a baldric that really crosses the chest, bucket-top boots, shoulder-length
// hair, a swept moustache and a plume. Called from figure.js with its builders:
//   K = { mesh, M, o, bulk, torsoShape, lathe, sculpt, sphere, torus, smooth, bump, folds,
//         mats: { shirt, coatPlain, lapel, waistcoat, belt, boot, brass, iron, wood, hair, sash, plume }, j (bones) }
//   coatV2(K)  sashV2(K)  cuffV2(K, el, s)  bootTopV2(K, kn)  hairV2(K, hd)  moustacheV2(K, hd)  plumeV2(K, hatJ)
// Every piece is a part like the others (painted AO, skinned to its bone): no new material, no new draw call.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

// tube of varying, elliptical section along a curve: radius(t) -> [across, thick]; `up` fixes the flat side
function horn(pts, radius, tub = 12, rad = 6, up = null) {
  const c = new THREE.CatmullRomCurve3(pts.map(p => (p.isVector3 ? p : V3(...p))), false, 'centripetal');
  const pos = [], idx = [], T = V3(), N = V3(), B = V3(), P = V3();
  for (let i = 0; i <= tub; i++) {
    const t = i / tub; c.getPointAt(t, P); c.getTangentAt(t, T);
    N.copy(up || V3(0, 0, 1)).addScaledVector(T, -(up || V3(0, 0, 1)).dot(T)).normalize(); B.crossVectors(T, N);
    const [ra, rt] = radius(t);
    for (let k = 0; k < rad; k++) { const a = k / rad * Math.PI * 2; pos.push(P.x + B.x * Math.cos(a) * ra + N.x * Math.sin(a) * rt, P.y + B.y * Math.cos(a) * ra + N.y * Math.sin(a) * rt, P.z + B.z * Math.cos(a) * ra + N.z * Math.sin(a) * rt); }
  }
  for (let i = 0; i < tub; i++) for (let k = 0; k < rad; k++) { const a = i * rad + k, b = i * rad + (k + 1) % rad, d = a + rad, e = b + rad; idx.push(a, d, b, b, d, e); }
  // caps
  const c0 = pos.length / 3; c.getPointAt(0, P); pos.push(P.x, P.y, P.z); const c1 = c0 + 1; c.getPointAt(1, P); pos.push(P.x, P.y, P.z);
  for (let k = 0; k < rad; k++) { idx.push(c0, k, (k + 1) % rad); idx.push(c1, tub * rad + (k + 1) % rad, tub * rad + k); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}

// radius of the coat shell at height y (spine frame), and a point on the dressed torso at angle a pushed out by `off`
const SHELL = [[0.0, 0.172], [0.14, 0.19], [0.28, 0.203], [0.4, 0.205], [0.49, 0.175], [0.53, 0.1]];
function shellR(y) { let k = 0; while (k < SHELL.length - 2 && SHELL[k + 1][0] < y) k++; const [y0, r0] = SHELL[k], [y1, r1] = SHELL[k + 1]; return r0 + (r1 - r0) * Math.min(1, Math.max(0, (y - y0) / (y1 - y0))); }
function onTorso(K, a, y, off = 0, k = 0.8) {
  const r = shellR(y) + off, v = V3(r * Math.sin(a) * K.bulk * 1.06, y, r * Math.cos(a) * 0.8);
  K.torsoShape(k)(v); v.y -= 0.01;   // the shell hangs 1 cm under the spine joint
  return v;
}

export function coatV2(K) {
  const { mesh, lathe, sculpt, sphere, smooth, bump, mats, j, bulk, torsoShape } = K;
  // long waistcoat under the open coat, buttoned down the front, its skirts over the top of the breeches
  const wc = sculpt(lathe([[-0.15, 0.176], [-0.04, 0.168], [0.1, 0.166], [0.26, 0.184], [0.4, 0.194], [0.47, 0.176]], 22, { sx: bulk * 1.03, sz: 0.755, phi0: -Math.PI * 0.26, phiLen: Math.PI * 0.52 }), torsoShape(0.9));
  mesh(wc, mats.waistcoat, j.spine, [0, -0.012, 0], { lo: 0.74, fn: v => 1 - 0.16 * Math.exp(-((v.x / 0.012) ** 2)) - 0.1 * bump(v.y, 0.1, 0.05) });
  const bt = sphere(0.0115, 8, 6);
  for (let i = 0; i < 8; i++) { const y = -0.1 + i * 0.072, p = V3(0, y, (0.166 + 0.03 * smooth(0.1, 0.4, y)) * 0.755); torsoShape(0.9)(p); mesh(bt, mats.brass, j.spine, [0.006, p.y - 0.012, p.z + 0.004]); }
  // revers: the coat's facings turned back over the chest, wide at the collar and narrowing to the waist, buttoned
  for (const s of [-1, 1]) {
    const inner = s * Math.PI * 0.14, outer = s * Math.PI * 0.36;
    const rev = sculpt(lathe([[0.04, 0.186], [0.14, 0.199], [0.28, 0.212], [0.4, 0.215], [0.475, 0.196]], 20, { sx: bulk * 1.06, sz: 0.8, phi0: Math.min(inner, outer), phiLen: Math.abs(outer - inner) }), v => {
      const a = Math.atan2(v.x / (bulk * 1.06), v.z / 0.8), r = Math.hypot(v.x / (bulk * 1.06), v.z / 0.8);
      const w = 0.3 + 0.7 * smooth(0.04, 0.44, v.y), na = inner + (a - inner) * w;                       // narrower toward the waist
      v.x = r * Math.sin(na) * bulk * 1.06; v.z = r * Math.cos(na) * 0.8;
      torsoShape(0.8)(v);
    });
    mesh(rev, mats.lapel, j.spine, [0, -0.01, 0], { lo: 0.8, fn: v => 1 - 0.12 * smooth(0.02, 0.0, Math.abs(Math.atan2(v.x, v.z) - inner * 0.9)) });
    for (let i = 0; i < 4; i++) { const y = 0.14 + i * 0.085, a = inner + (outer - inner) * (0.3 + 0.7 * smooth(0.04, 0.44, y)) * 0.72; const p = onTorso(K, a, y, 0.014); mesh(bt, mats.brass, j.spine, [p.x, p.y, p.z]); }
  }
  // turned-down collar round the back of the neck, falling onto the shoulders
  mesh(sculpt(lathe([[0.0, 0.11], [0.05, 0.098], [0.066, 0.104], [0.05, 0.128], [0.0, 0.15]], 22, { sz: 0.86, phi0: Math.PI * 0.2, phiLen: Math.PI * 1.6 }), v => { v.x *= 1 + 0.25 * smooth(0.02, 0.0, v.y) * (Math.hypot(v.x, v.z) > 0.12 ? 1 : 0); }),
    mats.lapel, j.chest, [0, 0.235, -0.012], { lo: 0.72 });
  // lace cravat: a knot at the throat and two tiers of gathered lace
  mesh(sphere(0.02, 10, 8).scale(1.5, 0.8, 0.8), mats.shirt, j.neck, [0, -0.004, 0.078], { lo: 0.85 });
  for (const [w, h, z, rx] of [[0.11, 0.17, 0.082, -0.2], [0.085, 0.095, 0.094, -0.3]]) {
    const fall = sculpt(new THREE.BoxGeometry(w, h, 0.012, 12, 6, 1).translate(0, -h / 2, 0), v => {
      const t = -v.y / h; v.x *= 0.45 + 0.75 * t;
      v.z += 0.007 * Math.sin(v.x * 190) * (0.3 + t) + 0.004 * t; v.y -= 0.006 * Math.abs(Math.sin(v.x * 190)) * smooth(0.7, 1, t);
    });
    mesh(fall, mats.shirt, j.neck, [0, -0.012, z], { lo: 0.78, fn: v => 0.88 + 0.12 * Math.sin(v.x * 190) }).rotation.x = rx;
  }
  // baldric: a wide leather strap that really crosses the chest and the back, from the right shoulder to the left hip
  const loop = [];
  for (let i = 0; i < 28; i++) { const a = i / 28 * Math.PI * 2, y = 0.255 + 0.185 * Math.cos(a + Math.PI / 2) + 0.02 * Math.cos(2 * a); loop.push(onTorso(K, a, y, 0.02)); }
  const cl = new THREE.CatmullRomCurve3(loop, true), strap = [], sidx = [], T = V3(), P = V3(), N = V3(), W = V3();
  const SEG = 56, RAD = 4;
  for (let i = 0; i <= SEG; i++) {
    const t = (i % SEG) / SEG; cl.getPointAt(t, P); cl.getTangentAt(t, T);
    N.set(P.x, 0, P.z / 0.6).normalize(); N.addScaledVector(T, -N.dot(T)).normalize(); W.crossVectors(T, N);
    for (let k = 0; k < RAD; k++) { const a = (k + 0.5) / RAD * Math.PI * 2, cw = Math.sign(Math.cos(a)) * 0.031, cn = Math.sign(Math.sin(a)) * 0.006; strap.push(P.x + W.x * cw + N.x * cn, P.y + W.y * cw + N.y * cn, P.z + W.z * cw + N.z * cn); }
  }
  for (let i = 0; i < SEG; i++) for (let k = 0; k < RAD; k++) { const a = i * RAD + k, b = i * RAD + (k + 1) % RAD, d = a + RAD, e = b + RAD; sidx.push(a, b, d, b, e, d); }
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(strap, 3)); sg.setIndex(sidx); sg.computeVertexNormals();
  mesh(sg, mats.belt, j.spine, null, { lo: 0.7 });
  { const p = cl.getPointAt(0.965), q = cl.getPointAt(0.99); const bk = mesh(mergeGeometries([new THREE.BoxGeometry(0.075, 0.058, 0.01), new THREE.BoxGeometry(0.05, 0.034, 0.014)]), mats.brass, j.spine, [p.x, p.y, p.z + 0.012], { lo: 0.85 }); bk.rotation.set(-0.1, Math.atan2(p.x, p.z) * 0.6, Math.atan2(q.y - p.y, q.x - p.x)); }
}

export function sashV2(K) {
  const { mesh, lathe, sculpt, sphere, torus, smooth, mats, j, bulk } = K;
  // a wide sash wound twice round the waist, knotted on the left hip, its two ends hanging
  mesh(sculpt(lathe([[0.045, 0.166], [0.07, 0.179], [0.13, 0.183], [0.185, 0.18], [0.21, 0.168]], 30, { sx: bulk, sz: 0.8 }), v => {
    const a = Math.atan2(v.x, v.z), k = 1 + 0.022 * Math.sin(v.y * 95 + a * 2.2) + 0.012 * Math.sin(v.y * 47 - a * 3); v.x *= k; v.z *= k;
  }), mats.sash, j.hips, null, { lo: 0.72, fn: v => 0.86 + 0.14 * Math.sin(v.y * 95 + Math.atan2(v.x, v.z) * 2.2) });
  mesh(sculpt(sphere(0.042, 12, 9).scale(0.9, 1.05, 0.8), v => { v.x *= 1 + 0.12 * Math.sin(v.y * 120); }), mats.sash, j.hips, [0.15 * bulk, 0.12, 0.085], { lo: 0.75 });
  for (const [len, dx, dz, rz, rx] of [[0.34, 0.012, 0.012, 0.1, -0.06], [0.26, -0.022, 0.03, -0.14, -0.14]]) {
    const end = sculpt(new THREE.BoxGeometry(0.085, len, 0.014, 8, 8, 1).translate(0, -len / 2, 0), v => {
      const t = -v.y / len; v.x *= 0.6 + 0.6 * t; v.z += 0.012 * Math.sin(v.x * 150 + t * 3) * (0.3 + t);
      if (t > 0.9) v.y -= 0.018 * Math.abs(Math.sin(v.x * 260));   // fringe
    });
    const e = mesh(end, mats.sash, j.hips, [0.15 * bulk + dx, 0.1, 0.085 + dz], { lo: 0.62, fn: v => 0.86 + 0.14 * Math.sin(v.x * 150) });
    e.rotation.set(rx, 0.5, rz);
  }
  // sword belt over the sash, a square buckle
  mesh(torus(0.186, 0.017, 6, 26).scale(bulk, 1.5, 0.8).rotateX(Math.PI / 2), mats.belt, j.hips, [0, 0.105, 0]);
  mesh(mergeGeometries([new THREE.BoxGeometry(0.082, 0.07, 0.014), new THREE.BoxGeometry(0.052, 0.04, 0.02)]), mats.brass, j.hips, [0, 0.105, 0.162], { lo: 0.85 });
  // a flintlock thrust in the sash, butt to the right hand
  const pj = new THREE.Object3D(); pj.position.set(-0.075 * bulk, 0.15, 0.158); pj.rotation.set(0.12, 0.1, 0.62); j.hips.add(pj);
  mesh(new THREE.CylinderGeometry(0.0115, 0.0135, 0.24, 8).translate(0, -0.1, 0), mats.iron, pj, null, { lo: 0.7 });
  mesh(new THREE.BoxGeometry(0.03, 0.2, 0.026).translate(0, -0.07, -0.014), mats.wood, pj, null, { lo: 0.7 });
  mesh(horn([[0, 0.02, -0.012], [-0.012, 0.07, -0.014], [-0.045, 0.115, -0.016]], t => [0.019 - 0.003 * t, 0.015], 8, 7), mats.wood, pj, null, { lo: 0.8 });
  mesh(sphere(0.021, 8, 6).scale(1, 0.8, 0.9), mats.brass, pj, [-0.05, 0.122, -0.016]);
  mesh(new THREE.BoxGeometry(0.012, 0.045, 0.03), mats.iron, pj, [0.017, 0.035, 0.0]);   // lock
}

// deep turned-back cuff, three buttons, a lace ruffle over the hand (el = elbow bone, s = side)
export function cuffV2(K, el, s) {
  const { mesh, lathe, sculpt, sphere, torus, mats } = K;
  mesh(sculpt(lathe([[-0.262, 0.064], [-0.252, 0.085], [-0.2, 0.091], [-0.128, 0.096], [-0.114, 0.09], [-0.122, 0.07]], 18), v => { const a = Math.atan2(v.x, v.z), k = 1 + 0.02 * Math.sin(a * 3 + 1); v.x *= k; v.z *= k; }),
    mats.lapel, el, null, { lo: 0.7 });
  const bt = sphere(0.0105, 8, 6);
  for (let i = 0; i < 3; i++) mesh(bt, mats.brass, el, [s * 0.094, -0.15 - i * 0.04, -0.012]);
  mesh(sculpt(torus(0.052, 0.02, 6, 22).rotateX(Math.PI / 2).scale(1, 0.75, 1), v => { const a = Math.atan2(v.x, v.z); v.y += 0.008 * Math.sin(a * 11); const k = 1 + 0.07 * Math.sin(a * 11 + 1.5); v.x *= k; v.z *= k; }),
    mats.shirt, el, [0, -0.268, 0], { lo: 0.8, fn: v => 0.86 + 0.14 * Math.sin(Math.atan2(v.x, v.z) * 11) });
}

// bucket top of a sea boot: a wide funnel above the knee, higher behind, slouching (kn = knee bone)
export function bootTopV2(K, kn) {
  const { mesh, lathe, sculpt, smooth, mats } = K;
  mesh(sculpt(lathe([[-0.01, 0.074], [0.025, 0.09], [0.08, 0.118], [0.135, 0.14], [0.15, 0.138], [0.142, 0.124], [0.09, 0.104], [0.04, 0.088]], 20), v => {
    const a = Math.atan2(v.x, v.z), up = smooth(0.02, 0.14, v.y);
    v.y += 0.028 * up * Math.max(0, -Math.cos(a)) - 0.012 * up * Math.max(0, Math.cos(a));   // higher at the back, dipping in front
    const k = 1 + 0.03 * up * Math.sin(a * 4 + 0.7); v.x *= k; v.z *= k;
  }), mats.boot, kn, null, { lo: 0.5, fn: v => 1 - 0.3 * smooth(0.128, 0.105, Math.hypot(v.x, v.z)) * smooth(0.06, 0.13, v.y), sk: { up: 0.085 } });
  mesh(lathe([[-0.06, 0.071], [-0.045, 0.076], [-0.03, 0.071]], 14), mats.belt, kn, null, { lo: 0.6 });   // garter strap under the knee
}

// shoulder-length hair under the hat: a mass falling behind the ears onto the collar, two locks before the ears
export function hairV2(K, hd) {
  const { mesh, sculpt, sphere, smooth, mats } = K;
  const back = sculpt(sphere(1, 26, 22, Math.PI * 0.5 + 1.2, Math.PI * 2 - 2.4), v => {   // open in front (the face)
    const a = Math.atan2(v.x, v.z), t = (1 - v.y) / 2;                 // t: 0 crown → 1 tips
    const r = 0.112 + 0.012 * smooth(0.35, 0.8, t) - 0.03 * smooth(0.86, 1.0, t);
    const wave = 1 + 0.045 * Math.sin(a * 9 + t * 11) * smooth(0.3, 0.6, t) + 0.02 * Math.sin(a * 17 - t * 7) * smooth(0.5, 0.8, t);
    const rr = Math.hypot(v.x, v.z) || 1e-6;
    v.set(v.x / rr * r * wave * Math.min(1, rr * 1.5) * 0.95, 0.215 - t * 0.33, v.z / rr * r * wave * Math.min(1, rr * 1.5) * 1.02);
  });
  mesh(back, mats.hair, hd, [0, 0, -0.016], { lo: 0.58, fn: v => { const a = Math.atan2(v.x, v.z); return 0.84 + 0.16 * Math.sin(a * 9 + (0.215 - v.y) * 33) ; } });
  for (const s of [-1, 1]) {
    mesh(horn([[s * 0.088, 0.17, 0.035], [s * 0.103, 0.11, 0.03], [s * 0.1, 0.04, 0.022], [s * 0.088, -0.03, 0.03], [s * 0.094, -0.07, 0.022]], t => [0.019 * (1 - 0.55 * t * t) * (1 + 0.18 * Math.sin(t * 14)), 0.013 * (1 - 0.5 * t)], 14, 7, V3(s, 0, 0.2)),
      mats.hair, hd, null, { lo: 0.62, fn: v => 0.86 + 0.14 * Math.sin(v.y * 95) });
  }
}

// a swept moustache and a tuft under the lip, hair by hair no, but shaped: thick at the philtrum, tapering to upturned points
export function moustacheV2(K, hd) {
  const { mesh, sculpt, sphere, mats } = K;
  for (const s of [-1, 1]) mesh(horn([[s * 0.003, 0.0775, 0.117], [s * 0.022, 0.0715, 0.112], [s * 0.041, 0.069, 0.098], [s * 0.054, 0.077, 0.086]], t => [0.0098 * (1 - 0.72 * t), 0.0078 * (1 - 0.6 * t)], 10, 7, V3(0, 0.3, 1)),
    mats.hair, hd, null, { lo: 0.8, fn: v => 0.85 + 0.15 * Math.sin(v.x * 420) });
  mesh(sculpt(sphere(0.012, 8, 6).scale(0.8, 1.5, 0.6), v => { if (v.y < 0) v.x *= 1 + v.y * 30; }), mats.hair, hd, [0, 0.035, 0.103], { lo: 0.8 });
}

// an ostrich plume sweeping back over the crown from a cockade on the left cock of the hat
export function plumeV2(K, hatJ) {
  const { mesh, sculpt, mats } = K;
  const spine = [[0.085, 0.075, 0.1], [0.13, 0.2, 0.04], [0.12, 0.29, -0.07], [0.07, 0.32, -0.2], [0.0, 0.28, -0.31], [-0.04, 0.19, -0.37]];
  const g = sculpt(horn(spine, t => [0.014 + 0.066 * Math.sin(Math.min(1, t * 1.15) * Math.PI) ** 0.7, 0.014 + 0.02 * Math.sin(t * Math.PI)], 24, 10, V3(0.5, 1, 0)), v => { v.y += 0.008 * Math.sin(v.z * 90 + v.x * 60); v.x += 0.006 * Math.sin(v.z * 130); });
  mesh(g, mats.plume, hatJ, null, { lo: 0.72, fn: v => 0.82 + 0.18 * Math.sin(v.z * 150 + v.y * 80) });
  mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.012, 10).rotateX(Math.PI / 2), mats.sash, hatJ, [0.088, 0.07, 0.108], { lo: 0.8 }).rotation.y = 0.7;
  mesh(new THREE.SphereGeometry(0.011, 8, 6), mats.brass, hatJ, [0.094, 0.07, 0.116]);
}
