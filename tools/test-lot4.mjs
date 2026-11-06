// Long-term goals test: specialists, items, traveller, treasure map, Top 10, retirement.
// Usage: node tools/test-lot4.mjs [--shots <folder>]   (dev server required, http://127.0.0.1:5173)
// Starts a real game, checks each system through window.__game and exits with 1 if an assertion or the console fails.
import { chromium } from 'playwright';
import { BASE, PORT, launchOpts } from './_env.mjs';
import fs from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => {
  if (v.startsWith('--')) a.push([v.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : '1']);
  return a;
}, []));
const SHOTS = args.shots || null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const browser = await chromium.launch(launchOpts(['--disable-dev-shm-usage', '--disable-gpu-watchdog']));
const page = await browser.newPage({ viewport: { width: 1152, height: 648 } });
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('[pageerror] ' + e.message));
await page.goto(BASE + '?quality=low&dynres=0', { timeout: 180000 });
await page.waitForFunction(() => window.__ready || window.__error, null, { timeout: 240000 });
await page.evaluate(() => localStorage.removeItem('tof.save.v1'));
const fails = [];
const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? 'OK   ' : 'FAIL ') + m); };
// render on demand: the animation loop is cut (SwiftShader renders a frame in several seconds and the GPU process
// ends up killed); tick() advances the simulation and renders a frame
const tick = (n = 3) => page.evaluate(n => { const g = window.__game; for (let i = 0; i < n; i++) g.step(1 / 30); if (g.renderOverride) g.renderOverride(1 / 30); else g.post.render(1 / 30); }, n);
const stopLoop = () => page.evaluate(() => window.__game.renderer.setAnimationLoop(null));
const shot = async name => { if (!SHOTS) return; await page.waitForTimeout(400); await tick(2); await page.screenshot({ path: `${SHOTS}/${name}.png`, timeout: 0 }); console.log('  capture ' + name); };

// new game
await stopLoop();
// limited memory (container): little traffic
await page.evaluate(() => { const g = window.__game; g.hud.menu.close(); g.mode = 'sail'; g.frozen = false; g.combat.setTrafficTarget(4);
  for (const s of [...g.ships]) if (s !== g.player && Math.hypot(s.position.x - g.player.position.x, s.position.z - g.player.position.z) > 800) g.combat._despawn(s); });
await tick(5);

// 1. specialists and effects
const r1 = await page.evaluate(() => {
  const g = window.__game, f = g.fortune, c = g.combat, p = g.player;
  const base = { reload: c.reloadTime(p), food: Math.ceil(p.crew / 25) };
  for (const id of ['carpenter', 'sailmaker', 'cooper', 'gunner', 'surgeon', 'navigator', 'quartermaster', 'cook']) f.hire(id);
  const twice = f.hire('gunner');
  g.fortune.update(0.016);
  return { base, reload: c.reloadTime(p), cap: c._repairFx(p).cap, speedF: p.fortuneSpeedF, twice, n: Object.keys(g.state.specialists).length };
});
ok(r1.n === 8 && !r1.twice, `8 spécialistes, un seul exemplaire (${r1.n})`);
ok(r1.reload < r1.base.reload * 0.9, `canonnier : rechargement ${r1.base.reload.toFixed(2)} → ${r1.reload.toFixed(2)} s`);
ok(r1.cap === 0.85 && Math.abs(r1.speedF - 1.092) < 0.01, `charpentier plafond ${r1.cap}, vitesse ×${r1.speedF.toFixed(3)}`);

// 2. items + traveller
const r2 = await page.evaluate(() => {
  const g = window.__game, f = g.fortune, port = g.islands.ports.find(p => !p.haven) || g.islands.ports[0];
  g.state.gold = 50000;
  const stock = f.travelerStock(port);
  const bought = stock.map((o, i) => f.buyFromTraveler(port, i));
  const again = f.buyFromTraveler(port, 0);
  f.giveItem('spyglass', 2); f.giveItem('armor', 2); f.giveItem('barometer', 1);
  f.update(0.016);
  return { stock: stock.length, bought: bought.filter(Boolean).length, again, range: g.hud.minimap.baseRange, items: { ...g.state.items }, storm: f.fx.stormMul };
});
ok(r2.stock >= 2 && r2.bought >= 1 && !r2.again, `voyageur : ${r2.stock} lots, ${r2.bought} achetés, rachat refusé`);
ok(r2.range === 1800, `longue-vue niv. 2 : portée carte ${r2.range} m`);
ok(r2.storm < 1, `baromètre : dégâts de tempête ×${r2.storm}`);

// 3. treasure map: 4 pieces, dig (F), avenging pirate
const r3 = await page.evaluate(async () => {
  const g = window.__game, f = g.fortune;
  g.state.treasure.pieces = 0; g.state.treasure.cove = null;
  for (let i = 0; i < 4; i++) f.addMapPiece(1);
  const site = f.treasureSite();
  if (!site) return { site: false };
  const c = g.islands.coves.find(x => x.id === site.id);
  g.player.teleport(c.anchorPoint.x, c.anchorPoint.z);
  const gold0 = g.state.gold;
  dispatchEvent(new KeyboardEvent('keydown', { key: 'f', code: 'KeyF', bubbles: true }));
  return { site: true, found: g.state.treasure.found, gain: g.state.gold - gold0, pieces: g.state.treasure.pieces };
});
ok(r3.site && r3.found === 1 && r3.gain > 3000, `trésor déterré à la touche F (+${r3.gain} pièces)`);
await page.evaluate(() => { window.__game.lords.spawnAvenger(); });
await tick(3);
const r3b = await page.evaluate(() => window.__game.ships.filter(s => s.lordId).map(s => ({ id: s.lordId, tgt: s.ai?.target === window.__game.player })));
ok(r3b.some(s => s.tgt), `pirate vengeur lancé à vos trousses (${r3b.map(s => s.id).join(', ')})`);

// 4. Top 10: defeat a captain
const r4 = await page.evaluate(() => {
  const g = window.__game, L = g.lords;
  const before = L.playerRank();
  const sh = g.ships.find(s => s.lordId);
  sh.lastAttacker = g.player;
  g.combat.strike ? g.combat.strike(sh) : g.events.emit('ship:struck', { ship: sh });
  return { before, after: L.playerRank(), defeated: L.defeatedCount(), rows: L.ranking().length, lairs: L.lairs().length };
});
ok(r4.defeated === 1 && r4.after <= r4.before && r4.rows === 11, `capitaine pirate vaincu : rang ${r4.before} → ${r4.after}, ${r4.lairs} repaires`);

// 5. registre (L)
await page.evaluate(() => { const g = window.__game; g.state.age = 41; g.state.wounds = 2; dispatchEvent(new KeyboardEvent('keydown', { key: 'l', code: 'KeyL', bubbles: true })); });
const reg = await page.evaluate(() => window.__game.registry.isOpen && document.querySelectorAll('.registry tr').length);
ok(reg >= 11, `Registre ouvert (${reg} lignes)`);
await shot('registre');
await page.evaluate(() => dispatchEvent(new KeyboardEvent('keydown', { key: 'l', code: 'KeyL', bubbles: true })));
ok(!(await page.evaluate(() => window.__game.registry.isOpen)), 'Registre refermé (L)');

// 6. world chart with the treasure mark
await page.evaluate(() => { const g = window.__game, f = g.fortune; for (let i = 0; i < 4; i++) f.addMapPiece(1); });
await page.evaluate(() => dispatchEvent(new KeyboardEvent('keydown', { key: 'm', code: 'Semicolon', bubbles: true })));
await shot('carte-tresor');
await page.evaluate(() => { const g = window.__game; if (g.worldMap?.isOpen) g.worldMap.close?.(); dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true })); if (g.hud.menu.isOpen) g.hud.menu.close(); g.mode = 'sail'; });

// 7. backward-compatible save: state without the long-term-goal fields
const r7 = await page.evaluate(() => {
  const g = window.__game, saveOld = JSON.parse(JSON.stringify({ v: 1, state: { ...g.state }, ship: { type: 'brig', name: 'Merry Wren', faction: 'english', x: g.player.position.x, z: g.player.position.z, heading: 0, hull: 100, sails: 1, crew: 40 }, info: {} }));
  for (const k of ['specialists', 'items', 'treasure', 'lords', 'travelerBought', 'wounds']) delete saveOld.state[k];
  localStorage.setItem('tof.save.v1', JSON.stringify(saveOld));
  return true;
});
await page.evaluate(async () => { const m = await import('/src/game/save.js'); m.loadGame(window.__game); });
const r7b = await page.evaluate(() => { const s = window.__game.state; return !!(s.specialists && s.items && s.treasure && s.lords && Object.keys(s.lords).length === 10) && window.__game.career.score() >= 0; });
ok(r7 && r7b, 'ancienne sauvegarde chargée : champs du lot 4 recréés');

// 8. port : taverne (voyageur), comptoir (officiers), gouverneur (retraite)
await page.evaluate(() => { const g = window.__game; g.state.gold = 20000; g.fortune.hire('cook'); g.fortune.giveItem('hat', 1); const port = g.islands.ports.find(p => !p.haven && p.faction === 'english') || g.islands.ports[0]; g.ports.enter(port); g.ports.goto('tavern', true); });
await page.waitForTimeout(1500);
ok(await page.evaluate(() => /traveller|dark corner/i.test(document.querySelector('.pcol-body')?.textContent || '')), 'taverne : carte du voyageur');
await page.evaluate(() => { const b = document.querySelector('.pcol-body'); const c = [...b.querySelectorAll('.card')].pop(); c?.scrollIntoView(); });
await shot('taverne-voyageur');
await page.evaluate(() => window.__game.ports.goto('bank', true));
await page.waitForTimeout(800);
ok(await page.evaluate(() => /Officers aboard/.test(document.querySelector('.pcol-body')?.textContent || '')), 'comptoir : officiers et coffre');
await page.evaluate(() => { const b = document.querySelector('.pcol-body'); b.scrollTop = b.scrollHeight; });
await shot('comptoir-officiers');
await page.evaluate(() => window.__game.ports.goto('governor', true));
await page.waitForTimeout(800);
await page.evaluate(() => { const b = document.querySelector('.pcol-body'); b.scrollTop = b.scrollHeight; });
ok(await page.evaluate(() => !!document.querySelector('[data-act="retire"]')), 'gouverneur : bouton de retraite');
await shot('gouverneur-retraite');
await page.evaluate(() => { document.querySelector('[data-act="retire"]').click(); });
await page.evaluate(() => { document.querySelector('[data-act="retire"]').click(); });
await page.waitForTimeout(500);
const r8 = await page.evaluate(() => ({ on: document.querySelector('.retire-screen')?.classList.contains('on'), txt: document.querySelector('.retire-sheet .tt')?.textContent, save: localStorage.getItem('tof.save.v1') }));
ok(r8.on && r8.txt && !r8.save, `retraite volontaire : « ${r8.txt} », sauvegarde effacée`);
await shot('retraite-score');

// 9. capture screen with finds (new page: the career has just ended)
await page.goto(BASE + '?quality=low&dynres=0', { timeout: 180000 });
await page.waitForFunction(() => window.__ready || window.__error, null, { timeout: 240000 });
await stopLoop();
await page.evaluate(() => { const g = window.__game; g.hud.menu.close(); g.mode = 'sail'; g.frozen = false; });
await tick(3);
const r9 = await page.evaluate(() => {
  const g = window.__game, p = g.player;
  const e = g.combat.spawnAI({ type: 'merchantman', faction: 'spanish', role: 'merchant', x: p.position.x + 60, z: p.position.z + 60, heading: 0, name: 'Santa Clara' });
  e._finds = { spec: 'surgeon', map: true, item: { cat: 'jewel', lvl: 1 } };
  g.boarding.active = true; g.boarding.enemy = e;
  g.boarding._captureScreen(p, e, { winner: 'player', reason: 'wounds' });
  return !!document.querySelector('.board-sheet [data-hire]');
});
ok(r9, 'écran de prise : spécialiste proposé');
await shot('prise-trouvailles');
const r9b = await page.evaluate(() => {
  dispatchEvent(new KeyboardEvent('keydown', { key: '4', code: 'Digit4', bubbles: true }));
  const g = window.__game; dispatchEvent(new KeyboardEvent('keydown', { key: '3', code: 'Digit3', bubbles: true }));
  return { spec: !!g.state.specialists.surgeon, map: g.state.treasure.pieces, item: g.state.items.jewel };
});
ok(r9b.spec && r9b.map >= 1 && r9b.item === 1, `prise réglée : chirurgien engagé, carte ${r9b.map}/4, bijou`);

// 10. retirement forced by age
const r10 = await page.evaluate(async () => {
  const g = window.__game; g.state.age = 62; g.events.emit('career:day', { date: g.state.date });
  await new Promise(r => setTimeout(r, 1500));
  return document.querySelector('.retire-screen')?.classList.contains('on');
});
ok(r10, 'retraite forcée à 62 ans');

console.log(errors.length ? 'CONSOLE:\n' + [...new Set(errors)].join('\n') : 'console : aucune erreur');
await browser.close();
if (fails.length || errors.length) { console.log(`ÉCHEC : ${fails.length} assertion(s), ${errors.length} erreur(s) console`); process.exit(1); }
console.log('Lot 4 : tout est OK');
