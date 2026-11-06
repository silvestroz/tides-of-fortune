// Test of the governor missions: node tools/test-missions.mjs [--browser]
// Pure node: draw (never a destination = port of origin, 3–4 different types), each type (acceptance, success,
// failure, deadline), old saves, chart targets. Real world (generateWorld), simulated islands.
// --browser: in addition, a run in the real game (dev server, TOF_URL): the wanted captain appears, castaways,
// scouting, delivery, governor's screen, chart, zero console errors.
import assert from 'node:assert';
import { Career, NATIONS } from '../src/game/career.js';
import { MISSIONS } from '../src/data/missions.js';
import { generateWorld, GOODS } from '../src/data/world.js';
import { RELATIONS } from '../src/combat/factions.js';

const W = generateWorld();
const DEFAULT_REL = JSON.parse(JSON.stringify(RELATIONS));
const dn = d => d.year * 372 + d.month * 31 + d.day;

function makeIslands() {
  const list = W.islands.map(i => ({ id: i.id, name: i.name, x: i.x, z: i.z, radius: i.radius, type: i.type }));
  const ports = W.ports.map(p => ({ ...p, x: p.anchor[0], z: p.anchor[1], harborPoint: { x: p.anchor[0] + p.side[0] * 230, z: p.anchor[1] + p.side[1] * 230 } }));
  const isLand = (x, z, m = 0) => W.islands.some(i => {
    if (i.type === 'atoll') { const d = Math.hypot(x - i.center[0], z - i.center[1]); return Math.abs(d - i.ringR) < i.ringW + m; }
    return (i.spine || []).some(([sx, sz, r]) => Math.hypot(x - sx, z - sz) < r + m);
  });
  return { list, ports, coves: [], isLand, getPort: id => ports.find(p => p.id === id), getIsland: id => list.find(i => i.id === id) };
}

function makeGame({ type = 'brig', crew = 60, crewMax = 120, nationality = 'english' } = {}) {
  for (const a of Object.keys(DEFAULT_REL)) Object.assign(RELATIONS[a], DEFAULT_REL[a]);
  const log = [];
  const events = { h: {}, on(e, f) { (this.h[e] ||= []).push(f); }, emit(e, p) { log.push([e, p]); for (const f of this.h[e] || []) f(p); } };
  const player = { isPlayer: true, position: { x: 0, z: 0 }, heading: 0, crew, crewMax, type, faction: nationality, name: 'Essai', alive: true };
  const state = { date: { year: 1662, month: 3, day: 1 }, gold: 1000, food: 10, cargo: {}, fleet: [], name: 'Essai', nationality, shipType: type };
  const game = { state, events, log, islands: makeIslands(), player, ships: [player], mode: 'sail',
    combat: { spawnAI(o) { const sh = { ...o, position: { x: o.x, z: o.z }, alive: true, ai: { state: 'cruise', waypoint: null }, role: o.role }; game.ships.push(sh); return sh; } },
    removeShip(sh) { const i = game.ships.indexOf(sh); if (i >= 0) game.ships.splice(i, 1); } };
  game.career = new Career(game);
  return game;
}
const port = (g, id) => g.islands.ports.find(p => p.id === id);
const notes = g => g.log.filter(([e]) => e === 'notify').map(([, p]) => p.text);
const sail = (g, n = 1) => { for (let i = 0; i < n; i++) { g.career._escT = 0; g.career.update(0.6); } };
const at = (g, x, z) => { g.player.position.x = x; g.player.position.z = z; };
// a fixed offer of a given kind: scan the days until the governor proposes one
function offerOf(g, p, kind, from = 0) {
  const d0 = { ...g.state.date };
  for (let k = from; k < from + 400; k++) {
    g.state.date = { year: d0.year, month: 1 + Math.floor(k / 28) % 12, day: 1 + k % 28 };
    const m = g.career.offerMissions(p).find(x => x.kind === kind);
    if (m) return m;
  }
  throw new Error(`no ${kind} offer at ${p.id}`);
}

let n = 0; const ok = (name, fn) => { fn(); n++; console.log('ok  ', name); };
const stats = {};   // [km, days] of the missions with a destination (test 1), summary at the end of the test

// 1. draw: never the port of origin, 3–4 different types, deterministic over the day
ok('offres : 3–4 types différents, aucune destination = port d’origine, ni à moins de 1,5 km', () => {
  const g = makeGame(), kinds = {}, sizes = {};
  let total = 0;
  for (const p of g.islands.ports.filter(q => !q.haven)) for (let k = 0; k < 120; k++) {
    g.state.date = { year: 1662 + Math.floor(k / 60), month: 1 + Math.floor(k / 5) % 12, day: 1 + (k * 7) % 28 };
    const offers = g.career.offerMissions(p);
    sizes[offers.length] = (sizes[offers.length] || 0) + 1;
    assert.ok(offers.length >= 3 && offers.length <= 4, `${p.id}: ${offers.length} offres`);
    assert.equal(new Set(offers.map(m => m.kind)).size, offers.length, `${p.id}: types en double ${offers.map(m => m.kind)}`);
    for (const m of offers) {
      total++; kinds[m.kind] = (kinds[m.kind] || 0) + 1;
      assert.notEqual(m.to, p.id, `${m.kind} ${m.title} proposé à ${p.id}`);
      if (m.to) { const t = port(g, m.to); assert.ok(Math.hypot(t.harborPoint.x - p.harborPoint.x, t.harborPoint.z - p.harborPoint.z) >= MISSIONS.minDist, `${m.title} trop près`); }
      assert.ok(!m.title.includes(p.name) || m.kind === 'hunt', `${m.title} cite ${p.name}`);
      assert.ok(m.days >= 4 && m.days <= 10, `${m.kind}: ${m.days} jours`);   // deadlines calibrated on the measured speed
      // feasible: at best ~4 km of straight line per day (brig, fair wind) + 1 day to leave and enter port
      if (m.to && (m.kind === 'deliver' || m.kind === 'transport' || m.kind === 'escort')) {
        const t = port(g, m.to), d = Math.hypot(t.harborPoint.x - p.harborPoint.x, t.harborPoint.z - p.harborPoint.z);
        assert.ok(m.days >= d / 4000 + 1, `${m.kind} ${m.title} : ${m.days} jours pour ${Math.round(d)} m`);
        (stats[m.kind] ||= []).push([Math.round(d / 100) / 10, m.days]);
      }
      assert.equal(m.deadline, dn(g.state.date) + m.days);
      assert.ok(m.reward > 0 && m.rep > 0, `${m.kind}: récompense`);
      assert.ok(!/[\u202f ][;:!?]/.test(m.text) && !/[«»]/.test(m.text), `typo : ${m.text}`);
    }
    assert.deepEqual(g.career.offerMissions(p).map(m => m.id), offers.map(m => m.id), 'tirage stable dans la journée');
  }
  for (const k of ['deliver', 'hunt', 'escort', 'transport', 'quarry', 'scout', 'rescue']) assert.ok(kinds[k] > total * 0.06, `type ${k} trop rare : ${kinds[k] || 0}/${total}`);
  console.log('      ', JSON.stringify(kinds), 'tailles', JSON.stringify(sizes));
  assert.deepEqual(g.career.offerMissions(port(g, 'nassau')), [], 'pas de gouverneur dans un repaire');
});

// 2. transport
ok('transport : chargement, refus si la cale manque de place, livraison', () => {
  const g = makeGame(), p = port(g, 'portroyal'), m = offerOf(g, p, 'transport');
  const to = port(g, m.to);
  assert.equal(to.faction, 'english'); assert.ok(GOODS[m.good] && m.qty > 0);
  // full hold: refused
  g.state.cargo = { sugar: 85 };
  assert.equal(g.career.accept(m), false); assert.match(g.career.refusal, /room/);
  assert.equal(g.state.missions.length, 0);
  g.state.cargo = {};
  const gold0 = g.state.gold, rep0 = g.state.reputation.english;
  assert.equal(g.career.accept(m), true);
  assert.equal(g.state.cargo[m.good], m.qty);
  assert.equal(g.career.offerMissions(p).some(x => x.id === m.id), false, 'offre retirée une fois acceptée');
  sail(g, 3);
  assert.equal(g.state.missions[0].status, 'active');
  g.events.emit('port:enter', { port: p }); assert.equal(g.state.missions[0].status, 'active');
  g.events.emit('port:enter', { port: to });
  assert.equal(g.state.missions[0].status, 'done');
  assert.equal(g.state.cargo[m.good] || 0, 0);
  assert.ok(g.state.gold >= m.reward && g.state.reputation.english > rep0 - 1, `or ${gold0} -> ${g.state.gold}`);
});
ok('transport : échec si vendue (vol), jetée, ou perdue ; échéance → saisie au port', () => {
  for (const cause of ['sold', 'jettison', 'lost']) {
    const g = makeGame(), p = port(g, 'portroyal'), m = offerOf(g, p, 'transport');
    g.state.cargo[m.good] = 3;   // a few of his own
    g.career.accept(m);
    const rep0 = g.state.reputation.english;
    g.state.cargo[m.good] -= 2;   // still enough: his own units
    if (cause === 'sold') g.events.emit('trade', { side: 'sell', good: m.good, qty: 2 });
    assert.equal(g.state.missions[0].status, 'active', 'ses propres unités peuvent partir');
    g.state.cargo[m.good] -= 2;
    if (cause === 'sold') g.events.emit('trade', { side: 'sell', good: m.good, qty: 2 });
    else if (cause === 'jettison') g.events.emit('hold:jettison', { lots: [] });
    else sail(g);
    assert.equal(g.state.missions[0].status, 'failed', cause);
    const d = g.state.reputation.english - rep0;
    assert.equal(d, cause === 'sold' ? MISSIONS.transport.theftRep : MISSIONS.failRep, `${cause}: réputation ${d}`);
    assert.ok(notes(g).some(t => (cause === 'sold' ? /theft/ : cause === 'jettison' ? /overboard/ : /no longer aboard/).test(t)), cause);
  }
  // goods moved to the squadron: still "aboard"
  const g = makeGame(), p = port(g, 'portroyal'), m = offerOf(g, p, 'transport');
  g.career.accept(m);
  g.state.fleet = [{ type: 'sloop', name: 'Furet', hull: 1, cargo: { [m.good]: 4 } }]; g.state.cargo[m.good] -= 4;
  sail(g);
  assert.equal(g.state.missions[0].status, 'active');
  g.events.emit('port:enter', { port: port(g, m.to) });
  assert.equal(g.state.missions[0].status, 'done'); assert.equal(g.state.fleet[0].cargo[m.good] || 0, 0);
  // the share-out doesn't sell the entrusted cargo (but the months ashore pass the deadline)
  { const k = makeGame(), q = port(k, 'portroyal'), m3 = offerOf(k, q, 'transport');
    k.career.accept(m3); k.state.cargo.rum = 5; k.career.divide(q);
    assert.equal(k.state.cargo[m3.good], m3.qty); assert.equal(k.state.cargo.rum || 0, 0);
    assert.equal(k.state.missions[0].status, 'failed'); assert.equal(k.state.missions[0].owed, true); }
  // deadline: failure, the cargo is seized at the nation's next port
  const h = makeGame(), q = port(h, 'portroyal'), m2 = offerOf(h, q, 'transport');
  h.career.accept(m2);
  h.career.advanceDays(m2.days + 1, true);
  const a = h.state.missions[0];
  assert.equal(a.status, 'failed'); assert.equal(a.owed, true);
  h.events.emit('port:enter', { port: port(h, 'stjohns') });
  assert.equal(h.state.cargo[m2.good] || 0, 0); assert.equal(a.owed, false);
});

// 3. quarry
ok('chasse nominative : apparition près du lieu, prise par le joueur, prime dans un port de la nation', () => {
  for (const sub of ['pirate', 'smuggler']) {
    const g = makeGame(), p = port(g, 'portroyal');
    let m = null;
    for (let k = 0; k < 40 && !m; k += 1) { const o = offerOf(g, p, 'quarry', k * 7); if (o.sub === sub) m = o; }
    assert.ok(m, `pas de ${sub}`);
    assert.ok(m.zone && m.captain && m.nick && m.ship && m.place && m.type);
    assert.ok(!g.islands.isLand(m.zone.x, m.zone.z, 60), 'zone en eau libre');
    g.career.accept(m);
    at(g, m.zone.x + 6000, m.zone.z); sail(g, 2);
    assert.equal(g.ships.length, 1, 'rien tant que le joueur est loin');
    at(g, m.zone.x + MISSIONS.quarry.spawnRange - 200, m.zone.z); sail(g, 2);
    const q = g.ships.find(s => s.missionId === m.id);
    assert.ok(q, 'le capitaine prend la mer'); assert.equal(q.name, m.ship); assert.equal(q.faction, 'pirate');
    assert.equal(q.role, sub === 'smuggler' ? 'merchant' : 'pirate');
    assert.ok(Math.hypot(q.position.x - m.zone.x, q.position.z - m.zone.z) <= m.zone.r, 'dans la zone');
    assert.ok(q._captain?.name.includes(m.nick));
    sail(g, 3); assert.equal(g.ships.filter(s => s.missionId === m.id).length, 1, 'un seul navire');
    if (sub === 'smuggler') { q.ai.waypoint = { x: 0, z: 0 }; sail(g); assert.ok(Math.hypot(q.ai.waypoint.x - m.zone.x, q.ai.waypoint.z - m.zone.z) <= m.zone.r, 'le contrebandier reste dans sa zone'); }
    q.lastAttacker = g.player;
    g.events.emit('ship:struck', { ship: q });
    const a = g.state.missions[0];
    assert.equal(a.ready, true);
    g.events.emit('port:enter', { port: port(g, 'bridgetown') });
    assert.equal(a.status, 'done'); assert.ok(g.state.gold >= 1000 + m.reward);
  }
  // sunk by someone else: mission void, no penalty
  const g = makeGame(), p = port(g, 'portroyal'), m = offerOf(g, p, 'quarry');
  g.career.accept(m); at(g, m.zone.x + 1000, m.zone.z); sail(g, 2);
  const q = g.ships.find(s => s.missionId === m.id), rep0 = g.state.reputation.english;
  q.lastAttacker = { isPlayer: false };
  g.events.emit('ship:sunk', { ship: q });
  assert.equal(g.state.missions[0].status, 'void'); assert.equal(g.state.reputation.english, rep0);
  // after a save (ship gone), it puts to sea again when we come back
  const h = makeGame(), m2 = offerOf(h, port(h, 'portroyal'), 'quarry');
  h.career.accept(m2); at(h, m2.zone.x, m2.zone.z + 500); sail(h);
  h.ships.splice(1); sail(h);
  assert.ok(h.ships.some(s => s.missionId === m2.id), 'réapparition');
});

// 4. scouting
ok('reconnaissance : approcher à moins de 600 m, puis rentrer au port d’origine', () => {
  const g = makeGame(), p = port(g, 'portroyal'), m = offerOf(g, p, 'scout'), t = port(g, m.to);
  assert.ok(t.haven || RELATIONS.english[t.faction] < 0, `${t.id} n'est pas ennemi`);
  g.career.accept(m);
  at(g, t.harborPoint.x + 900, t.harborPoint.z); sail(g);
  assert.ok(!g.state.missions[0].ready, 'trop loin');
  g.events.emit('port:enter', { port: p }); assert.equal(g.state.missions[0].status, 'active', 'pas de rapport sans reconnaissance');
  at(g, t.harborPoint.x + 450, t.harborPoint.z); sail(g);
  assert.ok(g.state.missions[0].ready && g.state.missions[0].report);
  g.events.emit('port:enter', { port: port(g, 'stjohns') });
  assert.equal(g.state.missions[0].status, 'active', 'rapport au port d’origine seulement');
  g.events.emit('port:enter', { port: p });
  assert.equal(g.state.missions[0].status, 'done');
  // deadline
  const h = makeGame(), m2 = offerOf(h, port(h, 'havana'), 'scout');
  h.career.accept(m2); h.career.advanceDays(m2.days + 1, true);
  assert.equal(h.state.missions[0].status, 'failed');
});

// 5. rescue
ok('sauvetage : naufragés recueillis (hommes +N), récompense au retour', () => {
  const g = makeGame({ crew: 60, crewMax: 66 }), p = port(g, 'portroyal'), m = offerOf(g, p, 'rescue');
  assert.ok(m.spot && !g.islands.isLand(m.spot.x, m.spot.z, 60) && m.men >= 6);
  g.career.accept(m);
  at(g, m.spot.x + 600, m.spot.z); sail(g); assert.ok(!g.state.missions[0].ready);
  at(g, m.spot.x + 200, m.spot.z); sail(g);
  const a = g.state.missions[0];
  assert.ok(a.ready); assert.equal(g.player.crew, 66, 'plafonné aux couchages'); assert.equal(a.joined, 6);
  g.events.emit('port:enter', { port: p });
  assert.equal(a.status, 'done');
});

// 6. escort: only one at a time; the merchant entering port alone counts
ok('escorte : une seule à la fois, arrivée du marchand au port', () => {
  const g = makeGame(), p = port(g, 'portroyal'), m = offerOf(g, p, 'escort');
  assert.equal(g.career.accept(m), true);
  const e = g.career.escortShip; assert.ok(e);
  const m2 = offerOf(g, port(g, 'bridgetown'), 'escort', 50);
  assert.equal(g.career.accept(m2), false); assert.match(g.career.refusal, /already escorting/);
  const to = port(g, m.to);
  e.position = { x: to.harborPoint.x + 100, z: to.harborPoint.z }; at(g, to.harborPoint.x + 900, to.harborPoint.z);
  sail(g);
  assert.equal(g.state.missions[0].status, 'done');
});

// 7. three missions at most; old saves; chart targets
ok('trois missions au plus, anciennes sauvegardes, cibles de carte', () => {
  const g = makeGame(), p = port(g, 'portroyal');
  const offers = g.career.offerMissions(p);
  for (const m of offers.slice(0, 3)) g.state.cargo = {}, g.career.accept(m);
  const extra = offerOf(g, port(g, 'bridgetown'), 'hunt', 90);
  assert.equal(g.career.accept(extra), false); assert.match(g.career.refusal, /3 missions/);
  // old save: missions without fromName, kind deliver / hunt / escort / envoy
  const old = makeGame();
  old.state.missions = [
    { id: 'mportroyal1_0', kind: 'deliver', nation: 'english', from: 'portroyal', status: 'active', title: 'Plis pour Bridgetown', to: 'bridgetown', toName: 'Bridgetown', days: 4, reward: 700, rep: 6, deadline: dn(old.state.date) + 3 },
    { id: 'mportroyal1_1', kind: 'hunt', target: 'pirate', nation: 'english', from: 'portroyal', status: 'active', title: 'Traquer le forban', count: 1, progress: 0, days: 5, reward: 1500, rep: 10, deadline: dn(old.state.date) + 4 },
    { id: 'envportroyal1_french', kind: 'envoy', diplo: 'peace', nation: 'english', other: 'french', to: 'fortroyal', toName: 'Fort Royal', status: 'active', title: 'Paix', deadline: dn(old.state.date) + 4 },
  ];
  // load: deadlines from before the recalibration gain MISSIONS.oldBonus days, once (not missions accepted since)
  old.events.emit('game:loaded'); old.events.emit('game:loaded');
  assert.equal(old.state.missions[0].deadline, dn(old.state.date) + 3 + (MISSIONS.oldBonus ?? 2)); assert.equal(old.state.missionDelays, 2);
  { const f = makeGame(); f.state.cargo = {}; f.career.accept(offerOf(f, port(f, 'portroyal'), 'deliver')); const d0 = f.state.missions[0].deadline; f.events.emit('game:loaded'); assert.equal(f.state.missions[0].deadline, d0); }
  sail(old, 3);
  const tg = old.career.missionTargets();
  assert.deepEqual(tg.map(t => t.kind).sort(), ['deliver', 'envoy']);
  for (const m of old.state.missions) assert.ok(old.career.missionObjective(m).length > 10, m.kind);
  old.events.emit('port:enter', { port: port(old, 'bridgetown') });
  assert.equal(old.state.missions[0].status, 'done');
  // targets of the new types
  const h = makeGame(), q = port(h, 'portroyal');
  for (const k of ['transport', 'quarry', 'scout', 'rescue']) { h.state.missions = h.state.missions.filter(x => x.status === 'active' && x.kind !== k).slice(0, 2); h.state.cargo = {}; assert.ok(h.career.accept(offerOf(h, q, k)), k); }
  const kinds = h.career.missionTargets().map(t => t.kind);
  for (const k of new Set(h.state.missions.filter(x => x.status === 'active').map(x => x.kind))) assert.ok(kinds.includes(k), `cible ${k}`);
  for (const t of h.career.missionTargets()) assert.ok(Number.isFinite(t.x) && Number.isFinite(t.z) && t.label && t.tip, JSON.stringify(t));
});

{ // deadlines by distance (reference for balancing): km → days, min–max
  const rows = Object.entries(stats).map(([k, v]) => { const by = {}; for (const [km, d] of v) { const b = Math.round(km); (by[b] ||= []).push(d); } return `${k} ` + Object.keys(by).sort((a, b) => a - b).map(b => `${b} km→${Math.min(...by[b])}${Math.min(...by[b]) !== Math.max(...by[b]) ? '–' + Math.max(...by[b]) : ''} j`).join(', '); });
  console.log('délais : ' + rows.join(' · '));
}
console.log(`\n${n} groupes OK (node)`);

if (process.argv.includes('--browser')) {
  const { chromium } = await import('playwright');
  const { BASE, launchOpts } = await import('./_env.mjs');
  const browser = await chromium.launch(launchOpts(['--disable-dev-shm-usage']));
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('[pageerror] ' + e.message));
  await page.goto(BASE + '?quality=low&dynres=0', { timeout: 180000 });
  await page.waitForFunction(() => window.__ready || window.__error, null, { timeout: 240000 });
  await page.evaluate(() => { localStorage.removeItem('tof.save.v1'); const g = window.__game; g.renderer.setAnimationLoop(null); g.hud.menu.close(); g.mode = 'sail'; g.frozen = false; g.combat.setTrafficTarget(0); for (const s of [...g.ships]) if (s !== g.player) g.combat._despawn(s); });
  const r = await page.evaluate(() => {
    const g = window.__game, c = g.career, st = g.state, P = id => g.islands.getPort(id), out = {};
    const step = n => { for (let i = 0; i < n; i++) g.step(1 / 30); };
    const offer = (pid, kind) => { const d0 = { ...st.date }; for (let k = 0; k < 300; k++) { st.date = { year: d0.year, month: 1 + Math.floor(k / 28) % 12, day: 1 + k % 28 }; const m = c.offerMissions(P(pid)).find(x => x.kind === kind); if (m) { st.date = d0; return { ...m, deadline: c._dateNum(d0) + m.days }; } } st.date = d0; return null; };
    const enter = pid => { g.events.emit('port:enter', { port: P(pid) }); const ok = g.mode === 'port'; g.ports.leave(); return ok; };
    st.missions = []; st.cargo = {};
    // quarry
    const q = offer('portroyal', 'quarry'); c.accept(q);
    g.player.teleport(q.zone.x + 1800, q.zone.z, 0); step(40);
    const qs = g.ships.find(s => s.missionId === q.id);
    out.quarry = { spawned: !!qs, name: qs?.name, role: qs?.role, faction: qs?.faction, inZone: qs ? Math.hypot(qs.position.x - q.zone.x, qs.position.z - q.zone.z) <= q.zone.r + 50 : false, captain: qs?._captain?.name };
    if (qs) { qs.lastAttacker = g.player; g.events.emit('ship:struck', { ship: qs }); }
    out.quarry.ready = !!st.missions.find(m => m.id === q.id)?.ready;
    out.quarry.entered = enter('bridgetown'); out.quarry.status = st.missions.find(m => m.id === q.id).status;
    // castaways
    const rs = offer('portroyal', 'rescue'); c.accept(rs);
    const crew0 = g.player.crew; g.player.teleport(rs.spot.x + 150, rs.spot.z, 0); step(30);
    out.rescue = { ready: !!st.missions.find(m => m.id === rs.id)?.ready, crew: g.player.crew - crew0 };
    enter('portroyal'); out.rescue.status = st.missions.find(m => m.id === rs.id).status;
    // scouting
    const sc = offer('portroyal', 'scout'); c.accept(sc);
    const t = P(sc.to); g.player.teleport(t.harborPoint.x + 300, t.harborPoint.z + 300, 0); step(30);
    out.scout = { ready: !!st.missions.find(m => m.id === sc.id)?.ready, report: st.missions.find(m => m.id === sc.id)?.report };
    enter('portroyal'); out.scout.status = st.missions.find(m => m.id === sc.id).status;
    // transport: delivery
    const tr = offer('portroyal', 'transport'); st.cargo = {}; out.trAccepted = c.accept(tr); out.trCargo = st.cargo[tr.good];
    enter(tr.to); out.trStatus = st.missions.find(m => m.id === tr.id).status; out.trLeft = st.cargo[tr.good] || 0;
    // dispatches: port in sight → message « entrez au port (F) », F prompt « · remettre les plis », delivered on entry
    st.missions = st.missions.filter(m => m.status !== 'active');
    const pl = offer('portroyal', 'deliver'); c.accept(pl);
    const to = P(pl.to), hp = to.harborPoint, dx = hp.x - to.x, dz = hp.z - to.z, dl = Math.hypot(dx, dz) || 1;
    g.player.teleport(hp.x + dx / dl * 1100, hp.z + dz / dl * 1100, 0); step(20);
    const jr = (g.hud.toasts.log || []).map(e => e.text);
    out.deliver = { days: pl.days, notice: jr.find(t => /in sight/.test(t) && t.includes(to.name)) || '' };
    g.player.teleport(hp.x, hp.z, 0); step(10); g.hud.update?.(1 / 30);
    out.deliver.prompt = document.querySelector('.prompt:not(.board)')?.textContent.replace(/\s+/g, ' ').trim() || '';
    out.deliver.pmis = document.querySelector('.prompt:not(.board) .pmis')?.textContent || '';
    out.deliver.entered = enter(pl.to); out.deliver.status = st.missions.find(m => m.id === pl.id).status;
    // chart: three missions under way drawn
    st.missions = st.missions.filter(m => m.status !== 'active');
    for (const k of ['quarry', 'rescue', 'transport']) { st.cargo = {}; c.accept(offer('portroyal', k)); }
    out.targets = c.missionTargets().map(x => x.kind);
    g.worldMap.open(); g.worldMap.draw(); out.mapHits = g.worldMap._hits.filter(h => /Before /.test(h.html)).length; g.worldMap.close();
    return out;
  });
  console.log(JSON.stringify(r));
  const bad = [];
  const chk = (cnd, msg) => { console.log((cnd ? 'ok   ' : 'FAIL ') + msg); if (!cnd) bad.push(msg); };
  chk(r.quarry.spawned && r.quarry.faction === 'pirate' && r.quarry.inZone && /known as/.test(r.quarry.captain || ''), `capitaine recherché à la mer : ${r.quarry.name} (${r.quarry.role})`);
  chk(r.quarry.ready && r.quarry.entered && r.quarry.status === 'done', 'prime touchée à Bridgetown');
  chk(r.rescue.ready && r.rescue.crew > 0 && r.rescue.status === 'done', `naufragés recueillis (+${r.rescue.crew} hommes), mission accomplie`);
  chk(r.scout.ready && r.scout.status === 'done', `reconnaissance : ${r.scout.report}`);
  chk(r.trAccepted && r.trCargo > 0 && r.trStatus === 'done' && r.trLeft === 0, 'transport chargé puis livré');
  chk(/enter port \(F\) to hand over the dispatches/.test(r.deliver.notice), `plis : « ${r.deliver.notice} »`);
  chk(/hand over the dispatches/.test(r.deliver.pmis) && r.deliver.entered && r.deliver.status === 'done', `plis : invite « ${r.deliver.prompt} », remis à l'entrée (${r.deliver.days} jours)`);
  chk(r.targets.length === 3 && r.mapHits === 3, `carte : ${r.targets.join(', ')} (${r.mapHits} info-bulles)`);
  // governor's screen: list, refusal explained
  const gv = await page.evaluate(() => {
    const g = window.__game, st = g.state;
    g.ports.enter(g.islands.getPort('stjohns'), 'governor');
    const rows = document.querySelectorAll('.mission.act').length;
    const objective = document.querySelector('.mission.act p')?.textContent || '';
    document.querySelector('[data-act="accept"]')?.click();
    const toast = document.querySelector('.ptoast.bad')?.textContent || '';
    g.ports.leave();
    return { rows, objective, toast, active: st.missions.filter(m => m.status === 'active').length };
  });
  chk(gv.rows === 3 && gv.objective.length > 20, `Vos missions : ${gv.rows} lignes (« ${gv.objective.slice(0, 60)}… »)`);
  chk(gv.active === 3 && /missions under way/.test(gv.toast), `quatrième mission refusée : « ${gv.toast} »`);
  chk(!errors.length, `console : ${errors.length ? errors.slice(0, 5).join(' | ') : 'aucune erreur'}`);
  await browser.close();
  if (bad.length) { console.log(`\n${bad.length} échec(s) navigateur`); process.exit(1); }
  console.log('\nnavigateur OK');
}
