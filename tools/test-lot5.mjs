// Living-world test: diplomacy, letters of marque, hunters, markets, convoys, tavern, towns, time.
// Usage: node tools/test-lot5.mjs [--shots <folder>]   (dev server required, http://127.0.0.1:5173)
import { chromium } from 'playwright';
import { BASE, PORT, launchOpts } from './_env.mjs';
import fs from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => {
  if (v.startsWith('--')) a.push([v.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : '1']);
  return a;
}, []));
const SHOTS = args.shots || null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
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
const tick = (n = 3) => page.evaluate(n => { const g = window.__game; for (let i = 0; i < n; i++) g.step(1 / 30); if (g.renderOverride) g.renderOverride(1 / 30); else g.post.render(1 / 30); }, n);
const shot = async name => { if (!SHOTS) return; await tick(2); await page.screenshot({ path: `${SHOTS}/${name}.png`, timeout: 0 }); console.log('  capture ' + name); };
await page.evaluate(() => window.__game.renderer.setAnimationLoop(null));
await page.evaluate(() => { const g = window.__game; g.hud.menu.close(); g.mode = 'sail'; g.frozen = false; g.combat.setTrafficTarget(3);
  for (const s of [...g.ships]) if (s !== g.player && Math.hypot(s.position.x - g.player.position.x, s.position.z - g.player.position.z) > 800) g.combat._despawn(s); });
await tick(5);

// 1. time: one day/night cycle of the sky (240 s) = 1 day, the date turns at midnight; provisions at the former pace
const r1 = await page.evaluate(() => {
  const g = window.__game, s = g.state, sky = g.sky;
  sky.autoAdvance = true; sky.setTimeOfDay(0.5); g.career.update(0.01);
  const d0 = s.date.year * 372 + s.date.month * 31 + s.date.day, f0 = s.food;
  const len = sky.dayLengthSeconds;
  for (let i = 0; i < 2400; i++) { sky.setTimeOfDay(sky.timeOfDay + 0.1 * 24 / len); g.career.update(0.1); }   // 240 s
  const d1 = s.date.year * 372 + s.date.month * 31 + s.date.day;
  return { days: d1 - d0, food: f0 - s.food, crew: g.player.crew, len };
});
ok(r1.len === 240 && r1.days === 1, `240 s de mer (cycle de ${r1.len} s) = ${r1.days} jour`);
ok(r1.food >= 1 && r1.food <= Math.ceil(r1.crew / 25 * 240 / 45) + 1, `vivres consommés en 240 s : ${r1.food} (équipage ${r1.crew})`);

// 2. diplomacy: over 6 years, relations change; ports and letters follow
const r2 = await page.evaluate(() => {
  const g = window.__game, s = g.state, lv = g.living;
  s.letters = { french: true };
  const before = JSON.stringify(s.diplomacy.rel);
  let changes = 0; g.events.on('diplomacy:change', () => changes++);
  g.career.advanceDays(6 * 365, false);
  return { changes, same: before === JSON.stringify(s.diplomacy.rel), news: s.news.length, rel: s.diplomacy.rel,
    towns: Object.values(s.towns).map(t => t.pop), notes: Object.values(s.towns).filter(t => t.note).length,
    letterOk: !s.letters.french || ['english', 'spanish', 'dutch'].some(o => g.combat ? true : false), age: s.age };
});
ok(r2.changes >= 2, `diplomatie : ${r2.changes} changements en 6 ans (${JSON.stringify(r2.rel)})`);
ok(r2.news >= 3 && r2.notes >= 1, `nouvelles : ${r2.news}, villes marquées par un événement : ${r2.notes}`);
const r2b = await page.evaluate(() => {
  const g = window.__game, s = g.state, lv = g.living;
  // force: general peace for the French -> letter void
  s.letters = { french: true };
  for (const n of ['english', 'spanish', 'dutch']) lv._setRelation('french', n, 0);
  const lost = !s.letters.french;
  lv._setRelation('french', 'dutch', -1);
  const port = g.islands.ports.find(p => p.faction === 'dutch');
  g.player.faction = 'french';
  const att = g.ports.attitude(port).cls;
  return { lost, att, rel: g.combat.isHostile ? 1 : 0 };
});
ok(r2b.lost, 'lettre de marque caduque quand la nation fait la paix avec tous');
ok(r2b.att === 'hostile' || r2b.att === 'cold', `port hollandais face au pavillon français en guerre : ${r2b.att}`);

// 3. governor: peace proposal
const r3 = await page.evaluate(() => {
  const g = window.__game, s = g.state, lv = g.living;
  g.player.faction = 'english';
  lv._setRelation('english', 'spanish', -1); s.diplomacy.since['english|spanish'] -= 200;
  s.reputation.english = 40; s.reputation.spanish = 10;
  const port = g.islands.ports.find(p => p.faction === 'english');
  const offers = lv.governorOffers(port);
  const gold = s.gold;
  const okk = offers.length && lv.acceptOffer(port, offers.find(o => o.kind === 'peace')?.key);
  // envoy mission: peace is only signed when the letter is delivered in a Spanish port
  const pending = s.diplomacy.rel['english|spanish'];
  const m = s.missions.find(x => x.kind === 'envoy' && x.status === 'active');
  const to = m && g.islands.ports.find(p => p.id === m.to);
  if (to) g.career._onPort(to);
  return { offers: offers.map(o => o.key), okk, pending, to: to?.name, rel: s.diplomacy.rel['english|spanish'], paid: s.gold - gold, st: m?.status };
});
ok(r3.okk && r3.pending === -1 && r3.st === 'done' && r3.rel === 0 && r3.paid > 0, `gouverneur anglais : ${r3.offers.join(', ')} → lettre portée à ${r3.to} → paix, ${r3.paid} pièces`);

// 4. pirate hunters tied to infamy
const r4 = await page.evaluate(() => {
  const g = window.__game, s = g.state, lv = g.living;
  s.reputation.dutch = -10;
  for (let i = 0; i < 40; i++) lv._updateHunters(2);
  const none = lv.hunters('dutch').length;
  s.reputation.dutch = -55;
  for (let i = 0; i < 20; i++) lv._updateHunters(2);
  const h = lv.hunters('dutch');
  return { none, n: h.length, role: h[0]?.ai?.role, hostile: h[0] ? g.combat.isHostile(h[0], g.player) : false, d: h[0] ? Math.hypot(h[0].position.x - g.player.position.x, h[0].position.z - g.player.position.z) : 0 };
});
ok(r4.none === 0 && r4.n === 1 && r4.role === 'hunter' && r4.hostile, `chasseur hollandais à infamie 55 : ${r4.n} (${Math.round(r4.d)} m), aucun à infamie 10`);
await tick(10);

// 5. markets: volatile haven, protectionism, smuggling
const r5 = await page.evaluate(() => {
  const g = window.__game, s = g.state, lv = g.living;
  const haven = g.islands.ports.find(p => p.haven);
  const q0 = g.ports ? (window.__q = null, 0) : 0;
  const prices = [];
  for (let w = 0; w < 4; w++) { prices.push(g.ports && haven ? Math.round(1000 * (window.__game.state.date.day, 1)) : 0); }
  const swing = []; const d0 = { ...s.date };
  for (let w = 0; w < 4; w++) { g.career.advanceDays(7, false); swing.push(lv.game.ports ? lv.game.living && lv.game.ports.wealth(haven) : 0); }
  // protectionism: big Spanish port, English flag at war
  lv._setRelation('english', 'spanish', -1);
  s.reputation.spanish = 10;
  const rich = g.islands.ports.filter(p => p.faction === 'spanish').sort((a, b) => lv.wealth(b) - lv.wealth(a))[0];
  const lockR = g.ports.locked(rich, 'market');
  // smuggling: small poor port, closed
  const poor = g.islands.ports.filter(p => !p.haven).sort((a, b) => lv.wealth(a) - lv.wealth(b))[0];
  s.reputation[poor.faction] = -60;
  s.cargo = { sugar: 10 };
  const here = lv.contrabandHere(poor), g0 = s.gold, n = lv.smuggle(poor, 'sugar');
  s.reputation[poor.faction] = 0;
  return { rich: rich.name, w: lv.wealth(rich), lockR, poor: poor.name, pw: lv.wealth(poor), here, n, got: s.gold - g0 };
});
ok(!!r5.lockR, `protectionnisme : ${r5.rich} (richesse ${r5.w}) ferme son marché : « ${r5.lockR} »`);
ok(r5.here && r5.n === 10 && r5.got > 0, `contrebande à ${r5.poor} (richesse ${r5.pw}) : ${r5.n} lots, ${r5.got} pièces`);
const r5b = await page.evaluate(async () => {
  const g = window.__game, haven = g.islands.ports.find(p => p.haven);
  const { havenSwing } = await import('/src/game/economy.js');
  const out = [];
  for (let w = 0; w < 5; w++) { out.push(havenSwing(g, haven, 'rum')); g.career.advanceDays(7, false); }
  return out;
});
ok(Math.max(...r5b) - Math.min(...r5b) > 0.1, `prix du rhum au repaire sur 5 semaines : ${r5b.map(x => x.toFixed(2)).join(' / ')}`);

// 6. announced convoys: rumour then real appearance on the route
const r6 = await page.evaluate(() => {
  const g = window.__game, s = g.state, lv = g.living;
  lv._planConvoys();
  const port = g.islands.ports.find(p => !p.haven);
  const rum = lv.rumours(port);
  const c = s.convoys.find(x => x.known && x.status === 'planned');
  if (!c) return { rum: rum.map(r => r.text) };
  // the day of departure + 30 % of the route; the player 1.5 km from the convoy's position
  while (lv.today < c.depart + Math.ceil((c.arrive - c.depart) * 0.3)) g.career.advanceDays(1, false);
  const pos = lv.convoyPos(c);
  let px = pos.x + 1500, pz = pos.z;
  for (let a = 0; a < 16 && g.islands.isLand(px, pz, 60); a++) { px = pos.x + Math.cos(a) * 1500; pz = pos.z + Math.sin(a) * 1500; }
  g.player.teleport ? g.player.teleport(px, pz, 0) : (g.player.position.x = px, g.player.position.z = pz);
  lv._updateConvoys();
  const sh = lv.convoyShips.get(c.id);
  // distance to the route segment: near land the spawn steps along the route to open water (living._updateConvoys)
  const seg = sh ? (() => { const ax = pos.a.x, az = pos.a.z, bx = pos.b.x - ax, bz = pos.b.z - az, L2 = bx * bx + bz * bz || 1;
    const t = Math.max(0, Math.min(1, ((sh.position.x - ax) * bx + (sh.position.z - az) * bz) / L2));
    return Math.hypot(sh.position.x - (ax + bx * t), sh.position.z - (az + bz * t)); })() : -1;
  return { rum: rum.map(r => r.text), spawned: !!sh, d: sh ? Math.hypot(sh.position.x - pos.x, sh.position.z - pos.z) : -1, seg, guards: sh?.guards?.length || 0, to: c.to, wp: sh?.ai?.waypoint?.port?.id };
});
console.log('  rumeurs : ' + r6.rum.join(' | '));
ok(r6.spawned && (r6.d < 600 || (r6.d < 1500 && r6.seg < 200)) && r6.wp === r6.to, `convoi annoncé apparu sur sa route (écart ${Math.round(r6.d)} m, ${Math.round(r6.seg)} m de la route, ${r6.guards} escortes, cap sur ${r6.to})`);
await tick(10);
const r6b = await page.evaluate(() => { const g = window.__game; const port = g.islands.nearestPort(g.player.position.x, g.player.position.z).port; return g.living.tips(port, 2).map(t => (t.none ? '∅ ' : '') + t.text); });
console.log('  serveuse : ' + r6b.join(' | '));
ok(r6b.length >= 1 && !/^∅/.test(r6b[0]), 'la serveuse signale un navire riche à proximité');

// 7. screens: port (report, market, tavern, governor), chart
const r7 = await page.evaluate(async () => {
  const g = window.__game, port = g.islands.ports.find(p => p.faction === 'english');
  g.state.reputation.english = 45; g.state.rank.english = 2;
  g.ports.enter(port);
  const out = {};
  for (const t of ['harbour', 'market', 'tavern', 'governor']) { g.ports.goto(t, true); out[t] = g.ports.screen.frame.textContent.length; }
  out.gov = /Affairs of state/.test(g.ports.screen.frame.textContent);
  g.ports.goto('tavern', true); out.tav = /barmaid/.test(g.ports.screen.frame.textContent);
  g.ports.goto('harbour', true); out.gar = /Garrison/.test(g.ports.screen.frame.textContent);
  return out;
});
ok(r7.gov && r7.tav && r7.gar, `écrans du port : gouverneur (Affaires d’État), taverne (serveuse), rapport (garnison)`);
await shot('port-tavern');
await page.evaluate(() => { const g = window.__game; g.ports.goto('governor', true); });
await shot('port-governor');
await page.evaluate(() => { const g = window.__game; g.ports.leave(); g.worldMap?.open?.(); });
await tick(3);
await shot('map');
await page.evaluate(() => window.__game.worldMap?.close?.());

// 8. save: relations restored on load
const r8 = await page.evaluate(async () => {
  const g = window.__game, { saveGame, loadGame } = await import('/src/game/save.js');
  g.living._setRelation('english', 'french', -1);
  saveGame(g, 'test');
  g.living._setRelation('english', 'french', 1);
  loadGame(g);
  const { RELATIONS } = await import('/src/combat/factions.js');
  return { rel: RELATIONS.english.french, towns: Object.keys(g.state.towns).length };
});
ok(r8.rel === -1 && r8.towns > 5, `chargement : relations restaurées (${r8.rel}), ${r8.towns} villes`);
// old save without the living-world fields
const r9 = await page.evaluate(async () => {
  const g = window.__game, { loadGame } = await import('/src/game/save.js');
  const d = JSON.parse(localStorage.getItem('tof.save.v1'));
  for (const k of ['diplomacy', 'towns', 'convoys', 'news', 'hunters', 'living', 'foodDue']) delete d.state[k];
  localStorage.setItem('tof.save.v1', JSON.stringify(d));
  loadGame(g);
  return { dip: !!g.state.diplomacy, towns: Object.keys(g.state.towns || {}).length, conv: g.state.convoys.length };
});
ok(r9.dip && r9.towns > 5 && r9.conv >= 1, `ancienne sauvegarde : champs recréés (${r9.towns} villes, ${r9.conv} convois)`);
await page.evaluate(() => localStorage.removeItem('tof.save.v1'));

ok(errors.length === 0, `console : ${errors.length} erreur(s)${errors.length ? ' — ' + errors.slice(0, 3).join(' | ') : ''}`);
await browser.close();
console.log(fails.length ? `\n${fails.length} échec(s)` : '\nTout est OK');
process.exit(fails.length ? 1 : 0);
