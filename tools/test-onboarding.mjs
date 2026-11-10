// Scripted test of the onboarding (Playwright): contextual hints (one card at a time, remembered in
// state.tutorials.hints, never repeated, suspended behind screens, switched off in Options, « Réafficher les
// conseils »), the « Premiers pas » sheet from the pause menu, the guided career goals of a new game (visit → accept →
// mission → rank → done) and an old save without `tutorials` (no error, no goals, veteran hints pre-marked).
// Also the playable prologue told by the first mate (offer panel with his 3D-painted portrait, Begin / Skip; four orders
// each cleared by the player's action: sails and helm → view (C) → broadside → board (B); no ordinary hint meanwhile,
// an urgent one stacks above the panel; the order's keys never queued behind; Skip mid-way; target sunk or vanished →
// no dead end; other ships ignore the target).
// Usage: node tools/test-onboarding.mjs [--shots folder] [--q "quality=low"]   (dev server at TOF_URL)
// Drives the real game (title → Appareiller) with the render loop stopped: game.step() + hud.update(), keys dispatched
// on document.body with `key` and `code`. hints.advance(s) fast-forwards the reading clock. Viewport 1366×768.
// Exit code 1 on any failure or console error.
import { chromium } from 'playwright';
import fs from 'node:fs';
import { BASE, launchOpts } from './_env.mjs';

const arg = k => process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : null;
const SHOTS = arg('--shots');
const Q = arg('--q') ?? 'quality=low';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch(launchOpts());
const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1, locale: 'fr-FR' });
const page = await ctx.newPage();
const errors = [], warnings = [];
page.on('console', m => { if (m.type() === 'error') errors.push(`[console] ${m.text()}`); else if (m.type() === 'warning') warnings.push(m.text()); });
page.on('pageerror', e => errors.push('[pageerror] ' + e.message));
const results = [];
const check = (name, ok, info = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); };
const ev = (fn, a) => page.evaluate(fn, a);
const wait = ms => page.waitForTimeout(ms);
// random traffic (a pirate passing within 800 m queues « Les bordées ») would make the order of the cards random:
// the sea is cleared and the traffic stopped for the scripted checks
const calm = () => ev(() => { const g = window.__game; g.combat.setTrafficTarget?.(0); for (const s of [...g.ships]) if (s !== g.player && !s._prologue) g.removeShip(s); });

let noTransitions = false;
async function boot() {
  await page.goto(`${BASE}?${Q}`, { waitUntil: 'load', timeout: 240000 });
  await page.waitForFunction(() => window.__ready || window.__error, null, { timeout: 300000, polling: 250 });
  noTransitions = false;   // a fresh page has lost the capture style tag
  const err = await ev(() => window.__error);
  if (err) { console.log('STARTUP ERROR', err); process.exit(1); }
  await ev(() => { const g = window.__game; g.renderer.setAnimationLoop(null); g.__notes = []; g.events.on('notify', e => g.__notes.push(e.text)); });
}
const shot = async name => {
  if (!SHOTS) return;
  if (!noTransitions) { noTransitions = true; await page.addStyleTag({ content: '*{transition:none!important;animation:none!important}' }); }
  await ev(() => { const g = window.__game; g.hud?.update?.(1 / 60); g.post.render(1 / 60); });
  try { await page.screenshot({ path: `${SHOTS}/${name}.png`, timeout: 120000 }); } catch (e) { console.log(`(capture ${name} skipped: ${e.message.split('\n')[0]})`); }
};
const KEYS = { KeyJ: 'j', Escape: 'Escape', KeyW: 'z', KeyM: 'm', KeyC: 'c' };
const tap = async code => {
  await ev(([code, key]) => document.body.dispatchEvent(new KeyboardEvent('keydown', { code, key, bubbles: true })), [code, KEYS[code] || code]);
  await ev(() => { const g = window.__game; g.step(g.frozen ? 0 : 1 / 30); g.hud?.update?.(0); g.input.endFrame(); });
  await ev(([code, key]) => document.body.dispatchEvent(new KeyboardEvent('keyup', { code, key, bubbles: true })), [code, KEYS[code] || code]);
};
// game time at 30 Hz, the HUD (and the hints) updated as in the real loop
const sim = secs => ev(secs => { const g = window.__game; for (let i = 0; i < Math.round(secs * 30); i++) { g.step(g.frozen ? 0 : 1 / 30 * g.timeScale); g.input.endFrame(); } }, secs);
const adv = secs => ev(s => { const h = window.__game.hud.hints; for (let t = 0; t < s; t += 0.25) h.advance(Math.min(0.25, s - t)); }, secs);
const hs = () => ev(() => {
  const g = window.__game, h = g.hud.hints, cards = [...document.querySelectorAll('.hint-card')];
  const vis = cards.filter(c => !c.classList.contains('off') && !c.classList.contains('held'));
  const gl = document.querySelector('.goal-line');
  const mg = document.querySelector('.mate-guide'), mOn = !!mg && !mg.classList.contains('off') && !mg.classList.contains('held');
  return { cur: h.current?.key || null, queue: h.queue.slice(), seen: { ...(g.state.tutorials?.hints || {}) }, vis: vis.length, held: cards.some(c => c.classList.contains('held')),
    shown: vis[0]?.dataset.hint || null, text: vis[0]?.textContent || '', goal: g.state.tutorials?.goals || null,
    goalOn: !!gl && !gl.classList.contains('off'), goalText: gl?.textContent || '', mode: g.mode, rect: vis[0]?.getBoundingClientRect().toJSON() || null,
    mate: mOn, mateStep: mOn ? mg.dataset.step : null, mateText: mOn ? mg.textContent.replace(/\s+/g, ' ') : '', mateRect: mOn ? mg.getBoundingClientRect().toJSON() : null,
    mateImg: mOn ? (mg.querySelector('.mg-face image')?.getAttribute('href') || '').slice(0, 22) : '', mateMood: mOn ? mg.querySelector('.mg-face')?.dataset.mood : null,
    mateKeys: mOn ? [...mg.querySelectorAll('.kc')].map(k => k.dataset.code || k.textContent).join(' ') : '', todoOk: mOn ? mg.querySelectorAll('.mg-todo li.ok').length : 0 };
});

// ================================================================ new game
await boot();
await ev(() => { const m = window.__game.hud.menu; m._go('captain'); m._start(); });
await wait(1600);
await calm();
await sim(0.5);
await adv(0.5);
let s = await hs();
const prep = await ev(() => ({ ms: window.__game.hud.hints.mate.prepMs, n: Object.values(window.__game.hud.hints.mate.faces).filter(Boolean).length }));
check('new game: the first mate offers the prologue (Begin / Skip), no hint card, no goal line', s.goal?.step === 'offer' && s.mate && s.mateStep === 'offer' && s.vis === 0 && !s.goalOn
  && /Mr Hale/.test(s.mateText) && /Begin/.test(s.mateText) && /Skip/.test(s.mateText), s.mateText.slice(0, 90));
check('first mate: portrait painted from the 3D character (3 moods, at game creation)', s.mateImg.startsWith('data:image/png') && prep.n === 3, `${prep.n} faces in ${prep.ms?.toFixed(0)} ms`);
const offerBox = await ev(() => { const m = document.querySelector('.mate-guide').getBoundingClientRect(), b = document.querySelector('.helm .bar')?.getBoundingClientRect();
  const ov = b && !(m.right <= b.left || b.right <= m.left || m.bottom <= b.top || b.bottom <= m.top); return { w: m.width, h: m.height, cx: m.left + m.width / 2, ov, vw: innerWidth }; });
check('offer panel: larger than a hint card, left of the ship, clear of the bottom bar', offerBox.w >= 380 && offerBox.cx < offerBox.vw * 0.3 && !offerBox.ov, JSON.stringify(offerBox));
check('new game: no hint seen yet', Object.keys(s.seen).length === 0, JSON.stringify(s.seen));
await shot('00-prologue-offre');
await ev(() => document.querySelector('.mate-guide [data-pro="skip"]').click());
await adv(0.3);
s = await hs();
check('« Skip »: goals set (visit), the mate leaves, the objective line shown', s.goal?.step === 'visit' && !s.mate && s.goalOn && /governor/.test(s.goalText) && s.cur === null, s.goalText);

// first hints: the game starts in the harbour → « Escale » (F) at once; the wind hint follows after a few seconds
await adv(2);
s = await hs();
check('new game in the harbour: « Escale » (F) first, remembered', s.shown === 'port' && s.seen.port && /port/i.test(s.text), s.text.slice(0, 70));
await calm();
await adv(8);
s = await hs();
check('a few seconds at sea: « Le vent et les allures » queued behind it', s.cur === 'port' && s.queue.includes('sail') && s.vis === 1, `cur ${s.cur} queue ${s.queue}`);
await calm();
await ev(() => document.querySelector('.hint-card').click());
await adv(2);
s = await hs();
check('« Le vent et les allures » shown next, remembered', s.shown === 'sail' && s.seen.sail && /point of sail/i.test(s.text), s.text.slice(0, 80));
const lay = await ev(() => {
  const r = q => document.querySelector(q)?.getBoundingClientRect();
  const c = r('.hint-card'), helm = r('.helm .bar'), tgt = r('.target'), toasts = r('.toasts'), goal = r('.goal-line');
  const ov = (a, b) => a && b && a.width && b.width && !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
  const fs = parseFloat(getComputedStyle(document.querySelector('.hint-card .hc-txt')).fontSize);
  const ff = getComputedStyle(document.querySelector('.hint-card .hc-txt')).fontFamily;
  return { helm: ov(c, helm), target: ov(c, tgt), goalHelm: ov(goal, helm), fs, ff, kc: document.querySelectorAll('.hint-card .kc[data-code]').length };
});
check('hint card clear of the bottom bar and the target card', !lay.helm && !lay.target && !lay.goalHelm, JSON.stringify(lay));
check('hint text in Spectral ≥ 13 px, position keys as layout badges', /Spectral/.test(lay.ff) && lay.fs >= 13 && lay.kc >= 4, `${lay.fs}px ${lay.ff.split(',')[0]} · ${lay.kc} badges`);
await shot('01-conseil-vent-objectif');

// queue: several triggers by their real events → still one card at a time
await ev(() => {
  const g = window.__game, e = g.events;
  e.emit('boarding:end', { result: 'captured', enemy: null });   // first prize kept → squadron
  e.emit('fortune:item', {});                                     // → registry
  e.emit('cannon:fire', { ship: g.player, side: 'port', count: 4 });   // → broadsides
  e.emit('player:sail', { step: 2 });                            // already seen: nothing
});
s = await hs();
check('events queue their hints, one card at a time', s.vis === 1 && s.cur === 'sail' && ['fleet', 'registry', 'guns'].every(k => s.queue.includes(k)) && !s.queue.includes('sail'), `cur ${s.cur} queue ${s.queue}`);
// a screen over the sea (journal J) suspends the card
await tap('KeyJ');
s = await hs();
check('journal open: card suspended (held), not counted', s.held && s.vis === 0, `held ${s.held}`);
await tap('KeyJ');
s = await hs();
check('journal closed: the same card is back', s.vis === 1 && s.cur === 'sail');
// read time elapses → next card after a short gap
const head = (await hs()).queue[0];
await adv(16);
s = await hs();
check('card closes by itself after its reading time', s.cur !== 'sail');
await adv(2);
s = await hs();
check('next queued hint shown (head of the queue)', s.vis === 1 && s.cur === head && s.seen[head], `${s.cur}: ${s.text.slice(0, 70)}`);
await ev(() => { const h = window.__game.hud.hints; if (h.current?.key !== 'fleet') { h.queue = h.queue.filter(k => k !== 'fleet'); h.dismiss(); h.trigger('fleet'); h.queue.unshift(h.queue.splice(h.queue.indexOf('fleet'), 1)[0]); } });
await adv(2);
s = await hs();
check('« Votre escadre » card (first prize kept) names the shipyard', s.cur === 'fleet' && /shipyard/.test(s.text), s.text.slice(0, 80));
await shot('02-conseil-escadre');
// click closes it
await ev(() => document.querySelector('.hint-card').click());
await adv(0.3);
s = await hs();
const head2 = s.queue[0];
check('a click closes the card', s.cur === null && s.vis === 0);
await adv(2);
s = await hs();
check('then the next one', s.cur && s.cur === head2, `${s.cur} (expected ${head2})`);
// no repetition: already seen hints are never queued again
const again = await ev(() => { const h = window.__game.hud.hints; return ['sail', 'fleet', 'registry'].map(k => h.trigger(k)); });
check('seen hints are not repeated', again.every(x => x === false), JSON.stringify(again));
// mnemonic key already used → hint marked without a card (time compression)
await ev(() => { window.__game.timeScale = 4; });
await adv(0.6);
s = await hs();
check('T already used: « Presser le temps » marked without a card', s.seen.time && s.cur !== 'time' && !s.queue.includes('time'));
await ev(() => { window.__game.timeScale = 1; });

// ================================================================ governor goals (port)
const port = await ev(() => {
  const g = window.__game, o = g.state.tutorials.goals, port = g.islands.ports.find(p => p.id === o.port) || g.islands.ports[0];
  g.ports.enter(port); g.ports.goto('governor', true);
  return { id: port.id, name: port.name, faction: port.faction, locked: g.ports.locked(port, 'governor') };
});
await adv(0.6);
s = await hs();
check('port: the card is not shown over the port screen', s.vis === 0 && s.mode === 'port');
check('governor visited → goal « accepter une mission »', s.goal?.step === 'accept', `${port.name} (${port.faction}) locked=${port.locked} step=${s.goal?.step}`);
const mis = await ev(() => {
  const g = window.__game, c = g.career, port = g.ports.port;
  const offers = c.offerMissions(port).filter(m => m.kind !== 'escort');
  const m = offers[0]; if (!m) return null;
  c.accept(m);
  return { title: m.title, id: m.id, notes: g.__notes.slice(-3) };
});
await adv(0.3);
s = await hs();
check('mission accepted → goal « réussir la mission »', mis && s.goal?.step === 'mission' && s.goal.missionId === mis.id && /Goal/.test(mis.notes.join(' ')), mis?.title);
await shot('03-port-objectif');
await ev(() => window.__game.ports.leave());
await sim(0.3);
s = await hs();
// a mission that ends in port is announced by its action (« Livrer … à St. John's (F) »)
check('back at sea: objective line names the mission', s.goalOn && (s.goalText.includes(mis?.title || '§') || / to .+\(F\)/.test(s.goalText)), s.goalText);
await shot('03b-mer-objectif');
await ev(() => { const g = window.__game, m = g.state.missions.find(x => x.status === 'active'); g.career._complete(m); });
await adv(0.6);
s = await hs();
check('mission done → goal « premier grade »', s.goal?.step === 'rank' && /rank/.test(s.goalText), s.goalText);
await ev(() => { const g = window.__game, n = g.state.nationality || 'english'; g.state.merit[n] = 99; });
await adv(0.6);
s = await hs();
check('merit enough → « un gouverneur … vous attend »', s.goal?.ready && /awaits/.test(s.goalText), s.goalText);
await ev(() => { const g = window.__game; g.career.promote(g.state.nationality || 'english'); });
await adv(0.6);
s = await hs();
const fin = await ev(() => window.__game.__notes.slice(-4).join(' | '));
check('first rank → goals done, objective line hidden', s.goal?.step === 'done' && !s.goalOn && /First steps done/.test(fin), fin.slice(0, 120));

// ================================================================ Options: off, then « Réafficher les conseils »
await ev(() => { const g = window.__game, h = g.hud.hints; h.dismiss(); h.queue = []; h.trigger('map'); });
await adv(2);
s = await hs();
check('a hint is on screen before switching off (map)', s.cur === 'map');
await tap('Escape');
await ev(() => document.querySelector('.menu-layer [data-act="settings"]').click());
await shot('04-options-conseils');
await ev(() => document.querySelector('.menu-layer [data-hints="0"]').click());
const off = await ev(() => ({ set: window.__game.settings.hints, stored: JSON.parse(localStorage.getItem('tof.settings.v1') || '{}').hints }));
await ev(() => window.__game.hud.menu.back());   // → pause
await ev(() => window.__game.hud.menu.close());
await adv(0.5);
const offTrig = await ev(() => { const h = window.__game.hud.hints; return [h.trigger('journal'), h.trigger('hold'), h.trigger('storm')]; });
await adv(3);
s = await hs();
check('Options « Désactivés »: setting stored, card gone, nothing queued', off.set === false && off.stored === false && s.vis === 0 && !s.cur && offTrig.every(x => !x), JSON.stringify(off));
await ev(() => { window.__game.state.tutorials.goals = { step: 'accept' }; });
await adv(0.3);
s = await hs();
check('hints off: no objective line either', !s.goalOn);
await ev(() => { window.__game.state.tutorials.goals.step = 'done'; });
await tap('Escape');
await ev(() => document.querySelector('.menu-layer [data-act="settings"]').click());
await ev(() => document.querySelector('.menu-layer [data-act="hints-reset"]').click());
const rs = await ev(() => ({ on: window.__game.settings.hints, seen: Object.keys(window.__game.state.tutorials.hints).length, duel: window.__game.state.tutorials.duel, sel: document.querySelector('.hints-seg .sel')?.dataset.hints }));
check('« Réafficher les conseils »: all forgotten, hints back on', rs.on === true && rs.seen === 0 && rs.duel === false && rs.sel === '1', JSON.stringify(rs));
await ev(() => window.__game.hud.menu.back());

// ================================================================ « Premiers pas » from the pause menu
await ev(() => document.querySelector('.menu-layer [data-act="firststeps"]').click());
const fsx = await ev(() => {
  const sh = document.querySelector('.firststeps-sheet'); if (!sh) return null;
  const r = sh.getBoundingClientRect(), wrap = sh.closest('.sheet-wrap').getBoundingClientRect();
  const txt = sh.querySelector('.fs-loop li div > span');
  return { top: r.top, bottom: r.bottom, h: r.height, vh: innerHeight, steps: sh.querySelectorAll('.fs-loop li').length, keys: sh.querySelectorAll('.fs-keys .kc').length,
    codes: [...sh.querySelectorAll('.fs-keys .kc[data-code]')].map(e => e.dataset.code + '=' + e.textContent).join(' '), fs: parseFloat(getComputedStyle(txt).fontSize), ff: getComputedStyle(txt).fontFamily,
    scroll: sh.scrollHeight > sh.clientHeight + 1, over: wrap.top < 0 || wrap.bottom > innerHeight, text: sh.textContent };
});
check('« Premiers pas » opens from the pause menu: 6 steps, key badges', fsx && fsx.steps === 6 && fsx.keys >= 14 && /governor/.test(fsx.text) && /retirement/i.test(fsx.text), fsx && `${fsx.steps} steps, ${fsx.keys} keys: ${fsx.codes}`);
check('« Premiers pas » fits 1366×768 without scrolling, Spectral ≥ 13 px', fsx && !fsx.scroll && !fsx.over && fsx.top >= 0 && fsx.bottom <= fsx.vh && fsx.fs >= 13 && /Spectral/.test(fsx.ff), fsx && `${Math.round(fsx.top)}–${Math.round(fsx.bottom)} / ${fsx.vh} px, ${fsx.fs}px`);
await shot('05-premiers-pas');
await tap('Escape');
const backTo = await ev(() => window.__game.hud.menu.screen);
check('Échap returns to the pause menu', backTo === 'pause', backTo);
await ev(() => window.__game.hud.menu.close());

// ================================================================ urgent hint over a fight (board) does not cover the target card
await ev(() => {
  const g = window.__game, p = g.player, r = p.right();
  const e = g.combat.spawnAI({ type: 'sloop', faction: 'pirate', role: 'pirate', x: p.position.x + r.x * 300, z: p.position.z + r.z * 300, heading: p.heading, sailSetting: 0, name: 'Le Requin' });
  e.controller = { update() {} }; e.speed = 0; e.hull = e.hullMax * 0.2; e.crew = Math.round(e.crewMax * 0.2);
});
await sim(0.5);
await adv(0.5);
await ev(() => { const h = window.__game.hud.hints; if (h.current?.key !== 'board') h.dismiss(); });
await adv(2);
s = await hs();
const lay2 = await ev(() => {
  const r = q => document.querySelector(q)?.getBoundingClientRect();
  const c = r('.hint-card'), tgt = r('.target'), bp = r('.prompt.board');
  const ov = (a, b) => a && b && a.width && b.width && !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
  return { tgt: ov(c, tgt), bp: ov(c, bp), board: !!window.__game.combat.boardHint, tOff: document.querySelector('.target').className };
});
check('fight: « À l’abordage » first (priority), clear of the target card and the boarding prompt', s.cur === 'board' && !lay2.tgt && !lay2.bp, `${s.cur} board=${lay2.board} ${lay2.tOff}`);
await shot('06-conseil-combat');

// ================================================================ old save without `tutorials`
await ev(() => {
  const g = window.__game; g.ports.save?.();
  const d = JSON.parse(localStorage.getItem('tof.save.v1'));
  delete d.state.tutorials; d.state.rank = { english: 2, spanish: 0, french: 0, dutch: 0 }; d.state.captures = 6;
  localStorage.setItem('tof.save.v1', JSON.stringify(d));
});
await boot();
await ev(() => document.querySelector('.menu-layer [data-act="continue"]').click());
await sim(0.5);
await adv(10);
s = await hs();
check('old save (veteran) loads: tutorials created, no goals, basics pre-marked', s.goal === null && !s.goalOn && s.seen.sail && s.seen.port && !s.seen.fleet && s.cur !== 'sail', JSON.stringify(s.seen));
await ev(() => { const g = window.__game; g.ports.save?.(); const d = JSON.parse(localStorage.getItem('tof.save.v1')); delete d.state.tutorials; d.state.rank = {}; d.state.captures = 0; d.state.voyages = 0; localStorage.setItem('tof.save.v1', JSON.stringify(d)); });
await boot();
await ev(() => document.querySelector('.menu-layer [data-act="continue"]').click());
// no traffic: a weakened pirate passing within 450 m would bring out the « abordage » hint (prio 5) first
await ev(() => { const g = window.__game; g.combat.setTrafficTarget(0); for (const x of [...g.ships]) if (x !== g.player) g.combat._despawn(x); });
await sim(0.5);
await adv(10);
s = await hs();
// character creation: the start is bow seaward, so the saved ship is no longer necessarily in the roads; the cargo
// of the transport mission then brings the « Cale » hint first
check('old save (fresh career): no goals, hints start from scratch', s.goal === null && !s.goalOn && ['port', 'sail', 'hold'].includes(s.cur) && !s.seen.fleet, `${s.cur} ${JSON.stringify(s.seen)}`);

// ================================================================ playable prologue told by the first mate
await boot();
await ev(() => { const m = window.__game.hud.menu; m._go('captain'); m._start(); });
await wait(1600);
await calm();
await sim(0.3);
await adv(0.5);
await ev(() => document.querySelector('.mate-guide [data-pro="start"]').click());
await adv(0.5);
s = await hs();
check('prologue: « Begin » → order 1 of 4 (sails and helm) told by the mate, no goal line, skip link', s.goal?.step === 'p-sail' && s.mate && s.mateStep === 'p-sail' && !s.goalOn
  && /Order 1 of 4/.test(s.mateText) && /KeyW/.test(s.mateKeys) && /KeyA/.test(s.mateKeys) && await ev(() => !!document.querySelector('.mate-guide .mg-skip')), s.mateText.slice(0, 90));
// 12 s at sea: the wind hint (prio 0) is queued but waits for the mate; the harbour hint too
await sim(1); await adv(12);
s = await hs();
check('prologue: no ordinary hint slips in while the mate speaks', s.vis === 0 && s.cur === null && s.queue.length > 0, `queue ${s.queue}`);
// an urgent hint (storm) still shows, stacked above the mate's panel
await ev(() => window.__game.hud.hints.trigger('storm'));
await adv(2.2);
s = await hs();
check('prologue: an urgent hint shows above the mate’s panel (no overlap)', s.cur === 'storm' && s.rect && s.mateRect && s.rect.bottom <= s.mateRect.top + 1, `${s.cur} ${s.rect && Math.round(s.rect.bottom)} / ${s.mateRect && Math.round(s.mateRect.top)}`);
await ev(() => window.__game.hud.hints.dismiss());
await adv(2);
await shot('07-prologue-voiles');
await tap('KeyW'); await tap('KeyW');
await adv(0.6);
s = await hs();
check('order 1: full sail alone is not enough (one of two ticked)', s.goal?.step === 'p-sail' && s.goal.sailed && s.todoOk === 1, `${s.goal?.step} ok ${s.todoOk}`);
await ev(() => document.body.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD', key: 'd', bubbles: true })));
await sim(6);
await ev(() => document.body.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyD', key: 'd', bubbles: true })));
await adv(0.6);
s = await hs();
const turnedByHelm = s.goal?.step === 'p-cam';
if (!turnedByHelm) await ev(() => { const g = window.__game; for (let i = 0; i < 12; i++) { g.player.heading += 0.15; g.hud.hints.advance(0.25); } });
s = await hs();
const tg = await ev(() => {
  const g = window.__game, t = g.hud.hints.prologue.target, p = g.player; if (!t) return null;
  return { name: t.name, dist: Math.hypot(t.position.x - p.position.x, t.position.z - p.position.z), depth: g.islands.getTerrainHeight(t.position.x, t.position.z), hostile: p.controller.isEnemy(t), hull: t.hull / t.hullMax };
});
check('order 1 done by sail + helm → order 2 (view), pirate target anchored in deep water', s.goal?.step === 'p-cam' && /Order 2 of 4/.test(s.mateText) && /Cormorant/.test(s.mateText)
  && tg && tg.depth < -7 && tg.hostile && tg.dist > 300 && tg.dist < 1300, `${turnedByHelm ? 'helm' : 'forced'} ${JSON.stringify(tg)}`);
const notes = await ev(() => window.__game.__notes.filter(t => /Sail ho|Prologue/.test(t)).length);
check('the sighting is told by the mate, not by a message', notes === 0, `${notes} notes`);
// other ships leave the prologue's target alone (a patrol and a pirate nearby)
const ign = await ev(() => {
  const g = window.__game, t = g.hud.hints.prologue.target;
  const a = g.combat.spawnAI({ type: 'sloop', faction: 'pirate', role: 'pirate', x: t.position.x + 300, z: t.position.z, heading: 0, name: 'Test Rover' });
  const b = g.combat.spawnAI({ type: 'sloop', faction: 'spanish', role: 'patrol', x: t.position.x - 300, z: t.position.z, heading: 0, name: 'Test Guarda' });
  const r = { pirate: g.combat.isHostile(a, t), spanish: g.combat.isHostile(b, t), player: g.combat.isHostile(g.player, t) };
  g.removeShip(a); g.removeShip(b); return r;
});
check('prologue target: ignored by other ships, still the player’s enemy', !ign.pirate && !ign.spanish && ign.player, JSON.stringify(ign));
await shot('08-prologue-vue');
await tap('KeyC');
await adv(0.6);
s = await hs();
check('order 2: C → order 3 (broadside), its keys shown now, « Broadsides » hint marked (never queued behind)', s.goal?.step === 'p-fire' && /Order 3 of 4/.test(s.mateText) && /KeyQ/.test(s.mateKeys) && /KeyE/.test(s.mateKeys)
  && s.seen.guns && s.seen.camera && !s.queue.includes('guns') && !s.queue.includes('camera'), `${s.goal?.step} ${s.mateKeys}`);
await shot('09-prologue-cible');
// bring the target abeam at 230 m and fire a real broadside
const fired = await ev(() => {
  const g = window.__game, p = g.player, t = g.hud.hints.prologue.target, r = p.right();
  p.speed = 0; p.sailSetting = 0; p.controller.sailStep = 0;
  const tx = p.position.x + r.x * 230, tz = p.position.z + r.z * 230;
  if (t.teleport) t.teleport(tx, tz, p.heading); else { t.position.x = tx; t.position.z = tz; }
  t.speed = 0;
  p.reload.port = p.reload.starboard = 1;
  g.__hits = 0; g.events.on('cannon:hit', d => { if (d.target === t) g.__hits++; });
  const side = p.controller.sideFacing(t);
  g.combat.fireBroadside(p, side, 'round');
  return side;
});
await sim(4);
await adv(0.3);
s = await hs();
const realHit = await ev(() => window.__game.__hits);
if (s.goal?.step !== 'p-strike') await ev(() => { const g = window.__game; g.events.emit('cannon:hit', { attacker: g.player, target: g.hud.hints.prologue.target, damage: 1, part: 'hull' }); });
await adv(0.3);
s = await hs();
check('order 3: a broadside on target → « keep firing » (pleased face)', fired && s.goal?.step === 'p-strike' && s.mateMood === 'pleased' && s.todoOk === 1, `${fired}: ${realHit} real hits`);
await ev(() => { const t = window.__game.hud.hints.prologue.target; t.hull = t.hullMax * 0.3; });
await adv(0.6);
await sim(0.3);
await adv(0.3);
s = await hs();
const pend = await ev(() => { const g = window.__game, t = g.hud.hints.prologue.target; return { struck: !!t?.struck, board: g.combat.boardHint?.ship === t }; });
check('she strikes → order 4 (board with B), « Board her! » hint marked', pend.struck && s.goal?.step === 'p-board' && /Order 4 of 4/.test(s.mateText) && /\bB\b/.test(s.mateKeys) && s.seen.board, s.mateText.slice(0, 80));
check('the struck prize can be boarded (B)', pend.board);
await shot('10-prologue-abordage');
// boarding is the player's (B): its outcome ends the prologue
await ev(() => { const g = window.__game; g.events.emit('boarding:end', { enemy: g.hud.hints.prologue.target, result: 'captured' }); });
await adv(0.5);
s = await hs();
check('boarded → prologue over: farewell from the mate (port named), goal line held back', s.goal?.step === 'visit' && s.mateStep === 'bye' && /first prize/.test(s.mateText) && !s.goalOn && s.vis === 0, s.mateText.slice(0, 100));
await shot('11-prologue-fin');
await adv(10);
s = await hs();
check('then the goal line takes over and the waiting hints resume', !s.mate && s.goalOn && /governor/.test(s.goalText) && s.cur && !['guns', 'camera', 'board'].includes(s.cur), `${s.goalText} · hint ${s.cur}`);

// Skip mid-way, target sunk, target vanished: never a dead end
const restart = async () => {
  await ev(() => { const g = window.__game, h = g.hud.hints; if (h.prologue.target) { g.removeShip(h.prologue.target); h.prologue.target = null; } g.events.emit('game:new', {}); });
  await adv(0.3);
  await ev(() => document.querySelector('.mate-guide [data-pro="start"]').click());
  await adv(0.3);
};
const toFire = () => ev(() => { const g = window.__game, h = g.hud.hints, o = h.goal(); o.sailed = true; o.turned = 9; h.advance(0.3); h.goal().looked = true; h.advance(0.3); return h.goal().step; });
await restart();
await ev(() => document.querySelector('.mate-guide .mg-skip').click());
await adv(0.3);
s = await hs();
check('« Skip the prologue » mid-way: ordinary goals, the mate leaves at once', s.goal?.step === 'visit' && !s.mate && s.goalOn, s.goalText);
await restart();
const st1 = await toFire();
await ev(() => { const g = window.__game; g.combat.startSinking(g.hud.hints.prologue.target); });
await adv(0.5);
s = await hs();
check('target sinks during order 3 → prologue ends (worried farewell), not stuck', st1 === 'p-fire' && s.goal?.step === 'visit' && s.mateStep === 'bye' && s.mateMood === 'worried', `${st1} → ${s.goal?.step} ${s.mateText.slice(0, 60)}`);
await adv(10);
await restart();
const st2 = await toFire();
await ev(() => { const g = window.__game; g.combat._despawn(g.hud.hints.prologue.target); });
await adv(0.6);
s = await hs();
check('target despawned far away during order 3 → prologue ends, not stuck', st2 === 'p-fire' && s.goal?.step === 'visit' && s.mateStep === 'bye', `${st2} → ${s.goal?.step}`);

await browser.close();
if (warnings.length) console.log(`(${warnings.length} console warnings, first: ${warnings[0]})`);
check('zero console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
const bad = results.filter(r => !r.ok);
console.log(`\n${results.length - bad.length}/${results.length} PASS`);
process.exit(bad.length ? 1 : 0);
