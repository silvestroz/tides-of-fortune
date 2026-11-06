// deckSampler(meshes, frameMatrixWorld, yMin, yMax) -> (x, z) => y | null
// Height of a ship's deck in its own frame (that of frameMatrixWorld): the highest upward-facing face (normal
// y > 0.8 in that frame) under the vertical (x, z), between yMin and yMax — the same answer as a ray cast from
// yMax downward on every mesh (duelScene._layoutDeck used to cast ~350 rays over the whole hull at every boarding,
// several seconds on a slow machine). The candidate faces are binned once into a 2D grid.
// Same rules as Raycaster: layers (layer 0), drawRange and groups, back faces (BackSide) ignored.
import * as THREE from 'three';

const CELL = 0.25;
const _m = new THREE.Matrix4(), _inv = new THREE.Matrix4(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const _e1 = new THREE.Vector3(), _e2 = new THREE.Vector3(), _n = new THREE.Vector3();

export function deckSampler(meshes, frameMatrixWorld, yMin, yMax) {
  _inv.copy(frameMatrixWorld).invert();
  const tris = [];   // [ax, az, bx, bz, cx, cz, plane: y = p0 + px * x + pz * z]
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const mesh of meshes) {
    if (!(mesh.layers.mask & 1)) continue;
    const geo = mesh.geometry, pos = geo?.attributes?.position; if (!pos) continue;
    const mats = Array.isArray(mesh.material) ? mesh.material : null;
    if (!mats && mesh.material?.side === THREE.BackSide) continue;
    _m.multiplyMatrices(_inv, mesh.matrixWorld);
    const idx = geo.index, count = idx ? idx.count : pos.count;
    const ranges = mats && geo.groups.length ? geo.groups.filter(gr => mats[gr.materialIndex] && mats[gr.materialIndex].side !== THREE.BackSide) : [{ start: 0, count }];
    const ds = geo.drawRange.start, de = Math.min(count, ds + geo.drawRange.count);
    for (const gr of ranges) {
      const s0 = Math.max(gr.start, ds), s1 = Math.min(gr.start + gr.count, de);
      for (let i = s0; i < s1; i += 3) {   // like Mesh.raycast (drawRange, groups)
        const ia = idx ? idx.getX(i) : i, ib = idx ? idx.getX(i + 1) : i + 1, ic = idx ? idx.getX(i + 2) : i + 2;
        _a.fromBufferAttribute(pos, ia).applyMatrix4(_m); _b.fromBufferAttribute(pos, ib).applyMatrix4(_m); _c.fromBufferAttribute(pos, ic).applyMatrix4(_m);
        _n.crossVectors(_e1.subVectors(_c, _b), _e2.subVectors(_a, _b));   // Triangle.getNormal : (c − b) × (a − b)
        const l = _n.length(); if (!(l > 0)) continue;
        if (_n.y / l <= 0.8) continue;   // upward-facing only
        const hi = Math.max(_a.y, _b.y, _c.y), lo = Math.min(_a.y, _b.y, _c.y);
        if (hi <= yMin || lo > yMax) continue;
        // plane y = p0 + px x + pz z (n.y > 0: never vertical)
        const px = -_n.x / _n.y, pz = -_n.z / _n.y, p0 = _a.y - px * _a.x - pz * _a.z;
        tris.push([_a.x, _a.z, _b.x, _b.z, _c.x, _c.z, p0, px, pz]);
        x0 = Math.min(x0, _a.x, _b.x, _c.x); x1 = Math.max(x1, _a.x, _b.x, _c.x);
        z0 = Math.min(z0, _a.z, _b.z, _c.z); z1 = Math.max(z1, _a.z, _b.z, _c.z);
      }
    }
  }
  if (!tris.length) return () => null;
  const nx = Math.max(1, Math.ceil((x1 - x0) / CELL) + 1), nz = Math.max(1, Math.ceil((z1 - z0) / CELL) + 1);
  const cells = new Array(nx * nz);
  for (const t of tris) {
    const i0 = Math.floor((Math.min(t[0], t[2], t[4]) - x0) / CELL), i1 = Math.floor((Math.max(t[0], t[2], t[4]) - x0) / CELL);
    const j0 = Math.floor((Math.min(t[1], t[3], t[5]) - z0) / CELL), j1 = Math.floor((Math.max(t[1], t[3], t[5]) - z0) / CELL);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) (cells[j * nx + i] ||= []).push(t);
  }
  const EPS = 1e-9;
  return (x, z) => {
    const i = Math.floor((x - x0) / CELL), j = Math.floor((z - z0) / CELL);
    if (i < 0 || j < 0 || i >= nx || j >= nz) return null;
    const list = cells[j * nx + i]; if (!list) return null;
    let best = -Infinity;
    for (const t of list) {
      // point in the triangle (xz projection), edges included
      const d1 = (x - t[2]) * (t[1] - t[3]) - (t[0] - t[2]) * (z - t[3]);
      const d2 = (x - t[4]) * (t[3] - t[5]) - (t[2] - t[4]) * (z - t[5]);
      const d3 = (x - t[0]) * (t[5] - t[1]) - (t[4] - t[0]) * (z - t[1]);
      const neg = d1 < -EPS || d2 < -EPS || d3 < -EPS, pos = d1 > EPS || d2 > EPS || d3 > EPS;
      if (neg && pos) continue;
      const y = t[6] + t[7] * x + t[8] * z;
      if (y > yMin && y <= yMax && y > best) best = y;
    }
    return best > -Infinity ? best : null;
  };
}
