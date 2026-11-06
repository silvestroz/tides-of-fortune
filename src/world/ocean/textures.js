// Procedural, tileable textures for the ocean (generated once on the CPU, no asset files).
//   getDetailNormalTexture()  RGBA8 tangent-space normal map (xy in rg, height in b), tileable, 256²
//   getFoamTexture()          RGBA8 tileable: r = fbm value noise, g = bubbly cellular foam, b = fine streak noise, a = coarse noise
import * as THREE from 'three';
import { mulberry32 } from '../../core/rng.js';

let _normal = null, _foam = null;

function finish(tex) {
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

// Sum of integer-wavevector sinusoids => perfectly tileable; analytic derivatives => exact normals.
export function getDetailNormalTexture() {
  if (_normal) return _normal;
  const N = 256, rnd = mulberry32(9137);
  const waves = [];
  for (let i = 0; i < 40; i++) {
    const f = 1 + Math.floor(Math.pow(rnd(), 1.6) * 14);             // cycles per tile
    const ang = (rnd() - 0.5) * Math.PI * 1.5;                         // biased toward +x (wind axis)
    let kx = Math.round(Math.cos(ang) * f), ky = Math.round(Math.sin(ang) * f);
    if (kx === 0 && ky === 0) kx = 1;
    const kl = Math.hypot(kx, ky);
    waves.push({ kx, ky, a: 0.5 / Math.pow(kl, 1.2), p: rnd() * Math.PI * 2 });
  }
  const H = new Float32Array(N * N), DX = new Float32Array(N * N), DY = new Float32Array(N * N);
  let maxD = 0, minH = 1e9, maxH = -1e9;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let h = 0, dx = 0, dy = 0;
    const u = x / N * Math.PI * 2, v = y / N * Math.PI * 2;
    for (const w of waves) {
      const th = w.kx * u + w.ky * v + w.p;
      // sharpened crests (trochoid-like): use sin + small harmonic
      const s = Math.sin(th), c = Math.cos(th);
      h += w.a * (s - 0.25 * Math.cos(2 * th));
      const d = w.a * (c + 0.5 * Math.sin(2 * th));
      dx += d * w.kx; dy += d * w.ky;
    }
    const i = y * N + x;
    H[i] = h; DX[i] = dx; DY[i] = dy;
    maxD = Math.max(maxD, Math.abs(dx), Math.abs(dy)); minH = Math.min(minH, h); maxH = Math.max(maxH, h);
  }
  const data = new Uint8Array(N * N * 4);
  for (let i = 0; i < N * N; i++) {
    data[i * 4] = Math.round((-DX[i] / maxD * 0.5 + 0.5) * 255);
    data[i * 4 + 1] = Math.round((-DY[i] / maxD * 0.5 + 0.5) * 255);
    data[i * 4 + 2] = Math.round((H[i] - minH) / (maxH - minH) * 255);
    data[i * 4 + 3] = 255;
  }
  _normal = finish(new THREE.DataTexture(data, N, N, THREE.RGBAFormat));
  return _normal;
}

function valueNoiseTile(N, cells, rnd) {
  const g = new Float32Array(cells * cells);
  for (let i = 0; i < g.length; i++) g[i] = rnd();
  const out = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const fx = x / N * cells, fy = y / N * cells;
    const ix = Math.floor(fx), iy = Math.floor(fy);
    let tx = fx - ix, ty = fy - iy;
    tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
    const x1 = (ix + 1) % cells, y1 = (iy + 1) % cells;
    const a = g[iy * cells + ix], b = g[iy * cells + x1], c = g[y1 * cells + ix], d = g[y1 * cells + x1];
    out[y * N + x] = a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
  }
  return out;
}

function fbmTile(N, base, oct, rnd) {
  const out = new Float32Array(N * N);
  let amp = 0.5, tot = 0;
  for (let o = 0; o < oct; o++) {
    const n = valueNoiseTile(N, base << o, rnd);
    for (let i = 0; i < out.length; i++) out[i] += n[i] * amp;
    tot += amp; amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= tot;
  return out;
}

function normalize01(a) {
  let lo = 1e9, hi = -1e9;
  for (const v of a) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  for (let i = 0; i < a.length; i++) a[i] = (a[i] - lo) / (hi - lo);
  return a;
}

// tileable cellular (Worley F2-F1) -> bubbly foam lattice
function cellTile(N, cells, rnd) {
  const pts = [];
  for (let i = 0; i < cells * cells; i++) pts.push([rnd(), rnd()]);
  const out = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const fx = x / N * cells, fy = y / N * cells;
    const ix = Math.floor(fx), iy = Math.floor(fy);
    let f1 = 9, f2 = 9;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      const cx = ix + ox, cy = iy + oy;
      const p = pts[((cy + cells) % cells) * cells + ((cx + cells) % cells)];
      const d = Math.hypot(cx + p[0] - fx, cy + p[1] - fy);
      if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
    }
    out[y * N + x] = f2 - f1;
  }
  return out;
}

export function getFoamTexture() {
  if (_foam) return _foam;
  const N = 256, rnd = mulberry32(4242);
  const r = normalize01(fbmTile(N, 4, 5, rnd));
  const c1 = normalize01(cellTile(N, 12, rnd)), c2 = normalize01(cellTile(N, 26, rnd));
  const g = new Float32Array(N * N);
  const b0 = normalize01(fbmTile(N, 8, 4, rnd));
  // lacy foam: bright bubble walls (cell edges, F2-F1 ≈ 0) at two scales, holes in the cell centres
  for (let i = 0; i < g.length; i++) {
    const l1 = Math.pow(1 - c1[i], 3.0), l2 = Math.pow(1 - c2[i], 4.0);
    // organic: lattice strength varies with fbm, some cells fill in solid
    const solid = Math.max(0, r[i] - 0.55) * 2.2;
    g[i] = Math.min(1, (l1 * 0.7 + l2 * 0.5) * (0.55 + r[i] * 0.9) + solid * 0.6 + b0[i] * 0.2);
  }
  normalize01(g);
  const b = normalize01(fbmTile(N, 16, 3, rnd));
  const a = normalize01(fbmTile(N, 2, 3, rnd));
  const data = new Uint8Array(N * N * 4);
  for (let i = 0; i < N * N; i++) {
    data[i * 4] = r[i] * 255; data[i * 4 + 1] = g[i] * 255; data[i * 4 + 2] = b[i] * 255; data[i * 4 + 3] = a[i] * 255;
  }
  _foam = finish(new THREE.DataTexture(data, N, N, THREE.RGBAFormat));
  return _foam;
}
