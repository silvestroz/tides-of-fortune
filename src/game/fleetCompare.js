// Comparing the ships of the squadron in port (shipyard): effective stats with refits, the comparison table, and
// the preview of a flagship swap. Pure logic, no DOM, testable in node: node tools/test-fleet.mjs
// API:
//   shipStats(type, upgrades, cond?)   effective stats of a squadron ship (same formulas as applyUpgrades() /
//                                      holdCapacity() / fleet.hullMaxOf…): { type, cls, guns, gunPower, hullMax,
//                                      crewMax, hold, speed (knots), draught (m), rig, refits, hullPct, sailsPct }
//   flagStats(player, upgrades, hold)  the same record for the flagship, read from the live Ship (p.hullMax,
//                                      p.crewMax, p.guns, p.speedMul) and holdCapacity(game)
//   COMPARE_ROWS                       rows of the comparison table { k, label, unit?, best: 'high'|'low'|null }
//   bestOf(cols, row)                  Set of column indices holding the best value of a row (empty when all equal)
//   flagshipPreview(st, i, flag)       what fleet.swapFlagship would do, run on a copy of the state:
//                                      { cur, next, deltas[], crew, menLeft, left {good: qty}, lotsLeft }
import { SHIP_TYPES, classOf } from '../data/shipTypes.js';
import { SHIP_SPECS } from '../ships/shipModel.js';
import { NO_UPGRADES } from './save.js';
import { gunSpeedF } from './transship.js';
import { hullMaxOf, crewMaxOf, holdCapOf, swapFlagship } from './fleet.js';

export const KNOTS = 1.944;   // m/s → knots, as the shipyard specs
const REFIT_IDS = Object.keys(NO_UPGRADES());
const RIG = { square: 'square', 'fore-aft': 'fore-and-aft', mixed: 'mixed' };
const pct = v => Math.round(Math.max(0, Math.min(1, Number.isFinite(+v) ? +v : 1)) * 100);
export const refitCount = u => REFIT_IDS.reduce((a, k) => a + (u?.[k] || 0), 0);

function base(type, u) {
  const sp = SHIP_SPECS[type] || SHIP_SPECS.brig;
  return { type, cls: classOf(type), draught: sp.navDraft ?? sp.draft, rig: RIG[SHIP_TYPES[type]?.rig] || '—', refits: refitCount(u), gunPower: 1 + (u?.guns || 0) * 0.15 };
}

export function shipStats(type, u = {}, cond = {}) {
  const sp = SHIP_SPECS[type] || SHIP_SPECS.brig, lost = u?.gunsLost || 0;
  return {
    ...base(type, u),
    guns: Math.max(0, (sp.guns || 0) - lost),
    hullMax: hullMaxOf(type, u),
    crewMax: crewMaxOf(type, u),
    hold: holdCapOf(type, u),
    speed: Math.round(sp.maxSpeed * (1 + (u?.canvas || 0) * 0.06) * gunSpeedF(lost, sp.guns) * KNOTS),
    hullPct: pct(cond.hull), sailsPct: pct(cond.sails),
  };
}

export function flagStats(p, u = {}, hold) {
  if (!p) return null;
  const sp = p.spec || SHIP_SPECS[p.type] || SHIP_SPECS.brig;
  return {
    ...base(p.type, u),
    guns: p.guns ?? sp.guns,
    hullMax: Math.round(p.hullMax),
    crewMax: Math.round(p.crewMax),
    hold: hold ?? holdCapOf(p.type, u),
    speed: Math.round(sp.maxSpeed * (p.speedMul ?? 1) * KNOTS),
    hullPct: pct(p.hull / Math.max(1, p.hullMax)), sailsPct: pct(p.sails),
  };
}

export const COMPARE_ROWS = [
  { k: 'cls', label: 'Class', best: 'high' },
  { k: 'guns', label: 'Guns', best: 'high' },
  { k: 'hullMax', label: 'Hull', best: 'high' },
  { k: 'crewMax', label: 'Crew', best: 'high' },
  { k: 'hold', label: 'Hold', best: 'high' },
  { k: 'speed', label: 'Speed', unit: ' kn', best: 'high' },
  { k: 'draught', label: 'Draught', unit: ' m', best: 'low' },
  { k: 'rig', label: 'Rig', best: null },
  { k: 'refits', label: 'Refits', best: 'high' },
  { k: 'hullPct', label: 'Condition: hull', unit: '%', best: 'high' },
  { k: 'sailsPct', label: 'Condition: sails', unit: '%', best: 'high' },
];

export function bestOf(cols, row) {
  const r = typeof row === 'string' ? COMPARE_ROWS.find(x => x.k === row) : row, out = new Set();
  if (!r?.best || cols.length < 2) return out;
  const vs = cols.map(c => +c[r.k]), top = r.best === 'low' ? Math.min(...vs) : Math.max(...vs);
  if (vs.every(v => v === top)) return out;
  vs.forEach((v, i) => { if (v === top) out.add(i); });
  return out;
}

// the stats a flagship swap changes, in the preview: [label, current, new, unit, lower is better]
const KEY = [['cls', 'Class'], ['guns', 'Guns'], ['hullMax', 'Hull'], ['crewMax', 'Crew'], ['hold', 'Hold'], ['speed', 'Speed', ' kn'], ['draught', 'Draught', ' m', true]];

export function flagshipPreview(st, i, flag, cur) {
  const f = st?.fleet?.[i]; if (!f || !flag) return null;
  // dry run of the real rule on a copy: men, goods and price basis follow exactly what fleetFlagship will do
  const copy = { fleet: structuredClone(st.fleet), cargo: { ...(st.cargo || {}) }, food: st.food || 0, upgrades: { ...(st.upgrades || {}) }, ledger: structuredClone(st.ledger || { cost: {} }) };
  const r = swapFlagship(copy, i, { ...flag });
  if (!r) return null;
  const next = shipStats(f.type, f.upgrades, f);
  const left = {}; for (const [k, q] of Object.entries(r.left || {})) if (q > 0) left[k] = q;
  return {
    cur, next,
    deltas: cur ? KEY.map(([k, label, unit, low]) => ({ k, label, unit: unit || '', low: !!low, a: cur[k], b: next[k], d: +(next[k] - cur[k]).toFixed(1) })) : [],
    crew: r.crew, men: Math.round(flag.crew || 0) + (f.crew || 0), menLeft: copy.fleet[i].crew,
    left, lotsLeft: Object.values(left).reduce((a, q) => a + q, 0),
  };
}
