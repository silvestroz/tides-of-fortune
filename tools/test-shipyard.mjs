// Browser test of the shipyard: the ship at the quay follows the panel, every type stays framed, the
// squadron card (sell / repair / flagship swap / transfers). Uses the port showcase (?shot=port&tab=shipyard&fleet=3).
// Usage: node tools/test-shipyard.mjs [--soft] [--shots dir] [--types all|few] [--q "quality=low"]
// Needs the dev server (npm run dev, or TOF_URL=http://127.0.0.1:5183/ for another one). Zero console errors expected.
import { chromium } from 'playwright';
import fs from 'node:fs';
import { BASE, SOFT, launchOpts } from './_env.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => {
  if (v.startsWith('--')) a.push([v.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : '1']);
  return a;
}, []));
const OUT = args.shots || null;
if (OUT) fs.mkdirSync(OUT, { recursive: true });
const url = `${BASE}?shot=port&tab=shipyard&fleet=3&quality=${args.quality || 'low'}${args.q ? '&' + args.q : ''}`;

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
const yard = () => ev(() => { const g = __game, S = g.ports.stage; const i = S.kind === 'shipyard' && S.cur?.shipInfo?.(); const p = g.player;
  return { kind: S.kind, info: i && { type: i.type, hull: +i.damage.hull.toFixed(3), sails: +i.damage.sails.toFixed(3) }, player: p && { type: p.type, name: p.name, hull: +(p.hull / p.hullMax).toFixed(3), crew: p.crew },
    gold: Math.round(g.state.gold), fleet: (g.state.fleet || []).map(f => `${f.type}:${f.name}:${(+f.hull).toFixed(2)}:${f.crew}`), oncale: !!document.querySelector('.oncale'), caption: document.querySelector('.caption p')?.textContent || '' }; });
const click = sel => page.click(sel, { force: true, timeout: 90000 });
async function shot(name) {
  if (!OUT) return;
  await frames(3);
  await ev(() => __game.renderer.setAnimationLoop(null));
  try { await page.screenshot({ path: `${OUT}/${name}.png`, timeout: SOFT ? 300000 : 120000 }); log('shot', `${OUT}/${name}.png`); }
  finally { await ev(() => __game.renderer.setAnimationLoop(() => __game.frame())); }
}
// the projected silhouette of the ship at the quay, as screen fractions (same points as the scene's fit())
const bounds = () => ev(() => __game.ports.stage.cur.frameCheck?.());
const E = 0.006, inFrame = b => !!b && b.x0 >= b.view.x0 - E && b.x1 <= b.view.x1 + E && b.y0 >= b.view.y0 - E && b.y1 <= b.view.y1 + E;
const fmtB = b => b ? `x ${b.x0.toFixed(3)}–${b.x1.toFixed(3)} in ${b.view.x0.toFixed(3)}–${b.view.x1.toFixed(3)}, y ${b.y0.toFixed(3)}–${b.y1.toFixed(3)} in ${b.view.y0.toFixed(3)}–${b.view.y1.toFixed(3)}, fill ${(b.fill * 100).toFixed(0)} %` : 'null';

await page.goto(url, { waitUntil: 'load', timeout: 240000 });
await page.waitForFunction(() => window.__ready || window.__error, null, { timeout: 300000, polling: 500 });
log('ready', await ev(() => window.__error || 'ok'));
await frames(4);

// 1. arrival: the flagship with its damage, sails furled, no bow jack
let y = await yard();
check('arrival: flagship at the quay', y.kind === 'shipyard' && y.info?.type === y.player.type && Math.abs(y.info.hull - (1 - y.player.hull)) < 0.01, JSON.stringify(y.info));
const furl = await ev(() => { const m = __game.ports.stage.cur.model?.(); return m ? m.group.children.find(o => o.isMesh && o.material?.userData?.u?.uSet)?.material.userData.u.uSet.value : null; });
const jack = await ev(() => { const m = __game.ports.stage.cur.model?.(); const fl = m?.group.children.find(o => o.isMesh && o.material?.userData?.u?.uStrike); return fl ? fl.geometry.attributes.position.count : null; });
check('arrival: sails furled from the first frame', furl != null && furl < 0.02, 'uSet=' + furl);
log('flag vertices (no jack)', jack);
await shot('01-arrival-1366');

// 2. every type: build time and framing inside the free area (left of the column, above the dialogue)
const ids = await ev(async () => Object.keys((await import('/src/data/shipTypes.js')).SHIP_TYPES));
const list = args.types === 'all' ? ids : ['lugger', 'sloop', 'brig', 'galleon', 'threedecker', 'greatgalleon'];
let worst = '';
for (const t of list) {
  const r = await ev(t => { const S = __game.ports.stage.cur, t0 = performance.now(); S.setShip(t, { damage: { hull: 0, sails: 0 } }); const ms = performance.now() - t0; return { ms: Math.round(ms), b: S.frameCheck() }; }, t);
  const b = r.b, ok = inFrame(b);
  if (!ok) worst += ` ${t}`;
  check(`frame ${t}`, ok, `${r.ms} ms, ${fmtB(b)}`);
}
await ev(() => __game.ports.screen.render());

// 3. pick a type on the slipway → that ship, intact, « Sur cale »
const pick = await ev(() => [...document.querySelectorAll('.stype')].map(b => b.dataset.ship).find(t => t !== __game.player.type && t !== 'brig'));
await click(`.stype[data-ship="${pick}"]`); await frames(2);
y = await yard();
check(`slipway pick (${pick}) shown at the quay, intact`, y.info?.type === pick && y.info.hull === 0 && y.oncale, JSON.stringify(y.info) + ' caption: ' + y.caption.slice(0, 60));
await shot('02-pick-1366');
// 4. click back on one's own type → own ship with its damage
await click(`.stype.own`); await frames(2);
y = await yard();
check('own type again → own ship with its damage', y.info?.type === y.player.type && Math.abs(y.info.hull - (1 - y.player.hull)) < 0.01 && !y.oncale, JSON.stringify(y.info));
// 5. buy the picked type
await ev(() => { __game.state.gold = 60000; __game.ports.screen.render(); });
await click(`.stype[data-ship="${pick}"]`);
await click('[data-act="buyship"]'); await frames(2);
y = await yard();
check('purchase → new flagship at the quay', y.player.type === pick && y.info?.type === pick && y.info.hull === 0, JSON.stringify(y.player));
// 6. refit: damage then repair
await ev(() => { const p = __game.player; p.hull = p.hullMax * 0.5; p.sails = 0.6; __game.ports.screen.render(); });
y = await yard();
check('damage shown after a battle', Math.abs(y.info.hull - 0.5) < 0.01 && Math.abs(y.info.sails - 0.4) < 0.01, JSON.stringify(y.info));
await click('[data-act="repair"][data-part="hull"]'); await click('[data-act="repair"][data-part="sails"]'); await frames(2);
y = await yard();
check('refit → damage cleared at the quay', y.info.hull === 0 && y.info.sails === 0 && y.player.hull === 1, JSON.stringify(y.info));
// 7. tab change → the stage is rebuilt with the flagship
await click('.ll[data-tab="market"]'); await page.waitForTimeout(700);
await click('.ll[data-tab="shipyard"]'); await page.waitForTimeout(700); await frames(2);
y = await yard();
check('tab change → stage rebuilt with the flagship', y.kind === 'shipyard' && y.info?.type === y.player.type, JSON.stringify(y.info));

// SQUAD — « Votre escadre » card (demo squadron: merchantman, schooner, frigate)
const scrollTo = sel => ev(sel => document.querySelector(sel)?.scrollIntoView({ block: 'start' }), sel);
const st0 = await ev(() => ({ n: __game.state.fleet.length, f0: __game.state.fleet[0] }));
check('squadron card listed', st0.n === 3 && (await ev(() => document.querySelectorAll('.fl-row').length)) === 3, `fleet ${st0.n}, crew ${st0.f0.crew}, ups ${JSON.stringify(st0.f0.upgrades)}`);
await click('.fl-pick[data-n="0"]'); await frames(2);
y = await yard();
check('pick squadron ship → shown at the quay with its damage', y.info?.type === 'merchantman' && Math.abs(y.info.hull - 0.38) < 0.01 && Math.abs(y.info.sails - 0.2) < 0.01, JSON.stringify(y.info) + ' · ' + y.caption.slice(0, 50));
await click('[data-act="fl-xfer"][data-n="0"]'); await frames(1);
await scrollTo('.card.fleet'); await shot('03-squadron-1366');
// transfers: all the sugar to the flagship (capped by its hold), 10 men to the prize, back again
await ev(() => { const st = __game.state; for (const k of Object.keys(st.cargo)) delete st.cargo[k]; st.food = 5; __game.ports.screen.render(); });   // room in the flagship's hold
const x0 = await ev(() => ({ s: __game.state.cargo.sugar || 0, fs: __game.state.fleet[0].cargo.sugar || 0, crew: __game.player.crew, fc: __game.state.fleet[0].crew }));
await click('[data-act="fl-mv"][data-n="0"][data-k="sugar"][data-dir="in"][data-q="1000000000"]');
await click('[data-act="fl-mv"][data-n="0"][data-k="men"][data-dir="out"][data-q="10"]');
const x1 = await ev(() => ({ s: __game.state.cargo.sugar || 0, fs: __game.state.fleet[0].cargo.sugar || 0, crew: __game.player.crew, fc: __game.state.fleet[0].crew, used: (() => { let u = 0; for (const [k, q] of Object.entries(__game.state.cargo)) u += q; return u + __game.state.food; })() }));
check('transfer goods to the flagship and men to the prize', x1.s + x1.fs === x0.s + x0.fs && x1.s === 20 && x1.used === 25 && x1.crew === x0.crew - 10 && x1.fc === x0.fc + 10, JSON.stringify({ x0, x1 }));
await click('[data-act="fl-mv"][data-n="0"][data-k="men"][data-dir="in"][data-q="10"]');
// repair the frigate
await ev(() => { __game.state.gold = 60000; __game.ports.screen.render(); });
await click('[data-act="fl-repair"][data-n="2"]'); await frames(1);
y = await yard();
check('repair squadron ship → hull 100 %, shown intact', y.fleet[2].endsWith(':1.00:30') && y.info?.type === 'frigate' && y.info.hull === 0, y.fleet[2] + ' ' + JSON.stringify(y.info));
// take the frigate as flagship, then back
const before = await ev(() => ({ type: __game.player.type, name: __game.player.name, ups: { ...__game.state.upgrades }, crew: __game.player.crew }));
await click('[data-act="fl-flag"][data-n="2"]'); await frames(2);
y = await yard();
const after = await ev(() => ({ type: __game.player.type, name: __game.player.name, crew: __game.player.crew, slot: __game.state.fleet[2], ships: __game.ships.filter(s => s.isPlayer).length }));
check('take as flagship: player and quay change, old flagship joins the squadron', after.type === 'frigate' && after.name === 'Valiente' && y.info?.type === 'frigate' && after.slot.type === before.type && after.slot.name === before.name && after.ships === 1, JSON.stringify(after.slot).slice(0, 160));
await shot('04-swapped-1366');
await click('[data-act="fl-flag"][data-n="2"]'); await frames(2);
const back = await ev(() => ({ type: __game.player.type, name: __game.player.name, f2: __game.state.fleet[2].type, ups: { ...__game.state.upgrades } }));
check('and back again', back.type === before.type && back.name === before.name && back.f2 === 'frigate' && JSON.stringify(back.ups) === JSON.stringify(before.ups), JSON.stringify(back));
// sell the schooner (two clicks)
const g0 = await ev(() => __game.state.gold);
await click('[data-act="fl-sell"][data-n="1"]');
const armed = await ev(() => document.querySelector('[data-act="fl-sell"][data-n="1"]')?.textContent || '');
await click('[data-act="fl-sell"][data-n="1"]'); await frames(1);
const sold = await ev(() => ({ n: __game.state.fleet.length, gold: __game.state.gold, names: __game.state.fleet.map(f => f.name) }));
check('sell: confirm click, ship gone, gold paid', /Confirm/.test(armed) && sold.n === 2 && sold.gold > g0 && !sold.names.includes('Marie-Galante'), `+${sold.gold - g0} · ${sold.names.join(', ')}`);
// old-save default: an entry without crew / refits renders and gets its defaults
await ev(() => { __game.state.fleet.push({ type: 'sloop', name: 'Ancienne', hull: 0.5, from: 'dutch' }); __game.events.emit('game:loaded', {}); __game.ports.screen.render(); });
const old = await ev(() => __game.state.fleet[2]);
check('old save entry normalised (crew 0, no refits)', old.crew === 0 && old.upgrades && old.upgrades.berths === 0 && old.sails === 1, JSON.stringify(old));
// registry (L) lists the squadron read-only
const reg = await ev(() => { const r = __game.registry; if (!r) return null; const html = r._html(); return { rows: (html.match(/<tr/g) || []).length, has: html.includes('Your squadron') }; });
check('registry lists the squadron', !reg || (reg.has && reg.rows > 3), JSON.stringify(reg));
if (reg) { await ev(() => { __game.ports.leave(); __game.registry.open(); }); await frames(2); await ev(() => document.querySelector('.registry-screen .board-sheet')?.scrollTo(0, 1e5)); await shot('05-registry-1366'); await ev(() => { __game.registry.close(); __game.ports.enter(__game.islands.getPort('havana'), 'shipyard'); }); await page.waitForTimeout(800); }

// 8. 1920×1080
await page.setViewportSize({ width: 1920, height: 1080 }); await frames(3);
await ev(() => __game.ports.screen.render());
const b = await bounds();
check('1920×1080: flagship framed', inFrame(b), fmtB(b));
await shot('09-flagship-1920');
await ev(t => { __game.ports.screen.sel = t; __game.ports.screen.fleetSel = null; __game.ports.screen.render(); }, 'greatgalleon');
await shot('10-greatgalleon-1920');

check('zero console errors', errors.length === 0, errors.slice(0, 5).join(' | '));
log(`${passes} PASS, ${fails} FAIL${worst ? ' · out of frame:' + worst : ''}`);
await browser.close();
process.exit(fails ? 1 : 0);
