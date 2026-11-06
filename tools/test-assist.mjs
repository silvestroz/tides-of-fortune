// Test of the “Assisted” game mode: auto-fire (never first, G = cease fire, not through a neutral ship, not at a
// prize to keep), boarding carried without a duel, Classic mode unchanged, captain sheet and Options, “Auto” status
// of the broadsides; the title screen has no “What’s new” any more.
// Usage: node tools/test-assist.mjs [--shots folder]   (dev server TOF_URL, GPU by default, --soft = SwiftShader)
// ?shot=sailing, render loop stopped, game.step() at 30 Hz; keys sent with `key` and `code`.
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

const results = [];
const check = (name, ok, info = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); };
const ev = (fn, arg) => page.evaluate(fn, arg);
const shot = async name => {
  if (!SHOTS) return;
  await ev(() => { const g = window.__game; g.hud?.update?.(1 / 60); g.post.render(1 / 60); });
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
};
const KEYS = { KeyE: 'e', KeyG: 'g', KeyB: 'b' };
const tap = async code => {
  await ev(([code, key]) => document.body.dispatchEvent(new KeyboardEvent('keydown', { code, key, bubbles: true })), [code, KEYS[code] || code]);
  await ev(() => { const g = window.__game; g.step(1 / 30); g.input.endFrame(); });
  await ev(([code, key]) => document.body.dispatchEvent(new KeyboardEvent('keyup', { code, key, bubbles: true })), [code, KEYS[code] || code]);
};
const sim = secs => ev(secs => { const g = window.__game; for (let i = 0; i < Math.round(secs * 30); i++) { g.step(1 / 30); g.input.endFrame(); } g.hud?.update?.(1 / 30); }, secs);

// setup: empty sea, log of the automatic broadsides, broadsides loaded
await ev(() => {
  const g = window.__game, p = g.player;
  g.renderer.setAnimationLoop(null);
  for (const s of [...g.ships]) if (s !== p) g.combat._despawn(s);
  g.combat.setTrafficTarget?.(0);
  p.crew = p.crewMax; p.hull = p.hullMax; p.sails = 1; p.speed = 0; p.sailSetting = 0; p.controller.setSailStep?.(0, { quiet: true });
  window.__auto = []; g.events.on('assist:fire', e => window.__auto.push({ side: e.side, name: e.target?.name, t: g.time }));
  window.__fires = 0; g.events.on('cannon:fire', e => { if (e?.ship === p || e?.ship?.isPlayer) window.__fires++; });
});
// a ship abeam to starboard at d metres; ctrl = 'ai' (real controller, motionless, doesn't fire) or 'stub' (inert)
const spawn = (o) => ev(o => {
  const g = window.__game, p = g.player, r = p.right();
  const e = g.combat.spawnAI({ type: o.type, faction: o.faction, role: o.role, x: p.position.x + r.x * o.d, z: p.position.z + r.z * o.d, heading: p.heading, sailSetting: 0, name: o.name });
  e.speed = 0;
  if (o.ctrl === 'stub') { e.controller = e.ai = { update() {}, state: 'cruise', target: null }; }
  else { e.ai.hold = true; e.ai.fireAtWill = false; e.ai.fearless = true; e.ai.setTarget(p); }
  if (o.hull) e.hull = e.hullMax * o.hull;
  window['__' + o.key] = e;
  return { name: e.name, crew: e.crew, hull: Math.round(e.hull) };
}, o);
// ships removed then 3 s of empty sea: balls still in flight don't hit the ship placed next (it would count as "hit by the player")
const clear = async () => {
  await ev(() => { const g = window.__game, p = g.player; for (const s of [...g.ships]) if (s !== p) g.combat._despawn(s); });
  await sim(3);
  await ev(() => { const p = window.__game.player; p.reload.port = 1; p.reload.starboard = 1; window.__auto.length = 0; window.__fires = 0; });
};
const state = () => ev(() => {
  const g = window.__game, p = g.player;
  return { auto: window.__auto.length, fires: window.__fires, rp: +p.reload.port.toFixed(2), rs: +p.reload.starboard.toFixed(2),
    st: [...document.querySelectorAll('.helm .rl .st')].map(e => e.textContent), tac: document.querySelector('.helm .tacline')?.textContent || '' };
});

// ---------------------------------------------------------------- 1. Classic mode: no auto-fire
await ev(() => { window.__game.state.assist = false; });
await spawn({ key: 'pir', type: 'sloop', faction: 'pirate', role: 'pirate', d: 300, name: 'Le Requin' });
await sim(3);
let s = await state();
check('Classique : un pirate attaque par le travers, aucune bordée ne part seule', s.auto === 0 && s.fires === 0 && s.rs === 1, JSON.stringify(s));
check('Classique : les bordées affichent « Prêt »', s.st.every(t => t === 'Ready'), s.st.join(' / '));

// ---------------------------------------------------------------- 2. « Avec assistance »: automatic return fire
await ev(() => { window.__game.state.assist = true; });
await sim(0.4);
s = await state();
check('Avec assistance : les bordées chargées affichent « Auto »', s.st.length === 2 && s.st.includes('Auto'), s.st.join(' / '));
await sim(2.5);
s = await state();
check('Avec assistance : la bordée tribord part seule sur le pirate qui attaque', s.auto >= 1 && s.rs < 1 && await ev(() => window.__auto[0]?.side === 'starboard'), JSON.stringify({ ...s, first: await ev(() => window.__auto[0]) }));
check('Avec assistance : bâbord (sans cible) ne tire pas', s.rp === 1, `bâbord ${s.rp}`);
check('premier tir automatique : un message explique G', await ev(() => !!window.__game.state.assistTold), '');
await shot('01-auto');

// ---------------------------------------------------------------- 3. G: cease fire, then fire at will
await clear();
await spawn({ key: 'pir', type: 'sloop', faction: 'pirate', role: 'pirate', d: 300, name: 'Le Requin' });
await tap('KeyG');
await sim(3);
s = await state();
check('G : cessez le feu — aucune bordée automatique, rappel « Cessez le feu (G) », bordées « Prêt »', s.auto === 0 && s.rs === 1 && /Cease fire/.test(s.tac) && s.st.every(t => t === 'Ready'), JSON.stringify(s));
await shot('02-cessez');
await tap('KeyG');
await sim(1.5);
s = await state();
check('G encore : feu à volonté, la bordée repart', s.auto >= 1 && !/Cease fire/.test(s.tac), JSON.stringify(s));

// ---------------------------------------------------------------- 4. never first
await clear();
await spawn({ key: 'esp', type: 'frigate', faction: 'spanish', role: 'patrol', d: 220, name: 'San Telmo', ctrl: 'stub' });
await sim(3);
s = await state();
check('jamais le premier : une frégate ennemie qui n’attaque pas n’essuie aucun tir automatique', s.auto === 0 && s.rs === 1, JSON.stringify(s));
await tap('KeyE');   // the player opens fire himself
await sim(2);
const hitEsp = await ev(() => window.__esp.grudges?.has(window.__game.player));
check('le joueur ouvre le feu à la main (E) et touche la frégate', hitEsp, `touchée : ${hitEsp}`);
await sim(14);   // one full reload
s = await state();
check('… puis les canonniers continuent seuls', s.auto >= 1, JSON.stringify(s));

// ---------------------------------------------------------------- 5. not through a neutral ship
await clear();
await spawn({ key: 'pir', type: 'sloop', faction: 'pirate', role: 'pirate', d: 320, name: 'Le Requin', ctrl: 'stub' });
await ev(() => window.__pir.grudges.add(window.__game.player));   // engaged (motionless: a real pirate would move out of line)
await spawn({ key: 'neu', type: 'merchantman', faction: 'french', role: 'merchant', d: 160, name: 'La Belle Poule', ctrl: 'stub' });
const neutral = await ev(() => !window.__game.combat.isHostile(window.__game.player, window.__neu));
await sim(3);
s = await state();
check('pas de bordée à travers un marchand neutre placé entre le pirate et nous', neutral && s.auto === 0, JSON.stringify({ neutral, ...s }));

// ---------------------------------------------------------------- 6. prize to keep
await clear();
await spawn({ key: 'pz', type: 'brig', faction: 'pirate', role: 'pirate', d: 260, name: 'Le Corbeau', ctrl: 'stub', hull: 0.3 });
await ev(() => window.__pz.grudges.add(window.__game.player));   // already hit by the player
await sim(3);
s = await state();
const bh = await ev(() => !!window.__game.combat.boardHint);
check('prise à garder : un navire abordable qui ne se bat plus n’essuie plus de tir (invite d’abordage)', s.auto === 0 && bh, JSON.stringify({ ...s, boardHint: bh }));

// ---------------------------------------------------------------- 7. boarding carried without a duel
await ev(() => { const g = window.__game, p = g.player, e = window.__pz, r = p.right(); e.position.x = p.position.x + r.x * 30; e.position.z = p.position.z + r.z * 30; window.__duelCalls = 0; const d0 = g.duel.start.bind(g.duel); g.duel.start = (...a) => { window.__duelCalls++; return d0(...a); }; });
await sim(0.2);
await tap('KeyB');
await page.waitForFunction(() => document.querySelector('.board-sheet.capture'), null, { timeout: 15000 }).catch(() => {});
const cap = await ev(() => ({ duel: window.__duelCalls, active: !!window.__game.duel?.active, sheet: document.querySelector('.board-sheet.capture .sub')?.textContent || '' }));
check('Avec assistance : B emporte le pont sans duel (écran de prise)', cap.duel === 0 && !cap.active && /Your men have carried the deck/.test(cap.sheet), JSON.stringify(cap));
await shot('03-prise');
const end = await ev(() => new Promise(res => { const g = window.__game; g.events.on('boarding:end', e => res(e.result)); document.querySelector('.board-sheet.capture button[data-c="sunk"]')?.click(); setTimeout(() => res('timeout'), 4000); }));
check('la prise se règle comme après un duel gagné (boarding:end)', end === 'sunk', String(end));
await sim(0.5);

// ---------------------------------------------------------------- 8. Classic: boarding always goes through the duel
await ev(() => { window.__game.state.assist = false; });
await clear();
await spawn({ key: 'pz2', type: 'sloop', faction: 'pirate', role: 'pirate', d: 30, name: 'La Pie', ctrl: 'stub', hull: 0.25 });
await ev(() => { const g = window.__game; window.__duelCalls = 0; g.duel.start = (...a) => { window.__duelCalls++; return Promise.resolve({ winner: 'player', reason: 'wounds' }); }; });
await sim(0.2);
await tap('KeyB');
await page.waitForFunction(() => window.__duelCalls > 0, null, { timeout: 15000 }).catch(() => {});   // (the previous capture screen stays in the page)
const cl = await ev(() => ({ duel: window.__duelCalls }));
check('Classique : l’abordage lance le duel', cl.duel === 1, JSON.stringify(cl));
await page.waitForTimeout(1500);
await ev(() => { const g = window.__game; if (g.boarding.active) g.boarding._resolveCapture(g.player, window.__pz2, 'sunk'); });
await sim(0.5);

// ---------------------------------------------------------------- 9. captain sheet and Options
const sheet = await ev(() => {
  const g = window.__game, m = g.hud.menu;
  m.open('title'); m._go('captain');
  const ch = [...document.querySelectorAll('.menu-layer .choice[data-g="mode"]')];
  ch.find(b => b.dataset.v === 'assist')?.click();
  const out = { n: ch.length, labels: ch.map(b => b.querySelector('.t')?.textContent), sel: document.querySelector('.menu-layer .choice[data-g="mode"].sel')?.dataset.v, sheet: m.sheet.mode };
  const btn = document.querySelector('.menu-layer [data-act="start"]')?.getBoundingClientRect(), sh = document.querySelector('.menu-layer .captain-sheet')?.getBoundingClientRect();
  out.startVisible = !!btn && btn.bottom <= innerHeight && btn.top >= 0;
  out.rect = sh ? [Math.round(sh.top), Math.round(sh.bottom)] : null; out.fits = !!sh && sh.top >= 0 && sh.bottom <= innerHeight;
  return out;
});
await shot('04-fiche');
check('fiche du capitaine : « Mode de jeu » Classique / Avec assistance', sheet.n === 2 && sheet.labels.join('|') === 'Classic|Assisted' && sheet.sel === 'assist' && sheet.sheet === 'assist', JSON.stringify(sheet));
check('fiche du capitaine : la feuille entière tient à 1366 × 768', sheet.startVisible && sheet.fits, JSON.stringify(sheet.rect));
// title screen: no “What’s new” screen any more (removed), no “Credits” either
await ev(() => { const m = window.__game.hud.menu; m.close(); m.open('title'); });
await shot('06-titre');
const title = await ev(() => [...document.querySelectorAll('.menu-layer .main-menu .mi')].map(b => b.textContent.trim()));
check('écran titre : ni « What’s new » ni « Credits »', title.length >= 4 && !title.some(t => /What’s new|Credits/.test(t)), JSON.stringify(title));
const opts = await ev(() => {
  const g = window.__game, m = g.hud.menu;
  m.close(); m.open('title'); m._go('settings');
  const atTitle = !!document.querySelector('.menu-layer .assist-seg');
  m.close(); g.mode = 'sail'; g.state.assist = false;
  m.open('pause'); m._go('settings');
  const seg = document.querySelector('.menu-layer .assist-seg');
  seg?.querySelector('[data-assist="assist"]')?.click();
  const out = { atTitle, inGame: !!seg, now: g.state.assist, sel: seg?.querySelector('.sel')?.dataset.assist };
  return out;
});
await shot('05-options');
await ev(() => window.__game.hud.menu.close());
check('Options en partie : « Mode de jeu » modifiable (pas à l’écran titre)', !opts.atTitle && opts.inGame && opts.now === true && opts.sel === 'assist', JSON.stringify(opts));
check('zéro erreur console', !errors.length, errors.slice(0, 4).join(' | '));

await browser.close();
const bad = results.filter(x => !x).length;
console.log(`\n${results.length - bad}/${results.length} PASS`);
process.exit(bad ? 1 : 0);
