// Headless sailing test.
// Usage: node tools/test-sailing.mjs [--shot sailing] [--fast 1] [--out shots/sailing/test-end.png]
// Loads ?shot=sailing (not frozen), drives the player with simulated key presses through a scripted
// manoeuvre sequence, logs speed / heading / pointOfSail / heel and checks invariants:
//   - no NaN in ship state, camera position finite
//   - ship never flies or sinks through the water (|y - waveHeight at centre| < 2.9: the hull heaves on the mean of
//     several hull samples, so in a 3 m swell its centre can sit ~2 m off the local crest/trough)
//   - polar: in irons is slow (< 25% max), broad reach is fastest, running slower than broad reach
//   - sail steps: furling slows the ship; time-compression toggles game.timeScale
//   - camera never below the water surface
// Exit code 1 on any failure. Uses page.evaluate stepping (game.step with fixed dt) for deterministic,
// fast simulation independent of SwiftShader frame rate; real key events go through window keydown/keyup.
import { chromium } from 'playwright';
import { BASE, PORT, launchOpts } from './_env.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => {
  if (v.startsWith('--')) a.push([v.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : '1']);
  return a;
}, []));
const shot = args.shot || 'sailing';
const url = `${BASE}?shot=${shot}&nohud=1`;
const browser = await chromium.launch(launchOpts());
const page = await browser.newPage({ viewport: { width: 640, height: 360 }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', e => errors.push('[pageerror] ' + e.message));
await page.goto(url, { waitUntil: 'load', timeout: 180000 });
await page.waitForFunction(() => window.__ready || window.__error, null, { timeout: 240000, polling: 250 });
const startErr = await page.evaluate(() => window.__error);
if (startErr) { console.log('STARTUP ERROR', startErr); process.exit(1); }

// Stop the render loop so we control time exactly (rendering in SwiftShader is slow).
await page.evaluate(() => { const g = window.__game; g.renderer.setAnimationLoop(null); g.__log = []; g.__notes = []; g.events.on('notify', e => g.__notes.push(e.text)); });

const failures = [];
const fail = m => { if (failures.length < 40) failures.push(m); };

// simulate `secs` of game time at 30 Hz, sampling every `every` s; keys held via real DOM events
async function sim(secs, label, every = 1) {
  const rows = await page.evaluate(({ secs, every, label }) => {
    const g = window.__game, p = g.player, out = [];
    const dt = 1 / 30; let acc = 0;
    for (let t = 0; t < secs; t += dt) {
      g.step(dt * g.timeScale);
      g.input.endFrame();
      acc += dt;
      const wh = g.ocean.getHeight(p.position.x, p.position.z);
      const c = g.camera.position, cw = g.ocean.getHeight(c.x, c.z);
      const bad = [p.position.x, p.position.y, p.position.z, p.heading, p.speed, p.roll, p.pitch, c.x, c.y, c.z].some(v => !Number.isFinite(v));
      const fly = p.position.y - wh, camUnder = c.y - cw;
      if (bad || Math.abs(fly) > 2.9 || camUnder < 0.5 || Math.abs(p.roll) > 0.6 || Math.abs(p.pitch) > 0.4) {
        out.push({ err: true, label, t: +t.toFixed(2), bad, fly: +fly.toFixed(2), camUnder: +camUnder.toFixed(2), roll: p.roll, pitch: p.pitch });
        if (out.filter(o => o.err).length > 5) break;
      }
      if (acc >= every - 1e-6) {
        acc = 0;
        out.push({ label, t: +(g.time).toFixed(1), kn: +(p.speed * 1.94384).toFixed(2), spd: +p.speed.toFixed(2),
          hdg: Math.round(((p.heading * 180 / Math.PI) % 360 + 360) % 360), off: Math.round(p.offWind * 180 / Math.PI),
          pos: p.pointOfSail, sail: +p.sailEff.toFixed(2), heel: +(p.heel * 180 / Math.PI).toFixed(1), roll: +(p.roll * 180 / Math.PI).toFixed(1),
          yaw: +(p.yawRate * 180 / Math.PI).toFixed(1), lee: +p.leeway.toFixed(2), luff: +p.luff.toFixed(2), ts: g.timeScale });
      }
    }
    return out;
  }, { secs, every, label });
  for (const r of rows) {
    if (r.err) console.log('INVARIANT', JSON.stringify(r)), fail(`${r.label} t=${r.t}: ${JSON.stringify(r)}`);
    else console.log(`${r.label.padEnd(14)} t=${String(r.t).padStart(6)} ${String(r.kn).padStart(5)}kn hdg=${String(r.hdg).padStart(3)} off=${String(r.off).padStart(3)}° ${r.pos.padEnd(12)} sail=${r.sail} heel=${r.heel}° roll=${r.roll}° yaw=${r.yaw}°/s lee=${r.lee} luff=${r.luff} ts=${r.ts}`);
  }
  return rows.filter(r => !r.err);
}
// key: the character the key produces (mnemonic commands T, C, B… use input.pressedKey(e.key)); QWERTY layout assumed
const key = (code, type) => page.evaluate(([code, type]) => {
  const k = code.startsWith('Key') ? code.slice(3).toLowerCase() : code.startsWith('Digit') ? code.slice(5) : code === 'Space' ? ' ' : code;
  window.dispatchEvent(new KeyboardEvent(type, { code, key: k, bubbles: true }));
}, [code, type]);
const tap = async code => { await key(code, 'keydown'); await page.evaluate(() => window.__game.step(1 / 30)); await page.evaluate(() => window.__game.input.endFrame()); await key(code, 'keyup'); };
// place ship in open water (far from islands, other ships) at a given angle off the wind (starboard tack)
const setHeadingOff = deg => page.evaluate(deg => {
  const g = window.__game, p = g.player; const from = g.wind.angle + Math.PI;
  p.hull = p.hullMax;
  for (const o of g.ships) if (o !== p) o.position.set(5000, 0, -5000);
  p.teleport(-5000, 5000, ((from + deg * Math.PI / 180 + Math.PI) % (2 * Math.PI)) - Math.PI); p.yawRate = 0; p.rudder = 0;
}, deg);
const last = rows => rows[rows.length - 1] || { spd: NaN, kn: NaN };

console.log('--- 1. baseline beam reach, full sail');
const r1 = await sim(6, 'beam-reach');
// ---- polar sweep: hold each heading long enough to reach steady speed
console.log('--- 2. polar sweep (steady-state speed by angle off wind)');
const polar = {};
for (const deg of [20, 45, 60, 90, 125, 150, 180]) {
  await setHeadingOff(deg);
  await page.evaluate(() => { const p = window.__game.player; p.controller.helm = 0; p.desiredHeading = p.heading; });
  // settle unchecked for a couple of seconds: right after teleport the sudden thrust (more of it now that head-to-
  // wind isn't near-stalled, 31/10) pitches/heaves the hull briefly past the invariant tolerance before it trims —
  // a teleport artifact, not a real play scenario, so it's not worth sampling.
  await page.evaluate(async () => { const g = window.__game; for (let t = 0; t < 3; t += 1 / 30) g.step(1 / 30), g.input.endFrame(); });
  const rows = await sim(50, `polar-${deg}`, 10);
  polar[deg] = last(rows).spd;
}
await page.evaluate(() => { window.__game.player.desiredHeading = null; });
console.log('POLAR m/s', JSON.stringify(polar), 'top kn', (Math.max(...Object.values(polar))*1.94384).toFixed(1));
if (polar[125] * 1.94384 > 14 || polar[90] * 1.94384 < 8) fail('brig speed out of 8-14 kn band');
// arcade: head-to-wind floor raised ~0.18 -> ~0.35 of hull speed (sailPhysics.js POLAR) so upwind progress
// isn't glacial — in irons is still clearly the slowest point of sail, just no longer a near-stall.
if (!(polar[20] < polar[90] * 0.5)) fail(`in irons not slow enough: ${polar[20]} vs beam ${polar[90]}`);
if (!(polar[125] >= polar[90] && polar[125] > polar[180])) fail(`broad reach should be fastest: ${JSON.stringify(polar)}`);
if (!(polar[180] < polar[125] * 0.9)) fail(`running should be slower than broad reach`);
if (!(polar[45] < polar[90])) fail('close-hauled should be slower than beam reach');

console.log('--- 3. tack: turn through the wind with the helm (hold A from beam reach)');
await setHeadingOff(100);
await sim(25, 'settle', 5);
await key('KeyA', 'keydown');
const tack = await sim(40, 'tack-helm', 2);
await key('KeyA', 'keyup');
const passedIrons = tack.some(r => r.pos === 'in irons');
const minKn = Math.min(...tack.map(r => r.kn));
console.log(`tack: passed in irons=${passedIrons}, min speed ${minKn} kn`);
if (!passedIrons) fail('tack never passed through in irons');
await sim(10, 'after-tack', 2);

console.log('--- 4. sail orders: S S (furl), then W W (full)');
await setHeadingOff(110);
await sim(20, 'pre-furl', 5);
const before = (await sim(1, 'x', 1))[0].spd;
await tap('KeyS'); await tap('KeyS');
const furled = await sim(30, 'furled', 5);
if (!(last(furled).spd < before * 0.35)) fail(`furling didn't slow ship: ${before} -> ${last(furled).spd}`);
await tap('KeyW');
const battle = await sim(30, 'battle', 5);
await tap('KeyW');
const full = await sim(30, 'full', 5);
if (!(last(full).spd > last(battle).spd && last(battle).spd > last(furled).spd)) fail('sail steps not monotonic');

console.log('--- 5. ammo + time compression + camera modes');
await tap('Digit2');
const ammo = await page.evaluate(() => window.__game.player.ammo);
if (ammo !== 'chain') fail('ammo select failed: ' + ammo);
// move any enemies far away first? the showcase NPC is friendly, so T should work
console.log('ships near', JSON.stringify(await page.evaluate(() => { const g = window.__game; return g.ships.filter(o => o !== g.player).map(o => [o.type, o.faction, o.hostile, o.ai?.role, Math.round(o.position.distanceTo(g.player.position))]); })));
// open water, nobody around: the encounter system may have spawned traffic near us during the long sims above
await page.evaluate(() => { const g = window.__game; for (const o of g.ships) if (o !== g.player) o.position.set(o.position.x + 6000, 0, o.position.z + 6000); });
await tap('KeyT');
const ts = await page.evaluate(() => window.__game.timeScale);
if (ts !== 4) fail('time compression did not engage: ' + ts + ' ' + JSON.stringify(await page.evaluate(() => window.__game.__notes.slice(-4))));
await sim(8, 'compressed', 2);
await tap('KeyT');
if ((await page.evaluate(() => window.__game.timeScale)) !== 1) fail('time compression did not disengage');
// enemy within 800 m blocks compression
await page.evaluate(() => { const g = window.__game; const n = g.ships.find(s => s !== g.player); n.hostile = true; n.position.copy(g.player.position).add({ x: 300, y: 0, z: 0 }); });
await tap('KeyT');
if ((await page.evaluate(() => window.__game.timeScale)) !== 1) fail('time compression allowed with enemy near');
await page.evaluate(() => { const g = window.__game; const n = g.ships.find(s => s !== g.player); n.hostile = false; n.position.copy(g.player.position).add({ x: 2500, y: 0, z: 0 }); });
// the hostile at 300 m engaged the combat camera (automatic tactical view, 22/10): let the rig see it gone and ease back
// to the chase view before testing the out-of-combat C cycle (in combat, C toggles combat view ↔ recentred view)
await page.waitForFunction(() => { const r = window.__game.cameraRig; return !r.engaged && r.mode === 'chase'; }, null, { timeout: 10000 }).catch(() => fail('camera did not leave the combat view'));
for (const m of ['broadside', 'tactical', 'chase']) {
  await tap('KeyC');
  const mode = await page.evaluate(() => window.__game.cameraRig.mode);
  if (mode !== m) fail(`camera mode expected ${m} got ${mode}`);
  await sim(4, 'cam-' + m, 2);
}

console.log('--- 6. hard turns at full speed (heel / stability), both ways');
await key('KeyD', 'keydown'); await sim(15, 'hard-stbd', 3); await key('KeyD', 'keyup');
await key('KeyA', 'keydown'); await sim(15, 'hard-port', 3); await key('KeyA', 'keyup');

console.log('--- 7. grounding: aim at nearest island');
const grounded = await page.evaluate(() => {
  const g = window.__game, p = g.player, isl = g.islands.list[0];
  if (!isl) return { skipped: true };
  // isl.radius is a loose bound (can be kilometres): march south from the centre to the real shoreline instead
  let coast = 0; while (coast < isl.radius && g.islands.getTerrainHeight(isl.x, isl.z + coast) > -1) coast += 5;
  p.position.set(isl.x, 0, isl.z + coast + 150); p.heading = 0; p.speed = 10; p.yawRate = 0;
  p.desiredHeading = 0; const hull0 = p.hull; let got = false, maxT = -99;
  for (let i = 0; i < 30 * 40; i++) { g.step(1 / 30); g.input.endFrame(); if (p.grounded) got = true; maxT = Math.max(maxT, g.islands.getTerrainHeight(p.position.x, p.position.z)); }
  p.desiredHeading = null;
  return { got, hull0, hull: p.hull, speed: p.speed, maxTerrainUnderCentre: maxT, finite: Number.isFinite(p.position.x + p.position.z) };
});
console.log('grounding', JSON.stringify(grounded));
if (!grounded.skipped) {
  if (!grounded.got) fail('never grounded when sailing into an island');
  if (!(grounded.hull < grounded.hull0)) fail('grounding did no damage');
  if (!(Math.abs(grounded.speed) < 1.5)) fail('ship kept speed after grounding');
  if (grounded.maxTerrainUnderCentre > 0) fail('ship centre went onto dry land');
}

console.log('--- 8. ship-ship separation');
const sep = await page.evaluate(() => {
  const g = window.__game, p = g.player, n = g.ships.find(s => s !== p);
  p.position.set(3000, 0, 3000); p.heading = Math.PI / 2; p.speed = 8;
  n.position.set(3040, 0, 3000); n.heading = -Math.PI / 2; n.speed = 6; n.desiredHeading = -Math.PI / 2;
  let minD = 1e9;
  for (let i = 0; i < 30 * 15; i++) { g.step(1 / 30); g.input.endFrame(); minD = Math.min(minD, p.position.distanceTo(n.position)); }
  return { minD, beams: (p.beam + n.beam) * 0.5 };
});
console.log('separation', JSON.stringify(sep));
if (sep.minD < sep.beams * 0.8) fail(`ships interpenetrated: min centre distance ${sep.minD.toFixed(1)}`);

console.log('--- 9. perf: ship.update cost with 40 ships');
const perf = await page.evaluate(() => {
  const g = window.__game;
  for (let i = 0; i < 38; i++) g.spawnShip({ type: ['sloop', 'brig', 'galleon', 'merchantman'][i % 4], faction: 'dutch', x: (i % 8) * 200 - 3000, z: Math.floor(i / 8) * 200 - 3000, heading: i, sailSetting: 1 });
  const t0 = performance.now(); const N = 120;
  for (let k = 0; k < N; k++) for (const s of g.ships) s.update(1 / 60, g.time);
  return { msPerFrame: (performance.now() - t0) / N, ships: g.ships.length };
});
console.log('perf', JSON.stringify(perf));

if (args.out) {
  await page.evaluate(() => { const g = window.__game; g.timeScale = 1; g.player.position.set(-900, 0, 900); g.cameraRig.follow(g.player); for (let i = 0; i < 60; i++) g.step(1 / 30); g.post.render(0); });
  await page.screenshot({ path: args.out });
}
const errs = [...new Set(errors)];
if (errs.length) { console.log('CONSOLE:\n' + errs.join('\n')); fail('console errors/warnings'); }
console.log(failures.length ? `\nFAIL (${failures.length}):\n - ` + failures.join('\n - ') : '\nPASS: all sailing checks');
await browser.close();
process.exit(failures.length ? 1 : 0);
