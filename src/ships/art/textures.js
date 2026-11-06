// Procedural, hand-painted-feel textures shared by every ship (generated once, cached).
//   getWoodTex()   RGBA data: R albedo multiplier (grain, plank tone, knots), G height (seams/grain, for bump),
//                  B weathering / paint-chip mask, A brush-streak noise.  Tiles; 8 planks across V, ~6 m along U.
//   getCanvasTex() RGBA data: R/G/B tint multiplier (cloth seams, patches, stains), A hole/tear noise.
//   getFlagTex(faction)  CanvasTexture: ensign in v∈[0.34,1], pennant strip in v∈[0,0.3].
import * as THREE from 'three';
import { fbm, hash2, mulberry32, clamp01, smooth } from './noise.js';

let _wood = null, _canvas = null;
const _flags = {};

function dataTex(data, w, h, repeat = true) {
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  t.wrapS = t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true; t.anisotropy = 4; t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

export function getWoodTex() {
  if (_wood) return _wood;
  const W = 512, H = 512, PL = 8;
  const d = new Uint8Array(W * H * 4);
  const rnd = mulberry32(9127);
  // per-plank butt joint positions (staggered) and tones
  const planks = [];
  for (let p = 0; p < PL; p++) {
    const joints = []; let x = rnd() * 0.5;
    while (x < 1) { joints.push(x); x += 0.42 + rnd() * 0.35; }
    planks.push({ joints, tone: [0.82 + rnd() * 0.3, 0.82 + rnd() * 0.3, 0.82 + rnd() * 0.3, 0.82 + rnd() * 0.3] , seed: (rnd() * 1000) | 0 });
  }
  const knots = [];
  for (let i = 0; i < 26; i++) knots.push([rnd(), rnd(), 0.004 + rnd() * 0.006]);
  for (let y = 0; y < H; y++) {
    const v = y / H, pv = v * PL, pi = Math.floor(pv), pf = pv - pi;
    const pl = planks[pi];
    for (let x = 0; x < W; x++) {
      const u = x / W;
      // which board segment along the plank
      let seg = 0; for (let j = 0; j < pl.joints.length; j++) if (u > pl.joints[j]) seg = j + 1;
      const tone = pl.tone[seg % 4];
      // grain: stretched noise along u with wobble
      const wob = fbm(u, v, 3, 12, pl.seed, 3) * 0.6;
      const g1 = fbm(u, v * 1 + wob * 0.05, 4, 96, pl.seed + seg * 7, 3);
      const rings = 0.5 + 0.5 * Math.sin((v * PL * 18 + wob * 9 + seg * 3.1) );
      let grain = 0.78 + 0.22 * g1 + 0.08 * (rings - 0.5);
      // knots
      for (const k of knots) {
        let dx = Math.abs(u - k[0]); dx = Math.min(dx, 1 - dx); let dy = Math.abs(v - k[1]); dy = Math.min(dy, 1 - dy);
        const dd = Math.sqrt((dx * 0.35) ** 2 + dy * dy);
        if (dd < k[2] * 2.2) grain *= 0.72 + 0.28 * smooth(0, k[2] * 2.2, dd);
      }
      // seams between planks (v) and butt joints (u)
      const seamV = Math.min(pf, 1 - pf) * (H / PL);           // pixels to plank edge
      let seamU = 99; for (const j of pl.joints) seamU = Math.min(seamU, Math.abs(u - j) * W);
      const seam = Math.min(smooth(0, 2.2, seamV), smooth(0, 1.5, seamU));
      const edgeLight = smooth(1.5, 3.5, seamV) * (1 - smooth(3.5, 7, seamV)) * (pf < 0.5 ? 0.06 : -0.03); // bevel catch-light
      const alb = clamp01(grain * tone * (0.45 + 0.55 * seam) + edgeLight);
      const hgt = clamp01(0.25 + 0.6 * seam + 0.15 * g1);
      // weathering mask: blotchy large-scale + fine speckle (paint chips where high)
      const wm = clamp01(fbm(u, v, 4, 4, 77, 4) * 0.85 + hash2(x, y, 3) * 0.15 + (1 - seam) * 0.4);
      const brush = fbm(u, v, 2, 40, 55, 3);
      const i = (y * W + x) * 4;
      d[i] = alb * 200; d[i + 1] = hgt * 255; d[i + 2] = wm * 255; d[i + 3] = brush * 255;
    }
  }
  _wood = dataTex(d, W, H);
  return _wood;
}

export function getCanvasTex() {
  if (_canvas) return _canvas;
  const W = 512, H = 512;
  const d = new Uint8Array(W * H * 4);
  const rnd = mulberry32(4411);
  const patches = [];
  for (let i = 0; i < 7; i++) patches.push([rnd(), rnd(), 0.012 + rnd() * 0.025, 0.015 + rnd() * 0.03, 0.9 + rnd() * 0.1, rnd() < 0.5]);
  const CL = 14; // cloths across U
  for (let y = 0; y < H; y++) {
    const v = y / H;
    for (let x = 0; x < W; x++) {
      const u = x / W;
      const cu = u * CL, cf = cu - Math.floor(cu);
      const cloth = Math.floor(cu);
      const seamD = Math.min(cf, 1 - cf) * (W / CL);
      const seam = 1 - 0.22 * (1 - smooth(0.4, 1.6, seamD)) + 0.05 * (1 - smooth(1.6, 3.2, seamD)) * (cf < 0.5 ? 1 : 0);
      const weave = 0.97 + 0.03 * ((x + y) % 2) ;
      const clothTone = 0.95 + 0.07 * hash2(cloth, 0, 9);
      const stain = fbm(u, v, 3, 3, 21, 4);
      const fine = fbm(u, v, 16, 16, 22, 3);
      let r = clothTone * seam * weave * (0.9 + 0.1 * fine) * (0.9 + 0.12 * stain);
      let g = r, b = r * (0.98 - 0.06 * (1 - stain));
      for (const p of patches) {
        let dx = Math.abs(u - p[0]); dx = Math.min(dx, 1 - dx); let dy = Math.abs(v - p[1]); dy = Math.min(dy, 1 - dy);
        if (dx < p[2] && dy < p[3]) {
          const edge = Math.min(p[2] - dx, p[3] - dy) * W;
          const stitch = edge < 1.2 ? 0.88 : (edge < 2.5 && ((x + y) % 4 < 2) ? 0.93 : 1);
          r *= p[4] * stitch; g *= p[4] * stitch * (p[5] ? 0.97 : 1.0); b *= p[4] * stitch * (p[5] ? 0.9 : 1.02);
        }
      }
      const holes = fbm(u, v, 6, 6, 101, 4) * 0.75 + fbm(u, v, 24, 24, 103, 2) * 0.25;
      const i = (y * W + x) * 4;
      d[i] = clamp01(r) * 255; d[i + 1] = clamp01(g) * 255; d[i + 2] = clamp01(b) * 255; d[i + 3] = holes * 255;
    }
  }
  _canvas = dataTex(d, W, H);
  return _canvas;
}

// ---------------- Flags ----------------
function cloth(ctx, w, h, seed) {
  // subtle hand-painted cloth texture overlay
  const r = mulberry32(seed);
  ctx.save();
  ctx.globalAlpha = 0.07;
  for (let i = 0; i < 260; i++) {
    ctx.fillStyle = r() < 0.5 ? '#000' : '#fff';
    const x = r() * w, y = r() * h;
    ctx.fillRect(x, y, 8 + r() * 40, 1 + r() * 2);
  }
  ctx.restore();
}

function skull(ctx, cx, cy, s) {
  // original stylised skull over crossed cutlasses
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = '#efe9da'; ctx.strokeStyle = '#efe9da';
  // crossed cutlasses (curved blades)
  for (const sg of [-1, 1]) {
    ctx.save(); ctx.scale(sg, 1); ctx.rotate(-0.62);
    ctx.beginPath();
    ctx.moveTo(-s * 1.15, s * 0.04); ctx.quadraticCurveTo(0, -s * 0.16, s * 1.12, -s * 0.12);
    ctx.lineTo(s * 1.18, s * 0.02); ctx.quadraticCurveTo(0, s * 0.02, -s * 1.15, s * 0.12); ctx.closePath(); ctx.fill();
    ctx.fillRect(-s * 1.3, -s * 0.12, s * 0.06, s * 0.34);       // guard
    ctx.fillRect(-s * 1.52, s * 0.02, s * 0.24, s * 0.09);       // grip
    ctx.restore();
  }
  // cranium
  ctx.beginPath(); ctx.ellipse(0, -s * 0.12, s * 0.5, s * 0.46, 0, 0, Math.PI * 2); ctx.fill();
  // jaw
  ctx.beginPath(); ctx.moveTo(-s * 0.3, s * 0.15); ctx.lineTo(s * 0.3, s * 0.15); ctx.lineTo(s * 0.22, s * 0.5); ctx.lineTo(-s * 0.22, s * 0.5); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#121212';
  // eye sockets (heavy brow — slightly sinister)
  for (const sg of [-1, 1]) {
    ctx.beginPath(); ctx.moveTo(sg * s * 0.05, -s * 0.12); ctx.quadraticCurveTo(sg * s * 0.2, -s * 0.3, sg * s * 0.36, -s * 0.14);
    ctx.quadraticCurveTo(sg * s * 0.24, s * 0.06, sg * s * 0.06, -s * 0.02); ctx.closePath(); ctx.fill();
  }
  // nose
  ctx.beginPath(); ctx.moveTo(0, s * 0.05); ctx.lineTo(-s * 0.07, s * 0.2); ctx.lineTo(s * 0.07, s * 0.2); ctx.closePath(); ctx.fill();
  // teeth
  ctx.lineWidth = s * 0.03; ctx.strokeStyle = '#121212';
  for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.moveTo(i * s * 0.08, s * 0.3); ctx.lineTo(i * s * 0.08, s * 0.48); ctx.stroke(); }
  ctx.beginPath(); ctx.moveTo(-s * 0.25, s * 0.38); ctx.lineTo(s * 0.25, s * 0.38); ctx.stroke();
  // crack
  ctx.beginPath(); ctx.moveTo(s * 0.12, -s * 0.55); ctx.lineTo(s * 0.18, -s * 0.42); ctx.lineTo(s * 0.12, -s * 0.34); ctx.stroke();
  ctx.restore();
}

function drawEnsign(ctx, f, x0, y0, w, h) {
  ctx.save(); ctx.beginPath(); ctx.rect(x0, y0, w, h); ctx.clip(); ctx.translate(x0, y0);
  if (f === 'english') {
    // original period-style red ensign with a canton bearing a white-on-red cross
    ctx.fillStyle = '#a5232b'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#f1ece0'; ctx.fillRect(0, 0, w * 0.4, h * 0.5);
    ctx.fillStyle = '#b3262e'; ctx.fillRect(w * 0.165, 0, w * 0.07, h * 0.5); ctx.fillRect(0, h * 0.2, w * 0.4, h * 0.1);
    ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 2; ctx.strokeRect(0, 0, w * 0.4, h * 0.5);
  } else if (f === 'spanish') {
    // white field with a red ragged saltire (period motif)
    ctx.fillStyle = '#f0eadb'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#b0242a'; ctx.lineWidth = h * 0.11; ctx.lineCap = 'butt';
    for (const [a, b, c, d] of [[0, 0, w, h], [w, 0, 0, h]]) {
      ctx.beginPath(); ctx.moveTo(a, b); ctx.lineTo(c, d); ctx.stroke();
      // ragged knots along the branches
      const n = 7; ctx.fillStyle = '#b0242a';
      for (let i = 1; i < n; i++) {
        const t = i / n, x = a + (c - a) * t, y = b + (d - b) * t;
        ctx.beginPath(); ctx.arc(x + (i % 2 ? 1 : -1) * h * 0.05, y - h * 0.05, h * 0.04, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.fillStyle = '#c9a24a'; ctx.beginPath(); ctx.arc(w / 2, h / 2, h * 0.09, 0, Math.PI * 2); ctx.fill();
  } else if (f === 'french') {
    // white field powdered with stylised gold lilies around a central blue shield
    ctx.fillStyle = '#efeadf'; ctx.fillRect(0, 0, w, h);
    const lily = (x, y, s, col) => {
      ctx.fillStyle = col; ctx.beginPath();
      ctx.moveTo(x, y - s); ctx.quadraticCurveTo(x + s * 0.35, y - s * 0.2, x, y + s * 0.3); ctx.quadraticCurveTo(x - s * 0.35, y - s * 0.2, x, y - s); ctx.fill();
      ctx.beginPath(); ctx.moveTo(x - s * 0.15, y); ctx.quadraticCurveTo(x - s * 0.9, y - s * 0.6, x - s * 0.7, y + s * 0.2); ctx.quadraticCurveTo(x - s * 0.45, y + s * 0.05, x - s * 0.15, y + s * 0.15); ctx.fill();
      ctx.beginPath(); ctx.moveTo(x + s * 0.15, y); ctx.quadraticCurveTo(x + s * 0.9, y - s * 0.6, x + s * 0.7, y + s * 0.2); ctx.quadraticCurveTo(x + s * 0.45, y + s * 0.05, x + s * 0.15, y + s * 0.15); ctx.fill();
      ctx.fillRect(x - s * 0.5, y + s * 0.12, s, s * 0.14);
      ctx.beginPath(); ctx.moveTo(x - s * 0.1, y + s * 0.26); ctx.lineTo(x + s * 0.1, y + s * 0.26); ctx.lineTo(x, y + s * 0.6); ctx.fill();
    };
    for (let j = 0; j < 4; j++) for (let i = 0; i < 6; i++) {
      const x = (i + 0.5 + (j % 2) * 0.5) * w / 6, y = (j + 0.5) * h / 4;
      if (Math.abs(x - w / 2) < w * 0.17 && Math.abs(y - h / 2) < h * 0.3) continue;
      lily(x, y, h * 0.06, '#c9a24a');
    }
    ctx.fillStyle = '#2c55a0'; ctx.beginPath();
    ctx.moveTo(w * 0.4, h * 0.25); ctx.lineTo(w * 0.6, h * 0.25); ctx.lineTo(w * 0.6, h * 0.55); ctx.quadraticCurveTo(w * 0.6, h * 0.75, w * 0.5, h * 0.8); ctx.quadraticCurveTo(w * 0.4, h * 0.75, w * 0.4, h * 0.55); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#c9a24a'; ctx.lineWidth = 4; ctx.stroke();
    lily(w * 0.5, h * 0.48, h * 0.1, '#d9b452');
  } else if (f === 'dutch') {
    // orange-white-blue horizontal tricolour
    const c = ['#d9701f', '#f0ebe0', '#24407a'];
    for (let i = 0; i < 3; i++) { ctx.fillStyle = c[i]; ctx.fillRect(0, (i * h) / 3, w, h / 3 + 1); }
  } else {
    ctx.fillStyle = '#141313'; ctx.fillRect(0, 0, w, h);
    skull(ctx, w * 0.5, h * 0.47, h * 0.33);
  }
  cloth(ctx, w, h, f.length * 131);
  // fraying / soot at fly end
  const gr = ctx.createLinearGradient(w * 0.75, 0, w, 0);
  gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(30,20,10,0.25)');
  ctx.fillStyle = gr; ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

function drawPennant(ctx, f, x0, y0, w, h) {
  const cols = {
    english: ['#a5232b', '#f1ece0'], spanish: ['#b0242a', '#e0b43a'], french: ['#2c55a0', '#efeadf'],
    dutch: ['#d9701f', '#f0ebe0', '#24407a'], pirate: ['#141313', '#8e1b1b'],
  }[f] || ['#a5232b', '#fff'];
  ctx.save(); ctx.translate(x0, y0);
  if (cols.length === 3) { for (let i = 0; i < 3; i++) { ctx.fillStyle = cols[i]; ctx.fillRect(0, i * h / 3, w, h / 3 + 1); } }
  else {
    ctx.fillStyle = cols[0]; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = cols[1]; ctx.fillRect(0, 0, w * 0.12, h);
  }
  ctx.restore();
}

export function getFlagTex(faction) {
  if (_flags[faction]) return _flags[faction];
  const W = 512, H = 512;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#888'; ctx.fillRect(0, 0, W, H);
  // canvas y=0 is top -> texture v=1 (flipY). Ensign occupies v 0.34..1 => canvas y 0..338
  drawEnsign(ctx, faction, 0, 0, W, 336);
  drawPennant(ctx, faction, 0, 360, W, 150);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  _flags[faction] = t;
  return t;
}

// ---------------- sail emblems: 5 original faction devices in a 5x1 atlas (alpha = paint coverage)
let _emb = null;
export const EMBLEM_INDEX = { english: 0, spanish: 1, french: 2, dutch: 3, pirate: 4 };
export function getEmblemTex() {
  if (_emb) return _emb;
  const S = 256, cv = document.createElement('canvas'); cv.width = S * 5; cv.height = S;
  const x = cv.getContext('2d');
  const rose = (cx, cy, r, c1, c2) => { // stylised five-petal rose (English device)
    x.fillStyle = c1; for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2 - Math.PI / 2; x.beginPath(); x.arc(cx + Math.cos(a) * r * 0.5, cy + Math.sin(a) * r * 0.5, r * 0.5, 0, 7); x.fill(); }
    x.fillStyle = c2; x.beginPath(); x.arc(cx, cy, r * 0.42, 0, 7); x.fill();
    x.fillStyle = '#e8c04a'; x.beginPath(); x.arc(cx, cy, r * 0.16, 0, 7); x.fill();
  };
  // 0 English: red cross roundel with a rose
  x.save(); x.translate(0, 0);
  x.fillStyle = '#b3262e'; x.beginPath(); x.arc(128, 128, 112, 0, 7); x.fill();
  x.fillStyle = '#f1ece0'; x.beginPath(); x.arc(128, 128, 96, 0, 7); x.fill();
  x.fillStyle = '#b3262e'; x.fillRect(110, 34, 36, 188); x.fillRect(34, 110, 188, 36);
  rose(128, 128, 44, '#b3262e', '#f1ece0'); x.restore();
  // 1 Spanish: red ragged saltire on a gold shield
  x.save(); x.translate(S, 0);
  x.fillStyle = '#d9a52c'; x.beginPath(); x.moveTo(40, 30); x.lineTo(216, 30); x.lineTo(216, 140); x.quadraticCurveTo(216, 220, 128, 240); x.quadraticCurveTo(40, 220, 40, 140); x.closePath(); x.fill();
  x.strokeStyle = '#a5232b'; x.lineWidth = 26; x.beginPath(); x.moveTo(60, 50); x.lineTo(196, 200); x.moveTo(196, 50); x.lineTo(60, 200); x.stroke();
  x.fillStyle = '#a5232b'; for (let i = 1; i < 6; i++) for (const sg of [1, -1]) { const t = i / 6; x.beginPath(); x.arc(128 + sg * (t - 0.5) * 136 + 10, 50 + t * 150 - 8, 9, 0, 7); x.fill(); }
  x.restore();
  // 2 French: gold sunburst on blue roundel
  x.save(); x.translate(S * 2, 0);
  x.fillStyle = '#2c55a0'; x.beginPath(); x.arc(128, 128, 112, 0, 7); x.fill();
  x.fillStyle = '#e2b84a'; for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2; x.beginPath(); x.moveTo(128 + Math.cos(a - 0.12) * 44, 128 + Math.sin(a - 0.12) * 44); x.lineTo(128 + Math.cos(a) * (i % 2 ? 80 : 100), 128 + Math.sin(a) * (i % 2 ? 80 : 100)); x.lineTo(128 + Math.cos(a + 0.12) * 44, 128 + Math.sin(a + 0.12) * 44); x.fill(); }
  x.beginPath(); x.arc(128, 128, 46, 0, 7); x.fill(); x.restore();
  // 3 Dutch: orange lion-rampant-ish (stylised) in a blue-ringed roundel -> keep simple: orange roundel, blue ring, white star
  x.save(); x.translate(S * 3, 0);
  x.fillStyle = '#24407a'; x.beginPath(); x.arc(128, 128, 112, 0, 7); x.fill();
  x.fillStyle = '#e0782a'; x.beginPath(); x.arc(128, 128, 94, 0, 7); x.fill();
  x.fillStyle = '#f0ebe0'; x.beginPath(); for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2 - Math.PI / 2, r = i % 2 ? 26 : 66; x.lineTo(128 + Math.cos(a) * r, 128 + Math.sin(a) * r); } x.fill(); x.restore();
  // 4 Pirate: big black skull & cutlasses
  x.save(); x.translate(S * 4, 0);
  x.fillStyle = '#141313'; x.beginPath(); x.arc(128, 128, 116, 0, 7); x.fill(); skull(x, 128, 132, 70); x.restore();
  _emb = new THREE.CanvasTexture(cv); _emb.colorSpace = THREE.SRGBColorSpace; _emb.anisotropy = 4;
  return _emb;
}
