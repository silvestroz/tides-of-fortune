// Test of the "world and career" batch: colours of a conquered town, envoy mission (peace / alliance), lands,
// mutiny (duel or give in), married life, variety of rumours.
// Usage: node tools/test-monde.mjs [--shots <folder>]   (dev server required, TOF_URL, else http://127.0.0.1:5173)
import { chromium } from 'playwright';
import { BASE, launchOpts } from './_env.mjs';
import fs from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => {
  if (v.startsWith('--')) a.push([v.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : '1']);
  return a;
}, []));
const SHOTS = args.shots || null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
// 0. pure logic of the mutiny (node, no browser)
const { mutinyOutcome, duelDifficulty, ringleader } = await import('../src/data/mutiny.js');
const _y = mutinyOutcome('yield', { gold: 1000, crew: 80 }), _w = mutinyOutcome('duel', { gold: 1000, crew: 80 }, true), _l = mutinyOutcome('duel', { gold: 1000, crew: 80 }, false);
const _d = [0, 8].map(m => duelDifficulty(m, () => 0.5));
const okNode = _y.gold === 400 && _y.men === 24 && _w.gold === 0 && _w.men === 3 && _l.gold === 600 && _l.men === 36 && _l.wounds === 1 && _d[0] > _d[1] && !!ringleader(7).name;
const nodeMsg = (`mutinerie (node) : céder −${_y.gold}/−${_y.men}, duel perdu −${_l.gold}/−${_l.men}, gagné −${_w.men} meneurs ; meneur ${_d[1].toFixed(2)}–${_d[0].toFixed(2)}`);

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
ok(okNode, nodeMsg);
const tick = (n = 3) => page.evaluate(n => { const g = window.__game; for (let i = 0; i < n; i++) g.step(1 / 30); if (g.renderOverride) g.renderOverride(1 / 30); else g.post.render(1 / 30); }, n);
const shot = async name => { if (!SHOTS) return; await tick(2); await page.screenshot({ path: `${SHOTS}/${name}.png`, timeout: 0 }); console.log('  capture ' + name); };
await page.evaluate(s => { window.__game.renderer.setAnimationLoop(null); window.__shots = s; }, !!SHOTS);
await page.evaluate(() => { const g = window.__game; g.hud.menu.close(); g.mode = 'sail'; g.frozen = false; g.combat.setTrafficTarget(0);
  for (const s of [...g.ships]) if (s !== g.player) g.combat._despawn(s); });
await tick(3);

// 1. conquered town: the port's flags (fort, square, anchorage) switch to the new nation, and switch back on
//    loading a game where the town wasn't taken
const r1 = await page.evaluate(() => {
  const g = window.__game, lv = g.living, T = g.islands.towns;
  const port = g.islands.ports.find(p => !p.haven && p.faction === 'spanish');
  const a = T.flagMesh.geometry.getAttribute('aFlag');
  const fl = T.flagData.filter(f => f.port === port.id);
  const read = () => fl.map(f => a.array[f.v0] + '/' + a.array[f.v0 + f.vn - 1]).join(',');
  const before = read();
  lv.assaulted(port, { won: true, newFaction: 'english' });
  const after = read(), fac = port.faction, gov = g.ports.attitude(port).cls;
  delete g.state.towns[port.id].faction; lv.ensure();
  const reverted = read(), fac2 = port.faction;
  g.state.towns[port.id].faction = 'english'; lv.ensure();
  const again = read();
  g.state.towns[port.id].faction = 'spanish'; lv.ensure(); delete g.state.towns[port.id].faction;
  return { name: port.name, n: fl.length, before, after, fac, reverted, fac2, again, gov };
});
ok(r1.n >= 2 && /^(1\/1,?)+$/.test(r1.before) && /^(0\/0,?)+$/.test(r1.after) && r1.fac === 'english', `${r1.name} conquise : ${r1.n} drapeaux ${r1.before} → ${r1.after}`);
ok(/^(1\/1,?)+$/.test(r1.reverted) && r1.fac2 === 'spanish' && /^(0\/0,?)+$/.test(r1.again), `chargement : nation d'origine rendue (${r1.fac2}), conquête réappliquée`);

// 2. envoy mission: peace carried to a Spanish port; peace only exists on delivery
await page.evaluate(() => {
  const g = window.__game, s = g.state, lv = g.living;
  g.player.faction = 'english'; s.missions = [];
  lv._setRelation('english', 'spanish', -1); s.diplomacy.since['english|spanish'] -= 3;
  s.reputation.english = 40; s.reputation.spanish = 10;
  if (window.__shots) { const port = g.islands.ports.find(p => !p.haven && p.faction === 'english'); g.ports.enter(port); g.ports.goto('governor', true);
    const b = g.ports.screen.frame.querySelector('.pcol-body'), c = [...b.querySelectorAll('.card')].find(x => /Affairs of state/.test(x.textContent)); if (c) b.scrollTop = c.offsetTop - 20; }
});
await shot('envoy-offer');
const r2 = await page.evaluate(() => {
  const g = window.__game, s = g.state, lv = g.living;
  if (g.ports.isOpen) g.ports.leave();
  const port = g.islands.ports.find(p => !p.haven && p.faction === 'english');
  const offers = lv.governorOffers(port);
  const o = offers.find(x => x.kind === 'peace');
  const gold = s.gold, merit = s.merit.english;
  const acc = lv.acceptOffer(port, o?.key);
  const again = lv.governorOffers(port).some(x => x.key === o?.key);
  const pending = s.diplomacy.rel['english|spanish'];
  const m = s.missions.find(x => x.kind === 'envoy' && x.status === 'active');
  const wrong = g.islands.ports.find(p => !p.haven && p.faction === 'french');
  g.career._onPort(wrong);
  const still = m.status;
  const to = g.islands.ports.find(p => p.id === m.to);
  g.career._onPort(to);
  return { o: o && { to: o.toName, days: o.days, text: o.text }, acc, again, pending, still, st: m.status, rel: s.diplomacy.rel['english|spanish'], paid: s.gold - gold, merit: s.merit.english - merit, deadline: m.deadline, title: m.title };
});
console.log(`  offre : ${r2.o?.text}`);
ok(r2.acc && !r2.again && r2.pending === -1 && r2.still === 'active', `paix acceptée (« ${r2.title} », ${r2.o?.days} jours) : toujours en guerre avant la remise, offre retirée`);
ok(r2.st === 'done' && r2.rel === 0 && r2.paid > 0 && r2.merit >= 3, `lettre remise à ${r2.o?.to} : paix, ${r2.paid} pièces, mérite +${r2.merit}`);

// 3. alliance: failure when the deadline passes (nothing is signed), then failure if the destination port is hostile
const r3 = await page.evaluate(() => {
  const g = window.__game, s = g.state, lv = g.living;
  s.missions = []; s.rank.english = 3;
  lv._roll0 = lv._rollDiplomacy; lv._rollDiplomacy = () => {};   // no diplomacy draw during the test
  lv._setRelation('english', 'french', 0); s.diplomacy.since['english|french'] -= 30;
  s.reputation.english = 50; s.reputation.french = 30;
  const port = g.islands.ports.find(p => !p.haven && p.faction === 'english');
  const o = lv.governorOffers(port).find(x => x.kind === 'ally');
  if (!o) return { none: true };
  lv.acceptOffer(port, o.key);
  const m = s.missions.find(x => x.kind === 'envoy');
  const rep0 = s.reputation.english;
  g.career.advanceDays(o.days + 1, false);
  const late = { st: m.status, rel: s.diplomacy.rel['english|french'], rep: s.reputation.english - rep0 };
  // second try: arrival in a French port while they want to hang you
  lv._setRelation('english', 'french', 0); s.diplomacy.since['english|french'] -= 30; s.reputation.french = 30; s.reputation.english = 50;
  const o2 = lv.governorOffers(port).find(x => x.kind === 'ally');
  if (!o2) return { late, dbg: JSON.stringify({ rep: s.reputation, rank: s.rank.english, rel: s.diplomacy.rel, offers: lv.governorOffers(port) }) };
  lv.acceptOffer(port, o2.key);
  const m2 = s.missions.find(x => x.kind === 'envoy' && x.status === 'active');
  s.reputation.french = -60;
  g.career._onPort(g.islands.ports.find(p => p.id === m2.to));
  const hostile = { st: m2.status, rel: s.diplomacy.rel['english|french'] };
  // third: war breaks out in the meantime → mission void
  s.reputation.french = 30; s.reputation.english = 50; lv._setRelation('english', 'french', 0); s.diplomacy.since['english|french'] -= 30;
  const o3 = lv.governorOffers(port).find(x => x.kind === 'ally');
  lv.acceptOffer(port, o3.key);
  const m3 = s.missions.find(x => x.kind === 'envoy' && x.status === 'active');
  lv._setRelation('english', 'french', -1);
  lv._setRelation('english', 'french', 0);
  lv._rollDiplomacy = lv._roll0;
  return { late, hostile, voidSt: m3.status };
});
ok(!r3.none && r3.late.st === 'failed' && r3.late.rel === 0 && r3.late.rep < 0, `alliance hors délai : ${r3.late?.st}, rien de signé, réputation ${r3.late?.rep}`);
ok(r3.hostile?.st === 'failed' && r3.hostile.rel === 0, `arrivée dans un port hostile : ${r3.hostile?.st}, pas d'alliance`);
ok(r3.voidSt === 'void', `guerre déclarée pendant le voyage : mission ${r3.voidSt}`); if (r3.dbg) console.log(r3.dbg);
await page.evaluate(() => { const g = window.__game; g.state.missions = []; });

// 4. lands: grant on promotion (Captain), visible at the governor's, counted in the score
const r4 = await page.evaluate(() => {
  const g = window.__game, s = g.state;
  s.lands = []; s.rank.english = 2; s.merit.english = 9; s.reputation.english = 40;
  const port = g.islands.ports.find(p => !p.haven && p.faction === 'english');
  g.ports.enter(port); g.ports.goto('governor', true);
  const t0 = g.ports.screen.frame.textContent;
  const title = g.career.promote('english');
  g.ports.screen.render();
  const n = t => t.replace(/\s+/g, ' ');
  const t1 = n(g.ports.screen.frame.textContent), land = s.lands[0];
  return { title, land, nextBefore: /At the rank of Captain ?\+50 acres/.test(n(t0)), shown: /Lands granted ?50 acres/.test(t1), next: /At the rank of Major ?\+100 acres/.test(t1), score: /Of which your lands ?50 acres/.test(t1), acres: g.career.acres() };
});
ok(r4.title === 'Captain' && r4.land?.acres === 50 && !!r4.land?.portName && r4.acres === 50, `promotion Capitaine : ${r4.land?.acres} arpents près de ${r4.land?.portName}`);
ok(r4.nextBefore && r4.shown && r4.next && r4.score, `gouverneur : concession à venir, terres, grade suivant (+100) et part du score affichés`);
await shot('governor-lands');
await page.evaluate(() => { const g = window.__game; g.ports.leave(); g.mode = 'sail'; g.frozen = false; });
await tick(2);

// 5. mutiny: choice screen (world frozen, Escape neutralised); give in = the old loss; duel won / lost
const r5 = await page.evaluate(() => {
  const g = window.__game, s = g.state, p = g.player;
  p.crew = 80; s.crew = 80; s.gold = 1000; s.plunder = 400; s.morale = 5; s.wounds = 0;
  g.career.mutiny();
  const el = document.querySelector('.mu-screen');
  return { open: el?.classList.contains('on'), frozen: g.frozen, mode: g.mode, text: (el?.textContent || '').replace(/\s+/g, ' ').trim() };
});
await shot('mutiny');
Object.assign(r5, await page.evaluate(() => {
  const g = window.__game, s = g.state, p = g.player, el = document.querySelector('.mu-screen');
  document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape', bubbles: true }));
  const pause = !!g.hud?.menu?.isOpen;
  el.querySelector('[data-act="yield"]').click();
  return { pause, gold: s.gold, crew: p.crew, morale: s.morale, after: { frozen: g.frozen, mode: g.mode, on: el.classList.contains('on'), pending: s.mutinyPending } };
}));
ok(r5.open && r5.frozen && r5.mode === 'map' && !r5.pause, `mutinerie : écran ouvert, monde gelé, Échap sans effet (« ${r5.text.slice(0, 140)}… »)`);
ok(r5.gold === 600 && r5.crew === 56 && r5.morale === 45 && !r5.after.on && r5.after.mode === 'sail' && !r5.after.frozen && !r5.after.pending, `céder : or ${r5.gold}, hommes ${r5.crew}, moral ${r5.morale}`);
const r5b = await page.evaluate(async () => {
  const g = window.__game, s = g.state, p = g.player;
  const out = {};
  for (const win of [true, false]) {
    p.crew = 80; s.crew = 80; s.gold = 1000; s.plunder = 0; s.morale = 5; s.wounds = 0;
    g.career.mutiny();
    document.querySelector('.mu-screen [data-act="duel"]').click();
    const duel = g.duel.active && g.mode === 'duel', onDeck = g.duel.ship === p;
    for (let i = 0; i < 20; i++) g.step(1 / 30);
    g.duel._teardown(); g.duel._finish({ winner: win ? 'player' : 'enemy', reason: 'wounds' });
    out[win ? 'won' : 'lost'] = { duel, onDeck, gold: s.gold, crew: p.crew, morale: s.morale, wounds: s.wounds, mode: g.mode, ctl: !!p.controller };
  }
  return out;
});
ok(r5b.won.duel && r5b.won.onDeck && r5b.won.gold === 1000 && r5b.won.crew === 77 && r5b.won.morale === 58 && r5b.won.mode === 'sail' && r5b.won.ctl, `duel gagné sur son pont : or intact, ${80 - r5b.won.crew} meneurs aux fers, moral ${r5b.won.morale}, barre rendue`);
ok(r5b.lost.gold === 400 && r5b.lost.crew === 44 && r5b.lost.morale === 35 && r5b.lost.wounds === 1, `duel perdu : or ${r5b.lost.gold}, hommes ${r5b.lost.crew}, moral ${r5b.lost.morale}, blessures ${r5b.lost.wounds}`);
// in port: the mutiny waits for the return to sea
const r5c = await page.evaluate(() => {
  const g = window.__game, s = g.state;
  const port = g.islands.ports.find(p => !p.haven && p.faction === 'english');
  g.ports.enter(port); s.morale = 5;
  g.career.mutiny();
  const inPort = document.querySelector('.mu-screen').classList.contains('on');
  g.ports.leave(); g.career.update(0.1);
  const atSea = document.querySelector('.mu-screen').classList.contains('on');
  document.querySelector('.mu-screen [data-act="yield"]').click();
  return { inPort, atSea, pending: s.mutinyPending };
});
ok(!r5c.inPort && r5c.atSea && !r5c.pending, 'mutinerie déclarée au port : écran différé jusqu’au retour en mer');

// 6. married life: visit (morale, care), gift, letters in the log
await page.evaluate(() => {
  const g = window.__game, s = g.state, F = g.family;
  const port = g.islands.ports.find(p => !p.haven && p.faction === 'english');
  s.spouse = { id: port.id + ':0', name: 'Arabella', port: port.id, portName: port.name, faction: 'english', date: { ...s.date } };
  F.ensure();
  s.morale = 50; s.wounds = 2; s.gold = 2000; s.food = 900;
  g.ports.enter(port); g.ports.goto('governor', true);
  const card = /Your home in/.test(g.ports.screen.frame.textContent), b0 = s.spouse.bond;
  g.ports.screen.frame.querySelector('[data-act="home-visit"]').click();
  const v = { morale: s.morale, wounds: s.wounds, bond: s.spouse.bond - b0 };
  const again = g.family.act(port, 'home-visit');
  g.ports.screen.frame.querySelector('[data-act="home-gift"]').click();
  const gift = { gold: s.gold, bond: s.spouse.bond - b0 - v.bond };
  const b = g.ports.screen.frame.querySelector('.pcol-body'), c = [...b.querySelectorAll('.card')].find(x => /Your home in/.test(x.textContent)); if (c) b.scrollTop = c.offsetTop - 20;
  window.__r6a = { card, v, again, gift };
  return window.__r6a;
});
await shot('family');
const r6 = await page.evaluate(() => {
  const g = window.__game, s = g.state, F = g.family;
  const { card, v, again, gift } = window.__r6a;
  g.ports.leave();
  const letters = [];
  for (let i = 0; i < 3; i++) letters.push(F.letter({ parcel: i === 1 }));
  s.lands = []; const l2 = F.letter({ parcel: true });
  const j = g.hud?.toasts?.log?.[0]?.text || '';
  // spontaneous letters: two in ~16 days at sea
  const n0 = s.spouse.letters;
  for (let i = 0; i < 16; i++) g.career.advanceDays(1, true);
  return { card, v, again, gift, letters: letters.map(l => l.text), gold1: letters[1].gift, l2: l2.gift, j: j.slice(0, 60), spont: s.spouse.letters - n0 };
});
ok(r6.card && r6.v.morale === 58 && r6.v.wounds === 1 && r6.v.bond === 15 && !r6.again, `visite à Arabella : moral ${r6.v.morale}, blessures ${r6.v.wounds}, lien +${r6.v.bond}, une seule soirée par escale`);
ok(r6.gift.gold === 1750 && r6.gift.bond === 12, `présent : ${2000 - r6.gift.gold} pièces, lien +${r6.gift.bond}`);
ok(r6.gold1?.gold >= 60 && r6.l2?.morale > 0 && /^(A letter|A few curt lines)/.test(r6.j) && r6.spont >= 2, `lettres : colis des terres ${r6.gold1?.gold} pièces, douceurs sans terres, ${r6.spont} lettres spontanées en 16 jours`);
for (const t of r6.letters) console.log('  ' + t);

// 7. rumours: variety (distinct texts over 30 days and 6 ports)
const r7 = await page.evaluate(() => {
  const g = window.__game, s = g.state, set = new Set(), tips = new Set();
  const ports = g.islands.ports.filter(p => !p.haven).slice(0, 6);
  for (let d = 0; d < 30; d++) { for (const p of ports) { for (const r of g.ports.rumours(p)) set.add(r.text.replace(/\d+/g, '#')); for (const t of g.living.tips(p, 2)) tips.add(t.text.replace(/\d+/g, '#')); } g.career.advanceDays(1, false); }
  return { n: set.size, tips: tips.size, sample: [...set].slice(0, 6) };
});
ok(r7.n >= 25, `rumeurs : ${r7.n} textes distincts (serveuse : ${r7.tips})`);
for (const t of r7.sample) console.log('  « ' + t + ' »');

if (globalThis.__extra) await globalThis.__extra({ page, ok, tick, shot });

await tick(4);
const errs = errors.filter(e => !/favicon|404/.test(e));
ok(errs.length === 0, `console sans erreur (${errs.length})${errs.length ? ' : ' + errs.slice(0, 3).join(' | ') : ''}`);
await browser.close();
console.log(fails.length ? `\n${fails.length} échec(s)` : '\nTout est vert.');
process.exit(fails.length ? 1 : 0);
