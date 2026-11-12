// Pirates stand and fight, and a fleeing one that is caught strikes in reasonable time (2026-11-12).
// Before: a pirate fled as soon as it was much weaker than its target (odds < 0.3) and, with its hull still sound,
// could never strike (minStrikeHull): hunting a small pirate with a big ship was an endless stern chase.
// Usage: node tools/test-pirate-chase.mjs   (dev server TOF_URL, GPU by default, --soft = SwiftShader)
// ?shot=sailing, render loop stopped, game.step() at 30 Hz. The player is kept on station behind the pirate.
import { chromium } from 'playwright';
import { BASE, launchOpts } from './_env.mjs';

const browser = await chromium.launch(launchOpts(['--disable-dev-shm-usage']));
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(`[console] ${m.text()}`); });
page.on('pageerror', e => errors.push('[pageerror] ' + e.message));
await page.goto(`${BASE}?shot=sailing`, { waitUntil: 'load', timeout: 180000 });
await page.waitForFunction(() => window.__ready || window.__error, null, { timeout: 240000, polling: 250 });
await page.evaluate(() => { window.__game.renderer.setAnimationLoop(null); });
const results = [];
const check = (name, ok, info = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); };

// one scenario: a pirate sloop 300 m ahead; the player (kept `gap` m astern, same speed) has fired on her once.
// Returns the pirate's state after 6 s and the time she took to strike (null: not within `maxS` seconds).
const run = (opts) => page.evaluate(({ guns, playerGuns, hull, crew, gap, maxS }) => {
  const g = window.__game, p = g.player;
  for (const s of [...g.ships]) if (s !== p) g.combat._despawn(s);
  g.combat.setTrafficTarget?.(0);
  p.guns = playerGuns; p.hull = p.hullMax; p.crew = p.crewMax; p.sails = 1;
  const f = { x: Math.sin(p.heading), z: -Math.cos(p.heading) };
  const e = g.combat.spawnAI({ type: 'sloop', faction: 'pirate', role: 'pirate', x: p.position.x + f.x * 300, z: p.position.z + f.z * 300, heading: p.heading, name: 'Le Requin' });
  e.guns = guns; e.hull = e.hullMax * hull; e.crew = e.crewMax * crew;
  e.grudges?.add(p); e.ai.target = p; e.ai.lastHitT = g.time;
  const fire = p.fireBroadside ? null : null;
  let state6 = null, struckAt = null, minD = 1e9, maxD = 0;
  const N = Math.round(maxS * 30);
  for (let i = 0; i < N; i++) {
    // the player holds station astern of the pirate: a pursuer that has caught up and keeps up
    const h = e.heading, ex = Math.sin(h), ez = -Math.cos(h);
    p.position.x = e.position.x - ex * gap; p.position.z = e.position.z - ez * gap; p.heading = h; p.speed = e.speed; p.velocity.x = e.velocity.x; p.velocity.z = e.velocity.z;
    p.controller && (p.sailSetting = 1);
    g.step(1 / 30); g.input.endFrame();
    const d = Math.hypot(p.position.x - e.position.x, p.position.z - e.position.z); minD = Math.min(minD, d); maxD = Math.max(maxD, d);
    if (i === 180) state6 = e.ai.state;
    if (e.struck && struckAt == null) { struckAt = +(i / 30).toFixed(1); break; }
    if (!e.alive || e.sinking) break;
  }
  return { state6: state6 ?? e.ai.state, struckAt, alive: e.alive && !e.sinking, hull: +(e.hull / e.hullMax).toFixed(2), odds: +(((e.guns + 4) * Math.min(1, .3 + e.crew / e.crewMax) * Math.max(.05, e.hull / e.hullMax)) / (p.guns + 4)).toFixed(2), morale: +e.ai.morale.toFixed(2) };
}, opts);

// 1. a small pirate against a much stronger ship (odds about 0.2), hull sound: she fights
let r = await run({ guns: 4, playerGuns: 36, hull: 1, crew: 1, gap: 260, maxS: 8 });
check('weak but sound pirate against a big ship: she stands and fights (no flight on the odds alone)', r.state6 === 'engage', JSON.stringify(r));
// 2. badly holed (hull 25 %): she runs, and strikes once caught
r = await run({ guns: 8, playerGuns: 14, hull: 0.25, crew: 0.8, gap: 260, maxS: 150 });
check('holed pirate (hull 25 %) runs…', r.state6 === 'flee' || r.struckAt != null, JSON.stringify(r));
check('…and strikes within 60 s with her pursuer 260 m astern', r.struckAt != null && r.struckAt <= 60, `struck at ${r.struckAt} s`);
// 3. crew cut down (15 %) with a sound hull: she runs, and can strike too (she could not before)
r = await run({ guns: 8, playerGuns: 14, hull: 0.9, crew: 0.15, gap: 260, maxS: 150 });
check('pirate with her crew cut down (15 %), hull sound: she strikes within 60 s once caught', r.struckAt != null && r.struckAt <= 60, JSON.stringify(r));
// 4. a pursuer that stays far (450 m) does not get a free prize
r = await run({ guns: 8, playerGuns: 14, hull: 0.25, crew: 0.8, gap: 700, maxS: 40 });
check('pursuer 700 m astern: no surrender at that distance', r.struckAt == null, JSON.stringify(r));
check('zero console errors', !errors.length, errors.slice(0, 3).join(' | '));
await browser.close();
const bad = results.filter(x => !x).length;
console.log(`\n${results.length - bad}/${results.length} PASS`);
process.exit(bad ? 1 : 0);
