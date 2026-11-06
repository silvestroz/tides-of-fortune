// Tileable procedural value-noise texture (RGBA = 4 decorrelated noise fields, each a 2-octave blend)
// used by sky / cloud shaders instead of costly ALU hashing. getNoiseTexture() is cached.
import * as THREE from 'three';
import { mulberry32 } from '../../core/rng.js';

let _tex = null;
export function getNoiseTexture(size = 256) {
  if (_tex) return _tex;
  const data = new Uint8Array(size * size * 4);
  const rnd = mulberry32(90210);
  for (let ch = 0; ch < 4; ch++) {
    // lattice of random values at two frequencies, smooth-interpolated, tileable
    const layers = [{ cells: 16, w: 0.7 }, { cells: 32, w: 0.3 }];
    const grids = layers.map(l => { const g = new Float32Array(l.cells * l.cells); for (let i = 0; i < g.length; i++) g[i] = rnd(); return g; });
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      let v = 0;
      layers.forEach((l, li) => {
        const n = l.cells, g = grids[li];
        const fx = x / size * n, fy = y / size * n;
        const x0 = Math.floor(fx), y0 = Math.floor(fy);
        let tx = fx - x0, ty = fy - y0;
        tx = tx * tx * tx * (tx * (tx * 6 - 15) + 10); ty = ty * ty * ty * (ty * (ty * 6 - 15) + 10);
        const x1 = (x0 + 1) % n, y1 = (y0 + 1) % n;
        const a = g[y0 * n + x0], b = g[y0 * n + x1], c = g[y1 * n + x0], d = g[y1 * n + x1];
        v += l.w * ((a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty);
      });
      data[(y * size + x) * 4 + ch] = Math.round(v * 255);
    }
  }
  _tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  _tex.wrapS = _tex.wrapT = THREE.RepeatWrapping;
  _tex.magFilter = THREE.LinearFilter;
  _tex.minFilter = THREE.LinearMipmapLinearFilter;
  _tex.generateMipmaps = true;
  _tex.needsUpdate = true;
  return _tex;
}
