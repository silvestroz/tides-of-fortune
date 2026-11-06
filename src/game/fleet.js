// Pure logic of the squadron kept at anchor (state.fleet), no DOM, testable in node: node tools/test-fleet.mjs
// state.fleet[i] = { type, name, hull (0–1), sails (0–1), from (nation), own? (a former flagship, not a prize),
//   crew (men aboard), upgrades {guns, hull,
//   hold, sheath, canvas, berths}, cargo? {good: qty, food?}, costs? {good: price basis} }   (7 ships at most)
// The flagship is the player's Ship; its hold is state.cargo + state.food, its refits state.upgrades, its price basis
// state.ledger.cost (economy.avgCost). Functions take a `flag` descriptor of the flagship where they need it:
//   { type, name, faction, hull (0–1), sails, crew, crewMax }   (crew mutated in place by the men transfers)
// API:
//   ensureFleet(state)            defaults for old saves (crew 0, no refits, sails 1, cargo {}); returns state.fleet
//   hullMaxOf / crewMaxOf / holdCapOf(type, upgrades)    same formulas as applyUpgrades() / holdCapacity()
//   holdUsedOf(entry)             hold units used aboard (transship.bulkOf)
//   salePrice(entry)              shipyard price: SHIP_PRICES × 0,55 × (0,4 + 0,6 × hull) (= ports.shipTradeIn)
//   repairCost(entry, repairMul)  { hull, sails, free } (= ports.repairCost, rank privilege repairMul 1 / 0,5 / 0)
//   repairShip(state, i, repairMul)          pays what the purse allows (partial refit like ports.repair)
//   sellShip(state, i, { priceOf, flag })    ship + cargo (cargo at FLEET.cargoK × priceOf); men aboard go back to
//                                            the flagship as far as its berths allow, the others stay ashore
//   swapFlagship(state, i, flag)  → new flagship record; the old flagship takes slot i with its hull, refits, the men
//                                   who do not fit aboard the new one and the goods that exceed the new hold
//   transferGoods(state, i, good, dir, n, flagCap)   dir 'in' = to the flagship, 'out' = to ship i (both holds capped)
//   transferMen(state, i, dir, n, flag)              same directions; the flagship keeps FLEET.minFlagCrew men
import { SHIP_TYPES } from '../data/shipTypes.js';
import { GOODS } from '../data/world.js';
import { SHIP_PRICES, CARGO_CAPACITY } from './economy.js';
import { NO_UPGRADES } from './save.js';
import { makeManifest, move, bulkOf, density } from './transship.js';

export const FLEET = { max: 7, sellK: 0.55, cargoK: 0.8, minFlagCrew: 6 };

const clamp01 = v => Math.max(0, Math.min(1, Number.isFinite(+v) ? +v : 1));
const clean = o => { const r = {}; for (const [k, q] of Object.entries(o || {})) if (q > 0 && GOODS[k]) r[k] = Math.floor(q); return r; };
const ups = u => ({ ...NO_UPGRADES(), ...(u || {}) });

export function ensureFleet(st) {
  if (!st) return [];
  st.fleet = Array.isArray(st.fleet) ? st.fleet.filter(f => f && SHIP_TYPES[f.type]) : [];
  for (const f of st.fleet) {
    f.name ||= SHIP_TYPES[f.type].name;
    f.hull = clamp01(f.hull ?? 1);
    f.sails = clamp01(f.sails ?? 1);
    f.crew = Math.max(0, Math.round(+f.crew || 0));
    f.upgrades = ups(f.upgrades);
    f.cargo = clean(f.cargo);
    if (f.costs) for (const k of Object.keys(f.costs)) if (!f.cargo[k]) delete f.costs[k];
  }
  return st.fleet;
}

export const hullMaxOf = (type, u) => Math.round((SHIP_TYPES[type]?.hull || 120) * Math.pow(1.1, u?.hull || 0));
export const crewMaxOf = (type, u) => Math.round((SHIP_TYPES[type]?.crew || 120) * (1 + (u?.berths || 0) * 0.1));
export const holdCapOf = (type, u) => Math.round((CARGO_CAPACITY[type] || 90) * (1 + 0.15 * (u?.hold || 0)));
export const holdUsedOf = f => bulkOf(f?.cargo || {});

export const salePrice = f => Math.round((SHIP_PRICES[f.type] || 4000) * FLEET.sellK * (0.4 + 0.6 * clamp01(f.hull)));

export function repairCost(f, repairMul = 1) {
  const hm = hullMaxOf(f.type, f.upgrades), k = repairMul;
  return { hull: Math.round(hm * (1 - clamp01(f.hull)) * 6 * k), sails: Math.round((1 - clamp01(f.sails ?? 1)) * hm * 3 * k), free: k === 0 };
}

export function repairShip(st, i, repairMul = 1) {
  const f = ensureFleet(st)[i]; if (!f) return null;
  const rc = repairCost(f, repairMul);
  if (rc.free) { const done = f.hull < 1 || f.sails < 1; f.hull = 1; f.sails = 1; return { spent: 0, f: done ? 1 : 0, free: true }; }
  const c = rc.hull + rc.sails;
  if (c <= 0) return { spent: 0, f: 0 };
  const k = Math.max(0, Math.min(1, (st.gold || 0) / c)), spent = Math.round(c * k);
  st.gold -= spent;
  f.hull += (1 - f.hull) * k; f.sails += (1 - f.sails) * k;
  if (k >= 1) { f.hull = 1; f.sails = 1; }
  return { spent, f: k };
}

export function sellShip(st, i, { priceOf, flag } = {}) {
  const f = ensureFleet(st)[i]; if (!f) return null;
  const ship = salePrice(f);
  let cargo = 0;
  for (const [k, q] of Object.entries(f.cargo)) cargo += Math.round(q * (priceOf ? priceOf(k) : GOODS[k]?.basePrice || 0) * FLEET.cargoK);
  const menBack = flag ? Math.max(0, Math.min(f.crew, (flag.crewMax || 0) - (flag.crew || 0))) : 0;
  if (flag) flag.crew = (flag.crew || 0) + menBack;
  st.fleet.splice(i, 1);
  st.gold = (st.gold || 0) + ship + cargo;
  return { ship, cargo, gold: ship + cargo, menBack, menAshore: f.crew - menBack, entry: f };
}

// price basis (ledger.cost of the flagship, entry.costs of a fleet ship) follows the goods: pooled per good and
// shared back in proportion to the quantities on each side after the move
function rebase(st, f, before) {
  st.ledger ||= { cost: {}, profit: 0, spent: 0, earned: 0 };
  const L = st.ledger.cost ||= {};
  f.costs ||= {};
  for (const k of Object.keys(before)) {
    if (k === 'food') continue;
    const B = (L[k] || 0) + (f.costs[k] || 0); if (!B) continue;
    const a = st.cargo?.[k] || 0, b = f.cargo?.[k] || 0, Q = a + b;
    if (!Q) { delete L[k]; delete f.costs[k]; continue; }
    L[k] = B * a / Q; f.costs[k] = B * b / Q;
    if (!f.costs[k]) delete f.costs[k];
  }
  if (!Object.keys(f.costs).length) delete f.costs;
}
// write a manifest back: own → flagship hold (state.cargo in place + state.food), prize → fleet ship i
function writeBack(st, f, m) {
  st.cargo ||= {};
  const own = { ...m.own }; st.food = own.food || 0; delete own.food;
  for (const k of Object.keys(st.cargo)) if (!own[k]) delete st.cargo[k];
  Object.assign(st.cargo, own);
  f.cargo = { ...m.prize };
}
const goodsOf = (st, f) => { const r = {}; for (const k of [...Object.keys(st.cargo || {}), ...Object.keys(f.cargo || {})]) r[k] = 1; return r; };

export function transferGoods(st, i, k, dir, n, flagCap) {
  const f = ensureFleet(st)[i]; if (!f || !GOODS[k] || !(n > 0)) return 0;
  const m = makeManifest(st.cargo, st.food, f.cargo, flagCap);
  if (dir === 'out') {   // the fleet ship's hold is capped too (transship.move only caps the 'in' side)
    const room = Math.max(0, holdCapOf(f.type, f.upgrades) - bulkOf(m.prize));
    n = Math.min(n, Math.floor(room / (GOODS[k].bulk || 1) + 1e-6));
  }
  const before = goodsOf(st, f);
  const q = move(m, k, dir === 'out' ? 'out' : 'in', n);
  if (q) { writeBack(st, f, m); rebase(st, f, before); }
  return q;
}

export function transferMen(st, i, dir, n, flag) {
  const f = ensureFleet(st)[i]; if (!f || !flag || !(n > 0)) return 0;
  const q = dir === 'out'
    ? Math.max(0, Math.min(n, (flag.crew || 0) - FLEET.minFlagCrew, crewMaxOf(f.type, f.upgrades) - f.crew))
    : Math.max(0, Math.min(n, f.crew, (flag.crewMax || 0) - (flag.crew || 0)));
  if (!q) return 0;
  if (dir === 'out') { flag.crew -= q; f.crew += q; } else { flag.crew += q; f.crew -= q; }
  return q;
}

export function swapFlagship(st, i, flag) {
  const f = ensureFleet(st)[i]; if (!f || !flag) return null;
  const nu = ups(f.upgrades), oldUp = ups(st.upgrades);
  // men: all hands of both ships go to the new flagship up to its berths; the others stay with the old one
  const men = Math.round(flag.crew || 0) + f.crew, crew = Math.min(crewMaxOf(f.type, nu), men);
  // hold: the new flagship keeps its own goods and takes the flagship's hold up to its capacity, provisions first,
  // then the most valuable goods per bulk; what does not fit stays aboard the old flagship
  const fc = { ...f.cargo }, ffood = fc.food || 0; delete fc.food;
  const m = makeManifest(fc, ffood, { ...(st.cargo || {}), ...(st.food > 0 ? { food: st.food } : {}) }, holdCapOf(f.type, nu));
  move(m, 'food', 'in', m.prize.food || 0);
  for (const k of Object.keys(m.prize).sort((a, b) => density(b) - density(a))) move(m, k, 'in', m.prize[k]);
  // price basis: goods that stay on the old flagship keep theirs (pooled per good like a transfer)
  st.ledger ||= { cost: {}, profit: 0, spent: 0, earned: 0 };
  const L = st.ledger.cost ||= {}, B = {};
  for (const k of new Set([...Object.keys(L), ...Object.keys(f.costs || {})])) B[k] = (L[k] || 0) + (f.costs?.[k] || 0);
  const old = { type: flag.type, name: flag.name, hull: clamp01(flag.hull), sails: clamp01(flag.sails ?? 1), from: flag.faction || f.from, own: true, crew: men - crew, upgrades: oldUp, cargo: {} };
  writeBack(st, old, m);
  for (const [k, b] of Object.entries(B)) {
    const a = st.cargo[k] || 0, c = old.cargo[k] || 0, Q = a + c;
    if (Q && b) { L[k] = b * a / Q; if (c) (old.costs ||= {})[k] = b * c / Q; } else delete L[k];
    if (!L[k]) delete L[k];
  }
  st.fleet[i] = old;
  st.upgrades = nu;
  return { type: f.type, name: f.name, hull: f.hull, sails: f.sails, crew, upgrades: nu, from: f.from, left: { ...old.cargo } };
}
