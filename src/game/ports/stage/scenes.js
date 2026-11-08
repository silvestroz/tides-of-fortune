// Per-location 3D stages. build(kind, ctx) -> { scene, camera, look, exposure, update(t, dt) }
//   kind: 'tavern' | 'market' | 'shipyard' | 'governor' | 'bank'
//   ctx: { kit, port, game }  (kit owns all resources; dispose the kit to free the stage)
// Composition: subjects sit in the left ~60% of the frame (the UI column occupies the right).
import * as THREE from 'three';
import { paintedBust } from '../../../ui/port/portrait3d.js';   // paintings painted from the 3D busts
import { buildShipModel } from '../../../ships/shipModel.js';

const P = Math.PI;

function room(k, s, { w = 14, d = 12, h = 4.2, floor, wall, beams = true, wallTint = '#e2d2ae' }) {
  const fl = k.mesh(new THREE.PlaneGeometry(w, d), k.mat('#ffffff', { map: k.tiled(floor, w / 3, d / 3), rough: 0.9 }), 0, 0, 0, s); fl.rotation.x = -P / 2;
  const wm = k.mat(wallTint, { map: k.tiled(wall, w / 4, h / 4) });
  const back = k.mesh(new THREE.PlaneGeometry(w, h), wm, 0, h / 2, -d / 2, s);
  const left = k.mesh(new THREE.PlaneGeometry(d, h), wm, -w / 2, h / 2, 0, s); left.rotation.y = P / 2;
  const right = k.mesh(new THREE.PlaneGeometry(d, h), wm, w / 2, h / 2, 0, s); right.rotation.y = -P / 2;
  const ceil = k.mesh(new THREE.PlaneGeometry(w, d), k.mat('#5a3a20', { map: k.tiled(k.tex.darkPlanks, w / 3, d / 3) }), 0, h, 0, s); ceil.rotation.x = P / 2;
  if (beams) {
    const bm = k.mat('#4a2e18', { map: k.tex.darkPlanks });
    for (let x = -w / 2 + 1.5; x < w / 2; x += 2.6) k.box(0.28, 0.32, d, bm, x, h - 0.16, 0, s);
    for (const z of [-d / 2 + 0.12]) for (let x = -w / 2 + 0.2; x <= w / 2; x += 3.2) k.box(0.26, h, 0.22, bm, x, h / 2, z, s);
    for (let z = -d / 2 + 3; z < d / 2; z += 3.2) { k.box(0.22, h, 0.26, bm, -w / 2 + 0.12, h / 2, z, s); k.box(0.22, h, 0.26, bm, w / 2 - 0.12, h / 2, z, s); }
    k.box(w, 0.24, 0.2, bm, 0, 2.6, -d / 2 + 0.12, s);
    k.box(0.2, 0.24, d, bm, -w / 2 + 0.1, 2.6, 0, s); k.box(0.2, 0.24, d, bm, w / 2 - 0.1, 2.6, 0, s);
  }
  return { back, left, right };
}

function frame(k, x, y, z, w, h, parent, col = '#7a4a28', inner, paint = null) {
  const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g);
  const gold = k.mat('#c9a24a', { metal: 0.7, rough: 0.35 });
  k.box(w + 0.16, h + 0.16, 0.06, gold, 0, 0, 0, g);
  // moulded frame (raised bevel) + a painted canvas instead of a flat colour
  for (const [bw, bh, bx, by] of [[w + 0.2, 0.07, 0, h / 2 + 0.05], [w + 0.2, 0.07, 0, -h / 2 - 0.05], [0.07, h + 0.2, w / 2 + 0.05, 0], [0.07, h + 0.2, -w / 2 - 0.05, 0]])
    k.box(bw, bh, 0.1, gold, bx, by, 0.03, g);
  k.box(w, h, 0.08, paint ? k.mat('#ffffff', { map: paint, rough: 0.7 }) : k.mat(inner || col), 0, 0, 0.01, g);
  return g;
}

// Kuwahara filter (r = radius): each pixel takes the mean of the least varied of its four quadrants — flat strokes with
// crisp edges, the classic "painted" look; in place on an ImageData
function kuwahara(id, W, H, r) {
  // summed-area tables over the image padded with r repeated pixels — same quadrants and same result as the
  // direct version, without 4 × (r + 1)² reads per pixel
  const d = id.data, P = W + 2 * r, Q = H + 2 * r, S = P + 1, N = S * (Q + 1);
  const IR = new Float64Array(N), IG = new Float64Array(N), IB = new Float64Array(N), IL = new Float64Array(N), IL2 = new Float64Array(N);
  for (let y = 0; y < Q; y++) {
    const sy = Math.min(H - 1, Math.max(0, y - r));
    let rr = 0, rg = 0, rb = 0, rl = 0, rl2 = 0;
    for (let x = 0; x < P; x++) {
      const sx = Math.min(W - 1, Math.max(0, x - r)), o = (sy * W + sx) * 4;
      const R = d[o], G = d[o + 1], B = d[o + 2], l = R * 0.3 + G * 0.59 + B * 0.11;
      rr += R; rg += G; rb += B; rl += l; rl2 += l * l;
      const i = (y + 1) * S + x + 1, u = i - S;
      IR[i] = IR[u] + rr; IG[i] = IG[u] + rg; IB[i] = IB[u] + rb; IL[i] = IL[u] + rl; IL2[i] = IL2[u] + rl2;
    }
  }
  const n = (r + 1) * (r + 1);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const px = x + r, py = y + r;
    let best = 1e18, br = 0, bg = 0, bb = 0;
    for (let q = 0; q < 4; q++) {   // quadrants in the original order: (−,−) (+,−) (−,+) (+,+)
      const x0 = q & 1 ? px : px - r, y0 = q & 2 ? py : py - r;
      const a = y0 * S + x0, b = a + r + 1, c = a + (r + 1) * S, e = c + r + 1;
      const sl = IL[e] - IL[b] - IL[c] + IL[a], v = (IL2[e] - IL2[b] - IL2[c] + IL2[a]) / n - (sl / n) ** 2;
      if (v < best) { best = v; br = (IR[e] - IR[b] - IR[c] + IR[a]) / n; bg = (IG[e] - IG[b] - IG[c] + IG[a]) / n; bb = (IB[e] - IB[b] - IB[c] + IB[a]) / n; }
    }
    const o = (y * W + x) * 4; d[o] = br; d[o + 1] = bg; d[o + 2] = bb;
  }
}

// procedural oil paintings for the governor's hall (canvas): a portrait in a dark ground and a sea piece
// finished canvases are kept (last 12, ~0.8 MB each): returning to the governor doesn't repaint
const PAINTINGS = new Map();
const keepPainting = (key, c) => { PAINTINGS.delete(key); PAINTINGS.set(key, c); if (PAINTINGS.size > 12) PAINTINGS.delete(PAINTINGS.keys().next().value); };
function painting(k, kind, seed, game) {
  const ck = `${kind}:${seed}:${game ? 1 : 0}`, done = PAINTINGS.get(ck);
  if (done) { keepPainting(ck, done); return k._ctex(done, false); }
  let x = seed * 9301 + 49297; const r = () => ((x = (x * 9301 + 49297) % 233280) / 233280);
  // (drawn at 2×: a portrait seen large showed its pixels)
  const Q = 2, c = document.createElement('canvas'); c.width = 192 * Q; c.height = 256 * Q; const g = c.getContext('2d');
  const W = 192, H = 256; g.setTransform(Q, 0, 0, Q, 0, 0);
  const dab = (cx, cy, rr, col, n = 30, a = 0.18) => { g.fillStyle = col; for (let i = 0; i < n; i++) { g.globalAlpha = a * r(); g.beginPath(); g.ellipse(cx + (r() - 0.5) * rr * 2, cy + (r() - 0.5) * rr * 2, rr * (0.2 + r() * 0.4), rr * (0.1 + r() * 0.3), r() * 3, 0, Math.PI * 2); g.fill(); } g.globalAlpha = 1; };
  const bust = kind === 'portrait' ? paintedBust(seed, game) : null;
  if (kind === 'portrait') {
    const bg = g.createRadialGradient(W * 0.45, H * 0.35, 10, W * 0.5, H * 0.5, H * 0.7); bg.addColorStop(0, '#5a4630'); bg.addColorStop(1, '#140e08');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    // drape
    g.fillStyle = '#5a1414'; g.beginPath(); g.moveTo(0, 0); g.lineTo(W * 0.35, 0); g.quadraticCurveTo(W * 0.15, H * 0.4, W * 0.05, H * 0.75); g.lineTo(0, H * 0.75); g.fill();
  }
  if (bust) {
    // the model is a 3D bust of the game (portrait3d.js), repainted with oil strokes once loaded
    const tex = k._ctex(c, false), img = new Image();
    img.onload = () => {
      g.drawImage(img, -W * 0.18, H * 0.02, W * 1.36, W * 1.36);
      // painted, not blurred — Kuwahara filter (flat areas with crisp edges, like brush strokes), oriented
      // strokes following the modelling, canvas, then yellowed varnish and cracks
      const RW = c.width, RH = c.height;
      const id = g.getImageData(0, 0, RW, RH); kuwahara(id, RW, RH, 2); g.putImageData(id, 0, 0);
      const px = id.data;
      for (let i = 0; i < 2200; i++) {
        const x = r() * W, y = r() * H, X = (x * Q) | 0, Y = (y * Q) | 0, o = (Y * RW + X) * 4, o2 = (Y * RW + Math.min(RW - 1, X + 3)) * 4;
        const ang = Math.atan2(px[o2] - px[o], 12) + Math.PI / 2;   // stroke across the light gradient
        g.fillStyle = `rgba(${px[o]},${px[o + 1]},${px[o + 2]},0.5)`; g.beginPath(); g.ellipse(x, y, 2.2 + r() * 2.2, 0.7 + r() * 0.8, ang, 0, Math.PI * 2); g.fill();
      }
      g.globalAlpha = 0.07; g.fillStyle = '#000';
      for (let y = 0; y < H; y += 2) g.fillRect(0, y, W, 1);           // canvas weave
      for (let x = 0; x < W; x += 2) g.fillRect(x, 0, 1, H);
      g.globalAlpha = 1;
      g.fillStyle = 'rgba(150,110,40,0.12)'; g.fillRect(0, 0, W, H);   // yellowed varnish
      varnish();
      tex.needsUpdate = true;
      keepPainting(ck, c);
    };
    img.src = bust;
    return tex;
  }
  if (kind === 'portrait') {
    // coat / shoulders
    const coat = ['#2a2a3a', '#6a1a1a', '#1e2e4a', '#2a3a2a'][seed % 4];
    g.fillStyle = coat; g.beginPath(); g.moveTo(W * 0.12, H); g.quadraticCurveTo(W * 0.18, H * 0.58, W * 0.5, H * 0.55); g.quadraticCurveTo(W * 0.82, H * 0.58, W * 0.9, H); g.fill();
    dab(W * 0.5, H * 0.8, 40, '#000', 40, 0.25); dab(W * 0.35, H * 0.72, 22, '#c9a24a', 14, 0.25);
    // lace jabot
    g.fillStyle = '#e8e0cc'; g.beginPath(); g.moveTo(W * 0.44, H * 0.56); g.lineTo(W * 0.56, H * 0.56); g.lineTo(W * 0.5, H * 0.72); g.fill(); dab(W * 0.5, H * 0.62, 8, '#fff', 12, 0.4);
    // wig + face
    g.fillStyle = '#d8d0c0'; g.beginPath(); g.ellipse(W * 0.5, H * 0.38, W * 0.2, H * 0.17, 0, 0, Math.PI * 2); g.fill(); dab(W * 0.5, H * 0.42, 30, '#8a8070', 30, 0.2);
    const fg = g.createRadialGradient(W * 0.46, H * 0.36, 4, W * 0.5, H * 0.4, 34); fg.addColorStop(0, '#f0c8a0'); fg.addColorStop(1, '#9a6a48');
    g.fillStyle = fg; g.beginPath(); g.ellipse(W * 0.5, H * 0.4, W * 0.11, H * 0.1, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#2a1a10'; for (const ex of [-0.045, 0.045]) { g.beginPath(); g.ellipse(W * (0.5 + ex), H * 0.385, 3, 2, 0, 0, 7); g.fill(); }
    g.fillStyle = '#8a3a2a'; g.fillRect(W * 0.47, H * 0.455, W * 0.06, 2.5);
    g.fillStyle = 'rgba(120,70,40,0.5)'; g.fillRect(W * 0.495, H * 0.39, 3, H * 0.05);
  } else {
    const sky = g.createLinearGradient(0, 0, 0, H * 0.6); sky.addColorStop(0, '#3a4a5a'); sky.addColorStop(0.6, '#c8a878'); sky.addColorStop(1, '#e8d0a0');
    g.fillStyle = sky; g.fillRect(0, 0, W, H * 0.6);
    for (let i = 0; i < 6; i++) dab(r() * W, 20 + r() * H * 0.3, 30, '#f0e6d0', 20, 0.18);
    const sea = g.createLinearGradient(0, H * 0.6, 0, H); sea.addColorStop(0, '#4a5a50'); sea.addColorStop(1, '#1a2a2a');
    g.fillStyle = sea; g.fillRect(0, H * 0.6, W, H * 0.4);
    for (let i = 0; i < 60; i++) { g.strokeStyle = `rgba(230,220,190,${0.1 + r() * 0.25})`; g.lineWidth = 1 + r() * 1.5; const yy = H * 0.62 + r() * H * 0.38, xx = r() * W; g.beginPath(); g.moveTo(xx, yy); g.quadraticCurveTo(xx + 8, yy - 3, xx + 16 + r() * 10, yy); g.stroke(); }
    // a ship under sail, three-quarter, plus a far headland
    g.fillStyle = '#4a5040'; g.beginPath(); g.moveTo(0, H * 0.6); g.quadraticCurveTo(W * 0.2, H * 0.5, W * 0.35, H * 0.6); g.fill();
    const sx = W * (0.55 + (seed % 3) * 0.05), sy = H * 0.66;
    g.fillStyle = '#2a1a10'; g.beginPath(); g.moveTo(sx - 40, sy); g.lineTo(sx + 44, sy - 4); g.lineTo(sx + 34, sy + 12); g.lineTo(sx - 32, sy + 12); g.fill();
    g.strokeStyle = '#2a1a10'; g.lineWidth = 2; for (const mx of [-22, 2, 26]) { g.beginPath(); g.moveTo(sx + mx, sy); g.lineTo(sx + mx, sy - 90 + Math.abs(mx)); g.stroke(); }
    g.fillStyle = '#efe4c8'; for (const mx of [-22, 2, 26]) for (let k2 = 0; k2 < 3; k2++) { const top = sy - 82 + Math.abs(mx) + k2 * 24; g.beginPath(); g.moveTo(sx + mx - 15, top); g.quadraticCurveTo(sx + mx, top - 4, sx + mx + 15, top); g.lineTo(sx + mx + 13, top + 19); g.quadraticCurveTo(sx + mx, top + 23, sx + mx - 13, top + 19); g.fill(); }
    dab(sx, sy - 40, 40, '#a08a60', 30, 0.12);
    g.fillStyle = '#8e1b1b'; g.fillRect(sx + 28, sy - 92 + 26, 10, 5);
  }
  varnish();
  keepPainting(ck, c);
  return k._ctex(c, false);
  // varnish: warm glaze, vignette, craquelure
  function varnish() {
    const v = g.createRadialGradient(W / 2, H / 2, H * 0.2, W / 2, H / 2, H * 0.75); v.addColorStop(0, 'rgba(255,200,120,0.05)'); v.addColorStop(1, 'rgba(20,10,0,0.55)');
    g.fillStyle = v; g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(30,20,10,0.12)'; g.lineWidth = 0.6;
    for (let i = 0; i < 50; i++) { let px = r() * W, py = r() * H; g.beginPath(); g.moveTo(px, py); for (let j = 0; j < 4; j++) { px += (r() - 0.5) * 14; py += (r() - 0.5) * 14; g.lineTo(px, py); } g.stroke(); }
  }
}

// soot / rain-streak overlay for street facades (transparent canvas, multiplied over the plaster)
let _grime = null;
function grimeTex(k) {
  if (_grime && _grime.image) return _grime;
  const c = document.createElement('canvas'); c.width = 128; c.height = 256; const g = c.getContext('2d');
  const base = g.createLinearGradient(0, 256, 0, 150); base.addColorStop(0, 'rgba(50,35,20,0.55)'); base.addColorStop(1, 'rgba(50,35,20,0)');
  g.fillStyle = base; g.fillRect(0, 0, 128, 256);
  for (let i = 0; i < 26; i++) { const x = Math.random() * 128, len = 30 + Math.random() * 120, sg = g.createLinearGradient(0, 0, 0, len);
    sg.addColorStop(0, `rgba(40,30,20,${0.12 + Math.random() * 0.18})`); sg.addColorStop(1, 'rgba(40,30,20,0)'); g.fillStyle = sg; g.fillRect(x, 0, 2 + Math.random() * 6, len); }
  for (let i = 0; i < 18; i++) { g.fillStyle = `rgba(60,45,25,${Math.random() * 0.15})`; g.beginPath(); g.arc(Math.random() * 128, 180 + Math.random() * 76, 6 + Math.random() * 18, 0, 7); g.fill(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return (_grime = t);
}

// ------------------------------------------------------------------------------------------------
function tavern({ kit: k, port }) {
  const s = new THREE.Scene();
  s.background = new THREE.Color('#120a05'); s.fog = new THREE.Fog('#1a0e06', 9, 24);
  room(k, s, { w: 16, d: 13, floor: k.tex.cobble, wall: k.tex.plaster, wallTint: '#c8ab80' });
  s.add(new THREE.HemisphereLight('#7a6a8a', '#3a2010', 0.55));
  { const f = new THREE.DirectionalLight('#ffd8a8', 0.3); f.position.set(2, 3, 10); s.add(f); }

  // hearth (left wall)
  const st = k.mat('#9a8a78', { map: k.tex.stone });
  const hx = -7.4, hz = -2.4;
  k.box(1.2, 1.4, 0.5, st, hx + 0.3, 0.7, hz - 1.15, s); k.box(1.2, 1.4, 0.5, st, hx + 0.3, 0.7, hz + 1.15, s);
  k.box(1.3, 0.35, 2.9, k.mat('#3a2414', { map: k.tex.darkPlanks }), hx + 0.35, 1.55, hz, s);
  k.box(1.0, 1.5, 2.8, k.mat('#2a1a10'), hx - 0.1, 0.75, hz, s);
  const hood = k.mesh(new THREE.CylinderGeometry(0.7, 1.4, 1.6, 4, 1), k.mat('#b09878', { map: k.tex.plaster }), hx + 0.1, 2.5, hz, s); hood.rotation.y = P / 4; hood.scale.set(0.7, 1, 1.45);
  k.box(0.9, 1.0, 1.0, k.mat('#b09878', { map: k.tex.plaster }), hx, 3.7, hz, s);
  k.box(1.5, 0.08, 0.5, st, hx + 0.6, 0.04, hz, s);
  k.fire(hx + 0.25, 0.08, hz, s, { light: 70, scale: 1.1 });
  const pot = k.sph(0.28, k.mat('#1a1614', { metal: 0.5, rough: 0.5 }), hx + 0.25, 0.85, hz, s, 10, 6); pot.scale.y = 0.8;
  k.cyl(0.01, 0.01, 0.6, k.mat('#1a1614'), hx + 0.25, 1.2, hz, s, 4);
  for (let i = 0; i < 3; i++) k.mug(hx + 0.6, 1.73, hz - 0.8 + i * 0.5, s);
  k.bottle(hx + 0.6, 1.73, hz + 0.9, s);
  k.banner(port.faction, 1.0, 1.4, -2.6, 3.0, -6.4, s);
  
  // door + small window glow on the back wall
  k.box(1.3, 2.3, 0.1, k.mat('#4a2e18', { map: k.tex.darkPlanks }), -0.6, 1.15, -6.45, s);
  k.box(0.9, 0.6, 0.05, k.mat('#2a3a5a', { emissive: '#1a2a4a', ei: 1.0 }), 5.5, 2.0, -6.46, s);

  // bar along the back wall (right of the door), shelves and casks behind
  const bw = k.mat('#6a3e1e', { map: k.tex.darkPlanks });
  k.box(5.2, 1.1, 0.9, bw, 3.2, 0.55, -4.2, s);
  k.box(5.4, 0.08, 1.05, k.mat('#8a5a32', { map: k.tex.planks, rough: 0.45 }), 3.2, 1.14, -4.2, s);
  for (let i = 0; i < 5; i++) k.mug(1.2 + i * 0.9, 1.18, -4.0, s);
  k.bottle(3.9, 1.18, -4.3, s); k.bottle(4.1, 1.18, -4.1, s, '#5a2a1a');
  for (const y of [1.7, 2.3]) { k.box(4.6, 0.06, 0.4, bw, 3.0, y, -6.25, s); for (let i = 0; i < 12; i++) k.bottle(1.0 + i * 0.36, y + 0.03, -6.2, s, k.pick(['#2f5a2a', '#5a2a1a', '#3a3020', '#6a5020'])); }
  k.barrel(6.3, -5.6, s, { lying: true }); k.barrel(6.3, -4.7, s, { lying: true }); k.barrel(6.5, -5.15, s, { lying: true, y: 0.72 });
  k.barrel(-1.6, -5.6, s); k.barrel(-2.3, -5.8, s, { s: 0.85 });
  k.barrel(5.6, 2.5, s); k.barrel(6.2, 3.2, s, { s: 0.9 });
  frame(k, -4.6, 2.1, -6.42, 0.9, 1.1, s, '#5a3a20', '#3a3020');

  // tables & patrons
  const rug = k.mesh(new THREE.PlaneGeometry(4.6, 3.0), k.mat('#ffffff', { map: k.tex.rug, transparent: true }), -0.5, 0.01, 1.4, s); rug.rotation.x = -P / 2;
  const T1 = [-3.6, 0.6], T2 = [-0.4, -2.6], T3 = [1.8, 2.6];
  k.table(...T1, s); k.table(...T2, s, { r: 0.8 }); k.table(...T3, s, { r: 0.6 });
  for (const [tx, tz] of [T1, T2, T3]) { k.mug(tx + 0.2, 0.78, tz + 0.1, s); k.mug(tx - 0.3, 0.78, tz - 0.15, s); k.candle(tx, 0.78, tz - 0.05, s); }
  k.bottle(T2[0] + 0.3, 0.78, T2[1] - 0.3, s);
  const seat = (x, z, ry, o) => { k.stool(x, z, s); k.place(k.npc({ pose: 'sit', ...o }), x, z, ry, s); };
  seat(T1[0] - 1.0, T1[1] + 0.1, P / 2, { mug: true, hat: 'tricorn', beard: true, coat: '#5a2a1a' });
  seat(T1[0] + 0.9, T1[1] - 0.2, -P / 2, { hat: 'bandana', pose: 'sit', vest: '#e8dcc0', coat: '#2c3d5a' });
  seat(T2[0] - 0.9, T2[1] + 0.3, P / 2 + 0.3, { mug: true, hat: 'cap', moustache: true });
  seat(T2[0] + 0.9, T2[1] + 0.2, -P / 2 - 0.3, { hat: null, beard: true, coat: '#3e4a2a' });
  seat(T2[0] + 0.1, T2[1] - 1.0, 0, { hat: 'tricorn', mug: true });
  seat(T3[0] - 0.8, T3[1] - 0.1, P / 2, { hat: 'bandana', mug: true, coat: '#6a2a22' });
  k.place(k.npc({ pose: 'gesture', hat: 'tricorn', plume: '#b8242c', coat: '#7a2020', vest: '#c9a24a', beard: true }), -5.3, -1.0, 0.9, s);
  k.place(k.npc({ pose: 'lean', hat: null, apron: true, coat: '#e0d4b8', vest: '#8e3a2a', moustache: true, beard: true }), 2.7, -5.0, 0, s);
  k.place(k.npc({ pose: 'hips', dress: '#a8543a', bodice: '#3a2a20', hat: 'bonnet', skin: '#d8a888', hair: '#4a2414' }), 1.6, 0.4, -0.3, s);
  k.place(k.npc({ pose: 'drink', mug: true, hat: 'bandana', coat: '#4a3a5a' }), 4.3, -3.3, P + 0.3, s);
  k.place(k.npc({ pose: 'arms', hat: 'tricorn', coat: '#2a2a3a' }), 1.6, -3.3, P - 0.4, s);

  // hanging lanterns
  k.lantern(-3.5, 2.75, 0.6, s, { rope: 0.9, light: 14 });
  k.lantern(-0.4, 2.85, -2.6, s, { rope: 0.8, light: 12 });
  k.lantern(2.2, 2.7, 2.4, s, { rope: 0.95, light: 10 });
  k.lantern(3.2, 2.9, -3.6, s, { rope: 0.75, light: 14 });
  k.lantern(-5.8, 2.6, 3.6, s, { rope: 1.05 });

  const cam = new THREE.PerspectiveCamera(48, 1, 0.1, 200);
  cam.position.set(1.8, 2.15, 9.2);
  return { scene: s, camera: cam, look: new THREE.Vector3(-0.4, 1.2, -1.6), exposure: 1.35, sway: 0.25 };
}

// ------------------------------------------------------------------------------------------------
function facade(k, s, x, z, w, h, tint, ry = 0, lit = 0.5) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry; s.add(g);
  k.box(w, h, 3, k.mat(tint, { map: k.tiled(k.tex.plaster, w / 4, h / 4) }), 0, h / 2, -1.5, g);
  const roof = k.mesh(new THREE.CylinderGeometry(0.01, 2.2, w + 0.4, 3, 1), k.mat('#ffffff', { map: k.tiled(k.tex.roof, w / 2, 2) }), 0, h + 0.6, -1.5, g);
  roof.rotation.z = P / 2; roof.scale.set(0.6, 1, 1);
  k.box(w + 0.1, 0.18, 0.2, k.mat('#8a7a60'), 0, h, 0.02, g);
  const winM = k.mat('#ffc874', { emissive: '#ff9a3a', ei: 1.6 }), darkM = k.mat('#1a2026');
  const shut = k.mat(k.pick(['#2f5a4a', '#3a5a7a', '#6a3a2a', '#5a6a3a']), { map: k.tex.planks });
  // soiled facade (rain streaks from the cornice, dirt splash at the base) + windows set in relief
  const gm = k._track(new THREE.MeshBasicMaterial({ map: grimeTex(k), transparent: true, depthWrite: false, opacity: 0.9 }));
  k.mesh(new THREE.PlaneGeometry(w, h), gm, 0, h / 2, 0.005, g);
  k.box(w + 0.05, 0.55, 0.12, k.mat('#' + new THREE.Color(tint).multiplyScalar(0.62).getHexString(), { map: k.tex.stone }), 0, 0.27, 0.0, g);
  const surround = k.mat('#e8dcc4', { map: k.tex.stone, rough: 0.8 });
  const curtain = k.mat(k.pick(['#8e2a22', '#e8dcc0', '#2a4a6a']), { emissive: '#ff9a3a', ei: 0.25 });
  for (let fy = 1; fy * 2.4 + 1.2 < h; fy++) for (let fx = -w / 2 + 1; fx < w / 2 - 0.4; fx += 1.6) {
    const on = k.r() < lit, wy = fy * 2.4 + 0.2, wx = fx + 0.3;
    // recessed pane with a gradient glow (lit) or dark glass + reflection streak
    k.box(0.7, 1.0, 0.05, on ? winM : darkM, wx, wy, 0.015, g);
    if (on) { k.glow('#ffb060', 1.4, wx, wy, 0.3, g, 0.35); k.box(0.22, 0.9, 0.04, curtain, wx - 0.22, wy, 0.035, g); }
    else k.box(0.08, 0.7, 0.02, k.mat('#6a7a8a', { rough: 0.2 }), wx + 0.15, wy + 0.05, 0.04, g);
    // stone surround: jambs, lintel with keystone, projecting sill on corbels
    k.box(0.12, 1.15, 0.2, surround, wx - 0.41, wy, 0.0, g); k.box(0.12, 1.15, 0.2, surround, wx + 0.41, wy, 0.0, g);
    k.box(0.98, 0.16, 0.22, surround, wx, wy + 0.6, 0.01, g); k.box(0.16, 0.22, 0.25, surround, wx, wy + 0.6, 0.02, g);
    k.box(1.02, 0.09, 0.32, surround, wx, wy - 0.56, 0.06, g);
    for (const cx of [-0.32, 0.32]) k.box(0.1, 0.12, 0.18, surround, wx + cx, wy - 0.66, 0.04, g);
    k.box(0.06, 1.0, 0.03, k.mat('#2a2018'), wx, wy, 0.05, g); k.box(0.7, 0.05, 0.03, k.mat('#2a2018'), wx, wy + 0.1, 0.05, g);
    k.box(0.3, 1.05, 0.04, shut, fx - 0.25, wy, 0.1, g); k.box(0.3, 1.05, 0.04, shut, fx + 0.85, wy, 0.1, g);
  }
  k.box(1.1, 2.1, 0.06, k.mat('#3a2412', { map: k.tex.darkPlanks }), w * 0.2, 1.05, 0.02, g);
  return g;
}

function market({ kit: k, port }) {
  const s = new THREE.Scene();
  s.fog = new THREE.Fog('#6a4a5a', 14, 60);
  k.skyDome('#2a3a6a', '#c86a4a', '#f0a860', s);
  const gr = k.mesh(new THREE.PlaneGeometry(60, 60), k.mat('#ffffff', { map: k.tiled(k.tex.cobble, 14, 14) }), 0, 0, 0, s); gr.rotation.x = -P / 2;
  s.add(new THREE.HemisphereLight('#8a90c0', '#4a2a18', 0.9));
  const sun = new THREE.DirectionalLight('#ffb070', 2.2); sun.position.set(-20, 10, 8); s.add(sun);
  facade(k, s, -4.5, -6, 5, 7, '#e8c890', 0, 0.4); facade(k, s, 0.8, -6.5, 5, 8.5, '#e8b8a0', 0, 0.5); facade(k, s, 6, -6, 5, 6.2, '#d8d0b0', 0, 0.6);
  facade(k, s, -9, -1, 6, 7.5, '#d8b070', P / 2, 0.5); facade(k, s, -9.5, 6, 6, 6, '#c8a8a0', P / 2, 0.5);
  facade(k, s, 10, 0, 6, 7, '#e0d0b0', -P / 2, 0.4);
  // church tower in the distance
  k.box(3, 14, 3, k.mat('#e8dcc0', { map: k.tex.plaster }), 3.5, 7, -16, s);
  k.mesh(new THREE.ConeGeometry(2.3, 3.2, 4), k.mat('#a0502a', { map: k.tex.roof }), 3.5, 15.6, -16, s).rotation.y = P / 4;
  k.box(1, 1.6, 0.1, k.mat('#1a1614'), 3.5, 11.5, -14.45, s);

  // stall
  const wood = k.mat('#7a4a28', { map: k.tex.planks });
  const S0 = new THREE.Group(); S0.position.set(-2.2, 0, -0.6); S0.rotation.y = 0.25; s.add(S0);
  k.box(3.6, 0.95, 1.1, wood, 0, 0.48, 0, S0);
  k.box(3.8, 0.07, 1.25, k.mat('#9a6a3a', { map: k.tex.planks }), 0, 0.98, 0, S0);
  for (const x of [-1.8, 1.8]) for (const z of [-0.6, 0.6]) k.box(0.1, z < 0 ? 2.9 : 2.5, 0.1, wood, x, (z < 0 ? 2.9 : 2.5) / 2, z, S0);
  const aw = new THREE.PlaneGeometry(4.2, 2.0, 12, 6);
  const ap = aw.attributes.position; for (let i = 0; i < ap.count; i++) ap.setZ(i, -Math.sin((ap.getX(i) + 2.1) / 4.2 * P * 6) * 0.04 - Math.abs(ap.getY(i)) * 0.0);
  aw.computeVertexNormals();
  const awn = k.mesh(aw, k.mat('#ffffff', { map: k.tex.stripes, side: THREE.DoubleSide }), 0, 2.75, 0.15, S0); awn.rotation.x = -P / 2 + 0.35;
  // valance scallops
  for (let i = 0; i < 9; i++) { const sc = k.mesh(new THREE.CircleGeometry(0.24, 10, P, P), k.mat(i % 2 ? '#efe2c0' : '#b8332a', { side: THREE.DoubleSide }), -1.9 + i * 0.475, 2.42, 1.1, S0); sc.rotation.x = 0.35; }
  // produce
  const fruit = [['#d8442a', 0.08], ['#f09a2a', 0.085], ['#e8d040', 0.07], ['#6a9a2a', 0.09], ['#7a2a5a', 0.06]];
  for (let b = 0; b < 5; b++) {
    const bx = -1.45 + b * 0.72;
    k.box(0.62, 0.22, 0.5, k.mat('#a87a48', { map: k.tex.planks }), bx, 1.12, 0.15, S0);
    const [fc, fr] = fruit[b];
    for (let i = 0; i < 14; i++) k.sph(fr, k.mat(fc, { rough: 0.45 }), bx + (k.r() - 0.5) * 0.48, 1.25 + k.r() * 0.08, 0.15 + (k.r() - 0.5) * 0.36, S0, 8, 6);
  }
  k.sack(-2.6, 0, 0.9, S0); k.sack(-2.2, 0, 1.3, S0, '#b89a6a'); k.barrel(2.3, 0.7, S0); k.crate(2.4, 0, -0.2, 0.7, S0, 0.3); k.crate(2.4, 0.7, -0.2, 0.55, S0, -0.2);
  k.place(k.npc({ pose: 'gesture', hat: 'cap', hatColor: '#6a2a1a', apron: true, coat: '#5a4030', vest: '#e8dcc0', beard: true, moustache: true }), 0.2, -1.0, 0, S0);
  k.lantern(1.4, 2.0, 0.9, S0, { rope: 0.45, light: 12 });

  // second stall: cloth & spices
  const S1 = new THREE.Group(); S1.position.set(4.6, 0, -2.8); S1.rotation.y = -0.4; s.add(S1);
  k.box(2.6, 0.9, 1.0, wood, 0, 0.45, 0, S1);
  for (const x of [-1.3, 1.3]) k.box(0.08, 2.5, 0.08, wood, x, 1.25, -0.5, S1);
  const aw2 = k.mesh(new THREE.PlaneGeometry(3, 1.6), k.mat('#ffffff', { map: k.tex.stripesB, side: THREE.DoubleSide }), 0, 2.35, 0, S1); aw2.rotation.x = -P / 2 + 0.4;
  for (let i = 0; i < 5; i++) { const r = k.cyl(0.12, 0.12, 0.8, k.mat(k.pick(['#7a3a6a', '#2a4a7a', '#c9a24a', '#8e1b1b', '#e8dcc0']), { map: k.tex.cloth }), -1 + i * 0.5, 1.02, 0, S1, 10); r.rotation.z = P / 2; r.rotation.y = 0.3; }
  k.place(k.npc({ pose: 'arms', dress: '#2a4a6a', bodice: '#e8dcc0', hat: 'bonnet', hair: '#2a1410' }), 0, -1.0, 0, S1);

  // passersby & clutter
  k.place(k.npc({ pose: 'stand', hat: 'tricorn', coat: '#2c3d5a', vest: '#c9a24a', look: -0.6 }), -4.6, 0.6, 0.7, s);
  k.place(k.npc({ pose: 'stand', dress: '#8a6a3a', bodice: '#5a2a1a', hat: 'bonnet' }), 2.6, 1.6, -0.7, s);
  for (let i = 0; i < 4; i++) k.barrel(-7.6 + (i % 2) * 0.7, -3.5 + i * 0.5, s, { s: 0.9 });
  k.crate(7.2, 0, 1.5, 0.8, s, 0.3); k.crate(7.4, 0.8, 1.5, 0.6, s, -0.2); k.crate(6.5, 0, 2.2, 0.7, s, 0.6);
  // lamp post
  k.cyl(0.07, 0.1, 3.2, k.mat('#1e1a16', { metal: 0.5 }), -6.2, 1.6, 2.2, s, 8);
  k.box(0.7, 0.05, 0.05, k.mat('#1e1a16'), -5.9, 3.15, 2.2, s);
  k.lantern(-5.6, 2.55, 2.2, s, { rope: 0.5, light: 10 });
  k.banner(port.faction, 1.2, 1.8, 0.8, 5.6, -4.9, s);

  const cam = new THREE.PerspectiveCamera(50, 1, 0.1, 500);
  cam.position.set(1.6, 1.85, 7.4);
  return { scene: s, camera: cam, look: new THREE.Vector3(-1.4, 1.5, -0.8), exposure: 1.0, sway: 0.2 };
}

// ------------------------------------------------------------------------------------------------
function shipyard({ kit: k, port, game }) {
  const s = new THREE.Scene();
  s.fog = new THREE.Fog('#bcd6e0', 60, 260);
  k.skyDome('#3a7fc4', '#bfe0ec', '#e8e0c8', s);
  s.add(new THREE.HemisphereLight('#bcd8f0', '#6a5030', 1.1));
  const sun = new THREE.DirectionalLight('#ffe0b0', 3.0); sun.position.set(30, 40, 25); s.add(sun);
  const water = k.mesh(new THREE.PlaneGeometry(600, 600), k.mat('#1f6a7a', { rough: 0.18, metal: 0.2 }), 0, -0.05, 0, s); water.rotation.x = -P / 2;
  // ripple glints
  for (let i = 0; i < 40; i++) k.glow('#fff4d6', 1 + k.r() * 2, -40 + k.r() * 70, 0.05, -40 + k.r() * 70, s, 0.25);
  // hills
  for (let i = 0; i < 6; i++) { const h = k.sph(30 + k.r() * 30, k.mat(k.pick(['#4f8a3a', '#3f7a32', '#5a8a42']), { flat: true }), -120 + i * 50, -14, -170 - k.r() * 40, s, 10, 6); h.scale.y = 0.55 + k.r() * 0.3; }
  // dock
  const plank = k.mat('#9a7650', { map: k.tex.planks });
  const dock = new THREE.Group(); dock.position.set(9, 0, 0); s.add(dock);
  k.box(7, 0.3, 46, k.mat('#ffffff', { map: k.tiled(k.tex.planks, 2, 12) }), 0, 1.4, -6, dock);
  for (let z = -28; z <= 16; z += 4) for (const x of [-3.3, 3.3]) k.cyl(0.22, 0.25, 3.5, k.mat('#4a3420'), x, 0, z, dock, 8);
  // the ship alongside (2026-10-22: replaceable). S.setShip(type, { faction, name, damage }) swaps the model at the
  // quay (old one disposed), re-lays the scaffolding and re-frames the camera on its size (lugger → great galleon);
  // S.setDamage(dmg) repaints holes and scorch; S.setView({ x0, x1, y0, y1 }) = free screen area (fractions) beside
  // the UI column, measured by the port screen. Sails furled from the first frame, no bow jack at the yard.
  const pl = game.player;
  const cur = { model: null, type: null, faction: null, name: null, dmg: { hull: 0, sails: 0 } };
  const S = { scene: s, exposure: 0.95, sway: 0.6, shadowR: 32 };
  const cam = new THREE.PerspectiveCamera(36, 1, 0.5, 900);
  S.camera = cam;
  let view = { x0: 0.03, x1: 0.6, y0: 0.13, y1: 0.8 };
  // scaffolding: shared geometry, re-laid along each new hull (posts + two walkways on the dock edge)
  const sw = k.mat('#7a5a38', { map: k.tex.planks });
  const postGeo = k.geo(new THREE.CylinderGeometry(0.08, 0.08, 1, 6)), railGeo = k.geo(new THREE.BoxGeometry(1, 1, 1));
  const scaf = new THREE.Group(); s.add(scaf);
  const layScaffold = (len, deck) => {
    scaf.clear();
    const hk = Math.max(0.7, Math.min(1.3, (deck || 3) / 3)), sx = 4.7;   // same x as before: the dock edge
    for (let z = -len / 2 + 4; z < len / 2 - 6; z += 3.2) { const m = new THREE.Mesh(postGeo, sw); m.scale.y = 7 * hk; m.position.set(sx + 1.1, 3.5 * hk, -6 + z); scaf.add(m); }
    for (const y of [3.0, 5.2]) { const m = new THREE.Mesh(railGeo, sw); m.scale.set(0.9, 0.08, Math.max(2, len - 8)); m.position.set(sx + 1.3, y * hk, -7); scaf.add(m); }
    scaf.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  };
  // camera: same three-quarter bow view as round 6 (direction kept), distance and aim fitted to the ship's box
  const DIR = new THREE.Vector3(36.8, 0.7, 54).normalize();
  const _c = new THREE.PerspectiveCamera(36, 1, 0.5, 900), _v = new THREE.Vector3(), _r = new THREE.Vector3(), _u = new THREE.Vector3();
  const fit = () => {
    const m = cur.model; if (!m) return;
    // the ship's silhouette: ~1 500 vertices of hull + spars + rigging above the waterline, plus the flags' reach
    // (pennants and ensign stream to the port quarter with windRel 0.6, see the updater below)
    const hullMesh = m.group.children.find(o => o.isMesh);
    const gb = hullMesh.geometry, pa = gb.attributes.position, step = Math.max(1, Math.floor(pa.count / 1500));
    m.group.updateMatrixWorld(true);
    const mw = m.group.matrixWorld, pts = [];
    for (let i = 0; i < pa.count; i += step) { _v.fromBufferAttribute(pa, i); if (_v.y > -0.2) pts.push(_v.clone().applyMatrix4(mw)); }
    const fly = new THREE.Vector3(Math.sin(0.6 + Math.PI), 0, -Math.cos(0.6 + Math.PI)), L = m.length || 30;
    const extra = [m.bowAnchor?.position, m.ensignAnchor?.position && m.ensignAnchor.position.clone().addScaledVector(fly, 3.6 + L * 0.16)];
    for (const t of m.mastTops || []) extra.push(t.position.clone().add(new THREE.Vector3(0, 1.2, 0)), t.position.clone().addScaledVector(fly, 5 + L * 0.18));
    for (const p of extra) if (p) pts.push(p.clone().applyMatrix4(mw));
    const b = new THREE.Box3().setFromPoints(pts), look = b.getCenter(new THREE.Vector3());
    const W = innerWidth || 1600, H = innerHeight || 900;
    _c.aspect = W / H; _c.updateProjectionMatrix();
    // region in NDC of the full (un-offset) frustum: the stage shifts the view by 17 % of the width (stage.js)
    const OFF = 0.17, rx0 = (view.x0 + OFF) * 2 - 1, rx1 = (view.x1 + OFF) * 2 - 1, ry0 = 1 - view.y1 * 2, ry1 = 1 - view.y0 * 2;
    let d = b.getSize(_v).length() * 1.6;
    const th = Math.tan(THREE.MathUtils.degToRad(_c.fov / 2));
    for (let it = 0; it < 7; it++) {
      _c.position.copy(look).addScaledVector(DIR, d); _c.lookAt(look); _c.updateMatrixWorld(true);
      let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
      for (const p of pts) { _v.copy(p).project(_c); x0 = Math.min(x0, _v.x); x1 = Math.max(x1, _v.x); y0 = Math.min(y0, _v.y); y1 = Math.max(y1, _v.y); }
      const sc = Math.max((x1 - x0) / (rx1 - rx0), (y1 - y0) / (ry1 - ry0));
      // pan so the ship's box sits in the middle of the free area, then scale the distance to fit it
      const dx = (rx0 + rx1) / 2 - (x0 + x1) / 2, dy = (ry0 + ry1) / 2 - (y0 + y1) / 2;
      _r.setFromMatrixColumn(_c.matrixWorld, 0); _u.setFromMatrixColumn(_c.matrixWorld, 1);
      look.addScaledVector(_r, -dx * d * th * _c.aspect).addScaledVector(_u, -dy * d * th);
      d *= sc;
    }
    S.look = look; S.base = look.clone().addScaledVector(DIR, d); cur.pts = pts;
    cam.position.copy(S.base);
    // fog, shadow box and sway follow the framing distance (the brig used to sit ~65 m away)
    s.fog.near = d * 0.92; s.fog.far = d * 4;
    S.sway = 0.6 * d / 65;
    S.shadowR = Math.max(32, b.getSize(_v).length() * 0.62);
    if (sun.castShadow) {
      const sc = sun.shadow.camera, R = S.shadowR;
      sun.target.position.copy(look); sc.left = sc.bottom = -R; sc.right = sc.top = R; sc.far = sun.position.distanceTo(look) + R * 2; sc.updateProjectionMatrix();
    }
  };
  S.refit = fit;
  S.setView = (v) => {
    if (!v) return;
    const nv = { x0: v.x0 ?? view.x0, x1: v.x1 ?? view.x1, y0: v.y0 ?? view.y0, y1: v.y1 ?? view.y1 };
    if (nv.x1 - nv.x0 < 0.25 || nv.y1 - nv.y0 < 0.3) return;          // degenerate layout: keep the default area
    if (['x0', 'x1', 'y0', 'y1'].every(q => Math.abs(nv[q] - view[q]) < 0.004)) return;
    view = nv; fit();
  };
  S.setDamage = (dmg) => {
    dmg ||= {};   // no player ship (warm-up of the showcases before staging): damage = null
    // forceDamage + silent: no falling-spar FX when a battered hull is shown at the quay
    cur.dmg = { hull: Math.max(0, Math.min(1, dmg.hull || 0)), sails: Math.max(0, Math.min(1, dmg.sails || 0)), silent: true };
    if (cur.model?.forceDamage) cur.model.forceDamage(cur.dmg); else cur.model?.setDamage?.(cur.dmg);
  };
  S.setShip = (type, o = {}) => {
    const faction = o.faction || pl?.faction || 'english';
    if (cur.model && type === cur.type && faction === cur.faction && !o.force) { cur.name = o.name ?? cur.name; S.setDamage(o.damage); cur.model.setWear?.(o.wear); return cur.model; }
    let model = null;
    try { model = buildShipModel(type, { faction, seed: 77, name: o.name, sailSetting: 0, jack: false }); } catch (e) { console.warn('shipyard: model', type, e); return cur.model; }
    if (cur.model) { s.remove(cur.model.group); cur.model.dispose?.(); }
    cur.model = model; cur.type = model.type; cur.faction = faction; cur.name = o.name || '';
    model.group.position.set(-(model.beam || 8) / 2 + 3.6, 0, -6); model.group.rotation.y = Math.PI;   // bow toward the camera, the stern ensign no longer fills the foreground
    s.add(model.group);
    // same shadow flags as PortStage._shadows() gives the rest of the stage
    model.group.traverse(q => { if (q.isMesh && !q.isInstancedMesh && q.material && !q.material.transparent && !q.material.isMeshBasicMaterial) { q.castShadow = q.castShadow || q.geometry.type !== 'PlaneGeometry'; q.receiveShadow = true; }
      else if (q.isInstancedMesh) { q.castShadow = true; q.receiveShadow = true; } });
    S.setDamage(o.damage);
    model.setWear?.(o.wear);   // flagship: its own weathering; a hull on the slipway: fresh paint
    model.update?.(0, 0, { sailSetting: 0, windRel: 0.6, speed: 0, damage: cur.dmg });
    layScaffold(model.length || 30, model.deckHeight);
    fit();
    return model;
  };
  S.shipInfo = () => ({ type: cur.type, faction: cur.faction, name: cur.name, damage: { hull: cur.dmg.hull, sails: cur.dmg.sails }, length: cur.model?.length || 0, look: S.look?.clone(), base: S.base?.clone() });
  S.model = () => cur.model;
  // test hook: the silhouette's screen bounds (fractions, view offset included) against the free area
  S.frameCheck = () => {
    if (!cur.pts) return null;
    const W = innerWidth || 1600, H = innerHeight || 900, c = new THREE.PerspectiveCamera(cam.fov, W / H, 0.5, 900);
    c.setViewOffset(W, H, W * 0.17, 0, W, H); c.position.copy(S.base); c.lookAt(S.look); c.updateMatrixWorld(true); c.updateProjectionMatrix();
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (const p of cur.pts) { _v.copy(p).project(c); const sx = (_v.x + 1) / 2, sy = (1 - _v.y) / 2; x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy); }
    return { x0, x1, y0, y1, view: { ...view }, fill: Math.max((x1 - x0) / (view.x1 - view.x0), (y1 - y0) / (view.y1 - view.y0)) };
  };
  k.updaters.push((t, dt) => { const m = cur.model; if (!m) return; m.update?.(Math.min(dt, 0.05), t, { sailSetting: 0, windRel: 0.6, speed: 0, damage: cur.dmg, heel: Math.sin(t * 0.5) * 0.01 }); m.group.position.y = Math.sin(t * 0.7) * 0.05; });
  k._res.add({ dispose: () => { cur.model?.dispose?.(); cur.model = null; } });
  // crane
  k.cyl(0.25, 0.3, 12, k.mat('#5a4028'), 11.5, 7, -16, s, 8);
  const jib = k.cyl(0.15, 0.15, 9, k.mat('#5a4028'), 9, 11.5, -16, s, 6); jib.rotation.z = P / 2.6;
  k.crate(5.2, 5.4, -16.3, 1, s);
  // clutter on dock
  const D = (x, z) => [9 + x, z];
  for (let i = 0; i < 6; i++) k.box(5, 0.12, 0.35, plank, ...[9 + 1.2, 1.62 + i * 0.13, 4.5], s).position.z = 4.5 + (i % 2) * 0.05;
  k.barrel(...D(2.2, 1), s, { y: 1.55 }).position.y = 1.55; k.barrel(9 + 2.6, 2.0, s, { y: 1.55 }); k.barrel(9 + 2.0, 2.4, s, { y: 1.55, s: 0.8 });
  k.crate(9 - 1.0, 1.55, 7.5, 0.8, s, 0.4); k.crate(9 - 0.2, 1.55, 8.0, 0.7, s, 0.1);
  k.cyl(0.35, 0.3, 0.5, k.mat('#1a1410', { metal: 0.4 }), 9 + 1.5, 1.8, -1.5, s, 10);   // tar pot
  k.fire(9 + 1.5, 1.55, -1.5, s, { light: 0, scale: 0.4 });
  for (let i = 0; i < 5; i++) { const sm = k.glow('#8a8078', 1.2, 0, 0, 0, s, 0.25); sm.material.blending = THREE.NormalBlending; const ph = i / 5; k.updaters.push(t => { const q = (t * 0.15 + ph) % 1; sm.position.set(9 + 1.5 + q * 1.2, 2.2 + q * 4, -1.5 - q * 0.5); sm.scale.setScalar(0.6 + q * 2.4); sm.material.opacity = 0.35 * (1 - q); }); }
  k.place(k.npc({ pose: 'gesture', hat: 'cap', hatColor: '#3a3a3a', apron: true, coat: '#5a4a3a', vest: '#e8dcc0', beard: true, s: 1.05 }), 9 - 1.4, 3.2, -0.9, s, 1.55);
  k.place(k.npc({ pose: 'stand', hat: 'bandana', coat: '#e8dcc0', vest: '#8e3a2a', tool: 'hammer' }), 9 - 2.3, -4, -P / 2, s, 1.55);
  k.place(k.npc({ pose: 'stand', hat: 'tricorn', coat: '#2c3d5a', look: 0.6 }), 9 + 1.4, 5.5, -2.2, s, 1.55);
  for (const z of [-12, 0, 10]) k.cyl(0.18, 0.2, 0.6, k.mat('#2a1e14'), 9 - 3.1, 1.85, z, s, 8);

  // longer lens (36°), framed by fit(): no wide-angle stretch on the hull, whole ship and dock in frame
  S.setShip(pl?.type || 'brig', { faction: pl?.faction || 'english', name: pl?.name, damage: pl ? { hull: 1 - pl.hull / pl.hullMax, sails: 1 - pl.sails } : null });
  if (!S.look) { cam.position.set(37.8, 9.2, 47); S.look = new THREE.Vector3(1, 8.5, -7); }   // model failed: round-6 framing
  return S;
}

// ------------------------------------------------------------------------------------------------
function hall(k, s, port, { w = 14, d = 12 } = {}) {
  room(k, s, { w, d, h: 5.2, floor: k.tex.marble, wall: k.tex.plaster, wallTint: '#efe0c4', beams: false });
  const gold = k.mat('#c9a24a', { metal: 0.75, rough: 0.35 });
  const wood = k.mat('#b07a4a', { map: k.tex.darkPlanks, rough: 0.55 });
  // wainscot + cornice
  k.box(w, 1.1, 0.08, wood, 0, 0.55, -d / 2 + 0.05, s);
  k.box(0.08, 1.1, d, wood, -w / 2 + 0.05, 0.55, 0, s); k.box(0.08, 1.1, d, wood, w / 2 - 0.05, 0.55, 0, s);
  k.box(w, 0.25, 0.3, k.mat('#f3e6cc'), 0, 5.05, -d / 2 + 0.1, s);
  // tall windows with light shafts
  const winM = k.mat('#cfe6ff', { emissive: '#bcdcff', ei: 1.6 });
  for (const x of [-4.6, 4.6]) {
    k.box(1.6, 3.2, 0.06, winM, x, 2.9, -d / 2 + 0.02, s);
    for (const dx of [-0.4, 0.4]) k.box(0.06, 3.2, 0.08, wood, x + dx, 2.9, -d / 2 + 0.06, s);
    for (const dy of [-0.8, 0, 0.8]) k.box(1.6, 0.06, 0.08, wood, x, 2.9 + dy, -d / 2 + 0.06, s);
    k.box(2.0, 0.3, 0.3, gold, x, 4.6, -d / 2 + 0.1, s);
  }
  // columns
  for (const x of [-6, 6]) for (const z of [-3.2, 1.5]) {
    k.cyl(0.32, 0.36, 4.6, k.mat('#efe6d6', { rough: 0.4 }), x, 2.6, z, s, 16);
    k.box(0.9, 0.3, 0.9, k.mat('#e8dcc4'), x, 0.15, z, s); k.box(0.9, 0.3, 0.9, gold, x, 4.95, z, s);
  }
  // runner carpet
  const rc = k.mesh(new THREE.PlaneGeometry(2.6, d), k.mat('#8a1c1c', { map: k.tex.cloth }), 0, 0.012, 0, s); rc.rotation.x = -P / 2;
  for (const x of [-1.2, 1.2]) { const b = k.mesh(new THREE.PlaneGeometry(0.12, d), k.mat('#c9a24a'), x, 0.014, 0, s); b.rotation.x = -P / 2; }
  // chandelier
  const ch = new THREE.Group(); ch.position.set(-0.8, 3.9, -0.5); s.add(ch);
  k.cyl(0.02, 0.02, 1.3, gold, 0, 0.65, 0, ch, 4);
  k.mesh(new THREE.TorusGeometry(0.8, 0.04, 6, 24), gold, 0, 0, 0, ch).rotation.x = P / 2;
  for (let i = 0; i < 8; i++) { const a = i / 8 * P * 2; k.candle(Math.cos(a) * 0.8, 0.02, Math.sin(a) * 0.8, ch); }
  const cl = new THREE.PointLight('#ffc880', 16, 12, 2); cl.position.set(0, -0.2, 0); ch.add(cl);
  return { gold, wood };
}

function governor({ kit: k, port, game }) {
  const s = new THREE.Scene();
  s.background = new THREE.Color('#1a140e'); s.fog = new THREE.Fog('#2a2016', 14, 30);
  s.add(new THREE.HemisphereLight('#c8d8f0', '#3a2a1a', 1.0));
  const sun = new THREE.DirectionalLight('#ffe8c0', 1.6); sun.position.set(3, 8, -10); s.add(sun);
  const { gold, wood } = hall(k, s, port);
  { const f = new THREE.DirectionalLight('#ffd8a8', 0.9); f.position.set(2, 3, 10); s.add(f); }
  k.banner(port.faction, 1.8, 2.7, 0, 3.0, -5.85, s);
  const seedP = [...(port.id || 'x')].reduce((a2, ch2) => a2 + ch2.charCodeAt(0), 0);
  frame(k, -2.6, 2.9, -5.9, 1.3, 1.7, s, '#3a2a20', '#4a3626', painting(k, 'portrait', seedP, game));
  frame(k, 2.6, 2.9, -5.9, 1.3, 1.7, s, '#3a2a20', '#3a3a2a', painting(k, 'sea', seedP + 3));
  // dais + desk
  k.box(6, 0.25, 3.5, k.mat('#5a2a20', { map: k.tex.cloth }), -0.8, 0.125, -2.6, s);
  const desk = new THREE.Group(); desk.position.set(-0.8, 0.25, -1.9); s.add(desk);
  k.box(3.2, 0.95, 1.3, wood, 0, 0.475, 0, desk);
  k.box(3.4, 0.08, 1.45, wood, 0, 0.99, 0, desk);
  k.box(3.22, 0.06, 1.32, gold, 0, 0.12, 0, desk);
  for (const x of [-1.2, 1.2]) k.box(0.4, 0.5, 0.02, gold, x, 0.55, 0.66, desk);
  const lg = k.mesh(new THREE.PlaneGeometry(0.8, 0.53), k.mat('#ffffff', { map: k.tex.ledger }), 0.3, 1.04, 0.15, desk); lg.rotation.x = -P / 2;
  k.cyl(0.05, 0.06, 0.08, k.mat('#1a1a1a', { rough: 0.2 }), 0.95, 1.07, 0.2, desk, 8);
  k.box(0.01, 0.25, 0.01, k.mat('#f5f0e6'), 0.95, 1.2, 0.2, desk).rotation.z = 0.3;
  k.candle(-1.2, 1.03, 0.1, desk); k.candle(-1.05, 1.03, -0.2, desk);
  k.mesh(new THREE.SphereGeometry(0.25, 14, 10), k.mat('#c9b07a', { metal: 0.3, rough: 0.5 }), 1.25, 1.33, -0.25, desk);
  // high-backed chair + governor
  k.box(1.1, 2.4, 0.15, k.mat('#6a1a1a', { map: k.tex.cloth }), -0.8, 1.45, -3.35, s);
  k.box(1.25, 0.15, 0.25, gold, -0.8, 2.7, -3.35, s);
  const nat = port.faction;
  const coatC = { english: '#8e1b1b', spanish: '#2a2a3a', french: '#2e4a8a', dutch: '#3a3a3a', pirate: '#3a2a1a' }[nat] || '#5a2a2a';
  k.place(k.npc({ pose: 'gesture', hat: 'wig', coat: coatC, vest: '#c9a24a', pants: '#e8dcc0', skin: '#e8c0a0', moustache: nat === 'spanish', s: 1.05, look: 0.2 }), -0.8, -2.75, 0.15, s, 0.25);
  // guard + secretary
  k.place(k.npc({ pose: 'stand', hat: 'morion', coat: nat === 'spanish' ? '#a88a3a' : coatC, vest: '#9aa0a6', tool: 'halberd', moustache: true }), -4.2, -2.2, 0.5, s);
  k.place(k.npc({ pose: 'arms', hat: 'wig', coat: '#2a2a2a', vest: '#e8dcc0', look: 0.3 }), 2.1, -1.2, -0.6, s);
  for (const x of [-4.8, 3.6]) { k.cyl(0.35, 0.28, 0.9, k.mat('#c8b89a', { rough: 0.5 }), x, 0.45, -5, s, 12); k.sph(0.5, k.mat('#3a7a3a', { flat: true }), x, 1.3, -5, s, 8, 6); }
  const cam = new THREE.PerspectiveCamera(46, 1, 0.1, 100);
  cam.position.set(1.2, 2.2, 7.6);
  return { scene: s, camera: cam, look: new THREE.Vector3(-1.2, 1.55, -1.8), exposure: 1.0, sway: 0.2 };
}

function bank({ kit: k, port, game }) {
  const s = new THREE.Scene();
  s.background = new THREE.Color('#140c06'); s.fog = new THREE.Fog('#1a0e06', 10, 24);
  room(k, s, { w: 12, d: 10, h: 3.8, floor: k.tex.planks, wall: k.tex.plaster, wallTint: '#b8986a' });
  s.add(new THREE.HemisphereLight('#7a7aa0', '#2a1608', 0.6));
  { const f = new THREE.DirectionalLight('#ffd8a8', 0.55); f.position.set(2, 3, 10); s.add(f); }
  const wood = k.mat('#c08a58', { map: k.tex.darkPlanks, rough: 0.6 });
  // shelves of ledgers
  for (const y of [0.9, 1.6, 2.3, 3.0]) {
    k.box(5, 0.06, 0.45, wood, -2.2, y, -4.75, s);
    for (let i = 0; i < 16; i++) { const h = 0.4 + k.r() * 0.2; k.box(0.12 + k.r() * 0.08, h, 0.32, k.mat(k.pick(['#5a1a1a', '#2a3a2a', '#3a2a1a', '#6a4a2a', '#2a2a4a'])), -4.5 + i * 0.29, y + h / 2 + 0.03, -4.72, s); }
  }
  // window
  k.box(1.4, 1.8, 0.05, k.mat('#5a7aa0', { emissive: '#3a5a8a', ei: 1.0 }), 3.4, 2.1, -4.97, s);
  // counting desk with coins sized to the purse
  const desk = new THREE.Group(); desk.position.set(-1.0, 0, -1.2); s.add(desk);
  k.box(3.0, 0.95, 1.2, wood, 0, 0.475, 0, desk); k.box(3.15, 0.07, 1.3, k.mat('#7a4a28', { map: k.tex.planks, rough: 0.4 }), 0, 0.98, 0, desk);
  const lg = k.mesh(new THREE.PlaneGeometry(0.9, 0.6), k.mat('#ffffff', { map: k.tex.ledger }), -0.6, 1.03, 0.15, desk); lg.rotation.x = -P / 2;
  const coin = k.mat('#e0b040', { metal: 0.85, rough: 0.3 });
  const gold = game.state.gold || 0, stacks = Math.max(1, Math.min(18, Math.round(Math.sqrt(gold / 40))));
  for (let i = 0; i < stacks; i++) {
    const h = 0.04 + k.r() * 0.18;
    k.cyl(0.055, 0.055, h, coin, 0.35 + (i % 6) * 0.13, 1.02 + h / 2, -0.25 + Math.floor(i / 6) * 0.14, desk, 14);
  }
  for (let i = 0; i < Math.min(12, stacks); i++) { const c = k.cyl(0.055, 0.055, 0.008, coin, 0.2 + k.r() * 0.9, 1.025, 0.2 + k.r() * 0.3, desk, 12); c.rotation.z = (k.r() - 0.5) * 0.2; }
  // scales
  k.cyl(0.02, 0.02, 0.5, coin, 1.25, 1.25, -0.4, desk, 6); k.box(0.6, 0.02, 0.02, coin, 1.25, 1.5, -0.4, desk);
  for (const dx of [-0.28, 0.28]) k.cyl(0.1, 0.08, 0.02, coin, 1.25 + dx, 1.3, -0.4, desk, 12);
  k.candle(-1.25, 1.02, -0.3, desk); k.candle(-1.1, 1.02, -0.45, desk);
  const cl = new THREE.PointLight('#ffb860', 12, 8, 2); cl.position.set(-1.2, 1.5, -0.3); desk.add(cl);
  // chests
  for (const [x, z, o] of [[2.6, -3.6, 0], [3.6, -3.2, 1], [-4.6, -2, 0]]) {
    const c = new THREE.Group(); c.position.set(x, 0, z); c.rotation.y = -0.4 + o * 0.7; s.add(c);
    k.box(1.0, 0.55, 0.6, k.mat('#6a3a1a', { map: k.tex.darkPlanks }), 0, 0.28, 0, c);
    k.box(1.02, 0.08, 0.62, k.mat('#2a2420', { metal: 0.6 }), 0, 0.5, 0, c);
    if (o) { const lid = k.box(1.0, 0.08, 0.6, k.mat('#6a3a1a', { map: k.tex.darkPlanks }), 0, 0.85, -0.3, c); lid.rotation.x = -1.1; for (let i = 0; i < 18; i++) k.sph(0.05, coin, (k.r() - 0.5) * 0.8, 0.56 + k.r() * 0.06, (k.r() - 0.5) * 0.4, c, 6, 4); k.glow('#ffd070', 1.2, 0, 0.7, 0, c, 0.3); }
  }
  k.place(k.npc({ pose: 'sit', hat: 'wig', coat: '#2a2a2a', vest: '#e8dcc0', tool: 'quill', look: 0.25 }), -1.2, -2.2, 0, s);
  k.stool(-1.2, -2.2, s);
  k.place(k.npc({ pose: 'arms', hat: 'tricorn', coat: '#3a4a3a', beard: true }), -4.0, -0.4, 0.8, s);
  k.lantern(1.6, 2.6, 0.6, s, { rope: 0.6, light: 8 });

  const cam = new THREE.PerspectiveCamera(48, 1, 0.1, 100);
  cam.position.set(1.4, 2.4, 5.6);
  return { scene: s, camera: cam, look: new THREE.Vector3(-1.2, 1.1, -1.8), exposure: 1.1, sway: 0.15 };
}

export const BUILDERS = { tavern, market, shipyard, governor, bank };
export { frame, painting };   // the tavern duel (src/game/duel/duelStages.js) hangs the governor's frames and paintings
