// Browser test of the shipyard's "Colours" card (src/data/shipColours.js, PortSystem.repaint / hoistBlack / pardon):
// a repaint (gold, preview at the quay, the ship's model, kept through a flagship swap and a save/load), hoisting the
// black in a pirate haven (faction, reputations, a nation's warship turns hostile, the haven welcomes), the pardon in a
// port of the captain's nation (gold, reputation with the Brethren, days), zero console errors.
// Usage: node tools/test-colours.mjs [--shots dir] [--soft]   (dev server: TOF_URL, see tools/_env.mjs)
import { chromium } from 'playwright';
import fs from 'node:fs';
import { BASE, SOFT, launchOpts } from './_env.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => {
  if (v.startsWith('--')) a.push([v.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : '1']);
  return a;
}, []));
const OUT = args.shots || null;
if (OUT) fs.mkdirSync(OUT, { recursive: true });
const url = `${BASE}?shot=port&tab=shipyard&fleet=3&quality=${args.quality || 'low'}`;

const browser = await chromium.launch(launchOpts());
const page = await browser.newPage({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push('[console] ' + m.text()); });
page.on('pageerror', e => errors.push('[pageerror] ' + e.message));
const T0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - T0) / 1000).toFixed(0)}s]`, ...a);
const ev = (fn, a) => page.evaluate(fn, a);
const frames = n => Promise.race([ev(n => new Promise(r => { let i = 0; const f = () => (++i >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n), page.waitForTimeout(2000 + n * 500)]).catch(() => {});
let fails = 0, passes = 0;
const check = (name, ok, note = '') => { if (ok) passes++; else fails++; log(`${ok ? 'PASS' : 'FAIL'} ${name}${note ? ' · ' + note : ''}`); };
const click = sel => page.click(sel, { force: true, timeout: 90000 });
async function shot(name) {
  if (!OUT) return;
  await frames(3);
  await ev(() => __game.renderer.setAnimationLoop(null));
  try { await page.screenshot({ path: `${OUT}/${name}.png`, timeout: SOFT ? 300000 : 120000 }); log('shot', `${OUT}/${name}.png`); }
  finally { await ev(() => __game.renderer.setAnimationLoop(() => __game.frame())); }
}
const lc = s => String(s || '').toLowerCase();
// the paint uniforms of a model, as hex (null: as built)
const modelPaint = which => ev(w => {
  const g = __game, m = w === 'quay' ? g.ports.stage.cur?.model?.() : g.player?.model;
  const hull = m?.group.children.find(o => o.isMesh && o.material?.userData?.u?.uPaintOn);
  const sails = m?.group.children.find(o => o.isMesh && o.material?.userData?.u?.uSet);
  if (!hull) return null;
  const u = hull.material.userData.u;
  return { on: u.uPaintOn.value, hull: '#' + u.uPaint1.value.getHexString(), trim: '#' + u.uTrim1.value.getHexString(), sails: '#' + sails.material.userData.u.uColor.value.getHexString(), faction: m.faction };
}, which);

await page.goto(url, { waitUntil: 'load', timeout: 240000 });
await page.waitForFunction(() => window.__ready || window.__error, null, { timeout: 300000, polling: 500 });
log('ready', await ev(() => window.__error || 'ok'));
await frames(4);
await ev(() => { __game.state.gold = 20000; __game.ports.screen.render(); });

// 1. the card
const card = await ev(() => { const c = document.querySelector('.card.colours'); return c && { presets: c.querySelectorAll('.pt-pre').length, sw: c.querySelectorAll('.pt-sw').length, cloth: c.querySelectorAll('.pt-cl').length, black: !!c.querySelector('[data-act="pt-black"]'), blackDisabled: c.querySelector('[data-act="pt-black"]')?.disabled, why: c.querySelector('.pt-why')?.textContent || '' }; });
check('Colours card: schemes, pigments, cloths, flag', card && card.presets === 5 && card.sw > 20 && card.cloth === 3 && card.black, JSON.stringify(card));
check('the black can be hoisted in any port (here a nation port)', card && card.blackDisabled === false && !/haven/.test(card.why), card?.why);
const p0 = await modelPaint('player');
check('flagship wears her nation’s colours (English red)', p0?.on === 1 && lc(p0.hull) === '#b8302a', JSON.stringify(p0));

// 2. preview: pigments and cloth, shown at the quay before paying
const HULL = '#3f7a62', TRIM = '#d0a640';
await click(`.pt-sw[data-act="pt-hull"][data-k="${HULL}"]`);
await click(`.pt-sw[data-act="pt-trim"][data-k="${TRIM}"]`);
await click('.pt-cl[data-k="tanned"]'); await frames(2);
const pq = await modelPaint('quay'), pp = await modelPaint('player');
const cost = await ev(() => __game.ports.paintCost(__game.ports.screen.paintSel));
check('preview at the quay, the flagship itself unchanged', lc(pq?.hull) === HULL && lc(pq.trim) === TRIM && lc(pq.sails) === '#a8714a' && lc(pp.hull) === '#b8302a', `quay ${JSON.stringify(pq)} · player ${pp.hull}`);
check('repaint price scaled by size (brig: hull + cloth)', cost.hull === 260 && cost.sails === 420, JSON.stringify(cost));
await ev(() => document.querySelector('.card.colours')?.scrollIntoView({ block: 'start' }));
await shot('01-colours-card');

// 3. pay
const g0 = await ev(() => __game.state.gold), d0 = await ev(() => { const d = __game.state.date; return d.year * 372 + d.month * 31 + d.day; });
await click('[data-act="pt-paint"]'); await frames(2);
const after = await ev(() => ({ gold: __game.state.gold, paint: __game.state.paint, wear: __game.player.model.wear, sel: __game.ports.screen.paintSel }));
const p1 = await modelPaint('player'), q1 = await modelPaint('quay');
check('repaint: gold paid, state.paint, the ship’s model wears it', g0 - after.gold === cost.total && lc(after.paint?.hull) === HULL && after.paint.sails === 'tanned' && lc(p1.hull) === HULL && lc(p1.trim) === TRIM && lc(p1.sails) === '#a8714a' && lc(q1.hull) === HULL && !after.sel, `−${g0 - after.gold} · ${JSON.stringify(after.paint)} · wear ${after.wear.toFixed(2)}`);
const d1 = await ev(() => { const d = __game.state.date; return d.year * 372 + d.month * 31 + d.day; });
check('a day in the yard', d1 - d0 >= 1, `${d1 - d0} day(s)`);
await ev(() => { document.querySelector('.pcol-body').scrollTop = 0; });
await shot('02-repainted-quay');

// 4. through a flagship swap: each ship keeps her own colours
await click('[data-act="fl-flag"][data-n="2"]'); await frames(2); await click('[data-act="fl-flag"][data-n="2"]'); await frames(2);   // preview, then Confirm
const sw1 = await ev(() => ({ type: __game.player.type, paint: __game.state.paint, f2: __game.state.fleet[2].paint, f2type: __game.state.fleet[2].type }));
const ps = await modelPaint('player');
check('swap: the frigate in the nation’s colours, the brig keeps hers in the squadron', sw1.type === 'frigate' && !sw1.paint && lc(sw1.f2?.hull) === HULL && lc(ps.hull) === '#b8302a', JSON.stringify(sw1) + ' ' + ps.hull);
await click('.fl-pick[data-n="2"]'); await frames(2);
const qf = await modelPaint('quay');
check('the brig picked in the squadron shows her paint at the quay', lc(qf?.hull) === HULL && lc(qf.sails) === '#a8714a', JSON.stringify(qf));
await click('[data-act="fl-flag"][data-n="2"]'); await frames(2); await click('[data-act="fl-flag"][data-n="2"]'); await frames(2);   // preview, then Confirm
const sw2 = await ev(() => ({ type: __game.player.type, paint: __game.state.paint, f2: __game.state.fleet[2].paint }));
const pb = await modelPaint('player');
check('swap back: the brig is flagship again in her colours', sw2.type === 'brig' && lc(sw2.paint?.hull) === HULL && !sw2.f2 && lc(pb.hull) === HULL, JSON.stringify(sw2));

// 5. save / load
const ld = await ev(async () => {
  const g = __game, S = await import('/src/game/save.js');
  g.ports.leave();
  S.saveGame(g, 'test');
  g.state.paint = null; g.player.model.setPaint(null);
  const ok = S.loadGame(g);
  return { ok, paint: g.state.paint, flag: g.state.flag, fleet: g.state.fleet.map(f => f.paint?.hull || null) };
});
const pl = await modelPaint('player');
check('save/load: paint restored on the flagship model', ld.ok && lc(ld.paint?.hull) === HULL && lc(pl.hull) === HULL && lc(pl.sails) === '#a8714a' && ld.flag === 'nation', JSON.stringify(ld) + ' ' + JSON.stringify(pl));

// 6. hoist the black in a pirate haven
const setup = await ev(() => {
  const g = __game, ports = g.islands.ports, haven = ports.find(p => p.haven), home = ports.find(p => p.faction === 'english' && !p.haven);
  const pl = g.player, c = g.combat;
  const nearby = (faction, dx) => c.spawnAI({ type: 'frigate', faction, role: 'patrol', x: pl.position.x + dx, z: pl.position.z + 300, heading: 0, sailSetting: 0, name: 'Test ' + faction });
  window.__t = { haven, home, fr: nearby('french', 400), en: nearby('english', -400), pi: nearby('pirate', 900) };
  return { haven: haven?.id, home: home?.id, hostile: { fr: c.isHostile(__t.fr, pl), en: c.isHostile(__t.en, pl), pi: c.isHostile(__t.pi, pl) }};
});
log('haven', setup.haven, 'home', setup.home, 'before', JSON.stringify(setup.hostile));
check('under English colours: own warship friendly, pirate hostile', !setup.hostile.en && setup.hostile.pi, JSON.stringify(setup.hostile));
await ev(() => { __game.ports.enter(__t.haven, 'shipyard'); });
await page.waitForTimeout(800); await frames(3);
const r0 = await ev(() => ({ ...__game.state.reputation }));
const hv = await ev(() => { const b = document.querySelector('[data-act="pt-black"]'); return { dis: b?.disabled, text: document.querySelector('.card.colours .pt-cons')?.textContent.replace(/\s+/g, ' ').trim() }; });
check('haven: the black can be hoisted, consequences stated', hv.dis === false && /−35/.test(hv.text) && /pardon/.test(hv.text), hv.text?.slice(0, 160));
await ev(() => document.querySelector('.card.colours')?.scrollIntoView({ block: 'start' }));
await click('[data-act="pt-black"]');
const armed = await ev(() => ({ text: document.querySelector('[data-act="pt-black"]')?.textContent, flag: __game.state.flag }));
check('two-step confirm: first click only arms', /Confirm/.test(armed.text) && armed.flag !== 'pirate', JSON.stringify(armed));
await shot('03-hoist-confirm');
await click('[data-act="pt-black"]'); await frames(2);
const h = await ev(() => { const g = __game, pl = g.player, c = g.combat;
  return { flag: g.state.flag, nat: g.state.nationality, faction: pl.faction, model: pl.model.faction, rep: { ...g.state.reputation }, letters: Object.keys(g.state.letters || {}).filter(k => g.state.letters[k]),
    hostile: { fr: c.isHostile(__t.fr, pl), en: c.isHostile(__t.en, pl), pi: c.isHostile(__t.pi, pl) },
    haven: g.ports.attitude(__t.haven).cls, havenMarket: g.ports.locked(__t.haven, 'market'), home: g.ports.attitude(__t.home).cls, missions: g.career.offerMissions(__t.home).length }; });
const pp2 = await modelPaint('player');
check('hoisted: player faction pirate, nationality kept, Jolly Roger on the model, paint kept', h.flag === 'pirate' && h.faction === 'pirate' && h.nat === 'english' && h.model === 'pirate' && lc(pp2.hull) === HULL, JSON.stringify({ flag: h.flag, faction: h.faction, model: h.model, hull: pp2.hull }));
check('reputations: −35 English, −15 the others, the Brethren welcome', Math.round(h.rep.english - r0.english) === -35 && ['spanish', 'french', 'dutch'].every(n => Math.round(h.rep[n] - (r0[n] || 0)) === -15 || h.rep[n] === -100) && h.rep.pirate >= 5, JSON.stringify({ before: r0, after: h.rep }));
check('a nation’s warship (own and foreign) now hostile, the pirate one friendly', h.hostile.en && h.hostile.fr && !h.hostile.pi, JSON.stringify(h.hostile));
check('the haven welcomes, an English port treats you as a pirate, letters void, no missions', h.haven === 'warm' && !h.havenMarket && h.home === 'hostile' && !h.letters.length && h.missions === 0, JSON.stringify({ haven: h.haven, home: h.home, letters: h.letters, m: h.missions }));
await ev(() => { document.querySelector('.pcol-body').scrollTop = 0; });
await shot('04-pirate-at-the-quay');

// 7. at sea under the black
await ev(() => { const g = __game; g.ports.leave(); for (const s of [__t.fr, __t.en, __t.pi]) g.removeShip?.(s); g.player.sailSetting = 1; g.cameraRig.follow(g.player); });
for (let i = 0; i < 6; i++) await frames(10);
await shot('05-pirate-at-sea');
await ev(() => __game.cameraRig.chaseShot?.({ yaw: 1.4, pitch: 0.12, dist: 0.85 })); for (let i = 0; i < 4; i++) await frames(10);
await shot('05b-pirate-at-sea-broadside');

// 8. the pardon in an English port (amnesty first: the port is hostile to a pirate)
await ev(() => { const g = __game; g.ports.enter(__t.home, 'governor', { fate: 'sparse' }); });
await page.waitForTimeout(800); await frames(2);
const lockY = await ev(() => __game.ports.locked(__t.home, 'shipyard'));
await ev(() => { const g = __game; g.state.gold = 20000; g.ports.buyAmnesty('english'); g.ports.goto('shipyard', true); });
await frames(3);
const pr0 = await ev(() => { const g = __game, d = g.state.date; return { gold: g.state.gold, pirate: g.state.reputation.pirate, day: d.year * 372 + d.month * 31 + d.day, info: g.ports.pardonInfo(), lock: g.ports.locked(__t.home, 'shipyard') }; });
check('pirate at the home port: yard closed until the governor’s amnesty, then the pardon on offer', !!lockY && !pr0.lock && pr0.info.ok && pr0.info.cost >= 800, `${lockY} · ${JSON.stringify(pr0.info)}`);
await ev(() => document.querySelector('.card.colours')?.scrollIntoView({ block: 'start' }));
await click('[data-act="pt-pardon"]');
const parm = await ev(() => document.querySelector('[data-act="pt-pardon"]')?.textContent);
await shot('06-pardon-confirm');
await click('[data-act="pt-pardon"]'); await frames(2);
const pr1 = await ev(() => { const g = __game, d = g.state.date, c = g.combat; return { gold: g.state.gold, pirate: g.state.reputation.pirate, day: d.year * 372 + d.month * 31 + d.day, flag: g.state.flag, faction: g.player.faction, model: g.player.model.faction }; });
check('pardon: confirm, gold, −30 with the Brethren, three days, English colours again', /Confirm/.test(parm) && pr0.gold - pr1.gold === pr0.info.cost && Math.round(pr1.pirate - pr0.pirate) === -30 && pr1.day - pr0.day >= 3 && pr1.flag === 'nation' && pr1.faction === 'english' && pr1.model === 'english', JSON.stringify({ pr0: { gold: pr0.gold, pirate: pr0.pirate, day: pr0.day }, pr1 }));
// save/load keeps the flag (the black, then back)
const fl = await ev(async () => { const g = __game, S = await import('/src/game/save.js'); g.ports.leave();
  g.state.flag = 'pirate'; g.state.flagSince = 0; g.player.faction = 'pirate'; S.saveGame(g, 'test'); g.state.flag = 'nation'; S.loadGame(g);
  const a = { flag: g.state.flag, faction: g.player.faction };
  g.state.flag = 'nation'; delete g.state.flagSince; g.player.faction = 'english'; S.saveGame(g, 'test'); S.loadGame(g);
  return { a, b: { flag: g.state.flag, faction: g.player.faction } }; });
check('save/load restores the flag', fl.a.flag === 'pirate' && fl.a.faction === 'pirate' && fl.b.flag === 'nation' && fl.b.faction === 'english', JSON.stringify(fl));
// a new hull from the yard is painted in the captain's present colours, and the slipway shows her in them
const nb = await ev(() => { const g = __game, S = g.ports; g.ports.enter(__t.home, 'shipyard'); g.state.gold = 50000;
  g.state.paint = { hull: '#3f7a62', trim: '#d0a640', sails: 'tanned' }; const before = JSON.stringify(g.state.paint);
  const t = g.player.type === 'frigate' ? 'brig' : 'frigate'; g.ports.screen.sel = t; g.ports.screen.render();
  const quay = g.ports.screen._yardShip().paint; S.buyShip(t); g.ports.leave();
  return { t, type: g.player.type, before, after: JSON.stringify(g.state.paint), quay: !!quay }; });
await frames(4);
const np = await modelPaint('player');
check('bought ship keeps the present paint (slipway preview and new hull)', nb.type === nb.t && nb.before === nb.after && nb.quay && lc(np?.hull) === '#3f7a62', JSON.stringify({ nb, np }));

check('zero console errors', errors.length === 0, errors.slice(0, 5).join(' | '));
log(`${passes} PASS, ${fails} FAIL`);
await browser.close();
process.exit(fails ? 1 : 0);
