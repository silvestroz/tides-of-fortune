// Test of the usage statistics (Vercel only): activation rules, frame histogram, brackets, paths (node); with
// --browser: a real game at ?telemetry=debug (nothing is sent, the virtual pages go to window.__telemetry.log) —
// loading, first-game path, once per session, cap, Options « Statistiques » (off = nothing any more), no request
// to /_vercel in dev, console without errors.
// Usage: node tools/test-telemetry.mjs [--browser] [--shots folder]   (dev server TOF_URL, --soft = SwiftShader)
import fs from 'node:fs';
import { telemetryMode, frameStats } from '../src/core/telemetry.js';
import { TELEMETRY, PATHS, loadBucket, fpsBucket } from '../src/data/telemetry.js';

const results = [];
const check = (name, ok, info = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); };
const Q = s => new URLSearchParams(s);

// ---------------------------------------------------------------- activation rules
const m = (q, o = {}) => telemetryMode({ params: Q(q), nav: o.nav || {}, prod: o.prod ?? true, settings: o.settings || {} });
check('production : envoi', m('') === 'send');
check('dev (npm run dev) : coupé', m('', { prod: false }) === 'off');
check('?telemetry=debug : journal local, même en dev', m('telemetry=debug', { prod: false }) === 'debug');
check('?telemetry=0 : coupé', m('telemetry=0') === 'off');
check('automatisation (navigator.webdriver) : coupé', m('', { nav: { webdriver: true } }) === 'off');
check('vitrine ?shot= : coupé', m('shot=sailing') === 'off');
check('Options → Statistiques désactivées : coupé', m('', { settings: { stats: false } }) === 'off');
check('… et le choix du joueur prime sur debug', m('telemetry=debug', { settings: { stats: false } }) === 'off');
check('Do Not Track : coupé', m('', { nav: { doNotTrack: '1' } }) === 'off');
check('Global Privacy Control : coupé', m('', { nav: { globalPrivacyControl: true } }) === 'off');

// ---------------------------------------------------------------- frames and brackets
{
  const h = new Uint32Array(201); h[16] = 90; h[17] = 4; h[40] = 5; h[150] = 1;
  const s = frameStats(h);
  check('images : nombre, médiane, 5e centile', s.n === 100 && s.p50 === 16 && s.fps50 === 63 && s.p95 === 40 && s.fps5 === 25, JSON.stringify(s));
  check('images : sous 30 fps et saccades', s.slow === 6 && s.hitch === 1);
  check('histogramme vide', frameStats(new Uint32Array(201)).n === 0);
  check('tranches de chargement', loadBucket(6) === 'moins-de-10s' && loadBucket(12) === '10-20s' && loadBucket(39.9) === '20-40s' && loadBucket(50) === 'plus-de-40s');
  check('tranches de fps', fpsBucket(60) === '55fps-et-plus' && fpsBucket(144) === '55fps-et-plus' && fpsBucket(50) === '45-55fps' && fpsBucket(30) === '30-45fps' && fpsBucket(22) === 'moins-de-30fps');
}

// ---------------------------------------------------------------- paths and deployment
{
  const all = [];
  const walk = v => { if (typeof v === 'string') all.push(v); else if (typeof v === 'function') all.push(v('x', 'y')); else if (v && typeof v === 'object') Object.values(v).forEach(walk); };
  walk(PATHS);
  check('toutes les pages virtuelles sous /jeu/, sans espace ni accent', all.length > 20 && all.every(p => /^\/jeu\/[a-z0-9/-]+$/.test(p)), all.find(p => !/^\/jeu\/[a-z0-9/-]+$/.test(p)) || `${all.length} chemins`);
  check('plafond de pages virtuelles par session raisonnable', TELEMETRY.maxMarks >= 8 && TELEMETRY.maxMarks <= 20);
  const v = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));
  check('vercel.json : la page reste servie à la racine, plus de réécriture /ingest', (v.rewrites || []).some(r => r.source === '/' && /tides-of-fortune\.html$/.test(r.destination)) && !(v.rewrites || []).some(r => r.source.startsWith('/ingest')));
}

if (process.argv.includes('--browser')) await browserPart();
const ok = results.every(Boolean);
console.log(`\n${results.filter(Boolean).length}/${results.length} ${ok ? 'OK' : 'ÉCHEC'}`);
process.exit(ok ? 0 : 1);

async function browserPart() {
  const { chromium } = await import('playwright');
  const { BASE, launchOpts } = await import('./_env.mjs');
  const SHOTS = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch(launchOpts(['--disable-dev-shm-usage']));
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1 });
  const errors = [], sent = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(`[console] ${msg.text()}`); });
  page.on('pageerror', e => errors.push('[pageerror] ' + e.message));
  page.on('request', r => { if (/\/_vercel\/|\/ingest\//.test(r.url())) sent.push(r.url()); });
  await page.goto(`${BASE}?telemetry=debug`, { waitUntil: 'load', timeout: 180000 });
  await page.waitForFunction(() => (window.__ready && document.querySelector('[data-act="settings"]')) || window.__error, null, { timeout: 300000, polling: 500 });
  const startErr = await page.evaluate(() => window.__error);
  if (startErr) { check('chargement', false, startErr); await browser.close(); return; }
  const ev = (fn, arg) => page.evaluate(fn, arg);
  await ev(() => window.__game.renderer.setAnimationLoop(null));   // software rendering: the loop hogs the main thread
  const log = () => ev(() => [...window.__telemetry.log]);

  let L = await log();
  check('page « chargement » au menu', L.length === 1 && /^\/jeu\/chargement\/(moins-de-10s|10-20s|20-40s|plus-de-40s)$/.test(L[0]), JSON.stringify(L));
  check('mode debug : rien d\'envoyé, pas de script Vercel', sent.length === 0 && !document_hasVercel(await ev(() => [...document.scripts].map(s => s.src))), sent.join(' '));

  // first-game path (goal steps, polled at 1 Hz; _tick called by hand)
  await ev(() => {
    const g = window.__game, t = window.__telemetry, set = s => { g.state.tutorials.goals.step = s; t._tick(); };
    g.state.assist = true; g.state.tutorials ||= {}; g.state.tutorials.goals = { step: 'offer' };
    g.events.emit('game:new', {});
    g.state.tutorials.goals = { step: 'offer' }; t._tick();
    for (const s of ['p-sail', 'p-cam', 'p-fire', 'p-strike', 'p-board', 'visit', 'accept', 'mission', 'rank', 'done']) set(s);
  });
  L = await log();
  const want = ['/jeu/parcours/1-nouvelle-partie', '/jeu/mode/assistance', '/jeu/parcours/2-prologue-commence', '/jeu/parcours/3-prologue-gagne',
    '/jeu/parcours/4-gouverneur-vu', '/jeu/parcours/5-mission-acceptee', '/jeu/parcours/6-mission-reussie', '/jeu/parcours/7-premier-grade'];
  check('parcours de la première partie, dans l\'ordre', JSON.stringify(L.slice(1)) === JSON.stringify(want), JSON.stringify(L.slice(1)));

  // events: once per session, then the cap
  await ev(() => {
    const g = window.__game, E = (n, d) => g.events.emit(n, d);
    E('duel:end', { result: { winner: 'player' } }); E('duel:end', { result: { winner: 'player' } });
    E('player:captured', { kind: 'marooned' });
    E('career:mission', { mission: {}, status: 'progress' });
  });
  L = await log();
  check('duel gagné une seule fois, abandon, progress ignoré', L.filter(p => p === '/jeu/duel/gagne').length === 1 && L.includes('/jeu/defaite/abandon') && L.length === 11, JSON.stringify(L.slice(9)));
  await ev(() => { const g = window.__game, E = (n, d) => g.events.emit(n, d); E('career:promote', {}); E('boarding:end', { result: 'captured' }); E('player:shipwrecked', {}); E('career:retire', {}); E('duel:end', { result: { winner: 'enemy' } }); });
  L = await log();
  check(`plafond de ${TELEMETRY.maxMarks} pages par session`, L.length === TELEMETRY.maxMarks, `${L.length} : ${L.slice(11).join(' ')}`);

  // smoothness: after fluidityS seconds at sea, once
  await ev(() => { const t = window.__telemetry; t.marks.clear(); t.log.length = 0; t.hist.fill(0); t.hist[17] = 500; t._sea = 0;
    const g = window.__game, m0 = g.mode; g.mode = 'sail'; for (let i = 0; i < 200; i++) t._tick(); g.mode = m0; });
  L = await log();
  check('fluidité : qualité et tranche de fps, une fois', L.filter(p => p.startsWith('/jeu/fluidite/')).length === 1 && L.includes('/jeu/fluidite/eleve/55fps-et-plus'), JSON.stringify(L));

  // error caught by an event handler: one « erreur » page
  await ev(() => { const g = window.__game; const off = g.events.on('tof:test', () => { throw new Error('essai télémétrie'); }); g.events.emit('tof:test'); g.events.emit('tof:test'); off(); });
  L = await log();
  check('erreur : une seule page /jeu/erreur', L.filter(p => p === '/jeu/erreur').length === 1);
  errors.splice(0, errors.length, ...errors.filter(e => !/essai télémétrie/.test(e)));   // deliberate error

  // Options → « Statistiques »
  await page.addStyleTag({ content: '*{transition:none!important;animation:none!important}' });
  const clickVisible = sel => ev(sel => [...document.querySelectorAll(sel)].find(b => b.getClientRects().length && getComputedStyle(b).visibility !== 'hidden')?.click(), sel);
  await clickVisible('[data-act="settings"]');
  await page.waitForSelector('.stats-seg button[data-stats="0"]', { timeout: 10000 });
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/options.png` });
  const qSel = await ev(() => document.querySelector('.seg button[data-q].sel')?.dataset.q);
  await ev(() => document.querySelector('.stats-seg button[data-stats="0"]').click());
  const off = await ev(() => { const t = window.__telemetry; t.marks.clear(); const n0 = t.log.length; window.__game.events.emit('career:promote', {}); return { mode: t.mode, grew: t.log.length > n0, saved: JSON.parse(localStorage.getItem('tof.settings.v1') || '{}').stats }; });
  check('désactivées : plus rien n\'est compté, réglage gardé', off.mode === 'off' && !off.grew && off.saved === false, JSON.stringify(off));
  await ev(() => document.querySelector('.stats-seg button[data-stats="1"]').click());
  const on = await ev(() => { const t = window.__telemetry, n0 = t.log.length; window.__game.events.emit('career:promote', {}); return { mode: t.mode, grew: t.log.length > n0, sel: document.querySelector('.stats-seg button.sel')?.dataset.stats }; });
  check('réactivées : de nouveau comptées', on.mode === 'debug' && on.grew && on.sel === '1', JSON.stringify(on));
  const qAfter = await ev(() => document.querySelector('.seg button[data-q].sel')?.dataset.q);
  check('le choix des statistiques ne désélectionne pas les graphismes', !!qSel && qSel === qAfter, `${qSel} → ${qAfter}`);

  // in-game Options sheet (with the « Mode de jeu » row): everything fits in 1366 × 768
  await ev(() => window.__game.hud.menu.open('pause'));
  await clickVisible('[data-act="settings"]');
  await page.waitForSelector('.assist-seg', { timeout: 10000 });
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/options-pause.png` });
  const fit = await ev(() => { const r = document.querySelector('.sheet-wrap .sheet').getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), vh: innerHeight }; });
  check('Options en partie : la feuille tient dans l\'écran', fit.top >= 0 && fit.bottom <= fit.vh, JSON.stringify(fit));
  // every segmented choice inside the sheet (« Power saver » was cut at 1639×739, dpr 1.25)
  const cut = await ev(() => { const sh = document.querySelector('.sheet-wrap .sheet').getBoundingClientRect();
    return [...document.querySelectorAll('.sheet-wrap .seg')].filter(s => { const r = s.getBoundingClientRect(); return r.right > sh.right - 2 || s.scrollWidth > s.clientWidth + 1; }).map(s => s.textContent.trim()); });
  check('Options en partie : aucun choix coupé à droite', cut.length === 0, cut.join(' | '));
  await ev(() => localStorage.removeItem('tof.settings.v1'));

  check('aucune requête vers /_vercel en dev', sent.length === 0, sent.join(' '));
  check('console sans erreur', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
}

function document_hasVercel(srcs) { return srcs.some(s => s.includes('/_vercel/')); }
