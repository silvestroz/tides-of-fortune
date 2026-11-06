// Test of the combat camera (playtest feedback: "the combat view is forced on me"): the tactical view switches on at
// the first gunshot, C recentres it behind the ship (and keeps it there until the engagement ends), C brings it
// back; Options setting « Caméra en combat » Automatique / Manuelle; the HUD's C pill; « Vue de combat » hint.
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
await page.evaluate(() => { const g = window.__game; g.renderer.setAnimationLoop(null); g.settings.combatCam = 'auto'; });

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
check('avant le combat : poursuite, pas de pastille C', c.mode === 'chase' && !c.engaged && c.chip === '', JSON.stringify(c));

await tap('KeyE');   // starboard broadside at the pirate
await sim(1.5);
c = await cam();
check('premier coup de canon : vue de combat automatique, pastille « Recentrer »', c.mode === 'tactical' && c.engaged && c.chip === 'Recentre' && /fight/.test(c.cls), `${c.mode} ${c.chip} ${c.cls}`);
check('conseil « Vue de combat » proposé une fois', c.hint.includes('camera') || await ev(() => !!window.__game.state.tutorials?.hints?.camera), c.hint.join(','));
const tacDist = c.dist;
await shot('01-vue-combat');

await tap('KeyC');
await sim(1.5);
c = await cam();
check('C : caméra recentrée derrière le navire (poursuite), pastille « Vue de combat »', c.mode === 'chase' && c.engaged && c.chip === 'Combat view', `${c.mode} ${c.chip}, ${tacDist} m → ${c.dist} m`);
for (let i = 0; i < 4; i++) { await hit(); await sim(1); }
c = await cam();
check('le combat continue : la vue reste recentrée (pas de rebascule)', c.mode === 'chase' && c.engaged, `${c.mode} engaged=${c.engaged}`);
await shot('02-recentree');

await tap('KeyC');
await sim(1);
c = await cam();
check('C encore : retour à la vue de combat', c.mode === 'tactical' && c.chip === 'Recentre', c.mode);
await tap('KeyC');
await sim(0.5);
c = await cam();
check('C depuis la vue de combat choisie : de nouveau recentrée', c.mode === 'chase', c.mode);

// end of the engagement: enemy far away, no shot at all for 8 s
await ev(() => { const g = window.__game, p = g.player, e = window.__foe; e.position.x = p.position.x + 4000; e.position.z = p.position.z + 4000; });
await sim(10);
c = await cam();
check('fin du combat : plus engagé, pastille masquée', !c.engaged && c.mode === 'chase' && c.chip === '', JSON.stringify({ mode: c.mode, engaged: c.engaged }));

// « Manuelle » setting: never switches by itself
await ev(() => { const g = window.__game, p = g.player, e = window.__foe, r = p.right(); g.settings.combatCam = 'manual'; e.position.x = p.position.x + r.x * 350; e.position.z = p.position.z + r.z * 350; });
await hit(); await sim(1.5);
c = await cam();
check('Caméra en combat « Manuelle » : le combat ne change pas la vue (pastille « Vue de combat »)', c.mode === 'chase' && c.engaged && c.chip === 'Combat view', `${c.mode} engaged=${c.engaged}`);
await ev(() => { window.__game.settings.combatCam = 'auto'; });
await hit(); await sim(1);
c = await cam();
check('« Automatique » rétabli en plein combat : vue de combat', c.mode === 'tactical', c.mode);
await ev(() => { window.__game.settings.combatCam = 'manual'; });
await sim(0.5);
c = await cam();
check('passer en « Manuelle » pendant une vue automatique la rend tout de suite', c.mode === 'chase', c.mode);

// Options: « Caméra en combat » row, setting saved
const opt = await ev(() => {
  const g = window.__game; g.hud.menu.open('settings');
  const seg = document.querySelector('.menu-layer .cam-seg'), btn = seg?.querySelector('[data-cam="auto"]');
  const sel0 = seg?.querySelector('.sel')?.dataset.cam;
  btn?.click();
  const saved = JSON.parse(localStorage.getItem('tof.settings.v1') || '{}').combatCam;
  const out = { found: !!seg, sel0, now: g.settings.combatCam, saved, sel1: seg?.querySelector('.sel')?.dataset.cam, text: seg?.closest('.srow')?.textContent || '' };
  return out;
});
await shot('03-options');
await ev(() => window.__game.hud.menu.close());
check('Options : « Caméra en combat » Automatique / Manuelle, enregistré', opt.found && opt.sel0 === 'manual' && opt.now === 'auto' && opt.saved === 'auto' && opt.sel1 === 'auto', JSON.stringify(opt));
check('zéro erreur console', !errors.length, errors.slice(0, 4).join(' | '));

await browser.close();
const bad = results.filter(x => !x).length;
console.log(`\n${results.length - bad}/${results.length} PASS`);
process.exit(bad ? 1 : 0);
