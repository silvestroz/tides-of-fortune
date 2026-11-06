// Settings, names and original texts of the missions offered at the palace (career.offerMissions). Logic in
// src/game/career.js (offerMissions, accept, _updateMissions, _onPort, missionTargets); chart: “Missions” layer
// of src/ui/map/worldMap.js. Nothing here imports CSS or the DOM: career.js stays importable in node.
// Types (m.kind): deliver (dispatches), hunt (a rover / harass a nation), escort, envoy (messenger, living.js),
//   transport (goods supplied, to deliver), quarry (named captain to bring down), scout (reconnoitre a port),
//   rescue (castaways on an islet).
import { NBSP, MONTHS, shipType } from '../core/i18n.js';

export const MISSIONS = {
  maxActive: 3,
  offers: [3, 4],            // missions offered by a governor (all of different types)
  failRep: -6,               // reputation lost on failure (deadline passed, ship lost…)
  minDist: 1500,             // m: no destination closer than this to the port of origin
  // deadlines (playtest feedback: "3 days for dispatches was very hard"): measured, a brig under full sail makes
  // ~25 m/s world speed on a beam reach (~6 km per 4-minute day) but only ~9 m/s of progress beating upwind
  // (~2.2 km per day); we count 2.4 km of straight line per day + 1.5 days of margin: an upwind route stays doable.
  perDay: 2400,              // m of straight line counted per calendar day (tacking, detours, calls)
  slack: 1.5,                // days added to every deadline (leaving port, entering the destination port)
  oldBonus: 2,               // days given back, once, to missions accepted before these deadlines (save without missionDelays)
  deep: 6,                   // m: minimum depth of meeting points (hunting zone, castaways): no reef, no bank
  // draw weights of the offers (without replacement: a governor never offers two missions of the same type)
  weights: { deliver: 0.9, hunt: 1.1, escort: 0.9, transport: 1.1, quarry: 1, scout: 0.9, rescue: 0.8 },
  deliver: { days: [4, 9] },
  escort: { days: [4, 10], slack: 2.5 },   // the escorted merchant is slow
  hunt: { pirateDays: 6, nationDays: 8 },
  transport: { days: [4, 10], reward: [850, 1250], perKm: 45, rep: 7, merit: 2, theftRep: -12, minDist: 2200 },
  quarry: {
    days: [5, 9], rep: 12, merit: 4, smugglerShare: 0.4,
    reward: { pirate: [2600, 3800], smuggler: [1800, 2700] },
    spawnRange: 2400,        // m: the captain puts to sea when the player approaches the zone
    zoneR: 900,              // m: cruising radius around the given place (circle on the chart)
    minDist: 2200, maxDist: 10500,
    // ships per rank bracket with the nation (0–2, 3–5, 6+)
    types: { pirate: [['sloop', 'schooner', 'brigantine'], ['topschooner', 'brig', 'cutter'], ['raider', 'snow', 'brig']],
      smuggler: [['ketch', 'lugger', 'schooner'], ['schooner', 'brigantine', 'topschooner'], ['topschooner', 'brigantine', 'cutter']] },
    crewF: { pirate: 0.95, smuggler: 0.7 }, gunPower: 1.08, duel: [0.5, 0.68],
  },
  scout: { days: [4, 10], reward: [800, 1200], perKm: 30, rep: 7, merit: 2.5, near: 600, minDist: 2000 },
  rescue: { days: [4, 9], reward: [650, 1050], men: [6, 14], rep: 6, merit: 2, near: 400, minDist: 1800, maxDist: 9500 },
};

// transport cargoes: good = key of GOODS (src/data/world.js), quantity drawn within qty
export const CARGOES = [
  { good: 'arms', qty: [8, 14], title: 'Powder and muskets for {to}',
    text: `The {to} garrison is short of everything. Load {qty} and deliver them to the commander of the place before {date}.` },
  { good: 'timber', qty: [10, 16], title: 'Building timber for {to}',
    text: `They are raising the walls of {to}: {qty} are waiting on the quay. Deliver them before {date}; the master builder will pay on arrival.` },
  { good: 'cloth', qty: [14, 22], title: 'Cloth for the {to} uniforms',
    text: `The soldiers of {to} stand guard in rags. Bring them {qty} before {date}.` },
  { good: 'salt', qty: [14, 22], title: 'Salt for the {to} salting houses',
    text: `Without salt, {to} will have no meat for the winter. Load {qty} and deliver them before {date}.` },
  { good: 'silver', qty: [4, 7], title: 'The pay of the {to} garrison', bonus: 300,
    text: `{qty} hold the soldiers’ pay at {to}. Deliver them intact before {date}: a lost chest is never forgiven.` },
];

// named captains (quarry missions): names assembled by drawing, all original
export const QUARRY_NAMES = {
  first: ['Gideon', 'Matthew', 'Caleb', 'Elias', 'Thaddeus', 'Barnaby', 'Ansel', 'Lazarus', 'Ewan', 'Silas', 'Octavius', 'Jericho'],
  last: ['Vaughan', 'Kerrigan', 'Mallory', 'Dunstable', 'Halloran', 'Breakwater', 'Quennell', 'Ashcombe', 'Pilgrim', 'Sorrel', 'Grimes', 'Tallow'],
  nick: {
    pirate: ['Tarbrush', 'Harelip', 'the Scorpionfish', 'Coldhand', 'Sawtooth', 'Pockmark', 'Sailburner', 'Ironhook'],
    smuggler: ['the Eel', 'Wolfstep', 'the Ferret', 'No-Lantern', 'the Quiet One', 'False-Bottom', 'the Weasel', 'Midnight'],
  },
  ship: {
    pirate: ['Sea Dog', 'Foul Tide', 'Flayer', 'Black Fortune', 'Devil’s Hoof', 'Pitch Maw', 'Evil Eye', 'Carrion Crow'],
    smuggler: ['Moonless Night', 'Quiet Beauty', 'Contrary Wind', 'Mist', 'Doused Light', 'Little Shadow', 'Low Tide', 'Muffle'],
  },
};
export const QUARRY_TEXT = {
  pirate: [
    `Our coasters around {place} are being plundered by {who}, aboard {theship}. Sink her, take her or make her strike her colours: his head is worth a fine bounty.`,
    `Three ships lost in a month near {place}. The survivors blame {who}, who commands {theship}. Put an end to his raiding before {date}.`,
  ],
  smuggler: [
    `From the coves of {place}, powder is being sold to our enemies by {who}. {Theship} runs at the first gunshot: catch her, take her or sink her.`,
    `A smuggler, {who}, runs untaxed tobacco near {place}. Seize {theship} before {date}: the revenue men will know how to show their gratitude.`,
  ],
};

// shipwrecks (rescue): ships per nation of the governor
export const WRECKS = {
  english: ['Patience', 'Good Hope', 'Mary Ellen', 'Steadfast'],
  spanish: ['Santa Inés', 'Buen Suceso', 'San Andrés', 'Paloma'],
  french: ['Bon Espoir', 'Clémence', 'Trois Sœurs', 'Hirondelle'],
  dutch: ['Goede Verwachting', 'Zeemeeuw', 'Vrouw Anna', 'Morgenster'],
};
export const RESCUE_TEXT = [
  `{Theship}, out of {from} with settlers, broke up on the reefs near {place}. A fisherman saw fires there. Take off the survivors and bring them back here before {date}.`,
  `The wreck {ofship} has been found off {place}; some men may have reached the shore. Go and fetch them and return before {date}.`,
];
export const SCOUT_TEXT = {
  port: [
    `Our spies in {to} have been silent for weeks. Come within {near} of the place, count her guns and the sails at anchor, then return here before {date}.`,
    `They say the {people} are fitting out a squadron at {to}. Go and see for yourself — closer than {near} — and report what you saw before {date}.`,
  ],
  haven: [
    `The Brethren of the Coast are gathering at {to}. Go and note their ships and batteries (within {near}), then return before {date}.`,
  ],
};

// “{qty}”: 12 crates of arms
export const qtyLabel = (n, good, G) => `${n}${NBSP}${n > 1 ? G[good]?.unitPl || 'lots' : G[good]?.unit || 'lot'} of ${(G[good]?.name || good).toLowerCase()}`;
// replaces {key} with vars[key]
export const fill = (t, vars) => t.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');

export const cap = t => (t ? t[0].toUpperCase() + t.slice(1) : t);
// “the sloop “Sea Dog”” / “of the schooner “Mist””
export const theShipN = (type, name) => `the ${shipType(type).toLowerCase()} “${name}”`;
export const ofShip = (type, name) => `of ${theShipN(type, name)}`;
// absolute day (year × 372 + month × 31 + day) -> “12 March” (same computation as living.dayLabel, without importing living.js)
export function dayLabel(n) {
  let m = Math.floor(n / 31) % 12, d = n % 31;
  if (d === 0) { d = 31; m -= 1; }
  m = ((m - 1) % 12 + 12) % 12;
  d = Math.min(d, [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m]);
  return `${d} ${MONTHS[m]}`;
}
