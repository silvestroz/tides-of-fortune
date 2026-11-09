// After a won fight, the player's ship must sail again. Each scenario starts a real new game (title menu, captain
// sheet, set sail), fights a hostile ship with the real render loop running (game.frame(ts) through the frame pacer,
// keys sent as real keyboard events), ends the fight one way, then makes full sail (Z/W twice) and checks that the
// ship answers: mode 'sail', not frozen, time x1, a PlayerController, sails set, no repairs, speed rising, distance run.
// Scenarios: sunk by broadsides · struck then left astern · boarded + duel won, then keep / burn / release the prize ·
// “Assisted” boarding · a boarding that fails half-way (duel.start throws: Boarding.begin must hand the helm back) ·
// emergency repairs (R) under way when the enemy sinks. Takes ~25 min in software GL (one fresh game per scenario).
// Usage: node tools/test-aftermath.mjs [--only sunk,struck,keep,burn,release,assist,fault,repair] [--shots folder]
// (dev server TOF_URL, GPU by default, --soft = SwiftShader)
import { chromium } from 'playwright';
import fs from 'node:fs';
import { BASE, launchOpts } from './_env.mjs';

const arg = k => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : null);
const ONLY = arg('--only')?.split(',');
const SHOTS = arg('--shots'); if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const CLK = { force: true, timeout: 90000 };
const browser = await chromium.launch(launchOpts(['--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required']));
const results = [];
const check = (name, ok, info = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); };

// capture-screen choice, clicked from the page (a sheet taller than the window leaves the buttons below the fold);
// fails if the page stops answering after it (a frozen main thread)
async function choose(page, c) {
  const t0 = Date.now();
  const r = await Promise.race([
    page.evaluate(c => { const b = document.querySelector(`.board-screen button[data-c="${c}"]`); if (!b) return 'no button'; if (b.disabled) return 'disabled'; b.click(); return 'clicked'; }, c),
    new Promise(r => setTimeout(() => r('page not answering after 60 s'), 60000))]);
  if (r !== 'clicked') throw new Error(`capture choice “${c}”: ${r}`);
  const alive = await Promise.race([page.evaluate(() => __game.mode), new Promise(r => setTimeout(() => r(null), 60000))]);
  if (alive == null) throw new Error(`page frozen after “${c}” (${Date.now() - t0} ms)`);
}

async function scenario(name, end, { expectErrors } = {}) {
  if (ONLY && !ONLY.includes(name)) return;
  const page = await (await browser.newContext({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1 })).newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(e.message));
  const ev = (fn, a) => page.evaluate(fn, a);
  const frames = n => Promise.race([ev(n => new Promise(r => { let i = 0; const f = () => (++i >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n), page.waitForTimeout(2000 + n * 400)]).catch(() => {});
  const sim = s => ev(s => { const g = __game; for (let i = 0; i < Math.round(s * 30); i++) { g.step(1 / 30 * g.timeScale); g.input.justPressed.clear(); g.input.justPressedKeys.clear(); } }, s);
  const key = async k => { await page.keyboard.press(k); await frames(3); };
  try {
    await page.goto(`${BASE}?telemetry=0&dynres=0&quality=low`, { waitUntil: 'load', timeout: 300000 });
    await ev(() => { try { localStorage.clear(); } catch {} });
    await page.reload({ waitUntil: 'load', timeout: 300000 });
    await page.waitForFunction(() => window.__ready || window.__error, null, { timeout: 400000, polling: 500 });
    await frames(3);
    const menu = await page.waitForSelector('.menu-layer [data-act="new"]', { state: 'attached', timeout: 120000 }).catch(() => null);
    if (!menu) throw new Error('no title menu: ' + await ev(() => (document.querySelector('.menu-layer')?.innerText || 'no .menu-layer').slice(0, 200) + ' | mode ' + __game.mode));
    await page.click('.menu-layer [data-act="new"]', CLK); await frames(2);
    await page.fill('#cap-name', 'Anne Aftermath', CLK); await page.dispatchEvent('#cap-name', 'input');
    await page.click('.menu-layer .choice[data-v="french"]', CLK); await page.click('.menu-layer .choice[data-v="gunnery"]', CLK); await frames(2);
    await page.click('.menu-layer [data-act="start"]', CLK);
    await page.waitForFunction(() => window.__game.mode === 'sail', null, { timeout: 120000, polling: 500 });
    await frames(10);
    // empty sea around, a hostile pirate brig on the port beam
    await ev(() => {
      const g = __game, p = g.player;
      for (const s of [...g.ships]) if (s !== p) g.removeShip(s);
      g.combat.setTrafficTarget?.(0);
      const f = { x: Math.sin(p.heading), z: -Math.cos(p.heading) }, left = { x: f.z, z: -f.x };
      const e = g.combat.spawnAI({ type: 'brig', faction: 'pirate', role: 'pirate', name: 'Gallows Bird', x: p.position.x + left.x * 140, z: p.position.z + left.z * 140, heading: p.heading, crew: 40, sailSetting: 0 });
      e.ai.hold = true; e.ai.fireAtWill = false; e.ai.setTarget(p); e.speed = 0;
      window.__foe = e;
    });
    await frames(10);
    await end({ page, ev, frames, sim, key });
    // the fight is over: full sail
    await frames(10);
    const before = await ev(() => { const g = __game, p = g.player; return { x: p.position.x, z: p.position.z }; });
    await key('KeyW'); await key('KeyW');
    await frames(20); await sim(12); await frames(20);
    const s = await ev(b => {
      const g = __game, p = g.player, c = p.controller;
      return { mode: g.mode, frozen: g.frozen, timeScale: g.timeScale, ctl: c?.constructor?.name || null, sail: +p.sailSetting.toFixed(2),
        speed: +p.speed.toFixed(2), target: +p.targetSpeed.toFixed(2), run: Math.round(Math.hypot(p.position.x - b.x, p.position.z - b.z)),
        repairing: !!p.repairing, grounded: !!p.grounded, struck: !!p.struck, combatSpeedF: p.combatSpeedF ?? 1, loadSpeedF: p.loadSpeedF ?? 1,
        boarding: !!g.boarding?.active, duel: !!g.duel?.active, screen: !!document.querySelector('.board-screen.on'), hold: !!g.hold?.isOpen,
        pacer: g.pacer ? `${g.pacer.hz} Hz /${g.pacer.div}` : null, foe: window.__foe ? { alive: window.__foe.alive, struck: window.__foe.struck, sinking: window.__foe.sinking, inWorld: g.ships.includes(window.__foe) } : null };
    }, before);
    const ok = s.mode === 'sail' && !s.frozen && s.timeScale === 1 && s.ctl === 'PlayerController' && s.sail >= 0.99 && !s.repairing && s.speed > 2.5 && s.run > 25;
    check(`${name}: the ship sails after the fight`, ok, JSON.stringify(s));
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
  } catch (e) { check(`${name}: scenario ran`, false, e.message.split('\n')[0] + ' ' + (e.message.match(/waiting for locator\([^)]*\)/)?.[0] || '')); }
  const unexpected = errors.filter(e => !expectErrors?.test(e));
  check(`${name}: no console error`, !unexpected.length, unexpected.slice(0, 3).join(' | '));
  await page.context().close();
}

// sunk by broadsides fired from the keyboard
await scenario('sunk', async ({ ev, frames, sim, key }) => {
  await ev(() => { __foe.hull = __foe.hullMax * 0.04; });
  for (let i = 0; i < 6 && await ev(() => !__foe.sinking && __foe.alive); i++) { await key('KeyQ'); await sim(3); await key('KeyE'); await sim(3); }
  await sim(40); await frames(5);
});
// she strikes her colours, we leave her astern
await scenario('struck', async ({ ev, frames, sim }) => { await ev(() => __game.combat.strike(__foe)); await sim(3); await frames(5); });
// boarded (B), duel won, prize kept / burnt / released
for (const c of ['keep', 'burn', 'release']) {
  await scenario(c, async ({ page, ev, frames, sim, key }) => {
    await ev(() => { const g = __game, p = g.player, e = __foe; const f = { x: Math.sin(p.heading), z: -Math.cos(p.heading) }, left = { x: f.z, z: -f.x };
      e.hull = e.hullMax * 0.3; e.crew = 8; e.sails = 0.4; e.teleport(p.position.x + left.x * 12, p.position.z + left.z * 12, p.heading); e.speed = p.speed; });
    await sim(0.5); await frames(3);
    await key('KeyB');
    await page.waitForFunction(() => __game.duel.active, null, { timeout: 180000, polling: 500 });
    await frames(20);
    await ev(() => { const d = __game.duel; d._teardown(); d._finish({ winner: 'player', reason: 'wounds' }); });
    await page.waitForSelector('.board-screen.on', { timeout: 120000 });
    await page.waitForTimeout(800); await frames(3);
    await choose(page, { keep: 'captured', burn: 'sunk', release: 'released' }[c]);
    await frames(10); await sim(2);
  });
}
// “Assisted” mode: the deck is carried without a duel
await scenario('assist', async ({ page, ev, frames, sim, key }) => {
  await ev(() => { const g = __game, p = g.player, e = __foe; g.state.assist = true;
    const f = { x: Math.sin(p.heading), z: -Math.cos(p.heading) }, left = { x: f.z, z: -f.x };
    e.hull = e.hullMax * 0.3; e.crew = 8; e.sails = 0.4; e.teleport(p.position.x + left.x * 12, p.position.z + left.z * 12, p.heading); e.speed = p.speed; });
  await sim(0.5); await frames(3);
  await key('KeyB');
  await page.waitForSelector('.board-screen.on', { timeout: 120000 });
  await page.waitForTimeout(800); await frames(3);
  await choose(page, 'captured');
  await frames(10); await sim(2);
});
// a boarding that fails half-way (the duel cannot start) must hand the helm back
await scenario('fault', async ({ page, ev, frames, sim, key }) => {
  await ev(() => { const g = __game, p = g.player, e = __foe; const f = { x: Math.sin(p.heading), z: -Math.cos(p.heading) }, left = { x: f.z, z: -f.x };
    e.hull = e.hullMax * 0.3; e.crew = 8; e.sails = 0.4; e.teleport(p.position.x + left.x * 12, p.position.z + left.z * 12, p.heading); e.speed = p.speed;
    g.duel.start = () => { throw new Error('test: duel failed to start'); }; });
  await sim(0.5); await frames(3);
  await key('KeyB');
  await page.waitForFunction(() => !__game.boarding.active && __game.mode === 'sail', null, { timeout: 60000, polling: 250 });
  await frames(5);
}, { expectErrors: /\[boarding\] aborted/ });
// emergency repairs under way (R) when the enemy goes down
await scenario('repair', async ({ ev, frames, sim, key }) => {
  await ev(() => { const p = __game.player; p.hull = p.hullMax * 0.5; p.sails = 0.6; });
  await key('KeyR'); await sim(4); await frames(3);
  const rep = await ev(() => __game.player.repairing);
  if (!rep) throw new Error('repairs did not start');
  await ev(() => __game.combat.startSinking(__foe)); await sim(40); await frames(5);
});

await browser.close();
const fails = results.filter(r => !r).length;
console.log(`\n${results.length - fails}/${results.length} ${fails ? 'FAIL' : 'PASS'}`);
process.exit(fails ? 1 : 0);
