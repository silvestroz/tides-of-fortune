// GeoBuilder: accumulates triangles with the attribute layout used by the ship hull material:
//   position, normal, uv, color (rgb, AO baked), aSurf vec4 (metalness, roughness, emissive, grain), aBreak (hull-damage threshold, 2 = never)
// every vertex also carries a CPU-side LOD tag (1 = fine detail, dropped from the far geometry; 2 = far only): small or thin
// parts added with add() (gilded beads, rails, port frames, grates…), parts flagged { lod: 1 } (guns, carriages),
// ratlines and running rigging. build() stores the far index in geometry.userData.farIndex (same vertices).
import * as THREE from 'three';
const _bb = new THREE.Box3();

const _v = new THREE.Vector3(), _n = new THREE.Vector3(), _m3 = new THREE.Matrix3();
const _c = new THREE.Color();
const _UPN = new THREE.Vector3(0, 1, 0);

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
  }
  get count() { return this.pos.length / 3; }

  vertex(p, n, u, v, color, surf, brk = 2, ao = 1) {
    if (!(n.x * n.x + n.y * n.y + n.z * n.z > 1e-10)) n = _UPN;
    this.pos.push(p.x, p.y, p.z); this.nor.push(n.x, n.y, n.z); this.uv.push(u, v);
    this.col.push(color.r * ao, color.g * ao, color.b * ao);
    this.surf.push(surf[0], surf[1], surf[2], surf[3]); this.brk.push(brk); this.piv.push(this.curPiv[0], this.curPiv[1]);
    this.lodTag.push(this.curLod);
    return this.count - 1;
  }
  tri(a, b, c) { this.idx.push(a, b, c); }
  quad(a, b, c, d) { this.idx.push(a, b, c, a, c, d); }

  // Add a THREE.BufferGeometry transformed by matrix.
  // o: { color, surf, brk, uvScale:[su,sv], uvOffset:[ou,ov], swapUV, ao: fn(worldPos, worldNormal)->factor, worldUV:'xz'|'zy'|'xy' }
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
    let lod = o.lod;
    if (lod == null) {
      if (!geom.boundingBox) geom.computeBoundingBox();
      _bb.copy(geom.boundingBox).applyMatrix4(matrix);
      const e = [_bb.max.x - _bb.min.x, _bb.max.y - _bb.min.y, _bb.max.z - _bb.min.z].sort((a, b) => a - b);
      lod = (e[1] < 0.12 || (e[2] < 0.7 && e[1] < 0.35)) ? 1 : 0;
    }
    const prevLod = this.curLod; this.curLod = lod || prevLod;
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
    this.curLod = prevLod;
    return this;
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
    for (let i = 0; i < sides; i++) {
      const ang = (i / sides) * Math.PI * 2;
      n.copy(s1).multiplyScalar(Math.cos(ang)).addScaledVector(s2, Math.sin(ang));
      const vv = (i / sides) * r * 2.6 + this._lineV;
      p.copy(a).addScaledVector(n, r); this.vertex(p, n, this._lineU, vv, c, surf, brk);
      const sv = this.curPiv; if (pivB) this.curPiv = pivB;
      p.copy(b).addScaledVector(n, r * taper); this.vertex(p, n, this._lineU + len / 6, vv, c, surf, brk);
      this.curPiv = sv;
    }
    this.curLod = prevLod;
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

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aSurf', new THREE.Float32BufferAttribute(this.surf, 4));
    g.setAttribute('aBreak', new THREE.Float32BufferAttribute(this.brk, 1));
    g.setAttribute('aPiv', new THREE.Float32BufferAttribute(this.piv, 2));
    // LOD tags: 0 both geometries, 1 near only (fine detail), 2 far only (coarse stand-ins, e.g. the hull skin)
    const T = this.lodTag, I = this.idx, near = [], far = [];
    for (let i = 0; i < I.length; i += 3) {
      const a = T[I[i]], b = T[I[i + 1]], c = T[I[i + 2]];
      if (a !== 2 && b !== 2 && c !== 2) near.push(I[i], I[i + 1], I[i + 2]);
      if (a !== 1 && b !== 1 && c !== 1) far.push(I[i], I[i + 1], I[i + 2]);
    }
    const big = this.count > 65535;
    g.setIndex(big ? new THREE.Uint32BufferAttribute(near, 1) : new THREE.Uint16BufferAttribute(near, 1));
    g.computeBoundingSphere(); g.computeBoundingBox();
    g.userData.farIndex = big ? new Uint32Array(far) : new Uint16Array(far);
    return g;
  }
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
