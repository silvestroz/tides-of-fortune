// Chunked terrain meshes built from WorldShape tiles, 4 LODs (every 1 / 2 / 4 / 8 cells) with skirts, baked
// AO/curvature/moisture in a vec4 attribute.
//   new TerrainMeshes(game, shape, material)
//   .update(camPos)   picks LOD per chunk; lazily builds/disposes full-res chunks
//   .group            THREE.Group
//   .stats()          { chunks, byLod: [n0, n1, n2, n3] } (perf tools)
// LOD choice per chunk (d = horizontal distance to the chunk + altitude above 300 m / 2):
//   - never finer than the distance rule (LOD0 < 1200 m < LOD1 < 3200 m < LOD2), so no chunk costs more than before;
//   - coarser when allowed by both:
//       shading floor: d >= SHADE_FLOOR[L] (450 / 1200 / 3000 m) — normals and the aTerr attribute (AO, moisture,
//         dryness) are per vertex, so a coarse grid near the camera would blur the ground's colours;
//       geometric error: the largest height gap between the full grid and the LOD's grid (measured once per chunk at
//         load, ERR_STEPS), projected on screen, stays under QUALITY tier pixels (PX_TOL; ×0.75 to go coarser:
//         hysteresis). Flat ground goes coarse early; cliffs and peaks keep their detail.
import { QUALITY } from '../../core/constants.js';
import * as THREE from 'three';

const CHUNK = 128;                   // cells per chunk side at LOD0
const LOD_DIST = [1200, 3200];
const STEPS = [1, 2, 4, 8];
const SHADE_FLOOR = [0, 450, 1200, 3000];
const PX_TOL = { low: 3, medium: 2.2, high: 1.5, ultra: 1 };
const SKIRT = 10;

export class TerrainMeshes {
  constructor(game, shape, material) {
    this.game = game; this.shape = shape; this.material = material;
    this.group = new THREE.Group(); this.group.name = 'terrain';
    this.chunks = [];
    for (const t of shape.tiles) this._makeChunks(t);
    for (const c of this.chunks) {
      // start everything at its coarsest LOD; update() refines
      c.lods[3] = this._buildChunk(c, 3);
      c.mesh = new THREE.Mesh(c.lods[3], material);
      c.mesh.matrixAutoUpdate = false; c.mesh.receiveShadow = true;
      c.cur = 3;
      this.group.add(c.mesh);
    }
    game.scene.add(this.group);
  }

  _makeChunks(t) {
    // per-tile moisture & AO grids are computed lazily per chunk
    for (let cj = 0; cj < t.nz - 1; cj += CHUNK) {
      for (let ci = 0; ci < t.nx - 1; ci += CHUNK) {
        const i1 = Math.min(t.nx - 1, ci + CHUNK), j1 = Math.min(t.nz - 1, cj + CHUNK);
        let mx = -Infinity, mn = Infinity, owned = 0;
        for (let j = cj; j <= j1; j++) for (let i = ci; i <= i1; i++) {
          const k = j * t.nx + i;
          if (!t.owner[k]) continue;
          owned++;
          const h = t.h[k]; if (h > mx) mx = h; if (h < mn) mn = h;
        }
        if (!owned || mx < -26) continue;       // fully deep / not ours: ocean covers it
        const x0 = t.x0 + ci * t.cell, z0 = t.z0 + cj * t.cell, x1 = t.x0 + i1 * t.cell, z1 = t.z0 + j1 * t.cell;
        this.chunks.push({
          t, ci, cj, i1, j1, lods: [null, null, null, null], cur: -1, mesh: null,
          center: new THREE.Vector3((x0 + x1) / 2, Math.max(0, mx) / 2, (z0 + z1) / 2),
          half: Math.max(x1 - x0, z1 - z0) / 2, maxH: mx,
          err: [0, this._lodError(t, ci, cj, i1, j1, 2), this._lodError(t, ci, cj, i1, j1, 4), this._lodError(t, ci, cj, i1, j1, 8)],
        });
      }
    }
  }

  // largest height gap (m) between the full grid and the grid every `s` cells (bilinear inside each coarse cell),
  // over the owned ground of the chunk; heights under -3 m count as -3 (the sea hides the difference)
  _lodError(t, ci, cj, i1, j1, s) {
    const H = t.h, nx = t.nx, own = t.owner;
    const h = (i, j) => Math.max(-3, H[j * nx + Math.min(i, i1)]);
    let e = 0;
    for (let J = cj; J < j1; J += s) {
      const Jb = Math.min(J + s, j1);
      for (let I = ci; I < i1; I += s) {
        const Ib = Math.min(I + s, i1);
        const h00 = h(I, J), h10 = h(Ib, J), h01 = h(I, Jb), h11 = h(Ib, Jb), w = Ib - I || 1, d = Jb - J || 1;
        for (let j = J; j <= Jb; j++) {
          const v = (j - J) / d;
          for (let i = I; i <= Ib; i++) {
            const k = j * nx + i;
            if (!own[k]) continue;
            const u = (i - I) / w;
            const b = (h00 * (1 - u) + h10 * u) * (1 - v) + (h01 * (1 - u) + h11 * u) * v;
            const g = Math.abs(Math.max(-3, H[k]) - b);
            if (g > e) e = g;
          }
        }
      }
    }
    return e;
  }

  stats() {
    const byLod = [0, 0, 0, 0];
    for (const c of this.chunks) if (c.cur >= 0) byLod[c.cur]++;
    return { chunks: this.chunks.length, byLod };
  }

  _buildChunk(c, lod) {
    const t = c.t, s = STEPS[lod], H = t.h, nx = t.nx, cell = t.cell;
    const isl = t.isl, shape = this.shape;
    const cols = Math.floor((c.i1 - c.ci) / s) + 1, rows = Math.floor((c.j1 - c.cj) / s) + 1;
    // ensure last row/col hits the chunk edge
    const ix = [], jz = [];
    for (let a = 0; a < cols; a++) ix.push(c.ci + a * s);
    if (ix[ix.length - 1] !== c.i1) ix.push(c.i1);
    for (let b = 0; b < rows; b++) jz.push(c.cj + b * s);
    if (jz[jz.length - 1] !== c.j1) jz.push(c.j1);
    const W = ix.length, R = jz.length;
    const nVerts = W * R + 2 * (W + R) ;
    const pos = new Float32Array(nVerts * 3), nrm = new Float32Array(nVerts * 3), dat = new Float32Array(nVerts * 4);
    const hAt = (i, j) => H[Math.min(t.nz - 1, Math.max(0, j)) * nx + Math.min(nx - 1, Math.max(0, i))];
    const n3 = shape.n3, moistBase = isl.moist, dry = isl.dry || 0;
    // dryness 2 = bare sea stack (terrainMaterial). Decided per vertex by the island that owns the ground there:
    // tiles overlap their neighbours (coplanar duplicates), so a per-tile flag z-fought with the next island's colours
    const bareNear = shape.islands.filter(q => q.bare && q.bbox && !(q.bbox[2] < t.x0 || q.bbox[0] > t.x1 || q.bbox[3] < t.z0 || q.bbox[1] > t.z1));
    const dryAt = (i, j, x, z) => {
      if (!bareNear.length && !isl.bare) return dry;
      if (t.owner[Math.min(t.nz - 1, Math.max(0, j)) * nx + Math.min(nx - 1, Math.max(0, i))]) return isl.bare ? 2 : dry;
      shape.rawHeight(x, z); const o = shape._lastOwner;
      return o >= 0 && shape.islands[o]?.bare ? 2 : dry;
    };
    const aoDirs = 8, aoSteps = [1, 2, 4, 7, 12];
    let v = 0;
    const writeVert = (i, j, yOff) => {
      const x = t.x0 + i * cell, z = t.z0 + j * cell, h = hAt(i, j);
      pos[v * 3] = x; pos[v * 3 + 1] = h + yOff; pos[v * 3 + 2] = z;
      const gx = (hAt(i + 1, j) - hAt(i - 1, j)) / (2 * cell), gz = (hAt(i, j + 1) - hAt(i, j - 1)) / (2 * cell);
      const il = 1 / Math.sqrt(gx * gx + 1 + gz * gz);
      nrm[v * 3] = -gx * il; nrm[v * 3 + 1] = il; nrm[v * 3 + 2] = -gz * il;
      // horizon AO
      let occ = 0;
      for (let d = 0; d < aoDirs; d++) {
        const a = d / aoDirs * Math.PI * 2, dx = Math.cos(a), dz = Math.sin(a);
        let maxS = 0;
        for (const st of aoSteps) {
          const hh = hAt(i + Math.round(dx * st), j + Math.round(dz * st));
          const sl = (hh - h) / (st * cell);
          if (sl > maxS) maxS = sl;
        }
        occ += maxS / Math.sqrt(1 + maxS * maxS);
      }
      const ao = 1 - Math.min(1, occ / aoDirs * 1.35);
      // curvature (laplacian over 3 cells) — positive = ridge/convex
      const r = 3;
      const lap = (4 * h - hAt(i + r, j) - hAt(i - r, j) - hAt(i, j + r) - hAt(i, j - r)) / (r * cell);
      const moist = Math.min(1, Math.max(0, moistBase + 0.28 * n3(x / 700 + 11, z / 700 - 4) - 0.18 * Math.max(0, lap)));
      dat[v * 4] = ao; dat[v * 4 + 1] = moist; dat[v * 4 + 2] = Math.max(-1, Math.min(1, lap * 0.8)); dat[v * 4 + 3] = dryAt(i, j, x, z);
      v++;
    };
    for (let b = 0; b < R; b++) for (let a = 0; a < W; a++) writeVert(ix[a], jz[b], 0);
    const idx = [];
    for (let b = 0; b < R - 1; b++) for (let a = 0; a < W - 1; a++) {
      const k = b * W + a;
      // split along (i,j+1)-(i+1,j) to match WorldShape.sampleTile
      idx.push(k, k + W, k + 1, k + 1, k + W, k + W + 1);
    }
    // skirts: duplicate edge verts pushed down, stitched to the edge
    const edge = (list, flip) => {
      const start = v;
      for (const [a, b] of list) writeVert(ix[a], jz[b], -SKIRT);
      for (let e = 0; e < list.length - 1; e++) {
        const top0 = list[e][1] * W + list[e][0], top1 = list[e + 1][1] * W + list[e + 1][0];
        const bot0 = start + e, bot1 = start + e + 1;
        if (flip) idx.push(top0, top1, bot0, bot0, top1, bot1); else idx.push(top0, bot0, top1, bot0, bot1, top1);
      }
    };
    const north = [], south = [], west = [], east = [];
    for (let a = 0; a < W; a++) { north.push([a, 0]); south.push([a, R - 1]); }
    for (let b = 0; b < R; b++) { west.push([0, b]); east.push([W - 1, b]); }
    edge(north, true); edge(south, false); edge(west, false); edge(east, true);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0, v * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nrm.subarray(0, v * 3), 3));
    g.setAttribute('aTerr', new THREE.BufferAttribute(dat.subarray(0, v * 4), 4));
    g.setIndex(v > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
    g.boundingSphere = new THREE.Sphere(c.center.clone().setY(c.maxH * 0.5), c.half * 1.5 + Math.max(0, c.maxH));
    g.boundingBox = new THREE.Box3(new THREE.Vector3(c.center.x - c.half, -70, c.center.z - c.half), new THREE.Vector3(c.center.x + c.half, c.maxH + 1, c.center.z + c.half));
    return g;
  }

  update(cam, force = false) {
    let built = 0;
    const camera = this.game.camera;
    const K = innerHeight / (2 * Math.tan((camera?.fov ?? 50) * Math.PI / 360));   // pixels per metre at 1 m
    const tol = PX_TOL[QUALITY.tier] ?? PX_TOL.high;
    for (const c of this.chunks) {
      const d = Math.max(0, Math.hypot(cam.x - c.center.x, cam.z - c.center.z) - c.half * 0.7) + Math.max(0, cam.y - 300) * 0.5;
      const near = d < LOD_DIST[0] ? 0 : d < LOD_DIST[1] ? 1 : 2;
      let want = near;
      for (let L = 3; L > near; L--) {
        if (d < SHADE_FLOOR[L]) continue;
        const px = c.err[L] * K / Math.max(d, 1);
        if (px < (L > c.cur ? tol * 0.75 : tol)) { want = L; break; }
      }
      if (want === c.cur) continue;
      if (!c.lods[want]) {
        if (!force && built >= 3) continue;      // spread builds across frames
        c.lods[want] = this._buildChunk(c, want); built++;
      }
      c.mesh.geometry = c.lods[want];
      c.cur = want;
      // free full-res geometry when far
      if (want >= 2 && c.lods[0]) { c.lods[0].dispose(); c.lods[0] = null; }
    }
  }
}
