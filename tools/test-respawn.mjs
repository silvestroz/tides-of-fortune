// Test of the escape lugger (playtest feedback: "after a death or a lost duel, a fast boat to slip away"):
// shipwreck → « Filer sur un lougre » (the old ship refloated and sent to the squadron), prison → same, marooned by
// pirates → lugger; the lugger stays unnoticed by the AI until its first gunshot; « Relever votre navire » unchanged.
// Usage: node tools/test-respawn.mjs [--shots folder]   (dev server TOF_URL, GPU by default, --soft = SwiftShader)
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
await page.goto(`${BASE}?shot=sailing`, { waitUntil: 'load', timeout: 180000 });
await page.waitForFunction(() => window.__ready || window.__error, null, { timeout: 240000, polling: 250 });
const startErr = await page.evaluate(() => window.__error);
if (startErr) { console.log('STARTUP ERROR', startErr); process.exit(1); }
await page.evaluate(() => { const g = window.__game; g.renderer.setAnimationLoop(null); });

const results = [];
const check = (name, ok, info = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); };
const ev = (fn, arg) => page.evaluate(fn, arg);
const step = n => ev(n => { const g = window.__game; for (let i = 0; i < n; i++) g.step(1 / 30); }, n);
const shot = async name => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }); };
const state = () => ev(() => { const g = window.__game, p = g.player, st = g.state;
  return { type: st.shipType, ptype: p.type, name: p.name, hull: p.hull / p.hullMax, crew: p.crew, crewMax: p.crewMax, fleet: (st.fleet || []).map(f => ({ type: f.type, name: f.name, own: f.own, hull: f.hull, crew: f.crew })),
    discreet: (p.discreetUntil || 0) - g.time, ups: st.upgrades, sheet: document.querySelector('.board-sheet')?.textContent || '', buttons: [...document.querySelectorAll('.board-sheet button')].map(b => b.dataset.c) }; });

// ---- 1. shipwreck → lugger, the brig refloated and sent to the squadron
await ev(() => { const g = window.__game, st = g.state; st.fleet = []; st.gold = 4000; st.upgrades = { ...st.upgrades, hull: 1 }; const p = g.player; p.crew = 90; p.hull = 0; p.sinking = true; g.boarding._shipwreckScreen(p); });
await step(2);
let s = await state();
check('naufrage : bouton « Filer sur un lougre » proposé', s.buttons.includes('fast') && s.buttons.includes('ok'), s.buttons.join(','));
check('naufrage : texte du lougre', /lugger/.test(s.sheet));
await shot('1-naufrage');
await ev(() => document.querySelector('.board-sheet button[data-c="fast"]').click());
await step(3);
s = await state();
check('naufrage : navire amiral = lougre', s.type === 'lugger' && s.ptype === 'lugger', `${s.type}/${s.ptype} « ${s.name} »`);
check('naufrage : lougre neuf', s.hull > 0.99, s.hull.toFixed(2));
check('naufrage : ancien brick à l\'escadre (own)', s.fleet.length === 1 && s.fleet[0].type === 'brig' && s.fleet[0].own && s.fleet[0].name === 'Merry Wren', JSON.stringify(s.fleet));
check('naufrage : refontes du brick gardées à l\'escadre, lougre sans refonte', s.ups.hull === 0, JSON.stringify(s.ups));
check('naufrage : lougre discret', s.discreet > 300, s.discreet.toFixed(0));

// ---- 2. AI: a pirate at 700 m doesn't see the lugger; at 300 m, it does; after a gunshot, everywhere
//      (sea tiers: the lugger leaves its port's guarded waters, where no pirate stronger than it would target it;
//      a class II pirate brig cruises the trade routes)
const ai = await ev(() => {
  const g = window.__game, p = g.player, zs = g.seaZones, isl = g.islands;
  let q = null;
  for (let r = 3000; r < 9000 && !q; r += 500) for (let a = 0; a < 6.28 && !q; a += 0.35) {
    const x = p.position.x + Math.cos(a) * r, z = p.position.z + Math.sin(a) * r;
    if (Math.abs(x) < 7000 && Math.abs(z) < 7000 && (!zs || zs.tierAt(x, z) === 2) && isl.getTerrainHeight(x, z) < -15
      && !isl.isLand(x + 300, z, 90) && !isl.isLand(x + 700, z, 90) && !isl.isLand(x, z, 120)) q = { x, z };
  }
  if (q) { if (p.teleport) p.teleport(q.x, q.z, p.heading); else { p.position.x = q.x; p.position.z = q.z; } }
  const foe = g.combat.spawnAI({ type: 'brig', faction: 'pirate', role: 'pirate', x: p.position.x + 700, z: p.position.z, heading: 0, sailSetting: 0, name: 'Le Requin' });
  foe.ai.target = null; foe.ai._scan();
  const far = foe.ai.target === p;
  foe.position.set(p.position.x + 300, 0, p.position.z); foe.ai.target = null; foe.ai._scan();
  const near = foe.ai.target === p;
  foe.position.set(p.position.x + 700, 0, p.position.z); foe.ai.target = null;
  p.reload = { port: 1, starboard: 1 }; g.combat.fireBroadside(p, 'port');
  foe.ai._scan();
  const fired = foe.ai.target === p, left = p.discreetUntil;
  g.removeShip(foe);
  return { far, near, fired, left };
});
check('IA : lougre discret ignoré à 700 m', !ai.far);
check('IA : lougre repéré à 300 m', ai.near);
check('IA : la bordée trahit le lougre', ai.fired && !ai.left, JSON.stringify(ai));

// ---- 3. prison (nation) → lugger, the old ship to the squadron; no room in the squadron: no choice
await ev(() => { const g = window.__game, st = g.state; const p = g.player;
  // back onto a brig for the prison test
  const np = g.spawnShip({ type: 'brig', faction: p.faction, isPlayer: true, x: p.position.x, z: p.position.z, heading: p.heading, name: 'Merry Wren II', crew: 100 });
  np.controller = p.controller ? new p.controller.constructor(g, np) : null; g.removeShip(p); g.player = np; st.shipType = 'brig';
  np.hull = np.hullMax * 0.3; np.crew = 100;
  g.boarding._captivityScreen(np, { faction: 'spanish', _captain: { name: 'Don Test' }, alive: false }, { cause: 'struck', noEscape: true });
});
await step(2);
s = await state();
check('prison : bouton « Filer sur un lougre » proposé', s.buttons.includes('fast'), s.buttons.join(','));
await shot('2-prison');
await ev(() => document.querySelector('.board-sheet button[data-c="fast"]').click());
await step(3);
s = await state();
check('prison : navire amiral = lougre', s.type === 'lugger' && s.ptype === 'lugger', `${s.type} « ${s.name} »`);
check('prison : brick à l\'escadre, au moins 40 % de coque', s.fleet.length === 2 && s.fleet[1].type === 'brig' && s.fleet[1].hull >= 0.4, JSON.stringify(s.fleet[1]));
check('prison : hommes en trop restés à bord du brick', s.crew <= s.crewMax && s.fleet[1].crew === Math.max(0, 35 - s.crewMax), `lougre ${s.crew}/${s.crewMax}, brick ${s.fleet[1].crew}`);
check('prison : nom du lougre libre (pas celui d\'un navire de l\'escadre)', !s.fleet.some(f => f.name === s.name), s.name);
check('prison : lougre discret', s.discreet > 300);

// ---- 4. already on a lugger: no choice at the shipwreck
await ev(() => { const g = window.__game; const p = g.player; p.hull = 0; p.sinking = true; g.boarding._shipwreckScreen(p); });
await step(2);
s = await state();
check('déjà sur un lougre : pas de bouton lougre', !s.buttons.includes('fast') && s.buttons.includes('ok'), s.buttons.join(','));
await ev(() => document.querySelector('.board-sheet button[data-c="ok"]').click());
await step(3);
s = await state();
check('« Reprendre la mer » relève le même navire', s.type === 'lugger' && s.fleet.length === 2, `${s.type}, escadre ${s.fleet.length}`);

// ---- 5. marooned by pirates → lugger, squadron lost
await ev(() => { const g = window.__game; g.boarding._captivityScreen(g.player, { faction: 'pirate', _captain: { name: 'Le Borgne' }, alive: false }, { cause: 'struck' }); });
await step(2);
s = await state();
check('pirates : pas de choix (navire perdu)', !s.buttons.includes('fast'), s.buttons.join(','));
check('pirates : texte du lougre', /lugger/.test(s.sheet));
await ev(() => document.querySelector('.board-sheet button[data-c="ok"]').click());
await step(3);
s = await state();
check('pirates : lougre, escadre vidée', s.type === 'lugger' && s.fleet.length === 0, `${s.type}, escadre ${s.fleet.length}`);
check('pirates : lougre discret', s.discreet > 300);

// ---- 6. squadron full: no lugger (the old ship would have no room)
await ev(() => { const g = window.__game, st = g.state; const p = g.player;
  const np = g.spawnShip({ type: 'frigate', faction: p.faction, isPlayer: true, x: p.position.x, z: p.position.z, heading: p.heading, name: 'Test', crew: 200 });
  np.controller = p.controller ? new p.controller.constructor(g, np) : null; g.removeShip(p); g.player = np; st.shipType = 'frigate';
  st.fleet = Array.from({ length: 7 }, (_, i) => ({ type: 'sloop', name: 'S' + i, hull: 1, sails: 1, from: 'english', crew: 0, upgrades: {}, cargo: {} }));
  np.hull = 0; np.sinking = true; g.boarding._shipwreckScreen(np); });
await step(2);
s = await state();
check('escadre pleine : pas de bouton lougre', !s.buttons.includes('fast'), s.buttons.join(','));
await ev(() => document.querySelector('.board-sheet button[data-c="ok"]').click());
await step(2);

const real = errors.filter(e => !/favicon|404/.test(e));
check('zéro erreur console', !real.length, real.slice(0, 3).join(' | '));
const ok = results.every(Boolean);
console.log(ok ? `${results.length}/${results.length} PASS` : `${results.filter(r => !r).length} FAIL sur ${results.length}`);
await browser.close();
process.exit(ok ? 0 : 1);
