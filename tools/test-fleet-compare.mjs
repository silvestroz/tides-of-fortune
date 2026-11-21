// Browser test of the squadron comparison at the shipyard (src/game/fleetCompare.js, portScreen _fleetSpecs /
// _fleetCompare / _flagPreview): A. a squadron ship picked → the specs panel shows her (refits counted, deltas vs the
// flagship); B. Compare → one column per ship, best value per row gilded, horizontal scroll at the max squadron;
// C. Flagship → preview first, a click elsewhere cancels, Confirm swaps (men / goods left = the preview).
// Usage: node tools/test-fleet-compare.mjs [--soft] [--shots dir]   (default shots: /tmp/fleet-shots)
// Needs the dev server (TOF_URL). Zero console errors expected.
import { chromium } from 'playwright';
import fs from 'node:fs';
import { BASE, SOFT, launchOpts } from './_env.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => {
  if (v.startsWith('--')) a.push([v.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : '1']);
  return a;
}, []));
const OUT = args.shots || '/tmp/fleet-shots';
fs.mkdirSync(OUT, { recursive: true });
const url = `${BASE}?shot=port&tab=shipyard&fleet=7&quality=low`;

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
const into = (sel, block = 'start') => ev(([s, b]) => document.querySelector(s)?.scrollIntoView({ block: b }), [sel, block]);
async function shot(name) {
  await frames(3);
  await ev(() => __game.renderer.setAnimationLoop(null));
  try { await page.screenshot({ path: `${OUT}/${name}.png`, timeout: SOFT ? 300000 : 120000 }); log('shot', `${OUT}/${name}.png`); }
  finally { await ev(() => __game.renderer.setAnimationLoop(() => __game.frame())); }
}

await page.goto(url, { waitUntil: 'load', timeout: 240000 });
await page.waitForFunction(() => window.__ready || window.__error, null, { timeout: 300000, polling: 500 });
log('ready', await ev(() => window.__error || 'ok'));
// squadron with different types and refits; the flagship (brig) has a deepened hold
await ev(() => {
  const st = __game.state, f = st.fleet;
  f[0].upgrades = { guns: 0, hull: 1, hold: 2, sheath: 0, canvas: 0, berths: 1 };   // merchantman
  f[2].upgrades = { guns: 1, hull: 0, hold: 0, sheath: 1, canvas: 2, berths: 0 };   // frigate
  st.upgrades.hold = 1;
  __game.ports.screen.render();
});
await frames(3);
const M = await ev(async () => { const m = await import('/src/game/fleet.js'); const s = __game.state;
  return { holdF0: m.holdCapOf('merchantman', s.fleet[0].upgrades), crewF0: m.crewMaxOf('merchantman', s.fleet[0].upgrades), n: s.fleet.length, max: m.FLEET.max }; });

// A. pick the frigate: the specs panel shows her, refits counted, deltas against the flagship
await click('.fl-pick[data-n="2"]'); await frames(2);
let A = await ev(() => { const sp = document.querySelector('.fl-specs'), on = document.querySelector('.oncale.fl-on');
  const row = l => [...(sp?.querySelectorAll(':scope > div') || [])].find(d => d.querySelector('span')?.textContent === l)?.querySelector('b')?.textContent || '';
  return { idx: sp?.dataset.fleet, on: on?.textContent || '', up: sp?.querySelectorAll('em.up').length || 0, dn: sp?.querySelectorAll('em.dn').length || 0, speed: row('Speed'), refits: row('Refits'), guns: row('Guns'), sil: !!document.querySelector('.shiprow .shipview svg'), quay: __game.ports.stage.cur?.shipInfo?.()?.type };
});
const exp = await ev(async () => { const c = await import('/src/game/fleetCompare.js'); const f = __game.state.fleet[2]; return c.shipStats(f.type, f.upgrades, f); });
check('A: panel switches to the squadron ship (name, type, quay)', A.idx === '2' && /Valiente/.test(A.on) && /Frigate/.test(A.on) && A.sil && A.quay === 'frigate', JSON.stringify(A));
check('A: deltas vs flagship present (green and red)', A.up > 0 && A.dn > 0, `up ${A.up}, dn ${A.dn}`);
check('A: refits counted (canvas → speed, refits row)', A.speed.startsWith(`${exp.speed} knots`) && A.refits.startsWith('4'), `${A.speed} · refits ${A.refits} · exp ${exp.speed}`);
await into('.shiprow', 'center'); await shot('A-specs-1366');
await click('.fl-pick[data-n="0"]'); await frames(1);
A = await ev(() => { const sp = document.querySelector('.fl-specs'); const row = l => [...sp.querySelectorAll(':scope > div')].find(d => d.querySelector('span')?.textContent === l)?.querySelector('b')?.textContent || ''; return { hold: row('Hold'), crew: row('Crew') }; });
check('A: hold and crew of a refitted ship (holdCapOf / crewMaxOf)', A.hold.startsWith(String(M.holdF0)) && A.crew.startsWith(String(M.crewF0)), JSON.stringify(A) + ` exp ${M.holdF0}/${M.crewF0}`);
await click('.own-note .lnk'); await frames(1);
check('A: back to the flagship', await ev(() => !document.querySelector('.fl-specs') && __game.ports.screen.fleetSel == null));

// B. Compare
await click('[data-act="fl-cmp"]'); await frames(1);
const B = await ev(async () => { const c = await import('/src/game/fleetCompare.js');
  const t = document.querySelector('table.fl-cmp'), sc = document.querySelector('.fl-cmpscroll'); if (!t) return null;
  const ths = [...t.querySelectorAll('thead th')], rows = [...t.querySelectorAll('tbody tr')];
  const bestCols = k => [...t.querySelectorAll(`tbody tr[data-k="${k}"] td`)].map((td, i) => td.classList.contains('best') ? i : -1).filter(i => i >= 0);
  const names = ths.slice(1).map(h => h.textContent.trim());
  const pick = (k, low) => { const v = [__game.player, ...__game.state.fleet].map((s, i) => i ? c.shipStats(s.type, s.upgrades, s)[k] : c.flagStats(s, __game.state.upgrades)[k]); const top = low ? Math.min(...v) : Math.max(...v); return v.map((x, i) => x === top ? i : -1).filter(i => i >= 0); };
  return { cols: ths.length - 1, flagFirst: ths[1].classList.contains('flag'), rows: rows.map(r => r.dataset.k), nRows: c.COMPARE_ROWS.length + 1, names,
    guns: bestCols('guns'), gunsExp: pick('guns'), draught: bestCols('draught'), draughtExp: pick('draught', true), rig: bestCols('rig'), btn: document.querySelector('[data-act="fl-cmp"]').textContent,
    scroll: sc.scrollWidth > sc.clientWidth, cardW: document.querySelector('.card.fleet').getBoundingClientRect().width, sticky: getComputedStyle(t.querySelector('tbody th')).position };
});
check('B: one column per ship, flagship first', B && B.cols === M.n + 1 && B.flagFirst && /flagship/.test(B.names[0]), B && `${B.cols} columns · ${B.names.slice(0, 3).join(' | ')}`);
check('B: one row per stat', B && B.rows.length === B.nRows && ['cls', 'guns', 'hullMax', 'crewMax', 'hold', 'speed', 'draught', 'rig', 'refits', 'hullPct', 'sailsPct'].every(k => B.rows.includes(k)), B?.rows.join(','));
check('B: best value highlighted (most guns, shallowest draught, none for rig)', B && JSON.stringify(B.guns) === JSON.stringify(B.gunsExp) && JSON.stringify(B.draught) === JSON.stringify(B.draughtExp) && !B.rig.length, B && `guns ${B.guns}/${B.gunsExp} draught ${B.draught}/${B.draughtExp}`);
check(`B: ${M.max} ships + flagship scroll inside the card, label column pinned`, B && B.scroll && B.sticky === 'sticky' && B.btn === 'Close', B && `card ${Math.round(B.cardW)} px`);
await into('.card.fleet'); await shot('B-compare-1366');
await ev(() => { const s = document.querySelector('.fl-cmpscroll'); s.scrollLeft = s.scrollWidth; }); await shot('B-compare-1366-scrolled');
await page.setViewportSize({ width: 760, height: 900 }); await frames(3); await ev(() => __game.ports.screen.render()); await into('.card.fleet');
const narrow = await ev(() => { const sc = document.querySelector('.fl-cmpscroll'), c = document.querySelector('.card.fleet').getBoundingClientRect(); return { inside: sc.getBoundingClientRect().right <= c.right + 1, scroll: sc.scrollWidth > sc.clientWidth, w: Math.round(c.width) }; });
check('B: narrow window, table scrolls inside the card', narrow.inside && narrow.scroll, JSON.stringify(narrow));
await shot('B-compare-narrow');
await page.setViewportSize({ width: 1366, height: 768 }); await frames(3);
await click('[data-act="fl-cmp"]'); await frames(1);
check('B: toggle closes the table', await ev(() => !document.querySelector('table.fl-cmp')));

// C. Flagship: preview, cancel by a click elsewhere, Confirm swaps
const t0 = await ev(() => __game.player.type);
await click('[data-act="fl-flag"][data-n="0"]'); await frames(1);
const C = await ev(() => { const p = document.querySelector('.fl-prev'), b = document.querySelector('[data-act="fl-flag"][data-n="0"]');
  return p && { txt: p.textContent.replace(/\s+/g, ' '), chips: p.querySelectorAll('.fp-d').length, up: p.querySelectorAll('.fp-d.up').length, dn: p.querySelectorAll('.fp-d.dn').length, warn: p.querySelectorAll('li.dn').length, btn: b.textContent, type: __game.player.type }; });
const pv = await ev(async () => { const c = await import('/src/game/fleetCompare.js'); const s = __game.ports.screen; return c.flagshipPreview(__game.state, 0, __game.ports._flag(), s._flagEff()); });
check('C: preview shown, no swap yet', C && C.btn === 'Confirm' && C.type === t0 && C.chips >= 6 && C.up > 0 && C.dn > 0, C && `${C.chips} stats, ${C.up} better / ${C.dn} worse · ${C.txt.slice(0, 90)}`);
check('C: what does not fit is listed (men beyond her berths, goods beyond her hold)', C && pv && (pv.menLeft > 0 ? C.txt.includes(`${pv.menLeft} of your`) : /All .* men/.test(C.txt)) && (pv.lotsLeft > 0 ? C.txt.includes('lots stay') : C.txt.includes('whole cargo')) && C.warn === (pv.menLeft > 0) + (pv.lotsLeft > 0), pv && `menLeft ${pv.menLeft}, lotsLeft ${pv.lotsLeft}`);
await into('.fl-prev', 'center'); await shot('C-preview-1366');
await click('.card.fleet > p.small'); await frames(1);
check('C: a click elsewhere cancels', await ev(() => !document.querySelector('.fl-prev') && document.querySelector('[data-act="fl-flag"][data-n="0"]').textContent === 'Flagship' && __game.player.type === 'brig'));
await click('[data-act="fl-flag"][data-n="0"]'); await click('[data-act="fl-cmp"]'); await frames(1);
check('C: another button cancels too', await ev(() => !document.querySelector('.fl-prev') && __game.player.type === 'brig'));
await click('[data-act="fl-cmp"]');
await click('[data-act="fl-flag"][data-n="0"]'); await click('[data-act="fl-flag"][data-n="0"]'); await frames(2);
const sw = await ev(() => ({ type: __game.player.type, crew: __game.player.crew, old: __game.state.fleet[0], holdUp: __game.state.upgrades.hold }));
check('C: Confirm swaps, men and goods left as previewed', sw.type === 'merchantman' && sw.old.type === 'brig' && sw.old.crew === pv.menLeft && sw.crew === pv.crew && JSON.stringify(sw.old.cargo) === JSON.stringify(pv.left) && sw.holdUp === 2, `crew ${sw.crew}, old ${sw.old.crew} men, cargo ${JSON.stringify(sw.old.cargo)}`);
await shot('C-swapped-1366');

check('zero console errors', errors.length === 0, errors.slice(0, 5).join(' | '));
log(`${passes} PASS, ${fails} FAIL`);
await browser.close();
process.exit(fails ? 1 : 0);
