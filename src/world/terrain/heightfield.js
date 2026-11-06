// WorldShape: analytic archipelago height function + baked per-island height tiles.
//   new WorldShape(world, seed)
//   .rawHeight(x,z)          analytic height (no town/harbour edits) — slow-ish, used for planning
//   .addFlatten(zone) / .addDredge(zone)   terrain edits (ports, forts) applied in bake
//   .bake()                  builds tiles: { isl, x0, z0, cell, nx, nz, h:Float32Array, owner:Uint8Array, moist:Float32Array }
//   .height(x,z)             fast bilinear lookup in baked tiles (else coarse world grid)
//   .buildDepthData(res)     -> { res, bounds:{minX,minZ,size}, data } (heights; the texture is made by Islands)
import { createNoise2D, mulberry32, fbm2 } from '../../core/rng.js';
import { HALF_WORLD, WORLD_SIZE } from '../../core/constants.js';

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const FLOOR = -62;
const EMPTY = Object.freeze([]);

export class WorldShape {
  constructor(world, seed) {
    this.world = world;
    this.seed = seed;
    this.islands = world.islands;
    const r = mulberry32(seed * 7 + 3);
    this.n1 = createNoise2D(r); this.n2 = createNoise2D(r); this.n3 = createNoise2D(r); this.n4 = createNoise2D(r);
    this.flats = []; this.dredges = [];
    this.islands.forEach((isl, i) => { isl.index = i; this._prep(isl); });
  }

  _prep(isl) {
    const m = (isl.type === 'mainland') ? 1.0 : 1.0;
    // reach of the island's influence (coast + shelf + drop-off)
    isl.reach = isl.shelfW + isl.dropW + isl.coastAmp + 80;
    if (isl.spine) {
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const [x, z, rad] of isl.spine) {
        x0 = Math.min(x0, x - rad); x1 = Math.max(x1, x + rad); z0 = Math.min(z0, z - rad); z1 = Math.max(z1, z + rad);
      }
      const pad = isl.reach + isl.warp;
      isl.bbox = [x0 - pad, z0 - pad, x1 + pad, z1 + pad];
    } else {
      const R = isl.ringR + isl.ringW + isl.reach;
      isl.bbox = [isl.center[0] - R, isl.center[1] - R, isl.center[0] + R, isl.center[1] + R];
    }
    // clamp to world
    isl.bbox = [Math.max(-HALF_WORLD, isl.bbox[0]), Math.max(-HALF_WORLD, isl.bbox[1]), Math.min(HALF_WORLD, isl.bbox[2]), Math.min(HALF_WORLD, isl.bbox[3])];
    void m;
  }

  // --- signed coast distance for spine islands: returns {d (neg inside), rl (local core radius)} ---
  _spineDist(isl, x, z, out) {
    const o = isl.noiseOff, n1 = this.n1;
    const fw = 1 / 900;
    const wx = x + isl.warp * n1(x * fw + o[0], z * fw);
    const wz = z + isl.warp * n1(x * fw, z * fw + o[1]);
    const sp = isl.spine;
    let best = Infinity, bestR = sp[0][2];
    const k = 220;
    let acc = 0, accW = 0;
    if (sp.length === 1) {
      best = Math.hypot(wx - sp[0][0], wz - sp[0][1]) - sp[0][2];
      bestR = sp[0][2];
    } else {
      // smooth union (exponential smin) of tapered capsules
      for (let i = 0; i < sp.length - 1; i++) {
        const a = sp[i], b = sp[i + 1];
        const bx = b[0] - a[0], bz = b[1] - a[1];
        const t = clamp(((wx - a[0]) * bx + (wz - a[1]) * bz) / (bx * bx + bz * bz), 0, 1);
        const rad = lerp(a[2], b[2], t);
        const d = Math.hypot(wx - a[0] - bx * t, wz - a[1] - bz * t) - rad;
        const e = Math.exp(-d / k);
        acc += e; accW += e * rad;
        if (d < best) { best = d; }
      }
      const sm = -k * Math.log(acc);
      bestR = accW / acc;
      best = sm;
    }
    // coastline wiggle (multi-scale: bays, headlands, small coves)
    const cf = 1 / 520;
    const c = this.n2(x * cf + o[1], z * cf - o[0]) * 0.65 + this.n3(x * cf * 3.1, z * cf * 3.1) * 0.25 + this.n2(x * cf * 9, z * cf * 9 + 50) * 0.1;
    out.d = best + isl.coastAmp * c;
    out.rl = bestR;
    return out;
  }

  // analytic height contribution of a single island at (x,z); returns height (sea floor value outside reach)
  islandHeight(isl, x, z) {
    if (x < isl.bbox[0] || x > isl.bbox[2] || z < isl.bbox[1] || z > isl.bbox[3]) return FLOOR;
    if (isl.type === 'atoll') return this._atollHeight(isl, x, z);
    const s = this._spineDist(isl, x, z, _sd);
    const u = -s.d; // metres inland
    const o = isl.noiseOff;
    let h;
    // cliff mask (low-frequency regions of coast become cliffs)
    let cm = 0;
    if (isl.cliff > 0) cm = smooth(0.15, 0.45, this.n4(x / 700 + o[0], z / 700) * 0.5 + 0.5 * isl.cliff - 0.1 + isl.cliff * 0.35);
    if (u > 0) {
      // beach ramp
      const beach = 1.9 * smooth(0, isl.beachW, u) + 0.6 * smooth(isl.beachW, isl.beachW * 2.5, u);
      // interior rise
      const coreR = Math.max(60, s.rl);
      const ti = smooth(isl.beachW * 0.7, isl.beachW * 0.7 + coreR * 0.95, u);
      let mount = 0;
      if (isl.peak > 12) {
        // ridged multi-octave noise for mountain ridges and valleys
        const f = 1 / 650;
        let rsum = 0, amp = 1, fr = 1, norm = 0;
        for (let oc = 0; oc < 4; oc++) {
          const n = 1 - Math.abs(this.n1(x * f * fr + o[0] * 1.3, z * f * fr - o[1]));
          rsum += n * amp; norm += amp; amp *= 0.45; fr *= 2.03;
        }
        const ridged = rsum / norm;
        const soft = fbm2(this.n2, x / 900 + o[1], z / 900 - o[0], 3) * 0.5 + 0.5;
        mount = Math.pow(ti, 1.6) * isl.peak * (0.25 + 0.45 * ridged + 0.4 * soft);
      } else {
        mount = ti * isl.peak * (0.7 + 0.3 * this.n2(x / 300, z / 300));
      }
      const rolling = isl.hill * fbm2(this.n3, x / 380 + o[1], z / 380, 3) * smooth(isl.beachW, isl.beachW * 4, u);
      h = beach + mount + rolling;
      // cliffs: steep wall right at the coast
      if (cm > 0.01) {
        const ch = isl.cliffH * (0.7 + 0.5 * this.n3(x / 240, z / 240));
        const wall = ch * smooth(0, 16, u) + (u > 16 ? (u - 16) * 0.12 : 0);
        h = lerp(h, Math.max(h, wall), cm);
      }
      // dunes on low islands
      if (isl.peak < 12) h += 1.2 * Math.max(0, this.n4(x / 60, z / 60)) * smooth(isl.beachW * 0.5, isl.beachW * 2, u);
    } else {
      const w = -u; // metres offshore
      const sd = isl.shelfDepth * (1 + cm * 0.8);
      const sw = isl.shelfW * (1 - cm * 0.55);
      h = -sd * Math.pow(smooth(0, sw, w), 0.75);
      h -= isl.dropDepth * smooth(sw * 0.85, sw + isl.dropW, w);
      // sand ripples / coral heads in the shallows
      h += 0.35 * this.n3(x / 23, z / 23) * smooth(0, 40, w) * (1 - smooth(sw, sw + 60, w));
      // fringing reef crest near the shelf edge
      if (isl.reef > 0.05) {
        const rw = sw * 0.78;
        const g = Math.exp(-((w - rw) * (w - rw)) / (2 * 34 * 34)) * 0.85;
        const gaps = smooth(-0.1, 0.35, this.n4(x / 420 + 9, z / 420 - 3)) * isl.reef;
        const crest = -1.1 + 0.35 * this.n2(x / 40, z / 40);
        if (g * gaps > 0.02) h = Math.max(h, lerp(h, crest, g * gaps));
        // coral heads scattered in lagoon
        const heads = this.n1(x / 35 + 3, z / 35 + 7);
        if (heads > 0.7 && w < rw) h = Math.max(h, lerp(h, -1.8, smooth(0.7, 0.9, heads) * isl.reef * 0.8));
      }
    }
    if (isl.volcano) {
      const v = isl.volcano;
      const dv = Math.hypot(x - v.at[0], z - v.at[1]);
      if (dv < v.r * 1.6) {
        const t = clamp(1 - dv / (v.r * 1.6), 0, 1);
        const gully = 1 + 0.18 * this.n1(Math.atan2(z - v.at[1], x - v.at[0]) * 4, dv / 120);
        let vh = v.h * Math.pow(t, 1.7) * gully;
        if (v.crater > 0) vh -= v.crater * 1.8 * smooth(v.crater * 2.4, 0, dv);
        if (u > -40) h = Math.max(h, h * 0.4 + vh) ; // only above-ish water
      }
    }
    return Math.max(h, FLOOR);
  }

  _atollHeight(isl, x, z) {
    const o = isl.noiseOff;
    const dx = x - isl.center[0], dz = z - isl.center[1];
    const ang = Math.atan2(dz, dx);
    const R = isl.ringR * (1 + 0.12 * this.n1(Math.cos(ang) * 1.3 + o[0], Math.sin(ang) * 1.3)) + 40 * this.n2(x / 300, z / 300);
    const dist = Math.hypot(dx, dz);
    const w = Math.abs(dist - R); // distance from ring centreline
    const inside = dist < R;
    let h;
    const ringW = isl.ringW;
    if (w < ringW) {
      // reef flat; motus (islets) where noise says so
      const motu = this.n3(Math.cos(ang) * 2.4 + o[1], Math.sin(ang) * 2.4) + 0.25 * this.n4(x / 90, z / 90);
      // pass in the ring
      let pd = Math.abs(((ang - isl.passAngle + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      const pass = smooth(0.06, 0.13, pd);
      const tc = 1 - w / ringW;
      h = lerp(-5, -0.6 + 0.3 * this.n2(x / 15, z / 15), smooth(0, 0.5, tc) * pass);
      if (motu > 0.25) h = lerp(h, 2.2 * smooth(0, 0.6, tc) + 0.8 * this.n4(x / 40, z / 40), smooth(0.25, 0.45, motu) * smooth(0.1, 0.6, tc) * pass);
    } else if (inside) {
      const q = w - ringW;
      h = -1.2 - 3.6 * smooth(0, 120, q) + 0.5 * this.n2(x / 40, z / 40);
      const heads = this.n1(x / 45 + 1, z / 45 + 2);
      if (heads > 0.6) h = lerp(h, -0.9, smooth(0.6, 0.8, heads));
    } else {
      const q = w - ringW;
      h = -5 - 18 * smooth(0, 90, q) - (isl.dropDepth - 20) * smooth(90, 90 + isl.dropW, q);
    }
    return h;
  }

  seaFloor(x, z) {
    let h = FLOOR + 8 * this.n1(x / 2600, z / 2600);
    for (const b of this.world.banks) {
      let q = ((x - b.x) / b.rx) ** 2 + ((z - b.z) / b.rz) ** 2;
      if (q < 2.3) {
        q += 0.55 * fbm2(this.n4, x / 900 + b.x, z / 900, 3);
        if (q >= 1.6) continue;
        const t = smooth(1.6, 0.5, q);
        h = Math.max(h, lerp(FLOOR, b.depth + 1.2 * this.n2(x / 140, z / 140), t));
      }
    }
    return h;
  }

  rawHeight(x, z, cands = this.islands) {
    let h = this.seaFloor(x, z), owner = -1;
    for (const isl of cands) {
      if (x < isl.bbox[0] || x > isl.bbox[2] || z < isl.bbox[1] || z > isl.bbox[3]) continue;
      const v = this.islandHeight(isl, x, z);
      if (v > h) { h = v; owner = isl.index; }
    }
    this._lastOwner = owner;
    return h;
  }

  // zone: { cx, cz, ax, az (unit inland axis), hw (half width along lateral), d0, d1 (inland range), h0, slope, fall }
  addFlatten(z) { z.ext = (z.circle ? z.r + z.fall : Math.hypot(z.hw + z.fall, Math.max(Math.abs(z.d0), z.d1 + z.fall))) + 2; this.flats.push(z); }
  // dredge: { cx, cz, ax, az (seaward axis), hw, d0, d1, depth, fall }
  addDredge(z) { z.ext = Math.hypot(z.hw + z.fall, Math.max(Math.abs(z.d0), z.d1 + z.fall)) + 2; this.dredges.push(z); }

  editedHeight(x, z, cands) {
    let h = this.rawHeight(x, z, cands);
    for (const f of this.flats) {
      if (Math.abs(x - f.cx) > f.ext || Math.abs(z - f.cz) > f.ext) continue;
      const dx = x - f.cx, dz = z - f.cz;
      if (f.circle) {
        const d = Math.hypot(dx, dz);
        const w = smooth(f.r + f.fall, f.r, d);
        if (w > 0) h = lerp(h, f.h0 + (f.dome || 0) * (1 - d / (f.r + f.fall)), w);
        continue;
      }
      const along = dx * f.ax + dz * f.az;           // inland distance
      const lat = -dx * f.az + dz * f.ax;             // lateral
      const wl = smooth(f.hw + f.fall, f.hw, Math.abs(lat));
      const wa = smooth(f.d0 - 6, f.d0, along) * smooth(f.d1 + f.fall, f.d1, along);
      const w = wl * wa;
      if (w > 0) {
        const target = f.h0 + Math.max(0, along) * f.slope + 0.25 * this.n3(x / 50, z / 50);
        h = lerp(h, target, w);
      }
    }
    for (const d of this.dredges) {
      if (Math.abs(x - d.cx) > d.ext || Math.abs(z - d.cz) > d.ext) continue;
      const dx = x - d.cx, dz = z - d.cz;
      const along = dx * d.ax + dz * d.az;            // seaward distance from quay line
      const lat = -dx * d.az + dz * d.ax;
      const wl = smooth(d.hw + d.fall, d.hw, Math.abs(lat));
      const wa = smooth(d.d0, d.d0 + 10, along) * smooth(d.d1 + d.fall, d.d1, along);
      const w = wl * wa;
      if (w > 0) { const dd = d.shelf ? lerp(d.shelfDepth, d.depth, smooth(d.d0, d.d0 + d.shelf, along)) : d.depth; h = Math.min(h, lerp(h, dd, w)); }
    }
    return h;
  }

  // bake(pre) — pre = { key, tiles[index], grid } baked ahead in Web Workers (prebake.js) for the same edits
  // (editKey); otherwise everything is baked here, as before
  bake(pre = null) {
    const ok = pre && pre.key === this.editKey() && pre.tiles?.length === this.islands.length;
    const tiles = this.tiles = [];
    for (const isl of this.islands) {
      const tile = (ok && pre.tiles[isl.index]) || this.bakeIsland(isl);
      tile.isl = isl;
      tiles.push(tile);
      isl.tile = tile;
    }
    this.prebaked = !!ok;
    // sort tiles: small (fine) tiles first so lookups prefer the finest data
    this.lookupTiles = tiles.slice().sort((a, b) => a.cell - b.cell || (a.nx * a.nz) - (b.nx * b.nz));
    this._indexTiles();
    // coarse world grid for open water
    const G = this.gridRes = 512;
    this.gridCell = WORLD_SIZE / (G - 1);
    this.grid = (ok && pre.grid?.length === G * G && pre.grid) || this.bakeGrid();
  }

  // identity of the edits (quays, forts, channels): tiles baked elsewhere are only used if they are identical
  editKey() { return `${this.seed}|${this.islands.length}|${JSON.stringify(this.flats)}|${JSON.stringify(this.dredges)}`; }

  // one island tile: { x0, z0, cell, nx, nz, x1, z1, h, owner } (isl set by bake)
  bakeIsland(isl) {
    const sx = isl.bbox[2] - isl.bbox[0], sz = isl.bbox[3] - isl.bbox[1];
    // cell size: 4 m for small islands, up to 10 m for giants
    const cell = isl.type === 'mainland' ? 12 : clamp(Math.round(Math.sqrt(sx * sz) / 360), 6, 10);
    const cands = this.islands.filter(o => !(o.bbox[0] > isl.bbox[2] || o.bbox[2] < isl.bbox[0] || o.bbox[1] > isl.bbox[3] || o.bbox[3] < isl.bbox[1]));
    const nx = Math.ceil(sx / cell) + 1, nz = Math.ceil(sz / cell) + 1;
    const h = new Float32Array(nx * nz), owner = new Uint8Array(nx * nz);
    const x0 = isl.bbox[0], z0 = isl.bbox[1];
    // hierarchical: coarse pass (every C cells), refine only blocks near the surface
    const C = 4;
    const cnx = Math.ceil((nx - 1) / C) + 1, cnz = Math.ceil((nz - 1) / C) + 1;
    const ch = new Float32Array(cnx * cnz), co = new Uint8Array(cnx * cnz), done = new Uint8Array(nx * nz);
    for (let j = 0; j < cnz; j++) for (let i = 0; i < cnx; i++) {
      ch[j * cnx + i] = this.editedHeight(x0 + i * C * cell, z0 + j * C * cell, cands);
      co[j * cnx + i] = this._lastOwner === isl.index ? 1 : 0;
    }
    for (let bj = 0; bj < cnz - 1; bj++) for (let bi = 0; bi < cnx - 1; bi++) {
      let mx = -Infinity, own = 0;
      for (let a = -1; a <= 2; a++) for (let b = -1; b <= 2; b++) {
        const ii = Math.min(cnx - 1, Math.max(0, bi + a)), jj = Math.min(cnz - 1, Math.max(0, bj + b));
        mx = Math.max(mx, ch[jj * cnx + ii]); own |= co[jj * cnx + ii];
      }
      const fine = mx > -3.5;
      const h00 = ch[bj * cnx + bi], h10 = ch[bj * cnx + bi + 1], h01 = ch[(bj + 1) * cnx + bi], h11 = ch[(bj + 1) * cnx + bi + 1];
      for (let b = 0; b <= C; b++) {
        const j = bj * C + b; if (j >= nz) break;
        for (let a = 0; a <= C; a++) {
          const i = bi * C + a; if (i >= nx) break;
          const k = j * nx + i;
          if (done[k]) continue;
          done[k] = 1;
          if (fine) {
            h[k] = this.editedHeight(x0 + i * cell, z0 + j * cell, cands);
            owner[k] = this._lastOwner === isl.index ? 1 : 0;
          } else {
            const u = a / C, v = b / C;
            h[k] = (h00 * (1 - u) + h10 * u) * (1 - v) + (h01 * (1 - u) + h11 * u) * v;
            owner[k] = own;
          }
        }
      }
    }
    return { x0, z0, cell, nx, nz, x1: x0 + (nx - 1) * cell, z1: z0 + (nz - 1) * cell, h, owner };
  }

  bakeGrid() {
    const G = 512, gc = WORLD_SIZE / (G - 1), grid = new Float32Array(G * G);
    for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) grid[j * G + i] = this.seaFloor(-HALF_WORLD + i * gc, -HALF_WORLD + j * gc);
    return grid;
  }

  // tile index by 256 m cells (same order as lookupTiles) — height() used to walk the 36 tiles on every call
  // (4.2 million calls for the depth texture, and every ship at every step)
  _indexTiles() {
    const B = this._tbN = 128, bs = this._tbS = WORLD_SIZE / B, idx = this._tb = new Array(B * B);
    for (let j = 0; j < B; j++) for (let i = 0; i < B; i++) {
      const bx0 = -HALF_WORLD + i * bs, bz0 = -HALF_WORLD + j * bs, bx1 = bx0 + bs, bz1 = bz0 + bs;
      const l = this.lookupTiles.filter(t => t.x0 <= bx1 && t.x1 >= bx0 && t.z0 <= bz1 && t.z1 >= bz0);
      idx[j * B + i] = l.length ? l : EMPTY;
    }
  }
  _tilesNear(x, z) {
    if (!this._tb) return this.lookupTiles;
    const B = this._tbN, i = Math.min(B - 1, Math.max(0, Math.floor((x + HALF_WORLD) / this._tbS))), j = Math.min(B - 1, Math.max(0, Math.floor((z + HALF_WORLD) / this._tbS)));
    return this._tb[j * B + i];
  }

  tileAt(x, z) {
    for (const t of this._tilesNear(x, z)) {
      if (x >= t.x0 && x <= t.x1 && z >= t.z0 && z <= t.z1) {
        // only use the tile if it owns this spot (or nobody does)
        const i = Math.round((x - t.x0) / t.cell), j = Math.round((z - t.z0) / t.cell);
        if (t.owner[j * t.nx + i]) return t;
      }
    }
    return null;
  }

  sampleTile(t, x, z) {
    const fx = (x - t.x0) / t.cell, fz = (z - t.z0) / t.cell;
    let i = Math.floor(fx), j = Math.floor(fz);
    if (i >= t.nx - 1) i = t.nx - 2; if (j >= t.nz - 1) j = t.nz - 2;
    if (i < 0) i = 0; if (j < 0) j = 0;
    const u = fx - i, v = fz - j, k = j * t.nx + i, h = t.h;
    // match the triangle split used by the mesh (diagonal from (i,j+1) to (i+1,j))
    if (u + v <= 1) return h[k] + (h[k + 1] - h[k]) * u + (h[k + t.nx] - h[k]) * v;
    return h[k + t.nx + 1] + (h[k + t.nx] - h[k + t.nx + 1]) * (1 - u) + (h[k + 1] - h[k + t.nx + 1]) * (1 - v);
  }

  height(x, z) {
    const t = this.tileAt(x, z);
    if (t) return this.sampleTile(t, x, z);
    // any tile at all covering the point (ownerless area) — use the max of covering tiles
    let best = -Infinity;
    for (const tt of this._tilesNear(x, z)) if (x >= tt.x0 && x <= tt.x1 && z >= tt.z0 && z <= tt.z1) best = Math.max(best, this.sampleTile(tt, x, z));
    if (best > -Infinity) return best;
    const G = this.gridRes, gc = this.gridCell;
    const fx = clamp((x + HALF_WORLD) / gc, 0, G - 1.001), fz = clamp((z + HALF_WORLD) / gc, 0, G - 1.001);
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, g = this.grid, k = j * G + i;
    return lerp(lerp(g[k], g[k + 1], u), lerp(g[k + G], g[k + G + 1], u), v);
  }

  // heights only (half-floats and DataTexture made by Islands) — this module no longer pulls three into the
  // prebake.js Web Worker
  buildDepthData(res = 2048) {
    const data = new Float32Array(res * res);
    const c = WORLD_SIZE / res;
    for (let j = 0; j < res; j++) {
      const z = -HALF_WORLD + (j + 0.5) * c;
      for (let i = 0; i < res; i++) data[j * res + i] = this.height(-HALF_WORLD + (i + 0.5) * c, z);
    }
    return { res, bounds: { minX: -HALF_WORLD, minZ: -HALF_WORLD, size: WORLD_SIZE }, data };
  }
}
const _sd = { d: 0, rl: 0 };
