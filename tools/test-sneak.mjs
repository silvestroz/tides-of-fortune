// Targeted test of sneaking / prison escape: node tools/test-sneak.mjs [--browser] [--shots folder]
// 1. pure simulation (no browser): connected towns, sight (cone, walls, shadow, disguise), noise, levels and
//    alarm, pursuit and capture, lock picking (skeleton key / kit), objective reached by a careful bot in 1–3 min.
// 2. --browser: ?shot=sneak on the dev server (127.0.0.1:5173, started separately or by this script): mode 'sneak',
//    keyboard movement (physical codes), alarm, entering port through the tavern, hostile-port screen, escape
//    from the prison screen, zero console errors; --shots: captures.
import { SneakSim, buildTown, findPath, lineOfSight, C } from '../src/game/sneak/sim.js';
import { SNEAK } from '../src/data/sneak.js';
import { mulberry32 } from '../src/core/rng.js';
import { BASE, PORT, launchOpts } from './_env.mjs';

let fails = 0;
const ok = (c, msg) => { console.log((c ? '  ok   ' : '  FAIL ') + msg); if (!c) fails++; };
const DT = 1 / 20;

console.log('sneak sim tests');
{
  let good = 0;
  for (let s = 1; s <= 16; s++) for (const kind of ['infiltrate', 'escape']) {
    const m = buildTown({ seed: s, kind });
    if (kind === 'escape') m.type[m.gate.j * m.W + m.gate.i] = C.STREET;
    if (m.goals.every(g => findPath(m, m.start.x, m.start.z, g.x, g.z))) good++;
  }
  ok(good === 32, `32 towns: every goal reachable from the start (${good}/32)`);
  const m = buildTown({ seed: 3, kind: 'escape' });
  ok(!findPath(m, m.start.x, m.start.z, m.goals[0].x, m.goals[0].z), 'escape: the prison gate is shut at the start');
  let sh = 0, open = 0; for (let k = 0; k < m.W * m.H; k++) if (m.type[k] === C.STREET || m.type[k] === C.QUAY) { open++; if (m.shade[k]) sh++; }
  ok(sh / open > 0.12 && sh / open < 0.7, `long evening shadows cover ${Math.round(sh / open * 100)} % of the streets`);
}

// controlled scene: a single guard, motionless, the captain at a given distance in front of him
function duo({ d = 10, angle = 0, disguise = 0, shade = false, wall = false, run = false } = {}) {
  const sim = new SneakSim({ seed: 2, kind: 'infiltrate', garrison: 0, disguise });
  const m = sim.map;
  m.type.fill(C.STREET); m.shade.fill(shade ? 1 : 0);
  const g = sim.guards[0]; sim.guards = [g];
  Object.assign(g, { x: 100, z: 60, heading: angle, route: [{ x: 100, z: 60 }, { x: 100, z: 60 }], path: [], wait: 999, baseH: angle, phase: 0, look: 0, sus: 0 });
  g._lockH = angle;
  sim.player.x = 100; sim.player.z = 60 + d;
  if (wall) for (let i = 0; i < m.W; i++) m.type[Math.floor((60 + d / 2) / m.cell) * m.W + i] = C.HOUSE;
  sim.input = { x: 0, z: 0, run, act: false };
  return { sim, g };
}
const timeTo = (sim, lvl, max = 12) => { const t0 = sim.time; while (sim.time - t0 < max) { sim.step(DT); for (const g of sim.guards) { g.heading = g._lockH; g.wait = 999; g.path = []; } if (sim.level >= lvl) return sim.time - t0; } return Infinity; };
{
  const a = duo({ d: 10 }), ta = timeTo(a.sim, 4);
  ok(ta < 4, `in full view at 10 m: alarm in ${ta.toFixed(2)} s`);
  const b = duo({ d: 10, angle: Math.PI });
  ok(timeTo(b.sim, 1, 5) === Infinity, 'behind the guard (walking): never noticed');
  const c = duo({ d: 10, wall: true });
  ok(timeTo(c.sim, 1, 5) === Infinity && !lineOfSight(c.sim.map, 100, 60, 100, 70), 'a house between: not seen');
  const s = duo({ d: 14, shade: true });
  ok(timeTo(s.sim, 1, 5) === Infinity, 'in shadow at 14 m (beyond the shortened sight): not seen');
  const s2 = duo({ d: 9, shade: true }), ts2 = timeTo(s2.sim, 4), n2 = duo({ d: 9 }), tn2 = timeTo(n2.sim, 4);
  ok(ts2 > tn2 * 1.4, `shadow slows detection at 9 m: ${ts2.toFixed(2)} s vs ${tn2.toFixed(2)} s in the light`);
  const dz = duo({ d: 10, disguise: 2 }), td = timeTo(dz.sim, 4);
  ok(td > ta * 2, `disguise (level 2) slows detection: ${td.toFixed(2)} s vs ${ta.toFixed(2)} s`);
  const lv = duo({ d: 16 }); const seen = [];
  for (let i = 0; i < 200 && lv.sim.level < 4; i++) { for (const e of lv.sim.step(DT)) if (e.type === 'level') seen.push(e.to); lv.g.heading = 0; lv.g.path = []; lv.g.wait = 999; lv.sim.player.z = 76; }
  ok([1, 2, 3, 4].every(l => seen.includes(l)), `gauge climbs through every level: ${seen.join(' → ')}`);
  // noise: running behind a guard makes him turn round
  const nz = duo({ d: 9, angle: Math.PI, run: true });
  nz.sim.input = { x: 1, z: 0, run: true, act: false };
  let turned = false;
  for (let i = 0; i < 16; i++) { nz.sim.step(DT); nz.g.heading = Math.PI; if (nz.g.sus > 0) turned = true; }
  ok(turned, `running behind a guard is heard (suspicion ${Math.round(nz.g.sus)})`);
}
{
  // pursuit: alarm raised, the motionless captain is caught
  const sim = new SneakSim({ seed: 5, kind: 'infiltrate', garrison: 60 });
  sim.raiseAlarm(); let caught = null;
  for (let t = 0; t < 60 && !caught; t += DT) for (const e of sim.step(DT)) if (e.type === 'caught') caught = e;
  ok(!!caught, `after the alarm the guards close in and catch a captain who stays put (${sim.time.toFixed(1)} s)`);
  if (caught) sim.knockOut(caught.guard);
  ok(caught?.guard.down && !sim.caught, 'a guard beaten in the duel is knocked out and the run goes on');
}
{
  // lock picking
  const times = [0, 1, 2].map(lp => {
    const sim = new SneakSim({ seed: 4, kind: 'escape', garrison: 0, lockpick: lp });
    sim.guards = [];
    sim.player.x = sim.map.gate.x; sim.player.z = sim.map.gate.z + sim.map.cell * 0.9;
    sim.input = { x: 0, z: 0, run: false, act: true };
    let t = 0; while (!sim.map.gate.open && t < 20) { sim.step(DT); t += DT; }
    return t;
  });
  ok(times[0] > times[1] && times[1] > times[2] && Math.abs(times[0] - SNEAK.lockTime[0]) < 0.2, `lock picked in ${times.map(t => t.toFixed(1)).join(' / ')} s (nothing / passe-partout / kit)`);
}
// careful bot: follows the shortest path, stops when a guard looks at it up close, otherwise hides while walking
function bot(sim) {
  let path = null, gi = 0;
  return () => {
    const p = sim.player, gl = sim.goals[gi % sim.goals.length];
    if (!sim.map.gate.open) { const g = sim.map.gate; if (Math.hypot(p.x - g.x, p.z - (g.z + sim.map.cell * 0.5)) > 1.5) { path = findPath(sim.map, p.x, p.z, g.x, g.z + sim.map.cell * 0.9) || []; } else { sim.input = { x: 0, z: 0, run: false, act: true }; return; } }
    if (!path || !path.length) path = findPath(sim.map, p.x, p.z, gl.x, gl.z) || [];
    const danger = sim.guards.some(g => !g.down && Math.hypot(g.x - p.x, g.z - p.z) < 26 && g.sus > 30 && sim.canSee(g) > 0);
    const n = path[0]; if (!n) { sim.input = { x: 0, z: 0 }; return; }
    if (Math.hypot(n.x - p.x, n.z - p.z) < 0.6) { path.shift(); return; }
    sim.input = { x: n.x - p.x, z: n.z - p.z, run: danger || sim.alarm, act: false };
  };
}
{
  for (const kind of ['infiltrate', 'escape']) {
    let won = 0, caught = 0; const times = [];
    for (let s = 1; s <= 12; s++) {
      const sim = new SneakSim({ seed: s, kind, garrison: 60, rand: mulberry32(s) });
      const b = bot(sim);
      while (!sim.over && !sim.caught && sim.time < 300) { b(); sim.step(DT); }
      if (sim.over) { won++; times.push(sim.time); } else if (sim.caught) caught++;
    }
    ok(won >= 2 && caught >= 2, `${kind}: a straight-line bot wins ${won}/12, is caught ${caught}/12 (the mode is neither free nor impossible)`);
    ok(times.every(t => t > 20 && t < 180), `${kind}: successful runs last ${times.map(t => Math.round(t)).join(' ')} s`);
  }
}

if (process.argv.includes('--browser')) {
  const { chromium } = await import('playwright');
  const shotsDir = (() => { const i = process.argv.indexOf('--shots'); return i > 0 ? process.argv[i + 1] : null; })();
  const base = BASE;
  let server = null;
  try { await fetch(base); } catch {
    const { spawn } = await import('node:child_process');
    server = spawn('npx', ['vite', '--port', PORT, '--strictPort'], { stdio: 'ignore', detached: true });
    for (let i = 0; i < 60; i++) { try { await fetch(base); break; } catch { await new Promise(r => setTimeout(r, 1000)); } }
  }
  const browser = await chromium.launch(launchOpts([]));
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(base + '?shot=sneak&quality=low&play=6', { waitUntil: 'load', timeout: 240000 });
  await page.waitForFunction(() => window.__ready, null, { timeout: 240000 });
  await page.waitForTimeout(1500);
  const st = await page.evaluate(() => { const g = window.__game, s = g.sneak; return { mode: g.mode, active: s.active, guards: s.sim?.guards.length, calls: g.renderer.info.render.calls, theme: g.audio?.music?.cur?.name || null }; });
  ok(st.mode === 'sneak' && st.active && st.guards >= 3, `browser: infiltration running (mode ${st.mode}, ${st.guards} guards, ${st.calls} draw calls)`);
  ok(st.calls < 60, `draw calls within budget (${st.calls})`);
  if (shotsDir) await page.screenshot({ path: `${shotsDir}/sneak-start.png` });
  await page.waitForFunction(() => window.__game.sneak.sim.time > 8, null, { timeout: 120000 }).catch(() => {});   // SwiftShader: slow first frames
  // ZQSD by physical code: KeyW moves up the screen (increasing z)
  const z0 = await page.evaluate(() => { const s = window.__game.sneak.sim; s.guards.forEach(g => { g.sus = 0; g.x = 2; g.z = 150; g.route = [{ x: 2, z: 150 }, { x: 2, z: 150 }]; g.path = []; }); return s.player.z; });
  await page.keyboard.down('KeyW'); await page.waitForTimeout(2500); await page.keyboard.up('KeyW');
  const z1 = await page.evaluate(() => window.__game.sneak.sim.player.z);
  ok(z1 - z0 > 0.2, `physical-key movement (z ${z0.toFixed(1)} → ${z1.toFixed(1)})`);
  // forced alarm: gauge, marks, red cones
  await page.evaluate(() => { const s = window.__game.sneak.sim; s.raiseAlarm(); s.guards.forEach(g => { g.x = 2; g.z = 150; }); });
  await page.waitForTimeout(500);
  const hud = await page.evaluate(() => ({ lvl: document.querySelector('.sn-lvl')?.textContent, level: window.__game.sneak.level, theme: window.__game.audio?.music?.cur?.name }));
  ok(hud.level === 4 && /Alarm/.test(hud.lvl || ''), `alarm shows on the gauge (${hud.lvl})`);
  if (shotsDir) await page.screenshot({ path: `${shotsDir}/sneak-alarm.png` });
  // success → port opened on the tavern despite the hostility
  await page.evaluate(() => { const s = window.__game.sneak, g = s.sim.goals.find(x => x.id === 'tavern'); s.sim.alarm = false; s.sim.guards.forEach(q => { q.down = true; }); s.sim.player.x = g.x; s.sim.player.z = g.z; });
  await page.waitForFunction(() => window.__game.mode === 'port', null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(500);
  const port = await page.evaluate(() => { const g = window.__game; return { mode: g.mode, open: g.ports.isOpen, tab: g.ports.screen.tab, lock: g.ports.locked(g.ports.port, 'tavern') }; });
  ok(port.mode === 'port' && port.open && port.tab === 'tavern' && !port.lock, `infiltration success opens the tavern (mode ${port.mode}, tab ${port.tab})`);
  if (shotsDir) await page.screenshot({ path: `${shotsDir}/sneak-tavern.png` });
  await page.evaluate(() => window.__game.ports.leave());
  await page.waitForTimeout(800);
  // hostile port: the arrest becomes a choice
  await page.evaluate(() => { const g = window.__game, p = g.sneak.port; g.living.town(p).garrison = 100; g.state.items ||= {}; g.state.items.disguise = 0; g.ports.enter(p); });
  await page.waitForTimeout(600);
  const offer = await page.evaluate(() => ({ txt: document.querySelector('.sn-screen.on')?.textContent || '', open: window.__game.ports.isOpen }));
  ok(/Slip into town/.test(offer.txt) && !offer.open, 'hostile port: « Se faufiler en ville » is offered instead of the arrest');
  if (shotsDir) await page.screenshot({ path: `${shotsDir}/sneak-offer.png` });
  await page.evaluate(() => document.querySelector('.sn-screen.on [data-act="leave"]')?.click());
  await page.waitForTimeout(400);
  // prison: « Tenter l'évasion » → sneak mode (escape) → success → at sea, few days elapsed, gold kept
  const before = await page.evaluate(() => { const g = window.__game; g.state.gold = 5000; g.state.items.lockpick = 2; const p = g.sneak.port || g.islands.ports.find(q => !q.haven && q.faction === 'spanish');
    g.boarding._captivityScreen(g.player, { faction: p.faction, _captain: { name: 'la garde' }, alive: false }, { cause: 'sneak', how: 'Pris.' }); return { day: g.state.date?.day ?? null, abs: g.career?.dayCount?.() ?? null }; });
  await page.waitForTimeout(700);
  const hasBtn = await page.evaluate(() => !!document.querySelector('.board-screen.on button[data-c="escape"], .on button[data-c="escape"]'));
  ok(hasBtn, 'prison screen offers « Tenter l’évasion »');
  if (shotsDir) await page.screenshot({ path: `${shotsDir}/sneak-prison.png` });
  await page.evaluate(() => document.querySelector('button[data-c="escape"]').click());
  await page.waitForTimeout(1500);
  const esc = await page.evaluate(() => { const s = window.__game.sneak; return { kind: s.kind, active: s.active, mode: window.__game.mode, lockTime: s.sim?.lockTime }; });
  ok(esc.active && esc.kind === 'escape' && esc.mode === 'sneak' && esc.lockTime === SNEAK.lockTime[2], `escape mode running (lock ${esc.lockTime} s with the kit)`);
  if (shotsDir) { await page.waitForTimeout(800); await page.screenshot({ path: `${shotsDir}/sneak-escape.png` }); }
  await page.evaluate(() => window.__game.sneak.forceEnd('success'));
  // (fade to black then back: slower in software rendering — wait for the sea, up to 10 s)
  await page.waitForFunction(() => window.__game.mode === 'sail' && !window.__game.boarding.active, null, { timeout: 10000, polling: 200 }).catch(() => {});
  const after = await page.evaluate(() => { const g = window.__game; return { mode: g.mode, gold: g.state.gold, active: g.boarding.active }; });
  ok(after.mode === 'sail' && !after.active && after.gold === 5000, `escaped: back at sea, no ransom paid (gold ${after.gold}, mode ${after.mode})`);
  ok(!errors.length, `zero console errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
  await browser.close();
  if (server) try { process.kill(-server.pid); } catch { /* */ }
}

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
