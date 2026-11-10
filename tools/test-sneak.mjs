// Targeted test of sneaking / prison escape: node tools/test-sneak.mjs [--browser] [--shots folder]
// 1. pure simulation (no browser): connected towns (lanterns, hiding spots, varied houses), patrols drawn per attempt,
//    sight (cone, walls, moon shadow, lantern light, disguise), noise, levels and alarm, hiding, knock-out and found
//    bodies (the finder kneels over his comrade), guard state events, stones, pursuit and capture, lock picking; win rates of a straight-line bot (must mostly fail) and of a
//    careful bot (dark routes, waits for gaps, hides, stones, knock-outs: must mostly win).
// 2. --browser: ?shot=sneak on the dev server (127.0.0.1:5173, started separately or by this script): mode 'sneak',
//    keyboard movement (physical codes), barks and detection indicators, the tools' keys (H, T, K), draw calls, alarm, entering port through the
//    tavern, hostile-port screen, escape
//    from the prison screen, zero console errors; --shots: captures.
import { SneakSim, buildTown, findPath, lineOfSight, C } from '../src/game/sneak/sim.js';
import { straightBot, carefulBot } from './_sneak-bots.mjs';
import { SNEAK } from '../src/data/sneak.js';
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
    if (m.goals.every(g => findPath(m, m.start.x, m.start.z, g.x, g.z)) && m.hides.every(h => findPath(m, m.start.x, m.start.z, h.x, h.z, true))) good++;
  }
  ok(good === 32, `32 towns: every goal and hiding spot reachable from the start (${good}/32)`);
  const m = buildTown({ seed: 3, kind: 'escape' });
  ok(!findPath(m, m.start.x, m.start.z, m.goals[0].x, m.goals[0].z), 'escape: the prison gate is shut at the start');
  let sh = 0, lit = 0, open = 0; for (let k = 0; k < m.W * m.H; k++) if (m.type[k] === C.STREET || m.type[k] === C.QUAY) { open++; if (m.shade[k]) sh++; if (m.light[k] > 0.2) lit++; }
  ok(sh / open > 0.15 && sh / open < 0.7, `moon shadows cover ${Math.round(sh / open * 100)} % of the streets`);
  ok(lit / open > 0.05 && lit / open < 0.3 && m.lamps.length >= 8, `${m.lamps.length} lanterns light ${Math.round(lit / open * 100)} % of the streets`);
  ok(m.hides.length >= 8 && new Set(m.hides.map(h => h.kind)).size >= 2, `${m.hides.length} hiding spots (${[...new Set(m.hides.map(h => h.kind))].join(', ')})`);
  const hs = m.houses.filter(h => !h.role), walls = new Set(hs.map(h => h.wall)), hh = new Set(hs.map(h => Math.round(h.h)));
  ok(hs.length > 30 && walls.size >= 4 && hh.size >= 3, `${hs.length} houses, ${walls.size} wall colours, ${hh.size} heights`);
  // patrols drawn again at every attempt, the town stays the same
  const a = new SneakSim({ seed: 3, patrolSeed: 11, kind: 'escape' }), b = new SneakSim({ seed: 3, patrolSeed: 12, kind: 'escape' });
  const sig = s => s.guards.map(g => `${Math.round(g.x)},${Math.round(g.z)}`).join(' ');
  ok(sig(a) !== sig(b) && a.map.houses.length === b.map.houses.length, 'another attempt: other patrol routes in the same town');
  const kinds = s => ({ posts: s.guards.filter(g => g.post).length, pairs: s.guards.filter(g => g.leader).length, torches: s.guards.filter(g => g.torch).length });
  const k = kinds(a);
  ok(k.posts >= 1 && a.guards.some(g => g.post?.id === 'quay'), `escape: the quay is guarded by a sentry (${k.posts} posts, ${k.pairs} pairs, ${k.torches} torches, ${a.guards.length} guards)`);
}

// controlled scene: a single guard, motionless, the captain at a given distance in front of him
function duo({ d = 10, angle = 0, disguise = 0, shade = false, wall = false, run = false, light = 0 } = {}) {
  const sim = new SneakSim({ seed: 2, kind: 'infiltrate', garrison: 0, disguise });
  const m = sim.map;
  m.type.fill(C.STREET); m.shade.fill(shade ? 1 : 0); m.lamps = light ? [{ x: 100, z: 60 + d, r: 9 }] : []; m.hides = [{ x: 100, z: 60 + d, kind: 'door' }];
  const g = sim.guards[0]; sim.guards = [g];
  Object.assign(g, { x: 100, z: 60, heading: angle, route: [{ x: 100, z: 60 }, { x: 100, z: 60 }], path: [], wait: 999, baseH: angle, phase: 0, look: 0, sus: 0, torch: false, post: null, leader: null, state: 'patrol' });
  g._lockH = angle;
  sim.player.x = 100; sim.player.z = 60 + d;
  if (wall) for (let i = 0; i < m.W; i++) m.type[Math.floor((60 + d / 2) / m.cell) * m.W + i] = C.HOUSE;
  sim.input = { x: 0, z: 0, run, act: false };
  return { sim, g };
}
const timeTo = (sim, lvl, max = 12) => { const t0 = sim.time; while (sim.time - t0 < max) { sim.step(DT); for (const g of sim.guards) { g.heading = g._lockH; g.wait = 999; g.path = []; } if (sim.level >= lvl) return sim.time - t0; } return Infinity; };
{
  const a = duo({ d: 10 }), ta = timeTo(a.sim, 4);
  ok(ta < 5, `moonlight, in full view at 10 m: alarm in ${ta.toFixed(2)} s`);
  const b = duo({ d: 10, angle: Math.PI });
  ok(timeTo(b.sim, 1, 5) === Infinity, 'behind the guard (walking): never noticed');
  const c = duo({ d: 10, wall: true });
  ok(timeTo(c.sim, 1, 5) === Infinity && !lineOfSight(c.sim.map, 100, 60, 100, 70), 'a house between: not seen');
  const s = duo({ d: 10, shade: true });
  ok(timeTo(s.sim, 1, 5) === Infinity, 'deep shadow at 10 m (beyond the shortened sight): not seen');
  const far = duo({ d: 19 }), lit = duo({ d: 19, light: 1 });
  ok(timeTo(far.sim, 1, 5) === Infinity && timeTo(lit.sim, 4) < 6, `at 19 m: unseen by moonlight, lantern light gives you away (${lit.sim.time.toFixed(2)} s)`);
  const l2 = duo({ d: 9, light: 1 }), tl2 = timeTo(l2.sim, 4), s2 = duo({ d: 6, shade: true }), ts2 = timeTo(s2.sim, 4), n2 = duo({ d: 6 }), tn2 = timeTo(n2.sim, 4);
  ok(ts2 > tn2 * 1.8, `deep shadow slows detection at 6 m: ${ts2.toFixed(2)} s vs ${tn2.toFixed(2)} s by moonlight`);
  ok(tl2 < 1.5, `in a lantern's light at 9 m: alarm in ${tl2.toFixed(2)} s`);
  const dz = duo({ d: 10, disguise: 2 }), td = timeTo(dz.sim, 4);
  ok(td > ta * 2, `disguise (level 2) slows detection: ${td.toFixed(2)} s vs ${ta.toFixed(2)} s`);
  const lv = duo({ d: 13 }); const seen = [];
  for (let i = 0; i < 200 && lv.sim.level < 4; i++) { for (const e of lv.sim.step(DT)) if (e.type === 'level') seen.push(e.to); lv.g.heading = 0; lv.g.path = []; lv.g.wait = 999; lv.sim.player.z = 73; }
  ok([1, 2, 3, 4].every(l => seen.includes(l)), `gauge climbs through every level: ${seen.join(' → ')}`);
  // noise: running behind a guard makes him turn round
  const nz = duo({ d: 9, angle: Math.PI, run: true });
  nz.sim.input = { x: 1, z: 0, run: true, act: false };
  let turned = false;
  for (let i = 0; i < 16; i++) { nz.sim.step(DT); nz.g.heading = Math.PI; if (nz.g.sus > 0) turned = true; }
  ok(turned, `running behind a guard is heard (suspicion ${Math.round(nz.g.sus)})`);
  // hiding spot: unseen in plain view, found by a guard searching right there
  const h = duo({ d: 8 }); const he = h.sim.toggleHide();
  ok(he.type === 'hide' && he.on && timeTo(h.sim, 1, 4) === Infinity, 'hidden in a doorway in front of a guard: unseen');
  h.g.sus = SNEAK.levels[1] + 5; h.g.lastSeen = { x: 100, z: 68 }; h.g.wait = 0;
  let found = false; for (let i = 0; i < 200 && !found; i++) { h.sim.step(DT); found = h.g.see > 0 || !!h.sim.caught; }
  ok(found, 'a guard searching the doorway finds the hidden captain');
  // knock-out: from behind only, the body raises the alarm when found
  const k1 = duo({ d: 1.4, angle: Math.PI }); const ko = k1.sim.tryKnockOut();
  const k2 = duo({ d: 1.4 }); const ko2 = k2.sim.tryKnockOut();
  ok(ko.type === 'ko' && k1.g.down && ko2.type === 'fail' && ko2.why === 'facing', 'knock-out: from behind it works, face to face it fails');
  const g2 = { ...k1.g, id: 1, down: false, ko: false, x: 100, z: 70, heading: Math.PI, sus: 0, path: [], wait: 999, _lockH: Math.PI };
  k1.sim.guards.push(g2); k1.sim.player.x = 60; k1.sim.player.z = 10;
  let body = false, by = null; for (let i = 0; i < 40 && !body; i++) for (const e of k1.sim.step(DT)) { if (e.type === 'body') body = true; if (e.type === 'alarm') by = e.by; }
  ok(body && k1.sim.alarm && by === g2, 'a guard who finds his knocked-out comrade raises the alarm (the alarm event names him)');
  let knelt = false; for (let i = 0; i < 160 && !knelt; i++) { k1.sim.step(DT); knelt = g2.kneelT > 0 && Math.hypot(g2.x - k1.g.x, g2.z - k1.g.z) < 1.6; }
  ok(knelt, `the finder runs to his comrade and kneels over him (${Math.hypot(g2.x - k1.g.x, g2.z - k1.g.z).toFixed(1)} m)`);
  // state changes are reported (barks, reactions): a guard who sees you turns from his patrol to look, then hunts
  const gs = duo({ d: 10 }), seenStates = [];
  for (let i = 0; i < 120 && !gs.sim.alarm; i++) { for (const e of gs.sim.step(DT)) if (e.type === 'guard' && e.guard === gs.g) seenStates.push(e.to); gs.g.heading = 0; }
  ok(seenStates.includes('look') && seenStates.includes('chase'), `guard state events: ${seenStates.join(' → ')}`);
  // stone: the nearest guard goes to look where it fell
  const st = duo({ d: -11, angle: 0 }); st.g.wait = 0; st.g.path = null;
  st.sim.player.x = 95;
  const sev = st.sim.throwStone(106, 64); let landed = null;
  for (let i = 0; i < 40 && !landed; i++) for (const e of st.sim.step(DT)) if (e.type === 'landed') landed = e;
  const d0 = Math.hypot(st.g.x - landed.x, st.g.z - landed.z);
  for (let i = 0; i < 160; i++) st.sim.step(DT);
  ok(sev.type === 'stone' && landed?.guard === st.g && Math.hypot(st.g.x - landed.x, st.g.z - landed.z) < d0 - 4 && st.sim.gauge < SNEAK.levels[0], `a thrown stone draws the guard (${d0.toFixed(1)} m → ${Math.hypot(st.g.x - landed.x, st.g.z - landed.z).toFixed(1)} m) without raising the gauge`);
  st.sim.stoneCd = 0; let n = 0; while (st.sim.throwStone(100, 40).type === 'stone') { n++; st.sim.stoneCd = 0; }
  ok(n === SNEAK.tools.stones - 1, `${SNEAK.tools.stones} stones per attempt`);
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
  ok(times[0] > times[1] && times[1] > times[2] && Math.abs(times[0] - SNEAK.lockTime[0]) < 0.2, `lock picked in ${times.map(t => t.toFixed(1)).join(' / ')} s (nothing / skeleton key / kit)`);
}
const RUNS = 16, rates = {};
for (const [name, mk] of [['straight-line', straightBot], ['careful', carefulBot]]) for (const kind of ['infiltrate', 'escape']) {
  let won = 0, caught = 0; const times = [];
  for (let s = 1; s <= RUNS; s++) {
    const sim = new SneakSim({ seed: s, patrolSeed: s * 13 + 5, kind, garrison: 60, lockpick: 1 });
    const b = mk(sim);
    while (!sim.over && !sim.caught && sim.time < 300) { b(); sim.step(DT); }
    if (sim.over) { won++; times.push(sim.time); } else if (sim.caught) caught++;
  }
  rates[name + ':' + kind] = won;
  console.log(`  ..   ${name} bot, ${kind}: wins ${won}/${RUNS}, caught ${caught}/${RUNS}, times ${times.map(t => Math.round(t)).join(' ')} s`);
}
for (const kind of ['infiltrate', 'escape']) {
  ok(rates['straight-line:' + kind] <= RUNS * 0.3, `${kind}: the straight-line bot fails most of the time (wins ${rates['straight-line:' + kind]}/${RUNS})`);
  ok(rates['careful:' + kind] >= RUNS * 0.55, `${kind}: the careful bot wins most of the time (${rates['careful:' + kind]}/${RUNS})`);
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
  ok(st.calls < 120, `draw calls within budget (${st.calls})`);
  if (shotsDir) await page.screenshot({ path: `${shotsDir}/sneak-start.png` });
  await page.waitForFunction(() => window.__game.sneak.sim.time > 8, null, { timeout: 120000 }).catch(() => {});   // SwiftShader: slow first frames
  // ZQSD by physical code: KeyW moves up the screen (increasing z)
  const z0 = await page.evaluate(() => { const s = window.__game.sneak.sim; s.guards.forEach(g => { g.sus = 0; g.x = 2; g.z = 150; g.route = [{ x: 2, z: 150 }, { x: 2, z: 150 }]; g.path = []; }); return s.player.z; });
  await page.keyboard.down('KeyW'); await page.waitForTimeout(2500); await page.keyboard.up('KeyW');
  const z1 = await page.evaluate(() => window.__game.sneak.sim.player.z);
  ok(z1 - z0 > 0.2, `physical-key movement (z ${z0.toFixed(1)} → ${z1.toFixed(1)})`);
  // feedback: a guard close by who hunts you barks (speech bubble) and shows a red “!”; a suspicious one a “?”
  await page.evaluate(() => { const s = window.__game.sneak.sim, p = s.player, [g, h] = s.guards.filter(q => !q.post && !q.down);
    for (const [q, dx] of [[g, 5], [h, -5]]) { q.x = p.x + dx; q.z = p.z; q.heading = dx > 0 ? Math.PI / 2 : -Math.PI / 2; q.leader = null; q.lure = null; q.path = []; q.wait = 99; }
    g.sus = 90; g.lastSeen = { x: g.x + 30, z: g.z }; h.sus = 30; h.lastSeen = { x: h.x - 30, z: h.z }; });
  await page.waitForFunction(() => document.querySelector('.sn-bark') && document.querySelector('.sn-ind.spot'), null, { timeout: 15000, polling: 100 }).catch(() => {});
  const fb = await page.evaluate(() => ({ bark: [...document.querySelectorAll('.sn-bark')].map(b => b.textContent).join(' | '),
    spot: [...document.querySelectorAll('.sn-ind.spot')].filter(e => e.style.display !== 'none').length,
    ask: [...document.querySelectorAll('.sn-ind:not(.spot)')].filter(e => e.style.display !== 'none' && e.textContent.includes('?')).length }));
  ok(/Stop him|Halt/.test(fb.bark), `a guard who spots you barks (“${fb.bark}”)`);
  ok(fb.spot >= 1 && fb.ask >= 1, `detection indicators: “!” over the hunter (${fb.spot}), “?” over the suspicious guard (${fb.ask})`);
  if (shotsDir) await page.screenshot({ path: `${shotsDir}/sneak-spotted.png` });
  await page.evaluate(() => { const s = window.__game.sneak.sim; s.guards.forEach(g => { g.sus = 0; g.x = 2; g.z = 150; g.lastSeen = null; g.route = [{ x: 2, z: 150 }, { x: 2, z: 150 }]; g.path = []; }); });
  // fugitive's tools by keyboard (key + code sent): H hides next to a hiding spot, T throws a stone, K knocks out
  const tools = await page.evaluate(() => { const s = window.__game.sneak.sim, h = s.map.hides[0]; s.player.x = h.x; s.player.z = h.z; return { stones: s.stones }; });
  await page.keyboard.press('KeyH'); await page.waitForTimeout(300);
  const hid = await page.evaluate(() => !!window.__game.sneak.sim.player.hidden);
  await page.keyboard.press('KeyH'); await page.keyboard.press('KeyT'); await page.waitForTimeout(1500);
  const used = await page.evaluate(() => { const s = window.__game.sneak.sim; return { hidden: !!s.player.hidden, stones: s.stones, prompt: document.querySelector('.sn-help, .lb-help')?.textContent || '' }; });
  ok(hid && !used.hidden && used.stones === tools.stones - 1, `keys: H hides and leaves (${hid} → ${used.hidden}), T throws a stone (${tools.stones} → ${used.stones})`);
  ok(/throw a stone/.test(used.prompt) && /hide/.test(used.prompt) && /knock out/.test(used.prompt), 'the help line lists the tools');
  const ko = await page.evaluate(() => { const s = window.__game.sneak.sim, p = s.player, g = s.guards.find(q => !q.post && !q.down);
    p.heading = 0; g.x = p.x; g.z = p.z + 1.2; g.heading = 0; g.sus = 0; g.path = []; g.wait = 99; g.lure = null; g.leader = null; return g.id; });
  await page.keyboard.press('KeyK'); await page.waitForTimeout(300);
  const down = await page.evaluate(id => window.__game.sneak.sim.guards[id].down, ko);
  ok(down, 'K knocks out a guard from behind');
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
  ok(/Slip into town/.test(offer.txt) && !offer.open, 'hostile port: “Slip into town” is offered instead of the arrest');
  if (shotsDir) await page.screenshot({ path: `${shotsDir}/sneak-offer.png` });
  await page.evaluate(() => document.querySelector('.sn-screen.on [data-act="leave"]')?.click());
  await page.waitForTimeout(400);
  // prison: “Attempt an escape” → sneak mode (escape) → success → at sea, few days elapsed, gold kept
  const before = await page.evaluate(() => { const g = window.__game; g.state.gold = 5000; g.state.items.lockpick = 2; const p = g.sneak.port || g.islands.ports.find(q => !q.haven && q.faction === 'spanish');
    g.boarding._captivityScreen(g.player, { faction: p.faction, _captain: { name: 'la garde' }, alive: false }, { cause: 'sneak', how: 'Pris.' }); return { day: g.state.date?.day ?? null, abs: g.career?.dayCount?.() ?? null }; });
  await page.waitForTimeout(700);
  const hasBtn = await page.evaluate(() => !!document.querySelector('.board-screen.on button[data-c="escape"], .on button[data-c="escape"]'));
  ok(hasBtn, 'prison screen offers “Attempt an escape”');
  if (shotsDir) await page.screenshot({ path: `${shotsDir}/sneak-prison.png` });
  await page.evaluate(() => document.querySelector('button[data-c="escape"]').click());
  await page.waitForFunction(() => window.__game.mode === 'sneak', null, { timeout: 30000, polling: 200 }).catch(() => {});   // town built under the fade
  const esc = await page.evaluate(() => { const s = window.__game.sneak; return { kind: s.kind, active: s.active, mode: window.__game.mode, lockTime: s.sim?.lockTime }; });
  ok(esc.active && esc.kind === 'escape' && esc.mode === 'sneak' && esc.lockTime === SNEAK.lockTime[2], `escape mode running (mode ${esc.mode}, lock ${esc.lockTime} s with the kit)`);
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
