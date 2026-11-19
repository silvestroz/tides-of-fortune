// First-duel briefing: node tools/test-duel-brief.mjs [--shots dir]
// The first live duel (no state.tutorials.duel) shows the weapon choice, then a briefing card; the fight is held
// (sim time frozen, no enemy wind-up) until Enter / J; then the opponent holds his first cut for ~2.5 s.
// A second duel (tutorial seen) goes straight into the fight.
import fs from 'node:fs';
import { chromium } from 'playwright';
import { BASE, launchOpts } from './_env.mjs';

const arg = k => process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : null;
const SHOTS = arg('--shots');
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const browser = await chromium.launch(launchOpts());
const page = await (await browser.newContext({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1 })).newPage();
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('[pageerror] ' + e.message));
let fails = 0;
const check = (name, ok, info = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); };
const ev = (fn, a) => page.evaluate(fn, a);
const KEYS = { KeyJ: 'j', Enter: 'Enter' };
const tap = async code => {
  await ev(([code, key]) => document.body.dispatchEvent(new KeyboardEvent('keydown', { code, key, bubbles: true })), [code, KEYS[code] || code]);
  await ev(() => { const g = window.__game; g.step(1 / 30); g.input.endFrame(); });
  await ev(([code, key]) => document.body.dispatchEvent(new KeyboardEvent('keyup', { code, key, bubbles: true })), [code, KEYS[code] || code]);
};
const sim = secs => ev(secs => { const g = window.__game; for (let i = 0; i < Math.round(secs * 30); i++) { g.step(1 / 30 * g.timeScale); g.input.endFrame(); } }, secs);
const st = () => ev(() => { const d = window.__game.duel; return { t: d.sim?.time || 0, brief: !!d._briefing, briefOn: d._briefEl?.classList.contains('on'), arming: !!d._arming,
  ai: d.sim?.aiEnabled, eState: d.sim?.enemy.state, tut: d._tut?.step ?? null, active: d.active }; });
const shot = async n => { if (SHOTS) { await ev(() => { for (const m of document.querySelectorAll('.menu-layer')) m.style.display = 'none'; window.__game.post.render(1 / 60); }); await page.screenshot({ path: `${SHOTS}/${n}.png` }); } };

await page.goto(`${BASE}?quality=low`, { waitUntil: 'load', timeout: 240000 });
await page.waitForFunction(() => window.__ready || window.__error, null, { timeout: 300000, polling: 250 });
await ev(() => { const g = window.__game; g.renderer.setAnimationLoop(null); if (g.state) (g.state.tutorials ||= {}).duel = false; });

const start = () => ev(() => { const g = window.__game, p = g.player;
  const e = g.combat.spawnAI({ type: 'sloop', faction: 'pirate', role: 'patrol', x: p.position.x + 30, z: p.position.z + 2, heading: 0, sailSetting: 0, name: 'Test', crew: 30 });
  e.ai.hold = true; e.ai.fireAtWill = false; window.__foe = e;
  g.duel.start({ opponent: { name: 'Calico', faction: 'pirate', difficulty: 0.12 }, setting: e, crewPlayer: 60, crewEnemy: 30, seed: 3 }); });

await start();
await sim(1);
let s = await st();
check('first duel: weapon choice first', s.arming && !s.brief, JSON.stringify(s));
await tap('Enter');
s = await st();
check('briefing card after the weapon choice', s.brief && s.briefOn, JSON.stringify(s));
await shot('brief');
await tap('KeyJ');   // pressed too soon after the choice (< 0.6 s): ignored
s = await st();
check('a key right after the choice does not skip the card', s.brief, JSON.stringify(s));
await sim(6);
s = await st();
check('fight held behind the card (sim time 0, enemy idle)', s.brief && s.t === 0 && s.eState !== 'windup', JSON.stringify(s));
await tap('Enter');
s = await st();
check('Enter closes the card, hints start, AI in grace', !s.brief && !s.briefOn && s.tut === 0 && s.ai === false, JSON.stringify(s));
await shot('fight');
await sim(1.5);
s = await st();
check('no enemy cut during the grace', s.ai === false && s.eState !== 'windup' && s.eState !== 'strike', JSON.stringify(s));
await sim(2);
s = await st();
check('AI back after the grace', s.ai === true, JSON.stringify(s));

// second duel: tutorial seen → no card
await ev(() => { const g = window.__game; g.duel.abort(); window.__toSail?.(); if (g.state) g.state.tutorials.duel = true; });
await sim(0.5);
await start();
await sim(0.5);
await tap('Enter');
s = await st();
check('second duel: no briefing, AI live', s.active && !s.brief && s.ai === true, JSON.stringify(s));
await ev(() => window.__game.duel.abort());

check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
console.log(fails ? `${fails} FAIL` : 'ALL PASS');
process.exit(fails ? 1 : 0);
