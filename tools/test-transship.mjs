// Pure test of the capture-screen Transbordement logic (src/game/transship.js): node tools/test-transship.mjs
import { makeManifest, bestFill, move, bulkOf, canValidate, takeBack, applyHold, jettisonPhrase } from '../src/game/transship.js';
import assert from 'node:assert';
const m = bestFill(makeManifest({ sugar: 20 }, 30, { spice: 40, timber: 30, rum: 50 }, 100));
// own 50 used; room 50: spice 40×0.5=20, rum 30 → full
assert.equal(bulkOf(m.own), 100); assert.equal(m.own.spice, 40); assert.equal(m.own.rum, 30); assert.equal(m.prize.timber, 30);
assert.equal(move(m, 'timber', 'in', 5), 0);           // full: refuses
assert.equal(move(m, 'sugar', 'out', 10), 10);         // jettison sugar
assert.equal(move(m, 'timber', 'in', 1e9), 5);         // 10 room / bulk 2
assert.ok(canValidate(m)); assert.equal(m.prize.sugar, 10);
move(m, 'food', 'out', 30); assert.equal(m.own.food, undefined); assert.equal(m.prize.food, 30);
bestFill(m); assert.equal(m.own.food, 30); assert.equal(m.own.sugar, 20);
const o = makeManifest({ sugar: 120 }, 0, { rum: 5 }, 100); bestFill(o);
assert.ok(canValidate(o)); assert.equal(o.own.rum, undefined);  // already overloaded: may validate, cannot add

// hold at sea (I key): jettison = move 'out' into an empty « prize » pile, takeBack ignores the capacity
const j = makeManifest({ sugar: 50, spice: 20, timber: 0 }, 40, {}, 80);   // 50 + 10 + 40 = 100 / 80: overloaded
assert.equal(bulkOf(j.own), 100); assert.equal(j.own.timber, undefined);
assert.equal(move(j, 'sugar', 'out', 10), 10); assert.equal(bulkOf(j.own), 90); assert.equal(j.prize.sugar, 10);
assert.equal(move(j, 'food', 'out', 1e9), 40); assert.equal(j.own.food, undefined);
assert.equal(move(j, 'rum', 'out', 5), 0);                // nothing of it aboard
assert.equal(takeBack(j, 'food', 15), 15);                 // back aboard although over capacity
assert.equal(bulkOf(j.own), 65); assert.equal(j.prize.food, 25);
assert.equal(takeBack(j, 'food', 1e9), 25); assert.equal(j.prize.food, undefined);
const st = { cargo: { sugar: 50, spice: 20, rum: 0 }, food: 40 };
applyHold(st, j);
assert.deepEqual(st.cargo, { sugar: 40, spice: 20, rum: 0 }); assert.equal(st.food, 40);
move(j, 'food', 'out', 1e9); applyHold(st, j); assert.equal(st.food, 0);
assert.equal(jettisonPhrase({ sugar: 20 }), '20 hogsheads of sugar overboard');
assert.equal(jettisonPhrase({ food: 1, spice: 3 }), '3 chests of spices and 1 barrel of provisions overboard');
assert.equal(jettisonPhrase({}), '');
console.log('transship OK');
