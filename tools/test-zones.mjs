// Test of the sea tiers: node tools/test-zones.mjs [--browser]
// Pure node: power classes, traffic caps per tier and per role (2,000 draws each), relative cap of pirates in
// guarded waters, role shares, closed zones (forbidden), Top 10 lairs (outside guarded waters, ≥ 3 km from the
// starting ports, ranks 1–4 in perilous seas), mission bounties per tier.
// --browser: in the real game (dev server, TOF_URL): zones at the starting ports, traffic spawned around the player
// in guarded waters and in perilous seas, no Top 10 captain at Fort Royal, a pirate raiding corvette that gives up
// at the boundary of the guarded waters then fights back if hit, zero console errors.
import assert from 'node:assert';
import { generateWorld } from '../src/data/world.js';
import { SHIP_TYPES, SHIP_IDS, pickTrafficType, powerOf, powerClass, classOf } from '../src/data/shipTypes.js';
import { ZONE_TIERS, GUARDED, LAIRS, buildZones, zoneAt, capFor, forbidden } from '../src/data/seaZones.js';
import { PIRATE_LORDS } from '../src/data/fortune.js';
import { PirateLords } from '../src/game/pirateLords.js';

const W = generateWorld();
const ports = W.ports.map(p => ({ ...p, x: p.anchor[0], z: p.anchor[1], harborPoint: { x: p.anchor[0] + p.side[0] * 230, z: p.anchor[1] + p.side[1] * 230 } }));
const coves = W.coves.map(c => ({ ...c, anchorPoint: { x: c.anchor[0] + c.side[0] * 500, z: c.anchor[1] + c.side[1] * 500 } }));
const Z = buildZones(ports);
const port = id => ports.find(p => p.id === id);
let n = 0; const ok = (name, fn) => { fn(); n++; console.log('ok  ', name); };
const rnd = (() => { let s = 12345; return () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648); })();

ok('classes de puissance : brick II, corvette III, frégate IV, deux-ponts V, lougre I', () => {
  const want = { lugger: 1, sloop: 1, brig: 2, topschooner: 2, snow: 3, corvette: 3, raider: 3, frigate: 4, heavyfrigate: 4, galleon: 4, twodecker: 5, greatgalleon: 5, threedecker: 5 };
  for (const [id, c] of Object.entries(want)) assert.strictEqual(classOf(id), c, `${id} : cote ${powerOf(id).toFixed(1)}, classe ${classOf(id)} ≠ ${c}`);
  assert.ok(powerOf('threedecker') > powerOf('seventyfour') && powerOf('frigate') > powerOf('corvette'));
});

ok('zones : ports de départ en eaux gardées, Nassau et Carthagène en mers périlleuses, Santo Domingo sur les routes', () => {
  for (const id of Object.keys(GUARDED)) assert.strictEqual(zoneAt(Z, port(id).harborPoint.x, port(id).harborPoint.z).tier, 1, id);
  for (const id of ['nassau', 'tortuga', 'cartagena']) assert.strictEqual(zoneAt(Z, port(id).harborPoint.x, port(id).harborPoint.z).tier, 3, id);
  for (const id of ['santodomingo', 'santiago', 'sanjuan', 'stjohns', 'basseterre', 'oranjestad']) assert.strictEqual(zoneAt(Z, port(id).harborPoint.x, port(id).harborPoint.z).tier, 2, id);
  assert.match(zoneAt(Z, port('portroyal').harborPoint.x, port('portroyal').harborPoint.z).name, /Port Royal/);
});

const roles = ['merchant', 'patrol', 'pirate', 'hunter'], nations = ['english', 'spanish', 'french', 'dutch', 'pirate'];
const stats = {};
ok('trafic : 2 000 tirages par niveau et par rôle, aucun navire au-dessus du plafond (joueur sur un brick)', () => {
  const pp = powerOf('brig');
  for (const t of [1, 2, 3]) for (const role of roles) {
    const cap = capFor(t, role, pp), seen = {};
    for (let i = 0; i < 2000; i++) {
      const f = role === 'pirate' ? 'pirate' : nations[i % 4];
      const id = pickTrafficType(role, f, rnd, cap);
      if (!SHIP_TYPES[id]?.roles?.[role]) continue;   // role without any type under the cap (brig fallback)
      assert.ok(classOf(id) <= cap.maxClass, `niveau ${t} ${role} : ${id} classe ${classOf(id)} > ${cap.maxClass}`);
      assert.ok(powerOf(id) <= cap.maxPower, `niveau ${t} ${role} : ${id} cote ${powerOf(id).toFixed(1)} > ${cap.maxPower}`);
      seen[id] = (seen[id] || 0) + 1;
    }
    stats[`${t}-${role}`] = Object.keys(seen).sort((a, b) => powerOf(b) - powerOf(a))[0];
  }
  assert.ok(classOf(stats['3-patrol']) === 5, `niveau III : les patrouilles comptent des vaisseaux (${stats['3-patrol']})`);
  assert.ok(classOf(stats['1-patrol']) <= 3 && classOf(stats['1-pirate']) <= 2);
});

ok('eaux gardées : un pirate ne dépasse pas 1,15 × la cote du joueur (lougre → sloop au plus)', () => {
  const cap = capFor(1, 'pirate', powerOf('lugger'));
  for (let i = 0; i < 2000; i++) { const id = pickTrafficType('pirate', 'pirate', rnd, cap); assert.ok(powerOf(id) <= Math.max(9, 1.15 * powerOf('lugger')) + 1e-9, id); }
  const big = capFor(1, 'pirate', powerOf('frigate'));
  assert.strictEqual(big.maxClass, 2, 'en eaux gardées, la classe II reste le plafond même pour une frégate');
});

ok('parts des rôles : 12 % de pirates en eaux gardées, 18 % sur les routes, 28 % en mers périlleuses', () => {
  for (const t of [1, 2, 3]) assert.ok(ZONE_TIERS[t].roles.pirate === [0.12, 0.18, 0.28][t - 1]);
  assert.ok(ZONE_TIERS[2].roles.merchant === 0.48, 'niveau II = ancien tirage');
});

ok('zones fermées : frégate interdite en eaux gardées, brick pirate admis, capitaine du Top 10 jamais, marchand partout', () => {
  const pr = port('portroyal').harborPoint, sd = port('santodomingo').harborPoint, na = port('nassau').harborPoint;
  const ship = (type, role, extra = {}) => ({ type, role, guns: SHIP_TYPES[type].guns, hullMax: SHIP_TYPES[type].hull, ...extra });
  assert.ok(forbidden(Z, ship('frigate', 'patrol'), pr.x, pr.z), 'frégate en eaux gardées');
  assert.ok(!forbidden(Z, ship('frigate', 'patrol'), sd.x, sd.z), 'frégate sur les routes');
  assert.ok(forbidden(Z, ship('seventyfour', 'patrol'), sd.x, sd.z), 'vaisseau de 74 sur les routes');
  assert.ok(!forbidden(Z, ship('seventyfour', 'patrol'), na.x, na.z), 'vaisseau de 74 en mers périlleuses');
  assert.ok(!forbidden(Z, ship('brig', 'pirate'), pr.x, pr.z), 'brick pirate en eaux gardées');
  assert.ok(forbidden(Z, ship('brig', 'pirate', { lordId: 'lamproie' }), pr.x, pr.z), 'capitaine du Top 10 en eaux gardées');
  assert.ok(!forbidden(Z, ship('galleon', 'merchant'), pr.x, pr.z), 'galion marchand');
  assert.ok(!forbidden(Z, ship('galleon', 'merchant', { isPlayer: true }), pr.x, pr.z));
  // in guarded waters, a pirate stronger than max(9; 1.15 × the targeted player) doesn't chase him
  const lugger = ship('lugger', 'merchant', { isPlayer: true }), brigP = ship('brig', 'merchant', { isPlayer: true });
  assert.ok(forbidden(Z, ship('brig', 'pirate'), pr.x, pr.z, lugger), 'brick pirate contre un joueur en lougre, eaux gardées');
  assert.ok(!forbidden(Z, ship('brig', 'pirate'), pr.x, pr.z, brigP), 'brick pirate contre un joueur en brick');
  assert.ok(!forbidden(Z, ship('brig', 'pirate'), sd.x, sd.z, lugger), 'brick pirate contre un lougre sur les routes');
});

ok('repaires du Top 10 : hors eaux gardées, à ≥ 3 km des ports de départ, rangs 1–4 en mers périlleuses', () => {
  const state = { lords: {} }, events = { on() {} };
  const game = { state, events, islands: { ports, coves }, ships: [], seaZones: { tierAt: (x, z) => zoneAt(Z, x, z).tier } };
  const L = new PirateLords(game);
  const start = ports.filter(p => GUARDED[p.id]).map(p => p.harborPoint);
  const pos = key => { const [k, id] = key.split(':'); const o = k === 'port' ? ports.find(p => p.id === id).harborPoint : coves.find(c => c.id === id).anchorPoint; return o; };
  PIRATE_LORDS.forEach((l, i) => {
    const e = state.lords[l.id], p = pos(e.lair), t = zoneAt(Z, p.x, p.z).tier;
    const dmin = Math.min(...start.map(s => Math.hypot(s.x - p.x, s.z - p.z)));
    assert.ok(t !== 1 && dmin >= LAIRS.minFromStart, `${l.id} : ${e.lair}, niveau ${t}, ${Math.round(dmin)} m d'un port de départ`);
    if (i < 4) assert.strictEqual(t, 3, `${l.id} (rang ${i + 1}) en mers périlleuses (${e.lair})`);
    else assert.strictEqual(t, 2, `${l.id} (rang ${i + 1}) sur les routes marchandes (${e.lair})`);
  });
  assert.strictEqual(state.lordsLairs, LAIRS.version);
  // old save: lair at Dominica, reassigned once
  state.lords.ardent.lair = 'cove:cove_dominica'; delete state.lordsLairs; L.ensure();
  assert.notStrictEqual(state.lords.ardent.lair, 'cove:cove_dominica');
  // a chosen lair isn't reassigned twice
  const keep = state.lords.ardent.lair; L.ensure(); assert.strictEqual(state.lords.ardent.lair, keep);
});

ok('missions : prime ×1 / ×1,25 / ×1,6 selon le niveau', () => {
  assert.deepStrictEqual([1, 2, 3].map(t => ZONE_TIERS[t].reward), [1, 1.25, 1.6]);
});

console.log(`\n${n} tests OK. Plus gros navire tiré par niveau et rôle :`);
for (const t of [1, 2, 3]) console.log(`  niveau ${t} : ` + roles.map(r => `${r} ${stats[`${t}-${r}`] ?? '—'} (${stats[`${t}-${r}`] ? classOf(stats[`${t}-${r}`]) : '-'})`).join(', '));

if (process.argv.includes('--browser')) {
  const { chromium } = await import('playwright');
  const { BASE, launchOpts } = await import('./_env.mjs');
  const browser = await chromium.launch(launchOpts(['--disable-dev-shm-usage']));
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  const errors = [], bad = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('[pageerror] ' + e.message));
  const chk = (c, msg) => { console.log(c ? 'ok  ' : 'FAIL', msg); if (!c) bad.push(msg); };
  await page.goto(BASE + '?quality=low&dynres=0&start=fortroyal', { timeout: 180000 });
  await page.waitForFunction(() => window.__ready || window.__error, null, { timeout: 240000 });
  await page.evaluate(() => { localStorage.removeItem('tof.save.v1'); const g = window.__game; g.renderer.setAnimationLoop(null); g.hud?.menu?.close(); g.mode = 'sail'; g.frozen = false; });
  const r = await page.evaluate(() => {
    const g = window.__game, zs = g.seaZones, p = g.player, out = {};
    const step = n => { for (let i = 0; i < n; i++) g.step(1 / 30); };
    const clear = () => { for (const s of [...g.ships]) if (s !== p) g.combat._despawn(s); };
    const P = id => g.islands.getPort(id).harborPoint;
    out.start = Object.fromEntries(['portroyal', 'havana', 'fortroyal', 'willemstad', 'nassau', 'santodomingo'].map(id => [id, zs.tierAt(P(id).x, P(id).z)]));
    // traffic around the player: guarded waters of Fort Royal, then the Lucayan banks
    const sample = (x, z, k) => {
      clear(); p.teleport(x, z, 0);
      const seen = []; for (let i = 0; i < k; i++) { const s = g.combat._spawnRandom(true); if (s) { seen.push({ type: s.type, role: s.role, faction: s.faction, tier: zs.tierAt(p.position.x, p.position.z) }); for (const gd of s.guards || []) seen.push({ type: gd.type, role: 'escort', faction: gd.faction }); } clear(); }
      return seen;
    };
    const fr = P('fortroyal'); out.guarded = sample(fr.x - 600, fr.z, 160);
    const na = P('nassau'); out.perilous = sample(na.x, na.z + 900, 160);
    // Top 10: 20 s at sea off Fort Royal, no black sail
    clear(); p.teleport(fr.x - 400, fr.z, 0); g.combat.setTrafficTarget(0); step(600);
    out.lordsAtStart = g.ships.filter(s => s.lordId).length;
    out.lairs = Object.values(g.state.lords).map(e => e.lair);
    // pirate raiding corvette (class III) off the boundary: it chases the player on the routes, gives up in guarded waters
    clear();
    const edge = { x: fr.x - 1800, z: fr.z - 1800 };   // trade routes, ~550 m beyond the boundary (radius 2,000 m)
    p.teleport(edge.x, edge.z, -Math.PI / 2);
    out.edgeTier = zs.tierAt(edge.x, edge.z);
    const f = g.combat.spawnAI({ type: 'raider', faction: 'pirate', role: 'pirate', x: edge.x - 350, z: edge.z - 350, heading: Math.PI / 2, name: 'Essai' });
    f.ai._scanT = 0; step(3);
    out.chaseOutside = f.ai.target === p;
    // the player crosses the boundary, the corvette stays 400 m from him (in range): it gives up
    p.teleport(fr.x - 700, fr.z - 300, -Math.PI / 2); out.insideTier = zs.tierAt(p.position.x, p.position.z);
    f.teleport(p.position.x - 300, p.position.z - 260, Math.PI / 2); f.ai._scanT = 0; step(3);
    out.chaseInside = f.ai.target === p;
    out.breakToast = [...document.querySelectorAll('.toast, .toasts *')].some(e => /gives up following you/.test(e.textContent || '')) || g.hud?.toasts?.journal?.some?.(j => /gives up/.test(j.text || j));
    f.lastAttacker = p; f.lastHitT = g.time; f.ai._scanT = 0; step(3);
    out.provoked = f.ai.target === p;
    return out;
  });
  const t = r.start;
  chk(t.portroyal === 1 && t.havana === 1 && t.fortroyal === 1 && t.willemstad === 1 && t.nassau === 3 && t.santodomingo === 2, `niveaux : ${JSON.stringify(t)}`);
  const worst = a => a.reduce((m, s) => Math.max(m, s.cls), 0);
  const gu = r.guarded.map(s => ({ ...s, cls: classOf(s.type) })), pe = r.perilous.map(s => ({ ...s, cls: classOf(s.type) }));
  const agg = a => a.filter(s => s.role === 'pirate' || s.role === 'patrol' || s.role === 'escort');
  chk(gu.length > 100 && agg(gu).every(s => s.cls <= (s.role === 'pirate' || s.role === 'escort' ? 2 : 3)), `eaux gardées : ${gu.length} navires, agresseurs ≤ classe ${worst(agg(gu))} (pirates ≤ II, patrouilles ≤ III)`);
  chk(pe.length > 100 && worst(pe) >= 4, `mers périlleuses : ${pe.length} navires, jusqu'à la classe ${worst(pe)} (${pe.filter(s => s.cls >= 4).length} de classe IV ou V)`);
  const pir = a => a.filter(s => s.role === 'pirate').length / Math.max(1, a.length);
  chk(pir(pe) > pir(gu), `pirates : ${Math.round(pir(gu) * 100)} % en eaux gardées, ${Math.round(pir(pe) * 100)} % en mers périlleuses`);
  chk(r.lordsAtStart === 0, `aucun capitaine du Top 10 devant Fort Royal après 20 s (repaires : ${r.lairs.join(', ')})`);
  chk(r.edgeTier === 2 && r.insideTier === 1 && r.chaseOutside && !r.chaseInside, `corvette de course pirate : chasse sur les routes (niveau ${r.edgeTier}, ${r.chaseOutside}), renonce en eaux gardées (niveau ${r.insideTier}, ${!r.chaseInside})`);
  chk(r.provoked, `corvette de course touchée en eaux gardées : riposte (${r.provoked})`);
  chk(!errors.length, `console : ${errors.length ? errors.slice(0, 5).join(' | ') : 'aucune erreur'}`);
  await browser.close();
  if (bad.length) { console.log(`\n${bad.length} échec(s) navigateur`); process.exit(1); }
  console.log('\nnavigateur OK');
}
