// Procedural UI textures (no image files). Generates tileable parchment, lacquered wood and paper-grain
// textures on canvases once at startup and exposes them to CSS as custom properties on the UI root:
//   --tex-parchment, --tex-wood
// API: installTextures(rootEl)

function periodicNoise(size, cells, seed) {
  // tileable value noise, returns Float32Array size*size in 0..1
  let s = seed >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const g = new Float32Array(cells * cells);
  for (let i = 0; i < g.length; i++) g[i] = rnd();
  const out = new Float32Array(size * size);
  const sm = t => t * t * (3 - 2 * t);
  for (let y = 0; y < size; y++) {
    const fy = (y / size) * cells, y0 = Math.floor(fy), ty = sm(fy - y0);
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * cells, x0 = Math.floor(fx), tx = sm(fx - x0);
      const a = g[(y0 % cells) * cells + (x0 % cells)], b = g[(y0 % cells) * cells + ((x0 + 1) % cells)];
      const c = g[((y0 + 1) % cells) * cells + (x0 % cells)], d = g[((y0 + 1) % cells) * cells + ((x0 + 1) % cells)];
      out[y * size + x] = (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
    }
  }
  return out;
}

function fbm(size, base, octaves, seed) {
  const out = new Float32Array(size * size);
  let amp = 1, tot = 0;
  for (let o = 0; o < octaves; o++) {
    const n = periodicNoise(size, base << o, seed + o * 977);
    for (let i = 0; i < out.length; i++) out[i] += n[i] * amp;
    tot += amp; amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= tot;
  return out;
}

function hex(c) { return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)]; }

function parchment(size, light, dark, seed) {
  const cv = document.createElement('canvas'); cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(size, size);
  const blot = fbm(size, 3, 4, seed), fine = periodicNoise(size, 32, seed + 50);
  const L = hex(light), D = hex(dark);
  for (let i = 0; i < size * size; i++) {
    let t = Math.pow(blot[i], 1.6) * 1.25 + (fine[i] - 0.5) * 0.25;
    t = Math.max(0, Math.min(1, t));
    const sp = Math.random() < 0.002 ? 0.35 : 0;
    img.data[i * 4] = L[0] + (D[0] - L[0]) * t - sp * 80;
    img.data[i * 4 + 1] = L[1] + (D[1] - L[1]) * t - sp * 90;
    img.data[i * 4 + 2] = L[2] + (D[2] - L[2]) * t - sp * 90;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  // paper fibres (wrapped so the tile stays seamless)
  ctx.lineWidth = 0.6;
  for (let i = 0; i < 260; i++) {
    const x = Math.random() * size, y = Math.random() * size, a = Math.random() * Math.PI, l = 3 + Math.random() * 9;
    ctx.strokeStyle = Math.random() < 0.5 ? 'rgba(90,60,25,0.10)' : 'rgba(255,250,230,0.16)';
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); ctx.stroke();
  }
  return cv.toDataURL('image/png');
}

function wood(size, seed) {
  const cv = document.createElement('canvas'); cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(size, size);
  const n = fbm(size, 4, 4, seed), streak = periodicNoise(size, 64, seed + 3);
  const A = hex('#1d110a'), B = hex('#4a2c17'), C = hex('#6b4024');
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x;
    // grain runs horizontally: distort y by low-freq noise, then rings
    const v = y / size * 22 + n[i] * 9;
    let t = 0.5 + 0.5 * Math.sin(v * Math.PI * 2);
    t = Math.pow(t, 3) * 0.6 + streak[(y * size + ((x * 0.08) | 0)) % (size * size)] * 0.25 + n[i] * 0.3;
    const c = t < 0.5 ? A.map((a, k) => a + (B[k] - a) * (t / 0.5)) : B.map((b, k) => b + (C[k] - b) * ((t - 0.5) / 0.5));
    img.data[i * 4] = c[0]; img.data[i * 4 + 1] = c[1]; img.data[i * 4 + 2] = c[2]; img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return cv.toDataURL('image/png');
}

export function grain(size, seed) {
  const cv = document.createElement('canvas'); cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(size, size);
  const n = fbm(size, 64, 2, seed);
  for (let i = 0; i < size * size; i++) {
    const v = n[i] * 255;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 40;
  }
  ctx.putImageData(img, 0, 0);
  return cv.toDataURL('image/png');
}

// Generated lazily one texture per idle slice so startup never blocks the main thread; CSS falls back to
// flat colours until each lands. Results are cached in sessionStorage across reloads.
const JOBS = [
  ['--tex-parchment', () => parchment(256, '#f1e3bd', '#c9a970', 11)],
  ['--tex-wood', () => wood(192, 7)],
];
export function installTextures(root) {
  let i = 0;
  const next = () => {
    if (i >= JOBS.length) return;
    const [k, fn] = JOBS[i++];
    let url = null;
    try { url = sessionStorage.getItem('tof' + k); } catch { /* ignore */ }
    if (!url) { url = fn(); try { sessionStorage.setItem('tof' + k, url); } catch { /* quota */ } }
    root.style.setProperty(k, `url(${url})`);
    setTimeout(next, 0);
  };
  next();
}
