// Scripted test of the sea rules (Playwright): emergency repairs R (hove to, work only below 1 knot, interrupted by
// making sail or firing, never blocked by a nearby enemy) and the hold at sea I (jettison goods, world frozen while
// open).
// Usage: node tools/test-repair-hold.mjs [--shots folder]   (dev server at TOF_URL, default http://127.0.0.1:5173/)
// Drives ?shot=sailing (HUD on) with window keydown/keyup events — mnemonic keys send `key` as well as `code` — and
// game.step() at 30 Hz with the render loop stopped. Exit code 1 on any failure or console error.
import { chromium } from 'playwright';
import fs from 'node:fs';
import { BASE, launchOpts } from './_env.mjs';

const SHOTS = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch(launchOpts());
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const errors = [], warnings = [];
page.on('console', m => { if (m.type() === 'error') errors.push(`[console] ${m.text()}`); else if (m.type() === 'warning') warnings.push(m.text()); });
page.on('pageerror', e => errors.push('[pageerror] ' + e.message));
await page.goto(`${BASE}?shot=sailing`, { waitUntil: 'load', timeout: 180000 });
await page.waitForFunction(() => window.__ready || window.__error, null, { timeout: 240000, polling: 250 });
const startErr = await page.evaluate(() => window.__error);
if (startErr) { console.log('STARTUP ERROR', startErr); process.exit(1); }
await page.evaluate(() => {
  const g = window.__game; g.renderer.setAnimationLoop(null);
  g.__notes = []; g.events.on('notify', e => g.__notes.push(e.text));
});

const results = [];
const check = (name, ok, info = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); };
const ev = (fn, arg) => page.evaluate(fn, arg);
// optional captures (one rendered frame, the render loop being stopped; CSS transitions do not advance without it,
// so they are switched off for the captures)
let noTransitions = false;
const shot = async name => { if (!SHOTS) return; if (!noTransitions) { noTransitions = true; await page.addStyleTag({ content: '*{transition:none!important;animation:none!important}' }); } await ev(() => { const g = window.__game; g.hud?.update?.(1 / 60); g.post.render(1 / 60); }); await page.screenshot({ path: `${SHOTS}/${name}.png` }); };
// one key press on document.body like a real keystroke (window capture listeners — the hold sheet — run before the
// HUD's bubbling ones): keydown, one simulation frame (the controller reads input.pressed / pressedKey), keyup
const KEYS = { ArrowDown: 'ArrowDown', KeyR: 'r', KeyI: 'i', KeyW: 'w', KeyS: 's', KeyQ: 'q', KeyE: 'e', Escape: 'Escape', Enter: 'Enter', ArrowRight: 'ArrowRight' };
const tap = async (code, { step = true, shift = false } = {}) => {
  await ev(([code, key, shift]) => document.body.dispatchEvent(new KeyboardEvent('keydown', { code, key, shiftKey: shift, bubbles: true })), [code, KEYS[code] || code, shift]);
  if (step) await ev(() => { const g = window.__game; g.step(g.frozen ? 0 : 1 / 30); g.input.endFrame(); });
  await ev(([code, key]) => document.body.dispatchEvent(new KeyboardEvent('keyup', { code, key, bubbles: true })), [code, KEYS[code] || code]);
};
// simulate `secs` of game time at 30 Hz (respects game.frozen like the real loop)
const sim = secs => ev(secs => { const g = window.__game; for (let i = 0; i < Math.round(secs * 30); i++) { g.step(g.frozen ? 0 : 1 / 30 * g.timeScale); g.input.endFrame(); } }, secs);
const notes = () => ev(() => window.__game.__notes.slice());
const ship = () => ev(() => {
  const g = window.__game, p = g.player, a = document.querySelector('.helm .a-rep');
  return { kn: p.speed * 1.94384, speed: p.speed, hull: p.hull, hullMax: p.hullMax, sails: p.sails, repairing: !!p.repairing, wait: !!p.repairWait,
    step: p.controller?.sailStep, sailSetting: p.sailSetting, pill: a?.className || '', pillTitle: a?.title || '', frozen: g.frozen, mode: g.mode };
});

// ---------------------------------------------------------------- setup: damaged brig under way, pirate at 800 m
const setup = await ev(() => {
  const g = window.__game, p = g.player;
  for (const s of g.ships) if (s !== p && s.name === 'La Vigilante') s.position.x += 5000;   // the companion frigate out of the way
  p.crew = p.crewMax; p.fires = p.fires || [];
  const f = p.forward(), r = p.right();
  const e = g.combat.spawnAI({ type: 'sloop', faction: 'pirate', role: 'pirate', x: p.position.x + r.x * 800, z: p.position.z + r.z * 800, heading: p.heading, sailSetting: 0, name: 'Le Requin' });
  e.controller = { update() {} };   // lies to 800 m abeam: an enemy nearby that never moves nor fires
  e.speed = 0;
  g.__pirate = e;
  const near = p.controller.nearestEnemy(1000);
  return { kn: p.speed * 1.94384, enemy: near === e, dist: Math.hypot(e.position.x - p.position.x, e.position.z - p.position.z) };
});
check('setup: pirate hostile at ~800 m, brig under way', setup.enemy && Math.abs(setup.dist - 800) < 5 && setup.kn > 3, `${setup.dist.toFixed(0)} m, ${setup.kn.toFixed(1)} kn`);

// nothing to repair: R refuses and leaves the sails alone
let s0 = await ship();
await tap('KeyR');
let s1 = await ship();
check('R with nothing to repair: refused, sails untouched', !s1.repairing && s1.step === s0.step && s1.sailSetting === s0.sailSetting && (await notes()).some(t => /Nothing to repair/.test(t)));

// ---------------------------------------------------------------- R heaves to; no work above 1 knot
await ev(() => { const p = window.__game.player; p.hull = p.hullMax * 0.4; p.sails = 0.45; });
s0 = await ship();
await tap('KeyR');
await sim(0.1);   // the HUD refreshes on the next frames
s1 = await ship();
check('R furls the sails (sail step 0) and orders repairs', s1.repairing && s1.step === 0 && s1.sailSetting === 0, `step ${s0.step} → ${s1.step}`);
await shot('01-r-wait');
check('R under way: waiting state (pill « wait », tooltip « à l’arrêt »)', s1.wait && /\bwait\b/.test(s1.pill) && /must be stopped/.test(s1.pillTitle), `${s1.kn.toFixed(1)} kn, pill "${s1.pill}"`);
const slow = await ev(() => {
  const g = window.__game, p = g.player, h0 = p.hull, s0 = p.sails; let hMax = h0, sMax = s0, t = 0, waitSeen = 0;
  while (Math.abs(p.speed) > 0.514 && t < 90) { g.step(1 / 30); g.input.endFrame(); t += 1 / 30; if (p.repairWait) { waitSeen++; hMax = Math.max(hMax, p.hull); sMax = Math.max(sMax, p.sails); } }
  return { t, h0, hMax, s0, sMax, kn: p.speed * 1.94384, waitSeen, repairing: p.repairing };
});
check('no repair work while the ship makes more than 1 knot', slow.waitSeen > 10 && slow.hMax <= slow.h0 + 1e-6 && slow.sMax <= slow.s0 + 1e-6, `${slow.t.toFixed(1)} s to slow down, hull ${slow.h0.toFixed(1)} → max ${slow.hMax.toFixed(1)}`);
check('ship drops below 1 knot with the sails furled', slow.kn <= 1 && slow.repairing, `${slow.kn.toFixed(2)} kn after ${slow.t.toFixed(1)} s`);

// ---------------------------------------------------------------- hove to: repairs go on, pirate still at 800 m
await sim(0.2);
const h1 = await ship();
await sim(5);
const h2 = await ship();
const near = await ev(() => { const g = window.__game, p = g.player; return p.controller.nearestEnemy(1000) === g.__pirate; });
const gain = (h2.hull - h1.hull) / h2.hullMax;
check('repairs at a stop with a pirate at 800 m (no distance test)', near && h2.repairing && !h2.wait && gain > 0.08, `hull +${(gain * 100).toFixed(1)} % in 5 s, sails ${h1.sails.toFixed(3)} → ${h2.sails.toFixed(3)}`);
await shot('02-r-on');
check('pill « on » while working', /\bon\b/.test(h2.pill) && !/\bwait\b/.test(h2.pill), h2.pill);
check('rate ×2: ~2 %/s of hull with a full crew', gain > 0.09 && gain < 0.11, `${(gain * 20).toFixed(2)} %/s`);
const rl = await ev(() => { const g = window.__game, p = g.player, a = g.combat.reloadTime(p); const was = p.repairing; p.repairing = false; const b = g.combat.reloadTime(p); p.repairing = was; return a / b; });
check('reload ×1.8 kept during repairs', Math.abs(rl - 1.8) < 0.01, `ratio ${rl.toFixed(2)}`);

// ---------------------------------------------------------------- making sail interrupts
await tap('KeyW');
const w1 = await ship();
const n1 = await notes();
check('making sail (W) interrupts repairs', !w1.repairing && w1.step === 1 && n1.some(t => /Repairs interrupted: making sail/.test(t)));
await sim(2);
const w2 = await ship();
check('no repair once under sail', w2.hull <= w1.hull + 1e-6 && w2.sails <= w1.sails + 1e-6);

// ---------------------------------------------------------------- firing interrupts
await tap('KeyS');
await ev(() => { const g = window.__game, p = g.player; for (let t = 0; t < 90 && Math.abs(p.speed) > 0.3; t += 1 / 30) { g.step(1 / 30); g.input.endFrame(); } });
await tap('KeyR');
await sim(0.5);
const f0 = await ship();
await ev(() => { const p = window.__game.player; p.reload.port = 1; p.reload.starboard = 1; });
await tap('KeyQ');
const f1 = await ship();
const n2 = await notes();
const fired = await ev(() => window.__game.player.reload.port < 0.5);
check('repairs resumed at a stop before firing', f0.repairing && !f0.wait);
check('firing a broadside (Q) interrupts repairs', fired && !f1.repairing && n2.some(t => /all hands to the guns/.test(t)));

// ---------------------------------------------------------------- the hold (I)
const h0 = await ev(() => { const g = window.__game; g.state.cargo = { sugar: 60, rum: 10 }; g.state.food = 40; g.step(1 / 30); g.input.endFrame(); return { gold: g.state.gold }; });
await tap('KeyI');
const o1 = await ev(() => {
  const g = window.__game, el = document.querySelector('.hold-screen');
  return { open: !!g.hold?.isOpen, frozen: g.frozen, mode: g.mode, on: el?.classList.contains('on'), rows: el?.querySelectorAll('tr[data-row]').length,
    used: g.hold?.manifest && Object.entries(g.hold.manifest.own).reduce((a, [, q]) => a + q, 0), cap: g.hold?.manifest?.cap, title: el?.querySelector('h2')?.textContent };
});
check('I opens the hold: world frozen, sheet shown, 3 lots + the guns row', o1.open && o1.frozen && o1.mode === 'map' && o1.on && o1.rows === 4, `${o1.title} · ${o1.used}/${o1.cap}`);
const t0 = await ev(() => window.__game.time);
await sim(1);
const t1 = await ev(() => window.__game.time);
check('world frozen while the hold is open', t1 === t0);
await ev(() => document.querySelector('.hold-screen tr[data-k="sugar"] button[data-mv="out"][data-n="10"]').click());
await tap('ArrowDown', { step: false });
await shot('03-hold');
const o2 = await ev(() => { const m = window.__game.hold.manifest; return { own: m.own.sugar, out: m.prize.sugar, gauge: document.querySelector('.hold-screen .ts-gauge b')?.textContent, speed: document.querySelector('.hold-screen .h-speed')?.textContent }; });
check('button 10 moves 10 sugar to the « par-dessus bord » pile', o2.own === 50 && o2.out === 10, `${o2.gauge} · ${o2.speed}`);
await tap('Escape', { step: false });
const o3 = await ev(() => { const g = window.__game; return { open: g.hold.isOpen, frozen: g.frozen, mode: g.mode, sugar: g.state.cargo.sugar, menu: !!g.hud?.menu?.isOpen }; });
check('Échap closes without throwing anything, world unfrozen, no pause menu', !o3.open && !o3.frozen && o3.mode === 'sail' && o3.sugar === 60 && !o3.menu, JSON.stringify(o3));

await sim(1.2);                                     // career re-checks the overload every second
await tap('KeyI');
const lf0 = await ev(() => window.__game.player.loadSpeedF);
await ev(() => document.querySelector('.hold-screen tr[data-k="sugar"] button[data-mv="out"][data-n="10"]').click());
await tap('ArrowRight', { step: false });          // keyboard: one more barrel of the selected row (sugar)
await ev(() => document.querySelector('.hold-screen button[data-act="apply"]').click());
const o4 = await ev(() => {
  const g = window.__game, st = g.state; let used = 0; for (const k in st.cargo) used += st.cargo[k]; used += st.food;
  return { open: g.hold.isOpen, frozen: g.frozen, mode: g.mode, sugar: st.cargo.sugar, rum: st.cargo.rum, food: st.food, used, loadF: g.player.loadSpeedF, gold: st.gold };
});
const n3 = await notes();
check('« Jeter par-dessus bord » applies: 11 sugar overboard, hold lighter', !o4.open && !o4.frozen && o4.mode === 'sail' && o4.sugar === 49 && o4.rum === 10 && o4.food === 40 && o4.used === 99, `used ${o4.used}`);
check('speed penalty eased at once (ship.loadSpeedF)', o4.loadF > lf0 && o4.loadF < 1, `${lf0.toFixed(3)} → ${o4.loadF.toFixed(3)}`);
check('journal/toast « 11 barriques de sucre par-dessus bord »', n3.includes('11 hogsheads of sugar overboard'));
await sim(2);
const lf2 = await ev(() => window.__game.player.loadSpeedF);
check('career keeps the same load factor', Math.abs(lf2 - o4.loadF) < 1e-9, lf2.toFixed(3));

// provisions too, and I closes the sheet
await tap('KeyI');
await ev(() => document.querySelector('.hold-screen tr[data-k="food"] button[data-mv="out"][data-n="1000000000"]').click());
await tap('Enter', { step: false });
const o5 = await ev(() => ({ food: window.__game.state.food, open: window.__game.hold.isOpen }));
check('provisions can go overboard too (Tout + Entrée)', o5.food === 0 && !o5.open);
await tap('KeyI');
const o6 = await ev(() => window.__game.hold.isOpen);
await tap('KeyI', { step: false });
const o7 = await ev(() => ({ open: window.__game.hold.isOpen, frozen: window.__game.frozen }));
check('I toggles the sheet closed again', o6 && !o7.open && !o7.frozen);
await sim(1);
const fin = await ship();
check('game runs after the hold closes', !fin.frozen && fin.mode === 'sail');

// guns thrown overboard (by 2) — lighter (speedMul), smaller broadside, barrels astern, rearmed at the yard
const g0 = await ev(() => { const g = window.__game, p = g.player; g.state.cargo = { sugar: 30 }; g.state.upgrades = g.state.upgrades || {}; g.state.upgrades.gunsLost = 0;
  return { guns: p.guns, max: p.spec.guns, speedMul: p.speedMul, wreck: g.fx.stats().wreck }; });
await tap('KeyI');
await ev(() => document.querySelector('.hold-screen tr[data-k="__guns"] button[data-mv="gout"][data-n="2"]').click());
await ev(() => document.querySelector('.hold-screen tr[data-k="__guns"] button[data-mv="gout"][data-n="2"]').click());
await ev(() => document.querySelector('.hold-screen tr[data-k="sugar"] button[data-mv="out"][data-n="10"]').click());
const gm = await ev(() => ({ g: { ...window.__game.hold.manifest.guns }, line: document.querySelector('.hold-screen .h-guns')?.textContent || '' }));
check('guns row: two clicks put 4 guns on the jettison pile, speed preview shown', gm.g.out === 4 && gm.g.own === g0.guns - 4 && /4\s?guns into the sea/.test(gm.line), gm.line);
await shot('05-hold-guns');
await ev(() => document.querySelector('.hold-screen button[data-act="apply"]').click());
const g1 = await ev(() => { const g = window.__game, p = g.player; return { guns: p.guns, speedMul: p.speedMul, lost: g.state.upgrades.gunsLost, wreck: g.fx.stats().wreck, note: g.__notes[g.__notes.length - 1] }; });
check('applied: ship.guns −4, state.upgrades.gunsLost 4, faster (speedMul up)', g1.guns === g0.guns - 4 && g1.lost === 4 && g1.speedMul > g0.speedMul, `${g0.guns} → ${g1.guns} canons, speedMul ${g0.speedMul.toFixed(3)} → ${g1.speedMul.toFixed(3)}`);
check('message names the guns and the goods', /^4\s?guns and 10 hogsheads of sugar overboard/.test(g1.note || ''), g1.note);
check('barrels float astern (fx.flotsam, wreckage mesh)', g1.wreck > g0.wreck, `${g0.wreck} → ${g1.wreck}`);
// broadside: fewer guns fire per side (ship.guns / 2)
const bs = await ev(() => { const g = window.__game, p = g.player, c = g.combat; p.reload.port = 1; p.crew = p.crewMax; let n = 0;
  const off = g.events.on?.('cannon:fire', e => { if (e.ship === p) n = e.count; }); c.fireBroadside(p, 'port'); off?.(); return { n, perSide: Math.ceil(p.guns / 2) }; });
check('broadside fires ship.guns / 2 pieces', bs.n > 0 && bs.n <= bs.perSide, `${bs.n} coups pour ${bs.perSide} pièces par bord`);
// rearm at the shipyard (radoub): PortSystem.rearm restores the guns and the speed
const rr = await ev(() => { const g = window.__game, P = g.ports; g.state.gold = 5000; const info = P.rearmInfo(); P.rearm(); const p = g.player;
  return { info, guns: p.guns, lost: g.state.upgrades.gunsLost, speedMul: p.speedMul, gold: g.state.gold }; });
check('radoub: « Remettre des canons » restores every gun and the speed', rr.guns === g0.guns && rr.lost === 0 && Math.abs(rr.speedMul - g0.speedMul) < 1e-9 && rr.info.lost === 4,
  `${rr.info.cost} pièces, ${rr.guns} canons`);

await browser.close();
if (warnings.length) console.log(`(${warnings.length} console warnings, first: ${warnings[0]})`);
check('zero console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
const bad = results.filter(r => !r.ok);
console.log(`\n${results.length - bad.length}/${results.length} PASS`);
process.exit(bad.length ? 1 : 0);
