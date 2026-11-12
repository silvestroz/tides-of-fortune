// Test of the camera (2026-11-12: the player owns the view). Nothing changes the view by itself: a fight leaves it
// behind the ship, the orbit stays where the mouse left it and follows the mouse directly; C cycles the three views;
// the chase view sits close to the ship; a ship's nameplate shows under the cursor only, the target card stays.
// Usage: node tools/test-camera.mjs [--shots folder]   (dev server TOF_URL, GPU by default, --soft = SwiftShader)
// ?shot=sailing&hints=1, render loop stopped, game.step() at 30 Hz; keys sent with `key` and `code`.
import { chromium } from 'playwright';
import fs from 'node:fs';
import { BASE, launchOpts } from './_env.mjs';

const SHOTS = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch(launchOpts(['--disable-dev-shm-usage']));
const page = await browser.newPage({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(`[console] ${m.text()}`); });
page.on('pageerror', e => errors.push('[pageerror] ' + e.message));
await page.goto(`${BASE}?shot=sailing&hints=1`, { waitUntil: 'load', timeout: 180000 });
await page.waitForFunction(() => window.__ready || window.__error, null, { timeout: 240000, polling: 250 });
const startErr = await page.evaluate(() => window.__error);
if (startErr) { console.log('STARTUP ERROR', startErr); process.exit(1); }
await page.evaluate(() => { const g = window.__game; g.renderer.setAnimationLoop(null); });

const results = [];
const check = (name, ok, info = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); };
const ev = (fn, arg) => page.evaluate(fn, arg);
let noTransitions = false;
const shot = async name => {
  if (!SHOTS) return;
  if (!noTransitions) { noTransitions = true; await page.addStyleTag({ content: '*{transition:none!important;animation:none!important}' }); }
  await ev(() => { const g = window.__game; g.hud?.update?.(1 / 60); g.post.render(1 / 60); });
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
};
const KEYS = { KeyC: 'c', KeyE: 'e', Escape: 'Escape' };
const tap = async code => {
  await ev(([code, key]) => document.body.dispatchEvent(new KeyboardEvent('keydown', { code, key, bubbles: true })), [code, KEYS[code] || code]);
  await ev(() => { const g = window.__game; g.step(1 / 30); g.input.endFrame(); });
  await ev(([code, key]) => document.body.dispatchEvent(new KeyboardEvent('keyup', { code, key, bubbles: true })), [code, KEYS[code] || code]);
};
const sim = secs => ev(secs => { const g = window.__game; for (let i = 0; i < Math.round(secs * 30); i++) { g.step(1 / 30); g.input.endFrame(); } g.hud?.update?.(1 / 30); }, secs);
const cam = () => ev(() => {
  const g = window.__game, r = g.cameraRig, c = document.querySelector('.helm .cam-pill'), h = g.hud.hints;
  const p = g.player, d = r.camPos.distanceTo(p.position);
  return { mode: r.mode, engaged: !!r.engaged, chip: c && !c.hidden ? c.querySelector('.al')?.textContent || '' : '', cls: c?.className || '', title: c?.title || '',
    dist: Math.round(d), hint: [h.current?.key, ...(h.queue || []).map(q => q.key || q)].filter(Boolean) };
});
// a shot received from the enemy (no damage): the engagement lasts as long as shots keep coming
const hit = () => ev(() => { const g = window.__game; g.events.emit('cannon:hit', { target: g.player, attacker: window.__foe }); });

// ---------------------------------------------------------------- a pirate at 350 m abeam to starboard
await ev(() => {
  const g = window.__game, p = g.player;
  for (const s of [...g.ships]) if (s !== p) g.combat._despawn(s);
  g.combat.setTrafficTarget?.(0);
  const r = p.right();
  const e = window.__foe = g.combat.spawnAI({ type: 'sloop', faction: 'pirate', role: 'pirate', x: p.position.x + r.x * 350, z: p.position.z + r.z * 350, heading: p.heading, sailSetting: 0, name: 'Le Requin' });
  e.controller = { update() {} }; e.speed = 0;
});
await sim(1);
let c = await cam();
const L = await ev(() => window.__game.player.length || 30);
check('before the fight: chase view, no C pill', c.mode === 'chase' && !c.engaged && c.chip === '', JSON.stringify(c));
check('chase view close to the ship (under 2.6 ship lengths; it was about 4)', c.dist < L * 2.6 && c.dist > L * 1.1, `${c.dist} m for a ${Math.round(L)} m ship`);
await shot('01-chase-close');

await tap('KeyE');   // starboard broadside at the pirate
await sim(1.5);
c = await cam();
check('first broadside: engaged, the view does not change, no pill', c.mode === 'chase' && c.engaged && c.chip === '', `${c.mode} engaged=${c.engaged} chip=${c.chip}`);
for (let i = 0; i < 5; i++) { await hit(); await sim(1.2); }
c = await cam();
check('the fight goes on: still behind the ship', c.mode === 'chase' && c.engaged, `${c.mode} engaged=${c.engaged}`);
check('« Your view » hint offered once', c.hint.includes('camera') || await ev(() => !!window.__game.state.tutorials?.hints?.camera), c.hint.join(','));

// right-drag orbit: follows the mouse at once, and stays there
const orb = await ev(() => {
  const g = window.__game, r = g.cameraRig, m = g.input.mouse;
  const yaw0 = r.orbitYaw;
  m.buttons = 2; m.dx = 160; m.dy = -40; g.step(1 / 30);
  const direct = Math.abs(r._orbitYawS - r.orbitYaw) < 1e-6 && Math.abs(r._orbitPitchS - r.orbitPitch) < 1e-6, yaw = r.orbitYaw, pitch = r.orbitPitch;
  g.input.endFrame(); m.buttons = 0; m.dx = m.dy = 0;
  return { direct, yaw, pitch, turned: Math.abs(Math.atan2(Math.sin(yaw - yaw0), Math.cos(yaw - yaw0))) };
});
check('right-drag: the orbit follows the mouse with no lag', orb.direct && Math.abs(orb.turned - 0.88) < 0.02, JSON.stringify(orb));
await sim(9);
const orb2 = await ev(() => { const r = window.__game.cameraRig; return { yaw: r.orbitYaw, pitch: r.orbitPitch }; });
check('9 s without input: the orbit has not drifted back', Math.abs(orb2.yaw - orb.yaw) < 1e-6 && Math.abs(orb2.pitch - orb.pitch) < 1e-6, JSON.stringify(orb2));
await shot('02-orbit-kept');
await ev(() => { const r = window.__game.cameraRig; r.orbitYaw = r.orbitPitch = 0; });

// Options « Invert vertical axis »: Off by default, flips the vertical drag, saved
const inv = await ev(() => {
  const g = window.__game, r = g.cameraRig, m = g.input.mouse;
  const drag = () => { r.orbitPitch = 0; m.buttons = 2; m.dx = 0; m.dy = 60; g.step(1 / 30); const v = r.orbitPitch; g.input.endFrame(); m.buttons = 0; m.dy = 0; return v; };
  const def = !!g.settings.invertY, normal = drag();
  g.hud.menu.open('settings');
  const seg = document.querySelector('.menu-layer .inv-seg'), sel0 = seg?.querySelector('.sel')?.dataset.inv;
  seg?.querySelector('[data-inv="1"]')?.click();
  const saved = JSON.parse(localStorage.getItem('tof.settings.v1') || '{}').invertY, label = seg?.closest('.srow')?.querySelector('.sl')?.textContent;
  g.hud.menu.close();
  const flipped = drag();
  g.hud.menu.open('settings'); document.querySelector('.menu-layer .inv-seg [data-inv="0"]')?.click(); g.hud.menu.close();
  const back = drag(); r.orbitPitch = 0;
  const s0 = g.settings.mouseSensitivity; g.settings.mouseSensitivity = 2; const fast = drag(); g.settings.mouseSensitivity = s0; r.orbitPitch = 0;
  return { def, sel0, label, saved, now: g.settings.invertY, normal, flipped, back, fast };
});
check('Options: « Invert vertical axis », Off by default, saved', inv.label === 'Invert vertical axis' && inv.def === false && inv.sel0 === '0' && inv.saved === true, JSON.stringify(inv));
check('default: mouse down lifts the camera; inverted: it lowers it; Off again: back', inv.normal > 0.1 && inv.flipped < -0.1 && Math.abs(inv.back - inv.normal) < 1e-9, `${inv.normal} / ${inv.flipped} / ${inv.back}`);
check('Options « Mouse » ×2: the orbit turns twice as fast', Math.abs(inv.fast - inv.normal * 2) < 1e-9, `${inv.normal} → ${inv.fast}`);

// C cycles the three views, in a fight too
await hit(); await tap('KeyC'); await sim(1);
c = await cam();
check('C in a fight: gunner’s view, pill « Overview »', c.mode === 'broadside' && c.chip === 'Overview', `${c.mode} ${c.chip}`);
await tap('KeyC'); await sim(1);
c = await cam();
check('C again: overview, pill « Behind the ship »', c.mode === 'tactical' && c.chip === 'Behind the ship', `${c.mode} ${c.chip}`);
const platesTac = await ev(() => [...document.querySelectorAll('.tof-plate')].filter(e => e.style.opacity !== '0' && e.style.opacity !== '').length);
check('overview: no nameplate without the cursor', platesTac === 0, `${platesTac} plate(s)`);
await shot('03-overview');
await tap('KeyC'); await sim(1.5);
c = await cam();
check('C again: back behind the ship', c.mode === 'chase' && c.chip === '', `${c.mode} ${c.chip}`);

// nameplate under the cursor only; the target card keeps the nearest hostile
const hover = async on => ev(on => {
  const g = window.__game, e = window.__foe, cv = g.renderer.domElement, np = g.nameplates;
  g.camera.updateMatrixWorld();
  const v = e.position.clone(); v.y += (e.length || 30) * 0.4; v.project(g.camera);
  const x = on ? (v.x * 0.5 + 0.5) * innerWidth : 40, y = on ? (-v.y * 0.5 + 0.5) * innerHeight : innerHeight * 0.45;
  cv.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, bubbles: true }));
  np.update(1 / 30);
  const vis = [...document.querySelectorAll('.tof-plate')].filter(d => d.style.opacity !== '0' && d.style.opacity !== '');
  return { onScreen: Math.abs(v.x) < 1 && Math.abs(v.y) < 1 && v.z < 1, hovered: np.hovered?.name || null, plates: vis.length, text: vis[0]?.textContent || '', active: !!np.active, target: g.hud.target?.name || null };
}, on);
await ev(() => { const g = window.__game, p = g.player, e = window.__foe; const f = { x: Math.sin(p.heading), z: -Math.cos(p.heading) }, r = p.right(); e.position.x = p.position.x + f.x * 260 + r.x * 60; e.position.z = p.position.z + f.z * 260 + r.z * 60; });
await sim(2);
let h = await hover(false);
check('cursor away from any ship: no nameplate, target card still on the pirate', h.onScreen && h.plates === 0 && !h.hovered && h.target === 'Le Requin', JSON.stringify(h));
h = await hover(true);
check('cursor on the pirate: her nameplate, and only hers', h.hovered === 'Le Requin' && h.plates === 1 && /Le Requin/.test(h.text) && !h.active, JSON.stringify(h));
await shot('04-hover-plate');
h = await hover(false);
check('cursor off again: the nameplate goes', h.plates === 0 && !h.hovered, JSON.stringify(h));

// end of the engagement, then the Options
await ev(() => { const g = window.__game, p = g.player, e = window.__foe; e.position.x = p.position.x + 4000; e.position.z = p.position.z + 4000; });
await sim(10);
c = await cam();
check('end of the fight: no longer engaged, same view', !c.engaged && c.mode === 'chase' && c.chip === '', JSON.stringify({ mode: c.mode, engaged: c.engaged }));
const opt = await ev(() => { const g = window.__game; g.hud.menu.open('settings'); const out = { cam: !!document.querySelector('.menu-layer .cam-seg'), text: /Combat camera/.test(document.querySelector('.menu-layer')?.textContent || '') }; g.hud.menu.close(); return out; });
check('Options: the « Combat camera » row is gone', !opt.cam && !opt.text, JSON.stringify(opt));
check('zero console errors', !errors.length, errors.slice(0, 4).join(' | '));

await browser.close();
const bad = results.filter(x => !x).length;
console.log(`\n${results.length - bad}/${results.length} PASS`);
process.exit(bad ? 1 : 0);
