// Procedural canvas textures for duel figures (painterly cloth, leather, skin, steel).
import * as THREE from 'three';

const cache = new Map();
function hash(x, y, s) { let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967295; }
function vnoise(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi, s), b = hash(xi + 1, yi, s), c = hash(xi, yi + 1, s), d = hash(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, s, o = 4) { let t = 0, a = 0.5, f = 1; for (let i = 0; i < o; i++) { t += a * vnoise(x * f, y * f, s + i * 7); a *= 0.5; f *= 2.03; } return t; }

function makeTex(key, W, H, fn, { repeat = [1, 1], srgb = true } = {}) {
  if (cache.has(key)) return cache.get(key);
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(W, H), d = img.data;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const o = (y * W + x) * 4; const r = fn(x / W, y / H, x, y);
    d[o] = r[0] * 255; d[o + 1] = r[1] * 255; d[o + 2] = r[2] * 255; d[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat);
  t.anisotropy = 4;
  cache.set(key, t);
  return t;
}

// wool / broadcloth: grey-scale (tinted by material.color), brush mottling + twill
export function clothTex() {
  return makeTex('cloth', 256, 256, (u, v, x, y) => {
    const m = 0.78 + 0.22 * fbm(u * 6, v * 6, 3);
    const tw = 0.93 + 0.07 * (((x + y * 2) % 6) < 3 ? 1 : 0);
    const streak = 0.96 + 0.04 * vnoise(u * 3, v * 40, 9);
    // painted fold shading: soft vertical creases with a lit ridge / dark valley
    const fo = Math.sin(u * Math.PI * 2 * 7 + 1.8 * fbm(u * 3, v * 2, 4)) ;
    const fold = 1 + 0.09 * fo * (0.4 + 0.6 * v);
    const k = m * tw * streak * fold;
    return [k, k, k * 0.98];
  });
}
// coat body: coloured broadcloth with gold-braid bands along the hem and front edges (lathe u wraps, canvas y=0 = top)
export function coatTex(coat = [0.5, 0.1, 0.1], trim = [0.85, 0.66, 0.28]) {
  const key = 'coat' + coat.map(c => c.toFixed(3)).join(',') + trim.map(c => c.toFixed(3)).join(',');
  return makeTex(key, 512, 512, (u, v, x, y) => {
    const m = 0.8 + 0.2 * fbm(u * 10, v * 10, 5);
    const tw = 0.95 + 0.05 * (((x + y * 2) % 6) < 3 ? 1 : 0);
    const dEdge = Math.min(u, 1 - u) * 6.0, hem = v;   // v grows downward on canvas; flipY maps hem (lathe v=0) to canvas bottom
    const band = (d, w0, w1) => d > w0 && d < w1;
    const isTrim = band(dEdge, 0.02, 0.16) || band(hem, 0.94, 0.985) || band(dEdge, 0.22, 0.25) || band(hem, 0.9, 0.915);
    if (isTrim) {
      const braid = 0.78 + 0.22 * Math.abs(Math.sin((x + y) * 0.9));
      const n = 0.85 + 0.15 * vnoise(x * 0.3, y * 0.3, 2);
      return trim.map(c => Math.min(1, c * braid * n * 1.1));
    }
    // embroidered scrollwork above the hem and along the fronts: thin gilt curls (sine vines with leaf buds)
    const hv = (hem - 0.72) / 0.17, ev = (dEdge - 0.3) / 0.5;
    let emb = 0;
    if (hv > 0 && hv < 1) { const yy = 0.5 + 0.32 * Math.sin(u * 140); emb = Math.max(emb, 1 - Math.abs(hv - yy) * 14); const bud = Math.hypot((u * 140 / Math.PI % 2) - 1, (hv - 0.5) * 3); emb = Math.max(emb, (1 - bud * 2.4) * 0.9); }
    if (ev > 0 && ev < 1) { const xx = 0.5 + 0.3 * Math.sin(v * 90); emb = Math.max(emb, 1 - Math.abs(ev - xx) * 12); }
    emb = Math.max(0, Math.min(1, emb));
    // painted folds: vertical creases, darker toward the hem
    const fold = 1 + 0.1 * Math.sin(u * Math.PI * 2 * 9 + 2 * fbm(u * 4, v * 2, 6)) * (0.3 + 0.7 * v);
    const k = m * tw * fold;
    const base = coat.map(c => c * k);
    return emb > 0 ? base.map((c, i) => c + (trim[i] * 0.95 - c) * emb * 0.85) : base;
  });
}
export function leatherTex() {
  return makeTex('leather', 256, 256, (u, v) => {
    const m = 0.7 + 0.3 * fbm(u * 8, v * 8, 11);
    const cr = vnoise(u * 60, v * 60, 12) > 0.82 ? 0.85 : 1;
    // scuffs (lighter worn patches) + a saddle-stitch seam
    const scuff = 1 + 0.18 * Math.max(0, fbm(u * 5, v * 5, 13) - 0.55) * 3;
    const st = (Math.abs(u - 0.5) < 0.006 && Math.floor(v * 64) % 2 === 0) ? 1.35 : 1;
    const k = m * cr * scuff * st; return [k, k * 0.96, k * 0.92];
  });
}
export function skinTex() {
  return makeTex('skin', 128, 128, (u, v) => {
    const m = 0.9 + 0.1 * fbm(u * 5, v * 5, 21);
    const blush = 0.03 * fbm(u * 2, v * 2, 22);
    return [m + blush, m - blush * 0.5, m - blush];
  });
}
// steel blade: brushed streaks along v
export function steelTex() {
  return makeTex('steel', 64, 256, (u, v) => {
    const s = 0.8 + 0.2 * vnoise(u * 40, v * 2, 31);
    const pit = vnoise(u * 20, v * 80, 32) > 0.9 ? 0.85 : 1;
    const k = s * pit; return [k, k, k];
  });
}
// deck-cloth sailor shirts: stripes option
export function stripeTex() {
  return makeTex('stripe', 128, 128, (u, v) => {
    const s = Math.floor(v * 14) % 2 ? 1 : 0.32;
    const m = 0.9 + 0.1 * fbm(u * 6, v * 6, 41);
    return [s * m, s * m, s * m * 1.02];
  });
}
// duel deck: weathered planks with dark caulked seams, butt joints, treenails / iron nails, wear and stains.
// u across the deck (planks run along v), canvas 512 x 1024
export function deckTex() {
  return makeTex('duelDeck', 512, 1024, (u, v, x, y) => {
    const N = 8, pu = u * N, pi = Math.floor(pu), pf = pu - pi;
    const r = hash(pi, 0, 77);
    // butt joints staggered per plank
    const seg = 2.2 + r * 1.2, pv = v * seg + r * 3.1, si = Math.floor(pv), sf = pv - si;
    const rr = hash(pi, si, 78);
    const tone = 0.82 + 0.26 * rr;
    // grain: stretched noise along the plank + knots
    const grain = 0.82 + 0.18 * fbm(pf * 3 + rr * 9, v * 40, 81) + 0.06 * Math.sin((pf * 18 + fbm(pf * 2, v * 6, 82) * 6) * 3.1);
    const wear = 1 + 0.12 * (fbm(u * 3, v * 3, 83) - 0.5) * 2;
    let k = tone * grain * wear;
    const stain = fbm(u * 2.5, v * 2.5, 84); if (stain > 0.62) k *= 1 - (stain - 0.62) * 1.4;
    // seams: dark pitch between planks, a lit edge on one side
    const seam = Math.min(pf, 1 - pf) * 512 / N;
    if (seam < 1.6) k *= 0.22; else if (seam < 3) k *= 0.7; else if (pf < 0.06) k *= 1.08;
    const bj = Math.min(sf, 1 - sf) * 1024 / seg;
    if (bj < 1.2) k *= 0.3; else if (bj < 2.5) k *= 0.75;
    // nails: two per plank near each butt joint
    for (const nv of [0.03, 0.97]) for (const nu of [0.25, 0.75]) {
      const d = Math.hypot((pf - nu) * 512 / N, (sf - nv) * 1024 / seg);
      if (d < 2.6) k *= d < 1.6 ? 0.25 : 0.6; else if (d < 3.6) k *= 1.1;
    }
    return [0.66 * k, 0.45 * k, 0.27 * k];
  }, { repeat: [1, 1] });
}
