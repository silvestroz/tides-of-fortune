// Pure simulation of the sneaking / prison-escape mode (no dependency on three.js): tested without a browser by
// tools/test-sneak.mjs, displayed by view.js, driven by sneak.js.
//   const sim = new SneakSim({ seed, kind:'infiltrate'|'escape', garrison, disguise, lockpick })
//   sim.input = { x, z, run, act }   (x, z: wanted direction in plan, act: action held)
//   sim.step(dt) -> events [{ type:'level'|'alarm'|'calm'|'caught'|'unlocked'|'lock'|'goal'|'noise', ... }]
//   sim.level (0 calm · 1 suspicion · 2 wariness · 3 hunt · 4 alarm)   sim.gauge (0–100)   sim.over · sim.result
//   sim.canSee(guard) -> factor 0..1   sim.knockOut(guard)   sim.raiseAlarm()
// Map: grid of SNEAK.W × SNEAK.H cells of SNEAK.cell m; x toward the left of the screen, z up (z = 0: the sea).
// Cells: 0 street, 1 house (blocks walking and sight), 2 water, 3 quay, 4 yard (grass), 5 grate (prison, locked),
//        6 crates (block walking and sight).
import { SNEAK } from '../../data/sneak.js';
import { mulberry32 } from '../../core/rng.js';

export const C = { STREET: 0, HOUSE: 1, WATER: 2, QUAY: 3, YARD: 4, GATE: 5, CRATE: 6 };
const BLOCK = [false, true, true, false, false, true, true];
const SIGHT = [false, true, false, false, false, true, true];

// ------------------------------------------------------------------ carte
export function buildTown({ seed = 1, kind = 'infiltrate' } = {}) {
  const { W, H, cell } = SNEAK, r = mulberry32(seed), N = W * H;
  const type = new Uint8Array(N), hgt = new Float32Array(N), blockId = new Int16Array(N).fill(-1);
  const at = (i, j) => j * W + i;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) type[at(i, j)] = j <= 2 ? C.WATER : j <= 4 ? C.QUAY : C.STREET;
  // outer ring: rampart
  for (let j = 5; j < H; j++) for (let i = 0; i < W; i++) if (i === 0 || i === W - 1 || j === H - 1) { type[at(i, j)] = C.HOUSE; hgt[at(i, j)] = 5; }
  // split into blocks: streets 2 cells wide, blocks of 4 to 6 cells
  const spans = (from, to, min, max) => { const out = []; let p = from; while (p + min <= to) { const w = Math.min(to - p, min + Math.floor(r() * (max - min + 1))); if (w < min) break; out.push([p, p + w]); p += w + 2; } return out; };
  const cols = spans(3, W - 3, 4, 6), rows = spans(7, H - 3, 4, 5);
  const blocks = [];
  for (const [i0, i1] of cols) for (const [j0, j1] of rows) {
    const b = { id: blocks.length, i0, i1, j0, j1, h: 6 + r() * 3, yard: r() < 0.16, tint: r() };
    blocks.push(b);
  }
  const pick = (score, used) => blocks.filter(b => !used.includes(b)).sort((a, b2) => score(a) - score(b2))[0];
  const used = [];
  const gov = pick(b => Math.abs((b.i0 + b.i1) / 2 - W / 2) + (H - b.j1) * 2, used); used.push(gov);
  const tav = pick(b => Math.abs((b.i0 + b.i1) / 2 - W * (0.5 + (r() - 0.5) * 0.4)) * 0.7 + Math.abs((b.j0 + b.j1) / 2 - H * 0.6) * 1.5, used); used.push(tav);
  const pri = pick(b => Math.min(b.i0, W - b.i1) * 1.2 + (H - b.j1) * 1.2 + (b.i1 - b.i0 < 4 || b.j1 - b.j0 < 4 ? 99 : 0), used); used.push(pri);
  gov.role = 'governor'; tav.role = 'tavern'; pri.role = 'prison'; gov.yard = tav.yard = pri.yard = false;
  gov.h = 10; tav.h = 7; pri.h = 8;
  const trees = [];
  for (const b of blocks) {
    for (let j = b.j0; j < b.j1; j++) for (let i = b.i0; i < b.i1; i++) {
      const k = at(i, j);
      if (b.yard) { type[k] = C.YARD; if (r() < 0.22) trees.push({ x: (i + 0.5) * cell, z: (j + 0.5) * cell, s: 0.6 + r() * 0.35 }); }
      else { type[k] = C.HOUSE; hgt[k] = b.h * (b.role ? 1 : 0.85 + r() * 0.3); blockId[k] = b.id; }
    }
    if (!b.yard && !b.role && r() < 0.4) {   // one-cell alley across the block
      if (r() < 0.5) { const i = b.i0 + 1 + Math.floor(r() * (b.i1 - b.i0 - 2)); for (let j = b.j0; j < b.j1; j++) { type[at(i, j)] = C.STREET; hgt[at(i, j)] = 0; blockId[at(i, j)] = -1; } }
      else { const j = b.j0 + 1 + Math.floor(r() * (b.j1 - b.j0 - 2)); for (let i = b.i0; i < b.i1; i++) { type[at(i, j)] = C.STREET; hgt[at(i, j)] = 0; blockId[at(i, j)] = -1; } }
    }
  }
  // prison: inner yard, grate at the bottom of the wall
  const yardCells = [];
  for (let j = pri.j0 + 1; j < pri.j1 - 1; j++) for (let i = pri.i0 + 1; i < pri.i1 - 1; i++) { const k = at(i, j); type[k] = C.YARD; hgt[k] = 0; blockId[k] = -1; yardCells.push(k); }
  const gi = Math.floor((pri.i0 + pri.i1) / 2);
  const gate = { i: gi, j: pri.j0, x: (gi + 0.5) * cell, z: (pri.j0 + 0.5) * cell, open: kind !== 'escape' };
  type[at(gi, pri.j0)] = C.STREET; hgt[at(gi, pri.j0)] = 0; blockId[at(gi, pri.j0)] = -1;
  // doors: street point below the facade
  const door = (b) => { const i = Math.floor((b.i0 + b.i1) / 2); return { x: (i + 0.5) * cell, z: (b.j0 - 0.5) * cell }; };
  const goals = kind === 'escape'
    ? [{ id: 'quay', label: 'the quay', x: W * cell * (r() < 0.5 ? 0.15 : 0.85), z: 3.5 * cell }]
    : [{ id: 'tavern', label: 'the tavern', ...door(tav) }, { id: 'governor', label: 'the governor’s palace', ...door(gov) }];
  const startCell = kind === 'escape' ? yardCells[Math.floor(yardCells.length / 2)] : null;
  const start = kind === 'escape'
    ? { x: (startCell % W + 0.5) * cell, z: (Math.floor(startCell / W) + 0.5) * cell }
    : { x: W * cell * (goals[0].x > W * cell / 2 ? 0.12 : 0.88), z: 3.6 * cell };
  const map = { kind, W, H, cell, type, hgt, blockId, blocks, trees, gate, goals, start, shade: new Uint8Array(N), crates: [] };
  // crates and barrels on the quay and in the streets (without cutting the path to the objectives)
  for (let q = 0; q < 26; q++) {
    const i = 1 + Math.floor(r() * (W - 2)), j = 3 + Math.floor(r() * (H - 5)), k = at(i, j);
    if (type[k] !== C.STREET && type[k] !== C.QUAY) continue;
    if (Math.hypot((i + 0.5) * cell - start.x, (j + 0.5) * cell - start.z) < 8 || goals.some(g => Math.hypot((i + 0.5) * cell - g.x, (j + 0.5) * cell - g.z) < 8)) continue;
    type[k] = C.CRATE;
    if (!goals.every(g => findPath(map, start.x, start.z, g.x, g.z, true))) type[k] = j <= 4 ? C.QUAY : C.STREET;
    else map.crates.push(k);
  }
  if (!gate.open) type[at(gi, pri.j0)] = C.GATE;
  computeShade(map);
  return map;
}

// cast shadow of the houses (low sun, direction SNEAK.sunDir): a cell is in shadow if, walking back toward the
// sun, we meet a house tall enough. Same direction as the render's light (view.js).
export function computeShade(map) {
  const { W, H, cell } = map, t = Math.tan(SNEAK.sunElev), s = SNEAK.sunDir;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const k = j * W + i; map.shade[k] = 0;
    if (BLOCK[map.type[k]] && map.type[k] !== C.CRATE) continue;
    const x = (i + 0.5) * cell, z = (j + 0.5) * cell;
    for (let d = 1; d < 20; d += 1) {
      const kk = cellIndex(map, x + s.x * d, z + s.z * d);
      if (map.type[kk] === C.HOUSE && map.hgt[kk] > d * t) { map.shade[k] = 1; break; }
    }
  }
  for (const tr of map.trees) map.shade[cellIndex(map, tr.x, tr.z)] = 1;
}

export function cellIndex(map, x, z) {
  const i = Math.max(0, Math.min(map.W - 1, Math.floor(x / map.cell))), j = Math.max(0, Math.min(map.H - 1, Math.floor(z / map.cell)));
  return j * map.W + i;
}
export const blocked = (map, x, z) => x < 0 || z < 0 || x >= map.W * map.cell || z >= map.H * map.cell || BLOCK[map.type[cellIndex(map, x, z)]];

// line of sight: 0.5 m steps, houses / crates / grate block it
export function lineOfSight(map, x0, z0, x1, z1) {
  const d = Math.hypot(x1 - x0, z1 - z0), n = Math.ceil(d / 0.5);
  for (let q = 1; q < n; q++) { const f = q / n; if (SIGHT[map.type[cellIndex(map, x0 + (x1 - x0) * f, z0 + (z1 - z0) * f)]]) return false; }
  return true;
}
// free distance along a ray (to draw the vision cones)
export function rayFree(map, x, z, a, max) {
  const dx = Math.sin(a), dz = Math.cos(a);
  for (let d = 0.5; d < max; d += 0.5) if (SIGHT[map.type[cellIndex(map, x + dx * d, z + dz * d)]]) return d;
  return max;
}

// 8-neighbour BFS without corner cutting; returns cell centres (the last point = the exact target) or null
export function findPath(map, x0, z0, x1, z1, test = false) {
  const { W, H, cell } = map, s = cellIndex(map, x0, z0), g = cellIndex(map, x1, z1);
  if (BLOCK[map.type[g]]) return null;
  const came = new Int32Array(W * H).fill(-1); came[s] = s;
  const q = [s]; let h = 0;
  while (h < q.length) {
    const c = q[h++]; if (c === g) break;
    const ci = c % W, cj = (c / W) | 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const ni = ci + di, nj = cj + dj; if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
      const n = nj * W + ni; if (came[n] >= 0 || BLOCK[map.type[n]]) continue;
      if (di && dj && (BLOCK[map.type[cj * W + ni]] || BLOCK[map.type[nj * W + ci]])) continue;
      came[n] = c; q.push(n);
    }
  }
  if (came[g] < 0) return null;
  if (test) return true;
  const out = [{ x: x1, z: z1 }];
  for (let c = came[g]; c !== s; c = came[c]) out.push({ x: (c % W + 0.5) * cell, z: ((c / W | 0) + 0.5) * cell });
  return out.reverse();
}

const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };

// ------------------------------------------------------------------ simulation
export class SneakSim {
  constructor({ seed = 1, kind = 'infiltrate', garrison = 60, disguise = 0, lockpick = 0, rand = null } = {}) {
    this.kind = kind; this.r = rand || mulberry32(seed * 7 + 3);
    const map = this.map = buildTown({ seed, kind });
    this.disguise = disguise; this.lockpick = lockpick;
    this.lockTime = SNEAK.lockTime[Math.max(0, Math.min(2, lockpick))];
    this.lockT = 0;
    this.player = { x: map.start.x, z: map.start.z, heading: Math.PI, moving: false, run: false, picking: false };
    this.input = { x: 0, z: 0, run: false, act: false };
    this.time = 0; this.alarm = false; this.unseenT = 0; this.level = 0; this.gauge = 0; this.over = false; this.result = null;
    this.lastKnown = null; this.caught = null; this.stats = { seen: 0, alarms: 0, maxGauge: 0, noise: 0 };
    const G = SNEAK.guards, n = Math.max(G.min, Math.min(G.max, Math.round(G.min + garrison * G.perGarrison)));
    this.guards = [];
    const streets = [];
    for (let k = 0; k < map.W * map.H; k++) if (map.type[k] === C.STREET || map.type[k] === C.QUAY) streets.push(k);
    const pt = k => ({ x: (k % map.W + 0.5) * map.cell, z: ((k / map.W | 0) + 0.5) * map.cell });
    for (let gi = 0; gi < n * 6 && this.guards.length < n; gi++) {
      const p0 = pt(streets[Math.floor(this.r() * streets.length)]);
      if (Math.hypot(p0.x - map.start.x, p0.z - map.start.z) < 30) continue;
      const route = [p0];
      for (let w = 0; w < 3 + Math.floor(this.r() * 2); w++) {
        for (let tries = 0; tries < 12; tries++) {
          const q = pt(streets[Math.floor(this.r() * streets.length)]), d = Math.hypot(q.x - route[route.length - 1].x, q.z - route[route.length - 1].z);
          if (d > 18 && d < 60 && Math.hypot(q.x - map.start.x, q.z - map.start.z) > 14 && findPath(map, route[route.length - 1].x, route[route.length - 1].z, q.x, q.z, true)) { route.push(q); break; }
        }
      }
      if (route.length < 2) continue;
      this.guards.push({ id: this.guards.length, x: p0.x, z: p0.z, heading: this.r() * Math.PI * 2, route, ri: 1, path: null, wait: 0, look: 0,
        sus: 0, see: 0, state: 'patrol', lastSeen: null, down: false, phase: this.r() * 6 });
    }
  }

  get goals() { return this.map.goals; }

  // sight factor (0 = doesn't see) of the guard on the captain
  canSee(g) {
    const p = this.player, V = SNEAK.view, m = this.map;
    const shade = m.shade[cellIndex(m, p.x, p.z)] && !p.run;
    const range = V.range * (shade ? V.shade : 1) * (p.run ? V.runMul : 1) * (this.alarm || g.sus >= SNEAK.levels[2] ? V.alarmMul : 1);
    const dx = p.x - g.x, dz = p.z - g.z, d = Math.hypot(dx, dz);
    if (d > range) return 0;
    if (d > V.near && Math.abs(angDiff(Math.atan2(dx, dz), g.heading)) > V.half) return 0;
    if (!lineOfSight(m, g.x, g.z, p.x, p.z)) return 0;
    return Math.max(0.2, Math.min(1.25, 1.25 - d / range));
  }

  raiseAlarm() {
    if (this.alarm) return [];
    this.alarm = true; this.unseenT = 0; this.stats.alarms++;
    this.lastKnown = { x: this.player.x, z: this.player.z };
    for (const g of this.guards) if (!g.down) { g.sus = Math.max(g.sus, 85); g.path = null; }
    return [{ type: 'alarm' }];
  }
  knockOut(g) { g.down = true; g.state = 'down'; g.sus = 0; this.caught = null; }

  step(dt) {
    const ev = [];
    if (this.over || this.caught) return ev;
    this.time += dt;
    const m = this.map, p = this.player, inp = this.input, S = SNEAK;
    // ---- capitaine ----
    const il = Math.hypot(inp.x, inp.z);
    p.run = !!inp.run && il > 0.1; p.moving = il > 0.1;
    p.picking = false;
    if (p.moving) {
      const sp = (p.run ? S.run : S.walk) * dt, ux = inp.x / il, uz = inp.z / il, R = S.radius;
      p.heading = Math.atan2(ux, uz);
      const nx = p.x + ux * sp; if (!blocked(m, nx + Math.sign(ux) * R, p.z + R * 0.7) && !blocked(m, nx + Math.sign(ux) * R, p.z - R * 0.7)) p.x = nx;
      const nz = p.z + uz * sp; if (!blocked(m, p.x + R * 0.7, nz + Math.sign(uz) * R) && !blocked(m, p.x - R * 0.7, nz + Math.sign(uz) * R)) p.z = nz;
    }
    // pick the grate (Space held, within reach)
    const gate = m.gate;
    if (!gate.open && Math.hypot(p.x - gate.x, p.z - (gate.z + m.cell * 0.5)) < 3.2) {
      this.nearGate = true;
      if (inp.act && !p.moving) {
        p.picking = true; this.lockT += dt;
        if (Math.floor(this.lockT / 0.6) !== Math.floor((this.lockT - dt) / 0.6)) ev.push({ type: 'lock', t: this.lockT / this.lockTime });
        if (this.lockT >= this.lockTime) { gate.open = true; m.type[gate.j * m.W + gate.i] = C.STREET; ev.push({ type: 'unlocked' }); }
      }
    } else this.nearGate = false;
    // ---- guards ----
    const noiseR = p.run ? S.noise.run : p.picking ? S.noise.lock : 0, noiseRate = p.run ? S.noise.runRate : S.noise.lockRate;
    let seenAny = false, maxSus = 0;
    for (const g of this.guards) {
      if (g.down) continue;
      const f = this.canSee(g);
      g.see = f;
      if (f > 0) {
        seenAny = true;
        const shade = m.shade[cellIndex(m, p.x, p.z)] && !p.run;
        const rate = S.seeRate * f * (p.run ? S.runSee : 1) * (shade ? S.shadeSee : 1) * S.disguise[Math.max(0, Math.min(2, this.disguise))] * (this.alarm ? 3 : 1);
        g.sus = Math.min(100, g.sus + rate * dt);
        g.lastSeen = { x: p.x, z: p.z };
        if (this.alarm) this.lastKnown = { x: p.x, z: p.z };
      } else {
        const d = Math.hypot(p.x - g.x, p.z - g.z);
        if (noiseR && d < noiseR) {   // heard: turns round, comes closer
          if (g.sus < S.noise.cap) g.sus = Math.min(S.noise.cap, g.sus + noiseRate * (1 - d / noiseR * 0.5) * dt);
          g.lastSeen = { x: p.x, z: p.z }; this.stats.noise += dt;
        } else if (!this.alarm) g.sus = Math.max(0, g.sus - S.decay * dt);
      }
      if (g.sus >= 100 && !this.alarm) ev.push(...this.raiseAlarm());
      maxSus = Math.max(maxSus, g.sus);
      this._guardMove(g, dt);
      // caught
      if (Math.hypot(p.x - g.x, p.z - g.z) < S.catchR + (g.state === 'chase' ? 0.4 : 0) && (g.sus >= S.levels[1] || this.alarm || f > 0)) {
        this.caught = g; ev.push({ type: 'caught', guard: g }); break;
      }
    }
    if (seenAny) this.stats.seen += dt;
    if (this.alarm) {
      if (seenAny) this.unseenT = 0; else this.unseenT += dt;
      if (this.unseenT > S.alarmCalm) {
        this.alarm = false; this.lastKnown = null;
        for (const g of this.guards) { g.sus = Math.min(g.sus, S.levels[2] - 5); g.path = null; }
        maxSus = Math.min(maxSus, S.levels[2] - 5);
        ev.push({ type: 'calm' });
      }
    }
    this.gauge = this.alarm ? 100 : maxSus;
    this.stats.maxGauge = Math.max(this.stats.maxGauge, this.gauge);
    const L = S.levels, lvl = this.alarm ? 4 : this.gauge >= L[2] ? 3 : this.gauge >= L[1] ? 2 : this.gauge >= L[0] ? 1 : 0;
    if (lvl !== this.level) { ev.push({ type: 'level', from: this.level, to: lvl }); this.level = lvl; }
    // ---- objectif ----
    if (!this.caught) for (const goal of m.goals) if (Math.hypot(p.x - goal.x, p.z - goal.z) < S.goalR) {
      this.over = true; this.result = { outcome: 'success', goal: goal.id, time: this.time, alarms: this.stats.alarms };
      ev.push({ type: 'goal', goal }); break;
    }
    return ev;
  }

  _guardMove(g, dt) {
    const G = SNEAK.guards, L = SNEAK.levels, m = this.map;
    let target = null, speed = G.walk;
    const prev = g.state;
    if (this.alarm) { g.state = 'chase'; target = g.see > 0 ? this.player : (this.lastKnown || g.lastSeen); speed = G.chase; }
    else if (g.sus >= L[2] && g.lastSeen) { g.state = 'chase'; target = g.see > 0 ? this.player : g.lastSeen; speed = G.chase * 0.9; }
    else if (g.sus >= L[1] && g.lastSeen) { g.state = 'investigate'; target = g.lastSeen; speed = G.investigate; }
    else if (g.sus >= L[0] && g.lastSeen) { g.state = 'look'; }
    else g.state = 'patrol';
    if (g.state !== prev) g.path = null;
    if (g.state === 'look') { this._turn(g, Math.atan2(g.lastSeen.x - g.x, g.lastSeen.z - g.z), dt); return; }
    if (g.state === 'patrol') {
      if (g.wait > 0) { g.wait -= dt; g.look += dt; this._turn(g, g.baseH + Math.sin(g.look * 1.3 + g.phase) * 0.9, dt); return; }
      const wp = g.route[g.ri];
      if (!g.path) g.path = findPath(m, g.x, g.z, wp.x, wp.z) || [];
      if (!g.path.length) { g.ri = (g.ri + 1) % g.route.length; g.wait = 1.4 + this.r() * 1.8; g.look = 0; g.baseH = g.heading; g.path = null; return; }
    } else if (target) {
      // path recomputed when the target moves (every ~0.6 s)
      g.repath = (g.repath || 0) - dt;
      if (!g.path || g.repath <= 0) { g.repath = 0.6; g.path = (g.see > 0 && lineOfSight(m, g.x, g.z, target.x, target.z)) ? [{ x: target.x, z: target.z }] : (findPath(m, g.x, g.z, target.x, target.z) || []); }
      if (!g.path.length) {   // reached the last known point: looks around, calms down slowly
        g.look += dt; this._turn(g, g.heading + 1.5, dt);
        if (!this.alarm && g.see <= 0) g.sus = Math.max(0, g.sus - SNEAK.decay * 0.8 * dt);
        return;
      }
    }
    const nx = g.path[0];
    const dx = nx.x - g.x, dz = nx.z - g.z, d = Math.hypot(dx, dz);
    if (d < 0.4) { g.path.shift(); return; }
    this._turn(g, Math.atan2(dx, dz), dt * 1.5);
    const sp = Math.min(d, speed * dt);
    g.x += dx / d * sp; g.z += dz / d * sp;
  }
  _turn(g, a, dt) { const d = angDiff(a, g.heading), s = SNEAK.guards.turn * dt; g.heading += Math.max(-s, Math.min(s, d)); }

  forceEnd(outcome = 'success') {
    if (this.over) return;
    this.over = true; this.result = { outcome, goal: outcome === 'success' ? this.map.goals[0].id : null, time: this.time, alarms: this.stats.alarms, forced: true };
  }
}
