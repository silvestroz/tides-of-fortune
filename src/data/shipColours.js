// The ship's colours (2026-11-21): paint (cosmetic, the shipyard's "Colours" card) and the flag she sails under
// (gameplay: how the world treats the player). Pure data and helpers, no DOM.
//
// Paint: state.paint = { hull, trim, sails } of the flagship (hex, hex, SAILS id), absent/null = the colours of the
// captain's nation (state.nationality); each squadron ship keeps its own in state.fleet[i].paint (swapFlagship
// carries them). The hull shader recolours the paint band and the trim of the player's ships (ShipModel.setPaint):
// the geometry and skin caches stay per type|faction, never per custom paint.
//   PAINT                  tuning: presets (nations, pirate black), curated palette, sail cloths, prices, yard time
//   defaultPaint(nation)   the nation's preset as { hull, trim, sails }
//   paintOf(p, nation)     resolved paint of a record (state.paint or a fleet entry): its own, else the nation's
//   playerPaint(state, fb?) resolved paint of the flagship
//   paintLook(p)           a resolved paint as ShipModel.setPaint takes it (sail cloth as a colour)
//   samePaint(a, b)        true when two resolved paints are identical
//   repaintCost(p0, p1, type)   gold for going from p0 to p1 on a ship of that type ({ hull, sails, total })
//
// Flag: state.flag = 'nation' (default) | 'pirate'. The player's Ship.faction is the flag: state.nationality under
// national colours, 'pirate' under the black (factions.isHostile, ports.attitude, living, career all read it).
// state.nationality stays the captain's origin. state.flagSince = day number the black was hoisted.
//   FLAG                   tuning: hoisting and pardon penalties
//   playerFaction(state)   the faction the flagship sails under
//   pardonCost(state, foreign)   gold of the pardon (grows with the days spent under the black)
import { FACTION_PAINT, FACTION_TRIM } from '../ships/art/configs.js';
import { SHIP_TYPES } from './shipTypes.js';

export const PAINT = {
  presets: [   // whole schemes (hull + trim), the nations' liveries and the pirates' pitch
    { id: 'english', name: 'English red and gold', hull: FACTION_PAINT.english, trim: FACTION_TRIM.english },
    { id: 'spanish', name: 'Spanish ochre and red', hull: FACTION_PAINT.spanish, trim: FACTION_TRIM.spanish },
    { id: 'french', name: 'French blue and gold', hull: FACTION_PAINT.french, trim: FACTION_TRIM.french },
    { id: 'dutch', name: 'Dutch blue and orange', hull: FACTION_PAINT.dutch, trim: FACTION_TRIM.dutch },
    { id: 'pirate', name: 'Black as pitch', hull: FACTION_PAINT.pirate, trim: FACTION_TRIM.pirate },
  ],
  palette: [   // pigments a colonial yard keeps in its paint store (for the band and for the trim)
    { hex: '#9a2b22', name: 'Venetian red' },
    { hex: '#5e1e1a', name: 'Oxblood' },
    { hex: '#a4502e', name: 'Red ochre' },
    { hex: '#c8962e', name: 'Yellow ochre' },
    { hex: '#d0a640', name: 'Gilt yellow' },
    { hex: '#3f7a62', name: 'Verdigris' },
    { hex: '#2f4a32', name: 'Spruce green' },
    { hex: '#2f4f86', name: 'Smalt blue' },
    { hex: '#22355e', name: 'Navy blue' },
    { hex: '#d9d2c0', name: 'Lead white' },
    { hex: '#5a4630', name: 'Raw umber' },
    { hex: '#1c1a18', name: 'Lamp black' },
  ],
  sails: {   // sail cloth (re-tints the canvas)
    white: { name: 'White canvas', hex: '#f4ead6' },
    tanned: { name: 'Tanned', hex: '#a8714a' },
    black: { name: 'Black', hex: '#34302c' },
  },
  price: { hull: 260, sails: 420, refHull: 120 },   // gold for a brig (hull 120); scaled by the ship's hull points
  hours: 24,   // the painters' day in the yard (the calendar moves on)
};

export const FLAG = {
  hoistRepOwn: -35,       // reputation with the captain's own nation for hoisting the black
  hoistRepOther: -15,     // ... with every other nation
  pirateWelcome: 20,      // the Brethren of the Coast take you in (reputation with the pirates, at least pirateFloor)
  pirateFloor: 5,
  pardonBase: 800,        // gold, at a port of the captain's nation
  pardonPerDay: 12,       // gold per day spent under the black
  pardonMax: 4000,
  pardonForeignK: 1.5,    // a friendly nation's governor asks more to vouch for a foreign captain
  pardonPirateRep: -30,   // the Brethren do not forgive a turncoat
  pardonHours: 72,        // three days while the clerks draw up the papers
};

const DAY = d => d ? d.year * 372 + d.month * 31 + d.day : 0;
const HEX = /^#[0-9a-f]{6}$/i;

export function defaultPaint(nation) {
  const p = PAINT.presets.find(x => x.id === nation) || PAINT.presets[0];
  return { hull: p.hull, trim: p.trim, sails: 'white' };
}
export function paintOf(p, nation) {
  const d = defaultPaint(nation);
  if (!p) return d;
  return { hull: HEX.test(p.hull) ? p.hull : d.hull, trim: HEX.test(p.trim) ? p.trim : d.trim, sails: PAINT.sails[p.sails] ? p.sails : d.sails };
}
export const playerPaint = (st, fb) => paintOf(st?.paint, st?.nationality || (fb !== 'pirate' && fb) || 'english');   // fb: the ship's faction (showcases without a nationality)
export const samePaint = (a, b) => !!a && !!b && a.hull.toLowerCase() === b.hull.toLowerCase() && a.trim.toLowerCase() === b.trim.toLowerCase() && a.sails === b.sails;
// the resolved paint as the ship model takes it (sail cloth as a colour)
export const paintLook = p => p && { hull: p.hull, trim: p.trim, sails: PAINT.sails[p.sails]?.hex || PAINT.sails.white.hex };

export function repaintCost(p0, p1, type) {
  const k = (SHIP_TYPES[type]?.hull || PAINT.price.refHull) / PAINT.price.refHull;
  const hull = p0.hull.toLowerCase() !== p1.hull.toLowerCase() || p0.trim.toLowerCase() !== p1.trim.toLowerCase() ? Math.round(PAINT.price.hull * k / 10) * 10 : 0;
  const sails = p0.sails !== p1.sails ? Math.round(PAINT.price.sails * k / 10) * 10 : 0;
  return { hull, sails, total: hull + sails };
}

export const playerFaction = st => st?.flag === 'pirate' ? 'pirate' : (st?.nationality || 'english');
export const daysUnderBlack = st => st?.flag === 'pirate' ? Math.max(0, DAY(st.date) - (st.flagSince ?? DAY(st.date))) : 0;
export function pardonCost(st, foreign = false) {
  const g = Math.min(FLAG.pardonMax, FLAG.pardonBase + daysUnderBlack(st) * FLAG.pardonPerDay);
  return Math.round(g * (foreign ? FLAG.pardonForeignK : 1) / 10) * 10;
}
export const dayNum = DAY;
