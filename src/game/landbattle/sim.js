// Pure simulation of the land battle (no dependency on three.js): tested without a browser by
// tools/test-landbattle.mjs, displayed by view.js, driven by landBattle.js.
//   const sim = new LandSim({ heights, seed, playerForce, garrison, nation, approach })
//   sim.step(dt) -> events [{ type:'volley'|'melee'|'rout'|'rally'|'end', ... }]   sim.over, sim.result
//   sim.order(units, x, z)  move (or attack if a visible enemy company is under the point)
//   sim.halt(units)   sim.visible(unit)   sim.cellAt(x, z)
// Map: grid of LAND.W × LAND.H cells of LAND.cell m, x to the right, z up the screen (z = 0: beach).
// Cells: 0 open, 1 woods (cover, invisible beyond LAND.woodSpot), 2 hill (high ground advantage),
//        3 rocks (impassable), 4 town (square to hold), 5 water (impassable).
import { LAND, UNIT_KINDS } from '../../data/landbattle.js';
import { mulberry32 } from '../../core/rng.js';

export const T = { OPEN: 0, WOOD: 1, HILL: 2, ROCK: 3, TOWN: 4, WATER: 5 };
const COST = [1, 1.6, 1.4, Infinity, 1, Infinity];

// the player's forces drawn from the crew: swordsmen 55 %, musketeers 35 %, officers 10 % (at least 3)
export function playerForces(men, max = LAND.playerUnitsMax) {
  men = Math.max(6, Math.round(men));
  const off = Math.max(3, Math.min(14, Math.round(men * 0.1)));
  const mus = Math.round((men - off) * 0.4), sab = men - off - mus;
  const out = [{ kind: 'officiers', n: off }];
  const split = (kind, n, k) => { k = Math.max(1, Math.min(k, Math.ceil(n / 6))); for (let i = 0; i < k; i++) out.push({ kind, n: Math.round(n / k) }); };
  const units = Math.max(2, Math.min(max - 1, Math.ceil((men - off) / LAND.manPerUnit)));
  const kSab = Math.max(1, Math.round(units * 0.6)), kMus = Math.max(1, units - kSab);
  split('sabreurs', sab, kSab); split('mousquetaires', mus, kMus);
  return out.filter(u => u.n > 0);
}

// garrison from living.js -> militia 50 %, guards 35 %, cavalry 15 % (if garrison ≥ 50)
export function garrisonForces(garrison, max = LAND.enemyUnitsMax) {
  const g = Math.max(5, Math.round(garrison));
  const cav = g >= 50 ? Math.round(g * 0.15) : 0, gar = Math.round((g - cav) * 0.42), mil = g - cav - gar;
  const out = [];
  const units = Math.max(2, Math.min(max, Math.ceil(g / LAND.manPerUnit)));
  const kCav = cav ? 1 : 0, kGar = Math.max(1, Math.round((units - kCav) * 0.4)), kMil = Math.max(1, units - kCav - kGar);
  const split = (kind, n, k) => { for (let i = 0; i < k; i++) out.push({ kind, n: Math.round(n / k) }); };
  split('milice', mil, kMil); split('gardes', gar, kGar); if (cav) split('cavalerie', cav, kCav);
  return out.filter(u => u.n > 0);
}

// heights: Float32Array W*H (metres, ≤ 0 = sea) sampled on the island's terrain; null = fallback map
export function buildMap({ heights = null, seed = 1, approach = 'land' } = {}) {
  const { W, H } = LAND, N = W * H;
  const h = new Float32Array(N), type = new Uint8Array(N);
  // smoothed value noise (woods, rocks)
  const noise = (sc, s) => { const g = [], gw = Math.ceil(W / sc) + 2, gh = Math.ceil(H / sc) + 2, rr = mulberry32(seed * 31 + s); for (let i = 0; i < gw * gh; i++) g.push(rr());
    return (x, z) => { const fx = x / sc, fz = z / sc, i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v), q = (a, b) => g[b * gw + a];
      return (q(i, j) * (1 - su) + q(i + 1, j) * su) * (1 - sv) + (q(i, j + 1) * (1 - su) + q(i + 1, j + 1) * su) * sv; }; };
  const nW = noise(6, 1), nR = noise(3, 2), nH = noise(9, 3);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const k = j * W + i;
    h[k] = heights ? heights[k] : 4 + nH(i, j) * 22;
  }
  // playable relief: keep the island's shapes but clamp the amplitude (0–18 m above the lowest land point)
  let lo = Infinity, hi = -Infinity;
  for (let k = 0; k < N; k++) if (h[k] > 0.4) { lo = Math.min(lo, h[k]); hi = Math.max(hi, h[k]); }
  if (!isFinite(lo) || hi - lo < 3) { for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { const k = j * W + i; if (h[k] > 0.4 || !heights) h[k] = 3 + nH(i, j) * 16; } lo = 3; hi = 19; }
  const amp = Math.min(1, 18 / Math.max(1, hi - lo));
  for (let k = 0; k < N; k++) h[k] = h[k] > 0.4 ? 1.2 + (h[k] - lo) * amp : -1;
  // forced areas: landing beach (bottom), town (top centre), path between the two
  const town = { x: W * 0.5, z: H * 0.74 };
  const deploy = approach === 'sea' ? { x: W * 0.5, z: H * 0.4 } : { x: W * 0.5, z: H * 0.1 };
  const sorted = Array.from(h).filter(v => v > 0).sort((a, b) => a - b);
  const hillAt = sorted.length ? sorted[Math.floor(sorted.length * 0.78)] : 99;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const k = j * W + i, dT = Math.hypot((i - town.x) / 1.3, j - town.z), dD = Math.hypot((i - deploy.x) / 2.2, j - deploy.z);
    const edge = i === 0 || j === 0 || i === W - 1 || j === H - 1;
    if (dT < 4.2) { type[k] = T.TOWN; h[k] = Math.max(1.5, h[k]); continue; }
    if (dD < 4) { type[k] = T.OPEN; if (h[k] <= 0) h[k] = 1.2; continue; }
    if (h[k] <= 0) { type[k] = T.WATER; continue; }
    if (edge) { type[k] = T.ROCK; continue; }
    const slope = Math.max(Math.abs((h[k + 1] ?? h[k]) - (h[k - 1] ?? h[k])), Math.abs((h[k + W] ?? h[k]) - (h[k - W] ?? h[k])));
    if ((slope > 7 && nR(i, j) > 0.45) || nR(i, j) > 0.86) type[k] = T.ROCK;
    else if (nW(i, j) > 0.6) type[k] = T.WOOD;
    else if (h[k] >= hillAt) type[k] = T.HILL;
    else type[k] = T.OPEN;
  }
  const map = { W, H, cell: LAND.cell, h, type, town: { x: town.x * LAND.cell, z: town.z * LAND.cell }, deploy: { x: deploy.x * LAND.cell, z: deploy.z * LAND.cell } };
  // guaranteed connectivity: if the town can't be reached from the beach, open a straight path
  if (!findPath(map, map.deploy.x, map.deploy.z, map.town.x, map.town.z)) {
    for (let j = Math.floor(deploy.z); j <= Math.ceil(town.z); j++) for (let di = -1; di <= 1; di++) {
      const i = Math.round(W / 2) + di, k = j * W + i; if (type[k] === T.ROCK || type[k] === T.WATER) { type[k] = T.OPEN; h[k] = Math.max(1.2, h[k]); }
    }
  }
  return map;
}

export function cellIndex(map, x, z) {
  const i = Math.max(0, Math.min(map.W - 1, Math.floor(x / map.cell))), j = Math.max(0, Math.min(map.H - 1, Math.floor(z / map.cell)));
  return j * map.W + i;
}
export function heightAt(map, x, z) {
  const fx = Math.max(0, Math.min(map.W - 1.001, x / map.cell - 0.5)), fz = Math.max(0, Math.min(map.H - 1.001, z / map.cell - 0.5));
  const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, W = map.W, h = map.h;
  return (h[j * W + i] * (1 - u) + h[j * W + i + 1] * u) * (1 - v) + (h[(j + 1) * W + i] * (1 - u) + h[(j + 1) * W + i + 1] * u) * v;
}
const passable = (map, k) => COST[map.type[k]] !== Infinity;

// 8-neighbour A* on the grid; returns a list of points (cell centres) or null
export function findPath(map, x0, z0, x1, z1, mounted = false) {
  const { W, H } = map, s = cellIndex(map, x0, z0);
  let g = cellIndex(map, x1, z1);
  if (!passable(map, g)) {   // target in the rocks: nearest free cell
    let best = -1, bd = Infinity;
    for (let k = 0; k < W * H; k++) if (passable(map, k)) { const d = Math.hypot(k % W - g % W, Math.floor(k / W) - Math.floor(g / W)); if (d < bd) { bd = d; best = k; } }
    g = best; if (g < 0) return null;
  }
  const gx = g % W, gz = Math.floor(g / W);
  const open = [s], came = new Int32Array(W * H).fill(-1), cost = new Float32Array(W * H).fill(Infinity), inOpen = new Uint8Array(W * H);
  cost[s] = 0; inOpen[s] = 1;
  const f = k => cost[k] + Math.hypot(k % W - gx, Math.floor(k / W) - gz);
  let it = 0;
  while (open.length && it++ < 4000) {
    let bi = 0; for (let q = 1; q < open.length; q++) if (f(open[q]) < f(open[bi])) bi = q;
    const c = open[bi]; open[bi] = open[open.length - 1]; open.pop(); inOpen[c] = 0;
    if (c === g) break;
    const ci = c % W, cj = Math.floor(c / W);
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const ni = ci + di, nj = cj + dj; if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
      const n = nj * W + ni; if (!passable(map, n)) continue;
      if (di && dj && (!passable(map, cj * W + ni) || !passable(map, nj * W + ci))) continue;   // no corner cutting
      let c1 = COST[map.type[n]]; if (mounted && map.type[n] === T.WOOD) c1 = 3;
      const nc = cost[c] + c1 * (di && dj ? 1.414 : 1);
      if (nc < cost[n]) { cost[n] = nc; came[n] = c; if (!inOpen[n]) { inOpen[n] = 1; open.push(n); } }
    }
  }
  if (came[g] < 0 && g !== s) return null;
  const pts = []; for (let k = g; k !== s && k >= 0; k = came[k]) pts.push({ x: (k % W + 0.5) * map.cell, z: (Math.floor(k / W) + 0.5) * map.cell });
  pts.reverse(); if (pts.length) { pts[pts.length - 1] = { x: x1, z: z1 }; if (!passable(map, cellIndex(map, x1, z1))) pts.pop(); }
  return pts;
}

let _id = 1;
export class LandSim {
  constructor({ heights = null, seed = 7, playerForce = 60, garrison = 50, nation = 'spanish', approach = 'land', allies = 0, rand = null } = {}) {
    this.rand = rand || mulberry32(seed);
    this.map = buildMap({ heights, seed, approach });
    this.nation = nation; this.approach = approach;
    this.time = 0; this.hold = 0; this.over = false; this.result = null;
    this.units = [];
    const m = this.map, P = playerForces(playerForce + allies);
    P.forEach((u, i) => {
      const a = (i - (P.length - 1) / 2) * 34;
      this._add('player', u.kind, u.n, m.deploy.x + a, m.deploy.z + (u.kind === 'mousquetaires' ? -6 : u.kind === 'officiers' ? -16 : 6));
    });
    if (allies) for (const u of this.units) u.allies = true;
    const E = garrisonForces(garrison * (approach === 'sea' ? 1 - LAND.sea.defenderCut : 1));
    let line = 0;
    E.forEach(u => {
      const tx = m.town.x, tz = m.town.z;
      let x, z;
      if (u.kind === 'gardes') { x = tx + (line % 2 ? 22 : -22) * Math.ceil(line / 2 + 0.1); z = tz - 18; line++; }
      else if (u.kind === 'cavalerie') { x = tx + (this.rand() < 0.5 ? -1 : 1) * 110; z = tz + 10; }
      else { x = tx + (this.rand() - 0.5) * 220; z = tz - 60 - this.rand() * 50; }
      const p = this._free(x, z);
      const e = this._add('enemy', u.kind, u.n, p.x, p.z);
      e.post = { x: p.x, z: p.z };
    });
    this.startMen = { player: this._men('player'), enemy: this._men('enemy') };
  }

  _free(x, z) {
    const m = this.map;
    for (let r = 0; r < 12; r++) for (let a = 0; a < 8; a++) {
      const px = x + Math.cos(a * 0.785) * r * m.cell, pz = z + Math.sin(a * 0.785) * r * m.cell;
      if (px < m.cell || pz < m.cell || px > (m.W - 1) * m.cell || pz > (m.H - 1) * m.cell) continue;
      if (passable(m, cellIndex(m, px, pz))) return { x: px, z: pz };
    }
    return { x: m.town.x, z: m.town.z };
  }

  _add(side, kind, n, x, z) {
    const K = UNIT_KINDS[kind];
    const u = { id: _id++, side, kind, K, n, maxN: n, x, z, heading: side === 'player' ? 0 : Math.PI, path: null, target: null,
      morale: K.morale, state: 'ok', cd: this.rand() * (K.reload || 1), reveal: 0, fled: 0, engaged: 0, flank: 0, charging: 0 };
    this.units.push(u); return u;
  }
  _men(side) { return this.units.reduce((a, u) => a + (u.side === side && u.state !== 'gone' ? u.n : 0), 0); }

  cellAt(x, z) { return this.map.type[cellIndex(this.map, x, z)]; }
  alive(u) { return u && u.state !== 'gone' && u.n > 0; }
  // seen by the other side? (woods: only up close or after firing)
  visible(u, bySide = u.side === 'player' ? 'enemy' : 'player') {
    if (!this.alive(u)) return false;
    if (this.cellAt(u.x, u.z) !== T.WOOD || u.reveal > 0 || u.state === 'rout') return true;
    for (const o of this.units) if (o.side === bySide && this.alive(o) && Math.hypot(o.x - u.x, o.z - u.z) < LAND.woodSpot) return true;
    return false;
  }

  order(units, x, z) {
    const tgt = this.units.find(e => e.side === 'enemy' && this.visible(e, 'player') && Math.hypot(e.x - x, e.z - z) < 16);
    const live = units.filter(u => this.alive(u) && u.state !== 'rout');
    live.forEach((u, i) => {
      if (tgt) { u.target = tgt; u.path = null; return; }
      const off = (i - (live.length - 1) / 2) * 20;   // spread in a line perpendicular to the march
      const dx = x - live.reduce((a, v) => a + v.x, 0) / live.length, dz = z - live.reduce((a, v) => a + v.z, 0) / live.length, L = Math.hypot(dx, dz) || 1;
      this._goto(u, x + (-dz / L) * off, z + (dx / L) * off);
      u.target = null;
    });
    return tgt;
  }
  halt(units) { for (const u of units) { u.path = null; u.target = null; } }
  _goto(u, x, z) { u.path = findPath(this.map, u.x, u.z, x, z, u.K.mounted) || null; }

  step(dt) {
    if (this.over) return [];
    const ev = []; this.time += dt;
    const U = this.units, m = this.map;
    for (const u of U) { if (!this.alive(u)) continue; u.reveal = Math.max(0, u.reveal - dt); u.engaged = 0; u.flank = 0; }
    // ---- garrison AI ----
    this._aiT = (this._aiT || 0) - dt;
    if (this._aiT <= 0) { this._aiT = 0.5; this._ai(); }
    // ---- movement ----
    for (const u of U) {
      if (!this.alive(u)) continue;
      let goal = null;
      if (u.state === 'rout') goal = u.side === 'player' ? { x: m.deploy.x, z: -40 } : { x: m.town.x + (u.x < m.town.x ? -400 : 400), z: m.H * m.cell + 60 };
      else if (u.target) {
        if (!this.alive(u.target) || u.target.state === 'rout' && u.side === 'player' && Math.hypot(u.target.x - u.x, u.target.z - u.z) > 120) u.target = null;
        else {
          const d = Math.hypot(u.target.x - u.x, u.target.z - u.z);
          const want = u.K.range && u.kind !== 'officiers' ? u.K.range * 0.85 : LAND.meleeR * 0.6;
          if (d > want) { if (!u.path || (u._repath = (u._repath || 0) - dt) <= 0) { u._repath = 1; this._goto(u, u.target.x, u.target.z); } }
          else u.path = null;
        }
      }
      if (u.path && u.path.length) goal = u.path[0];
      if (!goal) continue;
      const dx = goal.x - u.x, dz = goal.z - u.z, d = Math.hypot(dx, dz);
      const c = this.cellAt(u.x, u.z);
      let sp = u.K.speed * (c === T.WOOD ? (u.K.woodSlow ?? 0.7) : c === T.HILL ? 0.85 : 1) * (u.state === 'rout' ? 1.2 : 1);
      if (u.n <= 0) continue;
      if (d < sp * dt + 0.5) { if (u.state !== 'rout') { u.x = goal.x; u.z = goal.z; u.path?.shift(); } }
      else {
        const nx = u.x + dx / d * sp * dt, nz = u.z + dz / d * sp * dt;
        if (u.state === 'rout' || passable(m, cellIndex(m, nx, nz))) { u.x = nx; u.z = nz; } else u.path = null;
        u.heading = Math.atan2(dx, dz);
        u.charging = u.K.charge ? 1 : 0;
      }
      if (u.state === 'rout' && (u.z < -20 || u.z > m.H * m.cell + 30 || u.x < -300 || u.x > m.W * m.cell + 300)) { u.state = 'gone'; u.fled = u.n; ev.push({ type: 'fled', unit: u }); }
    }
    // ---- separation (blocks don't pass through each other) ----
    for (let a = 0; a < U.length; a++) for (let b = a + 1; b < U.length; b++) {
      const A = U[a], B = U[b]; if (!this.alive(A) || !this.alive(B)) continue;
      const dx = B.x - A.x, dz = B.z - A.z, d = Math.hypot(dx, dz), min = A.side === B.side ? 14 : 7;
      if (d > 0.01 && d < min) { const p = (min - d) / 2 / d; A.x -= dx * p; A.z -= dz * p; B.x += dx * p; B.z += dz * p; }
    }
    // ---- combat ----
    const hits = new Map();
    const hit = (u, k) => hits.set(u, (hits.get(u) || 0) + k);
    for (const u of U) {
      if (!this.alive(u) || u.state === 'rout') continue;
      const foes = U.filter(o => o.side !== u.side && this.alive(o));
      // melee: enemy in contact
      const mel = foes.filter(o => Math.hypot(o.x - u.x, o.z - u.z) < LAND.meleeR + Math.sqrt(u.n + o.n) * 0.6);
      if (mel.length) {
        const o = mel.includes(u.target) ? u.target : mel[0];
        u.engaged = 1; o.engaged = 1; o.flank += 1;
        let k = u.n * u.K.melee * LAND.killMelee * dt;
        if (this._higher(u, o)) k *= LAND.hillBonus;
        if (u.charging && u.K.charge) { k *= u.K.charge; }
        if (u.K.mounted && this.cellAt(u.x, u.z) === T.WOOD) k *= 0.6;
        if (o.state === 'rout') k *= 2;
        if (this.cellAt(o.x, o.z) === T.TOWN && o.side === 'enemy') k *= 0.8;   // defenders fight among the walls
        k *= 0.6 + 0.4 * Math.min(1, u.morale / 60);
        hit(o, k);
        if (!this._meleeT || this.time - this._meleeT > 0.6) { this._meleeT = this.time; ev.push({ type: 'melee', x: (u.x + o.x) / 2, z: (u.z + o.z) / 2 }); }
        u.charging = 0;
        continue;
      }
      // fire: the designated target if in range, else the nearest visible one
      if (!u.K.fire) continue;
      u.cd -= dt;
      if (u.cd > 0) continue;
      let tgt = null, bd = u.K.range;
      for (const o of foes) { const d = Math.hypot(o.x - u.x, o.z - u.z); if (d < bd && this.visible(o, u.side) && (o === u.target || !tgt || d < bd)) { tgt = o; bd = d; if (o === u.target) break; } }
      if (!tgt || (u.path && u.path.length && u.target !== tgt)) continue;
      u.cd = u.K.reload * (0.9 + this.rand() * 0.2);
      u.reveal = LAND.revealT;
      let k = u.n * u.K.fire * LAND.killFire * (1 - 0.5 * bd / u.K.range);
      if (this.cellAt(tgt.x, tgt.z) === T.WOOD) k *= LAND.woodCover;
      if (this.cellAt(tgt.x, tgt.z) === T.TOWN) k *= 0.75;
      if (this._higher(u, tgt)) k *= LAND.hillBonus;
      hit(tgt, k);
      u.heading = Math.atan2(tgt.x - u.x, tgt.z - u.z);
      ev.push({ type: 'volley', unit: u, target: tgt });
    }
    // ---- losses, morale, rout ----
    for (const [u, k] of hits) {
      u._frac = (u._frac || 0) + k;
      const lost = Math.min(u.n, Math.floor(u._frac)); u._frac -= lost;
      if (!lost) continue;
      u.n -= lost; u.dead = (u.dead || 0) + lost;
      u.morale -= lost / u.maxN * LAND.moraleLoss;
      if (u.n <= 0) { u.state = 'gone'; ev.push({ type: 'destroyed', unit: u }); }
    }
    for (const u of U) {
      if (!this.alive(u)) continue;
      if (u.flank >= 2) u.morale -= LAND.flankMul * 2 * dt;
      const off = U.find(o => o !== u && o.side === u.side && o.kind === 'officiers' && this.alive(o) && o.state !== 'rout' && Math.hypot(o.x - u.x, o.z - u.z) < (o.K.aura || 0));
      const sideLost = 1 - this._men(u.side) / Math.max(1, this.startMen?.[u.side] || 1);
      const cap = u.K.morale * (1 - sideLost * 0.5);
      if (!u.engaged) u.morale += (off ? 3 : 0.6) * dt * (u.morale < cap ? 1 : 0);
      if (u.side === 'enemy' && u.kind === 'milice' && sideLost > 0.45) u.morale -= 3 * dt;
      if (u.state === 'ok' && u.morale < LAND.routMorale) { u.state = 'rout'; u.path = null; u.target = null; ev.push({ type: 'rout', unit: u }); }
      else if (u.state === 'rout' && u.morale > LAND.rallyMorale && off) { u.state = 'ok'; ev.push({ type: 'rally', unit: u }); }
      if (u.state === 'rout') u.morale += (off ? 4 : 0) * dt;
      u.morale = Math.max(0, Math.min(100, u.morale));
    }
    // ---- objectifs ----
    const ok = s => U.filter(u => u.side === s && this.alive(u) && u.state !== 'rout');
    const P = ok('player'), E = ok('enemy');
    const inSq = (u) => Math.hypot(u.x - m.town.x, u.z - m.town.z) < LAND.squareR;
    if (P.some(inSq) && !E.some(inSq)) this.hold += dt; else this.hold = Math.max(0, this.hold - dt * 2);
    let res = null;
    if (!E.length) res = { winner: 'player', reason: 'rout' };
    else if (this.hold >= LAND.holdTime) res = { winner: 'player', reason: 'square' };
    else if (!P.length) res = { winner: 'enemy', reason: 'rout' };
    else if (this.time >= LAND.timeLimit) res = { winner: 'enemy', reason: 'time' };
    if (res) {
      this.over = true;
      const dead = s => U.reduce((a, u) => a + (u.side === s ? (u.dead || 0) : 0), 0);
      const surv = s => U.reduce((a, u) => a + (u.side === s ? u.n : 0), 0);
      this.result = { ...res, time: this.time, playerLost: dead('player'), enemyLost: dead('enemy'), playerLeft: surv('player'), enemyLeft: surv('enemy') };
      ev.push({ type: 'end', result: this.result });
    }
    return ev;
  }

  _higher(a, b) { return heightAt(this.map, a.x, a.z) > heightAt(this.map, b.x, b.z) + 3; }

  // AI: guards hold the square, militia defends in front and pursues at short range, cavalry charges the weakest
  _ai() {
    const U = this.units, m = this.map;
    const players = U.filter(u => u.side === 'player' && this.alive(u) && this.visible(u, 'enemy'));
    for (const e of U) {
      if (e.side !== 'enemy' || !this.alive(e) || e.state === 'rout') continue;
      const near = (r, from = e) => players.filter(p => Math.hypot(p.x - from.x, p.z - from.z) < r).sort((a, b) => Math.hypot(a.x - from.x, a.z - from.z) - Math.hypot(b.x - from.x, b.z - from.z));
      let tgt = null;
      if (e.kind === 'cavalerie') tgt = players.filter(p => Math.hypot(p.x - e.x, p.z - e.z) < 260).sort((a, b) => (a.kind === 'mousquetaires' ? -30 : 0) + a.n - ((b.kind === 'mousquetaires' ? -30 : 0) + b.n))[0];
      else if (e.kind === 'gardes') tgt = near(LAND.squareR + 60, { x: m.town.x, z: m.town.z })[0] || near(e.K.range)[0];
      else tgt = near(110)[0] || near(110, e.post)[0];
      if (tgt) { if (e.target !== tgt) { e.target = tgt; e.path = null; } }
      else if (e.target && !this.visible(e.target, 'enemy')) e.target = null;
      if (!e.target && e.post && Math.hypot(e.post.x - e.x, e.post.z - e.z) > 12 && !e.path) this._goto(e, e.post.x, e.post.z);
    }
  }
}
