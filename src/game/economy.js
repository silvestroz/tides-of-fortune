// Market model. Each port keeps a live market in game.state.markets[portId] = { [good]: { stock, eq } }.
//   eq    equilibrium stock (from the port's supply profile)
//   stock current stock; buying lowers it (price rises), selling raises it (price falls). Drifts back to eq daily.
// API:
//   CARGO_CAPACITY[type]                 hold size (bulk units) per ship type
//   SHIP_PRICES[type]                    shipyard list price
//   ensureMarket(game, port)             -> market object (creates on first visit)
//   quote(game, port, good)              -> { buy, sell, stock, eq, trend } (gold per unit; trend -1..1, + = dear)
//   holdUsed(game) / holdCapacity(game)  bulk units used / available (food counts as provisions)
//   buy(game, port, good, qty)           -> qty actually bought (limited by gold, stock, hold); emits 'trade' {port, good, qty, price, side:'buy'}
//   sell(game, port, good, qty)          -> qty sold; tracks profit in state.ledger
//   tickMarkets(game, days)              markets recover toward equilibrium
//   bestRoutes(game, n)                  -> [{ good, from, to, margin }] richest buy-low/sell-high pairs (rumours)
import { GOODS } from '../data/world.js';
import { privileges } from './career.js';
import { MARKETS } from '../data/living.js';
import { mulberry32, hashString } from '../core/rng.js';

export const CARGO_CAPACITY = { sloop: 40, schooner: 60, brig: 90, merchantman: 210, frigate: 140, galleon: 260 };
export const SHIP_PRICES = { sloop: 2400, schooner: 3800, brig: 6200, merchantman: 5400, frigate: 14500, galleon: 21000 };

import { SHIP_TYPES } from '../data/shipTypes.js';
for (const [id, t] of Object.entries(SHIP_TYPES)) { CARGO_CAPACITY[id] = t.cargo; SHIP_PRICES[id] = t.price; }   // 27 types

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function portGoods(port) {
  // port.goods from world.js: { good: { price, supply, demand } }; fall back to neutral
  const out = {};
  for (const g in GOODS) out[g] = port?.goods?.[g] || { price: GOODS[g].basePrice, supply: 0.3, demand: 0.4 };
  return out;
}

function baseEq(port, g, pg = portGoods(port)) {
  const scale = { small: 0.6, medium: 1, large: 1.5 }[port.size] || 1;
  return Math.round((8 + pg[g].supply * 110) * scale / (GOODS[g].bulk || 1));
}
// Provisions follow the town's population (state.towns → port.population): a large town feeds a crew of 120
// for a dozen days (formerly ~60 barrels, two days); villages unchanged
export function foodEq(port) {
  return baseEq(port, 'food') + (port.village ? 0 : Math.round((port.population || 0) * MARKETS.foodPerPop));
}

export function ensureMarket(game, port) {
  const st = game.state;
  st.markets ||= {};
  if (!st.markets[port.id]) {
    const m = {};
    const pg = portGoods(port);
    for (const g in pg) {
      const eq = g === 'food' ? foodEq(port) : baseEq(port, g, pg);
      m[g] = { stock: eq, eq };
    }
    st.markets[port.id] = m;
  } else if (!port.village) {
    // provisions equilibrium re-based on today's population (epidemic, raid, boom); a rise fills the granaries
    // at once (old saves: markets created with ~60 barrels)
    const f = st.markets[port.id].food, fe = foodEq(port);
    if (f && f.eq !== fe) { if (fe > f.eq) f.stock += fe - f.eq; f.eq = fe; }
  }
  return st.markets[port.id];
}

export function quote(game, port, good) {
  const m = ensureMarket(game, port)[good];
  const pg = portGoods(port)[good];
  const ratio = (m.eq + 6) / (m.stock + 6);
  let mid = pg.price * Math.pow(ratio, 0.45);
  if (port.haven) mid *= havenSwing(game, port, good);   // pirate havens' prices swing week to week
  const wit = (game.state.skill === 'wit' ? 0.03 : 0) + (port.haven ? 0 : privileges(game.state, port.faction).priceEdge);   // rank privilege
  const buy = Math.max(1, Math.round(mid * (1.08 - wit)));
  const sell = Math.max(1, Math.round(mid * (0.9 + wit)));
  return { buy, sell, stock: m.stock, eq: m.eq, trend: clamp(Math.log(ratio) * 2, -1, 1), base: GOODS[good].basePrice };
}

// weekly price factor of a good in a pirate haven (deterministic per port, good and week), 1 ± MARKETS.havenSwing
export function havenSwing(game, port, good) {
  const d = game.state.date, wk = ((d.year * 372 + d.month * 31 + d.day) / 7) | 0;
  const r = mulberry32((hashString(port.id + ':' + good) ^ (wk * 2654435761)) >>> 0)();
  return 1 + (r * 2 - 1) * MARKETS.havenSwing;
}

export function holdUsed(game) {
  const c = game.state.cargo || {};
  let u = 0;
  for (const g in c) u += (c[g] || 0) * (GOODS[g]?.bulk || 1);
  u += (game.state.food || 0) * GOODS.food.bulk;
  return Math.ceil(u);
}
export function holdCapacity(game) {
  const t = game.player?.type || game.state.shipType || 'brig';
  return Math.round((CARGO_CAPACITY[t] || 90) * (1 + 0.15 * (game.state.upgrades?.hold || 0)));
}

export function buy(game, port, good, qty) {
  const st = game.state, m = ensureMarket(game, port)[good];
  let n = 0, spent = 0;
  const bulk = GOODS[good].bulk || 1;
  while (n < qty && m.stock > 0) {
    const q = quote(game, port, good);
    if (st.gold < q.buy) break;
    if (holdUsed(game) + bulk > holdCapacity(game) + 1e-6) break;
    st.gold -= q.buy; spent += q.buy; m.stock--; n++;
    if (good === 'food') st.food = (st.food || 0) + 1;
    else st.cargo[good] = (st.cargo[good] || 0) + 1;
  }
  if (n) {
    st.ledger ||= { cost: {}, profit: 0, spent: 0, earned: 0 };
    if (good !== 'food') st.ledger.cost[good] = (st.ledger.cost[good] || 0) + spent;
    st.ledger.spent += spent;
    game.events.emit('trade', { port, good, qty: n, price: Math.round(spent / n), side: 'buy' });
  }
  return n;
}

// average price paid per unit still in the hold (for profit tracking)
export function avgCost(game, good) {
  const have = good === 'food' ? game.state.food : game.state.cargo?.[good];
  const c = game.state.ledger?.cost?.[good];
  return have && c ? c / have : 0;
}

export function sell(game, port, good, qty) {
  const st = game.state, m = ensureMarket(game, port)[good];
  let n = 0, got = 0;
  const avg = avgCost(game, good);
  while (n < qty) {
    const have = good === 'food' ? st.food : st.cargo[good] || 0;
    if (have <= 0) break;
    const q = quote(game, port, good);
    st.gold += q.sell; got += q.sell; m.stock++; n++;
    if (good === 'food') st.food--; else st.cargo[good]--;
  }
  if (n) {
    st.ledger ||= { cost: {}, profit: 0, spent: 0, earned: 0 };
    const basis = avg * n;
    if (good !== 'food') st.ledger.cost[good] = Math.max(0, (st.ledger.cost[good] || 0) - basis);
    if (!st.cargo[good]) delete st.cargo[good];
    st.ledger.profit += got - basis; st.ledger.earned += got;
    st.plunder = (st.plunder || 0) + Math.max(0, got - basis) * 0.5;   // trade profit counts half toward the crew's share
    game.events.emit('trade', { port, good, qty: n, price: Math.round(got / n), side: 'sell', profit: Math.round(got - basis) });
  }
  return n;
}

export function tickMarkets(game, days = 1) {
  const ms = game.state.markets; if (!ms) return;
  const k = 1 - Math.pow(0.93, days);
  for (const id in ms) for (const g in ms[id]) {
    const e = ms[id][g];
    e.stock = Math.round(e.stock + (e.eq - e.stock) * k);
  }
}

export function bestRoutes(game, n = 4) {
  const ports = (game.islands?.ports || []).filter(p => !p.haven);
  const out = [];
  for (const g in GOODS) {
    if (g === 'food') continue;
    let lo = null, hi = null;
    for (const p of ports) {
      const pr = portGoods(p)[g].price;
      if (!lo || pr < lo.pr) lo = { p, pr };
      if (!hi || pr > hi.pr) hi = { p, pr };
    }
    if (lo && hi && lo.p !== hi.p) out.push({ good: g, from: lo.p, to: hi.p, margin: hi.pr - lo.pr, ratio: hi.pr / lo.pr });
  }
  return out.sort((a, b) => b.ratio - a.ratio).slice(0, n);
}
