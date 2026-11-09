// Pure simulation of the sneaking / prison-escape mode (no dependency on three.js): tested without a browser by
// tools/test-sneak.mjs, displayed by view.js, driven by sneak.js.
//   const sim = new SneakSim({ seed, patrolSeed, kind:'infiltrate'|'escape', garrison, disguise, lockpick })
//     seed: the town (one layout per port); patrolSeed: guards, routes and posts (drawn again at every attempt)
//   sim.input = { x, z, run, act }   (x, z: wanted direction in plan, act: action held = pick the lock)
//   sim.step(dt) -> events [{ type:'level'|'alarm'|'calm'|'caught'|'unlocked'|'lock'|'goal'|'barred'|'landed'|'hide'|'ko'|'body', ... }]
//   sim.level (0 calm · 1 suspicion · 2 wariness · 3 hunt · 4 alarm)   sim.gauge (0–100)   sim.over · sim.result
//   sim.canSee(guard) -> factor 0..1   sim.lightAt(x, z) -> 0..1   sim.exposure -> { vis, rate, light, shade }
//   Fugitive's tools: sim.throwStone(x, z) · sim.toggleHide() · sim.tryKnockOut()  -> event or { type:'fail', why }
//   sim.knockOut(guard) (duel won)   sim.raiseAlarm(at)   sim.stones · sim.player.hidden (hiding spot or null)
// Map: grid of SNEAK.W × SNEAK.H cells of SNEAK.cell m; x toward the left of the screen, z up (z = 0: the sea).
// Cells: 0 street, 1 house (blocks walking and sight), 2 water, 3 quay, 4 yard (grass), 5 grate (prison, locked),
//        6 crates (block walking and sight).
// map.houses: lots { i0, i1, j0, j1, h, roof, wall, axis, role } (cell bounds, wall height, roof rise, colour index,
// ridge axis 'x'|'z'); map.lamps { x, z, r, wall }; map.hides { x, z, kind:'door'|'barrels'|'hay', nx, nz };
// map.posts { id, x, z, h }; map.light: lantern light per cell (0..1); map.shade: moon shadow per cell.
import { SNEAK } from '../../data/sneak.js';
import { mulberry32 } from '../../core/rng.js';

export const C = { STREET: 0, HOUSE: 1, WATER: 2, QUAY: 3, YARD: 4, GATE: 5, CRATE: 6 };
const BLOCK = [false, true, true, false, false, true, true];
const SIGHT = [false, true, false, false, false, true, true];

// ------------------------------------------------------------------ map
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
  for (const [i0, i1] of cols) for (const [j0, j1] of rows) blocks.push({ id: blocks.length, i0, i1, j0, j1, yard: r() < 0.16 });
  const pick = (score, used) => blocks.filter(b => !used.includes(b)).sort((a, b2) => score(a) - score(b2))[0];
  const used = [];
  const gov = pick(b => Math.abs((b.i0 + b.i1) / 2 - W / 2) + (H - b.j1) * 2, used); used.push(gov);
  const tav = pick(b => Math.abs((b.i0 + b.i1) / 2 - W * (0.5 + (r() - 0.5) * 0.4)) * 0.7 + Math.abs((b.j0 + b.j1) / 2 - H * 0.6) * 1.5, used); used.push(tav);
  const pri = pick(b => Math.min(b.i0, W - b.i1) * 1.2 + (H - b.j1) * 1.2 + (b.i1 - b.i0 < 4 || b.j1 - b.j0 < 4 ? 99 : 0), used); used.push(pri);
  gov.role = 'governor'; tav.role = 'tavern'; pri.role = 'prison'; gov.yard = tav.yard = pri.yard = false;
  const trees = [], houses = [];
  // a lot: one house (cells i0..i1-1 × j0..j1-1), its height applied to the cells (walls + half the roof: cast shadow)
  const lot = (i0, i1, j0, j1, b, role = null) => {
    const w = i1 - i0, d = j1 - j0, storeys = role ? (role === 'governor' ? 3 : 2) : 1 + Math.floor(r() * 2.6);
    const h = role === 'prison' ? 7 : 2.4 + storeys * 2.3 + (role === 'governor' ? 1 : 0);
    const axis = w >= d ? 'x' : 'z', roof = role === 'prison' ? 0 : Math.min(w, d) * cell * (0.26 + r() * 0.08);
    const hs = { id: houses.length, i0, i1, j0, j1, h, roof, axis, role, wall: Math.floor(r() * 6), shutter: Math.floor(r() * 4), block: b.id };
    houses.push(hs);
    for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) { const k = at(i, j); type[k] = C.HOUSE; hgt[k] = h + roof * 0.5; blockId[k] = b.id; }
  };
  // lots of a plain block: strips 1–3 cells wide, cut front / back when deep
  const lots = (i0, i1, j0, j1, b) => {
    for (let i = i0; i < i1;) {
      let w = Math.min(i1 - i, 1 + (r() < 0.6 ? 1 : 0) + (r() < 0.12 ? 1 : 0)); if (i1 - (i + w) === 1 && w < 3) w++;
      const d = j1 - j0;
      if (d >= 4 || (d >= 3 && r() < 0.6)) { const m = j0 + (d >= 4 ? 2 : 1) + (d >= 5 && r() < 0.5 ? 1 : 0); lot(i, i + w, j0, m, b); lot(i, i + w, m, j1, b); }
      else lot(i, i + w, j0, j1, b);
      i += w;
    }
  };
  for (const b of blocks) {
    if (b.yard) {
      for (let j = b.j0; j < b.j1; j++) for (let i = b.i0; i < b.i1; i++) {
        type[at(i, j)] = C.YARD;
        if (r() < 0.24) trees.push({ x: (i + 0.3 + r() * 0.4) * cell, z: (j + 0.3 + r() * 0.4) * cell, s: 0.6 + r() * 0.35, palm: r() < 0.5 });
      }
      continue;
    }
    if (b.role) { lot(b.i0, b.i1, b.j0, b.j1, b, b.role); continue; }
    // one-cell alley across the block (sometimes)
    let ai = -1, aj = -1;
    if (r() < 0.4) { if (r() < 0.5) ai = b.i0 + 1 + Math.floor(r() * (b.i1 - b.i0 - 2)); else aj = b.j0 + 1 + Math.floor(r() * (b.j1 - b.j0 - 2)); }
    const xs = ai < 0 ? [[b.i0, b.i1]] : [[b.i0, ai], [ai + 1, b.i1]], zs = aj < 0 ? [[b.j0, b.j1]] : [[b.j0, aj], [aj + 1, b.j1]];
    for (const [x0, x1] of xs) for (const [z0, z1] of zs) if (x1 > x0 && z1 > z0) lots(x0, x1, z0, z1, b);
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
  const map = { kind, W, H, cell, type, hgt, blockId, blocks, houses, trees, gate, goals, start, shade: new Uint8Array(N), light: new Float32Array(N), crates: [], lamps: [], hides: [], posts: [] };
  const free = (x, z) => !blocked(map, x, z) && !blocked(map, x + 0.6, z) && !blocked(map, x - 0.6, z) && !blocked(map, x, z + 0.6) && !blocked(map, x, z - 0.6);
  const far = (x, z, dmin) => Math.hypot(x - start.x, z - start.z) > dmin && goals.every(g => Math.hypot(x - g.x, z - g.z) > dmin) && Math.hypot(x - gate.x, z - gate.z) > dmin;
  // crates and barrels on the quay and in the streets (without cutting the path to the objectives)
  for (let q = 0; q < 26; q++) {
    const i = 1 + Math.floor(r() * (W - 2)), j = 3 + Math.floor(r() * (H - 5)), k = at(i, j);
    if (type[k] !== C.STREET && type[k] !== C.QUAY) continue;
    if (!far((i + 0.5) * cell, (j + 0.5) * cell, 8)) continue;
    type[k] = C.CRATE;
    if (!goals.every(g => findPath(map, start.x, start.z, g.x, g.z, true))) type[k] = j <= 4 ? C.QUAY : C.STREET;
    else map.crates.push(k);
  }
  // sentry posts at the exits (manned or not, drawn per attempt by SneakSim)
  const post = (id, x, z, h) => { if (free(x, z)) map.posts.push({ id, x, z, h }); };
  if (kind === 'escape') {
    const g0 = goals[0], side = g0.x < W * cell / 2 ? 1 : -1;
    post('quay', g0.x + side * 9, g0.z + 1.5, side * 0.45);   // faces the town, turned a little away from the boat
    const front = { x: gate.x, z: gate.z - cell };
    const cand = [];
    for (let k = 0; k < N; k++) if (type[k] === C.STREET) {
      const x = (k % W + 0.5) * cell, z = ((k / W | 0) + 0.5) * cell, d = Math.hypot(x - front.x, z - front.z);
      if (d > 11 && d < 18 && lineOfSight(map, x, z, front.x, front.z) && free(x, z)) cand.push({ x, z });
    }
    // watches the street, the grate at the edge of his head sweep
    if (cand.length) { const c = cand[Math.floor(r() * cand.length)]; post('gate', c.x, c.z, Math.atan2(front.x - c.x, front.z - c.z) + (r() < 0.5 ? 1 : -1) * Math.PI * 0.5); }
  } else {
    for (const g of goals) { const s = r() < 0.5 ? 1 : -1; for (const dx of [s * 4.2, -s * 4.2]) { if (free(g.x + dx, g.z + 1)) { post(g.id, g.x + dx, g.z + 1, Math.PI); break; } } }
    post('quay', W * cell * (0.42 + r() * 0.16), 4.1 * cell, 0);
  }
  // lanterns: on house corners at some crossings, at the doors of the tavern and the palace, by the posts
  const lamp = (x, z, wall = true) => { if (!blocked(map, x, z) && map.lamps.every(l => Math.hypot(l.x - x, l.z - z) > 7)) map.lamps.push({ x, z, r: SNEAK.light.lamp, wall }); };
  for (const g of goals) if (g.id !== 'quay') lamp(g.x + 2.2, g.z + 1.4);
  for (const p of map.posts) lamp(p.x + (p.id === 'quay' ? 0 : 1.2), p.z + (p.id === 'quay' ? -1.8 : 1.2), p.id !== 'quay');
  for (const b of blocks) {
    if (b.yard || b === pri) continue;
    for (const [ci, cj, sx, sz] of [[b.i0, b.j0, -1, -1], [b.i1, b.j0, 1, -1], [b.i0, b.j1, -1, 1], [b.i1, b.j1, 1, 1]]) {
      if (r() > 0.3) continue;
      lamp(ci * cell + sx * 0.7, cj * cell + sz * 0.7);
    }
  }
  for (const l of map.lamps) l.y = l.wall ? 3.4 : 2.6;
  // light map: lantern light at the cell centres (the sim computes the exact value at any point with lightAt)
  for (let k = 0; k < N; k++) if (!BLOCK[type[k]]) map.light[k] = lampLight(map, (k % W + 0.5) * cell, ((k / W | 0) + 0.5) * cell);
  // hiding spots: doorways and barrels against the walls, haystacks in the yards (dark places, away from the exits)
  const hides = map.hides, cand = [];
  for (let k = 0; k < N; k++) {
    const i = k % W, j = k / W | 0, t = type[k];
    if (t !== C.STREET && t !== C.YARD) continue;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = at(i + di, j + dj);
      if (i + di < 1 || i + di >= W - 1 || j + dj < 5 || j + dj >= H - 1) continue;
      const wall = type[n] === C.HOUSE && blockId[n] >= 0 && blockId[n] !== pri.id;
      if (t === C.STREET ? !wall : !(type[n] === C.STREET)) continue;
      const x = (i + 0.5 + di * 0.32) * cell, z = (j + 0.5 + dj * 0.32) * cell;
      cand.push({ x, z, nx: di, nz: dj, kind: t === C.YARD ? 'hay' : null, key: r() });
      break;
    }
  }
  cand.sort((a, b) => a.key - b.key);
  for (const c of cand) {
    if (hides.length >= 16) break;
    if (!far(c.x, c.z, 12) || lampLight(map, c.x, c.z) > 0.25 || hides.some(h => Math.hypot(h.x - c.x, h.z - c.z) < 15) || map.posts.some(p => Math.hypot(p.x - c.x, p.z - c.z) < 10)) continue;
    if (c.kind === 'hay') { c.x -= c.nx * cell * 0.5; c.z -= c.nz * cell * 0.5; }   // haystack inside the yard, by the street
    if (!free(c.x, c.z)) continue;
    c.kind ||= r() < 0.45 ? 'door' : 'barrels';
    delete c.key; hides.push(c);
  }
  if (!gate.open) type[at(gi, pri.j0)] = C.GATE;
  computeShade(map);
  return map;
}

// lantern light at a point (0..1): linear fall-off, walls cut it
function lampLight(map, x, z) {
  let L = 0;
  for (const l of map.lamps) { const d = Math.hypot(x - l.x, z - l.z); if (d < l.r) { const v = 1 - d / l.r; if (v > L && lineOfSight(map, l.x, l.z, x, z)) L = v; } }
  return L;
}

// cast moon shadow of the houses (direction SNEAK.moonDir): a cell is in shadow if, walking back toward the moon,
// we meet a house tall enough. Same direction as the render's moonlight (view.js).
export function computeShade(map) {
  const { W, H, cell } = map, t = Math.tan(SNEAK.moonElev), s = SNEAK.moonDir;
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

// 8-neighbour search without corner cutting; returns cell centres (the last point = the exact target) or null.
// cost(k) (optional): extra cost of entering cell k (Dijkstra), otherwise breadth-first.
export function findPath(map, x0, z0, x1, z1, test = false, cost = null) {
  const { W, H, cell } = map, s = cellIndex(map, x0, z0), g = cellIndex(map, x1, z1);
  if (BLOCK[map.type[g]]) return null;
  const came = new Int32Array(W * H).fill(-1); came[s] = s;
  if (cost) {
    const dist = new Float32Array(W * H).fill(Infinity), done = new Uint8Array(W * H); dist[s] = 0;
    const open = [s];
    while (open.length) {
      let bi = 0; for (let q = 1; q < open.length; q++) if (dist[open[q]] < dist[open[bi]]) bi = q;
      const c = open[bi]; open[bi] = open[open.length - 1]; open.pop();
      if (done[c]) continue; done[c] = 1; if (c === g) break;
      const ci = c % W, cj = (c / W) | 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = ci + di, nj = cj + dj; if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
        const n = nj * W + ni; if (done[n] || BLOCK[map.type[n]]) continue;
        if (di && dj && (BLOCK[map.type[cj * W + ni]] || BLOCK[map.type[nj * W + ci]])) continue;
        const nd = dist[c] + (di && dj ? 1.41 : 1) * (1 + cost(n));
        if (nd < dist[n]) { dist[n] = nd; came[n] = c; open.push(n); }
      }
    }
  } else {
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
  }
  if (came[g] < 0) return null;
  if (test) return true;
  const out = [{ x: x1, z: z1 }];
  for (let c = came[g]; c !== s; c = came[c]) out.push({ x: (c % W + 0.5) * cell, z: ((c / W | 0) + 0.5) * cell });
  return out.reverse();
}

export const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };

// ------------------------------------------------------------------ simulation
export class SneakSim {
  constructor({ seed = 1, patrolSeed = seed, kind = 'infiltrate', garrison = 60, disguise = 0, lockpick = 0, rand = null } = {}) {
    this.kind = kind; this.r = rand || mulberry32(patrolSeed * 7 + 3);
    const map = this.map = buildTown({ seed, kind });
    this.disguise = disguise; this.lockpick = lockpick;
    this.lockTime = SNEAK.lockTime[Math.max(0, Math.min(2, lockpick))];
    this.lockT = 0; this.stones = SNEAK.tools.stones; this.stoneCd = 0; this.flying = [];
    this.player = { x: map.start.x, z: map.start.z, heading: Math.PI, moving: false, run: false, picking: false, hidden: null };
    this.input = { x: 0, z: 0, run: false, act: false };
    this.time = 0; this.alarm = false; this.unseenT = 0; this.level = 0; this.gauge = 0; this.over = false; this.result = null;
    this.lastKnown = null; this.caught = null; this.stats = { seen: 0, alarms: 0, maxGauge: 0, noise: 0, stones: 0, kos: 0, hides: 0 };
    this.exposure = { vis: SNEAK.light.moon, rate: 1, light: 0, shade: false };
    this._spawnGuards(garrison);
  }

  // guards drawn per attempt: sentries at some exits (head sweeping), then patrols on random loops, some in pairs
  _spawnGuards(garrison) {
    const map = this.map, G = SNEAK.guards, P = SNEAK.post, r = this.r;
    const n = Math.max(G.min, Math.min(G.max, Math.round(G.min + garrison * G.perGarrison)));
    this.guards = [];
    const mk = (o) => { const g = { id: this.guards.length, heading: 0, route: null, ri: 1, path: null, wait: 0, look: 0, sus: 0, see: 0, state: 'patrol',
      lastSeen: null, down: false, ko: false, found: false, phase: r() * 6, torch: false, post: null, leader: null, lure: null, bodyT: 0, ...o }; this.guards.push(g); return g; };
    // posts: the exit you are heading for is always guarded, the others by chance
    const want = Math.min(n - 1, G.posts[garrison >= 60 ? 1 : 0]);
    const first = p => (this.kind === 'escape' ? p.id === 'quay' : p.id !== 'quay') ? 0 : 1;
    const posts = map.posts.map(p => ({ p, k: first(p) + r() * 0.5 })).sort((a, b) => a.k - b.k).map(o => o.p);
    for (const p of posts.slice(0, want)) {
      mk({ x: p.x, z: p.z, heading: p.h, baseH: p.h, post: { x: p.x, z: p.z, h: p.h, period: P.period[0] + r() * (P.period[1] - P.period[0]), id: p.id }, state: 'post', route: [p, p] });
    }
    const streets = [];
    for (let k = 0; k < map.W * map.H; k++) if (map.type[k] === C.STREET || map.type[k] === C.QUAY) streets.push(k);
    const pt = k => ({ x: (k % map.W + 0.5) * map.cell, z: ((k / map.W | 0) + 0.5) * map.cell });
    for (let tries = 0; tries < n * 8 && this.guards.length < n; tries++) {
      const p0 = pt(streets[Math.floor(r() * streets.length)]);
      if (Math.hypot(p0.x - map.start.x, p0.z - map.start.z) < 32) continue;
      const route = [p0], legs = 3 + Math.floor(r() * 3);
      for (let w = 0; w < legs; w++) {
        for (let t2 = 0; t2 < 14; t2++) {
          const q = pt(streets[Math.floor(r() * streets.length)]), last = route[route.length - 1], d = Math.hypot(q.x - last.x, q.z - last.z);
          if (d > 16 && d < 64 && Math.hypot(q.x - map.start.x, q.z - map.start.z) > 16 && findPath(map, last.x, last.z, q.x, q.z, true)) { route.push(q); break; }
        }
      }
      if (route.length < 2) continue;
      if (r() < 0.35) for (let w = route.length - 2; w > 0; w--) route.push(route[w]);   // back and forth instead of a loop
      const pair = this.guards.length + 1 < n && r() < G.pairShare;
      const ld = mk({ x: p0.x, z: p0.z, heading: r() * Math.PI * 2, route, ri: 1, torch: pair || r() < G.torch });
      if (pair) mk({ x: p0.x - 1.5, z: p0.z, heading: ld.heading, route, leader: ld, state: 'follow' });
    }
  }

  get goals() { return this.map.goals; }

  // light at a point (0..1): lanterns (walls cut them) and the guards' torches
  lightAt(x, z) {
    let L = lampLight(this.map, x, z);
    const R = SNEAK.light.torch;
    for (const g of this.guards) if (g.torch && !g.down) {
      const d = Math.hypot(x - g.x, z - g.z); if (d < R) { const v = 1 - d / R; if (v > L && lineOfSight(this.map, g.x, g.z, x, z)) L = v; }
    }
    return Math.min(1, L * 1.3);
  }
  _expose() {
    const p = this.player, Lg = SNEAK.light, m = this.map;
    const shade = !!m.shade[cellIndex(m, p.x, p.z)] && !p.run, light = this.lightAt(p.x, p.z);
    const v0 = shade ? Lg.dark : Lg.moon, r0 = shade ? Lg.rateDark : Lg.rateMoon;
    this.exposure = { vis: v0 + (Lg.lit - v0) * light, rate: r0 + (Lg.rateLit - r0) * light, light, shade };
  }

  // sight factor (0 = doesn't see) of the guard on the captain; g._cone: seen in the cone (else sensed close behind)
  canSee(g) {
    const p = this.player, V = SNEAK.view, m = this.map;
    const dx = p.x - g.x, dz = p.z - g.z, d = Math.hypot(dx, dz);
    g._cone = false;
    if (p.hidden) {   // hidden: only a guard searching right there finds you
      if (d < SNEAK.tools.searchR && (g.state === 'investigate' || g.state === 'chase' || g.state === 'look' || g.state === 'lured') && lineOfSight(m, g.x, g.z, p.x, p.z)) { g._cone = true; return 1; }
      return 0;
    }
    const range = V.range * this.exposure.vis * (p.run ? V.runMul : 1) * (this.alarm || g.sus >= SNEAK.levels[2] ? V.alarmMul : 1);
    const cone = Math.abs(angDiff(Math.atan2(dx, dz), g.heading)) <= V.half;
    if (d > (cone ? Math.max(range, V.near) : V.near)) return 0;
    if (!lineOfSight(m, g.x, g.z, p.x, p.z)) return 0;
    if (!cone) return V.behind * (p.run ? 4 : 1);
    g._cone = true;
    return Math.max(0.2, Math.min(1.25, 1.25 - d / range));
  }

  raiseAlarm(at = null) {
    if (this.alarm) return [];
    this.alarm = true; this.unseenT = 0; this.stats.alarms++;
    this.lastKnown = at ? { x: at.x, z: at.z } : { x: this.player.x, z: this.player.z };
    for (const g of this.guards) if (!g.down) { g.sus = Math.max(g.sus, 85); g.path = null; g.lure = null; }
    return [{ type: 'alarm' }];
  }
  // knocked out in a duel (the fight was seen and heard: the body is not a hidden one)
  knockOut(g) { g.down = true; g.state = 'down'; g.sus = 0; g.found = true; this.caught = null; }

  // ---- fugitive's tools ----
  throwStone(x, z) {
    const T = SNEAK.tools, p = this.player, m = this.map;
    if (this.over || this.caught) return { type: 'fail', why: 'busy' };
    if (this.stones <= 0) return { type: 'fail', why: 'none' };
    if (this.stoneCd > 0) return { type: 'fail', why: 'cooldown' };
    let dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz);
    if (d < 1) { dx = Math.sin(p.heading); dz = Math.cos(p.heading); d = 10; } else { dx /= d; dz /= d; }
    d = Math.min(d, T.throwMax);
    // flies over the low things, stops at the first wall
    let fd = 0; for (let s = 0.5; s <= d; s += 0.5) { if (SIGHT[m.type[cellIndex(m, p.x + dx * s, p.z + dz * s)]] && m.type[cellIndex(m, p.x + dx * s, p.z + dz * s)] !== C.CRATE) break; fd = s; }
    const lx = p.x + dx * Math.max(0.5, fd - 0.3), lz = p.z + dz * Math.max(0.5, fd - 0.3);
    this.stones--; this.stoneCd = T.cooldown; this.stats.stones++;
    const fly = { x0: p.x, z0: p.z, x: lx, z: lz, t: 0, dur: 0.25 + fd / 22 };
    this.flying.push(fly);
    return { type: 'stone', x: lx, z: lz, dur: fly.dur, left: this.stones };
  }
  _land(f) {
    // the nearest guard who hears it (and is not already hunting) goes to have a look
    const T = SNEAK.tools, L = SNEAK.levels;
    let best = null, bd = Infinity;
    for (const g of this.guards) {
      if (g.down || this.alarm || g.sus >= L[2]) continue;
      const d = Math.hypot(g.x - f.x, g.z - f.z);
      if (d < T.stoneNoise && d < bd && findPath(this.map, g.x, g.z, f.x, f.z, true)) { best = g; bd = d; }
    }
    if (best) { const g = best.leader && !best.leader.down ? best.leader : best; g.lure = { x: f.x, z: f.z, t: 0 }; g.path = null; }
    return { type: 'landed', x: f.x, z: f.z, guard: best };
  }
  toggleHide() {
    const p = this.player, T = SNEAK.tools;
    if (p.hidden) { p.hidden = null; return { type: 'hide', on: false }; }
    let best = null, bd = T.hideR;
    for (const h of this.map.hides) { const d = Math.hypot(h.x - p.x, h.z - p.z); if (d < bd) { best = h; bd = d; } }
    if (!best) return { type: 'fail', why: 'nohide' };
    p.hidden = best; p.x = best.x; p.z = best.z; p.moving = p.run = false; this.stats.hides++;
    // a guard watching you slip in knows where you are
    for (const g of this.guards) if (!g.down && g.see > 0 && g._cone && g.sus >= SNEAK.levels[0]) { g.lastSeen = { x: best.x, z: best.z }; g.sus = Math.max(g.sus, SNEAK.levels[1] + 5); }
    return { type: 'hide', on: true, spot: best };
  }
  nearHide() { const p = this.player; return !p.hidden && this.map.hides.some(h => Math.hypot(h.x - p.x, h.z - p.z) < SNEAK.tools.hideR); }
  // the guard within reach whose back is turned (or null)
  koTarget() {
    const p = this.player, T = SNEAK.tools;
    let best = null, bd = T.koR;
    for (const g of this.guards) {
      if (g.down) continue;
      const d = Math.hypot(g.x - p.x, g.z - p.z);
      if (d < bd && Math.abs(angDiff(Math.atan2(p.x - g.x, p.z - g.z), g.heading)) > T.koBack && g.sus < SNEAK.levels[1] && !this.alarm) { best = g; bd = d; }
    }
    return best;
  }
  tryKnockOut() {
    const p = this.player, T = SNEAK.tools;
    if (this.over || this.caught || p.hidden) return { type: 'fail', why: 'busy' };
    const g = this.koTarget();
    if (!g) {
      const near = this.guards.some(q => !q.down && Math.hypot(q.x - p.x, q.z - p.z) < T.koR);
      return { type: 'fail', why: near ? 'facing' : 'noone' };
    }
    g.down = true; g.ko = true; g.state = 'down'; g.sus = 0; g.lure = null; this.stats.kos++;
    g.torch = false;
    // a witness or a guard close enough to hear the blow
    for (const q of this.guards) {
      if (q.down) continue;
      const d = Math.hypot(q.x - p.x, q.z - p.z);
      if (q.see > 0 && q._cone) { q.sus = Math.max(q.sus, SNEAK.levels[2] + 5); q.lastSeen = { x: p.x, z: p.z }; }
      else if (d < T.koNoise) { q.sus = Math.max(q.sus, SNEAK.levels[1] + 2); q.lastSeen = { x: g.x, z: g.z }; }
      if (q.leader === g) { q.leader = null; q.state = 'patrol'; q.path = null; }
    }
    return { type: 'ko', guard: g };
  }

  step(dt) {
    const ev = [];
    if (this.over || this.caught) return ev;
    this.time += dt;
    const m = this.map, p = this.player, inp = this.input, S = SNEAK;
    // ---- captain ----
    const il = Math.hypot(inp.x, inp.z);
    if (p.hidden && il > 0.1) { p.hidden = null; ev.push({ type: 'hide', on: false }); }
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
    // stones in flight
    this.stoneCd = Math.max(0, this.stoneCd - dt);
    for (const f of this.flying) { f.t += dt; if (f.t >= f.dur && !f.done) { f.done = true; ev.push(this._land(f)); } }
    this.flying = this.flying.filter(f => !f.done);
    this._expose();
    // ---- guards ----
    const noiseR = p.run ? S.noise.run : p.picking ? S.noise.lock : 0, noiseRate = p.run ? S.noise.runRate : S.noise.lockRate;
    let seenAny = false, maxSus = 0;
    for (const g of this.guards) {
      if (g.down) continue;
      const f = this.canSee(g);
      g.see = f;
      if (f > 0) {
        seenAny = true;
        const rate = S.seeRate * f * (g._cone ? this.exposure.rate : 1) * (p.run ? S.runSee : 1) * S.disguise[Math.max(0, Math.min(2, this.disguise))] * (this.alarm ? 3 : 1);
        g.sus = Math.min(100, g.sus + rate * dt);
        if (g._cone || g.sus >= S.levels[0]) g.lastSeen = { x: p.x, z: p.z };
        if (g._cone) g.lure = null;
        if (this.alarm) this.lastKnown = { x: p.x, z: p.z };
      } else {
        const d = Math.hypot(p.x - g.x, p.z - g.z);
        if (noiseR && d < noiseR) {   // heard: turns round, comes closer
          if (g.sus < S.noise.cap) g.sus = Math.min(S.noise.cap, g.sus + noiseRate * (1 - d / noiseR * 0.5) * dt);
          g.lastSeen = { x: p.x, z: p.z }; this.stats.noise += dt;
        } else if (!this.alarm && g.state !== 'investigate' && g.state !== 'chase') g.sus = Math.max(0, g.sus - S.decay * dt);   // a guard on his way to check keeps his doubts
      }
      // a knocked-out comrade in sight: the alarm
      for (const b of this.guards) {
        if (!b.down || !b.ko || b.found) continue;
        const bx = b.x - g.x, bz = b.z - g.z, bd = Math.hypot(bx, bz);
        if (bd < S.tools.bodySight && (bd < S.view.near * 1.5 || Math.abs(angDiff(Math.atan2(bx, bz), g.heading)) < S.view.half * 1.2) && lineOfSight(m, g.x, g.z, b.x, b.z)) {
          b.bodyT += dt;
          if (b.bodyT > S.tools.bodyTime) { b.found = true; ev.push({ type: 'body', guard: g, body: b }, ...this.raiseAlarm(b)); }
        }
      }
      if (g.sus >= 100 && !this.alarm) ev.push(...this.raiseAlarm());
      maxSus = Math.max(maxSus, g.sus);
      this._guardMove(g, dt);
      // caught
      const reach = S.catchR + (g.state === 'chase' ? 0.4 : 0);
      if (Math.hypot(p.x - g.x, p.z - g.z) < reach && (p.hidden ? f > 0 : (g.sus >= S.levels[1] || this.alarm || (f > 0 && g._cone)))) {
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
    // ---- objective ----
    // (with the alarm raised the doors stay barred and the longboat is watched: lose the guards first)
    if (!this.caught) for (const goal of m.goals) if (Math.hypot(p.x - goal.x, p.z - goal.z) < S.goalR) {
      if (this.alarm) { if (!this._barredT || this.time - this._barredT > 4) { this._barredT = this.time; ev.push({ type: 'barred', goal }); } break; }
      this.over = true; this.result = { outcome: 'success', goal: goal.id, time: this.time, alarms: this.stats.alarms };
      ev.push({ type: 'goal', goal }); break;
    }
    return ev;
  }

  _guardMove(g, dt) {
    const G = SNEAK.guards, L = SNEAK.levels, m = this.map;
    let target = null, speed = G.walk;
    const prev = g.state;
    if (g.leader?.down) g.leader = null;
    if (this.alarm) { g.state = 'chase'; target = g.see > 0 ? this.player : (this.lastKnown || g.lastSeen); speed = G.chase; }
    else if (g.sus >= L[2] && g.lastSeen) { g.state = 'chase'; target = g.see > 0 ? this.player : g.lastSeen; speed = G.chase * 0.9; }
    else if (g.sus >= L[1] && g.lastSeen) { g.state = 'investigate'; target = g.lastSeen; speed = G.investigate; }
    else if (g.sus >= L[0] && g.lastSeen) { g.state = 'look'; }
    else if (g.lure) { g.state = 'lured'; target = g.lure; speed = G.investigate; }
    else g.state = g.post ? 'post' : g.leader ? 'follow' : 'patrol';
    if (g.state !== prev) { g.path = null; g.look = 0; }
    if (g.state === 'look') { this._turn(g, Math.atan2(g.lastSeen.x - g.x, g.lastSeen.z - g.z), dt); return; }
    if (g.state === 'post') {
      const ps = g.post;
      if (Math.hypot(ps.x - g.x, ps.z - g.z) > 0.5) {
        if (!g.path) g.path = findPath(m, g.x, g.z, ps.x, ps.z) || [];
        if (!g.path.length) { g.x = ps.x; g.z = ps.z; return; }
      } else {
        // head sweep: stares ahead a while, then looks to one side, then the other
        g.look += dt; g.path = null;
        const ph = (g.look / ps.period + g.phase) % 1, P = SNEAK.post;
        const s = ph < P.pause ? 0 : Math.sin((ph - P.pause) / (1 - P.pause) * Math.PI * 2);
        this._turn(g, ps.h + s * P.sweep, dt);
        return;
      }
    } else if (g.state === 'follow') {
      const ld = g.leader, sx = Math.sin(ld.heading), sz = Math.cos(ld.heading);
      let ox = ld.x - sx * 1.8 + sz * 0.7, oz = ld.z - sz * 1.8 - sx * 0.7;
      if (blocked(m, ox, oz)) { ox = ld.x - sx * 1.6; oz = ld.z - sz * 1.6; }
      const dx = ox - g.x, dz = oz - g.z, d = Math.hypot(dx, dz);
      if (d > 6 || !lineOfSight(m, g.x, g.z, ox, oz)) {   // fell behind: walks back to his partner
        g.repath = (g.repath || 0) - dt;
        if (!g.path || g.repath <= 0) { g.repath = 1; g.path = findPath(m, g.x, g.z, ld.x, ld.z) || []; }
        if (!g.path.length) return;
        speed = G.walk * 1.4;
      } else {
        g.path = null;
        // the partner halts: the follower watches the rear
        if (ld.wait > 0 && ld.state === 'patrol') this._turn(g, ld.heading + Math.PI + Math.sin(this.time * 0.9 + g.phase) * 0.9, dt);
        else if (d > 0.35) this._turn(g, Math.atan2(dx, dz), dt * 1.5);
        if (d > 0.35) { const sp = Math.min(d, G.walk * 1.3 * dt); g.x += dx / d * sp; g.z += dz / d * sp; }
        return;
      }
    } else if (g.state === 'patrol') {
      if (g.wait > 0) { g.wait -= dt; g.look += dt; this._turn(g, g.baseH + Math.sin(g.look * 1.3 + g.phase) * 0.9, dt); return; }
      const wp = g.route[g.ri];
      if (!g.path) g.path = findPath(m, g.x, g.z, wp.x, wp.z) || [];
      if (!g.path.length) { g.ri = (g.ri + 1) % g.route.length; g.wait = 1.2 + this.r() * 2.4; g.look = 0; g.baseH = g.heading; g.path = null; return; }
    } else if (target) {
      // path recomputed when the target moves (every ~0.6 s)
      g.repath = (g.repath || 0) - dt;
      if (!g.path || g.repath <= 0) { g.repath = 0.6; g.path = (g.see > 0 && lineOfSight(m, g.x, g.z, target.x, target.z)) ? [{ x: target.x, z: target.z }] : (findPath(m, g.x, g.z, target.x, target.z) || []); }
      if (!g.path.length) {   // reached the point: looks around, calms down slowly (a lure: searches ahead, gives up after a while)
        g.look += dt;
        if (g.state === 'lured') {
          g.lureH ??= g.heading;
          this._turn(g, g.lureH + Math.sin(g.look * 1.4) * 0.7, dt);
          if (g.look > SNEAK.tools.lureLook) { g.lure = null; g.lureH = null; g.path = null; }
        } else {
          this._turn(g, g.heading + 1.5, dt);
          if (!this.alarm && g.see <= 0) g.sus = Math.max(0, g.sus - SNEAK.decay * 0.8 * dt);
        }
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
