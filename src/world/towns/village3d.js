// A village = one merged near mesh + one far mesh (THREE.LOD, the towns' shared `townMaterial`, aMat ids from
// builder.js): plank huts with thatched roofs (some on stilts, a few awnings), a jetty on piles with its lantern,
// nets drying, fish racks, dugouts pulled up on the sand, smoking fires (HarbourLife smoke via v._chimneys), a
// lookout, palm trees.
//   buildVillage(towns, v) → { port: v, lod, near, far, tris }   (called by Towns after the ports)
// Local frame: a = distance inland from the beach (negative = seaward), b = lateral.
import * as THREE from 'three';
import { GeoBuilder, M } from './builder.js';
import { mulberry32 } from '../../core/rng.js';

const WALL = ['#8a6a48', '#9c7a52', '#7a5a3c', '#a88a62', '#6e5238', '#b39468'];
const ROOF = ['#b09660', '#a08a56', '#bca46c', '#93804e'];
const BOAT = ['#c8442e', '#2e6a8a', '#e8dcc0', '#3e7a4a', '#d8a040', '#6a8aa0', '#8e3a2a'];
const PLANK = ['#8c7a5e', '#7e6c52', '#96846a', '#6f5f48'];

export function buildVillage(towns, v) {
  const rand = mulberry32((v.seed || 1) * 104729 + 7);
  const pick = a => a[Math.floor(rand() * a.length)];
  const B = new GeoBuilder(true), F = new GeoBuilder(false);
  const s = v.seaward, l = v.lateral, q = v.quay;
  const W = (a, b) => [q.x - s.x * a + l.x * b, q.z - s.z * a + l.z * b];
  const g = (x, z) => towns.ground(x, z);
  const rotFace = Math.atan2(s.x, s.z);          // rotY that turns local +z seaward
  const off = (x, z, rot, lx, lz) => [x + lx * Math.cos(rot) + lz * Math.sin(rot), z - lx * Math.sin(rot) + lz * Math.cos(rot)];
  const placed = [];
  const free = (x, z, r) => placed.every(p => Math.hypot(p[0] - x, p[1] - z) > p[2] + r);
  const place = (x, z, r) => placed.push([x, z, r]);
  const chim = v._chimneys = [];

  // ---- jetty on piles, T head, lantern ----
  const pb = (rand() - 0.5) * 30;
  const pa = 4; let aEnd = -48;
  for (let a = 4; a > -48; a -= 4) { const [x, z] = W(a, pb); if (g(x, z) < -6.5) { aEnd = a; break; } }
  for (let a = pa; a > aEnd; a -= 4) {
    const [x, z] = W(a - 2, pb);
    B.ground = 0.4; B.aoH = 1;
    B.block(x, 1.12, z, 2.6, 0.18, 4.05, pick(PLANK), M.WOOD, rotFace + (rand() - 0.5) * 0.02);
    for (const sd of [-1, 1]) { const [px, pz] = W(a - 0.2, pb + sd * 1.15); B.cyl(px, -3, pz, 0.14, 0.12, 4.45, 5, '#4a3a28', M.WOOD); }
    place(x, z, 2);
  }
  const [tx, tz] = W(aEnd - 1.2, pb);
  B.block(tx, 1.12, tz, 7.5, 0.18, 2.6, pick(PLANK), M.WOOD, rotFace);
  for (const sd of [-3.4, 3.4]) { const [px, pz] = W(aEnd - 1.2, pb + sd); B.cyl(px, -3, pz, 0.15, 0.13, 4.9, 5, '#4a3a28', M.WOOD); }
  { const [lx2, lz2] = W(aEnd - 0.6, pb + 3.2); towns._lantern?.(B, lx2, 1.2, lz2, 2.3); }
  F.block(...(() => { const [x, z] = W((pa + aEnd) / 2, pb); return [x, 1.0, z]; })(), 2.6, 0.3, pa - aEnd, '#7e6c52', M.WOOD, rotFace);
  // boat moored along the jetty
  { let ba = aEnd + 6;   // always afloat (a short jetty used to put it on the sand)
    for (let a2 = aEnd + 6; a2 > aEnd - 10; a2 -= 1) { const [tx3, tz3] = W(a2, pb + 3.4); ba = a2; if (g(tx3, tz3) < -1.2) break; }
    const [x, z] = W(ba, pb + 3.4), r = rotFace + 0.05, hull = pick(BOAT);
    B.ground = -0.4; B.aoH = 0.8;   // hull lifted out of the water (the swell hid it, only the mast showed)
    B.block(x, -0.1, z, 1.6, 0.72, 5.2, hull, M.WOOD, r); B.block(x, 0.6, z, 1.72, 0.1, 5.3, '#d8c8a4', M.WOOD, r); B.block(x, 0.38, z, 1.2, 0.26, 4.4, '#3a2818', M.DARK, r);
    for (const e of [1, -1]) { const [bx, bz] = off(x, z, r, 0, e * 2.95); B.spire(bx, -0.05, bz, 0.78, 1.05, 4, hull, M.WOOD, r + Math.PI / 4); }
    B.cyl(x, 0.45, z, 0.07, 0.05, 4.4, 4, '#3a2a1a', M.WOOD);
    { const [sx3, sz3] = off(x, z, r, 0, -0.9); B.block(sx3, 1.2, sz3, 0.06, 2.8, 2.0, '#e8dcc0', M.CLOTH, r); } }   // sail furled against the mast

  // ---- dugouts pulled up on the sand: double-ended hull, some with an outrigger ----
  let boats = 0;
  for (let b = -58; b <= 58 && boats < 8; b += 5 + rand() * 6) {
    if (Math.abs(b - pb) < 6) continue;
    for (let a = 8; a > -6; a -= 1.5) {
      const [x, z] = W(a, b), y = g(x, z);
      if (y < 0.12 || y > 1.6 || !free(x, z, 2.8)) continue;
      const r = rotFace + (rand() - 0.5) * 1.1, hull = pick(BOAT), L = 5.4 + rand() * 1.4;
      B.ground = y; B.aoH = 0.8;
      B.block(x, y - 0.1, z, 1.05, 0.45, L - 0.6, '#3a2a1c', M.WOOD, r);
      B.block(x, y + 0.2, z, 1.35, 0.42, L - 0.9, hull, M.WOOD, r);
      B.block(x, y + 0.46, z, 1.42, 0.08, L - 0.8, '#d8c8a4', M.WOOD, r);   // light gunwale
      B.block(x, y + 0.42, z, 0.95, 0.12, L - 1.4, '#3a2818', M.DARK, r);
      for (const e of [1, -1]) { const [bx, bz] = off(x, z, r, 0, e * (L / 2 - 0.2)); B.spire(bx, y + 0.05, bz, 0.62, 0.85, 4, hull, M.WOOD, r + Math.PI / 4); }
      if (rand() < 0.4) {   // outrigger: float and two booms
        const [fx, fz] = off(x, z, r, 1.9, 0); B.block(fx, y + 0.02, fz, 0.28, 0.24, L * 0.62, '#6a5238', M.WOOD, r);
        for (const e of [-0.9, 0.9]) { const [cx, cz] = off(x, z, r, 0.95, e); B.block(cx, y + 0.5, cz, 1.9, 0.08, 0.1, '#4a3828', M.WOOD, r); }
      }
      if (rand() < 0.6) { const [ox, oz] = off(x, z, r, -1.2, 0.3); B.block(ox, y + 0.04, oz, 0.18, 0.06, 2.9, '#b09a72', M.WOOD, r + 0.3); }   // paddle
      place(x, z, 3.2); boats++;
      break;
    }
  }

  // ---- carbet: big palm-leaf roof on posts, at the foot of the jetty (where the fish is sorted) ----
  for (let k = 0; k < 24; k++) {
    const a = 9 + rand() * 6, b = pb + (rand() < 0.5 ? -1 : 1) * (11 + rand() * 6);
    const [x, z] = W(a, b), y = g(x, z);
    if (y < 0.4 || y > 4 || !free(x, z, 7)) continue;
    const w = 10.5, d = 5.6, rot = rotFace + Math.PI / 2 + (rand() - 0.5) * 0.15, ph = 2.7;
    B.ground = y; B.aoH = 2.6;
    for (const [px, pz] of [[-1, -1], [0, -1], [1, -1], [-1, 1], [0, 1], [1, 1]]) { const [cx, cz] = off(x, z, rot, px * (w / 2 - 0.3), pz * (d / 2 - 0.3)); B.cyl(cx, y - 0.2, cz, 0.13, 0.11, ph + 0.25, 5, '#4a3828', M.WOOD); }
    B.gable(x, y + ph, z, w, d, 2.6, pick(ROOF), M.THATCH, rot, 0.9);
    B.block(x, y + 0.82, z, 3.4, 0.12, 1.2, pick(PLANK), M.WOOD, rot);   // sorting table
    for (const e of [-1.2, 1.2]) { const [tx2, tz2] = off(x, z, rot, e, 0); B.block(tx2, y, tz2, 0.12, 0.8, 1.0, '#4a3828', M.WOOD, rot); }
    for (let i = 0; i < 6; i++) { const [cx, cz] = off(x, z, rot, -3.6 + i * 1.4 + rand() * 0.4, (rand() < 0.5 ? -1 : 1) * (1.6 + rand() * 0.5)); B.cyl(cx, y, cz, 0.32, 0.27, 0.5, 6, pick(['#a8875a', '#8e7048', '#b8986a']), M.WOOD); }   // baskets
    for (let i = 0; i < 9; i++) { const [cx, cz] = off(x, z, rot, -4 + i, 0); B.block(cx, y + ph - 0.55, cz, 0.1, 0.5, 0.14, pick(['#c2bca6', '#a8a492']), M.CLOTH, rot); }   // hanging fish
    F.block(x, y, z, w, ph, d, '#7e6c52', M.WOOD, rot); F.gable(x, y + ph, z, w, d, 2.6, pick(ROOF), M.THATCH, rot, 0.6);
    place(x, z, 7.5);
    break;
  }

  // ---- cases ----
  let huts = 0, lamps = 0;
  const target = 11 + Math.floor(rand() * 4);
  for (let k = 0; k < 320 && huts < target; k++) {
    const a = 12 + rand() * (k < 200 ? 36 : 54), b = (rand() - 0.5) * 2 * (k < 200 ? 48 : 60);   // first in an arc near the beach
    const [x, z] = W(a, b), y = g(x, z);
    if (y < 0.5 || y > 7 || !free(x, z, 7.2)) continue;
    const w = 5.4 + rand() * 3.0, d = 4.6 + rand() * 2.0, rot = rotFace + (rand() - 0.5) * 0.45 + (rand() < 0.2 ? Math.PI / 2 : 0);
    const stilts = y < 1.6 && rand() < 0.7, y0 = stilts ? y + 1.1 : y, wallH = 2.6 + rand() * 0.45;
    const wall = pick(WALL), roof = pick(ROOF);
    B.ground = y; B.aoH = 2.2;
    if (stilts) {
      B.block(x, y0 - 0.12, z, w + 0.6, 0.16, d + 0.6, pick(PLANK), M.WOOD, rot);
      for (const [px, pz] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 1], [0, -1]]) { const [cx, cz] = off(x, z, rot, px * (w / 2), pz * (d / 2)); B.cyl(cx, y - 0.6, cz, 0.12, 0.11, y0 - y + 0.5, 4, '#3e2e1e', M.WOOD); }
      const [sx2, sz2] = off(x, z, rot, 0, d / 2 + 0.9); B.block(sx2, y, sz2, 0.9, 0.12, 1.4, '#6e5a40', M.WOOD, rot + 0.0);   // step
    }
    B.block(x, y0, z, w, wallH, d, wall, M.WOOD, rot);
    // dark door and window on the sea side, one window on the side
    { const [dx, dz] = off(x, z, rot, (rand() - 0.5) * w * 0.4, d / 2 + 0.02); B.block(dx, y0, dz, 0.85, 1.75, 0.06, '#2a1c12', M.DARK, rot); }
    { const [wx, wz] = off(x, z, rot, w / 2 - 0.9, d / 2 + 0.02); B.block(wx, y0 + 1.15, wz, 0.75, 0.62, 0.06, '#24180e', M.WINDOW, rot); }   // lit at night
    { const [wx, wz] = off(x, z, rot, w / 2 + 0.02, 0); B.block(wx, y0 + 1.15, wz, 0.06, 0.58, 0.8, '#24180e', M.WINDOW, rot); }
    if (lamps < 3 && rand() < 0.45) { const [lx3, lz3] = off(x, z, rot, -w / 2 + 0.4, d / 2 + 0.7); towns._lantern?.(B, lx3, y0 - 0.05, lz3, 1.7); lamps++; B.ground = y; B.aoH = 2.2; }   // lantern at the door
    const pitch = d * (0.55 + rand() * 0.2);
    if (rand() < 0.55) B.gable(x, y0 + wallH, z, w, d, pitch, roof, M.THATCH, rot, 0.75, wall, M.WOOD);
    else B.hip(x, y0 + wallH, z, w, d, pitch, roof, M.THATCH, rot, 0.75);
    // awning on two posts
    if (rand() < 0.45) {
      for (const sd of [-1, 1]) { const [px, pz] = off(x, z, rot, sd * w * 0.42, d / 2 + 1.7); B.cyl(px, y, pz, 0.08, 0.07, y0 - y + wallH - 0.25, 4, '#4a3828', M.WOOD); }
      const [ax, az] = off(x, z, rot, 0, d / 2 + 0.95); B.block(ax, y0 + wallH - 0.32, az, w * 0.95, 0.16, 1.9, roof, M.THATCH, rot);
    }
    F.block(x, y0, z, w, wallH, d, wall, M.WOOD, rot); F.hip(x, y0 + wallH, z, w, d, pitch, roof, M.THATCH, rot, 0.5);
    place(x, z, Math.max(w, d) * 0.62 + 1.3);
    if (huts < 3 && rand() < 0.8) {   // smoking fire in front of the hut: stones, tripod, smoke
      const [fx, fz] = off(x, z, rot, -w * 0.6 - 1.2, d / 2 + 2.6), fy = g(fx, fz);
      if (fy > 0.3 && free(fx, fz, 1.2)) {
        for (let i = 0; i < 7; i++) { const t = i / 7 * Math.PI * 2; B.block(fx + Math.cos(t) * 0.55, fy - 0.05, fz + Math.sin(t) * 0.55, 0.32, 0.22, 0.28, '#7a7268', M.STONE, t); }
        B.block(fx, fy, fz, 0.6, 0.08, 0.6, '#2a1a10', M.DARK); B.block(fx, fy + 0.06, fz, 0.42, 0.1, 0.42, '#ff9a40', M.LAMP);   // embers
        for (let i = 0; i < 3; i++) { const t = i / 3 * Math.PI * 2; B.cyl(fx + Math.cos(t) * 0.5, fy - 0.1, fz + Math.sin(t) * 0.5, 0.04, 0.035, 1.9, 4, '#3a2a1a', M.WOOD, 0, 0, 0); }
        B.block(fx, fy + 1.15, fz, 0.9, 0.06, 0.5, '#8a6a4a', M.WOOD, rot);
        chim.push([fx, fy + 1.4, fz]); place(fx, fz, 1.4);
      }
    }
    huts++;
  }

  // ---- nets drying and fish racks, on the beach ----
  let nets = 0, racks = 0;
  for (let k = 0; k < 90 && (nets < 4 || racks < 3); k++) {
    const a = -1 + rand() * 14, b = (rand() - 0.5) * 2 * 58;
    const [x, z] = W(a, b), y = g(x, z);
    if (y < 0.35 || y > 3 || !free(x, z, 3.2)) continue;
    const r = rotFace + Math.PI / 2 + (rand() - 0.5) * 0.4;
    B.ground = y; B.aoH = 1.2;
    if (nets < 4 && (racks >= 3 || rand() < 0.55)) {
      for (const sd of [-1, 1]) { const [px, pz] = off(x, z, r, 0, sd * 2.9); B.cyl(px, y - 0.2, pz, 0.1, 0.08, 3.1, 4, '#3a2a1a', M.WOOD); }
      B.block(x, y + 2.75, z, 0.1, 0.1, 6.0, '#3a2a1a', M.WOOD, r);
      B.gable(x, y + 0.45, z, 0.5, 5.4, 2.25, pick(['#4e4a38', '#5a5440', '#3e4a48', '#6a4e36']), M.CLOTH, r + Math.PI / 2, 0);
      for (let i = 0; i < 7; i++) { const [cx, cz] = off(x, z, r, 0, -2.4 + i * 0.8); B.block(cx, y + 2.6, cz, 0.22, 0.22, 0.22, i % 2 ? '#c8a050' : '#e8dcc0', M.WOOD, r); }   // cork floats
      nets++;
    } else if (racks < 3) {
      for (const [px, pz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const [cx, cz] = off(x, z, r, px * 2.3, pz * 0.9); B.cyl(cx, y - 0.1, cz, 0.08, 0.07, 1.4, 4, '#3a2a1a', M.WOOD); }
      for (let i = -4; i <= 4; i++) { const [cx, cz] = off(x, z, r, i * 0.55, 0); B.block(cx, y + 1.22, cz, 0.1, 0.06, 2.0, '#8a6a4a', M.WOOD, r); }
      for (let i = 0; i < 14; i++) { const [cx, cz] = off(x, z, r, -2.1 + i * 0.32, (rand() - 0.5) * 1.1); B.block(cx, y + 1.29, cz, 0.16, 0.06, 0.55, pick(['#c2bca6', '#a8a492', '#b8986a']), M.CLOTH, r + (rand() - 0.5) * 0.4); }
      racks++;
    }
    place(x, z, 3);
  }

  // ---- the village's goods on the beach: what the barter sells can be seen (salt, hides, timber, cocoa) ----
  const goodsProp = (kind, x, z, y, r) => {
    B.ground = y; B.aoH = 1.2;
    if (kind === 'salt') {   // salt heap on a mat
      B.block(x, y - 0.02, z, 3.2, 0.06, 2.2, '#b49a6a', M.CLOTH, r);
      for (const [dx, dz, h] of [[-0.7, 0, 0.95], [0.6, 0.2, 0.75], [0.1, -0.5, 0.6]]) { const [cx, cz] = off(x, z, r, dx, dz); B.spire(cx, y + 0.02, cz, 0.75, h, 6, '#f1ede2', M.PLASTER, rand() * 3); }
    } else if (kind === 'hides') {   // frame with stretched hides
      for (const sd of [-1, 1]) { const [px, pz] = off(x, z, r, sd * 1.1, 0); B.cyl(px, y - 0.2, pz, 0.07, 0.06, 2.3, 4, '#3a2a1a', M.WOOD); }
      B.block(x, y + 2.0, z, 2.4, 0.08, 0.08, '#3a2a1a', M.WOOD, r);
      B.block(x, y + 0.55, z, 1.8, 1.35, 0.05, pick(['#8a5a34', '#9a6a3e', '#7a4e2c']), M.CLOTH, r);
    } else if (kind === 'timber') {   // pile of logs
      for (let i = 0; i < 6; i++) { const lvl = i < 3 ? 0 : i < 5 ? 1 : 2, k2 = lvl === 0 ? i : lvl === 1 ? i - 3 : 0; const [cx, cz] = off(x, z, r, (k2 - (lvl === 0 ? 1 : lvl === 1 ? 0.5 : 0)) * 0.5, 0); B.block(cx, y + lvl * 0.42, cz, 0.42, 0.42, 3.4, pick(['#7a5a3a', '#6a4c30', '#8a6844']), M.WOOD, r); }
    } else if (kind === 'cocoa') {   // sacks of cocoa
      for (let i = 0; i < 5; i++) { const [cx, cz] = off(x, z, r, (i % 3) * 0.6 - 0.6, Math.floor(i / 3) * 0.6); B.block(cx, y + (i > 2 ? 0.45 : 0), cz, 0.55, 0.45, 0.8, '#a08060', M.CLOTH, r + (rand() - 0.5) * 0.3); }
    } else {   // barrels and crates
      for (let i = 0; i < 4; i++) { const [cx, cz] = off(x, z, r, (i % 2) * 0.8 - 0.4, Math.floor(i / 2) * 0.8 - 0.4); B.cyl(cx, y, cz, 0.36, 0.33, 0.85, 7, '#6a4a2a', M.WOOD); }
      { const [cx, cz] = off(x, z, r, 1.3, 0); B.block(cx, y, cz, 0.9, 0.7, 0.9, '#8c7454', M.WOOD, r); }
    }
  };
  { const kinds = ['barrels', ...(v.sells || []).filter(k => k === 'salt' || k === 'hides' || k === 'timber' || k === 'cocoa')];
    for (const kind of kinds) {
      for (let k = 0; k < 40; k++) {
        const a = kind === 'barrels' ? 3 + rand() * 3 : 5 + rand() * 12, b = kind === 'barrels' ? pb + (rand() < 0.5 ? -1 : 1) * (3 + rand() * 3) : (rand() - 0.5) * 2 * 50;
        const [x, z] = W(a, b), y = g(x, z);
        if (y < 0.3 || y > 3 || !free(x, z, 2.6)) continue;
        goodsProp(kind, x, z, y, rotFace + Math.PI / 2 + (rand() - 0.5) * 0.6); place(x, z, 2.8);
        break;
      }
    }
  }

  // ---- lookout: a mast with rungs and its platform, facing the sea ----
  for (let k = 0; k < 30; k++) {
    const b = (rand() < 0.5 ? -1 : 1) * (36 + rand() * 18), a = 3 + rand() * 9;
    const [x, z] = W(a, b), y = g(x, z);
    if (y < 0.5 || y > 6 || !free(x, z, 3)) continue;
    B.ground = y; B.aoH = 3;
    for (const sd of [-1, 1]) { const [px, pz] = off(x, z, rotFace, sd * 0.45, 0); B.cyl(px, y - 0.3, pz, 0.12, 0.09, 9.6, 5, '#4a3a28', M.WOOD); }
    for (let h = 0.6; h < 8.6; h += 0.55) B.block(x, y + h, z, 0.95, 0.06, 0.08, '#6a5238', M.WOOD, rotFace);
    B.block(x, y + 8.7, z, 1.9, 0.14, 1.9, pick(PLANK), M.WOOD, rotFace);
    for (const [px, pz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const [cx, cz] = off(x, z, rotFace, px * 0.85, pz * 0.85); B.cyl(cx, y + 8.8, cz, 0.04, 0.04, 0.9, 4, '#3a2a1a', M.WOOD); }
    B.spire(x, y + 9.7, z, 1.35, 1.1, 4, pick(ROOF), M.THATCH, rotFace + Math.PI / 4);
    const [fx, fz] = off(x, z, rotFace, 0.9, 0); B.cyl(fx, y + 9.6, fz, 0.03, 0.03, 2.4, 3, '#2a1c10', M.WOOD);
    { const [px, pz] = off(fx, fz, rotFace, 0.45, 0); B.block(px, y + 11.25, pz, 0.9, 0.42, 0.04, '#b04a3a', M.CLOTH, rotFace); }   // faded cloth streamer
    F.block(x, y, z, 1.2, 10.5, 1.2, '#4a3a28', M.WOOD, rotFace);
    place(x, z, 3);
    break;
  }

  // ---- palm trees around the huts (instanced by the vegetation) ----
  {
    const palms = towns.plantPalms ||= [];
    let np = 0;
    for (let k = 0; k < 120 && np < 14; k++) {
      const a = 4 + rand() * 75, b = (rand() - 0.5) * 2 * 75;
      const [x, z] = W(a, b), y = g(x, z);
      if (y < 0.6 || y > 9 || !free(x, z, 3.5)) continue;
      if (rand() < 0.7) { np++; palms.push([x, y - 0.2, z, rand() * 6.28, 0.85 + rand() * 0.5, 0, rand(), Math.floor(rand() * 3)]); place(x, z, 2.2); }
    }
  }

  const geoN = B.build(), geoF = F.build();
  const oc = v.townCenter; geoN.translate(-oc.x, 0, -oc.z); geoF.translate(-oc.x, 0, -oc.z);
  geoN.computeBoundingSphere(); geoF.computeBoundingSphere();
  const near = new THREE.Mesh(geoN, towns.material), far = new THREE.Mesh(geoF, towns.material);
  near.castShadow = near.receiveShadow = true; far.receiveShadow = true;
  const lod = new THREE.LOD();
  lod.addLevel(near, 0); lod.addLevel(far, 1100);
  lod.position.set(oc.x, 0, oc.z);
  lod.autoUpdate = true;
  towns.game.scene.add(lod);
  return { port: v, lod, near, far, tris: B.triCount, huts, boats };
}
