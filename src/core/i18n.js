// Text helpers for the displayed language (English).
// API:
//   fmtInt(n)                     12,345 (comma thousands separator, − minus sign)
//   fmtNum(n, digits)             1.5
//   NBSP                          U+202F narrow no-break space, between a number and its unit (500 m, 12 kn)
//   q(text)                       “text”
//   a(text)                       'a sloop' / 'an aviso' (indefinite article)
//   nationName(f) / nationAdj(f) / nationPeople(f) / shipType(type) / pointOfSail(internal) / MONTHS
//   shipDesc(faction, type, cap)  'Spanish galleon' (cap=true: first letter upper case)
//   theShip(ship, cap) / ofShip(ship) / theName(name, cap) / ofName(name): ship names with their article
//   ('the Merry Wren', 'of the Merry Wren'); names that carry a foreign article stay bare (“Le Faucon”, “De Hoop”)
import { SHIP_TYPES } from '../data/shipTypes.js';
export const NBSP = ' ';

const EN = {
  nation: { english: 'England', spanish: 'Spain', french: 'France', dutch: 'United Provinces', pirate: 'Brethren of the Coast' },
  adj: { english: 'English', spanish: 'Spanish', french: 'French', dutch: 'Dutch', pirate: 'pirate' },
  people: { english: 'English', spanish: 'Spanish', french: 'French', dutch: 'Dutch', pirate: 'Pirates' },
  ship: {},
  pos: { 'in irons': 'in irons', 'close-hauled': 'close-hauled', 'beam reach': 'beam reach', 'broad reach': 'broad reach', running: 'running' },
  months: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
};
const D = EN;

export const MONTHS = D.months;

export const fmtInt = n => {
  const v = Math.round(+n || 0), s = String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (v < 0 ? '−' : '') + s;
};
export const fmtNum = (n, d = 1) => (+n || 0).toFixed(d);
export const q = s => `“${s}”`;
export const a = s => `${/^[aeiou]/i.test(String(s)) ? 'an' : 'a'} ${s}`;
export const nationName = f => D.nation[f] || f;
export const nationAdj = f => D.adj[f] || f;
export const nationPeople = f => D.people[f] || f;
export const shipType = ty => D.ship[ty] || ty;
export const pointOfSail = p => D.pos[p] || p;
for (const [id, ty] of Object.entries(SHIP_TYPES)) D.ship[id] ||= ty.name;
// 'Spanish galleon', 'pirate sloop' — lower-case type (mid-sentence), cap=true for labels
export function shipDesc(faction, type, cap = false) {
  const n = (type ? shipType(type) : 'ship').toLowerCase();
  const s = faction ? `${nationAdj(faction)} ${n}` : n;
  return cap ? capFirst(s) : s;
}
const named = s => s?.name && s.name !== 'Unnamed';
// a ship's display label: its name, else 'Spanish galleon'
export const shipLabel = s => (named(s) ? s.name : shipDesc(s?.faction, s?.type));
// names that open with their own (French, Spanish, Dutch) article take no 'the'
const FOREIGN_ART = /^(?:(?:le|la|les|el|los|las|de|het)\s+|l['’]\s*|'t\s+)(?=\S)/i;
const capFirst = r => r[0].toUpperCase() + r.slice(1);
// 'the Merry Wren'; “Le Faucon” stays 'Le Faucon' (cap=true at the start of a sentence)
export function theName(name, cap = false) {
  const n = String(name ?? '');
  if (FOREIGN_ART.test(n)) return n;
  return `${cap ? 'The' : 'the'} ${n}`;
}
export const ofName = name => `of ${theName(name)}`;
// 'the Merry Wren' / 'the English frigate'; ofShip -> 'of the Merry Wren' / 'of the English frigate'
export function theShip(s, cap = false) {
  if (named(s)) return theName(s.name, cap);
  return `${cap ? 'The' : 'the'} ${shipLabel(s)}`;
}
export const ofShip = s => `of ${theShip(s)}`;
