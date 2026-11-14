// buildHullSteps(gb, H, design, colors, rnd) -> generator of the hull build; its return value is info
//   Lofts the hull skin (painted strakes, wales, paint band, boot-top), inner bulwarks + cap rail, decks,
//   castle bulkheads, transom stern with windows/gallery/carvings/lanterns, stem/cutwater/head + figurehead,
//   rudder, gunports (lids, cannons, muzzle anchors), channels, catheads/anchors and deck props.
//   Each `yield` is a point where the build may wait for the next frame (see builder.js).
// info: { ports:{port:[{pos,dir}],starboard:[..]}, deckHeight, sternLanterns:[Vector3], lights:[Vector3] (deck lantern),
//         channels:[{s, y, xOut}], bowTip, headZ, ensignStaff, skinRange, skinSteps() -> generator painting the skin texture }
import * as THREE from 'three';
import { SURF, trs, basisMatrix } from './builder.js';
import { mulberry32, clamp01, smooth } from './noise.js';
import { BALUSTER, fineRudder, fineQuarterGalleries, fineSternWindow, fineSide, finePortLid, fineGunTackle, fineHead, fineLion, fineAnchors, fineDeck, fineBoat } from './hullFine.js';

const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const C = (h) => new THREE.Color(h);
const UP = V3(0, 1, 0);

// shared primitive geometries
const G = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 10, 1),
  cyl6: new THREE.CylinderGeometry(1, 1, 1, 6, 1),
  cone: new THREE.ConeGeometry(1, 1, 8),
  sph: new THREE.SphereGeometry(1, 10, 8),
  sphLo: new THREE.SphereGeometry(1, 7, 5),
  tor: new THREE.TorusGeometry(1, 0.22, 6, 14, Math.PI),
  torFull: new THREE.TorusGeometry(1, 0.12, 5, 16),
  plane: new THREE.PlaneGeometry(1, 1),
};
// barrel: tapered cylinder along +Y (0..1) with muzzle swell
const BARREL = (() => {
  const pts = [];
  const prof = [[0, 0.0], [0, 0.9], [0.04, 1.0], [0.12, 1.0], [0.16, 0.86], [0.55, 0.78], [0.6, 0.82], [0.9, 0.66], [0.94, 0.78], [1.0, 0.78], [1.0, 0.0]];
  for (const [y, r] of prof) pts.push(new THREE.Vector2(r, y));
  return new THREE.LatheGeometry(pts, 8);
})();
const LANTERN = (() => {
  const pts = [[0, -0.5], [0.55, -0.5], [0.75, -0.25], [0.8, 0.3], [0.6, 0.5], [0.0, 0.5]].map(([r, y]) => new THREE.Vector2(r, y));
  return new THREE.LatheGeometry(pts, 6);
})();

export function* buildHullSteps(gb, H, d, colors, rnd = mulberry32(77)) {
  const L = H.L, B = H.B;
  const info = { ports: { port: [], starboard: [] }, sternLanterns: [], channels: [], lights: [] };
  const oak = C(d.hullColor || '#a5703a');
  const oakDark = C('#6e4520');
  const tar = C('#2b1d12');
  const bottom = C('#2a1e16');
  const boot = C('#17120e');   // wet, weed-dark waterline band (reads as 'in the water')
  const bootTop = C('#d9cba6');   // tallow/white-stuff boot-topping stripe just above the wet band
  const paint = colors.paint.clone().multiplyScalar(0.9), trim = colors.trim;
  const blackstrake = C('#3a2717');   // dark tarred strakes between the wales: gives the lower hull weight
  const gold = C('#d6a843');
  const ochre = C('#7a2a18');
  const deckC = C('#a27a4a');
  const glass = C('#ffcf7a');
  const iron = C('#2a2a2c');
  // context of the fine-detail pass (hullFine.js)
  const F = { gb, H, d, info, rnd, G, BARREL, c: { oak, oakDark, tar, bottom, gold, trim, paint, iron, glass, ochre } };

  yield;
  // ---------------- s sampling (dense near castle breaks & ends)
  const breaks = [];
  for (const k of ['fc', 'qd', 'poop']) if (d.castles[k]) breaks.push(d.castles[k].s);
  let sList = [];
  for (let i = 0; i <= 72; i++) { const t = i / 72; sList.push(t < 0.5 ? 0.5 * Math.pow(2 * t, 1.25) : t); }
  for (const b of breaks) for (const o of [-0.012, -0.006, 0, 0.006, 0.012]) sList.push(b + o);
  for (const o of [0.003, 0.008, 0.016, 0.992, 0.996]) sList.push(o);
  sList = [...new Set(sList.map(s => Math.round(clamp01(s) * 1e5) / 1e5))].sort((a, b) => a - b);

  const so = (s) => H.sheerOff(s);
  const topCap = 0.13;
  const yT = (s) => H.yTop(s);
  // wale levels in sheer-relative coordinates
  const wales = d.wales.slice().sort((a, b) => a - b);
  const pf = d.paintFrom;
  const topWaleAbove = wales.find(w => w > pf);
  // band list: [lo(s), hi(s), color, surf, rows, bulge]
  const bands = [];
  bands.push([s => H.yBot(s), s => -0.05, bottom, SURF.tar, 10, 0]);
  bands.push([s => -0.05, s => 0.5, boot, SURF.tar, 2, 0]);
  bands.push([s => 0.5, s => 0.8, bootTop, SURF.paint, 1, 0.015]);
  bands.push([s => 0.8, s => 0.88, tar, SURF.tar, 1, 0.03]);
  let prev = s => 0.88;
  for (const w of wales) {
    if (w > pf && w === topWaleAbove) {
      bands.push([prev, s => pf + so(s), oak, SURF.wood, 3, 0]);
      bands.push([s => pf + so(s), s => pf + 0.05 + so(s), gold, SURF.gold, 1, 0.02]);
      bands.push([s => pf + 0.05 + so(s), s => w - 0.13 + so(s), w === wales[wales.length - 1] ? paint : blackstrake, SURF.paint, 4, 0]);
    } else if (w > pf) {
      bands.push([prev, s => w - 0.13 + so(s), blackstrake, SURF.paint, 3, 0]);
    } else {
      bands.push([prev, s => w - 0.11 + so(s), oak, SURF.wood, 2, 0]);
    }
    bands.push([s => w - 0.13 + so(s), s => w + 0.13 + so(s), tar, SURF.tar, 3, 0.13]);
    prev = (ww => s => ww + 0.11 + so(s))(w);
  }
  if (!topWaleAbove) {
    bands.push([prev, s => pf + so(s), oak, SURF.wood, 3, 0]);
    bands.push([s => pf + so(s), s => pf + 0.05 + so(s), gold, SURF.gold, 1, 0.02]);
    bands.push([s => pf + 0.05 + so(s), s => yT(s) - topCap - 0.06, paint, SURF.paint, 6, 0]);
  } else {
    { const p0 = prev, mid = s => { const lo = p0(s), hi = yT(s) - topCap - 0.06; return lo + (hi - lo) * 0.55; };
      bands.push([p0, mid, paint, SURF.paint, 6, 0]);
      bands.push([mid, s => mid(s) + 0.1, gold, SURF.gold, 1, 0.03]);
      bands.push([s => mid(s) + 0.1, s => yT(s) - topCap - 0.06, trim, SURF.paint, 5, 0]); }
  }
  bands.push([s => yT(s) - topCap - 0.06, s => yT(s) - topCap, gold, SURF.gold, 1, 0.025]);
  bands.push([s => yT(s) - topCap, s => yT(s), oakDark, SURF.wood, 1, 0.04]);

  const bandColorAt = (s, y) => { for (const b of bands) if (y >= b[0](s) && y <= b[1](s)) return b[2]; return oak; };
  const clampY = (s, y) => Math.min(H.yTop(s), Math.max(H.yBot(s), y));
  // AO for the hull outside: darker under overhangs and near waterline
  const aoSide = (y, n) => {
    let a = 1;
    if (n.y < -0.1) a *= 0.6 + 0.4 * (1 + n.y);
    if (y < 0.3) a *= 0.5 + 0.5 * smooth(-1.6, 0.3, y);
    return a;
  };

  // generic grid emitter with automatic winding
  function emitGrid(rowsVerts, cols, nrows, outwardHint) {
    // rowsVerts[i*(nrows+1)+r]. Winding is decided PER QUAD against the vertex normals (outward): deciding once from
    // the first quad (degenerate/folded at the stem) inverted whole bands, so the near skin was back-face culled and
    // the far side's inner face showed through.
    const pa = V3(), pb = V3(), pc = V3(), pe = V3(), nn = V3(), t = V3();
    let last = false;
    for (let i = 0; i < cols - 1; i++) for (let r = 0; r < nrows; r++) {
      const a = rowsVerts[i * (nrows + 1) + r], b = rowsVerts[(i + 1) * (nrows + 1) + r];
      const c = rowsVerts[(i + 1) * (nrows + 1) + r + 1], e = rowsVerts[i * (nrows + 1) + r + 1];
      pa.fromArray(gb.pos, a * 3); pb.fromArray(gb.pos, b * 3); pc.fromArray(gb.pos, c * 3); pe.fromArray(gb.pos, e * 3);
      const n = t.crossVectors(pc.sub(pa), pe.sub(pb));
      if (outwardHint) nn.copy(outwardHint);
      else { nn.fromArray(gb.nor, a * 3); for (const k of [b, c, e]) nn.x += gb.nor[k * 3], nn.y += gb.nor[k * 3 + 1], nn.z += gb.nor[k * 3 + 2]; }
      const d = n.dot(nn);
      const flip = Math.abs(d) < 1e-12 ? last : d < 0; last = flip;
      if (flip) gb.quad(a, e, c, b); else gb.quad(a, b, c, e);
    }
  }

  const arc = []; { let acc = 0, p0 = null; for (const s of sList) { const p = H.point(s, H.fb, 1); if (p0) acc += p.distanceTo(p0); arc.push(acc); p0 = p; } }
  const arcTot = arc[arc.length - 1] || 1;
  // skin v is SHEER-RELATIVE height (y - sheerOff(s)): strakes and wales run straight along the texture rows, and the
  // hull shader can redraw the plank seams analytically (anti-aliased) from v alone (uSkinR = [ys0, ys1])
  let skinY0 = 1e9, skinY1 = -1e9; for (const s of sList) { skinY0 = Math.min(skinY0, H.yBot(s) - so(s)); skinY1 = Math.max(skinY1, H.yTop(s) - so(s)); }

  yield;
  // ---------------- outer skin
  // emitted twice — full resolution for the near geometry (LOD tag 1) and a coarse copy for the far geometry
  // (tag 2: every other station except around the castle breaks and ends, ~1/3 of the rows) with the same UVs/colours
  const farIdx = []; for (let i = 0; i < sList.length; i++) {
    const s = sList[i];
    if (i % 2 === 0 || i === sList.length - 1 || s < 0.02 || s > 0.98 || breaks.some(b => Math.abs(s - b) < 0.0135)) farIdx.push(i);
  }
  const skinPass = function* (idxList, rowsOf, tag) {
    const prevLod = gb.curLod; gb.curLod = tag;
    for (const side of [-1, 1]) {
      for (const [lo, hi, col, surf, rows0, bulge] of bands) {
        const rows = rowsOf(rows0, bulge);
        const ids = [];
        for (const i of idxList) {
          const s = sList[i];
          let y0 = clampY(s, lo(s)), y1 = clampY(s, hi(s)); if (y1 < y0) y1 = y0;
          for (let r = 0; r <= rows; r++) {
            const y = y0 + (y1 - y0) * (r / rows);
            const p = H.point(s, y, side); const f = H.frame(s, y, side);
            if (bulge) { const k = Math.sin(Math.PI * r / rows) * 0.6 + 0.4; const taper = smooth(0, 0.04, s) * smooth(1, 0.97, s); p.addScaledVector(f.n, bulge * k * taper); }
            // outer skin: u = arc fraction, v = 20 + height fraction -> sampled from the per-design skin texture
            const u = arc[i] / arcTot, v = 20 + (y - so(s) - skinY0) / (skinY1 - skinY0);
            ids.push(gb.vertex(p, f.n, u, v, col, surf, 2, aoSide(y, f.n)));
          }
          if (rows > 4 && ids.length % (24 * (rows + 1)) === 0) yield;
        }
        // winding: compute so that geometric normal matches vertex normal
        emitGrid(ids, idxList.length, rows, null);
        yield;
      }
    }
    gb.curLod = prevLod;
  };
  yield* skinPass(sList.map((_, i) => i), (r) => r, 1);
  yield* skinPass(farIdx, (r, bulge) => bulge ? 2 : Math.max(1, Math.round(r / 3)), 2);

  yield;
  // ---------------- transom (closing panel at s=1), same bands -> colours match
  const zT = (y) => H.z(1, y);
  {
    const s = 1;
    for (const [lo, hi, col, surf, rows] of bands) {
      let y0 = clampY(s, lo(s)), y1 = clampY(s, hi(s)); if (y1 <= y0 + 1e-4) continue;
      const ids = [];
      for (const side of [-1, 1]) for (let r = 0; r <= rows; r++) {
        const y = y0 + (y1 - y0) * (r / rows);
        const p = H.point(1, y, side);
        const n = V3(side * 0.35, -0.15, 1).normalize();
        const c = y > d.transomY && col === bottom ? trim : col;
        ids.push(gb.vertex(p, n, p.x / 4, y / 2.24, c, surf, 2, 0.9));
      }
      emitGrid(ids, 2, rows, V3(0, 0, 1));
    }
  }

  // backing plate behind the transom: closes any gap the bands leave at the stern (narrow lower bands are skipped
  // above, and the sea showed through the counter). Full height, a hair inboard, both windings so it never culls away.
  {
    const yb = H.yBot(1), yt = H.yTop(1), rows = 8, ids = [];
    for (const side of [-1, 1]) for (let r = 0; r <= rows; r++) {
      const y = yb + (yt - yb) * (r / rows);
      const p = H.point(1, y, side); p.z -= 0.03 * Math.sign(H.z(1, y) || 1);
      ids.push(gb.vertex(p, V3(0, 0, 1), p.x / 4, y / 2.24, bottom, bands[0][3], 2, 0.75));
    }
    for (let r = 0; r < rows; r++) { const a = ids[r], b = ids[rows + 1 + r], c = ids[rows + 2 + r], e = ids[r + 1]; gb.quad(a, b, c, e); gb.quad(a, e, c, b); }
  }
  yield;
  // ---------------- inner bulwark + cap rail
  const tB = 0.14;
  const innerPt = (s, y, side) => { const p = H.point(s, y, side); const f = H.frame(s, y, side); return p.addScaledVector(f.n, -tB); };
  for (const side of [-1, 1]) {
    const ids = [], cap = [];
    for (const s of sList) {
      const dl = H.deckLevel(s), yt = H.yTop(s);
      for (let r = 0; r <= 2; r++) {
        const y = dl + (yt - dl) * (r / 2);
        const p = innerPt(Math.min(s, 0.999), y, side); const f = H.frame(Math.min(s, 0.999), y, side);
        ids.push(gb.vertex(p, f.n.clone().negate(), s * L / 6, y / 2.24, r === 2 ? oakDark : ochre, SURF.paint, 2, r === 0 ? 0.55 : r === 1 ? 0.85 : 1));
      }
      const po = H.point(s, yt, side), pi = innerPt(Math.min(s, 0.999), yt, side);
      cap.push(gb.vertex(po, UP, s * L / 6, 0, oakDark, SURF.wood, 2, 1), gb.vertex(pi, UP, s * L / 6, 0.06, oakDark, SURF.wood, 2, 1));
    }
    emitGrid(ids, sList.length, 2, null);
    emitGrid(cap, sList.length, 1, UP);
    yield;
  }
  // inner transom
  {
    const yt = H.yTop(1), dl = H.deckLevel(1);
    const ids = [];
    for (const side of [-1, 1]) for (let r = 0; r <= 1; r++) {
      const y = dl + (yt - dl) * r; const p = H.point(1, y, side); p.x *= 0.96; p.z -= tB;
      ids.push(gb.vertex(p, V3(0, 0, -1), p.x / 4, y / 2.24, ochre, SURF.paint, 2, r ? 1 : 0.6));
    }
    emitGrid(ids, 2, 1, V3(0, 0, -1));
    const capIds = [];
    for (const side of [-1, 1]) { const po = H.point(1, yt, side); const pi = po.clone(); pi.x *= 0.96; pi.z -= tB; capIds.push(gb.vertex(po, UP, 0, 0, oakDark, SURF.wood), gb.vertex(pi, UP, 0, 0.1, oakDark, SURF.wood)); }
    emitGrid(capIds, 2, 1, UP);
  }

  yield;
  // ---------------- decks (flat planked segments)
  const segs = []; let s0 = 0.0;
  for (const b of breaks.slice().sort((a, b) => a - b)) { segs.push([s0, b]); s0 = b; }
  segs.push([s0, 1]);
  const deckHalf = (s, y) => Math.max(0, H.hw(s, y) - tB - 0.02);
  for (const [a, b] of segs) {
    const ss = sList.filter(s => s >= a && s <= b); if (ss[0] > a) ss.unshift(a); if (ss[ss.length - 1] < b) ss.push(b);
    const lvl = (s) => H.deckLevel(Math.min(Math.max(s, a + 1e-4), b - 1e-4)) + 0.0;
    const ids = []; const NX = 8;
    for (const s of ss) {
      const y = lvl(s); const hw = deckHalf(Math.min(s, 0.999), y);
      for (let j = 0; j <= NX; j++) {
        const x = -hw + (2 * hw) * (j / NX); const z = H.z(Math.min(s, 0.999), y) + (s >= 0.999 ? -tB : 0);
        const edge = Math.abs(x) / Math.max(0.01, hw);
        const ao = 1 - 0.38 * smooth(0.75, 1.0, edge);
        ids.push(gb.vertex(V3(x, y, z), UP, z / 4, x / 1.9, deckC, SURF.deck, 2, ao));
      }
    }
    emitGrid(ids, ss.length, NX, UP);
  }
  info.deckHeight = H.deckLevel(H.sMax);

  yield;
  // ---------------- castle bulkheads (break fronts) with doors/windows/rails
  const bulk = (s, faceDir) => {
    const ya = H.deckLevel(s - 0.006), yb = H.deckLevel(s + 0.006);
    const yl = Math.min(ya, yb), yh = Math.max(ya, yb);
    const hw = deckHalf(s, yh) + 0.02; const z = H.z(s, yh);
    const h = yh - yl;
    gb.add(G.box, trs(0, yl + h / 2, z, 0, 0, 0, hw * 2, h, 0.12), { color: trim, surf: SURF.paint, worldUV: 'xy', ao: (p) => 0.7 + 0.3 * clamp01((p.y - yl) / h) });
    // gold moulding along top + pilasters
    gb.add(G.box, trs(0, yh - 0.05, z + faceDir * 0.07, 0, 0, 0, hw * 2, 0.1, 0.05), { color: gold, surf: SURF.gold });
    const nP = Math.max(2, Math.round(hw * 2 / 1.6));
    for (let i = 0; i <= nP; i++) {
      const x = -hw + 2 * hw * i / nP;
      gb.add(G.box, trs(x, yl + h / 2, z + faceDir * 0.07, 0, 0, 0, 0.12, h, 0.06), { color: gold, surf: SURF.gold });
      if (i < nP && h > 1.0) {
        const cx = x + hw / nP; const isDoor = i === Math.floor(nP / 2) || (nP >= 4 && i === Math.floor(nP / 2) - 1 && false);
        if (isDoor) gb.add(G.box, trs(cx, yl + Math.min(1.6, h - 0.3) / 2, z + faceDir * 0.065, 0, 0, 0, 0.75, Math.min(1.6, h - 0.3), 0.04), { color: C('#3a2414'), surf: SURF.wood, worldUV: 'xy' });
        else if (h > 1.2) gb.add(G.box, trs(cx, yl + h * 0.6, z + faceDir * 0.065, 0, 0, 0, 0.35, 0.4, 0.04), { color: glass, surf: SURF.glass });
      }
    }
    // balustrade rail on the upper deck edge
    railRun(V3(-hw, yh, z - faceDir * 0.1), V3(hw, yh, z - faceDir * 0.1), 0.85);
  };
  function railRun(a, b, h, brkLo = 0.3) {
    const len = a.distanceTo(b); const n = Math.max(2, Math.round(len / 0.32));
    const dir = b.clone().sub(a).normalize();
    for (let i = 0; i <= n; i++) {
      const p = a.clone().lerp(b, i / n);
      gb.add(G.cyl6, trs(p.x, p.y + h / 2, p.z, 0, 0, 0, 0.045, h, 0.045), { color: i % Math.max(3, n) === 0 ? oakDark : oakDark, surf: SURF.wood, brk: brkLo + rnd() * 0.7 });
    }
    const m = basisMatrix(a.clone().lerp(b, 0.5).add(V3(0, h, 0)), dir, UP, V3().crossVectors(dir, UP).normalize(), len, 0.09, 0.14);
    gb.add(G.box, m, { color: oakDark, surf: SURF.wood, brk: brkLo + rnd() * 0.7, worldUV: 'auto' });
  }
  if (d.castles.fc) bulk(d.castles.fc.s, 1);
  yield;
  if (d.castles.qd) bulk(d.castles.qd.s, -1);
  yield;
  if (d.castles.poop) bulk(d.castles.poop.s, -1);

  yield;
  // ---------------- gunports, lids, cannons
  const deckOf = (k, s) => {
    if (k === 'main') return H.deckY(s);
    if (k === 'qd') return H.deckLevel(Math.max(s, d.castles.qd ? d.castles.qd.s + 0.01 : s));
    if (k === 'fc') return H.deckLevel(Math.min(s, d.castles.fc ? d.castles.fc.s - 0.01 : s));
    return H.deckY(s);
  };
  const portMarks = [];   // [s, yBottom, size] for the skin texture (rust streaks under ports)
  for (const row of d.ports) {
    for (let i = 0; i < row.n; i++) {
      const s = row.n === 1 ? row.s0 : row.s0 + (row.s1 - row.s0) * (i / (row.n - 1));
      const yc = deckOf(row.deck, s) + row.y;
      const sz = row.size;
      const inBulwark = row.y > 0;
      portMarks.push([s, yc - sz * 0.5, sz]);
      for (const side of [-1, 1]) {
        const p = H.point(s, yc, side), f = H.frame(s, yc, side);
        const n = f.n, t = f.ds, up = V3().crossVectors(n, t).normalize(); if (up.y < 0) up.negate();
        const tt = V3().crossVectors(up, n).normalize();
        // dark opening (recess)
        gb.add(G.box, basisMatrix(p.clone().addScaledVector(n, 0.012), tt, up, n, sz, sz * 0.86, 0.02), { color: C('#0a0705'), surf: SURF.tar, ao: () => 0.4 });
        // frame
        for (const [ox, oy, w, h] of [[0, sz * 0.47, sz + 0.14, 0.07], [0, -sz * 0.47, sz + 0.14, 0.07], [sz * 0.53, 0, 0.07, sz * 0.94], [-sz * 0.53, 0, 0.07, sz * 0.94]]) {
          const c = p.clone().addScaledVector(tt, ox).addScaledVector(up, oy).addScaledVector(n, 0.03);
          gb.add(G.box, basisMatrix(c, tt, up, n, w, h, 0.06), { color: inBulwark ? oakDark : gold, surf: inBulwark ? SURF.wood : SURF.gold, worldUV: 'auto' });
        }
        // lid hinged at top, opened ~65 degrees outward
        if (!inBulwark || sz > 0.5) {
          const ang = 1.15;
          const hinge = p.clone().addScaledVector(up, sz * 0.5).addScaledVector(n, 0.05);
          const lidUp = up.clone().multiplyScalar(Math.cos(ang)).addScaledVector(n, Math.sin(ang)).normalize();
          const lidN = V3().crossVectors(tt, lidUp).normalize();
          const c = hinge.clone().addScaledVector(lidUp, sz * 0.47);
          const lc = bandColorAt(s, yc);
          gb.add(G.box, basisMatrix(c.clone().addScaledVector(lidN, 0.025), tt, lidUp, lidN, sz * 0.98, sz * 0.92, 0.05), { color: lc, surf: lc === oak ? SURF.wood : SURF.paint, brk: 0.5 + rnd() * 0.5, worldUV: 'auto' });
          gb.add(G.box, basisMatrix(c.clone().addScaledVector(lidN, -0.025), tt, lidUp, lidN, sz * 0.92, sz * 0.86, 0.04), { color: C('#7a2216'), surf: SURF.paint, brk: 0.5 + rnd() * 0.5, ao: () => 0.8 });
          finePortLid(F, c, tt, lidUp, lidN, sz, hinge, up, n);
        }
        // cannon barrel
        const len = 1.1 + sz * 1.3, r = 0.09 + sz * 0.1;
        const out = n.clone().setY(n.y * 0.3).normalize();
        const muzzle = p.clone().addScaledVector(out, 0.28);
        const breech = muzzle.clone().addScaledVector(out, -len);
        const bx = V3().crossVectors(UP, out).normalize();
        gb.add(BARREL, basisMatrix(breech, bx, out, V3().crossVectors(bx, out).normalize(), r, len, r), { color: iron, surf: SURF.iron, lod: 1 });   // far LOD: guns run in
        if (inBulwark) {
          const car = breech.clone().addScaledVector(out, len * 0.25).add(V3(0, -r * 1.6, 0));
          gb.add(G.box, basisMatrix(car, bx, UP, out, r * 3.2, r * 2.2, len * 0.5), { color: C('#6b3f1e'), surf: SURF.wood, worldUV: 'auto', lod: 1 });
          for (const wz of [-1, 1]) for (const wx of [-1, 1]) {
            const wc = car.clone().addScaledVector(bx, wx * r * 1.75).addScaledVector(out, wz * len * 0.18).add(V3(0, -r * 0.9, 0));
            gb.add(G.cyl, basisMatrix(wc, UP, bx, out, r * 0.7, 0.08, r * 0.7), { color: C('#4a2c14'), surf: SURF.wood, lod: 1 });
          }
          fineGunTackle(F, car, out, bx, r, len, p, tt, sz);
        }
        info.ports[side < 0 ? 'port' : 'starboard'].push({ pos: muzzle.clone().addScaledVector(out, 0.08), dir: out.clone() });
        yield;
      }
    }
  }

  yield;
  // ---------------- stern: windows, gallery, carvings, lanterns, taffrail crest
  const st = d.stern;
  {
    const yTopS = H.yTop(1);
    const yBase = Math.max(d.transomY + 0.25, H.deckY(1) - 0.2);
    const rowsN = st.windowRows.length;
    const span = yTopS - 0.5 - yBase;
    const rowH = Math.min(1.25, span / rowsN);
    for (let r = 0; r < rowsN; r++) {
      const n = st.windowRows[r];
      const yc = yBase + rowH * (r + 0.5);
      const hwT = H.hw(1, yc) * 0.84;
      const wW = Math.min(0.75, (2 * hwT) / n * 0.62), wH = rowH * 0.62;
      const zc = zT(yc) + 0.05;
      for (let i = 0; i < n; i++) {
        const x = -hwT + 2 * hwT * (i + 0.5) / n;
        gb.add(G.box, trs(x, yc, zc, -0.1, 0, 0, wW, wH, 0.04), { color: glass, surf: SURF.glass });
        // mullions
        fineSternWindow(F, x, yc, zc, wW, wH);   // leaded lattice, stiles, keystone
        // gilded frame
        gb.add(G.box, trs(x, yc + wH / 2 + 0.05, zc + 0.04, -0.1, 0, 0, wW + 0.16, 0.08, 0.06), { color: gold, surf: SURF.gold });
        gb.add(G.box, trs(x, yc - wH / 2 - 0.05, zc + 0.04, -0.1, 0, 0, wW + 0.16, 0.08, 0.06), { color: gold, surf: SURF.gold });
        // arched pediment over the windows
        gb.add(G.tor, trs(x, yc + wH / 2 + 0.05, zc + 0.05, -0.1, 0, 0, wW * 0.55, wW * 0.4, 0.4), { color: gold, surf: SURF.gold });
        yield;
      }
      // pilasters between windows (gold)
      for (let i = 0; i <= n; i++) {
        const x = -hwT + 2 * hwT * i / n;
        gb.add(G.box, trs(x, yc, zc + 0.03, -0.1, 0, 0, 0.1, rowH * 0.95, 0.08), { color: gold, surf: SURF.gold });
      }
      // horizontal mouldings
      gb.add(G.box, trs(0, yc - rowH / 2, zc + 0.04, -0.1, 0, 0, hwT * 2.15, 0.09, 0.1), { color: gold, surf: SURF.gold });
      yield;
      // stern gallery (balcony) for big ships
      if (st.gallery && r === 0) {
        const gz = zc + 0.9, gy = yc - rowH / 2 - 0.05, gw = hwT * 2.0;
        gb.add(G.box, trs(0, gy, gz - 0.42, 0, 0, 0, gw, 0.16, 1.1), { color: oakDark, surf: SURF.wood, worldUV: 'auto', ao: (p, nn) => nn.y < 0 ? 0.55 : 1 });
        const nb = Math.round(gw / 0.25);
        for (let k = 0; k <= nb; k++) gb.add(BALUSTER, trs(-gw / 2 + gw * k / nb, gy + 0.06, gz + 0.08, 0, 0, 0, 0.1, 0.48, 0.1), { color: gold, surf: SURF.gold, brk: 0.4 + rnd() * 0.6, lod: 1 });
        yield;
        gb.add(G.box, trs(0, gy + 0.56, gz + 0.08, 0, 0, 0, gw, 0.07, 0.1), { color: gold, surf: SURF.gold });
        gb.add(G.box, trs(0, gy + rowH * 0.95, gz - 0.42, 0, 0, 0, gw * 1.02, 0.1, 1.15), { color: gold, surf: SURF.gold });
        for (const sx of [-1, 1]) gb.add(G.box, trs(sx * gw / 2, gy + rowH * 0.47, gz - 0.42, 0, 0, 0, 0.12, rowH * 0.95, 1.1), { color: trim, surf: SURF.paint, worldUV: 'auto' });
        // consoles under gallery
        for (let k = 0; k <= 4; k++) gb.add(G.box, trs(-gw / 2 + gw * k / 4, gy - 0.25, gz - 0.3, 0.6, 0, 0, 0.1, 0.5, 0.12), { color: gold, surf: SURF.gold });
      }
    }
    yield;
    // counter carving band below windows: name board in trim with gold scrolls
    const cy = yBase - 0.2; const hwc = H.hw(1, cy) * 0.8;
    gb.add(G.box, trs(0, cy, zT(cy) + 0.05, -0.1, 0, 0, hwc * 2, 0.3, 0.05), { color: trim, surf: SURF.paint });
    for (const sx of [-1, 1]) gb.add(G.tor, trs(sx * hwc * 0.85, cy, zT(cy) + 0.08, -0.1, 0, sx > 0 ? 0 : Math.PI, 0.18, 0.18, 0.4), { color: gold, surf: SURF.gold });
    yield;
    // corner quarter-pieces: tall gilded figures/scrolls at the transom corners
    const qy0 = yBase - 0.2, qy1 = yTopS;
    for (const sx of [-1, 1]) {
      const n = 5;
      for (let k = 0; k < n; k++) {
        const y = qy0 + (qy1 - qy0) * (k + 0.5) / n; const x = sx * H.hw(1, y) * 0.97, z = zT(y) + 0.05;
        gb.add(k % 2 ? G.sphLo : G.cyl, trs(x, y, z, 0, 0, 0, 0.16 - k * 0.012, k % 2 ? 0.2 : (qy1 - qy0) / n * 0.6, 0.16), { color: gold, surf: SURF.gold });
      }
      gb.add(G.tor, trs(sx * H.hw(1, qy1) * 0.85, qy1 + 0.2, zT(qy1) + 0.02, 0, 0, sx > 0 ? -0.6 : Math.PI + 0.6, 0.35, 0.35, 0.6), { color: gold, surf: SURF.gold });
    }
    yield;
    // taffrail crest (arched carved panel with shell/sun motif)
    const cr = st.crest; const ty = yTopS;
    {
      const shape = new THREE.Shape();
      const w = H.hw(1, ty) * 0.9;
      shape.moveTo(-w, 0); shape.quadraticCurveTo(-w * 0.6, cr * 0.95, 0, cr); shape.quadraticCurveTo(w * 0.6, cr * 0.95, w, 0); shape.lineTo(-w, 0);
      const g = new THREE.ExtrudeGeometry(shape, { depth: 0.18, bevelEnabled: false, curveSegments: 10 });
      gb.add(g, trs(0, ty - 0.02, zT(ty) - 0.12), { color: trim, surf: SURF.paint, worldUV: 'xy' });
      g.dispose();
      // gilded border arc + sun/shell boss
      const arcPts = 14;
      for (let k = 0; k <= arcPts; k++) {
        const t = k / arcPts; const x = -w + 2 * w * t;
        const yy = ty + cr * (1 - Math.pow(2 * t - 1, 2)) * 0.97;
        gb.add(G.sphLo, trs(x, yy, zT(ty) + 0.08, 0, 0, 0, 0.11, 0.11, 0.08), { color: gold, surf: SURF.gold });
      }
      const bossY = ty + cr * 0.45;
      gb.add(G.sph, trs(0, bossY, zT(ty) + 0.08, 0, 0, 0, cr * 0.28, cr * 0.28, 0.1), { color: gold, surf: SURF.gold });
      for (let k = 0; k < 9; k++) {
        const a = Math.PI * (k / 8);
        gb.add(G.box, trs(Math.cos(a) * cr * 0.45, bossY + Math.sin(a) * cr * 0.45 * 0.9, zT(ty) + 0.07, 0, 0, a, 0.26 * cr, 0.06, 0.05), { color: gold, surf: SURF.gold });
      }
      for (const sx of [-1, 1]) gb.add(G.tor, trs(sx * w * 0.55, ty + cr * 0.32, zT(ty) + 0.08, 0, 0, sx > 0 ? 0.3 : Math.PI - 0.3, cr * 0.22, cr * 0.22, 0.5), { color: gold, surf: SURF.gold });
    }
    yield;
    // lanterns on the taffrail
    const nl = st.lanterns;
    for (let k = 0; k < nl; k++) {
      const x = nl === 1 ? 0 : (k - (nl - 1) / 2) * H.hw(1, ty) * 0.8;
      const yb = ty + (nl === 1 || k === (nl - 1) / 2 ? cr : cr * 0.35);
      const z = zT(ty) + 0.25;
      const s = 0.38 + L * 0.004 + (k === (nl - 1) / 2 ? 0.12 : 0);
      gb.add(G.cyl6, trs(x, yb + 0.25, z - 0.1, 0.35, 0, 0, 0.05, 0.9, 0.05), { color: iron, surf: SURF.iron });
      const lc = V3(x, yb + 0.55 + s, z + 0.1);
      gb.add(LANTERN, trs(lc.x, lc.y, lc.z, 0, 0, 0, s * 0.62, s * 1.6, s * 0.62), { color: glass, surf: SURF.lamp });
      gb.add(G.cone, trs(lc.x, lc.y + s * 1.05, lc.z, 0, 0, 0, s * 0.55, s * 0.5, s * 0.55), { color: gold, surf: SURF.gold });
      gb.add(G.sphLo, trs(lc.x, lc.y + s * 1.38, lc.z, 0, 0, 0, s * 0.12, s * 0.12, s * 0.12), { color: gold, surf: SURF.gold });
      gb.add(G.cyl6, trs(lc.x, lc.y - s * 0.85, lc.z, 0, 0, 0, s * 0.5, s * 0.12, s * 0.5), { color: gold, surf: SURF.gold });
      info.sternLanterns.push(lc);
    }
    info.ensignStaff = V3(0, ty + cr * 0.6, zT(ty) - 0.15);
  }

  yield;
  // ---------------- quarter galleries (bowed, glazed, lead-roofed: hullFine.js), level with the stern windows
  if (st.quarterGalleries) {
    const yBase = Math.max(d.transomY + 0.25, H.deckY(1) - 0.2), rowsN = st.windowRows.length;
    yield* fineQuarterGalleries(F, { y0: yBase - 0.05, h: Math.min(2.7, rowsN * Math.min(1.25, (H.yTop(1) - 0.5 - yBase) / rowsN) + 0.05), zT });
  }

  yield;
  // ---------------- carved/painted panel frieze along the upper strake of the castles (big ships)
  if (L >= 30) {
    const portSet = [];
    for (const row of d.ports) for (let i = 0; i < row.n; i++) portSet.push(row.n === 1 ? row.s0 : row.s0 + (row.s1 - row.s0) * (i / (row.n - 1)));
    const pw = 0.9, step = 1.25;
    for (const side of [-1, 1]) {
      for (let z = -L / 2 + 3; z < L / 2 - 2; z += step) {
        const s = H.sAtZ(z, H.fb);
        if (s < 0.05 || s > 0.95) continue;
        const y = H.yTop(s) - topCap - 0.42;
        if (y - H.deckLevel(s) < 0.25 && H.castleRaise(s) < 0.3) continue;   // only where the side is tall enough
        if (y < pf + so(s) + 0.4) continue;
        if (portSet.some(ps => Math.abs(H.z(ps, y) - z) < 0.75)) continue;
        if (d.masts.some(m => Math.abs(m.s - s) < 0.035)) continue;
        const p = H.point(s, y, side), f = H.frame(s, y, side);
        const up = V3().crossVectors(f.n, f.ds).normalize(); if (up.y < 0) up.negate();
        const tt = V3().crossVectors(up, f.n).normalize();
        gb.add(G.box, basisMatrix(p.clone().addScaledVector(f.n, 0.015), tt, up, f.n, pw, 0.42, 0.03), { color: trim.clone().multiplyScalar(0.75), surf: SURF.paint });
        for (const [ox, oy, w, h] of [[0, 0.24, pw + 0.08, 0.05], [0, -0.24, pw + 0.08, 0.05], [pw / 2 + 0.02, 0, 0.05, 0.5], [-pw / 2 - 0.02, 0, 0.05, 0.5]]) {
          const c = p.clone().addScaledVector(tt, ox).addScaledVector(up, oy).addScaledVector(f.n, 0.03);
          gb.add(G.box, basisMatrix(c, tt, up, f.n, w, h, 0.04), { color: gold, surf: SURF.gold });
        }
        gb.add(G.sphLo, basisMatrix(p.clone().addScaledVector(f.n, 0.04), tt, up, f.n, 0.11, 0.11, 0.04), { color: gold, surf: SURF.gold });
        yield;
      }
    }
  }

  yield;
  // ---------------- rudder & stern post (hullFine.js), keel
  {
    fineRudder(F, zT);
    // keel strip along the bottom
    const kp = [];
    for (let i = 0; i <= 24; i++) { const s = i / 24; kp.push(V3(0, H.yBot(s) - 0.06, H.z(s, H.yBot(s)))); }
    for (let i = 0; i < 24; i++) gb.line(kp[i], kp[i + 1], 0.16, bottom, SURF.tar, 4);
  }

  yield;
  // ---------------- stem, cutwater & head
  {
    const yb = H.yBot(0);
    const dly = H.deckLevel(0);
    const headLen = L * (d.head === 'beak' ? 0.11 : 0.07);
    // knee of the head: shape in (z,y) plane
    const sh = new THREE.Shape();
    const pts = [];
    for (let i = 0; i <= 10; i++) { const y = yb + (dly - 0.2 - yb) * i / 10; pts.push([H.z(0, y), y]); }
    sh.moveTo(pts[0][0] + 0.1, pts[0][1]);
    for (const [z, y] of pts) sh.lineTo(z - 0.05, y);
    const tipZ = H.z(0, dly) - headLen, tipY = dly - 0.6;
    sh.quadraticCurveTo(tipZ + headLen * 0.4, dly - 0.2, tipZ, tipY + 0.4);
    sh.lineTo(tipZ + 0.2, tipY - 0.15);
    sh.quadraticCurveTo(H.z(0, 0) - headLen * 0.25, 0.6, H.z(0, -0.4) - 0.1, -0.4);
    sh.lineTo(pts[0][0] + 0.1, pts[0][1]);
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.32, bevelEnabled: false, curveSegments: 8 });
    // shape is in (x=z, y=y) -> rotate so shape x maps to world z
    const m = new THREE.Matrix4().makeBasis(V3(0, 0, 1), V3(0, 1, 0), V3(-1, 0, 0)); m.setPosition(0.16, 0, 0);
    gb.add(g, m, { color: oakDark, surf: SURF.wood, worldUV: 'auto' });
    g.dispose();
    yield;
    fineHead(F, { dly, tipY, tipZ, headLen });   // head rails, head timbers, cheeks, grating
    yield;
    info.headTip = V3(0, tipY + 0.4, tipZ);
    // figurehead
    const fp = V3(0, tipY + 0.45, tipZ - 0.1);
    const fs = 0.5 + L * 0.012;
    if (d.head === 'scroll') {
      gb.add(G.tor, trs(0, fp.y, fp.z + 0.1, 0, Math.PI / 2, 0, fs * 0.35, fs * 0.35, fs * 0.9), { color: gold, surf: SURF.gold });
      gb.add(G.sphLo, trs(0, fp.y + fs * 0.1, fp.z, 0, 0, 0, fs * 0.16, fs * 0.16, fs * 0.16), { color: gold, surf: SURF.gold });
    } else if (d.head === 'lion') {
      fineLion(F, fp, fs, gold);
    } else if (d.head === 'beak') {
      const gcol = C('#c9a24a');
      // galleon beak: crouching lion (body, chest, head with mane, forepaws)
      gb.add(G.sph, trs(0, fp.y - fs * 0.05, fp.z + fs * 0.45, -0.5, 0, 0, fs * 0.32, fs * 0.65, fs * 0.32), { color: gcol, surf: SURF.gold });
      gb.add(G.sph, trs(0, fp.y + fs * 0.32, fp.z - fs * 0.05, 0, 0, 0, fs * 0.38, fs * 0.42, fs * 0.36), { color: gcol, surf: SURF.gold });
      gb.add(G.sph, trs(0, fp.y + fs * 0.36, fp.z - fs * 0.32, 0.2, 0, 0, fs * 0.2, fs * 0.18, fs * 0.22), { color: gcol, surf: SURF.gold });
      gb.add(G.torFull, trs(0, fp.y + fs * 0.34, fp.z - fs * 0.18, 0, 0, 0, fs * 0.32, fs * 0.34, fs * 1.8), { color: gcol, surf: SURF.gold });
      for (const sx of [-1, 1]) gb.add(G.cyl6, trs(sx * fs * 0.14, fp.y - fs * 0.2, fp.z - fs * 0.15, 0.5, 0, 0, fs * 0.07, fs * 0.5, fs * 0.07), { color: gcol, surf: SURF.gold });
      // crown
      gb.add(G.cyl6, trs(0, fp.y + fs * 0.62, fp.z - fs * 0.15, 0, 0, 0, fs * 0.16, fs * 0.12, fs * 0.16), { color: gold, surf: SURF.gold });
    } else {
      // standing figure: robed torso + head, painted
      gb.add(G.cone, trs(0, fp.y + fs * 0.05, fp.z + fs * 0.1, -0.35, 0, Math.PI, fs * 0.2, fs * 0.9, fs * 0.18), { color: C('#e9e0cc'), surf: SURF.paint });
      gb.add(G.sph, trs(0, fp.y + fs * 0.6, fp.z - fs * 0.08, 0, 0, 0, fs * 0.13, fs * 0.15, fs * 0.13), { color: C('#e9cfa8'), surf: SURF.paint });
      gb.add(G.sph, trs(0, fp.y + fs * 0.66, fp.z, 0, 0, 0, fs * 0.15, fs * 0.12, fs * 0.15), { color: gold, surf: SURF.gold });
      for (const sx of [-1, 1]) gb.add(G.cyl6, trs(sx * fs * 0.17, fp.y + fs * 0.35, fp.z - fs * 0.05, 0.6, 0, sx * 0.2, fs * 0.04, fs * 0.4, fs * 0.04), { color: C('#e9cfa8'), surf: SURF.paint });
    }
    // beakhead platform for the galleon
    if (d.head === 'beak') {
      const bz0 = H.z(0.02, dly), bz1 = tipZ + 0.6;
      gb.add(G.box, trs(0, dly - 0.45, (bz0 + bz1) / 2, 0.12, 0, 0, 1.4, 0.12, bz0 - bz1), { color: oakDark, surf: SURF.wood, worldUV: 'auto', ao: (p, n) => n.y < 0 ? 0.5 : 1 });
    }
  }

  yield;
  // ---------------- catheads + bower anchors
  fineAnchors(F);

  yield;
  // ---------------- deck furniture
  const dl = (s) => H.deckLevel(s);
  const zs = (s) => H.z(s, dl(s));
  const castleFree = (s) => { let ok = true; for (const b of breaks) if (Math.abs(s - b) < 0.03) ok = false; return ok; };
  gb.defBrk = 2.2;   // duel-hideable clutter
  // main hatches (grates)
  const hatchS = [];
  { const a = d.castles.fc ? d.castles.fc.s + 0.05 : 0.15, b = d.castles.qd ? d.castles.qd.s - 0.05 : 0.75; for (let s = a; s < b; s += 0.13) hatchS.push(s); }
  for (const s of hatchS) {
    if (d.masts.some(m => Math.abs(m.s - s) < 0.05)) continue;
    const y = dl(s), z = zs(s), w = Math.min(B * 0.28, 2.2), l = Math.min(L * 0.05, 2.2);
    gb.add(G.box, trs(0, y + 0.15, z, 0, 0, 0, w + 0.2, 0.3, l + 0.2), { color: oakDark, surf: SURF.wood, worldUV: 'auto' });
    const n = Math.round(w / 0.22);
    for (let i = 0; i <= n; i++) gb.add(G.box, trs(-w / 2 + w * i / n, y + 0.31, z, 0, 0, 0, 0.05, 0.04, l), { color: C('#7a5230'), surf: SURF.wood });
    for (let i = 0; i <= n; i++) gb.add(G.box, trs(0, y + 0.31, z - l / 2 + l * i / n, 0, 0, 0, w, 0.04, 0.05), { color: C('#7a5230'), surf: SURF.wood });
    gb.add(G.box, trs(0, y + 0.28, z, 0, 0, 0, w, 0.02, l), { color: C('#120c08'), surf: SURF.tar });
    yield;
  }
  gb.defBrk = null;
  // capstan
  {
    const s = d.castles.qd ? d.castles.qd.s - 0.04 : 0.68; const y = dl(s), z = zs(s);
    const r = 0.35 + B * 0.025;
    gb.add(G.cyl, trs(0, y + 0.5, z, 0, 0, 0, r, 1.0, r), { color: C('#6b4423'), surf: SURF.wood, worldUV: 'auto' });
    gb.add(G.cyl, trs(0, y + 0.95, z, 0, 0, 0, r * 1.25, 0.18, r * 1.25), { color: oakDark, surf: SURF.wood });
    for (let k = 0; k < 4; k++) gb.add(G.box, trs(0, y + 0.95, z, 0, (k * Math.PI) / 4, 0, r * 6, 0.07, 0.07), { color: C('#7a5230'), surf: SURF.wood });
  }
  yield;
  // wheel & binnacle on the quarterdeck (or aft main deck)
  {
    const s = d.castles.qd ? Math.min(0.9, d.castles.qd.s + 0.07) : 0.86; const y = dl(s), z = zs(s);
    const wr = 0.6 + L * 0.006;
    gb.add(G.box, trs(0, y + 0.55, z + 0.15, 0, 0, 0, 0.18, 1.1, 0.25), { color: oakDark, surf: SURF.wood });
    gb.add(G.torFull, trs(0, y + 0.55 + wr * 0.6, z - 0.05, 0, 0, 0, wr, wr, 0.9), { color: C('#6b4423'), surf: SURF.wood });
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      gb.add(G.cyl6, trs(0, y + 0.55 + wr * 0.6, z - 0.05, 0, 0, a, 0.025, wr * 2.5, 0.025), { color: C('#7a5230'), surf: SURF.wood });
    }
    gb.add(G.cyl, trs(0, y + 0.55 + wr * 0.6, z - 0.08, Math.PI / 2, 0, 0, 0.08, 0.12, 0.08), { color: gold, surf: SURF.gold });
    gb.add(G.box, trs(0, y + 0.5, z - 1.1, 0, 0, 0, 0.5, 1.0, 0.45), { color: oakDark, surf: SURF.wood });
    gb.add(G.sph, trs(0, y + 1.05, z - 1.1, 0, 0, 0, 0.22, 0.14, 0.22), { color: gold, surf: SURF.gold });
    info.wheelPos = V3(0, y, z);
  }
  yield;
  gb.defBrk = 2.2;
  // barrels and crates (small clusters)
  const clutter = rnd() * 1000;
  for (let k = 0; k < 2 + (L > 30 ? 2 : 0); k++) {
    const s = 0.22 + rnd() * 0.45; if (!castleFree(s)) continue;
    const y = dl(s), z = zs(s), side = rnd() < 0.5 ? -1 : 1; const x = side * (deckHalf(s, y) - 0.5);
    for (let j = 0; j < 3; j++) {
      const bx = x - side * (j % 2) * 0.6, bz = z + (j - 1) * 0.62;
      if (j === 2 && rnd() < 0.5) gb.add(G.box, trs(bx, y + 0.3, bz, 0, rnd(), 0, 0.6, 0.6, 0.6), { color: C('#8a6038'), surf: SURF.wood, worldUV: 'auto' });
      else {
        gb.add(G.cyl, trs(bx, y + 0.4, bz, 0, 0, 0, 0.3, 0.8, 0.3), { color: C('#7b5430'), surf: SURF.wood, worldUV: 'auto', ao: (p) => 0.7 + 0.3 * clamp01((p.y - y) / 0.8) });
        for (const hy of [0.15, 0.65]) gb.add(G.cyl, trs(bx, y + hy, bz, 0, 0, 0, 0.315, 0.05, 0.315), { color: iron, surf: SURF.iron });
      }
    }
  }
  void clutter;
  yield;
  // ship's boat on the main deck
  if (d.boat) {
    const s = d.castles.fc ? d.castles.fc.s + 0.13 : 0.35; const y = dl(s) + 0.45, z = zs(s);
    const bl = Math.min(L * 0.16, 6.5), bw = bl * 0.3;
    fineBoat(F, y, z, bl, bw);
  }
  gb.defBrk = null;
  yield;
  // belfry near forecastle break
  if (d.castles.fc) {
    const s = d.castles.fc.s - 0.02, y = dl(s), z = zs(s);
    for (const sx of [-1, 1]) gb.add(G.box, trs(sx * 0.35, y + 0.6, z, 0, 0, 0, 0.1, 1.2, 0.1), { color: oakDark, surf: SURF.wood });
    gb.add(G.box, trs(0, y + 1.25, z, 0, 0, 0, 0.9, 0.1, 0.25), { color: oakDark, surf: SURF.wood });
    gb.add(G.cone, trs(0, y + 0.98, z, 0, 0, 0, 0.18, 0.32, 0.18), { color: gold, surf: SURF.gold });
  }
  // deck lantern hung on the fore side of the mainmast (lit at night: glow point + light pool, info.lights);
  // sea only (brk 2.3, hidden while uSea = 0: port stages, duel deck, moored hulls)
  {
    const m = d.masts[d.masts.length >= 2 ? 1 : 0];
    const ym = dl(m.s), yl = ym + 2.3, rM = m.r * (0.8 + B * 0.035);
    const zl = zs(m.s) + (yl - ym) * Math.tan(m.rake) - rM - 0.32;
    const s = 0.3 + L * 0.003;
    gb.add(G.box, trs(0, yl + s * 1.2, zl + 0.16, 0, 0, 0, 0.05, 0.05, 0.42), { color: iron, surf: SURF.iron, brk: 2.3, lod: 1 });
    gb.add(LANTERN, trs(0, yl, zl, 0, 0, 0, s * 0.6, s * 1.5, s * 0.6), { color: glass, surf: SURF.lamp, brk: 2.3, lod: 1 });
    gb.add(G.cone, trs(0, yl + s * 0.98, zl, 0, 0, 0, s * 0.52, s * 0.45, s * 0.52), { color: iron, surf: SURF.iron, brk: 2.3, lod: 1 });
    info.lights.push(V3(0, yl, zl));
  }
  yield;
  // ---------------- channels (chainwales) for shrouds: one per mast per side
  for (const m of d.masts) {
    const s = m.s, y = H.deckY(s) + H.castleRaise(s) + 0.05 * H.bulH;
    const len = Math.min(L * 0.12, 5.5);
    for (const side of [-1, 1]) {
      const p = H.point(s, y, side), f = H.frame(s, y, side);
      const out = 0.55;
      gb.add(G.box, basisMatrix(p.clone().addScaledVector(f.n, out / 2), f.ds, UP, V3().crossVectors(f.ds, UP).normalize(), len, 0.1, out), { color: oakDark, surf: SURF.wood, worldUV: 'auto', ao: (pp, n) => n.y < 0 ? 0.6 : 1 });
      info.channels.push({ s, side, y, mid: p.clone().addScaledVector(f.n, out), len, dir: f.ds.clone() });
    }
  }
  yield;
  yield* fineDeck(F, { dl, zs, deckHalf, breaks: [d.castles.fc && [d.castles.fc.s, 1], d.castles.qd && [d.castles.qd.s, -1], d.castles.poop && [d.castles.poop.s, -1]].filter(Boolean) });
  yield;
  yield* fineSide(F, { ports: portMarks, arcTot, wales, so });
  // info.skinSteps() starts the painting of the skin texture (a generator, see paintSkinSteps). It doesn't depend on
  // the colours: shipModel.js paints it once per type, for the first real ship (the towns' moored hulls never use it)
  const skinArgs = { H, d, sList, arc, arcTot, skinY0, skinY1, bands, wales, so, portMarks, channels: info.channels.slice() };
  info.skinSteps = () => paintSkinSteps(skinArgs);
  info.skinRange = [skinY0, skinY1];
  return info;
}

// ---------------------------------------------------------------- skin texture
// Per-design canvas (mipmapped) laid over the outer hull skin. RGB = multiplier (128 = x1) on the band colour:
// wide strakes with a clear value step per plank, wale relief (lit top / cast shadow below), rust & salt runs
// under ports, scuppers and chain plates, weed and salt bleaching at the waterline. Readable at 100-300 m.
// A generator (it yields every four columns); its return value is the texture, null without a DOM.
function* paintSkinSteps({ H, d, sList, arc, arcTot, skinY0, skinY1, bands, wales, so, portMarks, channels }) {
  if (typeof document === 'undefined') return null;
  const W = 1024, HH = 256;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = HH;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(W, HH), D = img.data;
  const hsh = (a, b = 0) => { const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return x - Math.floor(x); };
  const vn = (x, k) => { const i = Math.floor(x), f = x - i, t = f * f * (3 - 2 * f); return hsh(i, k) * (1 - t) + hsh(i + 1, k) * t; };
  const sAt = (a) => { let i = 1; while (i < arc.length - 1 && arc[i] < a) i++; const t = (a - arc[i - 1]) / Math.max(1e-6, arc[i] - arc[i - 1]); return sList[i - 1] + (sList[i] - sList[i - 1]) * clamp01(t); };
  const PW = 0.42;   // strake width (exaggerated for distance legibility)
  const deckLines = [];
  for (let k = 0; k < 64; k++) { const s = 0.06 + k * 0.03; if (s < 0.95) deckLines.push(s); }
  for (let px = 0; px < W; px++) {
    const a = (px + 0.5) / W * arcTot, s = sAt(a);
    const lim = bands.map(b => [b[0](s), b[1](s), b[3]]);
    const sof = so(s), dy = H.deckY(s);
    // streak sources hitting this column: [yTop, length, amount, r, g, b]
    const runs = [];
    for (const [ps, yb, sz] of portMarks) {
      const dx = (s - ps) * arcTot; if (Math.abs(dx) > sz * 0.75) continue;
      const k = ps * 97;
      const fine = vn(dx * 6 + k, 3) * 0.6 + vn(dx * 17 + k, 4) * 0.4;
      runs.push([yb, 1.8 + hsh(k, 1) * 1.8, (0.45 + 0.55 * smooth(0.3, 0.6, fine)) * (1 - smooth(sz * 0.4, sz * 0.75, Math.abs(dx))), 0.5, 0.3, 0.18]);
    }
    for (const c of channels) {
      const dx = (s - c.s) * arcTot; if (Math.abs(dx) > c.len * 0.5) continue;
      const fine = vn(dx * 7 + c.s * 50, 5);
      runs.push([c.y, 1.6 + hsh(c.s, 2) * 1.2, smooth(0.45, 0.8, fine) * 0.9, 0.5, 0.33, 0.22]);
    }
    for (const ds of deckLines) {
      const dx = (s - ds) * arcTot; if (Math.abs(dx) > 0.22) continue;
      runs.push([dy - 0.05, 1.2 + hsh(ds, 3) * 1.6, (1 - Math.abs(dx) / 0.22), 1.5, 1.48, 1.4]);
    }
    const grime = vn(a * 1.7, 9) * 0.6 + vn(a * 5.3, 10) * 0.4;
    // terms that only depend on the column are hoisted out of the row loop, per-strake values (k) kept from one
    // row to the next — same computations in the same order, bit-identical texture
    const blA = vn(a * 1.3, 21) * 0.6, weedA = 0.15 * vn(a * 9, 23), grA = 0.3 * vn(a * 11, 12);
    let kC = NaN, h7 = 0, vnK = 0, segC = NaN, hSeg = 0;
    for (let py = 0; py < HH; py++) {
      const y = skinY0 + (1 - (py + 0.5) / HH) * (skinY1 - skinY0) + sof;   // rows are sheer-relative (see skinY0)
      let kind = null, lo = 0, hi = 1;
      for (const [l, h, surf] of lim) if (y >= l && y <= h) { kind = surf; lo = l; hi = h; break; }
      let r = 1, g = 1, b = 1;
      const isTar = kind === SURF.tar, isGold = kind === SURF.gold, isWood = kind === SURF.wood, isPaint = kind === SURF.paint;
      if ((isWood || isPaint || (isTar && y < 0.4)) && !isGold) {
        const ys = y - sof, k = Math.floor(ys / PW), f = ys / PW - k;
        if (k !== kC) { kC = k; h7 = hsh(k, 7); vnK = vn(a * 0.6 + k * 13, k); segC = NaN; }
        const seg = Math.floor((a + h7 * 7) / 7.5);
        if (seg !== segC) { segC = seg; hSeg = hsh(k, seg); }
        const amp = isWood ? 0.5 : isPaint ? 0.3 : 0.3;
        let t = 1 + (hSeg - 0.5) * amp + (vnK - 0.5) * amp * 0.5;
        if (f < 0.1) t *= isWood ? 0.45 : 0.6;          // seam (dark caulk line)
        else if (f > 0.84) t *= isWood ? 1.2 : 1.12;   // upper bevel catches light
        const jx = ((a + h7 * 7) % 7.5); if (jx < 0.06) t *= 0.65;   // butt joint
        r *= t; g *= t; b *= t;
      }
      if (isTar && y > 0.6) {   // wale: lit top, dark under-edge
        const f = (y - lo) / Math.max(1e-3, hi - lo);
        const t = f > 0.72 ? 1.7 : f < 0.2 ? 0.6 : 1.0;
        r *= t; g *= t; b *= t;
      }
      for (const w of wales) {   // cast shadow below each wale
        const e = w - 0.13 + sof; const dd = e - y;
        if (dd > 0 && dd < 0.22) { const t = 0.5 + 0.5 * dd / 0.22; r *= t; g *= t; b *= t; }
      }
      // rust / salt runs
      for (const [yt, len, amt, cr, cg, cb] of runs) {
        const dd = yt - y; if (dd < 0 || dd > len) continue;
        const m = amt * (1 - dd / len) * (0.6 + 0.4 * vn(dd * 4 + yt, 11));
        r += (cr - r) * m; g += (cg - g) * m; b += (cb - b) * m;
      }
      // waterline: weed, wear and salt bleaching
      const bl = blA + vn(a * 4.1 + y * 3, 22) * 0.4;
      const weed = smooth(0.9, 0.05, y) * smooth(-0.4, 0.0, y) * smooth(0.3, 0.7, bl + weedA);
      r += (0.42 - r) * weed * 0.9; g += (0.72 - g) * weed * 0.9; b += (0.3 - b) * weed * 0.9;
      const salt = isTar ? 0 : smooth(1.5, 0.85, y) * smooth(0.5, 0.85, y) * smooth(0.35, 0.75, bl) * 0.3;
      r += (1.32 - r) * salt; g += (1.3 - g) * salt; b += (1.24 - b) * salt;
      // grime: vertical weathering runs, heavier low on the hull
      const gr = 1 - (0.12 + 0.12 * smooth(3.0, 0.5, y)) * smooth(0.4, 0.9, grime + grA);
      r *= gr; g *= gr; b *= gr;
      const o = (py * W + px) * 4;
      D[o] = Math.min(255, r * 128); D[o + 1] = Math.min(255, g * 128); D[o + 2] = Math.min(255, b * 128); D[o + 3] = 255;
    }
    if ((px & 3) === 3) yield;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.NoColorSpace; tex.anisotropy = 8;
  tex.wrapS = THREE.ClampToEdgeWrapping; tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}
