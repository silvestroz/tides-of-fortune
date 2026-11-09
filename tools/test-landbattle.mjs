// Targeted test of town assaults: node tools/test-landbattle.mjs [--browser] [--shots folder]
// 1. pure simulation (no browser): connected map, forces, outcomes (victory, defeat, time out), woods, morale.
// 2. --browser: loads ?shot=landbattle on the dev server (127.0.0.1:5173, started separately or by this script),
//    checks mode 'land', mouse orders, end of battle, back to sea, zero console errors; --shots: captures.
import { LandSim, buildMap, findPath, playerForces, garrisonForces, T } from '../src/game/landbattle/sim.js';
import { LAND } from '../src/data/landbattle.js';
import { mulberry32 } from '../src/core/rng.js';
import { BASE, PORT, launchOpts } from './_env.mjs';

let fails = 0;
const ok = (c, msg) => { console.log((c ? '  ok   ' : '  FAIL ') + msg); if (!c) fails++; };
const DT = 1 / 20;

console.log('land battle sim tests');
{
  for (let s = 1; s <= 12; s++) {
    const m = buildMap({ seed: s });
    const p = findPath(m, m.deploy.x, m.deploy.z, m.town.x, m.town.z);
    if (!p) { ok(false, `map ${s}: town reachable`); break; }
    if (s === 12) ok(true, '12 maps: town reachable from the landing beach');
  }
  const m = buildMap({ seed: 3 }), c = [0, 0, 0, 0, 0, 0]; for (const t of m.type) c[t]++;
  ok(c[T.WOOD] > 40 && c[T.ROCK] > 10 && c[T.HILL] > 40 && c[T.TOWN] > 10, `terrain mix open ${c[0]} wood ${c[1]} hill ${c[2]} rock ${c[3]} town ${c[4]} water ${c[5]}`);
  const pf = playerForces(120), gf = garrisonForces(75);
  ok(pf.some(u => u.kind === 'officiers') && pf.some(u => u.kind === 'mousquetaires') && pf.reduce((a, u) => a + u.n, 0) >= 118, `player forces from 120 crew: ${pf.map(u => u.kind[0] + u.n).join(' ')}`);
  ok(gf.some(u => u.kind === 'cavalerie') && gf.length <= LAND.enemyUnitsMax, `garrison 75: ${gf.map(u => u.kind[0] + u.n).join(' ')}`);
}

// bot: every company marches on the square, musketeers in support; nearby visible enemies are charged
function attackBot(sim) {
  let t = 0;
  return dt => {
    t -= dt; if (t > 0) return; t = 2;
    const mine = sim.units.filter(u => u.side === 'player' && sim.alive(u) && u.state !== 'rout');
    for (const u of mine) {
      const foe = sim.units.filter(e => e.side === 'enemy' && sim.alive(e) && e.state !== 'rout' && sim.visible(e, 'player'))
        .sort((a, b) => Math.hypot(a.x - u.x, a.z - u.z) - Math.hypot(b.x - u.x, b.z - u.z))[0];
      if (foe && Math.hypot(foe.x - u.x, foe.z - u.z) < 160) { if (u.target !== foe) sim.order([u], foe.x, foe.z); }
      else if (!u.path || !u.path.length) sim.order([u], sim.map.town.x, sim.map.town.z);
    }
  };
}
function run(opts, bot = attackBot) {
  const sim = new LandSim({ rand: mulberry32(opts.seed || 1), ...opts });
  const b = bot ? bot(sim) : null, ev = {};
  while (!sim.over && sim.time < 400) { b?.(DT); for (const e of sim.step(DT)) ev[e.type] = (ev[e.type] || 0) + 1; }
  return { sim, ev, res: sim.result };
}
{
  let w = 0, times = [];
  for (let s = 1; s <= 10; s++) { const { res } = run({ seed: s, playerForce: 140, garrison: 45 }); if (res?.winner === 'player') { w++; times.push(res.time); } }
  ok(w >= 8, `strong crew (140) beats weak garrison (45): ${w}/10, ${times.map(t => Math.round(t)).join(' ')} s`);
  ok(times.length && times.every(t => t >= 40 && t <= LAND.timeLimit), 'battles last between 40 s and the time limit');
}
{
  let l = 0;
  for (let s = 1; s <= 10; s++) if (run({ seed: s, playerForce: 30, garrison: 95 }).res?.winner === 'enemy') l++;
  ok(l >= 8, `small crew (30) loses to a strong garrison (95): ${l}/10`);
}
{
  const { res } = run({ seed: 4, playerForce: 80, garrison: 60 }, null);
  ok(res && res.winner === 'enemy' && res.reason === 'time', `idle player is repulsed when time runs out (${res?.reason})`);
}
{
  let w = 0, rout = 0;
  for (let s = 1; s <= 20; s++) { const { res, ev } = run({ seed: s, playerForce: 60, garrison: 90 }); if (res?.winner === 'player') w++; rout += ev.rout || 0; }
  ok(w >= 6 && w <= 19, `close fight (60 vs 90) is uncertain: ${w}/20 won`);
  ok(rout > 5, `units rout (morale) in even fights: ${rout} routs`);
}
{
  const sim = new LandSim({ seed: 2, playerForce: 60, garrison: 40 });
  const e = sim.units.find(u => u.side === 'enemy');
  const m = sim.map; let wood = -1; for (let k = 0; k < m.type.length; k++) if (m.type[k] === T.WOOD) { wood = k; break; }
  e.x = (wood % m.W + 0.5) * m.cell; e.z = (Math.floor(wood / m.W) + 0.5) * m.cell;
  const far = sim.units.every(p => p.side !== 'player' || Math.hypot(p.x - e.x, p.z - e.z) > LAND.woodSpot);
  ok(!far || !sim.visible(e, 'player'), 'a unit in the woods is hidden from distant enemies');
  e.reveal = 2; ok(sim.visible(e, 'player'), 'firing reveals it');
}
{
  const a = run({ seed: 5, playerForce: 100, garrison: 60, approach: 'sea' }).sim, b = new LandSim({ seed: 5, playerForce: 100, garrison: 60 });
  ok(a.startMen.enemy < b.startMen.enemy, `sea assault: fewer defenders on the beach (${a.startMen.enemy} vs ${b.startMen.enemy})`);
}

// ---------------------------------------------------------------- navigateur
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
  await page.goto(base + '?shot=landbattle&quality=low', { waitUntil: 'load', timeout: 240000 });
  await page.waitForFunction(() => window.__ready, null, { timeout: 240000 });
  await page.waitForTimeout(1500);
  const st = await page.evaluate(() => { const g = window.__game, lb = g.landBattle; return { mode: g.mode, active: lb.active, units: lb.sim?.units.length, calls: g.renderer.info.render.calls }; });
  ok(st.mode === 'land' && st.active && st.units > 4, `browser: battle running (mode ${st.mode}, ${st.units} units, ${st.calls} draw calls)`);
  ok(st.calls < 120, `draw calls within budget (${st.calls})`);
  if (shotsDir) await page.screenshot({ path: `${shotsDir}/landbattle-start.png` });
  // select every company (T) then right-click order toward the square
  await page.keyboard.press('t');
  const tp = await page.evaluate(() => window.__game.landBattle.screenOf(window.__game.landBattle.sim.map.town.x, window.__game.landBattle.sim.map.town.z));
  await page.mouse.click(tp.x, tp.y, { button: 'right' });
  await page.waitForTimeout(400);
  const moving = await page.evaluate(() => window.__game.landBattle.sim.units.filter(u => u.side === 'player' && (u.path?.length || u.target)).length);
  ok(moving >= 3, `T selects all, right click orders them (${moving} moving)`);
  await page.evaluate(() => { window.__game.landBattle.speed = 8; });
  await page.waitForTimeout(9000);
  if (shotsDir) await page.screenshot({ path: `${shotsDir}/landbattle-fight.png` });
  await page.evaluate(() => { const lb = window.__game.landBattle; lb.speed = 1; lb.forceEnd('player'); });
  await page.waitForTimeout(1200);
  await page.waitForFunction(() => document.querySelector('.lb-screen.on'), null, { timeout: 20000 }).catch(() => {});   // SwiftShader: the screen may take a while
  const scr = await page.evaluate(() => document.querySelector('.lb-screen.on')?.textContent || '');
  ok(/plunder/i.test(scr), 'victory screen offers plunder');
  if (shotsDir) await page.screenshot({ path: `${shotsDir}/landbattle-victory.png` });
  await page.evaluate(() => document.querySelector('.lb-screen.on [data-act="keep"]')?.click());
  await page.waitForFunction(() => window.__game.mode === 'sail', null, { timeout: 20000 }).catch(() => {});   // SwiftShader: the fade may take a few frames
  const after = await page.evaluate(() => { const g = window.__game, p = g.landBattle.port; return { mode: g.mode, garrison: g.living.town(p).garrison }; });
  ok(after.mode === 'sail' && after.garrison <= LAND.town.garrisonLeft + 1, `back at sea (mode ${after.mode}), town weakened (garrison ${after.garrison})`);
  ok(!errors.length, `zero console errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
  await browser.close();
  if (server) try { process.kill(-server.pid); } catch { /* */ }
}

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
