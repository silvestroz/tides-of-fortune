// buildRig(gb, H, design, info, rnd) -> { sailGeo, pivots, tops:[Vector3], flagHoists:{ensign, pennants[]}, mastBreak }
//   Masts (lower/top/topgallant with doublings, tops, crosstrees, caps), bowsprit + jibboom, yards, booms, gaffs,
//   lateen yards; standing rigging (shrouds + ratlines, futtocks, backstays, stays) and running rigging (braces, lifts),
//   crow's nest on fore-and-aft rigs. Spars/rigging go into the hull GeoBuilder (one draw call); sails into their own
//   geometry for the sail shader. Pivots: index 2*i = square yards of mast i, 2*i+1 = boom/gaff/lateen of mast i,
//   index 6 = headsails. Each pivot = vec4(z at y=0, tan(rake), angle, 0); rotation is about the vertical axis.
import * as THREE from 'three';
import { SURF, trs, basisMatrix } from './builder.js';

const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const C = (h) => new THREE.Color(h);
const G = {
  cyl: new THREE.CylinderGeometry(1, 1, 1, 10, 1, true),
  cylC: new THREE.CylinderGeometry(1, 1, 1, 10, 1),
  cyl6: new THREE.CylinderGeometry(1, 1, 1, 6, 1),
  disc: new THREE.CylinderGeometry(1, 0.9, 1, 14, 1),
  box: new THREE.BoxGeometry(1, 1, 1),
  sph: new THREE.SphereGeometry(1, 8, 6),
  tor: new THREE.TorusGeometry(1, 0.08, 4, 18),
};

// ---------------------------------------------------------------- sail geometry accumulator
class SailBuilder {
  constructor() { this.a = { position: [], normal: [], uv: [], color: [], aSail: [], aDir: [], aAnchor: [], aTu: [], aTv: [], aPiv: [], aBreak: [] }; this.idx = []; this.n = 0; }
  // P(u,v) -> Vector3 ; anchor(u,v) -> Vector3 ; dir: Vector3 (billow direction, unit) ; depth scalar
  grid(NU, NV, P, anchor, dir, depth, group, kind, color, piv, brk = 2, uvOff = [0, 0], pivW = null) {
    const base = this.n, A = this.a, e = 1e-3;
    for (let j = 0; j <= NV; j++) for (let i = 0; i <= NU; i++) {
      const u = i / NU, v = j / NV;
      const p = P(u, v);
      const tu = P(Math.min(1, u + e), v).sub(P(Math.max(0, u - e), v)).divideScalar(Math.min(1, u + e) - Math.max(0, u - e));
      const tv = P(u, Math.min(1, v + e)).sub(P(u, Math.max(0, v - e))).divideScalar(Math.min(1, v + e) - Math.max(0, v - e));
      let nrm = V3().crossVectors(tu, tv);
      if (nrm.lengthSq() < 1e-12) nrm.copy(dir); nrm.normalize();
      const an = anchor(u, v);
      A.position.push(p.x, p.y, p.z); A.normal.push(nrm.x, nrm.y, nrm.z);
      A.uv.push(p.x / 10 + p.z / 10 + uvOff[0], p.y / 10 + uvOff[1]);
      const shade = (0.9 + 0.1 * (1 - v)) * (1 - 0.18 * Math.exp(-v * 14));
      A.color.push(color.r * shade, color.g * shade, color.b * shade);
      A.aSail.push(u, v, group, kind);
      A.aDir.push(dir.x * depth, dir.y * depth, dir.z * depth);
      A.aAnchor.push(an.x, an.y, an.z);
      A.aTu.push(tu.x, tu.y, tu.z); A.aTv.push(tv.x, tv.y, tv.z);
      A.aPiv.push(piv, pivW ? pivW(u, v) : 1);
      A.aBreak.push(brk);
      this.n++;
    }
    for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) {
      const a = base + j * (NU + 1) + i, b = a + 1, c = a + NU + 2, d = a + NU + 1;
      this.idx.push(a, b, c, a, c, d);
    }
  }
  build() {
    const g = new THREE.BufferGeometry();
    const sz = { position: 3, normal: 3, uv: 2, color: 3, aSail: 4, aDir: 3, aAnchor: 3, aTu: 3, aTv: 3, aPiv: 2, aBreak: 1 };
    for (const k in this.a) g.setAttribute(k, new THREE.Float32BufferAttribute(this.a[k], sz[k]));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    g.boundingSphere.radius *= 1.3;
    return g;
  }
}

export function buildRig(gb, H, d, info, rnd, sailColor) {
  const L = H.L, B = H.B;
  const sb = new SailBuilder();
  const spar = C('#6a4526'), sparDark = C('#3b2716'), mastC = C('#7a5432');
  const tarRope = C('#211a13'), hemp = C('#7d6646'), iron = C('#2a2a2c'), black = C('#1a1410');
  const pivots = [];
  for (let i = 0; i < 8; i++) pivots.push(new THREE.Vector4(0, 0, 0, 0));
  const tops = [], pennants = [];
  const masts = [];
  const nM = d.masts.length;
  // mast shot away at heavy sail damage: one seeded mast loses its upper masts
  const fallIdx = Math.floor(rnd() * nM);

  const sail = (c) => { const k = 0.94 + rnd() * 0.08; return C(sailColor).multiplyScalar(k); };

  // ---------- bowsprit
  const bs = d.bowsprit;
  const bsStart = V3(0, H.deckLevel(0.03) + 0.3, H.z(0.05, H.deckLevel(0.05)));
  const bsDir = V3(0, Math.sin(bs.angle), -Math.cos(bs.angle));
  const bsLen = bs.len * L;
  const bsBack = bsStart.clone().addScaledVector(bsDir, -L * 0.06);
  const bsTip = bsStart.clone().addScaledVector(bsDir, bsLen);
  const rB = 0.2 + B * 0.02;
  sparTube(bsBack, bsTip, rB, rB * 0.6, spar);
  const hasJibboom = d.headsails > 0;
  const jbTip = bsTip.clone().addScaledVector(bsDir, hasJibboom ? bsLen * 0.55 : 0);
  if (hasJibboom) sparTube(bsTip.clone().addScaledVector(bsDir, -bsLen * 0.2).add(V3(0, rB * 0.9, 0)), jbTip.clone().add(V3(0, rB * 0.6, 0)), rB * 0.55, rB * 0.35, spar);
  gb.add(G.cylC, basisMatrix(bsTip, V3(1, 0, 0), bsDir, V3().crossVectors(V3(1, 0, 0), bsDir), rB * 1.15, 0.3, rB * 1.15), { color: black, surf: SURF.wood });
  // bobstay + gammoning
  gb.line(bsTip.clone().addScaledVector(bsDir, -0.3), V3(0, 0.2, H.z(0, 0.2) - 0.1), 0.05, tarRope, SURF.rope, 3);
  // jack staff at bowsprit end
  const jackBase = (hasJibboom ? bsTip : bsTip).clone();
  info.jackHoist = jackBase.clone().add(V3(0, 2.0 + L * 0.03, 0));
  if (d.spritsail) {
    // sprit topmast stepped on a knee at the bowsprit end, with its little round top; the jack flies from its head
    const hS = L * 0.11, rS = rB * 0.5, top = bsTip.clone().add(V3(0, hS * 0.36, 0)), head = bsTip.clone().add(V3(0, hS, 0));
    gb.add(G.box, trs(bsTip.x, bsTip.y + 0.25, bsTip.z + 0.3, 0.6, 0, 0, rB * 1.1, 0.9, 0.28), { color: sparDark, surf: SURF.wood });
    sparTube(bsTip.clone().add(V3(0, -0.1, 0)), head, rS, rS * 0.5, mastC, 6);
    gb.add(G.disc, trs(top.x, top.y, top.z, 0, 0, 0, 0.55, 0.09, 0.55), { color: spar, surf: SURF.wood, lod: 0 });
    gb.add(G.sph, trs(head.x, head.y + 0.08, head.z, 0, 0, 0, rS * 0.7, rS * 0.6, rS * 0.7), { color: C('#c9a24a'), surf: SURF.gold });
    for (const sx of [-1, 1]) for (const k of [-1, 1]) gb.line(top.clone().add(V3(sx * 0.5, 0, k * 0.2)), bsTip.clone().addScaledVector(bsDir, -1.2 + k * 0.35).add(V3(sx * rB * 0.7, 0, 0)), 0.022, tarRope, SURF.rope, 3);
    gb.line(head, bsTip.clone().addScaledVector(bsDir, -bsLen * 0.3), 0.03, tarRope, SURF.rope, 3);
    const wS = Math.min(B * 0.6, 6), yc = top.clone().add(V3(0, hS * 0.42, -rS * 1.2));
    sparTube(yc.clone().add(V3(-wS / 2, 0, 0)), yc.clone().add(V3(wS / 2, 0, 0)), 0.06, 0.06, spar, 5);
    for (const sx of [-1, 1]) gb.line(yc.clone().add(V3(sx * wS * 0.48, 0, 0)), head, 0.018, hemp, SURF.run, 3);
    info.jackHoist = head.clone().add(V3(0, 0.15, 0));
  } else gb.line(jackBase, info.jackHoist, 0.05, sparDark, SURF.wood, 4);
  if (info.headTip) {
    // gammoning: the lashings that hold the bowsprit down on the knee of the head
    // (kept abaft the tip of the knee; on a low head the lashing is only the turns round the spar)
    const tMax = Math.min(0.3, (bsStart.z - info.headTip.z - 0.5) / (Math.cos(bs.angle) * bsLen));
    for (const t of [tMax * 0.78, tMax]) {
      const a = bsStart.clone().addScaledVector(bsDir, bsLen * t), b = V3(0, Math.min(a.y - 0.8, info.headTip.y - 0.7), a.z + 0.15);
      if (a.y - b.y < 2.2) for (const sx of [-1, 1]) gb.line(a.clone().add(V3(sx * rB * 0.9, 0, 0)), b.clone().add(V3(sx * 0.17, 0, 0)), 0.07, tarRope, SURF.rope, 4);
      gb.add(G.cylC, basisMatrix(a, V3(1, 0, 0), bsDir, V3().crossVectors(V3(1, 0, 0), bsDir), rB * 1.02, 0.28, rB * 1.02), { color: tarRope, surf: SURF.rope, lod: 1 });
    }
  }

  // ---------- masts
  for (let i = 0; i < nM; i++) {
    const m = d.masts[i];
    const sM = m.s, y0 = H.deckLevel(sM);
    const z0deck = H.z(sM, y0);
    const Hm = m.h * L;
    const tanR = Math.tan(m.rake);
    const at = (y) => V3(0, y, z0deck + (y - y0) * tanR);
    const r = m.r * (0.8 + B * 0.035);
    const brkUp = i === fallIdx ? 10.8 : 10.97;       // topmast loss at high sail damage
    const brkTg = 10.9;
    pivots[2 * i].set(z0deck - y0 * tanR, tanR, 0, 0);
    pivots[2 * i + 1].set(z0deck - y0 * tanR, tanR, 0, 0);
    const M = { i, s: sM, y0, at, Hm, r, tanR, yards: [] };
    masts.push(M);
    // lower mast (from below deck)
    if (m.rig === 'square') {
      const tiers = m.tiers;
      const yLT = y0 + 0.42 * Hm;
      const yTT = y0 + (tiers === 2 ? 0.8 : 0.72) * Hm;
      const yTop = y0 + Hm;
      sparTube(at(y0 - 1), at(yLT), r, r * 0.82, mastC, 8);
      // wooldings (rope bands) on lower mast
      for (let k = 1; k < 6; k++) { const p = at(y0 + (yLT - y0) * k / 6.5); gb.add(G.cylC, trs(p.x, p.y, p.z, m.rake, 0, 0, r * 1.06, 0.18, r * 1.06), { color: black, surf: SURF.rope }); }
      // top (platform)
      const tp = at(yLT - 0.9);
      const tw = Math.max(1.6, B * 0.38), tl = tw * 0.75;
      // round top on trestle trees and crosstrees, with a raised rim
      gb.add(G.disc, trs(tp.x, tp.y, tp.z + tl * 0.1, m.rake, 0, 0, tw * 0.52, 0.12, tl * 0.66), { color: spar, surf: SURF.wood, worldUV: 'auto', ao: (p, n) => n.y < 0 ? 0.55 : 1, lod: 0 });
      gb.add(G.tor, trs(tp.x, tp.y + 0.08, tp.z + tl * 0.1, Math.PI / 2 + m.rake, 0, 0, tw * 0.5, tl * 0.64, 1.3), { color: sparDark, surf: SURF.wood, lod: 1 });
      for (const sx of [-1, 1]) gb.add(G.box, trs(sx * r * 1.15, tp.y - 0.16, tp.z + tl * 0.1, m.rake, 0, 0, 0.14, 0.22, tl * 1.2), { color: sparDark, surf: SURF.wood, lod: 1 });
      for (const k of [-1, 1]) gb.add(G.box, trs(0, tp.y - 0.1, tp.z + tl * 0.1 + k * tl * 0.3, m.rake, 0, 0, tw * 0.94, 0.12, 0.14), { color: sparDark, surf: SURF.wood, lod: 1 });
      M.rim = (a) => V3(Math.sin(a) * tw * 0.5, tp.y + 0.1, tp.z + tl * 0.1 - Math.cos(a) * tl * 0.64);
      // top rail (galleon style round top wall for galleon, light rail otherwise)
      if (d.head === 'beak') gb.add(G.cyl, trs(tp.x, tp.y + 0.45, tp.z, m.rake, 0, 0, tw * 0.5, 0.8, tl * 0.6), { color: C('#5a2a1a'), surf: SURF.paint });
      else {
        const n = 7; for (let k = 0; k <= n; k++) { const x = -tw / 2 + tw * k / n; gb.line(V3(x, tp.y, tp.z - tl * 0.4 + tl * 0.1), V3(x, tp.y + 0.7, tp.z - tl * 0.4 + tl * 0.1), 0.03, sparDark, SURF.wood, 3, 1, brkUp); }
        gb.line(V3(-tw / 2, tp.y + 0.7, tp.z - tl * 0.3), V3(tw / 2, tp.y + 0.7, tp.z - tl * 0.3), 0.04, sparDark, SURF.wood, 3);
      }
      tops.push(tp.clone().add(V3(0, 1.2, 0)));
      // cap
      const cp = at(yLT); gb.add(G.box, trs(cp.x, cp.y, cp.z - r * 0.9, m.rake, 0, 0, r * 2.4, 0.3, r * 4.2), { color: black, surf: SURF.wood });
      // topmast
      sparTube(at(yLT - 2.2).add(V3(0, 0, -r * 1.7)), at(yTT).add(V3(0, 0, -r * 1.7)), r * 0.65, r * 0.52, mastC, 8, brkUp);
      const ofsT = -r * 1.7;
      const ct = at(yTT - 0.6).add(V3(0, 0, ofsT));
      gb.add(G.box, trs(ct.x, ct.y, ct.z, m.rake, 0, 0, tw * 0.55, 0.1, 0.5), { color: spar, surf: SURF.wood, brk: brkUp });
      gb.add(G.box, trs(ct.x, ct.y, ct.z, m.rake, 0, 0, 0.18, 0.1, tl * 0.55), { color: spar, surf: SURF.wood, brk: brkUp });
      const ofsG = ofsT - r * 1.1;
      const yMastTop = tiers === 3 ? yTop : yTop - 0.06 * Hm;
      sparTube(at(yTT - 1.6).add(V3(0, 0, ofsG)), at(yMastTop).add(V3(0, 0, ofsG)), r * 0.42, r * 0.25, mastC, 6, i === fallIdx ? brkUp : brkTg);
      gb.add(G.sph, trs(...at(yMastTop + 0.12).add(V3(0, 0, ofsG)).toArray(), 0, 0, 0, r * 0.45, r * 0.4, r * 0.45), { color: C('#c9a24a'), surf: SURF.gold, brk: brkTg });
      pennants.push(at(yMastTop).add(V3(0, 0.05, ofsG)));
      M.headT = at(yTT).add(V3(0, 0, ofsT)); M.headL = at(yLT); M.headG = at(yMastTop).add(V3(0, 0, ofsG));
      M.topP = tp; M.tw = tw; M.tl = tl;
      // yards
      const Wc = Math.min(m.yard * B * 2.0, L * 0.6);
      const footY = H.deckLevel(sM) + H.bulH + 1.4;
      const yCy = yLT - 1.7, yTy = yTT - 1.1, yGy = yMastTop - (tiers === 3 ? 0.9 : 0.6);
      const yardDefs = [
        { y: yCy, w: Wc, sail: !m.spanker, foot: footY, footW: Wc * 0.96, group: 0, ofs: -r * 1.05, brk: 2 },
        { y: yTy, w: Wc * 0.76, sail: true, foot: yCy + 0.35, footW: Wc * 0.95, group: 1, ofs: ofsT - r * 0.75, brk: brkUp },
      ];
      if (tiers === 3) yardDefs.push({ y: yGy, w: Wc * 0.52, sail: true, foot: yTy + 0.3, footW: Wc * 0.73, group: 0, ofs: ofsG - r * 0.5, brk: i === fallIdx ? brkUp : brkTg });
      for (const yd of yardDefs) {
        const c = at(yd.y).add(V3(0, 0, yd.ofs));
        gb.curPiv = [2 * i, 1];
        const rr = Math.max(0.09, yd.w * 0.012);
        sparTube(c.clone().add(V3(-yd.w / 2, 0, 0)), c.clone(), rr * 0.55, rr, spar, 6, yd.brk);
        sparTube(c.clone(), c.clone().add(V3(yd.w / 2, 0, 0)), rr, rr * 0.55, spar, 6, yd.brk);
        // footropes (sag below the yard)
        for (const sx of [-1, 1]) {
          const pts = []; for (let k = 0; k <= 4; k++) { const t = k / 4; pts.push(c.clone().add(V3(sx * yd.w * 0.48 * t, -0.65 - Math.sin(t * Math.PI) * 0.15, 0.25))); }
          for (let k = 0; k < 4; k++) gb.line(pts[k], pts[k + 1], 0.025, tarRope, SURF.run, 3, 1, yd.brk);
        }
        // blocks at the yardarms and the quarters (they swing with the yard)
        for (const sx of [-1, 1]) for (const t of [0.485, 0.12]) gb.add(G.box, trs(c.x + sx * yd.w * t, c.y - rr - 0.1, c.z, 0, 0, 0, 0.1, 0.2, 0.13), { color: sparDark, surf: SURF.wood, brk: yd.brk, lod: 1 });
        gb.curPiv = [-1, 0];
        // lifts: yardarm -> mast head above
        const liftTo = yd.group === 0 && yd.y < yLT ? M.headL : yd.y < yTT ? M.headT : M.headG;
        {
          // parrel (beads round the mast) and the tye the yard hangs from
          const mr = yd.group === 0 && yd.y < yLT ? r * 0.9 : yd.y < yTT ? r * 0.6 : r * 0.36;
          gb.add(G.tor, trs(c.x, c.y, c.z + rr + mr * 0.9, Math.PI / 2 + m.rake, 0, 0, mr * 1.5, mr * 1.5, 2.4), { color: black, surf: SURF.rope, brk: yd.brk, lod: 1 });
          gb.line(c.clone().add(V3(0, rr, 0)), liftTo.clone().add(V3(0, -0.25, -0.1)), 0.035, hemp, SURF.run, 3, 1, yd.brk);
        }
        for (const sx of [-1, 1]) {
          const arm = c.clone().add(V3(sx * yd.w * 0.48, 0, 0));
          gb.curPiv = [2 * i, 1];
          gb.line(arm, liftTo, 0.03, hemp, SURF.run, 3, 1, yd.brk, [-1, 0]);
          gb.curPiv = [-1, 0];
        }
        M.yards.push({ c, w: yd.w, arm: yd.w * 0.48, brk: yd.brk });
        if (yd.sail) {
          const sc = sail();
          const top = c.clone().add(V3(0, -0.15, 0.12));
          const bot = at(yd.foot).add(V3(0, 0, yd.ofs + (yd.group === 0 && yd.foot < yLT ? 0 : 0.0)));
          const hw0 = yd.w * 0.47, hw1 = yd.footW * 0.5;
          const P = (u, v) => {
            const x = (-1 + 2 * u) * (hw0 + (hw1 - hw0) * v);
            const yy = top.y + (bot.y - top.y) * v + (yd.group === 0 && yd.foot === footY ? -Math.cos((u - 0.5) * Math.PI) * 0.0 : 0);
            // foot roach (concave curve)
            const roach = v > 0.99 ? Math.sin(u * Math.PI) * 0.35 : 0;
            return V3(x, yy + roach * v, top.z + (bot.z - top.z) * v);
          };
          const anc = (u) => c.clone().add(V3((-1 + 2 * u) * hw0 * 0.97, 0.05, 0));
          const depth = (yd.w * 0.12 + 0.6);
          const emb = i === (nM >= 3 ? 1 : 0) && yd === yardDefs[0] && !m.spanker ? 0.25 : 0;
          sb.grid(10, 8, P, anc, V3(0, 0, -1), depth, yd.group, emb, sc, 2 * i, yd.brk, [rnd() * 7, rnd() * 7]);
        }
      }
      // braces: from yardarms aft to the next mast (or the rail)
      for (const y of M.yards) for (const sx of [-1, 1]) {
        const arm = y.c.clone().add(V3(sx * y.arm, 0, 0));
        let to;
        if (i < nM - 1 && d.masts[i + 1].rig !== 'lateen') { const nm = d.masts[i + 1]; const ny = H.deckLevel(nm.s); to = V3(0, ny + nm.h * L * (y.c.y > y0 + 0.5 * Hm ? 0.55 : 0.35), H.z(nm.s, ny)); }
        else { const s2 = Math.min(0.97, sM + 0.22); const yy = H.yTop(s2); to = V3(sx * H.hw(s2, yy) * 0.95, yy, H.z(s2, yy)); }
        gb.curPiv = [2 * i, 1];
        gb.line(arm, to, 0.028, hemp, SURF.run, 3, 1, y.brk, [-1, 0]);
        gb.curPiv = [-1, 0];
      }
      // spanker (gaff + boom) on the aftermost square mast
      if (m.spanker) gaffRig(M, y0 + Hm * 0.36, false, 2);
      // shrouds
      shrouds(M, yLT - 1.0, tw, tl);
    } else {
      // pole mast (gaff / sloop / lateen)
      const yTop = y0 + Hm;
      const yDbl = y0 + 0.66 * Hm;
      sparTube(at(y0 - 1), at(yDbl + 1.5), r, r * 0.75, mastC, 8);
      sparTube(at(yDbl - 0.5).add(V3(0, 0, -r * 1.4)), at(yTop).add(V3(0, 0, -r * 1.4)), r * 0.5, r * 0.3, mastC, 6, i === fallIdx ? 10.8 : 10.9);
      gb.add(G.box, trs(...at(yDbl + 1.5).add(V3(0, 0, -r * 0.7)).toArray(), m.rake, 0, 0, r * 2.2, 0.25, r * 3.6), { color: black, surf: SURF.wood });
      const ofs = -r * 1.4;
      M.headL = at(yDbl + 1.4); M.headT = at(yTop).add(V3(0, 0, ofs)); M.headG = M.headT;
      pennants.push(at(yTop).add(V3(0, 0.05, ofs)));
      gb.add(G.sph, trs(...at(yTop + 0.1).add(V3(0, 0, ofs)).toArray(), 0, 0, 0, r * 0.4, r * 0.35, r * 0.4), { color: C('#c9a24a'), surf: SURF.gold });
      // crow's nest (barrel lookout) at the doubling
      if (m.rig !== 'lateen') {
        const cn = at(yDbl + 0.2);
        gb.add(G.cyl, trs(cn.x, cn.y + 0.55, cn.z + 0.05, m.rake, 0, 0, 0.6, 1.1, 0.6), { color: C('#6b4423'), surf: SURF.wood, worldUV: 'auto' });
        gb.add(G.box, trs(cn.x, cn.y, cn.z + 0.05, m.rake, 0, 0, 1.25, 0.08, 1.25), { color: sparDark, surf: SURF.wood });
        for (const hy of [0.15, 1.0]) gb.add(G.tor, trs(cn.x, cn.y + hy, cn.z + 0.05, Math.PI / 2 + m.rake, 0, 0, 0.61, 0.61, 1.2), { color: iron, surf: SURF.iron });
        tops.push(cn.clone().add(V3(0, 1.3, 0)));
      } else tops.push(at(y0 + Hm * 0.7));
      M.topP = at(yDbl); M.tw = 1.2; M.tl = 1.0;
      if (m.rig === 'lateen') lateenRig(M);
      else {
        // fore-and-aft: gaff main + optional square topsail / gaff topsail
        const isSloop = m.rig === 'sloop';
        gaffRig(M, y0 + Hm * (isSloop ? 0.62 : 0.6), isSloop || i === nM - 1, 2);
        const topsail = isSloop ? 'square' : m.topsail;
        if (topsail === 'square') {
          const w = B * (isSloop ? 1.7 : 1.5);
          const yy = yTop - 0.9, c = at(yy).add(V3(0, 0, ofs - r * 0.6));
          const yc = yDbl - 0.4; const cc = at(yc).add(V3(0, 0, -r * 1.0));
          for (const [cy, ww, brk] of [[c, w, 10.9], [cc, w * 1.35, 2]]) {
            gb.curPiv = [2 * i, 1];
            const rr = 0.09 + ww * 0.008;
            sparTube(cy.clone().add(V3(-ww / 2, 0, 0)), cy.clone(), rr * 0.6, rr, spar, 6, brk);
            sparTube(cy.clone(), cy.clone().add(V3(ww / 2, 0, 0)), rr, rr * 0.6, spar, 6, brk);
            for (const sx of [-1, 1]) gb.line(cy.clone().add(V3(sx * ww * 0.48, 0, 0)), M.headT, 0.025, hemp, SURF.run, 3, 1, brk, [-1, 0]);
            gb.curPiv = [-1, 0];
          }
          const P = (u, v) => V3((-1 + 2 * u) * (w * 0.46 + (w * 1.35 * 0.46 - w * 0.46) * v), c.y - 0.15 + (cc.y + 0.3 - c.y + 0.15) * v, c.z + 0.1 + (cc.z - c.z) * v);
          sb.grid(8, 6, P, (u) => c.clone().add(V3((-1 + 2 * u) * w * 0.44, 0.05, 0)), V3(0, 0, -1), w * 0.12 + 0.4, 1, 0, sail(), 2 * i, i === fallIdx ? 10.8 : 10.9, [rnd() * 7, rnd() * 7]);
          M.yards.push({ c, w, arm: w * 0.48, brk: 10.9 }, { c: cc, w: w * 1.35, arm: w * 0.64, brk: 2 });
          for (const y of M.yards) for (const sx of [-1, 1]) {
            const s2 = Math.min(0.95, sM + 0.25), yy2 = H.yTop(s2);
            gb.curPiv = [2 * i, 1];
            gb.line(y.c.clone().add(V3(sx * y.arm, 0, 0)), V3(sx * H.hw(s2, yy2) * 0.9, yy2, H.z(s2, yy2)), 0.025, hemp, SURF.run, 3, 1, y.brk, [-1, 0]);
            gb.curPiv = [-1, 0];
          }
        } else if (topsail === 'gaff' && M.gaffPeak) {
          const thr = M.gaffThroat, pk = M.gaffPeak, hd = M.headT.clone().add(V3(0, -0.4, 0));
          const P = (u, v) => { const luff = hd.clone().lerp(thr, v); return luff.lerp(pk, u * v); };
          sb.grid(6, 6, P, (u, v) => hd.clone().lerp(thr, v), V3(1, 0, 0), 0.35, 2, 1, sail(), 2 * i + 1, 10.9, [rnd() * 7, rnd() * 7]);
        }
      }
      shrouds(M, yDbl + 1.0, 0.0, 0.0);
    }
  }

  // ---------- stays between masts and to the bowsprit; headsails
  const fm = masts[0];
  const fmIsPole = d.masts[0].rig !== 'square';
  const stayLow = fmIsPole ? fm.at(fm.y0 + fm.Hm * 0.62) : fm.headL.clone().add(V3(0, -0.6, 0));
  gb.line(stayLow, bsStart.clone().addScaledVector(bsDir, bsLen * 0.8), 0.07, tarRope, SURF.rope, 4);
  gb.line(fm.headT, (hasJibboom ? jbTip : bsTip).clone(), 0.05, tarRope, SURF.rope, 3);
  if (fm.headG !== fm.headT) gb.line(fm.headG, jbTip.clone().add(V3(0, 0.3, 0)), 0.035, tarRope, SURF.rope, 3, 1, 10.9);
  for (let i = 1; i < nM; i++) {
    const a = masts[i], b = masts[i - 1];
    gb.line(a.headL.clone().add(V3(0, -0.5, 0)), b.at(b.y0 + 1.2), 0.07, tarRope, SURF.rope, 4);
    gb.line(a.headT, b.headL.clone().add(V3(0, 0.3, 0)), 0.045, tarRope, SURF.rope, 3, 1, 10.95);
    if (a.headG !== a.headT && b.headG !== b.headT) gb.line(a.headG, b.headT, 0.03, tarRope, SURF.rope, 3, 1, 10.9);
  }
  {
    // crowsfeet: fans of thin lines from the fore rim of each top to a euphroe block on the stay below it
    masts.forEach((a, i) => {
      if (!a.rim) return;
      const from = a.headL.clone().add(V3(0, -0.5, 0)), to = i === 0 ? bsStart.clone().addScaledVector(bsDir, bsLen * 0.8) : masts[i - 1].at(masts[i - 1].y0 + 1.2);
      const eu = from.clone().lerp(to, 0.2);
      gb.add(G.box, trs(eu.x, eu.y, eu.z, 0.7, 0, 0, 0.07, 0.07, 0.5), { color: sparDark, surf: SURF.wood, lod: 1 });
      for (let k = 0; k < 7; k++) gb.line(a.rim(-1.05 + 2.1 * k / 6), eu.clone().add(V3(0, 0.04, (k - 3) * 0.06)), 0.012, hemp, SURF.ratline, 3);
      // mouse on the stay and the hearts that set it up
      const mo = from.clone().lerp(to, 0.06), he = from.clone().lerp(to, 0.93);
      gb.add(G.sph, trs(mo.x, mo.y, mo.z, 0, 0, 0, 0.13, 0.16, 0.13), { color: tarRope, surf: SURF.rope, lod: 1 });
      gb.add(G.sph, trs(he.x, he.y, he.z, 0, 0, 0, 0.1, 0.17, 0.17), { color: black, surf: SURF.wood, lod: 1 });
    });
  }
  // headsails (jibs / fore staysail) on the stays
  const nHS = d.headsails;
  const jibClewBase = fm.at(fm.y0 + 1.6);
  pivots[6].set(bsStart.z + bsLen * 0.4 * -Math.cos(bs.angle) * -1 * 0, 0, 0, 0);
  for (let k = 0; k < nHS; k++) {
    const tackT = k === 0 ? 0.92 : 1.0;
    const tack = (k === 0 ? bsStart.clone().addScaledVector(bsDir, bsLen * tackT) : jbTip.clone()).add(V3(0, 0.4, 0));
    const headPt = k === 0 ? stayLow.clone() : fm.headT.clone();
    const head = tack.clone().lerp(headPt, k === 0 ? 0.85 : 0.82);
    const clew = tack.clone().lerp(jibClewBase, k === 0 ? 0.8 : 0.62); clew.y = tack.y + (k === 0 ? 1.2 : 2.2);
    const P = (u, v) => { const luff = head.clone().lerp(tack, v); return luff.lerp(clew, u * v); };
    pivots[6].set(tack.z, 0, 0, 0);
    sb.grid(6, 8, P, (u, v) => head.clone().lerp(tack, v), V3(1, 0, 0), 0.25 + 0.05 * L * 0.1, 2, 1, sail(), 6, 2, [rnd() * 7, rnd() * 7], (u, v) => u * v);
  }
  // spritsail under the bowsprit
  if (d.spritsail) {
    const c = bsStart.clone().addScaledVector(bsDir, bsLen * 0.7).add(V3(0, -0.4, 0));
    const w = Math.min(B * 1.5, L * 0.3);
    sparTube(c.clone().add(V3(-w / 2, 0, 0)), c.clone().add(V3(w / 2, 0, 0)), 0.1, 0.1, spar, 6);
    const drop = w * 0.42;
    const P = (u, v) => V3((-1 + 2 * u) * w * 0.47 * (1 + 0.05 * v), c.y - 0.12 - drop * v, c.z + 0.1 + v * 0.6);
    sb.grid(8, 5, P, (u) => c.clone().add(V3((-1 + 2 * u) * w * 0.45, 0.05, 0)), V3(0, 0, -1), w * 0.12 + 0.3, 0, 0, sail(), -1, 2, [rnd() * 7, rnd() * 7]);
    for (const sx of [-1, 1]) gb.line(c.clone().add(V3(sx * w * 0.48, 0, 0)), bsTip.clone(), 0.025, hemp, SURF.run, 3);
  }

  // ---------------------------------------------------------------- helpers
  function sparTube(a, b, r0, r1, col, sides = 8, brk = 2) {
    const dir = b.clone().sub(a); const len = dir.length(); dir.normalize();
    const x = Math.abs(dir.y) > 0.9 ? V3(1, 0, 0) : V3(0, 1, 0);
    const zz = V3().crossVectors(x, dir).normalize(); const xx = V3().crossVectors(dir, zz).normalize();
    const g = new THREE.CylinderGeometry(r1, r0, 1, sides, 1, false);
    gb.add(g, basisMatrix(a.clone().lerp(b, 0.5), xx, dir, zz, 1, len, 1), { color: col, surf: SURF.wood, brk, uvScale: [1, len / 5], uvOffset: [rnd() * 4, rnd() * 4] });
    g.dispose();
  }
  function shrouds(M, yHead, tw) {
    const sCh = info.channels.filter(c => Math.abs(c.s - M.s) < 1e-6);
    const n = Math.max(3, Math.min(7, Math.round(B * 0.42 + (d.masts[M.i].h > 0.9 ? 1 : 0))));
    for (const ch of sCh) {
      const side = ch.side;
      const head = M.at(yHead);
      const bot = [], topP = [];
      for (let k = 0; k < n; k++) {
        const t = n === 1 ? 0.5 : k / (n - 1);
        const p = ch.mid.clone().addScaledVector(ch.dir, (t - 0.55) * ch.len * 0.9);
        {
          // pair of deadeyes laced by a three-part lanyard; chain plate from the channel down to the wale
          const X = V3(side, 0, 0), dz = V3().crossVectors(V3(0, 1, 0), X);
          for (const dy of [0.14, 0.62]) gb.add(G.cyl6, basisMatrix(p.clone().add(V3(0, dy, 0)), V3(0, 1, 0), X, dz, 0.11, 0.07, 0.11), { color: C('#2a1c12'), surf: SURF.wood, lod: 1 });
          for (const k of [-1, 0, 1]) gb.line(p.clone().add(V3(0, 0.2, k * 0.05)), p.clone().add(V3(0, 0.56, k * 0.05)), 0.012, hemp, SURF.ratline, 3);
          const sh = H.sAtZ(p.z, ch.y - 0.95), q = H.point(sh, ch.y - 0.95, side); q.z += (p.z - head.z) * 0.06;
          gb.line(p.clone().add(V3(0, 0.05, 0)), q, 0.024, iron, SURF.iron, 3);
          bot.push(p.clone().add(V3(0, 0.72, 0)));
        }
        topP.push(head.clone().add(V3(side * (tw ? Math.min(0.5, tw * 0.12) : 0.15), 0, (t - 0.5) * 0.6)));
      }
      for (let k = 0; k < n; k++) gb.line(bot[k], topP[k], 0.045, tarRope, SURF.rope, 3);
      // ratlines
      const h = topP[0].y - bot[0].y;
      const nr = Math.floor(h / 0.42);
      for (let j = 1; j < nr; j++) {
        const t = j / nr;
        for (let k = 0; k < n - 1; k++) {
          const a = bot[k].clone().lerp(topP[k], t), b = bot[k + 1].clone().lerp(topP[k + 1], t);
          gb.line(a, b, 0.016, tarRope, SURF.ratline, 3, 1, 0.55 + 0.45 * ((j * 7 + k * 3) % 11) / 11);
        }
      }
      // topmast shrouds from the top's edge to the topmast head, + backstays to the channel
      if (M.headT && M.headT !== M.headL) {
        const edge = M.topP.clone().add(V3(side * (tw ? tw * 0.48 : 0.5), 0.05, 0));
        const tH = M.headT.clone().add(V3(0, -0.6, 0));
        const ups = [];
        for (let k = 0; k < 3; k++) {
          const e = edge.clone().add(V3(0, 0, (k - 1) * 0.35));
          gb.line(e, tH.clone().add(V3(side * 0.12, 0, (k - 1) * 0.15)), 0.03, tarRope, SURF.rope, 3, 1, 10.95);
          ups.push([e, tH.clone().add(V3(side * 0.12, 0, (k - 1) * 0.15))]);
          // futtock shrouds
          gb.line(e, M.at(yHead - 2.2).add(V3(side * 0.3, 0, 0)), 0.025, tarRope, SURF.rope, 3);
        }
        const nr2 = Math.floor((tH.y - edge.y) / 0.45);
        for (let j = 1; j < nr2; j++) for (let k = 0; k < 2; k++) {
          const t = j / nr2;
          gb.line(ups[k][0].clone().lerp(ups[k][1], t), ups[k + 1][0].clone().lerp(ups[k + 1][1], t), 0.013, tarRope, SURF.ratline, 3, 1, 10.95);
        }
        const bstay = ch.mid.clone().addScaledVector(ch.dir, ch.len * 0.48).add(V3(0, 0.5, 0));
        gb.line(M.headT, bstay, 0.04, tarRope, SURF.rope, 3, 1, 10.95);
        gb.line(M.headT.clone().add(V3(0, -0.3, 0)), bstay.clone().addScaledVector(ch.dir, -0.45), 0.035, tarRope, SURF.rope, 3, 1, 10.95);
        if (M.headG !== M.headT) gb.line(M.headG, bstay.clone().addScaledVector(ch.dir, 0.3), 0.03, tarRope, SURF.rope, 3, 1, 10.9);
      }
    }
  }
  function gaffRig(M, yThroat, boomOver, group) {
    const i = M.i;
    const yBoom = H.deckLevel(M.s) + H.bulH + 1.1;
    // boom length: to next mast or over the stern
    let len;
    if (i < nM - 1) { const nm = d.masts[i + 1]; len = (H.z(nm.s, 0) - H.z(M.s, 0)) * 0.9; }
    else len = (H.z(1, H.yTop(1)) - H.z(M.s, 0)) * (boomOver ? 1.08 : 0.95);
    const throat = M.at(yThroat).add(V3(0, 0, 0.3)), tack = M.at(yBoom).add(V3(0, 0, 0.3));
    const gLen = len * 0.68, gAng = 0.62;
    const peak = throat.clone().add(V3(0, Math.sin(gAng) * gLen, Math.cos(gAng) * gLen));
    const clew = tack.clone().add(V3(0, 0.15, len));
    gb.curPiv = [2 * i + 1, 1];
    sparTube(tack, clew, 0.14 + len * 0.004, 0.11, C('#6a4526'), 6);
    sparTube(throat, peak, 0.12, 0.08, C('#6a4526'), 6);
    // jaws
    gb.add(G.sph, trs(tack.x, tack.y, tack.z, 0, 0, 0, 0.22, 0.2, 0.22), { color: black, surf: SURF.wood });
    gb.add(G.sph, trs(throat.x, throat.y, throat.z, 0, 0, 0, 0.2, 0.18, 0.2), { color: black, surf: SURF.wood });
    // peak halyards & topping lift
    gb.line(peak, M.headL, 0.03, hemp, SURF.run, 3, 1, 2, [-1, 0]);
    gb.line(peak.clone().lerp(throat, 0.5), M.headL, 0.03, hemp, SURF.run, 3, 1, 2, [-1, 0]);
    gb.line(clew, M.headL.clone().add(V3(0, 0.5, 0)), 0.025, hemp, SURF.run, 3, 1, 2, [-1, 0]);
    // main sheet to the taffrail (deck end not rotating)
    const sheetTo = V3(0, H.yTop(Math.min(0.99, M.s + 0.4)), Math.min(H.z(0.995, H.yTop(0.995)), clew.z - 0.5));
    gb.line(clew.clone().add(V3(0, -0.1, -0.4)), sheetTo, 0.03, hemp, SURF.run, 3, 1, 2, [-1, 0]);
    gb.curPiv = [-1, 0];
    const P = (u, v) => {
      const top = throat.clone().lerp(peak, u), bot = tack.clone().lerp(clew, u);
      const p = top.lerp(bot, v);
      return p;
    };
    sb.grid(9, 9, P, (u, v) => tack.clone().lerp(clew, u).add(V3(0, 0.25, 0)), V3(1, 0, 0), 0.06 * len + 0.3, group, (d.masts[i].rig === 'sloop' || (d.masts[i].rig === 'gaff' && i === nM - 1)) ? 1.25 : 1, sail(), 2 * i + 1, 2, [rnd() * 7, rnd() * 7]);
    M.gaffThroat = throat; M.gaffPeak = peak;
  }
  function lateenRig(M) {
    const i = M.i;
    const len = Math.min(L * 0.36, M.Hm * 1.15);
    const ang = 0.62; // yard elevation
    const c = M.at(M.y0 + M.Hm * 0.52).add(V3(0, 0, -0.35));
    const dir = V3(0, Math.sin(ang), Math.cos(ang));
    const a = c.clone().addScaledVector(dir, -len * 0.42), b = c.clone().addScaledVector(dir, len * 0.58);
    gb.curPiv = [2 * i + 1, 1];
    sparTube(a, c, 0.1, 0.16, C('#6a4526'), 6);
    sparTube(c, b, 0.16, 0.07, C('#6a4526'), 6);
    gb.line(b, M.headT.clone(), 0.025, hemp, SURF.run, 3, 1, 2, [-1, 0]);
    gb.curPiv = [-1, 0];
    const yD = H.deckLevel(M.s) + H.bulH + 0.9;
    const clew = V3(0, yD, Math.min(b.z - 0.5, H.z(0.99, yD) + 1.2));
    if (a.y < yD + 0.4) a.y = yD + 0.4;
    const P = (u, v) => { const yp = a.clone().lerp(b, u).add(V3(0, -0.15, 0.0)); return yp.lerp(clew, u * v); };
    sb.grid(9, 7, P, (u) => a.clone().lerp(b, u).add(V3(0, 0.1, 0)), V3(1, 0, 0), 0.05 * len + 0.3, 2, 1, sail(), 2 * i + 1, 2, [rnd() * 7, rnd() * 7]);
  }

  return { sailGeo: sb.build(), pivots, tops, pennants, masts, bsTip, jbTip, fallIdx };
}
