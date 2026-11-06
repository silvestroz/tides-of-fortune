// GeoBuilder: accumulates non-indexed triangles with position/normal/color/aMat into one BufferGeometry.
// Material ids (aMat) understood by townMaterial.js:
export const M = {
  PLASTER: 0, BRICK: 1, TILE: 2, WOOD: 3, STONE: 4, SLATE: 5, THATCH: 6, WINDOW: 7, LAMP: 8, IRON: 9,
  CLOTH: 10, COBBLE: 11, DARK: 12, GOLD: 13,
};
import * as THREE from 'three';

const _v = new THREE.Vector3(), _n = new THREE.Vector3(), _c = new THREE.Color();
const _m = new THREE.Matrix4(), _nm = new THREE.Matrix3();

export class GeoBuilder {
  constructor(detail = true) {
    this.detail = detail;
    this.pos = []; this.nrm = []; this.col = []; this.mat = [];
    this.ground = 0;           // reference ground height for AO baking
    this.aoH = 2.5;
  }
  _push(x, y, z, nx, ny, nz, c, mat) {
    this.pos.push(x, y, z); this.nrm.push(nx, ny, nz);
    const t = Math.min(1, Math.max(0, (y - this.ground) / this.aoH));
    const ao = 0.62 + 0.38 * t * t * (3 - 2 * t);
    this.col.push(c.r * ao, c.g * ao, c.b * ao); this.mat.push(mat);
  }
  // triangle with flat normal
  tri(a, b, c, color, mat) {
    _c.set(color);
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    this._push(a[0], a[1], a[2], nx, ny, nz, _c, mat); this._push(b[0], b[1], b[2], nx, ny, nz, _c, mat); this._push(c[0], c[1], c[2], nx, ny, nz, _c, mat);
  }
  quad(a, b, c, d, color, mat) { this.tri(a, b, c, color, mat); this.tri(a, c, d, color, mat); }

  // axis-aligned box (optionally rotated about Y around its centre); skip bottom face
  box(cx, cy, cz, sx, sy, sz, color, mat, rotY = 0, bottom = false) {
    const hx = sx / 2, hy = sy / 2, hz = sz / 2;
    const cs = Math.cos(rotY), sn = Math.sin(rotY);
    const P = (x, y, z) => [cx + x * cs + z * sn, cy + y, cz - x * sn + z * cs];
    const p = [P(-hx, -hy, -hz), P(hx, -hy, -hz), P(hx, hy, -hz), P(-hx, hy, -hz), P(-hx, -hy, hz), P(hx, -hy, hz), P(hx, hy, hz), P(-hx, hy, hz)];
    this.quad(p[4], p[5], p[6], p[7], color, mat); // +z
    this.quad(p[1], p[0], p[3], p[2], color, mat); // -z
    this.quad(p[5], p[1], p[2], p[6], color, mat); // +x
    this.quad(p[0], p[4], p[7], p[3], color, mat); // -x
    this.quad(p[3], p[7], p[6], p[2], color, mat); // top
    if (bottom) this.quad(p[0], p[1], p[5], p[4], color, mat);
  }
  // box from base y (convenient)
  block(cx, y0, cz, sx, h, sz, color, mat, rotY = 0) { this.box(cx, y0 + h / 2, cz, sx, h, sz, color, mat, rotY); }

  // gable roof: footprint sx (along ridge, local x) by sz, eave at y0, ridge height h above eave, overhang o
  gable(cx, y0, cz, sx, sz, h, color, mat, rotY = 0, o = 0.5, endColor = null, endMat = null) {
    const hx = sx / 2 + o, hz = sz / 2 + o, cs = Math.cos(rotY), sn = Math.sin(rotY);
    const P = (x, y, z) => [cx + x * cs + z * sn, y0 + y, cz - x * sn + z * cs];
    const drop = o * h / (sz / 2);
    const a = P(-hx, -drop, -hz), b = P(hx, -drop, -hz), c = P(hx, h, 0), d = P(-hx, h, 0);
    const e = P(-hx, -drop, hz), f = P(hx, -drop, hz);
    this.quad(b, a, d, c, color, mat);   // -z slope
    this.quad(e, f, c, d, color, mat);   // +z slope
    // undersides (thin) so overhangs are not see-through from below
    const u = 0.15;
    const a2 = P(-hx, -drop - u, -hz), b2 = P(hx, -drop - u, -hz), e2 = P(-hx, -drop - u, hz), f2 = P(hx, -drop - u, hz);
    this.quad(a, b, b2, a2, color, mat); this.quad(f, e, e2, f2, color, mat);
    // gable end triangles (wall)
    const ec = endColor ?? color, em = endMat ?? mat;
    const sx2 = sx / 2, g0 = P(-sx2, 0, -sz / 2), g1 = P(-sx2, 0, sz / 2), g2 = P(-sx2, h * (1 - 0) , 0);
    const k0 = P(sx2, 0, -sz / 2), k1 = P(sx2, 0, sz / 2), k2 = P(sx2, h, 0);
    this.tri(g0, g1, g2, ec, em); this.tri(k1, k0, k2, ec, em);
  }

  // hip roof: 4 slopes; ridge length = max(0, sx - sz)
  hip(cx, y0, cz, sx, sz, h, color, mat, rotY = 0, o = 0.5) {
    const hx = sx / 2 + o, hz = sz / 2 + o, cs = Math.cos(rotY), sn = Math.sin(rotY);
    const P = (x, y, z) => [cx + x * cs + z * sn, y0 + y, cz - x * sn + z * cs];
    const r = Math.max(0, hx - hz);
    const drop = o * h / (sz / 2);
    const a = P(-hx, -drop, -hz), b = P(hx, -drop, -hz), c = P(hx, -drop, hz), d = P(-hx, -drop, hz);
    const r0 = P(-r, h, 0), r1 = P(r, h, 0);
    this.quad(b, a, r0, r1, color, mat);
    this.quad(d, c, r1, r0, color, mat);
    this.tri(c, b, r1, color, mat);
    this.tri(a, d, r0, color, mat);
  }

  // pyramid cap (n sides), base radius r at y0, apex at y0 + h
  spire(cx, y0, cz, r, h, n, color, mat, rot = Math.PI / 4) {
    const ap = [cx, y0 + h, cz];
    for (let i = 0; i < n; i++) {
      const a0 = rot + i / n * Math.PI * 2, a1 = rot + (i + 1) / n * Math.PI * 2;
      this.tri([cx + Math.cos(a1) * r, y0, cz + Math.sin(a1) * r], [cx + Math.cos(a0) * r, y0, cz + Math.sin(a0) * r], ap, color, mat);
    }
  }

  // append an arbitrary THREE geometry transformed by matrix; smooth normals preserved
  geo(g, matrix, color, mat) {
    const gg = g.index ? g.toNonIndexed() : g;
    const p = gg.attributes.position, n = gg.attributes.normal;
    _nm.getNormalMatrix(matrix); _c.set(color);
    for (let i = 0; i < p.count; i++) {
      _v.fromBufferAttribute(p, i).applyMatrix4(matrix);
      _n.fromBufferAttribute(n, i).applyMatrix3(_nm).normalize();
      this._push(_v.x, _v.y, _v.z, _n.x, _n.y, _n.z, _c, mat);
    }
    if (gg !== g) gg.dispose();
  }
  cyl(x, y0, z, r0, r1, h, seg, color, mat, rx = 0, ry = 0, rz = 0) {
    const g = new THREE.CylinderGeometry(r1, r0, h, seg, 1, false);
    _m.makeRotationFromEuler(new THREE.Euler(rx, ry, rz)); _m.setPosition(x, y0 + (rx || rz ? 0 : h / 2), z);
    this.geo(g, _m, color, mat); g.dispose();
  }
  dome(x, y0, z, r, color, mat, seg = 10) {
    const g = new THREE.SphereGeometry(r, seg, Math.max(3, seg / 2 | 0), 0, Math.PI * 2, 0, Math.PI / 2);
    _m.makeTranslation(x, y0, z); this.geo(g, _m, color, mat); g.dispose();
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aMat', new THREE.Float32BufferAttribute(this.mat, 1));
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
  // like build(), but splits the triangles into a grid of separate geometries by their centroid in the XZ plane.
  // A big town merged into a single mesh (~195 k triangles at Havana) is drawn whole into the shadow map as soon
  // as one of its triangles enters it, since three.js only culls object by object. Split into cells, only those
  // really inside the shadow box (±90/150 m around the camera) are still rasterised there; the colour pass just
  // gains a little frustum culling at the screen edges. Pixel-identical rendering: a triangle keeps its three
  // vertices intact, only its grouping into meshes changes. cellSize in metres; returns an array of BufferGeometry.
  buildChunks(cellSize = 60) {
    const cells = new Map();
    const tris = this.pos.length / 9;
    for (let i = 0; i < tris; i++) {
      const po = i * 9, mo = i * 3;
      const cx = (this.pos[po] + this.pos[po + 3] + this.pos[po + 6]) / 3;
      const cz = (this.pos[po + 2] + this.pos[po + 5] + this.pos[po + 8]) / 3;
      const key = Math.floor(cx / cellSize) + '_' + Math.floor(cz / cellSize);
      let c = cells.get(key);
      if (!c) cells.set(key, c = { pos: [], nrm: [], col: [], mat: [] });
      for (let k = 0; k < 9; k++) { c.pos.push(this.pos[po + k]); c.nrm.push(this.nrm[po + k]); c.col.push(this.col[po + k]); }
      c.mat.push(this.mat[mo], this.mat[mo + 1], this.mat[mo + 2]);
    }
    const out = [];
    for (const c of cells.values()) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(c.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(c.nrm, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(c.col, 3));
      g.setAttribute('aMat', new THREE.Float32BufferAttribute(c.mat, 1));
      g.computeBoundingSphere(); g.computeBoundingBox();
      out.push(g);
    }
    return out;
  }
  get triCount() { return this.pos.length / 9; }
}
