// Scripted players of the sneaking mode, used by tools/test-sneak.mjs to measure the balance.
//   const b = straightBot(sim) | carefulBot(sim); each tick: b(); sim.step(dt)   (bots set sim.input and use the tools)
//   straightBot: the shortest path to the first objective, runs once spotted.
//   carefulBot: routes through the dark away from the guards, waits for gaps, hides, lures sentries with stones and
//   knocks out the guards that turn their backs on it.
import { findPath, lineOfSight, cellIndex, angDiff, blocked } from '../src/game/sneak/sim.js';
import { SNEAK } from '../src/data/sneak.js';

const DT = 1 / 20;

// goes to the grate and picks it (escape), then returns false; true while busy with it
function gateStep(sim, st) {
  const p = sim.player, g = sim.map.gate;
  if (sim.map.gate.open) return false;
  if (Math.hypot(p.x - g.x, p.z - (g.z + sim.map.cell * 0.5)) > 2.6) { st.path ||= findPath(sim.map, p.x, p.z, g.x, g.z + sim.map.cell * 0.9) || []; follow(sim, st.path, false); }
  else { st.path = null; sim.input = { x: 0, z: 0, run: false, act: true }; }
  return true;
}
function follow(sim, path, run) {
  const p = sim.player; while (path.length && Math.hypot(path[0].x - p.x, path[0].z - p.z) < 0.6) path.shift();
  const n = path[0]; sim.input = n ? { x: n.x - p.x, z: n.z - p.z, run, act: false } : { x: 0, z: 0, run: false, act: false };
}
// straight-line bot: the shortest path, runs once spotted
export function straightBot(sim) {
  const st = {}; let path = null;
  return () => {
    if (gateStep(sim, st)) return;
    const p = sim.player, gl = sim.goals[0];
    if (!path || !path.length) path = findPath(sim.map, p.x, p.z, gl.x, gl.z) || [];
    const danger = sim.guards.some(g => !g.down && g.sus > 30 && g.see > 0);
    follow(sim, path, danger || sim.alarm);
  };
}
// careful bot: routes through the dark away from the guards, waits for gaps, hides, lures sentries with stones and
// knocks out the guards that turn their backs on it
export function carefulBot(sim) {
  const V = SNEAK.view, Lg = SNEAK.light, m = sim.map, st = {};
  let path = null, replan = 0, waitT = 0, hideT = 0, goal = null;
  const threat = (g, x, z, margin = 1) => {
    if (g.down) return false;
    const dx = x - g.x, dz = z - g.z, d = Math.hypot(dx, dz);
    if (d < 3.2 * margin) return true;
    const sh = m.shade[cellIndex(m, x, z)], L = sim.lightAt(x, z), v0 = sh ? Lg.dark : Lg.moon;
    const range = V.range * (v0 + (Lg.lit - v0) * L) * 1.2 * margin + 2;
    if (d > range + 8) return false;
    if (!lineOfSight(m, g.x, g.z, x, z)) return false;
    return d < range && Math.abs(angDiff(Math.atan2(dx, dz), g.heading)) < V.half + 0.45 * margin;
  };
  // a sentry at his post sweeps his head: where will he look in t s, and will he see us walking down the path?
  const sweepAt = (g, t) => {
    const ps = g.post, P = SNEAK.post, ph = ((g.look + t) / ps.period + g.phase) % 1;
    return ps.h + (ph < P.pause ? 0 : Math.sin((ph - P.pause) / (1 - P.pause) * Math.PI * 2)) * P.sweep;
  };
  const postThreat = (g, pts) => pts.some(([t, x, z]) => {
    const dx = x - g.x, dz = z - g.z, d = Math.hypot(dx, dz);
    if (d < 3.5) return true;
    const sh = m.shade[cellIndex(m, x, z)], L = sim.lightAt(x, z), v0 = sh ? Lg.dark : Lg.moon;
    return d < V.range * (v0 + (Lg.lit - v0) * L) * 1.15 + 1.5 && Math.abs(angDiff(Math.atan2(dx, dz), sweepAt(g, t))) < V.half + 0.3 && lineOfSight(m, g.x, g.z, x, z);
  });
  const ahead = (path, T) => {
    const pts = []; let x = sim.player.x, z = sim.player.z, q = 0;
    for (let t = 0; t <= T; t += 0.25) {
      pts.push([t, x, z]);
      if (q >= path.length && t > 0) break;   // arrived
      let step = SNEAK.walk * 0.25;
      while (step > 0 && q < path.length) { const dx = path[q].x - x, dz = path[q].z - z, d = Math.hypot(dx, dz); if (d <= step) { x = path[q].x; z = path[q].z; step -= d; q++; } else { x += dx / d * step; z += dz / d * step; step = 0; } }
    }
    return pts;
  };
  // a stone that draws the blocker away from us and from the objective: within throw, in sight, where he can walk
  const throwAt = (g) => {
    const p = sim.player; let best = null, bs = -1;
    for (let q = 0; q < 16; q++) for (const rr of [5, 8, 11]) {
      const tx = g.x + Math.sin(q / 16 * Math.PI * 2) * rr, tz = g.z + Math.cos(q / 16 * Math.PI * 2) * rr;
      const dp = Math.hypot(tx - p.x, tz - p.z), sc = dp + Math.hypot(tx - goal.x, tz - goal.z);
      if (sc <= bs || blocked(m, tx, tz) || dp > SNEAK.tools.throwMax - 0.5 || dp < 8 || !lineOfSight(m, p.x, p.z, tx, tz) || !findPath(m, g.x, g.z, tx, tz, true)) continue;
      best = [tx, tz]; bs = sc;
    }
    return best;
  };
  const cost = k => {
    const x = (k % m.W + 0.5) * m.cell, z = ((k / m.W | 0) + 0.5) * m.cell;
    let c = m.light[k] * 6 + (m.shade[k] ? 0 : 0.8);
    for (const g of sim.guards) if (!g.down) { const d = Math.hypot(g.x - x, g.z - z); if (d < 14) c += (14 - d) * 0.8; }
    return c;
  };
  return () => {
    const p = sim.player;
    goal ||= sim.goals.reduce((a, b) => (Math.hypot(a.x - p.x, a.z - p.z) < Math.hypot(b.x - p.x, b.z - p.z) ? a : b));
    // opportunistic knock-out
    if (!p.hidden && sim.koTarget()) { sim.tryKnockOut(); path = null; }
    const seen = sim.guards.filter(g => !g.down && (threat(g, p.x, p.z, 0.8) || (g.see > 0 && g._cone)));
    if (p.hidden) {
      hideT += DT;
      if (hideT > 2 && !sim.guards.some(g => !g.down && Math.hypot(g.x - p.x, g.z - p.z) < 14 && lineOfSight(m, g.x, g.z, p.x, p.z))) { sim.toggleHide(); path = null; }
      else { sim.input = { x: 0, z: 0, run: false, act: false }; return; }
    }
    if (!sim.map.gate.open) { if (!seen.length || !sim.nearGate) { if (gateStep(sim, st)) return; } }
    replan -= DT;
    if (!path || !path.length || replan <= 0) { replan = 1.5; path = findPath(m, p.x, p.z, goal.x, goal.z, false, cost) || []; }
    while (path.length && Math.hypot(path[0].x - p.x, path[0].z - p.z) < 0.6) path.shift();
    const n = path[0];
    if (!n) { sim.input = { x: 0, z: 0 }; return; }
    const dd = Math.hypot(n.x - p.x, n.z - p.z), ax = p.x + (n.x - p.x) / dd * 2.5, az = p.z + (n.z - p.z) / dd * 2.5;
    const pts = ahead(path, 5);
    const blockers = sim.guards.filter(g => !g.down && (g.state === 'post' ? postThreat(g, pts) : threat(g, ax, az)));
    if (seen.length && (sim.gauge > SNEAK.levels[0] || seen.some(g => Math.hypot(g.x - p.x, g.z - p.z) < 8))) {
      // spotted or about to be: a hiding spot within reach, otherwise step back into the dark
      const h = m.hides.find(q => Math.hypot(q.x - p.x, q.z - p.z) < SNEAK.tools.hideR);
      if (h) { sim.toggleHide(); hideT = 0; sim.input = { x: 0, z: 0 }; return; }
      const g = seen[0]; sim.input = { x: p.x - g.x, z: p.z - g.z, run: sim.gauge > SNEAK.levels[2], act: false }; waitT = 0; return;
    }
    if (blockers.length && !sim.alarm) {
      waitT += DT;
      // a guard blocking the way for a while: a stone beyond him
      const blocker = blockers.find(g => g.state === 'post' || g.state === 'patrol' || g.state === 'follow');
      const tgt = waitT > 4 && blocker && sim.stones > 0 && sim.stoneCd <= 0 && throwAt(blocker);
      if (tgt) { sim.throwStone(tgt[0], tgt[1]); waitT = 0; }
      if (waitT > 14) { path = null; waitT = 0; }
      sim.input = { x: 0, z: 0, run: false, act: false }; return;
    }
    waitT = 0;
    sim.input = { x: n.x - p.x, z: n.z - p.z, run: sim.alarm, act: false };
  };
}
