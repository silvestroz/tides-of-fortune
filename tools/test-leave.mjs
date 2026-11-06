// Test of the leave guard (src/ui/leaveGuard.js): activation rules (node); with --browser, a real game at
// ?guard=1: right click blocked (except text fields), guard pushed at the first interaction, Back in a game
// → « Quitter la partie ? » sheet (game frozen, Escape = stay), « Quitter » saves and returns to the previous
// page, reload in a game → browser confirmation, stale entry skipped after a reload, Back without a question on
// the title screen, « Retour au titre » without confirmation, console without errors.
// Software rendering: right after a game starts, the main thread compiles shaders for long seconds (navigation
// delayed by ~25 s): generous waits.
// Usage: node tools/test-leave.mjs [--browser] [--shots folder] [--trace]   (dev server TOF_URL, --soft = SwiftShader)
import fs from 'node:fs';
import { guardEnabled } from '../src/ui/leaveGuard.js';

const results = [];
const check = (name, ok, info = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); };
const g = (q, o = {}) => guardEnabled({ params: new URLSearchParams(q), nav: o.nav || {}, dev: !!o.dev });

check('production : active', g('') === true);
check('dev (npm run dev) : coupée', g('', { dev: true }) === false);
check('automatisation (navigator.webdriver) : coupée', g('', { nav: { webdriver: true } }) === false);
check('vitrine ?shot= : coupée', g('shot=sailing') === false);
check('?guard=0 : coupée', g('guard=0') === false);
check('?guard=1 : forcée, même en dev et sous automatisation', g('guard=1', { dev: true, nav: { webdriver: true } }) === true);

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
  const errors = [], dialogs = [];
  // the test's "previous" page (README.md) has no icon: its 404 on /favicon.ico has nothing to do with the game
  page.on('console', msg => { if (msg.type() === 'error' && !/favicon\.ico|README\.md/.test(msg.location()?.url || '')) errors.push(`[console] ${msg.text()} (${msg.location()?.url || ''})`); });
  page.on('pageerror', e => errors.push('[pageerror] ' + e.message));
  page.on('dialog', d => { dialogs.push(d.type()); d.accept().catch(() => {}); });
  if (process.argv.includes('--trace')) {   // log of navigations and history (diagnostics)
    const t0 = Date.now(), T = () => ((Date.now() - t0) / 1000).toFixed(1);
    page.on('framenavigated', f => { if (f === page.mainFrame()) console.log(`  [${T()}] nav ${f.url()}`); });
    page.on('console', m => { if (/^\[garde\]/.test(m.text())) console.log(`  [${T()}] ${m.text()}`); });
    page.on('dialog', d => console.log(`  [${T()}] dialog ${d.type()}`));
    await page.addInitScript(() => { addEventListener('popstate', () => console.log('[garde] popstate ' + JSON.stringify(history.state) + ' len ' + history.length)); });
  }
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const PREV = `${BASE}README.md`, GAME = `${BASE}?guard=1`;
  const load = async () => {
    await page.waitForFunction(() => window.__ready || window.__error, null, { timeout: 300000, polling: 500 });
    const err = await ev(() => window.__error);
    if (err) throw new Error(err);
    await ev(() => window.__game.renderer.setAnimationLoop(null));   // software rendering: the loop hogs the main thread
  };
  // _start() goes to sea after the fade to black (setTimeout)
  const startGame = async () => {
    await ev(() => { const m = window.__game.hud.menu; m.open('title'); m._go('captain'); m._start(); });
    await page.waitForFunction(() => window.__game?.mode === 'sail', null, { timeout: 60000, polling: 250 }).catch(() => {});
    return ev(() => window.__game?.mode);
  };
  // user gesture (trusted event) in a corner without HUD
  const touch = async () => { await page.mouse.click(683, 300); await ev(() => window.__game.input.endFrame()); };
  const hist = () => ev(() => ({ len: history.length, tof: history.state?.tof, depth: history.state?.tofDepth | 0 }));
  const sheet = () => ev(() => { const l = document.querySelector('.leave-layer'); return { show: !!l?.classList.contains('show'), txt: l?.querySelector('.leave-txt')?.textContent || '', frozen: window.__game.frozen }; });
  const shot = async name => { if (!SHOTS) return; await ev(() => { const g = window.__game; g.hud?.update?.(1 / 60); g.post.render(1 / 60); }); await page.screenshot({ path: `${SHOTS}/${name}.png` }); };

  await page.goto(PREV);
  const L0 = await ev(() => history.length);   // a new page may count its about:blank
  await page.goto(GAME, { waitUntil: 'load', timeout: 180000 });
  try { await load(); } catch (e) { check('chargement', false, String(e)); await browser.close(); return; }

  // ---- right click
  const ctx = await ev(() => {
    const fire = el => { const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }); el.dispatchEvent(e); return e.defaultPrevented; };
    const inp = document.createElement('input'); inp.type = 'text'; document.getElementById('ui').appendChild(inp);
    const r = { canvas: fire(window.__game.renderer.domElement), menu: fire(document.querySelector('.menu-layer') || document.body), body: fire(document.body), input: fire(inp) };
    inp.remove(); return r;
  });
  check('clic droit : bloqué sur la 3D, les menus et la page', ctx.canvas && ctx.menu && ctx.body, JSON.stringify(ctx));
  check('clic droit : permis dans un champ de saisie', ctx.input === false);

  // ---- guard pushed at the first interaction
  let h = await hist();
  check('au chargement : entrée de base, rien de périmé', h.tof === 'base' && h.depth === 0 && h.len === L0 + 1, JSON.stringify(h));
  await touch();
  h = await hist();
  check('première interaction : garde posée', h.tof === 'guard' && h.len === L0 + 2, JSON.stringify(h));

  // ---- Back in a game
  check('nouvelle partie lancée', (await startGame()) === 'sail');
  await page.goBack({ waitUntil: 'commit' }).catch(() => {});
  await page.waitForSelector('.leave-layer.show', { timeout: 60000 }).catch(() => {});
  let s = await sheet();
  check('retour arrière en partie : feuille « Quitter la partie ? », jeu gelé', s.show && s.frozen && /saved/.test(s.txt), JSON.stringify(s));
  check('… on est resté sur la page du jeu', page.url().startsWith(GAME), page.url());
  await shot('01-quitter');
  const keyOk = await ev(() => { const g = window.__game; g.input.keys.clear(); document.body.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', key: 'z', bubbles: true })); const r = !g.input.keys.has('KeyW'); document.body.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', key: 'z', bubbles: true })); return r; });
  check('feuille ouverte : le jeu ne reçoit pas le clavier', keyOk);
  await page.keyboard.press('Escape');
  s = await sheet(); h = await hist();
  check('Échap : on reste, jeu dégelé, garde reposée', !s.show && !s.frozen && h.tof === 'guard', JSON.stringify({ s, h }));
  check('Échap n\'a pas ouvert le menu de pause', await ev(() => !window.__game.hud.menu.isOpen));

  // ---- « Quitter »: save then previous page
  await ev(() => { try { localStorage.removeItem('tof.save.v1'); } catch {} });
  await page.goBack({ waitUntil: 'commit' }).catch(() => {});
  await page.waitForSelector('.leave-layer.show', { timeout: 60000 });
  await Promise.all([page.waitForURL(u => !String(u).startsWith(GAME), { timeout: 90000 }).catch(() => {}), page.click('.leave-layer [data-act="leave"]')]);
  check('« Quitter » : retour à la page précédente, sans confirmation du navigateur', page.url() === PREV && dialogs.length === 0, `${page.url()} · ${dialogs.join(',')}`);
  check('… partie sauvegardée avant de partir', await ev(() => !!localStorage.getItem('tof.save.v1')));

  // ---- reload in a game: browser confirmation, then the stale entry is skipped
  await page.goto(GAME, { waitUntil: 'load', timeout: 180000 }); await load();
  await startGame(); await touch();
  const nd = dialogs.length;
  await page.reload({ waitUntil: 'load', timeout: 180000 }).catch(() => {});
  check('rechargement en partie : confirmation du navigateur (beforeunload)', dialogs.length === nd + 1 && dialogs.at(-1) === 'beforeunload', dialogs.join(','));
  await load();
  h = await hist();
  check('après rechargement sur la garde : une entrée périmée comptée', h.tof === 'base' && h.depth === 1, JSON.stringify(h));
  await startGame(); await touch();
  await page.goBack({ waitUntil: 'commit' }).catch(() => {});
  await page.waitForSelector('.leave-layer.show', { timeout: 60000 }).catch(() => {});
  check('… le retour arrière ouvre bien la feuille', (await sheet()).show);
  await Promise.all([page.waitForURL(u => !String(u).startsWith(GAME), { timeout: 90000 }).catch(() => {}), page.click('.leave-layer [data-act="leave"]').catch(() => {})]);
  check('… « Quitter » saute l\'entrée périmée', page.url() === PREV, `${page.url()} ${JSON.stringify(await hist().catch(e => String(e).slice(0, 60)))}`);

  // ---- on the title screen: Back leaves without a question
  await page.goto(GAME, { waitUntil: 'load', timeout: 180000 }); await load();
  await touch();
  await page.goBack({ waitUntil: 'commit' }).catch(() => {});
  await page.waitForURL(u => !String(u).startsWith(GAME), { timeout: 90000 }).catch(() => {});
  check('au titre : le retour arrière quitte sans feuille ni confirmation', page.url() === PREV && dialogs.length === nd + 1, `${page.url()} · ${dialogs.join(',')}`);

  // ---- « Retour au titre » (pause menu): intended reload, no confirmation
  await page.goto(GAME, { waitUntil: 'load', timeout: 180000 }); await load();
  await startGame(); await touch();
  await ev(() => { const m = window.__game.hud.menu; m.open('pause'); m.scr.querySelector('[data-act="quit"]').click(); });
  await page.waitForFunction(() => !window.__game || window.__game.mode === 'menu', null, { timeout: 300000, polling: 500 }).catch(() => {});
  await load();
  check('« Retour au titre » : pas de confirmation du navigateur', dialogs.length === nd + 1, dialogs.join(','));

  check('console sans erreur', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
}
