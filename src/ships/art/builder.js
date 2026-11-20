// GeoBuilder: accumulates triangles with the attribute layout used by the ship hull material:
//   position, normal, uv, color (rgb, AO baked), aSurf vec4 (metalness, roughness, emissive, grain), aBreak (hull-damage threshold, 2 = never)
// every vertex also carries a CPU-side LOD tag (1 = fine detail, dropped from the far geometry; 2 = far only): small or thin
// parts added with add() (gilded beads, rails, port frames, grates…), parts flagged { lod: 1 } (guns, carriages),
// ratlines and running rigging. build() stores the far index in geometry.userData.farIndex (same vertices).
// A third index, geometry.userData.distIndex, draws the ship a kilometre away from the same vertices again: of the far
// geometry it keeps the parts added with add() that are DIST_MIN long or more (masts, spars, tops, stem, bulkheads…),
// those flagged { dist: true } (stern lanterns), every line (standing rigging) and what a builder emits while curDist
// is 1 (transom), and it adds the triangles the builders push into idxDist (the far skin, the decks, the bulwarks and
// the quarter galleries drawn through a few of their stations and rows; the outer face alone of each gunport, stern
// window and frieze panel, see distFace()).
// The ship builders are generators (buildHullSteps, buildRigSteps, buildSteps(), paintSkinSteps): each `yield` is a point
// where the build may be put down until the next frame (shipModel.js stepShipBuilds). Inside their loops,
// `if (gb.due()) yield;` puts it down only once the frame's build time is spent (buildClock.end, set by stepShipBuilds;
// Infinity when a build runs in one go, which never stops there): a frame's share stays near its budget whatever the
// part being built, without a yield per part. Where the yields fall changes nothing in the geometry.
import * as THREE from 'three';
const _bb = new THREE.Box3();

const _v = new THREE.Vector3(), _n = new THREE.Vector3(), _m3 = new THREE.Matrix3();
const _c = new THREE.Color();
const _UPN = new THREE.Vector3(0, 1, 0);
// a part whose largest side is under DIST_MIN (m) is left out of the distant geometry: about 2 pixels where it is drawn
const DIST_MIN = 1.5;

export const buildClock = { end: Infinity };

export const SURF = {
  wood:   [0, 0.86, 0, 1],
  paint:  [0, 0.82, 0, 0.45],
  tar:    [0, 0.7, 0, 0.55],
  gold:   [1, 0.32, 0, 0],
  iron:   [0.7, 0.45, 0, 0],
  glass:  [0.2, 0.15, 1, 0],
  rope:   [0, 0.9, 0, 0],
  ratline: [0, 0.91, 0, 0.01],
  run:    [0, 0.92, 0, 0.02],
  canvas: [0, 0.9, 0, 0.1],
  lamp:   [0.1, 0.4, 1.6, 0],
  deck:   [0, 0.9, 0, 1],
};

export class GeoBuilder {
  constructor() {
    this._lineU = 0; this._lineV = 0; this.curPiv = [-1, 0]; this.piv = [];
    this.pos = []; this.nor = []; this.uv = []; this.col = []; this.surf = []; this.brk = []; this.idx = [];
    this.lodTag = []; this.curLod = 0;
    this.distTag = []; this.curDist = 0; this.idxDist = [];
  }
  get count() { return this.pos.length / 3; }
  // true once the frame's build time is spent (see buildClock): `if (gb.due()) yield;`
  due() { return performance.now() > buildClock.end; }

  vertex(p, n, u, v, color, surf, brk = 2, ao = 1) {
    if (!(n.x * n.x + n.y * n.y + n.z * n.z > 1e-10)) n = _UPN;
    this.pos.push(p.x, p.y, p.z); this.nor.push(n.x, n.y, n.z); this.uv.push(u, v);
    this.col.push(color.r * ao, color.g * ao, color.b * ao);
    this.surf.push(surf[0], surf[1], surf[2], surf[3]); this.brk.push(brk); this.piv.push(this.curPiv[0], this.curPiv[1]);
    this.lodTag.push(this.curLod); this.distTag.push(this.curDist);
    return this.count - 1;
  }
  tri(a, b, c) { this.idx.push(a, b, c); }
  quad(a, b, c, d) { this.idx.push(a, b, c, a, c, d); }

  // Add a THREE.BufferGeometry transformed by matrix.
  // o: { color, surf, brk, uvScale:[su,sv], uvOffset:[ou,ov], swapUV, ao: fn(worldPos, worldNormal)->factor, worldUV:'xz'|'zy'|'xy',
  //      lod: 0 | 1 (far-LOD tag, by size when absent), dist: true (in the distant geometry whatever its size) }
  add(geom, matrix, o = {}) {
    const g = geom.index ? geom : geom;
    const P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv;
    const base = this.count;
    _m3.getNormalMatrix(matrix);
    const color = o.color instanceof THREE.Color ? o.color : _c.set(o.color ?? 0xffffff);
    const col = color.clone();
    const surf = o.surf || SURF.wood;
    const su = o.uvScale ? o.uvScale[0] : 1, sv = o.uvScale ? o.uvScale[1] : 1;
    const ou = o.uvOffset ? o.uvOffset[0] : Math.random() * 4, ov = o.uvOffset ? o.uvOffset[1] : Math.random() * 4;
    // far-LOD tag: explicit o.lod, else small (all sides < 0.7 m, two < 0.35 m) or very thin (two sides < 0.12 m) parts
    if (!geom.boundingBox) geom.computeBoundingBox();
    _bb.copy(geom.boundingBox).applyMatrix4(matrix);
    const e = [_bb.max.x - _bb.min.x, _bb.max.y - _bb.min.y, _bb.max.z - _bb.min.z].sort((a, b) => a - b);
    const lod = o.lod ?? ((e[1] < 0.12 || (e[2] < 0.7 && e[1] < 0.35)) ? 1 : 0);
    const prevLod = this.curLod; this.curLod = lod || prevLod;
    const prevDist = this.curDist; if (this.curLod !== 1 && (o.dist || e[2] >= DIST_MIN)) this.curDist = 1;
    for (let i = 0; i < P.count; i++) {
      _v.fromBufferAttribute(P, i).applyMatrix4(matrix);
      _n.fromBufferAttribute(N, i).applyMatrix3(_m3).normalize();
      let u = 0, v = 0;
      if (o.worldUV === 'auto') {
        const ax = Math.abs(_n.x), ay = Math.abs(_n.y), az = Math.abs(_n.z);
        if (ay >= ax && ay >= az) { u = _v.z / 4; v = _v.x / 2.4; }
        else if (ax >= az) { u = _v.z / 4; v = _v.y / 2.4; }
        else { u = _v.x / 4; v = _v.y / 2.4; }
      }
      else if (o.worldUV === 'xz') { u = _v.z / 4; v = _v.x / 2.4; }
      else if (o.worldUV === 'zy') { u = _v.z / 4; v = _v.y / 2.4; }
      else if (o.worldUV === 'xy') { u = _v.x / 4; v = _v.y / 2.4; }
      else if (U) { u = U.getX(i); v = U.getY(i); if (o.swapUV) { const t = u; u = v; v = t; } }
      const ao = o.ao ? o.ao(_v, _n) : 1;
      this.vertex(_v, _n, u * su + ou, v * sv + ov, col, surf, o.brk ?? this.defBrk ?? 2, ao);
    }
    if (g.index) { const I = g.index.array; for (let i = 0; i < I.length; i++) this.idx.push(base + I[i]); }
    else for (let i = 0; i < P.count; i++) this.idx.push(base + i);
    this.curLod = prevLod; this.curDist = prevDist;
    return this;
  }

  // Distant geometry: the +z face alone of the box (a BoxGeometry) just added with add(), which started at vertex v0;
  // nothing when that box is fine detail (not in the far geometry either).
  distFace(v0) {
    if (this.lodTag[v0] !== 1) this.idxDist.push(v0 + 16, v0 + 18, v0 + 17, v0 + 18, v0 + 19, v0 + 17);
  }

  // Thin rope/spar between a and b: n-sided prism (no caps). taper = radius at b relative to a.
  line(a, b, r, color, surf = SURF.rope, sides = 3, taper = 1, brk = 2, pivB = null) {
    const dir = _v.subVectors(b, a); const len = dir.length(); if (len < 1e-4) return;
    dir.divideScalar(len);
    const up = Math.abs(dir.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const s1 = new THREE.Vector3().crossVectors(dir, up).normalize();
    const s2 = new THREE.Vector3().crossVectors(dir, s1).normalize();
    const c = color instanceof THREE.Color ? color : new THREE.Color(color);
    const base = this.count; const p = new THREE.Vector3(), n = new THREE.Vector3();
    // far LOD: ratlines, running rigging and short thin lines are fine detail (standing rigging and spars stay)
    const prevLod = this.curLod;
    if (surf === SURF.ratline || surf === SURF.run || (r < 0.035 && len < 1.2)) this.curLod = 1;
    const prevDist = this.curDist; if (this.curLod !== 1) this.curDist = 1;
    for (let i = 0; i < sides; i++) {
      const ang = (i / sides) * Math.PI * 2;
      n.copy(s1).multiplyScalar(Math.cos(ang)).addScaledVector(s2, Math.sin(ang));
      const vv = (i / sides) * r * 2.6 + this._lineV;
      p.copy(a).addScaledVector(n, r); this.vertex(p, n, this._lineU, vv, c, surf, brk);
      const sv = this.curPiv; if (pivB) this.curPiv = pivB;
      p.copy(b).addScaledVector(n, r * taper); this.vertex(p, n, this._lineU + len / 6, vv, c, surf, brk);
      this.curPiv = sv;
    }
    this.curLod = prevLod; this.curDist = prevDist;
    this._lineU = (this._lineU + 0.37) % 7; this._lineV = (this._lineV + 0.21) % 5;
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      this.quad(base + i * 2, base + j * 2, base + j * 2 + 1, base + i * 2 + 1);
    }
  }

  // polyline rope through points
  rope(points, r, color, surf, sides = 3) {
    for (let i = 0; i < points.length - 1; i++) this.line(points[i], points[i + 1], r, color, surf, sides);
  }

  build() { return drain(this.buildSteps()); }

  // build() as a generator (one typed array or index pass per step); its return value is the geometry
  *buildSteps() {
    const g = new THREE.BufferGeometry();
    // the JS arrays are copied into their typed arrays a slice at a time (a hull is several hundred thousand numbers);
    // the values are those Float32BufferAttribute(array) would hold
    const self = this;
    const typed = function* (Ctor, src) {   // Ctor: Float32Array
      const a = new Ctor(src.length);
      for (let i = 0; i < src.length; i += 16384) {
        const e = Math.min(src.length, i + 16384);
        for (let j = i; j < e; j++) a[j] = src[j];
        if (self.due()) yield;
      }
      return a;
    };
    g.setAttribute('position', new THREE.BufferAttribute(yield* typed(Float32Array, this.pos), 3)); yield;
    g.setAttribute('normal', new THREE.BufferAttribute(yield* typed(Float32Array, this.nor), 3)); yield;
    g.setAttribute('uv', new THREE.BufferAttribute(yield* typed(Float32Array, this.uv), 2)); yield;
    g.setAttribute('color', new THREE.BufferAttribute(yield* typed(Float32Array, this.col), 3)); yield;
    g.setAttribute('aSurf', new THREE.BufferAttribute(yield* typed(Float32Array, this.surf), 4)); yield;
    g.setAttribute('aBreak', new THREE.BufferAttribute(yield* typed(Float32Array, this.brk), 1));
    g.setAttribute('aPiv', new THREE.BufferAttribute(yield* typed(Float32Array, this.piv), 2)); yield;
    // LOD tags: 0 both geometries, 1 near only (fine detail), 2 far only (coarse stand-ins, e.g. the hull skin);
    // the indices go straight into typed arrays of the full size, cut to length at the end
    const T = this.lodTag, I = this.idx, big = this.count > 65535, IA = big ? Uint32Array : Uint16Array;
    const near = new IA(I.length), far = new IA(I.length); let nn = 0, nf = 0;
    for (let i = 0; i < I.length; i += 3) {
      const a = T[I[i]], b = T[I[i + 1]], c = T[I[i + 2]];
      if (a !== 2 && b !== 2 && c !== 2) { near[nn++] = I[i]; near[nn++] = I[i + 1]; near[nn++] = I[i + 2]; }
      if (a !== 1 && b !== 1 && c !== 1) { far[nf++] = I[i]; far[nf++] = I[i + 1]; far[nf++] = I[i + 2]; }
      if (i % 3000 === 2997 && this.due()) yield;
    }
    g.setIndex(new THREE.BufferAttribute(near.slice(0, nn), 1)); yield;
    g.userData.farIndex = far.slice(0, nf); yield;
    const D = this.distTag, dist = new IA(this.idxDist.length + I.length); dist.set(this.idxDist);
    let nd = this.idxDist.length;
    for (let i = 0; i < I.length; i += 3) {
      if (D[I[i]] && D[I[i + 1]] && D[I[i + 2]]) { dist[nd++] = I[i]; dist[nd++] = I[i + 1]; dist[nd++] = I[i + 2]; }
      if (i % 3000 === 2997 && this.due()) yield;
    }
    g.userData.distIndex = dist.slice(0, nd); yield;
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}

// runs a build generator to its end in one go and returns its value
function drain(steps) {
  let r; do r = steps.next(); while (!r.done);
  return r.value;
}

// Build a matrix from position + basis vectors (x, y, z columns) + scale
export function basisMatrix(pos, xAxis, yAxis, zAxis, sx = 1, sy = 1, sz = 1) {
  const m = new THREE.Matrix4();
  m.makeBasis(xAxis.clone().multiplyScalar(sx), yAxis.clone().multiplyScalar(sy), zAxis.clone().multiplyScalar(sz));
  m.setPosition(pos);
  return m;
}
export function trs(x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  const m = new THREE.Matrix4();
  m.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), new THREE.Vector3(sx, sy, sz));
  return m;
}
