// buildDuelDressing(H, design, info, colors) -> THREE.Group
//   Original carved & gilded set dressing for close-up deck scenes (sword duel): gilt scrollwork panels along the
//   inner bulwarks of the waist + on the quarterdeck / forecastle screens (canvas albedo + relief normal map),
//   carved newel posts with brass caps, hanging lanterns, rope coils, belaying-pin rails, a stair to the quarterdeck.
//   Built lazily (only for ships that host a duel); shares the hull material program.
import * as THREE from 'three';
import { GeoBuilder, SURF, trs } from './builder.js';
import { makeHullMaterial } from './materials.js';

const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const C = (h) => new THREE.Color(h);

// ---------------------------------------------------------------- scrollwork textures (albedo + normal), cached
let _tex = null;
function scrollTextures() {
  if (_tex) return _tex;
  const W = 1024, H = 256;
  const hc = document.createElement('canvas'); hc.width = W; hc.height = H;
  const h = hc.getContext('2d');
  // height field: raised frame, raised scrolls, recessed ground
  h.fillStyle = '#202020'; h.fillRect(0, 0, W, H);
  const panelW = W / 2;
  const scrollsAt = (ox) => {
    // frame moulding
    h.strokeStyle = '#d8d8d8'; h.lineWidth = 16; h.strokeRect(ox + 14, 14, panelW - 28, H - 28);
    h.strokeStyle = '#9a9a9a'; h.lineWidth = 5; h.strokeRect(ox + 32, 32, panelW - 64, H - 64);
    const cx = ox + panelW / 2, cy = H / 2;
    // central cartouche (shell)
    const g = h.createRadialGradient(cx, cy, 4, cx, cy, 46); g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#707070');
    h.fillStyle = g; h.beginPath(); h.ellipse(cx, cy, 40, 50, 0, 0, 7); h.fill();
    h.strokeStyle = '#404040'; h.lineWidth = 3;
    for (let i = -3; i <= 3; i++) { h.beginPath(); h.moveTo(cx, cy + 40); h.lineTo(cx + i * 12, cy - 44); h.stroke(); }
    // mirrored acanthus C-scrolls
    for (const sg of [-1, 1]) {
      for (let k = 0; k < 3; k++) {
        const w = 22 - k * 5;
        h.lineCap = 'round';
        const hg = h.createLinearGradient(0, cy - 60, 0, cy + 60); hg.addColorStop(0, '#f0f0f0'); hg.addColorStop(1, '#a0a0a0');
        h.strokeStyle = hg; h.lineWidth = w;
        h.beginPath();
        const x0 = cx + sg * 52, x1 = cx + sg * (panelW / 2 - 70);
        h.moveTo(x0, cy + (k - 1) * 18);
        h.bezierCurveTo(x0 + sg * 60, cy - 70 + k * 10, x1 - sg * 40, cy + 70 - k * 12, x1, cy - 8 + k * 6);
        h.stroke();
        // volute curl at the end
        h.beginPath(); h.arc(x1 - sg * 6, cy - 22 + k * 8, 18 - k * 4, 0, Math.PI * 1.6 * sg, sg < 0); h.stroke();
      }
      // leaf tips
      h.fillStyle = '#d0d0d0';
      for (let k = 0; k < 4; k++) { const x = cx + sg * (80 + k * 38); h.beginPath(); h.ellipse(x, cy + (k % 2 ? 46 : -46), 12, 7, sg * 0.6, 0, 7); h.fill(); }
    }
  };
  scrollsAt(0); scrollsAt(panelW);
  const hd = h.getImageData(0, 0, W, H).data;
  // albedo: lacquer ground (deep oxblood) + gold where raised, darker gold in crevices
  const ac = document.createElement('canvas'); ac.width = W; ac.height = H;
  const a = ac.getContext('2d'); const ad = a.createImageData(W, H);
  const nc = document.createElement('canvas'); nc.width = W; nc.height = H;
  const n = nc.getContext('2d'); const nd = n.createImageData(W, H);
  const hv = (x, y) => hd[(((y + H) % H) * W + ((x + W) % W)) * 4] / 255;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4, v = hv(x, y);
    const gold = Math.min(1, Math.max(0, (v - 0.3) / 0.25));
    const noise = (Math.sin(x * 0.37 + y * 0.11) * Math.sin(y * 0.29 - x * 0.05)) * 0.06 + (Math.random() - 0.5) * 0.06;
    const gr = [0.82, 0.62, 0.24].map(c => c * (0.7 + 0.45 * v + noise));
    const gd = [0.36, 0.07, 0.06].map(c => c * (0.85 + noise));
    for (let k = 0; k < 3; k++) ad.data[i + k] = Math.min(255, 255 * (gd[k] + (gr[k] - gd[k]) * gold));
    ad.data[i + 3] = 255;
    const dx = (hv(x + 1, y) - hv(x - 1, y)) * 3.5, dy = (hv(x, y + 1) - hv(x, y - 1)) * 3.5;
    const l = Math.hypot(dx, dy, 1);
    nd.data[i] = (-dx / l * 0.5 + 0.5) * 255; nd.data[i + 1] = (dy / l * 0.5 + 0.5) * 255; nd.data[i + 2] = (1 / l * 0.5 + 0.5) * 255; nd.data[i + 3] = 255;
    // metalness/roughness in the alpha-less rough map: reuse albedo canvas? keep simple: gold mask in separate tex
  }
  a.putImageData(ad, 0, 0); n.putImageData(nd, 0, 0);
  // metal/rough map: G = roughness, B = metalness
  const mc = document.createElement('canvas'); mc.width = W; mc.height = H;
  const m = mc.getContext('2d'); const md = m.createImageData(W, H);
  for (let p = 0; p < W * H; p++) { const v = hd[p * 4] / 255; const gold = Math.min(1, Math.max(0, (v - 0.3) / 0.25)); md.data[p * 4 + 1] = (0.55 - 0.3 * gold) * 255; md.data[p * 4 + 2] = gold * 255; md.data[p * 4 + 3] = 255; }
  m.putImageData(md, 0, 0);
  const mk = (cv, srgb) => { const t = new THREE.CanvasTexture(cv); t.wrapS = THREE.RepeatWrapping; t.anisotropy = 8; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; return t; };
  _tex = { map: mk(ac, true), normal: mk(nc, false), mr: mk(mc, false) };
  return _tex;
}
let _panelMat = null;
function panelMaterial() {
  if (_panelMat) return _panelMat;
  const t = scrollTextures();
  _panelMat = new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normal, normalScale: new THREE.Vector2(1.4, 1.4), roughnessMap: t.mr, metalnessMap: t.mr, roughness: 1, metalness: 1, envMapIntensity: 1.2, side: THREE.DoubleSide });
  return _panelMat;
}

// ---------------------------------------------------------------- build
export function buildDuelDressing(H, d, info, colors) {
  const group = new THREE.Group(); group.name = 'duelDressing';
  const gb = new GeoBuilder();
  const gold = C('#d9ac48'), brass = C('#c8a050'), oakDark = C('#5a3818'), oak = C('#8a5a2c'), rope = C('#b49364'), iron = C('#2a2a2c');
  const cyl = new THREE.CylinderGeometry(1, 1, 1, 10), box = new THREE.BoxGeometry(1, 1, 1), sph = new THREE.SphereGeometry(1, 10, 8);
  const tor = new THREE.TorusGeometry(1, 0.28, 6, 18);
  const lantern = new THREE.LatheGeometry([[0, -0.5], [0.55, -0.5], [0.75, -0.25], [0.8, 0.3], [0.6, 0.5], [0, 0.5]].map(([r, y]) => new THREE.Vector2(r, y)), 8);
  const tB = 0.16;
  const fcS = d.castles.fc ? d.castles.fc.s : 0.04, qdS = d.castles.qd ? d.castles.qd.s : 0.92;
  const s0 = fcS + 0.02, s1 = qdS - 0.01;
  // panels geometry (separate mesh with the scrollwork material)
  const pPos = [], pNor = [], pUv = [], pIdx = [];
  const quad = (a, b, c, e, n, u0, u1) => {
    const k = pPos.length / 3;
    for (const [p, u, v] of [[a, u0, 0], [b, u1, 0], [c, u1, 1], [e, u0, 1]]) { pPos.push(p.x, p.y, p.z); pNor.push(n.x, n.y, n.z); pUv.push(u, v); }
    pIdx.push(k, k + 1, k + 2, k, k + 2, k + 3);
  };
  // inner bulwark panels, both sides of the waist
  for (const side of [-1, 1]) {
    const N = 40; let uAcc = 0;
    for (let i = 0; i < N; i++) {
      const sa = s0 + (s1 - s0) * i / N, sb = s0 + (s1 - s0) * (i + 1) / N;
      const P = (s, t) => { const dl = H.deckLevel(s) + 0.12, yt = H.yTop(s) - 0.22; const y = dl + (yt - dl) * t; return V3(side * (H.hw(s, y) - tB - 0.02), y, H.z(s, y)); };
      const a = P(sa, 0), b = P(sb, 0), c = P(sb, 1), e = P(sa, 1);
      const h = e.y - a.y; const du = a.distanceTo(b) / (h * 2.0);
      const nrm = V3(-side, 0, 0);
      if (side > 0) quad(b, a, e, c, nrm, uAcc + du, uAcc); else quad(a, b, c, e, nrm, uAcc, uAcc + du);
      uAcc += du;
    }
  }
  // quarterdeck & forecastle screens: carved panels on the break bulkheads, facing the waist
  for (const [k, dir] of [['qd', -1], ['fc', 1]]) {
    const c = d.castles[k]; if (!c) continue;
    const ya = H.deckLevel(c.s - 0.006), yb = H.deckLevel(c.s + 0.006), yl = Math.min(ya, yb) + 0.1, yh = Math.max(ya, yb) - 0.12;
    const hw = H.hw(c.s, yh) - tB - 0.05, z = H.z(c.s, yh) + dir * 0.09;
    const w = 2 * hw, h = yh - yl; const du = w / (h * 2.0);
    const nrm = V3(0, 0, dir);
    const A = V3(-hw, yl, z), B = V3(hw, yl, z), Cc = V3(hw, yh, z), D = V3(-hw, yh, z);
    if (dir > 0) quad(A, B, Cc, D, nrm, 0, du); else quad(B, A, D, Cc, nrm, 0, du);
    // stair up to the quarterdeck (port side) / ladder to forecastle
    const steps = Math.max(3, Math.round((yh - yl + 0.2) / 0.28));
    const sx = -hw + 0.75, sw = 1.0;
    for (let i = 0; i < steps; i++) {
      const y = yl - 0.1 + (i + 1) * (yh - yl + 0.22) / steps, zz = z + dir * (0.25 + (steps - i - 1) * 0.3);
      gb.add(box, trs(sx, y - 0.05, zz, 0, 0, 0, sw, 0.08, 0.32), { color: oak, surf: SURF.wood, worldUV: 'auto' });
    }
    for (const ox of [-sw / 2 - 0.05, sw / 2 + 0.05]) {
      const p0 = V3(sx + ox, yl - 0.1, z + dir * (0.25 + steps * 0.3)), p1 = V3(sx + ox, yh + 0.1, z + dir * 0.1);
      gb.line(p0, p1, 0.06, oakDark, SURF.wood, 6);
      gb.line(p0.clone().add(V3(0, 0.95, 0)), p1.clone().add(V3(0, 0.95, 0)), 0.045, oakDark, SURF.wood, 6);   // handrail
      for (const p of [p0, p1]) {               // newel posts with brass caps
        gb.add(cyl, trs(p.x, p.y + 0.55, p.z, 0, 0, 0, 0.09, 1.1, 0.09), { color: oakDark, surf: SURF.wood });
        gb.add(sph, trs(p.x, p.y + 1.15, p.z, 0, 0, 0, 0.12, 0.1, 0.12), { color: brass, surf: SURF.gold });
        gb.add(cyl, trs(p.x, p.y + 0.3, p.z, 0, 0, 0, 0.12, 0.08, 0.12), { color: gold, surf: SURF.gold });
      }
    }
    // real gilt relief standing proud of the painted screen — raised frame mouldings, a shell cartouche and
    // mirrored C-scrolls per module (tube geometry, catches the low sun and casts its own little shadows)
    {
      const zr = z + dir * 0.035, nMod = Math.max(1, Math.round(w / Math.max(1.6, h * 2.2))), mw = w / nMod;
      const rail = (x0, y0, x1, y1, r) => gb.line(V3(x0, y0, zr), V3(x1, y1, zr), r, gold, SURF.gold, 6);
      rail(-hw + 0.05, yl + 0.04, hw - 0.05, yl + 0.04, 0.035); rail(-hw + 0.05, yh - 0.04, hw - 0.05, yh - 0.04, 0.035);
      for (let m = 0; m < nMod; m++) {
        const cx = -hw + mw * (m + 0.5), cy = (yl + yh) / 2, sx = mw * 0.5 - 0.12, sy = h * 0.5 - 0.1;
        // inner frame
        for (const [a, b] of [[[-sx, -sy], [sx, -sy]], [[sx, -sy], [sx, sy]], [[sx, sy], [-sx, sy]], [[-sx, sy], [-sx, -sy]]]) rail(cx + a[0], cy + a[1], cx + b[0], cy + b[1], 0.022);
        // shell cartouche: a flattened half dome with radiating ribs
        const shR = Math.min(0.2, sy * 0.7);
        gb.add(sph, trs(cx, cy, zr, 0, 0, 0, shR * 0.85, shR, 0.06), { color: gold, surf: SURF.gold });
        for (let i = -3; i <= 3; i++) { const an = i * 0.32; gb.line(V3(cx, cy - shR * 0.85, zr + dir * 0.04), V3(cx + Math.sin(an) * shR * 0.95, cy - shR * 0.85 + Math.cos(an) * shR * 1.75, zr + dir * 0.04), 0.012, gold, SURF.gold, 4); }
        // mirrored C-scrolls ending in volutes
        for (const sg of [-1, 1]) {
          const pts = [];
          const x0 = cx + sg * shR * 1.1, x1 = cx + sg * (sx - 0.12);
          for (let i = 0; i <= 14; i++) {
            const t = i / 14;
            pts.push(V3(x0 + (x1 - x0) * t, cy + Math.sin(t * Math.PI * 1.15) * sy * 0.55 - sy * 0.12, zr + dir * 0.03));
          }
          const vc = pts[pts.length - 1], vr = Math.min(0.11, sy * 0.35);
          for (let i = 1; i <= 12; i++) { const a = -Math.PI / 2 + sg * i * 0.5, rr = vr * (1 - i / 15); pts.push(V3(vc.x - sg * vr + sg * Math.cos(a) * rr * sg, vc.y - vr * 0.2 + Math.sin(a) * rr, zr + dir * 0.03)); }
          const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.026, 6, false);
          gb.add(tube, new THREE.Matrix4(), { color: gold, surf: SURF.gold });
          tube.dispose();
          // acanthus leaves along the scroll
          for (let k = 2; k < 13; k += 3) gb.add(sph, trs(pts[k].x, pts[k].y + 0.05 * (k % 2 ? 1 : -1), pts[k].z, 0, 0, sg * 0.6, 0.06, 0.025, 0.03), { color: gold, surf: SURF.gold });
        }
      }
    }
    // gilded balustrade crest along the top of the screen
    gb.add(box, trs(0, yh + 0.08, z, 0, 0, 0, w + 0.2, 0.12, 0.16), { color: gold, surf: SURF.gold });
    const nb = Math.round(w / 0.32);
    for (let i = 0; i <= nb; i++) {
      const x = -hw + w * i / nb;
      gb.add(cyl, trs(x, yh + 0.48, z - dir * 0.05, 0, 0, 0, 0.05, 0.72, 0.05), { color: oakDark, surf: SURF.wood });
      gb.add(sph, trs(x, yh + 0.38, z - dir * 0.05, 0, 0, 0, 0.075, 0.12, 0.075), { color: gold, surf: SURF.gold });
    }
    gb.add(box, trs(0, yh + 0.86, z - dir * 0.05, 0, 0, 0, w + 0.1, 0.09, 0.14), { color: oakDark, surf: SURF.wood });
    // large carved posts at the screen ends, brass finials, hanging lanterns
    for (const sx2 of [-1, 1]) {
      const x = sx2 * (hw - 0.1);
      gb.add(box, trs(x, (yl + yh) / 2 + 0.4, z + dir * 0.05, 0, 0, 0, 0.24, h + 1.0, 0.24), { color: oakDark, surf: SURF.wood, worldUV: 'auto' });
      for (let j = 0; j < 3; j++) gb.add(tor, trs(x, yl + 0.4 + j * h * 0.35, z + dir * 0.05, Math.PI / 2, 0, 0, 0.15, 0.15, 0.4), { color: gold, surf: SURF.gold });
      gb.add(sph, trs(x, yh + 1.05, z + dir * 0.05, 0, 0, 0, 0.16, 0.2, 0.16), { color: brass, surf: SURF.gold });
      // lantern on a bracket
      const lp = V3(x - sx2 * 0.15, yh + 0.2, z + dir * 0.45);
      gb.line(V3(x, yh + 0.7, z + dir * 0.05), V3(lp.x, yh + 0.7, lp.z), 0.03, iron, SURF.iron, 4);
      gb.line(V3(lp.x, yh + 0.7, lp.z), lp.clone().add(V3(0, 0.3, 0)), 0.015, iron, SURF.iron, 3);
      gb.add(lantern, trs(lp.x, lp.y, lp.z, 0, 0, 0, 0.17, 0.42, 0.17), { color: C('#ffcf7a'), surf: SURF.lamp });
      gb.add(new THREE.ConeGeometry(1, 1, 8), trs(lp.x, lp.y + 0.28, lp.z, 0, 0, 0, 0.16, 0.16, 0.16), { color: brass, surf: SURF.gold });
    }
  }
  // belaying-pin rails along both bulwarks + rope coils hung/laid below + carved posts
  for (const side of [-1, 1]) {
    const N = Math.max(2, Math.round((s1 - s0) * H.L / 4.2));
    for (let i = 0; i < N; i++) {
      const s = s0 + 0.03 + (s1 - s0 - 0.06) * (i + 0.5) / N;
      const dl = H.deckLevel(s), y = dl + 0.85, x = side * (H.hw(s, y) - tB - 0.12), z = H.z(s, y);
      gb.add(box, trs(x, y, z, 0, 0, 0, 0.16, 0.1, 1.4), { color: oakDark, surf: SURF.wood, worldUV: 'auto' });
      for (let k = 0; k < 5; k++) {
        const pz = z - 0.56 + k * 0.28;
        gb.add(cyl, trs(x, y + 0.05, pz, 0, 0, 0, 0.03, 0.42, 0.03), { color: C('#c9a070'), surf: SURF.wood });
        gb.add(sph, trs(x, y + 0.27, pz, 0, 0, 0, 0.045, 0.045, 0.045), { color: C('#c9a070'), surf: SURF.wood });
        // hanging coil on each pin (flat torus)
        if (k % 2 === 0) gb.add(tor, trs(x + side * -0.04, y - 0.18, pz, 0, Math.PI / 2, 0, 0.17, 0.26, 0.5), { color: rope, surf: SURF.rope });
      }
      // laid rope coil on deck
      if (i % 2 === 1) for (let r = 0; r < 3; r++) gb.add(tor, trs(x - side * 0.5, dl + 0.04 + r * 0.05, z + 0.9, Math.PI / 2, 0, 0, 0.32 - r * 0.07, 0.32 - r * 0.07, 0.4), { color: rope, surf: SURF.rope });
      // gilt rosettes in relief on the carved bulwark panels, between the pin rails
      for (const off of [-0.95, 0.45]) {
        const sr = s + off * 1.4 / H.L, dl2 = H.deckLevel(sr), yr = dl2 + 0.12 + (H.yTop(sr) - 0.22 - dl2 - 0.12) * 0.5;
        const xr = side * (H.hw(sr, yr) - tB - 0.05), zr = H.z(sr, yr);
        gb.add(sph, trs(xr, yr, zr, 0, 0, 0, 0.035, 0.11, 0.11), { color: gold, surf: SURF.gold });
        gb.add(tor, trs(xr, yr, zr, 0, Math.PI / 2, 0, 0.15, 0.15, 0.25), { color: gold, surf: SURF.gold });
      }
      // carved gilt-capped stanchion between rails
      gb.add(box, trs(x + side * 0.02, dl + 0.65, z + 0.95, 0, 0, 0, 0.14, 1.3, 0.14), { color: oakDark, surf: SURF.wood });
      gb.add(sph, trs(x + side * 0.02, dl + 1.36, z + 0.95, 0, 0, 0, 0.1, 0.09, 0.1), { color: brass, surf: SURF.gold });
    }
  }
  const dressMat = makeHullMaterial();
  const mesh = new THREE.Mesh(gb.build(), dressMat);
  mesh.castShadow = true; mesh.receiveShadow = true;
  group.add(mesh);
  const pg = new THREE.BufferGeometry();
  pg.setAttribute('position', new THREE.Float32BufferAttribute(pPos, 3));
  pg.setAttribute('normal', new THREE.Float32BufferAttribute(pNor, 3));
  pg.setAttribute('uv', new THREE.Float32BufferAttribute(pUv, 2));
  pg.setIndex(pIdx);
  const panels = new THREE.Mesh(pg, panelMaterial());
  panels.receiveShadow = true;
  group.add(panels);
  for (const g of [cyl, box, sph, tor, lantern]) g.dispose();
  group.userData.dispose = () => { mesh.geometry.dispose(); pg.dispose(); dressMat.dispose(); };
  void colors; void info;
  return group;
}
