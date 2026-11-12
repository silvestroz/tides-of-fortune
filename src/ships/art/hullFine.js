// Fine hull detail for designs flagged `fine` (called from hull.js): pieces a 1660–1680 ship really carried, each
// shaped by what it does. Everything small is tagged for the near LOD only; the silhouette pieces (rudder, quarter
// galleries, anchors, boat) stay in both.
//   fineRudder(F, zT)             one-piece blade with a hance, sternpost, pintle straps
//   fineQuarterGalleries(F, o)    bowed galleries blended into the hull side: drop, glazed band, lead roof, finials
//   fineSternWindow(F, …)         leaded lattice of one stern window;  BALUSTER  turned baluster (lathe, y 0..1)
//   fineSide(F, o)                moulded rails along the sheer, fenders, entry steps, hawse holes, swivel guns
//   finePortLid(F, …)             strap hinges and lanyard of one gunport lid;  fineGunTackle(F, …)  breeching ropes
//   fineHead(F, o)                head rails with head timbers, cheeks, grating;  fineLion(F, fp, fs)  figurehead
//   fineAnchors(F)                catheads with knees, bower anchors (shank, arms, palms, stock, ring)
//   fineDeck(F, o)                ladders at the breaks, fife rails and pin rails with coils, galley chimney
//   fineBoat(F, …)                ship's boat: lofted shell, thwarts, gunwale, oars, chocks
// F = { gb, H, d, info, rnd, G, BARREL, c: { oak, oakDark, tar, bottom, gold, trim, paint, iron, glass, ochre } }
import * as THREE from 'three';
import { SURF, trs, basisMatrix } from './builder.js';
import { smooth, clamp01 } from './noise.js';

const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const C = (h) => new THREE.Color(h);
const UP = V3(0, 1, 0);
const hemp = C('#6f5a3c'), tarRope = C('#211a13');

export const BALUSTER = (() => {
  const prof = [[0.42, 0], [0.42, 0.08], [0.24, 0.16], [0.52, 0.42], [0.22, 0.74], [0.4, 0.9], [0.4, 1]];
  return new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 5);
})();
const COIL = new THREE.TorusGeometry(1, 0.2, 4, 8);
const RING = new THREE.TorusGeometry(1, 0.14, 4, 10);

// run fn with every part forced into the near LOD
const near = (gb, fn) => { const p = gb.curLod; gb.curLod = 1; fn(); gb.curLod = p; };

// Quad surface from a grid of points pts[i][j] (i along, j across). Normals from the grid, one colour per cell
// (cell(i, j) -> [color, surf] or null to skip), winding chosen against `out(p)` (rough outward direction).
function surface(gb, pts, cell, out, ao = 1) {
  const NI = pts.length - 1, NJ = pts[0].length - 1;
  const nrm = (i, j) => {
    const a = pts[Math.max(0, i - 1)][j], b = pts[Math.min(NI, i + 1)][j], c = pts[i][Math.max(0, j - 1)], e = pts[i][Math.min(NJ, j + 1)];
    const n = V3().crossVectors(b.clone().sub(a), e.clone().sub(c));
    if (n.lengthSq() < 1e-10) n.copy(out(pts[i][j])); n.normalize();
    if (n.dot(out(pts[i][j])) < 0) n.negate();
    return n;
  };
  for (let i = 0; i < NI; i++) for (let j = 0; j < NJ; j++) {
    const cc = cell(i, j); if (!cc) continue;
    const q = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]];
    const ids = q.map(([a, b]) => { const p = pts[a][b]; return gb.vertex(p, nrm(a, b), p.z / 4, p.y / 2.4, cc[0], cc[1], 2, typeof ao === 'function' ? ao(p) : ao); });
    const fn = V3().crossVectors(pts[i + 1][j + 1].clone().sub(pts[i][j]), pts[i][j + 1].clone().sub(pts[i + 1][j]));
    if (fn.dot(out(pts[i][j])) >= 0) gb.quad(ids[0], ids[1], ids[2], ids[3]); else gb.quad(ids[0], ids[3], ids[2], ids[1]);
  }
}

// ---------------------------------------------------------------- rudder
export function fineRudder(F, zT) {
  const { gb, H, d, G, c } = F, L = H.L;
  const yb = H.yBot(1), yh = Math.max(H.deckY(1) - 0.3, d.transomY) - 0.35;
  const w0 = L * 0.04, wHead = 0.36;
  const wAt = (y) => { const t = (y - yb) / (yh - yb); return t < 0.6 ? w0 * (1 - 0.42 * t / 0.6) : wHead + (w0 * 0.58 - wHead) * (1 - smooth(0.6, 0.7, t)); };
  const zf = (y) => zT(y) + 0.2;
  const blade = (ya, y1, col) => {
    const sh = new THREE.Shape(), N = 10;
    for (let i = 0; i <= N; i++) { const y = ya + (y1 - ya) * i / N; if (i) sh.lineTo(zf(y), y); else sh.moveTo(zf(y), y); }
    for (let i = N; i >= 0; i--) { const y = ya + (y1 - ya) * i / N; sh.lineTo(zf(y) + wAt(y), y); }
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.26, bevelEnabled: false });
    const m = new THREE.Matrix4().makeBasis(V3(0, 0, 1), V3(0, 1, 0), V3(-1, 0, 0)); m.setPosition(0.13, 0, 0);
    gb.add(g, m, { color: col, surf: SURF.wood, worldUV: 'auto', lod: 0 }); g.dispose();
  };
  blade(yb, 0.12, c.bottom); blade(0.12, yh, c.oakDark);
  // sternpost
  for (let k = 0; k < 6; k++) { const ya = yb + (yh - yb) * k / 6, y1 = yb + (yh - yb) * (k + 1) / 6; gb.line(V3(0, ya, zT(ya) + 0.06), V3(0, y1, zT(y1) + 0.06), 0.17, ya < 0 ? c.bottom : c.oakDark, SURF.wood, 4); }
  // pintle-and-gudgeon straps, one every metre or so up to the hance
  const yTopStrap = yb + (yh - yb) * 0.58, n = Math.max(3, Math.round((yTopStrap - yb) / 1.3));
  for (let k = 0; k < n; k++) {
    const y = yb + 0.45 + (yTopStrap - yb - 0.6) * k / (n - 1), w = wAt(y);
    gb.add(G.box, trs(0, y, zf(y) + w * 0.3 - 0.3, 0, 0, 0, 0.34, 0.1, w * 0.6 + 0.9), { color: c.iron, surf: SURF.iron, lod: 1 });
  }
  gb.add(G.box, trs(0, yh + 0.08, zf(yh) + wHead * 0.5, 0, 0, 0, 0.34, 0.18, wHead + 0.1), { color: c.iron, surf: SURF.iron, lod: 1 });
}

// ---------------------------------------------------------------- quarter galleries
// o: { y0, h, zAft(y) }  — window band from y0 over h, aft face flush with the transom
export function fineQuarterGalleries(F, { y0, h, zT }) {
  const { gb, H, d, G, c } = F, L = H.L;
  const lead = C('#66707a');
  const len = Math.min(L * 0.085, 3.8), out = 0.42 + L * 0.006, dropH = Math.min(1.4, h * 0.6), roofH = 0.85;
  const y1 = y0 + h, NU = 17, sill = 0.2, frieze = 0.16;
  const shape = (u) => Math.pow(Math.sin(Math.min(1, u / 0.55) * Math.PI / 2), 0.75);
  // rows: [y, R factor, kind]
  const rows = [];
  for (let k = 0; k <= 4; k++) { const t = k / 4; rows.push([y0 - dropH * (1 - t), Math.pow(t, 0.65) * 0.96 + 0.04 * t, 'drop']); }
  rows.push([y0, 1, 'sill'], [y0 + h * sill, 1, 'win'], [y0 + h * (1 - frieze), 1, 'frieze'], [y1, 1.04, 'roof']);
  for (let k = 1; k <= 4; k++) { const t = k / 4; rows.push([y1 + roofH * Math.sin(t * Math.PI / 2), 1.04 * Math.cos(t * Math.PI / 2) + 0.03, 'roof']); }
  for (const side of [-1, 1]) {
    const P = (u, y, R) => {
      const z = zT(y) - len * (1 - u);
      const sh = H.sAtZ(z, Math.min(y, H.yTop(0.97)));
      const hw = H.hw(Math.min(sh, 0.999), Math.min(y, H.yTop(sh) - 0.02));
      return V3(side * (hw + out * R * shape(u) - 0.02), y, z);
    };
    const pts = []; for (let i = 0; i < rows.length; i++) { const r = []; for (let j = 0; j <= NU; j++) r.push(P(j / NU, rows[i][0], rows[i][1])); pts.push(r); }
    const outDir = () => V3(side, 0.15, 0);
    surface(gb, pts, (i, j) => {
      const kind = rows[i][2];
      if (kind === 'drop') return [i === 3 ? c.trim : c.oakDark, i === 3 ? SURF.paint : SURF.wood];
      if (kind === 'sill') return [c.trim, SURF.paint];
      if (kind === 'frieze') return [c.trim, SURF.paint];
      if (kind === 'roof') return [lead, SURF.iron];
      return j >= 1 && (j - 1) % 4 !== 0 ? [c.glass, SURF.glass] : [c.gold, SURF.gold];
    }, outDir, (p) => 0.75 + 0.25 * clamp01((p.y - (y0 - dropH)) / dropH));
    // aft face, in the plane of the transom
    const aft = rows.map(([y, R]) => [V3(side * (Math.abs(P(1, y, 0).x) - 0.04), y, zT(y) + 0.0), P(1, y, R)]);
    surface(gb, aft, (i) => [rows[i][2] === 'roof' ? lead : rows[i][2] === 'win' ? c.glass : c.trim, rows[i][2] === 'win' ? SURF.glass : rows[i][2] === 'roof' ? SURF.iron : SURF.paint], () => V3(0, 0, 1));
    near(gb, () => {
      // mouldings along the body
      for (const [y, R, col, r] of [[y0, 1.05, c.gold, 0.06], [y0 + h * sill, 1.03, c.gold, 0.045], [y0 + h * (1 - frieze), 1.03, c.gold, 0.045], [y1, 1.1, c.gold, 0.07]]) {
        const p = []; for (let j = 0; j <= NU; j++) p.push(P(j / NU, y, R + 0.02)); p.push(V3(p[NU].x - side * out * 0.6, y, p[NU].z + 0.03));
        gb.rope(p, r, col, SURF.gold, 4);
      }
      // leaded lattice over the glass: two horizontal leads + one vertical per light
      const wa = y0 + h * sill, wb = y0 + h * (1 - frieze);
      for (const t of [1 / 3, 2 / 3]) { const p = []; for (let j = 1; j <= NU; j++) p.push(P(j / NU, wa + (wb - wa) * t, 1.012)); gb.rope(p, 0.014, c.oakDark, SURF.wood, 3); }
      for (let j = 2; j <= NU; j++) if ((j - 1) % 4 !== 0) gb.line(P(j / NU, wa, 1.012), P(j / NU, wb, 1.012), 0.014, c.oakDark, SURF.wood, 3);
      // carved scroll under the windows, finials on the roof and under the drop
      const top = P(0.62, y1 + roofH, 0.02), bot = P(0.62, y0 - dropH, 0.05);
      gb.add(G.sphLo, trs(top.x, top.y + 0.12, top.z, 0, 0, 0, 0.1, 0.16, 0.1), { color: c.gold, surf: SURF.gold });
      gb.add(G.cone, trs(top.x, top.y + 0.4, top.z, 0, 0, 0, 0.05, 0.3, 0.05), { color: c.gold, surf: SURF.gold });
      gb.add(G.sphLo, trs(bot.x, bot.y - 0.1, bot.z, 0, 0, 0, 0.11, 0.17, 0.11), { color: c.gold, surf: SURF.gold });
    });
  }
}

// leaded lattice of one stern window (x centre, yc centre, at depth zc, tilted like the transom glass)
export function fineSternWindow(F, x, yc, zc, wW, wH) {
  const { gb, G, c } = F;
  near(gb, () => {
    for (const k of [-1, 1]) gb.add(G.box, trs(x + k * wW / 6, yc, zc + 0.03, -0.1, 0, 0, 0.022, wH, 0.022), { color: c.oakDark, surf: SURF.wood });
    for (const k of [-1, 1]) gb.add(G.box, trs(x, yc + k * wH / 4, zc + 0.03, -0.1, 0, 0, wW, 0.022, 0.022), { color: c.oakDark, surf: SURF.wood });
    // side stiles and a keystone over the head
    for (const k of [-1, 1]) gb.add(G.box, trs(x + k * (wW / 2 + 0.035), yc, zc + 0.045, -0.1, 0, 0, 0.05, wH + 0.12, 0.05), { color: c.gold, surf: SURF.gold });
    gb.add(G.box, trs(x, yc + wH / 2 + 0.11, zc + 0.07, -0.1, 0, Math.PI / 4, 0.1, 0.1, 0.05), { color: c.gold, surf: SURF.gold });
  });
}

// ---------------------------------------------------------------- hull sides
// o: { ports: [[s, yBottom, size]], arcTot, wales }
export function fineSide(F, { ports, arcTot, wales, so }) {
  const { gb, H, d, G, BARREL, c } = F, L = H.L;
  const inPort = (s, y) => ports.some(([ps, yb, sz]) => Math.abs(s - ps) * arcTot < sz * 0.72 && y > yb - 0.12 && y < yb + sz + 0.12);
  const hull = (s, y, side, off) => { const p = H.point(s, y, side), f = H.frame(s, y, side); return p.addScaledVector(f.n, off); };
  near(gb, () => {
    // moulded rails following the true sheer under the castles (waist rail and drift rail) + rail under the cap
    const rails = [[(s) => H.deckY(s) + 0.12, 0.06, 0.985, 0.075, c.oakDark, SURF.wood], [(s) => H.deckY(s) + H.bulH * 0.62, 0.05, 0.985, 0.05, c.gold, SURF.gold]];
    if (H.castleRaise(0.99) > 1.2) rails.push([(s) => H.yTop(s) - Math.min(1.0, H.castleRaise(s) * 0.55) - 0.25, 0.05, 0.985, 0.055, c.oakDark, SURF.wood]);
    for (const side of [-1, 1]) for (const [yf, s0, s1, r, col, surf] of rails) {
      let prev = null;
      for (let s = s0; s <= s1 + 1e-6; s += 0.0125) {
        const y = yf(s), ok = !inPort(s, y) && y < H.yTop(s) - 0.2 && y > H.deckY(s) - 0.1 && (yf !== rails[2]?.[0] || H.castleRaise(s) > 0.5);
        const p = ok ? hull(s, y, side, r * 0.55) : null;
        if (p && prev) gb.line(prev, p, r, col, surf, 4);
        prev = p;
      }
    }
    // fenders and entry steps in the waist, in the gaps between the gunports of the main battery
    const row = d.ports[0], gaps = [];
    if (row && row.n > 2) for (let i = 0; i < row.n - 1; i++) gaps.push(row.s0 + (row.s1 - row.s0) * (i + 0.5) / (row.n - 1));
    gaps.sort((a, b) => Math.abs(a - 0.47) - Math.abs(b - 0.47));
    const yLo = (wales[0] ?? 0.9) + 0.2, yFen = (wales[wales.length - 1] ?? 1) + 0.16;
    const free = gaps.filter(s => !F.info.channels.some(ch => Math.abs(ch.s - s) * arcTot < ch.len * 0.5 + 0.3));
    for (const side of [-1, 1]) {
      for (const s of free.slice(1, 3)) {   // two fenders: skids that keep boats and casks off the planking
        const ya = yFen + so(s), yHi = H.yTop(s) - 0.04, p = [];
        for (let k = 0; k <= 4; k++) p.push(hull(s, ya + (yHi - ya) * k / 4, side, 0.07));
        gb.rope(p, 0.065, c.oakDark, SURF.wood, 4);
      }
      if (free.length) {   // entry steps: cleats up the side
        const s = free[0], yHi = H.yTop(s) - 0.25, n = Math.floor((yHi - yLo - so(s)) / 0.34);
        for (let k = 0; k <= n; k++) {
          const y = yLo + so(s) + k * 0.34, p = H.point(s, y, side), f = H.frame(s, y, side);
          gb.add(G.box, basisMatrix(p.addScaledVector(f.n, 0.06), f.ds, UP, f.n, 0.62, 0.06, 0.13), { color: c.oakDark, surf: SURF.wood });
        }
      }
      // hawse holes with their bolsters, each side of the stem
      for (const k of [0, 1]) {
        const s = 0.022 + k * 0.016, y = H.deckY(s) - 0.35 - H.fb * 0.06, p = H.point(s, y, side), f = H.frame(s, y, side);
        gb.add(G.cyl, basisMatrix(p.clone().addScaledVector(f.n, 0.02), f.ds, f.n, V3().crossVectors(f.ds, f.n), 0.2, 0.08, 0.2), { color: c.oakDark, surf: SURF.wood });
        gb.add(G.cyl, basisMatrix(p.clone().addScaledVector(f.n, 0.045), f.ds, f.n, V3().crossVectors(f.ds, f.n), 0.12, 0.06, 0.12), { color: C('#0a0705'), surf: SURF.tar });
      }
      // swivel guns on the rails of the upper works
      const sw = [];
      if (d.castles.fc) sw.push(d.castles.fc.s * 0.45);
      if (d.castles.poop) sw.push(d.castles.poop.s + 0.03, 0.965); else if (d.castles.qd) sw.push(d.castles.qd.s + 0.1);
      for (const s of sw) {
        const y = H.yTop(s), p = hull(s, y, side, -0.07), f = H.frame(s, y - 0.1, side);
        const dir = f.n.clone().setY(0.12).normalize(), bx = V3().crossVectors(UP, dir).normalize();
        gb.line(p, p.clone().add(V3(0, 0.34, 0)), 0.03, c.iron, SURF.iron, 4);
        gb.add(BARREL, basisMatrix(p.clone().add(V3(0, 0.36, 0)).addScaledVector(dir, -0.38), bx, dir, V3().crossVectors(bx, dir).normalize(), 0.055, 0.95, 0.055), { color: C('#8a6a2c'), surf: SURF.gold });
        gb.line(p.clone().add(V3(0, 0.36, 0)).addScaledVector(dir, -0.38), p.clone().add(V3(0, 0.26, 0)).addScaledVector(dir, -0.7), 0.018, c.iron, SURF.iron, 3);
      }
    }
  });
  void L;
}

// strap hinges + lanyard of an open gunport lid
export function finePortLid(F, c0, tt, lidUp, lidN, sz, hinge, up, n) {
  const { gb, G, c } = F;
  near(gb, () => {
    for (const k of [-1, 1]) gb.add(G.box, basisMatrix(c0.clone().addScaledVector(tt, k * sz * 0.28).addScaledVector(lidN, 0.055), tt, lidUp, lidN, 0.06, sz * 0.9, 0.02), { color: c.iron, surf: SURF.iron });
    const eye = c0.clone().addScaledVector(lidUp, sz * 0.36).addScaledVector(lidN, 0.06);
    gb.line(eye, hinge.clone().addScaledVector(up, sz * 0.55).addScaledVector(n, 0.02), 0.014, hemp, SURF.rope, 3);
  });
}
// breeching ropes of a gun mounted on an open deck
export function fineGunTackle(F, car, out, bx, r, len, p, tt, sz) {
  const { gb } = F;
  near(gb, () => { for (const k of [-1, 1]) gb.line(car.clone().addScaledVector(out, -len * 0.28).addScaledVector(bx, k * r * 1.2).add(V3(0, r, 0)), p.clone().addScaledVector(tt, k * sz * 0.95).addScaledVector(out, -0.2), 0.028, hemp, SURF.rope, 3); });
}

// ---------------------------------------------------------------- head
// o: { dly, tipY, tipZ, headLen }
export function fineHead(F, { dly, tipY, tipZ, headLen }) {
  const { gb, H, d, c } = F;
  near(gb, () => {
    const rail = (side, r, t) => {
      const ys = dly - 0.15 - r * 0.55, start = H.point(0.045, ys, side);
      const end = V3(side * 0.2, tipY + 0.42 - r * 0.3, tipZ + 0.3 + r * headLen * 0.12);
      const q = start.clone().lerp(end, t);
      q.x = side * (Math.abs(start.x) * (1 - t) * (1 - t) + 0.2 * t * (2 - t));
      q.y -= Math.sin(t * Math.PI) * (0.12 + r * 0.14);
      return q;
    };
    for (const side of [-1, 1]) {
      for (let r = 0; r < 3; r++) {
        const p = []; for (let i = 0; i <= 8; i++) p.push(rail(side, r, i / 8));
        gb.rope(p, r === 0 ? 0.075 : 0.06, r === 0 ? c.gold : c.oakDark, r === 0 ? SURF.gold : SURF.wood, 4);
      }
      for (const t of [0.28, 0.52, 0.76]) gb.line(rail(side, 0, t), rail(side, 2, t), 0.05, c.oakDark, SURF.wood, 4);   // head timbers
      // cheeks: knees from the bow planking onto the knee of the head
      {
        const y = dly - H.fb * 0.6, p = [];
        for (const s of [0.07, 0.045, 0.02, 0.006]) { const q = H.point(s, y, side), f = H.frame(s, y, side); p.push(q.addScaledVector(f.n, 0.07)); }
        p.push(V3(side * 0.2, y + 0.12, H.z(0, y) - headLen * 0.28), V3(side * 0.18, y + 0.3, H.z(0, y) - headLen * 0.6));
        gb.rope(p, 0.09, c.oakDark, SURF.wood, 4);
      }
    }
    // grating between the upper rails
    for (let i = 1; i <= 7; i++) { const t = i / 9; const a = rail(-1, 0, t), b = rail(1, 0, t); a.y -= 0.12; b.y -= 0.12; gb.line(a, b, 0.035, c.oakDark, SURF.wood, 4); }
    for (const k of [-0.35, 0.35]) { const a = rail(-1, 0, 0.1).lerp(rail(1, 0, 0.1), 0.5 + k), b = rail(-1, 0, 0.78).lerp(rail(1, 0, 0.78), 0.5 + k); a.y -= 0.1; b.y -= 0.1; gb.line(a, b, 0.035, c.oakDark, SURF.wood, 4); }
  });
  void d;
}

// crowned lion rampant on the knee of the head
export function fineLion(F, fp, fs, col) {
  const { gb, G, c } = F;
  const S = (g, x, y, z, rx, sx, sy, sz, o) => gb.add(g, trs(x * fs, fp.y + y * fs, fp.z + z * fs, rx, 0, 0, sx * fs, sy * fs, sz * fs), { color: col, surf: SURF.gold, ...o });
  S(G.sph, 0, -0.04, 0.66, -0.5, 0.22, 0.27, 0.66, { lod: 0 });    // loins, along the knee
  S(G.sph, 0, 0.3, 0.14, -0.95, 0.25, 0.3, 0.52, { lod: 0 });      // chest, rearing
  S(G.sph, 0, 0.66, -0.12, -0.25, 0.34, 0.4, 0.27, { lod: 0 });    // mane
  S(G.sph, 0, 0.72, -0.32, 0, 0.2, 0.22, 0.2, { lod: 0 });         // head
  near(gb, () => {
    S(RING, 0, 0.7, -0.26, 0, 0.27, 0.29, 0.5);                    // ruff of the mane round the face
    S(G.sphLo, 0, 0.66, -0.5, 0, 0.11, 0.1, 0.12);                 // muzzle
    S(G.box, 0, 0.57, -0.47, 0.4, 0.13, 0.035, 0.14);              // jaw, open
    for (const k of [-1, 1]) {
      gb.add(G.cone, trs(k * 0.15 * fs, fp.y + 0.95 * fs, fp.z - 0.24 * fs, 0, 0, -k * 0.35, 0.055 * fs, 0.12 * fs, 0.05 * fs), { color: col, surf: SURF.gold });   // ears
      gb.line(V3(k * 0.19 * fs, fp.y + 0.34 * fs, fp.z - 0.1 * fs), V3(k * 0.19 * fs, fp.y + 0.4 * fs, fp.z - 0.6 * fs), 0.07 * fs, col, SURF.gold, 5, 0.8);        // forelegs, raised
      gb.add(G.sphLo, trs(k * 0.19 * fs, fp.y + 0.4 * fs, fp.z - 0.66 * fs, 0, 0, 0, 0.085 * fs, 0.08 * fs, 0.1 * fs), { color: col, surf: SURF.gold });
      gb.line(V3(k * 0.2 * fs, fp.y + 0.0 * fs, fp.z + 0.75 * fs), V3(k * 0.2 * fs, fp.y - 0.28 * fs, fp.z + 0.5 * fs), 0.08 * fs, col, SURF.gold, 5);             // hind legs
    }
    // crown: band + points
    S(G.cyl6, 0, 0.96, -0.3, 0, 0.15, 0.08, 0.15, { color: c.gold });
    for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2; gb.add(G.cone, trs(Math.cos(a) * 0.12 * fs, fp.y + 1.05 * fs, fp.z + (-0.3 + Math.sin(a) * 0.12) * fs, 0, 0, 0, 0.03 * fs, 0.11 * fs, 0.03 * fs), { color: c.gold, surf: SURF.gold }); }
    // tail curled over the back
    gb.add(RING, trs(0, fp.y + 0.28 * fs, fp.z + 1.08 * fs, 0, Math.PI / 2, 0, 0.24 * fs, 0.24 * fs, 0.45 * fs), { color: col, surf: SURF.gold });
  });
}

// ---------------------------------------------------------------- catheads and bower anchors
export function fineAnchors(F) {
  const { gb, H, G, c } = F, L = H.L;
  const s = 0.085, y = H.deckLevel(s) + 0.28;
  for (const side of [-1, 1]) {
    const p = H.point(s, y, side);
    const dir = V3(side * 0.82, 0.12, -0.56).normalize(), reach = 0.95 + L * 0.008;
    const inb = p.clone().addScaledVector(dir, -0.9), end = p.clone().addScaledVector(dir, reach);
    gb.line(inb, end, 0.15, c.oakDark, SURF.wood, 4);
    near(gb, () => {
      gb.add(G.box, basisMatrix(end, V3().crossVectors(UP, dir).normalize(), UP, dir, 0.36, 0.36, 0.08), { color: c.gold, surf: SURF.gold });      // carved end
      gb.line(p.clone().add(V3(0, -0.85, 0)), p.clone().addScaledVector(dir, reach * 0.62).add(V3(0, -0.12, 0)), 0.09, c.oakDark, SURF.wood, 4);   // supporting knee
    });
    // anchor hanging from the cathead: shank down, arms athwartships, wooden stock fore and aft
    const as = 0.55 + L * 0.03, top = end.clone().add(V3(0, -0.45, 0)), crown = top.clone().add(V3(0, -as * 1.35, 0));
    gb.line(end.clone().add(V3(0, -0.1, 0)), top.clone().add(V3(0, 0.12, 0)), 0.035, tarRope, SURF.rope, 3);
    gb.add(RING, trs(top.x, top.y + 0.02, top.z, 0, 0, 0, 0.13 * as, 0.13 * as, 0.16 * as), { color: c.iron, surf: SURF.iron });
    gb.line(top.clone().add(V3(0, -0.1, 0)), crown, 0.055 * as, c.iron, SURF.iron, 4, 1.25);
    for (const k of [-1, 1]) {
      const a1 = crown.clone().add(V3(k * as * 0.3, as * 0.1, 0)), a2 = crown.clone().add(V3(k * as * 0.52, as * 0.36, 0));
      gb.line(crown, a1, 0.06 * as, c.iron, SURF.iron, 4); gb.line(a1, a2, 0.05 * as, c.iron, SURF.iron, 4, 0.7);
      gb.add(G.box, trs(a2.x - k * as * 0.04, a2.y - as * 0.06, a2.z, 0, 0, k * 0.85, as * 0.05, as * 0.3, as * 0.24), { color: c.iron, surf: SURF.iron, lod: 0 });   // palm
    }
    const sy = top.y - as * 0.14;
    for (const k of [-1, 1]) gb.line(V3(top.x, sy, top.z), V3(top.x, sy, top.z + k * as * 0.72), 0.085 * as, c.oakDark, SURF.wood, 4, 0.55);
    near(gb, () => { for (const k of [-0.45, -0.18, 0.18, 0.45]) gb.add(G.box, trs(top.x, sy, top.z + k * as, 0, 0, 0, as * 0.19, as * 0.19, 0.05), { color: c.iron, surf: SURF.iron }); });
  }
}

// ---------------------------------------------------------------- deck fittings
// o: { dl(s), zs(s), deckHalf(s, y), breaks: [[s, faceDir]] }
export function fineDeck(F, { dl, zs, deckHalf, breaks }) {
  const { gb, H, d, G, info, c } = F, B = H.B;
  const wood = C('#6b4423'), pinC = C('#8a6038');
  gb.defBrk = 2.2;   // hidden with the rest of the deck clutter on the duel deck
  near(gb, () => {
    // ladders at the breaks of the castles, one each side
    for (const [s, faceDir] of breaks) {
      const ya = dl(s - 0.008), yb = dl(s + 0.008), yl = Math.min(ya, yb), yh = Math.max(ya, yb), h = yh - yl;
      if (h < 0.5) continue;
      const z0 = H.z(s, yh) + faceDir * 0.14, run = h * 0.5, hw = deckHalf(s, yl);
      for (const sx of [-1, 1]) {
        const x = sx * Math.max(0.9, hw - 1.0);
        for (const k of [-1, 1]) gb.line(V3(x + k * 0.34, yl, z0 + faceDir * run), V3(x + k * 0.34, yh + 0.02, z0), 0.055, wood, SURF.wood, 4);
        const n = Math.max(2, Math.round(h / 0.27));
        for (let i = 1; i < n; i++) { const t = i / n; gb.add(G.box, trs(x, yl + h * t, z0 + faceDir * run * (1 - t), 0, 0, 0, 0.66, 0.04, 0.2), { color: pinC, surf: SURF.wood }); }
      }
    }
    // fife rail abaft each mast: two bitts, a cross rail, belaying pins, coils of the halliards
    for (const m of d.masts) {
      const y = dl(m.s), z = zs(m.s) + m.r * 1.2 + 0.75, w = Math.min(B * 0.2, 1.9);
      if (Math.abs(dl(m.s + 0.03) - y) > 0.2) continue;   // no room before a break
      for (const sx of [-1, 1]) {
        gb.add(G.box, trs(sx * w / 2, y + 0.5, z, 0, 0, 0, 0.17, 1.0, 0.17), { color: wood, surf: SURF.wood });
        gb.add(G.box, trs(sx * w / 2, y + 1.04, z, 0, 0, 0, 0.22, 0.08, 0.22), { color: c.oakDark, surf: SURF.wood });
      }
      gb.add(G.box, trs(0, y + 0.78, z, 0, 0, 0, w + 0.5, 0.09, 0.16), { color: wood, surf: SURF.wood, lod: 1 });
      const n = Math.max(4, Math.round(w / 0.3));
      for (let i = 0; i < n; i++) {
        const x = -w / 2 + 0.2 + (w - 0.4) * i / (n - 1);
        gb.add(G.cyl6, trs(x, y + 0.8, z, 0, 0, 0, 0.022, 0.34, 0.022), { color: pinC, surf: SURF.wood });
        if (i % 2 === 0) gb.add(COIL, trs(x, y + 0.52, z + 0.1, 0, 0, 0, 0.085, 0.17, 0.08), { color: hemp, surf: SURF.rope });
      }
    }
    // pin rails inside the bulwarks under the shrouds, with pins and coils
    for (const ch of info.channels) {
      const s = ch.s, yd = dl(s), y = yd + Math.min(0.85, (H.yTop(s) - yd) * 0.72);
      const p = H.point(s, y, ch.side), f = H.frame(s, y, ch.side);
      const inb = p.addScaledVector(f.n, -0.24), len = ch.len * 0.78;
      gb.add(G.box, basisMatrix(inb, f.ds, UP, f.n, len, 0.07, 0.17), { color: wood, surf: SURF.wood, lod: 1 });
      const n = Math.max(4, Math.round(len / 0.38));
      for (let i = 0; i < n; i++) {
        const q = inb.clone().addScaledVector(f.ds, -len / 2 + 0.15 + (len - 0.3) * i / (n - 1));
        gb.add(G.cyl6, trs(q.x, q.y + 0.02, q.z, 0, 0, 0, 0.02, 0.32, 0.02), { color: pinC, surf: SURF.wood });
        if (i % 2 === 1) gb.add(COIL, basisMatrix(q.clone().add(V3(0, -0.28, 0)).addScaledVector(f.n, -0.07), f.ds, UP, f.n, 0.085, 0.17, 0.08), { color: hemp, surf: SURF.rope });
      }
    }
    // galley chimney on the forecastle
    if (d.castles.fc) {
      const s = d.castles.fc.s * 0.72, y = dl(s), z = zs(s), x = -Math.min(1.2, deckHalf(s, y) * 0.4);
      gb.add(G.box, trs(x, y + 0.5, z, 0, 0, 0, 0.36, 1.0, 0.36), { color: c.iron, surf: SURF.iron });
      gb.add(G.box, trs(x, y + 1.06, z - 0.05, 0.25, 0, 0, 0.46, 0.1, 0.5), { color: c.iron, surf: SURF.iron });
    }
  });
  gb.defBrk = null;
}

// ship's boat stowed upright on chocks: lofted shell (outside painted, inside bare wood), thwarts, gunwale, oars
export function fineBoat(F, y, z, bl, bw) {
  const { gb, G, c } = F;
  const white = C('#e2d3b0'), wood = C('#8a6038'), depth = bw * 0.42, NI = 9, NJ = 8;
  const half = (t) => bw / 2 * Math.pow(Math.sin(Math.min(1, t / 0.5) * Math.PI / 2), 0.7) * (1 - 0.3 * smooth(0.62, 1, t));
  const P = (t, v, inset) => {   // t bow -> stern (bow forward, -z), v -1..1 across
    const b = Math.max(0.02, half(t) - inset), sheer = 0.16 * bw * Math.pow(Math.abs(t - 0.55) / 0.55, 2);
    const rise = (1 - 0.28 * smooth(0.25, 0, t)) * (depth - inset);
    return V3(v * b, y + depth + sheer - rise * (1 - Math.pow(Math.abs(v), 2.4)), z - bl / 2 + bl * (0.02 + 0.96 * t));
  };
  const grid = (inset) => { const g = []; for (let i = 0; i <= NI; i++) { const r = []; for (let j = 0; j <= NJ; j++) r.push(P(i / NI, -1 + 2 * j / NJ, inset)); g.push(r); } return g; };
  const b0 = gb.count;
  const mid = V3(0, y + depth * 0.6, z);
  {
    surface(gb, grid(0), (i, j) => [j === 0 || j === NJ - 1 ? c.trim : white, SURF.paint], (p) => p.clone().sub(mid).setY(p.y - mid.y - depth * 1.2), (p) => 0.7 + 0.3 * clamp01((p.y - y) / depth));
    surface(gb, grid(0.05), () => [wood, SURF.wood], (p) => mid.clone().sub(p).setY(1.5), (p) => 0.55 + 0.45 * clamp01((p.y - y) / depth));
    // transom
    const tr = [[], []]; for (let j = 0; j <= NJ; j++) { const p = P(1, -1 + 2 * j / NJ, 0); tr[0].push(p); tr[1].push(V3(p.x, y + depth + 0.16 * bw * Math.pow(0.45 / 0.55, 2), p.z)); }
    surface(gb, tr, () => [white, SURF.paint], () => V3(0, 0, 1));
  }
  near(gb, () => {
    for (const v of [-1, 1]) { const p = []; for (let i = 0; i <= NI; i++) p.push(P(i / NI, v, 0)); gb.rope(p, 0.035, c.oakDark, SURF.wood, 4); }
    for (const t of [0.3, 0.5, 0.7, 0.88]) { const a = P(t, -1, 0.04), b = P(t, 1, 0.04); gb.add(G.box, trs(0, a.y - depth * 0.3, a.z, 0, 0, 0, b.x - a.x, 0.04, 0.2), { color: wood, surf: SURF.wood }); }
    for (const k of [-1, 1]) gb.line(V3(k * bw * 0.16, y + depth * 0.76, z - bl * 0.36), V3(k * bw * 0.1, y + depth * 0.76, z + bl * 0.4), 0.03, C('#b08a5a'), SURF.wood, 4, 1.8);
  });
  for (const sz of [-1, 1]) gb.add(G.box, trs(0, y - 0.12, z + sz * bl * 0.3, 0, 0, 0, bw * 0.8, 0.5, 0.2), { color: c.oakDark, surf: SURF.wood });
  for (let i = b0; i < gb.count; i++) gb.brk[i] = 2.2;   // hidden on the duel deck, like the rest of the clutter
}
