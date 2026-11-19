// Frame hitches when gameplay spawns ships (Playwright, real game, render loop running).
// Ships of the traffic are built a little per frame (shipModel.js prepareShipGeometry / stepShipBuilds) and spawned
// once their geometry is ready. This tool drives the other spawn paths the way the game does, each with ships
// whose geometry is not built yet, and measures the longest frame around the spawn:
//   escort   an escort commission accepted (career._spawnEscort), and found missing after a load (career._updateEscort)
//   quarry   a wanted captain puts to sea when the player is inside his zone (career._updateQuarry)
//   convoy   an announced convoy within range (living._updateConvoys → combat.spawnConvoy, 2–3 ships)
//   hunter   a pirate hunter due (living._updateHunters)
//   lord     a Top 10 captain near his lair (pirateLords.update)
//   avenger  the captain who comes for a dug-up treasure (pirateLords.spawnAvenger)
//   prologue the prologue's target (prologue.poll)
//   flagship a ship of the squadron becomes the flagship in port (ports.fleetFlagship → game.spawnShip)
//   traffic  the traffic top-up, for reference (already progressive)
// The render loop is stopped and the test steps the game (game.step(1/30) per tick, a rendered frame every 10th
// tick and right after a spawn): software rendering presents one or two frames a second, its pace says nothing.
// Per path: ticks waited for the ship, the longest spawn call (combat.spawnAI / spawnConvoy / game.spawnShip, ms),
// the longest tick (JS time of step + render) from the trigger to 40 ticks after the spawn, and the median tick.
// A spawn call made outside a tick (escort accepted) counts as a tick of its own.
// Then the geometry cache: bound respected, geometry of live ships kept, evicted geometry disposed, a hit for a
// ship type used again.
// Usage: node tools/test-spawn-hitch.mjs [--q "quality=low"] [--json out.json] [--limit ms]   (dev server at TOF_URL)
// Exit code 1 when a path never spawns, on a console error, when a spawn call or the excess of the longest frame
// over the median passes --limit (default 60 ms; 0 = report only), or when a cache check fails.
import { chromium } from 'playwright';
import fs from 'node:fs';
import { BASE, launchOpts } from './_env.mjs';

const arg = k => process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : null;
const Q = arg('--q') ?? 'quality=low';
const LIMIT = +(arg('--limit') ?? 60);

const browser = await chromium.launch(launchOpts());
const page = await (await browser.newContext({ viewport: { width: 640, height: 360 }, deviceScaleFactor: 1 })).newPage();
const errors = [];
page.on('console', m => { if (m.type() === 'error' && !/GPU stall due to ReadPixels/.test(m.text())) errors.push(`[console] ${m.text()}`); });
page.on('pageerror', e => errors.push('[pageerror] ' + e.message));
const results = [];
const check = (name, ok, info = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); };
// a page.evaluate that never returns = the page's main thread is stuck: say where (debugger pause) and give up
const cdp = await page.context().newCDPSession(page);
await cdp.send('Debugger.enable');
async function ev(fn, a) {
  let timer;
  const stuck = new Promise(r => { timer = setTimeout(r, 180000, 'stuck'); });
  const r = await Promise.race([page.evaluate(fn, a), stuck]);
  clearTimeout(timer);
  if (r !== 'stuck') return r;
  const paused = new Promise(r => cdp.once('Debugger.paused', r));
  cdp.send('Debugger.pause').catch(() => {});
  const where = await Promise.race([paused, new Promise(r => setTimeout(r, 10000, null))]);
  console.log('PAGE STUCK' + (where ? ' in\n' + where.callFrames.slice(0, 8).map(f => `  ${f.functionName || '(anonymous)'} ${f.url.replace(/^.*\/src\//, 'src/').replace(/\?.*$/, '')}:${f.location.lineNumber + 1}`).join('\n') : ' (no stack)'));
  await browser.close().catch(() => {});
  process.exit(1);
}

await page.goto(`${BASE}?${Q}`, { waitUntil: 'load', timeout: 240000 });
await page.waitForFunction(() => window.__ready || window.__error, null, { timeout: 300000, polling: 250 });
{ const err = await ev(() => window.__error); if (err) { console.log('STARTUP ERROR', err); process.exit(1); } }
await ev(() => { const m = window.__game.hud.menu; m._go('captain'); m._start(); });
await page.waitForFunction(() => window.__game.mode === 'sail', null, { timeout: 60000 });
await page.waitForTimeout(1500);

// ---------------------------------------------------------------- setup: quiet sea, open water outside guarded waters
const setup = await ev(async () => {
  const g = window.__game, c = g.combat, s = g.state, isl = g.islands, zs = g.seaZones;
  g.hud.hints?.prologue?.skip?.();
  c.setTrafficTarget(0); c._trafficPlan = null;
  for (const sh of [...g.ships]) if (sh !== g.player) g.removeShip(sh);
  for (const e of Object.values(s.lords || {})) e.next = 1e9;        // the Top 10 stay ashore until their turn
  s.convoys.length = 0;
  for (const m of s.missions) if (m.status === 'active') m.status = 'done';
  // a spot of open sea, tier II or III, 1.6 to 2.4 km off a port (lair and convoy route of the test)
  let spot = null;
  for (const port of isl.ports) {
    for (let k = 0; k < 24 && !spot; k++) {
      const a = k / 24 * Math.PI * 2, d = 1600 + (k % 3) * 400, x = port.harborPoint.x + Math.cos(a) * d, z = port.harborPoint.z + Math.sin(a) * d;
      if (Math.abs(x) > 7000 || Math.abs(z) > 7000 || isl.isLand(x, z, 500) || (zs && zs.tierAt(x, z) < 2)) continue;
      if (zs && zs.tierAt(port.harborPoint.x, port.harborPoint.z) < 2) continue;
      spot = { x, z, port: port.id };
    }
    if (spot) break;
  }
  if (!spot) return { error: 'no open water outside guarded waters' };
  const p = g.player;
  p.position.x = spot.x; p.position.z = spot.z; p.speed = 0; p.sailSetting = 0;
  if (p.controller) p.controller.update = () => {};                  // hove to for the whole test
  // The render loop is stopped (software rendering shows one or two frames a second: nothing to measure there) and
  // the test steps the game itself: every tick is a game.step(1/30), every 10th tick (and the tick that follows a
  // spawn) also renders the frame and lets the browser present it. A tick's time is the JS time of step + render.
  g.renderer.setAnimationLoop(null);
  const M = window.__M = { frames: [], renders: [], spawns: [], on: false, n: 0, renderNext: false };
  let depth = 0;
  const wrap = (o, k) => { const f = o[k].bind(o); o[k] = (...a) => { const t = performance.now(); depth++; try { return f(...a); } finally { if (!--depth) { M.renderNext = true; if (M.on) M.spawns.push({ k, ms: performance.now() - t, at: M.frames.length }); } } }; };
  wrap(c, 'spawnAI'); wrap(c, 'spawnConvoy'); wrap(g, 'spawnShip');
  window.__frames = async n => {
    for (let i = 0; i < n; i++) {
      const render = M.renderNext || ++M.n % 10 === 0; M.renderNext = false;
      const t = performance.now();
      g.step(1 / 30);
      let r = 0;
      if (render) { const t1 = performance.now(); if (g.renderOverride) g.renderOverride(1 / 30); else g.post.render(1 / 30); r = performance.now() - t1; }
      const ms = performance.now() - t;
      if (M.on) { M.frames.push(ms); if (render) M.renders.push(r); }
      if (render) await new Promise(res => requestAnimationFrame(res)); else if (i % 5 === 4) await new Promise(res => setTimeout(res, 0));
    }
  };
  return { spot, cacheApi: !!c.shipCache, tier: zs?.tierAt(spot.x, spot.z) };
});
if (setup.error) { console.log('SETUP ERROR', setup.error); process.exit(1); }
console.log(`player hove to off ${setup.spot.port} (tier ${setup.tier}); cache API ${setup.cacheApi ? 'present' : 'absent (cold builds not guaranteed)'}`);
await ev(() => window.__frames(150));   // terrain and towns around the new position

// ---------------------------------------------------------------- one path: trigger, wait for the ship, measure
// trigger / found / cleanup are evaluated in the page; `found` returns true once the ship(s) exist
async function run(name, { trigger, found, cleanup, arg: a = {}, timeout = 60000 }) {
  await ev(async () => {
    const g = window.__game;
    for (const sh of [...g.ships]) if (sh !== g.player) g.removeShip(sh);
    g.combat.shipCache?.({ trim: 0 });           // every geometry no live ship uses is dropped: the spawn starts cold
    await window.__frames(20);
    const M = window.__M; M.frames.length = 0; M.spawns.length = 0; M.on = true;
    await window.__frames(20);
  });
  const r = await ev(async ({ trigger, found, timeout }) => {
    const g = window.__game, M = window.__M, t0 = performance.now(), f0 = M.frames.length;
    const call = (src, x) => (0, eval)(`(${src})`)(g, x);
    const a = window.__arg;
    call(trigger, a);
    let ok = call(found, a);
    while (!ok && performance.now() - t0 < timeout) { await window.__frames(1); ok = call(found, a); }
    const fs = M.frames.length;
    await window.__frames(40);
    M.on = false;
    const win = M.frames.slice(f0), sorted = [...M.frames].sort((x, y) => x - y);
    const spawns = M.spawns.filter(s => s.at >= f0);
    const spawnMs = spawns.length ? Math.max(...spawns.map(s => s.ms)) : 0;
    return { ok: !!ok, waitFrames: fs - f0, waitMs: Math.round(performance.now() - t0), max: Math.max(spawnMs, ...win), median: sorted[sorted.length >> 1],
      spawnMs, spawnCalls: spawns.length, ships: g.ships.filter(s => s !== g.player).map(s => `${s.type}|${s.faction}`) };
  }, { trigger: trigger.toString(), found: found.toString(), timeout });
  if (cleanup) await ev(({ cleanup }) => (0, eval)(`(${cleanup})`)(window.__game, window.__arg), { cleanup: cleanup.toString() });
  return { name, ...r };
}
const setArg = a => ev(a => { window.__arg = a; }, a);

const rows = [];
async function path(name, a, spec) {
  await setArg({ ...a, port: setup.spot.port });
  const r = await run(name, spec);
  rows.push(r);
  const over = r.max - r.median;
  console.log(`${name.padEnd(22)} ${r.ok ? '' : 'NO SPAWN  '}wait ${String(r.waitFrames).padStart(4)} fr · spawn call ${r.spawnMs.toFixed(1).padStart(6)} ms · longest tick ${r.max.toFixed(1).padStart(6)} ms (median ${r.median.toFixed(1)}, +${over.toFixed(1)})  ${r.ships.join(', ')}`);
  return r;
}


// --- escort, accepted in the governor's office: the commission is offered (offerMissions), read, then accepted
for (const nation of ['dutch', 'french']) {
  await path(`escort accept ${nation}`, { tag: 'esc' + nation, nation }, {
    trigger: (g, a) => {
      const day = g.state.date.year * 372 + g.state.date.month * 31 + g.state.date.day, port = g.islands.ports.find(p => p.id === a.port);
      const m = { id: 'hitch_' + a.tag, kind: 'escort', status: 'active', progress: 0, nation: a.nation, from: port.id, fromName: port.name, to: port.id, toName: port.name, title: 'Hitch test', deadline: day + 200, reward: 1 };
      g.state.missions.push(m); g.career._spawnEscort(m);
    },
    found: g => !!g.career.escortShip && g.ships.includes(g.career.escortShip),
    cleanup: (g, a) => { g.state.missions = g.state.missions.filter(m => m.id !== 'hitch_' + a.tag); g.career.escortShip = null; },
  });
}
// --- escort missing after a load: the mission is active, the ship is not there
await path('escort after load', { tag: 'escload', nation: 'spanish' }, {
  trigger: (g, a) => {
    const day = g.state.date.year * 372 + g.state.date.month * 31 + g.state.date.day, port = g.islands.ports.find(p => p.id === a.port);
    g.state.missions.push({ id: 'hitch_' + a.tag, kind: 'escort', status: 'active', progress: 0, nation: a.nation, from: port.id, fromName: port.name, to: port.id, toName: port.name, title: 'Hitch test', deadline: day + 200, reward: 1 });
  },
  found: g => !!g.career.escortShip && g.ships.includes(g.career.escortShip),
  cleanup: (g, a) => { g.state.missions = g.state.missions.filter(m => m.id !== 'hitch_' + a.tag); g.career.escortShip = null; },
});
// --- wanted captain: the player is already inside the zone (map travel, load): no approach to build her on
for (const type of ['corvette', 'topschooner']) {
  await path(`quarry ${type}`, { tag: 'q' + type, type }, {
    trigger: (g, a) => {
      const day = g.state.date.year * 372 + g.state.date.month * 31 + g.state.date.day, p = g.player.position;
      g.state.missions.push({ id: 'hitch_' + a.tag, kind: 'quarry', sub: 'pirate', status: 'active', progress: 0, nation: 'english', title: 'Hitch test', deadline: day + 200, reward: 1,
        zone: { x: p.x, z: p.z, r: 900 }, type: a.type, ship: 'Hitch', captain: 'Test', nick: 'the Probe', place: 'here' });
    },
    found: (g, a) => g.ships.some(s => s.missionId === 'hitch_' + a.tag),
    cleanup: (g, a) => { g.state.missions = g.state.missions.filter(m => m.id !== 'hitch_' + a.tag); },
  });
}
// --- announced convoys: position of the day 1.5 km from the player along a route from the port nearby
for (const [faction, treasure] of [['spanish', true], ['french', false]]) {
  await path(`convoy ${faction}${treasure ? ' treasure' : ''}`, { tag: 'cv' + faction, faction, treasure }, {
    trigger: (g, a) => {
      const L = g.living, now = L.today, p = g.player.position, from = g.islands.ports.find(x => x.id === a.port);
      // the route leaves the port and passes the player's side: destination = the port most nearly beyond the player
      let to = null, best = -2;
      for (const q of g.islands.ports) {
        if (q === from) continue;
        const ax = p.x - from.harborPoint.x, az = p.z - from.harborPoint.z, bx = q.harborPoint.x - from.harborPoint.x, bz = q.harborPoint.z - from.harborPoint.z;
        const cos = (ax * bx + az * bz) / (Math.hypot(ax, az) * Math.hypot(bx, bz));
        if (cos > best) { best = cos; to = q; }
      }
      const len = Math.hypot(to.harborPoint.x - from.harborPoint.x, to.harborPoint.z - from.harborPoint.z);
      const want = Math.hypot(p.x - from.harborPoint.x, p.z - from.harborPoint.z) + 1500;   // 1.5 km further along than the player
      const frac = L._dayFrac(), days = (1 + frac) * len / Math.min(len * 0.9, want);
      g.state.convoys.push({ id: 'hitch_' + a.tag, faction: a.faction, from: from.id, to: to.id, treasure: a.treasure, depart: now - 1, arrive: now - 1 + days, status: 'planned', known: false });
      L._t = 0;
    },
    found: (g, a) => g.ships.some(s => s.convoyId === 'hitch_' + a.tag),
    cleanup: g => { g.state.convoys.length = 0; g.living.convoyShips.clear(); },
  });
}
// --- pirate hunters: infamy past the threshold, the hunter due now
for (const [nation, type] of [['english', 'heavyfrigate'], ['dutch', 'raider']]) {
  await path(`hunter ${nation}`, { nation, type }, {
    trigger: (g, a) => { g.state.reputation[a.nation] = -90; g.living._hunterPicks[a.nation] = a.type; g.state.hunters[a.nation] = g.state.living.seaT; },
    found: (g, a) => g.ships.some(s => s.hunterOf === a.nation),
    cleanup: (g, a) => { g.state.reputation[a.nation] = 0; delete g.state.hunters[a.nation]; },
  });
}
// --- Top 10 captains: the lair is the port nearby, the player already within range
for (const id of ['malbec', 'skarre']) {
  await path(`lord ${id}`, { id }, {
    trigger: (g, a) => { const e = g.state.lords[a.id]; e._lair = e.lair; e.lair = 'port:' + a.port; e.next = 0; g.lords._t = 0; },
    found: (g, a) => g.ships.some(s => s.lordId === a.id),
    cleanup: (g, a) => { const e = g.state.lords[a.id]; e.lair = e._lair; delete e._lair; e.next = 1e9; },
  });
}
// --- the avenger of a dug-up treasure (fortune.js calls spawnAvenger after a delay)
await path('avenger', {}, {
  trigger: g => { g.lords.spawnAvenger(); g.lords._t = 0; },
  found: g => g.ships.some(s => s.role === 'hunter' && s.faction === 'pirate'),
});
// --- prologue target: started, sails set and helm turned at once
await path('prologue target', {}, {
  trigger: g => { const h = g.hud.hints; h.prologue.start(); const o = h.goal(); o.sailed = true; o.turned = 99; },
  found: g => !!g.hud.hints.prologue.target,
  cleanup: g => g.hud.hints.prologue.skip(),
});
// --- a ship of the squadron becomes the flagship, in port (game.spawnShip; her model is asked for on entering port)
await path('flagship swap in port', { type: 'lightfrigate' }, {
  trigger: (g, a) => {
    g.state.fleet = [{ type: a.type, name: 'Hitch Prize', hull: 1, sails: 1, from: 'pirate', own: true, crew: 20, upgrades: { ...(g.state.upgrades || {}) }, cargo: {} }];
    g.ports.enter(g.islands.ports.find(p => p.id === a.port), undefined, { fate: 'disguise' });
  },
  found: (g, a) => {
    if (g.player.type === a.type) return true;
    if (g.combat.shipCache && !g.combat.shipReady(a.type, g.player.faction)) return false;   // the player is still reading the harbour screen
    g.ports.fleetFlagship(0);
    return g.player.type === a.type;
  },
  cleanup: g => { g.ports.leave(); if (g.player.controller) g.player.controller.update = () => {}; g.player.speed = 0; },
});
// --- traffic top-up, for reference
await path('traffic (reference)', {}, {
  trigger: g => { g.combat.setTrafficTarget(1); g.combat._trafficT = 0; },
  found: g => g.ships.length > 1,
  cleanup: g => { g.combat.setTrafficTarget(0); g.combat._trafficPlan = null; },
  timeout: 90000,
});

console.log('');
check('every path spawns its ship', rows.every(r => r.ok), rows.filter(r => !r.ok).map(r => r.name).join(', '));
const worst = rows.filter(r => !/reference/.test(r.name));
const maxSpawn = Math.max(...worst.map(r => r.spawnMs)), maxOver = Math.max(...worst.map(r => r.max - r.median));
const wSpawn = worst.find(r => r.spawnMs === maxSpawn), wOver = worst.find(r => r.max - r.median === maxOver);
if (LIMIT > 0) {
  check(`no spawn call above ${LIMIT} ms`, maxSpawn <= LIMIT, `worst ${maxSpawn.toFixed(1)} ms (${wSpawn.name})`);
  check(`no tick more than ${LIMIT} ms above the median around a spawn`, maxOver <= LIMIT, `worst +${maxOver.toFixed(1)} ms (${wOver.name})`);
} else console.log(`worst spawn call ${maxSpawn.toFixed(1)} ms (${wSpawn.name}); worst tick +${maxOver.toFixed(1)} ms over the median (${wOver.name})`);

// ---------------------------------------------------------------- geometry cache
if (setup.cacheApi) {
  const c = await ev(async () => {
    const g = window.__game, cb = g.combat;
    for (const sh of [...g.ships]) if (sh !== g.player) g.removeShip(sh);
    const s0 = cb.shipCache({ trim: 0 });
    const types = Object.keys(s0.types), nations = ['english', 'spanish', 'french', 'dutch', 'pirate'];
    // more ship kinds than the bound: all asked ahead of time, built a little per step (no rendering here)
    const want = []; for (const t of types) for (const n of nations) if (want.length < s0.max + 12 && !s0.keys.includes(`${t}|${n}`)) want.push([t, n]);
    for (const [t, n] of want) cb.shipReady(t, n);
    let over = 0, frames = 0, long = 0;
    while (cb.shipCache().pending.length && frames < 60000) {
      const t = performance.now(); g.step(1 / 30); long = Math.max(long, performance.now() - t);
      const s = cb.shipCache(); over = Math.max(over, s.idle - s.max);
      if (++frames % 40 === 0) await new Promise(r => setTimeout(r, 0));
    }
    const s1 = cb.shipCache();
    // a live ship keeps her geometry through a full trim; released when she is gone
    const p = g.player.position;
    const sh = cb.spawnAI({ type: 'galleon', faction: 'dutch', role: 'merchant', x: p.x + 2500, z: p.z, heading: 0, name: 'Cache' });
    const geo = sh.model.group.children.find(o => o.isMesh).geometry; let disposed = 0; geo.addEventListener('dispose', () => disposed++);
    const s2 = cb.shipCache({ trim: 0 });
    const kept = s2.keys.includes('galleon|dutch') && disposed === 0;
    await window.__frames(3);
    g.removeShip(sh);
    const s3 = cb.shipCache({ trim: 0 });
    const freed = !s3.keys.includes('galleon|dutch') && disposed === 1;
    // used again: built once, then a hit
    const h0 = cb.shipCache();
    const a = cb.spawnAI({ type: 'galleon', faction: 'dutch', role: 'merchant', x: p.x + 2500, z: p.z, heading: 0, name: 'Cache' });
    const b = cb.spawnAI({ type: 'galleon', faction: 'dutch', role: 'merchant', x: p.x + 2700, z: p.z, heading: 0, name: 'Cache 2' });
    const h1 = cb.shipCache();
    g.removeShip(a); g.removeShip(b);
    const h2 = cb.shipCache();
    return { max: s0.max, pinned0: s0.pinned, size0: s0.size, asked: want.length, over, frames, long, size1: s1.size, idle1: s1.idle, pinned1: s1.pinned, mb: s1.bytes / 1048576, evicted: s1.evictions - s0.evictions, kept, freed,
      builds: h1.builds - h0.builds, hits: h1.hits - h0.hits, stays: h2.keys.includes('galleon|dutch'), pinnedEnd: h2.pinned, sizeEnd: h2.size };
  });
  check(`cache: never more than its bound (${c.max}) of unused geometries while ${c.asked} more ship kinds are built`, c.over <= 0 && c.idle1 === c.max && c.evicted === c.asked + c.size0 - c.pinned0 - c.max,
    `size ${c.size0} → ${c.size1} (${c.pinned1} in use), ${c.evicted} evicted, ${c.mb.toFixed(1)} MB, ${c.frames} steps, longest ${c.long.toFixed(1)} ms`);
  check('cache: the geometry of a live ship survives a full trim, undisposed', c.kept);
  check('cache: once the ship is gone a trim drops and disposes it', c.freed);
  check('cache: a type used again is built once, then hit', c.builds === 1 && c.hits === 1 && c.stays, `${c.builds} build, ${c.hits} hit`);
  console.log(`cache at the end: ${c.sizeEnd} entries, ${c.pinnedEnd} in use, bound ${c.max}`);
} else console.log('cache checks skipped (no combat.shipCache)');

check('no console error', errors.length === 0, errors.slice(0, 3).join(' | '));
if (arg('--json')) fs.writeFileSync(arg('--json'), JSON.stringify({ rows, results }, null, 1));
await browser.close();
const failed = results.filter(r => !r.ok);
console.log(failed.length ? `\n${failed.length} FAILED` : '\nALL PASS');
process.exit(failed.length ? 1 : 0);
