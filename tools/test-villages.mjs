// Test of the fishing villages: node tools/test-villages.mjs [--shots folder]
// Pure node: six villages in the world table, names, goods. Then in the real game (dev server, TOF_URL):
// navigable anchorages, far from ports and lairs; entry with F while at war with every nation; refit capped at
// 90 % hull, sails 100 %, prices ×1.4; barter (cheap provisions, sugar bought back low, a market that settles);
// fishermen signed on then a pool that refills; news; Escape = anchor weighed and save; chart (villages layer);
// zero console errors.
import assert from 'node:assert';
import { generateWorld, GOODS } from '../src/data/world.js';
import { VILLAGE } from '../src/data/villages.js';

const W = generateWorld();
assert.strictEqual(W.villages.length, 6, 'six villages');
for (const v of W.villages) {
  assert.ok(v.name && v.sells?.length && v.sells.every(g => GOODS[g]), v.id);
  assert.ok(W.islands.some(i => i.id === v.islandId), `${v.id} : île ${v.islandId}`);
}
console.log('ok   données : six villages, marchandises connues');

const shotsDir = (() => { const i = process.argv.indexOf('--shots'); return i > 0 ? process.argv[i + 1] : null; })();
const { chromium } = await import('playwright');
const { BASE, launchOpts } = await import('./_env.mjs');
const fs = await import('node:fs');
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
const browser = await chromium.launch(launchOpts(['--disable-dev-shm-usage']));
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
const errors = [], bad = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('[pageerror] ' + e.message));
const chk = (c, msg) => { console.log(c ? 'ok  ' : 'FAIL', msg); if (!c) bad.push(msg); };
await page.goto(BASE + '?quality=low&dynres=0', { timeout: 180000 });
await page.waitForFunction(() => window.__ready || window.__error, null, { timeout: 240000 });
await page.evaluate(() => { localStorage.removeItem('tof.save.v1'); const g = window.__game; g.renderer.setAnimationLoop(null); g.hud?.menu?.close(); g.mode = 'sail'; g.frozen = false; g.combat.setTrafficTarget(0); for (const s of [...g.ships]) if (s !== g.player) g.combat._despawn(s); });

const geo = await page.evaluate(() => {
  const g = window.__game, isl = g.islands, out = [];
  const lairs = (g.lords?.lairSites?.() || []);
  for (const v of isl.villages) {
    const hp = v.harborPoint;
    const dPort = Math.min(...isl.ports.map(p => Math.hypot(p.harborPoint.x - hp.x, p.harborPoint.z - hp.z)));
    const dLair = Math.min(...isl.coves.map(c => Math.hypot(c.anchorPoint.x - hp.x, c.anchorPoint.z - hp.z)), 1e9);
    out.push({ id: v.id, name: v.name, depth: +isl.getTerrainHeight(hp.x, hp.z).toFixed(1), dPort: Math.round(dPort), dCove: Math.round(dLair), tier: g.seaZones?.tierAt(hp.x, hp.z), land: isl.getTerrainHeight(v.x, v.z) > 0 });
  }
  void lairs;
  return out;
});
for (const v of geo) chk(v.depth < -6 && v.dPort >= 1800 && v.land, `${v.name} : mouillage à ${v.depth} m, port le plus proche ${v.dPort} m, crique ${v.dCove} m, niveau ${v.tier}, grève à terre ${v.land}`);
chk(geo.filter(v => v.tier >= 2).length >= 5, `villages hors des eaux gardées : ${geo.filter(v => v.tier >= 2).length}/6`);

const r = await page.evaluate(async () => {
  const g = window.__game, st = g.state, p = g.player, V = g.villages, out = {};
  const step = n => { for (let i = 0; i < n; i++) g.step(1 / 30); };
  // at war with everyone, outlawed everywhere
  for (const n of ['english', 'spanish', 'french', 'dutch', 'pirate']) { st.reputation[n] = -80; }
  const v = g.islands.getVillage('v_cayman'), hp = v.harborPoint;
  p.teleport(hp.x + v.seaward.x * 150, hp.z + v.seaward.z * 150, 0); step(3);
  g.hud.update(0.1);
  out.prompt = document.querySelector('.prompt:not(.board)')?.textContent.replace(/\s+/g, ' ').trim();
  const key = (k, code) => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: k, code, bubbles: true }));
  key('f', 'KeyF');
  out.open = V.isOpen && g.mode === 'port' && !!document.querySelector('.village-layer.show .vcol h1');
  out.title = document.querySelector('.vcol h1')?.textContent;
  // radoub
  p.hull = p.hullMax * 0.4; p.sails = 0.5; st.gold = 20000; V.render();
  const ri = V.repairInfo(), portCost = Math.round((p.hullMax * 0.9 - p.hull) * 6);
  out.repairCost = { hull: ri.hull, port: portCost };
  document.querySelector('[data-act="rep-hull"]')?.click();
  document.querySelector('[data-act="rep-sails"]')?.click();
  out.afterRepair = { hull: Math.round(p.hull / p.hullMax * 100), sails: Math.round(p.sails * 100) };
  out.noMore = !document.querySelector('[data-act="rep-hull"]');
  // troc
  st.cargo = { sugar: 12 }; st.food = 5; V.render();
  const rows = V.rows(), food = rows.find(x => x.good === 'food'), sugar = rows.find(x => x.good === 'sugar');
  out.prices = { foodBuy: food?.buy, foodBase: 12, sugarSell: sugar?.sell, sugarBase: 38, sugarStock: sugar?.stock };
  const g0 = st.gold; V.buy('food', 10); out.boughtFood = st.food - 5; out.spent = g0 - st.gold;
  const s1 = V.rows().find(x => x.good === 'sugar').sell; V.sell('sugar', 12); out.soldSugar = !st.cargo.sugar;
  out.sugarAfter = { first: s1, after: V.rows().find(x => x.good === 'sugar')?.sell };
  // hommes
  p.crew = Math.max(4, p.crewMax - 30); V.render();
  const mo = V.menOffer(); out.men0 = mo.avail;
  const c0 = p.crew; document.querySelector('[data-act="hireAll"]')?.click(); out.hired = p.crew - c0; out.menLeft = V.menOffer().avail;
  // nouvelles
  out.news = [...document.querySelectorAll('.vcol .news li')].map(li => li.textContent);
  // capture
  await new Promise(res => setTimeout(res, 300));
  return out;
});
chk(/Turtle Cove/.test(r.prompt || ''), `invite F : « ${r.prompt} »`);
chk(r.open && r.title === 'Turtle Cove', `entrée par F en guerre avec toutes les nations : feuille « ${r.title} »`);
chk(Math.abs(r.repairCost.hull - Math.round(r.repairCost.port * 1.4)) <= 2, `radoub de la coque ×1,4 : ${r.repairCost.hull} contre ${r.repairCost.port} au port`);
chk(r.afterRepair.hull === 90 && r.afterRepair.sails === 100 && r.noMore, `après radoub : coque ${r.afterRepair.hull} %, voiles ${r.afterRepair.sails} %, plus de radoub proposé`);
chk(r.prices.foodBuy <= 11 && r.prices.sugarSell >= 20 && r.prices.sugarSell <= 28 && r.prices.sugarStock === 0, `prix : vivres ${r.prices.foodBuy} (cours 12), sucre racheté ${r.prices.sugarSell} (cours 38), pas de sucre à vendre`);
chk(r.boughtFood === 10 && r.spent > 0, `10 barils de vivres achetés pour ${r.spent}`);
chk(r.soldSugar && r.sugarAfter.after < r.sugarAfter.first, `sucre vendu, le prix se tasse : ${r.sugarAfter.first} → ${r.sugarAfter.after}`);
chk(r.men0 >= 3 && r.men0 <= 8 && r.hired === r.men0 && r.menLeft === 0, `pêcheurs : ${r.men0} prêts, ${r.hired} enrôlés, ${r.menLeft} restants`);
chk(r.news.length >= 1, `nouvelles : ${r.news.join(' | ')}`);
if (shotsDir) await page.screenshot({ path: `${shotsDir}/village-ponton.png` });

const r2 = await page.evaluate(() => {
  const g = window.__game, V = g.villages, out = {};
  const key = (k, code) => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: k, code, bubbles: true }));
  key('Escape', 'Escape');
  const v = g.islands.getVillage('v_cayman'), p = g.player;
  out.left = !V.isOpen && g.mode === 'sail' && Math.hypot(p.position.x - v.harborPoint.x, p.position.z - v.harborPoint.z) < 5;
  out.saved = !!localStorage.getItem('tof.save.v1');
  // pool of men: one more the next day
  const st = g.state; st.date = { ...st.date, day: st.date.day + 1 };
  out.menNext = V.menOffer(v).avail;
  // chart: villages layer
  g.worldMap.open(); g.worldMap._fit(); g.worldMap.draw();
  out.mapHits = g.worldMap._hits.filter(h => /Fishing village/.test(h.html)).length;
  g.worldMap.close?.();
  return out;
});
chk(r2.left && r2.saved, `Échap : ancre levée au mouillage (${r2.left}), sauvegarde (${r2.saved})`);
chk(r2.menNext === 1, `le lendemain : ${r2.menNext} pêcheur prêt`);
chk(r2.mapHits === 6, `carte : ${r2.mapHits} villages au calque`);
chk(!errors.length, `console : ${errors.length ? errors.slice(0, 5).join(' | ') : 'aucune erreur'}`);
await browser.close();
if (bad.length) { console.log(`\n${bad.length} échec(s)`); process.exit(1); }
console.log('\nvillages OK');
