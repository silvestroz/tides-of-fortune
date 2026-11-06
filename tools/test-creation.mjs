// Character creation. Pure node test (no browser):
//   start per nation (port, heading seaward, reputation), effects of the talents (game.fortune.fx), missing or
//   unknown talent (old save) with no effect and no error, epochs (date, diplomacy via living.startEpoch, traffic
//   and shipyard), articles of ship names (never “the Le Faucon”).
// usage: node tools/test-creation.mjs   (exit code 1 at the first failure)
globalThis.addEventListener ??= () => {};
const { START_PORT, startPortFor, startPose, startReputation, SKILLS, SKILL_IDS, skillFx, EPOCHS, EPOCH_IDS, epochOf, applyEpochShips } = await import('../src/data/creation.js');
const { Fortune } = await import('../src/game/fortune.js');
const { LivingWorld } = await import('../src/game/living.js');
const { RELATIONS, relation } = await import('../src/combat/factions.js');
const { SHIP_TYPES, pickTrafficType, yardTypes, setShipEra } = await import('../src/data/shipTypes.js');
const { theShip, ofShip, theName, ofName } = await import('../src/core/i18n.js');
const { generateWorld } = await import('../src/data/world.js');

let fails = 0, n = 0;
const ok = (c, msg) => { n++; if (!c) { fails++; console.log('ÉCHEC', msg); } };
const eq = (a, b, msg) => ok(a === b, `${msg} : ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`);
const NATIONS = ['english', 'spanish', 'french', 'dutch'];
const events = () => { const h = {}; return { on: (k, f) => (h[k] ||= []).push(f), emit: (k, d) => (h[k] || []).forEach(f => f(d)), h }; };

// ---------------------------------------------------------------- start per nation
const world = generateWorld(1717);
const ports = world.ports.map(p => ({ ...p, harborPoint: { x: p.anchor[0] + p.side[0] * 300, z: p.anchor[1] + p.side[1] * 300 }, seaward: { x: p.side[0], z: p.side[1] } }));
for (const nat of NATIONS) {
  const p = startPortFor(ports, nat);
  ok(p && p.faction === nat && !p.haven, `${nat} : port de départ de sa nation (${p?.id})`);
  eq(p?.id, START_PORT[nat], `${nat} : port de départ`);
  const pose = startPose(p);
  // heading seaward: one step forward moves away from the town (dx = sin heading, dz = −cos heading)
  const a = Math.hypot(pose.x - p.anchor[0], pose.z - p.anchor[1]), b = Math.hypot(pose.x + Math.sin(pose.heading) * 100 - p.anchor[0], pose.z - Math.cos(pose.heading) * 100 - p.anchor[1]);
  ok(b > a + 90, `${nat} : étrave vers le large (${a.toFixed(0)} → ${b.toFixed(0)} m)`);
  const rep = startReputation(nat);
  ok(rep[nat] > 0 && NATIONS.filter(x => x !== nat).every(x => rep[x] === 0), `${nat} : réputation de départ`);
}
eq(startPortFor(ports.filter(p => p.id !== 'portroyal'), 'english')?.faction, 'english', 'repli : autre port anglais');
eq(startPortFor([], 'english'), null, 'aucun port : null sans erreur');

// ---------------------------------------------------------------- talents
const mkFortune = skill => new Fortune({ state: { skill }, events: events() });
const base = mkFortune(undefined).fx;
for (const [skill, label] of [[undefined, 'sans talent'], ['xyz', 'talent inconnu'], [null, 'talent nul'], ['toString', 'clé héritée']]) {
  const fx = mkFortune(skill).fx;
  ok(Object.keys(base).every(k => fx[k] === base[k]), `${label} : aucun effet`);
}
ok(SKILL_IDS.length >= 4 && SKILL_IDS.length <= 5, '4 à 5 talents');
const expect = {
  fencing: { duelWindup: 0.9 }, gunnery: { reloadMul: 0.9, spreadMul: 0.9 }, navigation: { speedMul: 1.04, shoalMul: 0.7 },
  wit: { missionMul: 1.1 }, medicine: { crewLossMul: 0.8, woundMul: 0.8 },
};
for (const id of SKILL_IDS) {
  const fx = mkFortune(id).fx, changed = Object.keys(base).filter(k => fx[k] !== base[k]);
  ok(changed.length >= 1, `${id} : au moins un effet`);
  for (const k of changed) ok(Math.abs(fx[k] / (base[k] || 1) - 1) <= 0.31, `${id} : effet modéré sur ${k} (${fx[k]})`);
  for (const [k, v] of Object.entries(expect[id] || {})) ok(Math.abs(fx[k] - v) < 1e-9, `${id} : ${k} = ${v} (${fx[k]})`);
  ok(SKILLS[id].name && SKILLS[id].effect && /\d/.test(SKILLS[id].effect), `${id} : nom et effet chiffré`);
}
// stacking with an officer (gunner −15 % then Gunnery −10 %)
{ const f = mkFortune('gunnery'); f.game.state.specialists = { gunner: true }; ok(Math.abs(f.fx.reloadMul - 0.85 * 0.9) < 1e-9, 'talent × officier'); }
// the player's ship receives speed, reefs and spread
{ const f = mkFortune('gunnery'); const p = {}; f.game.player = p; f.update(0.1); eq(p.gunSpread, 0.9, 'Artillerie → ship.gunSpread'); }
{ const f = mkFortune('navigation'); const p = {}; f.game.player = p; f.update(0.1); ok(p.fortuneSpeedF === 1.04 && p.shoalDmgF === 0.7, 'Navigation → vitesse et récifs'); }
{ const f = mkFortune(undefined); const p = {}; f.game.player = p; f.update(0.1); ok(p.gunSpread === 1 && p.fortuneSpeedF === 1, 'ancienne sauvegarde : navire inchangé'); }
eq(skillFx('nope'), null, 'skillFx inconnu');

// ---------------------------------------------------------------- epochs
const DEF = JSON.parse(JSON.stringify(RELATIONS));
const mkLiving = () => {
  const game = { state: { date: { year: 1660, month: 6, day: 1 }, reputation: {} }, events: events(), islands: { ports: ports.map(p => ({ ...p })) }, settings: {} };
  game.living = new LivingWorld(game);
  return game;
};
for (const id of EPOCH_IDS) {
  const g = mkLiving(), ep = epochOf(id), notes = [];
  g.events.on('notify', e => notes.push(e.text));
  const before = JSON.parse(JSON.stringify(g.state.convoys));
  g.living.startEpoch(id);
  eq(g.state.date.year, ep.year, `${id} : année de départ`);
  eq(notes.length, 0, `${id} : diplomatie posée sans message`);
  eq(g.state.news.length, 0, `${id} : sans nouvelle`);
  for (const [a, b, v] of ep.rel || []) eq(relation(a, b), v, `${id} : ${a}/${b}`);
  if (!ep.rel) for (const a of NATIONS) for (const b of NATIONS) if (a !== b) eq(relation(a, b), DEF[a][b], `${id} : ${a}/${b} par défaut`);
  for (const [k, v] of Object.entries(g.state.diplomacy.rel)) { const [a, b] = k.split('|'); eq(RELATIONS[a][b], v, `${id} : RELATIONS recopiée (${k})`); }
  const now = g.living.today;
  ok(g.state.diplomacy.next > now && g.state.diplomacy.next <= now + 10, `${id} : prochain tirage diplomatique dans les jours qui viennent`);
  ok(Object.values(g.state.diplomacy.since).every(d => d <= now - 100), `${id} : relations anciennes`);
  eq(g.state.living.townDay, now, `${id} : villes recalées sur la date`);
  ok(g.state.convoys.length > 0 && g.state.convoys.every(c => c.arrive >= now - 2 && c.depart <= now + 10), `${id} : convois recalés (${before.length} → ${g.state.convoys.length})`);
  ok(g.state.convoys.filter(c => c.status === 'planned').every(c => relation(ports.find(p => p.id === c.from).faction, ports.find(p => p.id === c.to).faction) >= 0), `${id} : pas de convoi vers un port ennemi`);
  // one day passes: no burst of draws (earlier or later date)
  const n0 = notes.length; g.state.date.day++; g.events.emit('career:day'); ok(notes.length - n0 <= 2, `${id} : un jour plus tard, au plus un tirage`);
}
// old save without an epoch: golden age, original tables
{ const g = mkLiving(); eq(g.state.epoch, undefined, 'sauvegarde sans époque'); eq(pickTrafficType('patrol', 'english', () => 0.999) !== undefined, true, 'trafic sans époque'); }

// traffic and shipyard
const share = (fam, role = 'patrol') => { let r = 12345, k = 0; const rnd = () => ((r = (Math.imul(r, 1664525) + 1013904223) >>> 0) / 4294967296); for (let i = 0; i < 4000; i++) if (SHIP_TYPES[pickTrafficType(role, 'english', rnd)].fam === fam) k++; return k / 4000; };
const big = { size: 'large', faction: 'english' }, bigEs = { size: 'large', faction: 'spanish' };
applyEpochShips('golden'); const g0 = share('vaisseau'), y0 = yardTypes(big);
applyEpochShips('early'); const g1 = share('vaisseau'), gal1 = share('galion', 'merchant'), y1 = yardTypes(big);
applyEpochShips('late'); const g2 = share('vaisseau'), gal2 = share('galion', 'merchant'), y2 = yardTypes(bigEs);
applyEpochShips(undefined);
ok(g1 < g0 * 0.5 && g2 > g0 * 1.4, `vaisseaux de ligne : 1640 ${(g1 * 100).toFixed(1)} %, 1660 ${(g0 * 100).toFixed(1)} %, 1680 ${(g2 * 100).toFixed(1)} %`);
ok(gal1 > gal2, `galions marchands plus nombreux en 1640 (${(gal1 * 100).toFixed(1)} %) qu'en 1680 (${(gal2 * 100).toFixed(1)} %)`);
ok(y0.includes('seventyfour') && !y1.includes('seventyfour') && !y1.includes('threedecker'), 'chantier 1640 : pas de vaisseau de 74 ni de trois-ponts');
applyEpochShips('early'); ok(yardTypes(big, 'threedecker')[0] === 'threedecker', 'chantier 1640 : le trois-ponts du joueur reste proposé'); applyEpochShips(undefined);
ok(!y2.includes('nao') && y2.includes('threedecker'), 'chantier 1680 : plus de nao');
eq(yardTypes(big).join(), y0.join(), 'époque inconnue : chantier par défaut');

// ---------------------------------------------------------------- articles
// English: 'the' before a ship's name, except names that carry their own (French, Spanish, Dutch) article
const cases = [
  ['Le Faucon', 'Le Faucon', 'of Le Faucon'], ['La Belle', 'La Belle', 'of La Belle'], ['Les Trois Frères', 'Les Trois Frères', 'of Les Trois Frères'],
  ["L'Aigle", "L'Aigle", "of L'Aigle"], ['L’Aigle', 'L’Aigle', 'of L’Aigle'], ['De Hoop', 'De Hoop', 'of De Hoop'], ['Merry Wren', 'The Merry Wren', 'of the Merry Wren'],
  ['Lark', 'The Lark', 'of the Lark'], ['Laura', 'The Laura', 'of the Laura'], ['San Telmo', 'The San Telmo', 'of the San Telmo'], ['Lantern Maid', 'The Lantern Maid', 'of the Lantern Maid'],
];
for (const [name, the, of] of cases) {
  eq(theShip({ name }, true), the, `theShip(${name})`); eq(ofShip({ name }), of, `ofShip(${name})`);
  eq(theName(name, true), the, `theName(${name})`); eq(ofName(name), of, `ofName(${name})`);
  ok(!/\bthe (le|la|les|l’|l'|de|el)\b/i.test(`${theShip({ name })} has taken the weather gauge from us · ${ofShip({ name })}`), `no double article: ${name}`);
}
eq(theShip({ type: 'frigate', faction: 'french' }, true), 'The French frigate', 'unnamed ship (capitalised)');
eq(ofShip({ type: 'brig', faction: 'dutch' }), 'of the Dutch brig', 'unnamed ship (of)');
eq(theShip({ name: 'Unnamed', type: 'schooner', faction: 'english' }), 'the English schooner', 'ship “Unnamed”');
eq(theShip({ type: 'sloop', faction: 'pirate' }), 'the pirate sloop', 'pirate ship');

console.log(fails ? `${fails} échec(s) sur ${n} vérifications` : `OK : ${n} vérifications`);
process.exit(fails ? 1 : 0);
