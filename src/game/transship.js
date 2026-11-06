// Pure logic of the “Transshipment” panel of the capture screen (no DOM, testable in node).
//   makeManifest(ownCargo, ownFood, prizeCargo, cap) → m { own: {good: qty}, prize: {...}, cap, used0 }
//     own includes 'food' (provisions count in the hold and can be moved like any good).
//   bulkOf(side) → hold units used (same rounding as economy.holdUsed)
//   move(m, good, dir, n) dir 'in' = prize → own, 'out' = own → prize (jettison / leave aboard). Returns moved qty.
//   bestFill(m) resets to the original own hold and loads the prize goods by value per bulk (the legacy auto-fill).
//   canValidate(m) used ≤ cap (or not above what the hold already carried before the capture, if overloaded)
//   valueOf(good, qty) estimated value at the base (average) price.
// Hold at sea (I key, src/ui/holdScreen.js) — the same manifest with an empty "prize": makeManifest(cargo, food,
// {}, cap); move(m, k, 'out', n) puts goods overboard (m.prize = what goes to the sea):
//   takeBack(m, good, n)  back aboard from the jettison pile (no capacity test: it was aboard). Returns moved qty.
//   applyHold(st, m)      writes m.own into state.cargo / state.food (as the capture screen does)
//   jettisonPhrase(lots)  “20 hogsheads of sugar and 5 barrels of provisions overboard”
// Emergency gun jettison: m.guns = { own, out, max } set by withGuns(m, aboard, max); moveGuns(m, n)
//   (n > 0 throws, n < 0 takes back, by GUN_JETTISON.step), applyGuns(upgrades, m) accumulates upgrades.gunsLost (the
//   lost guns follow the ship, like its refits; applyUpgrades() in save.js derives ship.guns and the speed gain),
//   gunSpeedF(lost, max), rearmCost(lost, mul) for the refit, gunsPhrase(n).
import { GOODS } from '../data/world.js';
import { fmtInt } from '../core/i18n.js';

const bulk = k => GOODS[k]?.bulk || 1;
const clean = o => { const r = {}; for (const [k, q] of Object.entries(o || {})) if (q > 0) r[k] = Math.floor(q); return r; };

export function bulkOf(side) {
  let u = 0;
  for (const k in side) u += (side[k] || 0) * bulk(k);
  return Math.ceil(u - 1e-6);
}
export const valueOf = (k, q) => Math.round((GOODS[k]?.basePrice || 0) * (q || 0));
export const density = k => (GOODS[k]?.basePrice || 0) / bulk(k);

export function makeManifest(ownCargo, ownFood, prizeCargo, cap) {
  const own = clean(ownCargo); delete own.food;
  if (ownFood > 0) own.food = Math.floor(ownFood);
  const m = { own, prize: clean(prizeCargo), cap: Math.max(0, cap | 0) };
  m.orig = { own: { ...m.own }, prize: { ...m.prize } };
  m.used0 = bulkOf(m.own);
  return m;
}

export function move(m, k, dir, n = 1) {
  const src = dir === 'in' ? m.prize : m.own, dst = dir === 'in' ? m.own : m.prize;
  let q = Math.min(n, src[k] || 0);
  if (dir === 'in') {   // never load past the hold's capacity
    const room = Math.max(0, m.cap - bulkOf(m.own));
    q = Math.min(q, Math.floor(room / bulk(k) + 1e-6));
  }
  if (q <= 0) return 0;
  src[k] -= q; if (!src[k]) delete src[k];
  dst[k] = (dst[k] || 0) + q;
  return q;
}

export function bestFill(m) {
  m.own = { ...m.orig.own }; m.prize = { ...m.orig.prize };
  const lots = Object.keys(m.prize).sort((a, b) => density(b) - density(a));
  for (const k of lots) move(m, k, 'in', m.prize[k]);
  return m;
}

export const limitOf = m => Math.max(m.cap, m.used0);
export const canValidate = m => bulkOf(m.own) <= limitOf(m);

// rows for the panel: every good on either side, most valuable per bulk first, food last
export function rows(m) {
  const ks = new Set([...Object.keys(m.orig.own), ...Object.keys(m.orig.prize), ...Object.keys(m.own), ...Object.keys(m.prize)]);
  return [...ks].sort((a, b) => (a === 'food') - (b === 'food') || density(b) - density(a));
}

// ---- hold at sea: jettison (touche I) ----
export function takeBack(m, k, n = 1) {
  const q = Math.min(n, m.prize[k] || 0);
  if (q <= 0) return 0;
  m.prize[k] -= q; if (!m.prize[k]) delete m.prize[k];
  m.own[k] = (m.own[k] || 0) + q;
  return q;
}

export function applyHold(st, m) {
  const own = { ...m.own }; st.food = own.food || 0; delete own.food;
  st.cargo = st.cargo || {};
  for (const k of Object.keys(st.cargo)) st.cargo[k] = 0;
  for (const [k, q] of Object.entries(own)) st.cargo[k] = q;
  return st;
}

export function lotPhrase(k, q) {
  const G = GOODS[k] || {}, unit = (q > 1 ? G.unitPl : G.unit) || (q > 1 ? 'lots' : 'lot');
  return `${fmtInt(q)} ${unit} of ${(G.name || k).toLowerCase()}`;
}
export function jettisonPhrase(lots) {
  const parts = rows({ own: {}, prize: lots, orig: { own: {}, prize: lots } }).filter(k => lots[k] > 0).map(k => lotPhrase(k, lots[k]));
  if (!parts.length) return '';
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0];
  return `${list[0].toUpperCase()}${list.slice(1)} overboard`;
}

// ---- emergency gun jettison (to flee) ----
// step: guns thrown per click (one from each side); speed: speed gain when the whole battery is overboard
// (proportional to the guns thrown); price: price of one gun replaced at the refit (× the port's rank privilege).
export const GUN_JETTISON = { step: 2, speed: 0.12, price: 70 };
export function withGuns(m, aboard, max) {
  m.guns = { own: Math.max(0, Math.floor(aboard || 0)), out: 0, max: Math.max(0, Math.floor(max || aboard || 0)) };
  return m;
}
// n > 0: throw n guns (rounded to the step, capped by those left); n < 0: take back. Returns the number moved.
export function moveGuns(m, n) {
  const G = m?.guns; if (!G || !n) return 0;
  const st = GUN_JETTISON.step;
  if (n > 0) { const k = Math.min(G.own, Math.max(st, Math.ceil(n / st) * st)); G.own -= k; G.out += k; return k; }
  const k = Math.min(G.out, Math.max(st, Math.ceil(-n / st) * st)); G.own += k; G.out -= k; return -k;
}
export const gunSpeedF = (lost, max) => 1 + GUN_JETTISON.speed * Math.min(1, Math.max(0, lost || 0) / Math.max(1, max || 1));
export function applyGuns(up, m) {
  const out = m?.guns?.out || 0;
  if (up && out > 0) up.gunsLost = Math.min(m.guns.max, (up.gunsLost || 0) + out);
  return out;
}
export const rearmCost = (lost, mul = 1) => Math.round(Math.max(0, lost || 0) * GUN_JETTISON.price * mul);
export const gunsPhrase = n => `${fmtInt(n)}${'\u00a0'}gun${n > 1 ? 's' : ''}`;
