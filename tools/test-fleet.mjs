// Pure test of the squadron logic (src/game/fleet.js): node tools/test-fleet.mjs
import assert from 'node:assert';
import { ensureFleet, salePrice, repairCost, repairShip, sellShip, swapFlagship, transferGoods, transferMen, hullMaxOf, crewMaxOf, holdCapOf, holdUsedOf, FLEET } from '../src/game/fleet.js';
import { SHIP_PRICES, CARGO_CAPACITY } from '../src/game/economy.js';
import { bulkOf } from '../src/game/transship.js';

let n = 0; const ok = (name, fn) => { fn(); n++; console.log('ok', name); };

// old saves: { type, name, hull, from, cargo? } only
ok('ensureFleet: defaults for old saves', () => {
  const st = { fleet: [{ type: 'merchantman', name: 'Santa Lucía', hull: 0.62, from: 'spanish', cargo: { sugar: 40, tobacco: 0 } }, { type: 'nope', name: 'x', hull: 1 }, { type: 'sloop', name: 'Furet', hull: 1.4 }] };
  const f = ensureFleet(st);
  assert.equal(f.length, 2);
  assert.deepEqual(f[0].upgrades, { guns: 0, hull: 0, hold: 0, sheath: 0, canvas: 0, berths: 0 });
  assert.equal(f[0].crew, 0); assert.equal(f[0].sails, 1); assert.deepEqual(f[0].cargo, { sugar: 40 });
  assert.equal(f[1].hull, 1); assert.deepEqual(f[1].cargo, {});
  assert.deepEqual(ensureFleet({}), []);
});

ok('derived stats follow the refits (same formulas as applyUpgrades / holdCapacity)', () => {
  assert.equal(hullMaxOf('brig', { hull: 2 }), Math.round(120 * 1.21));
  assert.equal(crewMaxOf('brig', { berths: 1 }), 132);
  assert.equal(holdCapOf('merchantman', { hold: 1 }), Math.round(CARGO_CAPACITY.merchantman * 1.15));
});

ok('sale price = shipyard trade-in formula', () => {
  assert.equal(salePrice({ type: 'frigate', hull: 1 }), Math.round(SHIP_PRICES.frigate * 0.55));
  assert.equal(salePrice({ type: 'frigate', hull: 0.5 }), Math.round(SHIP_PRICES.frigate * 0.55 * 0.7));
  assert.equal(salePrice({ type: 'galleon', hull: 0 }), Math.round(SHIP_PRICES.galleon * 0.55 * 0.4));
});

ok('repair cost = ports.repairCost scale (hull ×6, sails ×3 of hull max), rank privileges', () => {
  const f = { type: 'brig', hull: 0.5, sails: 0.8, upgrades: {} };
  assert.deepEqual(repairCost(f), { hull: 360, sails: 72, free: false });
  assert.deepEqual(repairCost(f, 0.5), { hull: 180, sails: 36, free: false });
  assert.equal(repairCost(f, 0).free, true);
  const st = { gold: 216, fleet: [{ ...f }] };
  const r = repairShip(st, 0, 1);   // half the bill: half the damage mended
  assert.equal(r.spent, 216); assert.equal(st.gold, 0); assert.ok(Math.abs(st.fleet[0].hull - 0.75) < 1e-9);
  st.gold = 5000; repairShip(st, 0, 1); assert.equal(st.fleet[0].hull, 1); assert.equal(st.fleet[0].sails, 1);
  const st2 = { gold: 0, fleet: [{ type: 'brig', hull: 0.3 }] }; repairShip(st2, 0, 0); assert.equal(st2.fleet[0].hull, 1);
});

ok('sell: ship + cargo (80 % of the market price), men back aboard as far as berths allow', () => {
  const st = { gold: 100, fleet: [{ type: 'merchantman', name: 'Santa Lucía', hull: 0.6, crew: 30, cargo: { sugar: 10 } }] };
  const flag = { crew: 100, crewMax: 120 };
  const r = sellShip(st, 0, { priceOf: () => 50, flag });
  assert.equal(r.ship, salePrice({ type: 'merchantman', hull: 0.6 })); assert.equal(r.cargo, 400);
  assert.equal(st.gold, 100 + r.ship + 400); assert.equal(st.fleet.length, 0);
  assert.equal(r.menBack, 20); assert.equal(r.menAshore, 10); assert.equal(flag.crew, 120);
});

ok('transfer goods both ways, both holds capped, price basis follows the goods', () => {
  const st = { cargo: { sugar: 50 }, food: 20, ledger: { cost: { sugar: 1500 } }, fleet: [{ type: 'sloop', name: 'Furet', hull: 1, cargo: { rum: 10 } }] };
  const flagCap = 90, cap1 = holdCapOf('sloop', {});   // sloop hold 40
  assert.equal(transferGoods(st, 0, 'sugar', 'out', 1e9, flagCap), cap1 - 10);   // only 30 fit aboard the sloop
  assert.equal(st.cargo.sugar, 20); assert.equal(st.fleet[0].cargo.sugar, 30);
  assert.equal(holdUsedOf(st.fleet[0]), cap1);
  assert.ok(Math.abs(st.ledger.cost.sugar - 600) < 1e-6 && Math.abs(st.fleet[0].costs.sugar - 900) < 1e-6);
  assert.equal(transferGoods(st, 0, 'sugar', 'out', 1, flagCap), 0);           // sloop full
  assert.equal(transferGoods(st, 0, 'rum', 'in', 1e9, flagCap), 10);
  assert.equal(st.cargo.rum, 10); assert.equal(st.fleet[0].cargo.rum, undefined);
  assert.equal(transferGoods(st, 0, 'food', 'out', 5, flagCap), 5); assert.equal(st.food, 15); assert.equal(st.fleet[0].cargo.food, 5);
  assert.equal(transferGoods(st, 0, 'sugar', 'in', 1e9, flagCap), 30);
  assert.ok(Math.abs(st.ledger.cost.sugar - 1500) < 1e-6); assert.equal(st.fleet[0].costs, undefined);
  assert.equal(bulkOf({ ...st.cargo, food: st.food }), 75);   // sugar 50 + rum 10 + food 15
  // flagship hold full: nothing more comes aboard
  const st2 = { cargo: { timber: 45 }, food: 0, fleet: [{ type: 'brig', name: 'B', hull: 1, cargo: { salt: 9 } }] };
  assert.equal(transferGoods(st2, 0, 'salt', 'in', 9, 90), 0);
});

ok('transfer men: berths on both ships, the flagship keeps a skeleton crew', () => {
  const st = { fleet: [{ type: 'sloop', name: 'Furet', hull: 1, crew: 0 }] };
  const flag = { crew: 50, crewMax: 120 };
  assert.equal(transferMen(st, 0, 'out', 1e9, flag), 50 - FLEET.minFlagCrew); assert.equal(flag.crew, FLEET.minFlagCrew);
  assert.equal(transferMen(st, 0, 'in', 10, flag), 10); assert.equal(flag.crew, FLEET.minFlagCrew + 10); assert.equal(st.fleet[0].crew, 50 - FLEET.minFlagCrew - 10);
  const st2 = { fleet: [{ type: 'sloop', name: 'Furet', hull: 1, crew: 70 }] }, f2 = { crew: 200, crewMax: 220 };
  assert.equal(transferMen(st2, 0, 'out', 1e9, f2), crewMaxOf('sloop', {}) - 70);
});

ok('swap flagship and back: hull, refits, overflow of men and goods', () => {
  const st = { gold: 0, cargo: { sugar: 60, spice: 20 }, food: 20, upgrades: { guns: 1, hull: 1, hold: 0, sheath: 0, canvas: 2, berths: 0 }, ledger: { cost: { sugar: 1800 } },
    fleet: [{ type: 'sloop', name: 'Furet', hull: 0.8, from: 'french', crew: 5 }] };
  const flag = { type: 'brig', name: 'Merry Wren', faction: 'english', hull: 0.7, sails: 0.9, crew: 110, crewMax: 120 };
  const r = swapFlagship(st, 0, flag);
  assert.equal(r.type, 'sloop'); assert.equal(r.name, 'Furet'); assert.equal(r.hull, 0.8);
  assert.equal(r.crew, crewMaxOf('sloop', {}));   // 75 berths: all hands up to the berths
  assert.deepEqual(st.upgrades, { guns: 0, hull: 0, hold: 0, sheath: 0, canvas: 0, berths: 0 });
  const old = st.fleet[0];
  assert.equal(old.type, 'brig'); assert.equal(old.name, 'Merry Wren'); assert.equal(old.hull, 0.7); assert.equal(old.sails, 0.9); assert.equal(old.from, 'english'); assert.equal(old.own, true);
  assert.equal(old.crew, 110 + 5 - 75); assert.equal(old.upgrades.canvas, 2); assert.equal(old.upgrades.hull, 1);
  // sloop hold 40: provisions first (20), then the densest goods (spice 20 × 0,5 = 10), then 10 sugar
  assert.equal(st.food, 20); assert.equal(st.cargo.spice, 20); assert.equal(st.cargo.sugar, 10);
  assert.deepEqual(old.cargo, { sugar: 50 });
  assert.ok(Math.abs(st.ledger.cost.sugar - 300) < 1e-6 && Math.abs(old.costs.sugar - 1500) < 1e-6);
  // and back: everything returns (brig hold 90), the refits follow their hull
  const flag2 = { type: 'sloop', name: 'Furet', faction: 'english', hull: 0.8, sails: 1, crew: 75, crewMax: 75 };
  const r2 = swapFlagship(st, 0, flag2);
  assert.equal(r2.type, 'brig'); assert.equal(r2.crew, 115); assert.equal(st.upgrades.canvas, 2); assert.equal(st.upgrades.hull, 1);
  assert.equal(st.fleet[0].type, 'sloop'); assert.equal(st.fleet[0].crew, 0); assert.equal(st.fleet[0].upgrades.canvas, 0);
  assert.equal(st.cargo.sugar, 60); assert.equal(st.cargo.spice, 20); assert.equal(st.food, 20);
  assert.deepEqual(st.fleet[0].cargo, {}); assert.ok(Math.abs(st.ledger.cost.sugar - 1800) < 1e-6); assert.equal(st.fleet[0].costs, undefined);
  // a full new hold keeps its own goods: the flagship's hold stays aboard the old ship
  const st3 = { cargo: { rum: 30 }, food: 10, upgrades: {}, fleet: [{ type: 'lugger', name: 'L', hull: 1, cargo: { timber: 20 } }] };
  swapFlagship(st3, 0, { type: 'brig', name: 'B', hull: 1, crew: 40, crewMax: 120 });
  assert.deepEqual(st3.cargo, { timber: 20 }); assert.equal(st3.food, 0); assert.deepEqual(st3.fleet[0].cargo, { rum: 30, food: 10 });
});

console.log(`fleet OK (${n} groupes)`);
