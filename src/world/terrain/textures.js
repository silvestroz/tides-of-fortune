// Procedural textures shared by terrain, vegetation and towns (no external assets).
//   getDetailTexture()  512² tileable RGBA: R = fbm, G = brush streaks, B = cellular/pebbles, A = fine grain
//   getFrondTexture()   palm frond (alpha-tested) canvas texture
//   getFlagAtlas()      canvas atlas of faction flags, 4 columns x 2 rows: english, spanish, french, dutch, pirate, ...
//   FLAG_INDEX          { english:0, spanish:1, french:2, dutch:3, pirate:4 }
import * as THREE from 'three';
import { mulberry32 } from '../../core/rng.js';

let _detail = null, _frond = null, _flags = null;

// tileable gradient noise with integer period
function makePeriodicNoise(period, rand) {
  const g = new Float32Array(period * period * 2);
  for (let i = 0; i < period * period; i++) { const a = rand() * Math.PI * 2; g[i * 2] = Math.cos(a); g[i * 2 + 1] = Math.sin(a); }
  const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const dot = (ix, iy, dx, dy) => {
      const k = (((iy % period) + period) % period) * period + (((ix % period) + period) % period);
      return g[k * 2] * dx + g[k * 2 + 1] * dy;
    };
    const u = fade(xf), v = fade(yf);
    const a = dot(xi, yi, xf, yf), b = dot(xi + 1, yi, xf - 1, yf), c = dot(xi, yi + 1, xf, yf - 1), d = dot(xi + 1, yi + 1, xf - 1, yf - 1);
    return (a + (b - a) * u) + ((c + (d - c) * u) - (a + (b - a) * u)) * v;
  };
}

export function getDetailTexture() {
  if (_detail) return _detail;
  const N = 512, rand = mulberry32(99173);
  const data = new Uint8Array(N * N * 4);
  const ns = [4, 8, 16, 32, 64].map(p => ({ p, f: makePeriodicNoise(p, rand) }));
  const streak = makePeriodicNoise(16, rand), streak2 = makePeriodicNoise(64, rand);
  // cellular points
  const CP = 24, pts = [];
  for (let j = 0; j < CP; j++) for (let i = 0; i < CP; i++) pts.push([(i + rand()) / CP, (j + rand()) / CP]);
  const grain = makePeriodicNoise(128, rand);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N, v = y / N;
    let f = 0, a = 1, n = 0;
    for (const { p, f: fn } of ns) { f += fn(u * p, v * p) * a; n += a; a *= 0.55; }
    f = f / n * 1.6 * 0.5 + 0.5;
    // brush streaks: stretched noise along x with slight warp
    const w = streak(u * 16, v * 16) * 0.3;
    const s = streak2(u * 6 * 64 / 64 * 2 + w, v * 64) * 0.5 + streak(u * 4, v * 16 + w * 3) * 0.5;
    // cellular
    const ci = Math.floor(u * CP), cj = Math.floor(v * CP);
    let d1 = 9, d2 = 9;
    for (let b = -1; b <= 1; b++) for (let a2 = -1; a2 <= 1; a2++) {
      const ii = (ci + a2 + CP) % CP, jj = (cj + b + CP) % CP;
      const p = pts[jj * CP + ii];
      let dx = p[0] + (ci + a2 - ii) / CP - u, dy = p[1] + (cj + b - jj) / CP - v;
      // fix wrap: p is in cell ii,jj; real cell offset is ci+a2
      dx = (ii / CP + (p[0] - ii / CP)) + Math.floor((ci + a2) / CP) - u;
      dx = p[0] + Math.floor((ci + a2) / CP) - u; dy = p[1] + Math.floor((cj + b) / CP) - v;
      const d = Math.hypot(dx, dy) * CP;
      if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
    }
    const cell = Math.min(1, (d2 - d1) * 1.2);
    const gr = grain(u * 128, v * 128) * 0.5 + 0.5;
    const k = (y * N + x) * 4;
    data[k] = Math.max(0, Math.min(255, f * 255));
    data[k + 1] = Math.max(0, Math.min(255, (s * 0.5 + 0.5) * 255));
    data[k + 2] = Math.max(0, Math.min(255, cell * 255));
    data[k + 3] = Math.max(0, Math.min(255, gr * 255));
  }
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true; t.anisotropy = 4;
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  return (_detail = t);
}

function canvas(w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
}

// Palm frond: midrib along v (0 = base, 1 = tip), leaflets hanging to both sides. u = 0..1 across.
export function getFrondTexture() {
  if (_frond) return _frond;
  const W = 128, H = 512, c = canvas(W, H), g = c.getContext('2d');
  const rand = mulberry32(4242);
  g.clearRect(0, 0, W, H);
  const cx = W / 2;
  for (let i = 0; i < 46; i++) {
    const t = i / 46;
    const y = H * (0.04 + t * 0.94);
    const len = (W * 0.5) * Math.sin(Math.min(1, t * 1.15 + 0.08) * Math.PI) * (0.85 + rand() * 0.25);
    for (const side of [-1, 1]) {
      const droop = 26 + rand() * 18;
      const hue = 85 + rand() * 25, l = 26 + rand() * 18 + t * 6;
      g.strokeStyle = `hsl(${hue}, ${48 + rand() * 18}%, ${l}%)`;
      g.lineWidth = 4.2 * (1 - t * 0.5) + 1.5;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(cx, y);
      g.quadraticCurveTo(cx + side * len * 0.55, y + droop * 0.15, cx + side * len, y + droop);
      g.stroke();
      // highlight stroke
      g.strokeStyle = `hsla(${hue + 8}, 60%, ${l + 16}%, 0.55)`;
      g.lineWidth = 1.4;
      g.beginPath(); g.moveTo(cx, y - 1); g.quadraticCurveTo(cx + side * len * 0.55, y + droop * 0.15 - 1.5, cx + side * len * 0.9, y + droop * 0.9 - 1.5); g.stroke();
    }
  }
  // midrib
  g.strokeStyle = '#8a8a3a'; g.lineWidth = 4; g.beginPath(); g.moveTo(cx, 0); g.lineTo(cx, H); g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
  return (_frond = t);
}

export const FLAG_INDEX = { english: 0, spanish: 1, french: 2, dutch: 3, pirate: 4 };

// Original flag designs (period-flavoured, not copied from any game).
export function getFlagAtlas() {
  if (_flags) return _flags;
  const FW = 256, FH = 160, c = canvas(FW * 4, FH * 2), g = c.getContext('2d');
  const draw = (i, fn) => { g.save(); g.translate((i % 4) * FW, Math.floor(i / 4) * FH); g.beginPath(); g.rect(0, 0, FW, FH); g.clip(); fn(); g.restore(); };
  // english: red ensign-like field with white canton bearing a red cross
  draw(0, () => {
    g.fillStyle = '#b8242c'; g.fillRect(0, 0, FW, FH);
    g.fillStyle = '#f4efe2'; g.fillRect(0, 0, FW * 0.45, FH * 0.5);
    g.fillStyle = '#b8242c'; g.fillRect(FW * 0.45 / 2 - 10, 0, 20, FH * 0.5); g.fillRect(0, FH * 0.25 - 9, FW * 0.45, 18);
  });
  // spanish: white field with a ragged red saltire (burgundy cross)
  draw(1, () => {
    g.fillStyle = '#f2ead6'; g.fillRect(0, 0, FW, FH);
    g.strokeStyle = '#a3222a'; g.lineWidth = 20; g.lineCap = 'round';
    const knots = (x0, y0, x1, y1) => { g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
      for (let k = 1; k < 6; k++) { const t = k / 6, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t; g.beginPath(); g.arc(x, y, 13, 0, Math.PI * 2); g.fillStyle = '#a3222a'; g.fill(); } };
    knots(30, 20, FW - 30, FH - 20); knots(FW - 30, 20, 30, FH - 20);
  });
  // french: white field, scattered gold lily-like motifs
  draw(2, () => {
    g.fillStyle = '#f1ecdf'; g.fillRect(0, 0, FW, FH);
    g.fillStyle = '#2e5aa8'; g.fillRect(0, 0, FW, 14); g.fillRect(0, FH - 14, FW, 14);
    g.fillStyle = '#c9a24a';
    for (const [x, y] of [[64, 56], [128, 104], [192, 56], [64, 120], [192, 120], [128, 40]]) {
      g.beginPath(); g.ellipse(x, y - 8, 6, 14, 0, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.ellipse(x - 11, y, 5, 11, -0.7, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.ellipse(x + 11, y, 5, 11, 0.7, 0, Math.PI * 2); g.fill();
      g.fillRect(x - 12, y + 6, 24, 5);
    }
  });
  // dutch: orange / white / blue horizontal tricolour
  draw(3, () => {
    g.fillStyle = '#e07a24'; g.fillRect(0, 0, FW, FH / 3);
    g.fillStyle = '#f3eee2'; g.fillRect(0, FH / 3, FW, FH / 3);
    g.fillStyle = '#23468e'; g.fillRect(0, FH * 2 / 3, FW, FH / 3);
  });
  // pirate: black field, skull over crossed cutlasses (original drawing)
  draw(4, () => {
    g.fillStyle = '#141414'; g.fillRect(0, 0, FW, FH);
    g.strokeStyle = '#e9e2cf'; g.lineWidth = 9; g.lineCap = 'round';
    g.beginPath(); g.moveTo(80, 130); g.quadraticCurveTo(130, 96, 180, 50); g.stroke();
    g.beginPath(); g.moveTo(176, 130); g.quadraticCurveTo(126, 96, 76, 50); g.stroke();
    g.fillStyle = '#e9e2cf';
    g.beginPath(); g.ellipse(128, 66, 30, 28, 0, 0, Math.PI * 2); g.fill();
    g.fillRect(110, 82, 36, 22);
    g.fillStyle = '#141414';
    g.beginPath(); g.ellipse(116, 66, 8, 9, 0, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.ellipse(140, 66, 8, 9, 0, 0, Math.PI * 2); g.fill();
    g.fillRect(120, 90, 4, 14); g.fillRect(128, 90, 4, 14); g.fillRect(136, 90, 4, 14);
  });
  // canvas weave + wear overlay on all flags
  const rand = mulberry32(5);
  g.globalAlpha = 0.08;
  for (let y = 0; y < FH * 2; y += 2) { g.fillStyle = y % 4 ? '#000' : '#fff'; g.fillRect(0, y, FW * 4, 1); }
  g.globalAlpha = 0.12;
  for (let i = 0; i < 900; i++) { g.fillStyle = rand() < 0.5 ? '#3a2a10' : '#fff8e0'; g.fillRect(rand() * FW * 4, rand() * FH * 2, 2 + rand() * 6, 1 + rand() * 2); }
  g.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return (_flags = t);
}
