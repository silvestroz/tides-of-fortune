// Sea tiers. Pure tables and functions (importable in node); the system that serves them to the game is
// src/world/seaZones.js (game.seaZones). Power rating and classes: src/data/shipTypes.js (powerOf, powerClass,
// POWER_BOUNDS).
//   ZONE_TIERS[t]   sea tier t = 1 (guarded waters), 2 (trade routes), 3 (perilous seas):
//     cap[role]     maximum class (1 to 5) of a ship of that role that spawns or gives chase in the zone
//                   (pirate, hunter, patrol, merchant, escort; 5 = no cap)
//     rel, relMin   tier I: pirate rating ≤ max(relMin, rel × player's rating)
//     roles         shares of the random traffic (merchant, pirate; patrols make up the rest)
//     lords         Top 10 ranks (1 = most feared) whose lair goes in this tier
//     reward        × bounties of the missions whose place is in this tier
//     name, advice  texts (chart, messages, Registry)
//   GUARDED[portId] radius (m) of the guarded waters around the starting ports (src/data/creation.js START_PORT)
//   PERILOUS        perilous seas: rectangles { x0, x1, z0, z1 } or ellipses { x, z, rx, rz }, with a name
//   LAIRS           settings of the Top 10 lairs (src/game/pirateLords.js)
//   BORDER          protective boundary (src/ships/ai.js): retaliation delay, message
//   ZONE_TEXT[t]    tier texts: tag (short label), enter(name) (entry message), tip (chart tooltip)
//   THREAT          threat of a ship (enemy strength / player's strength, fightStrength): prey, even, tough, over
//   ZONE_NOTE       entry message: confirmation delay (s), delay before repeating the message of the same zone (s)
// Functions: buildZones(ports), zoneAt(zones, x, z) → { tier, name, port? }, capFor(tier, role, playerPower),
// livePower(ship), forbidden(zones, ship, x, z), fightStrength(ship), threatOf(ship, player).
import { powerFrom, powerClass, CLASS_NAMES } from './shipTypes.js';

export const ZONE_TIERS = {
  1: { tier: 1, name: 'Guarded waters', advice: 'brig', reward: 1,
    cap: { pirate: 2, hunter: 3, patrol: 3, merchant: 3, escort: 2 }, rel: 1.15, relMin: 9,
    roles: { merchant: 0.52, pirate: 0.12 }, lords: [] },
  2: { tier: 2, name: 'Trade routes', advice: 'corvette or light frigate', reward: 1.25,
    cap: { pirate: 3, hunter: 4, patrol: 4, merchant: 4, escort: 4 },
    roles: { merchant: 0.48, pirate: 0.18 }, lords: [5, 6, 7, 8, 9, 10] },
  3: { tier: 3, name: 'Perilous seas', advice: 'frigate and beyond', reward: 1.6,
    cap: { pirate: 5, hunter: 5, patrol: 5, merchant: 5, escort: 5 },
    roles: { merchant: 0.44, pirate: 0.28 }, lords: [1, 2, 3, 4] },
};

// guarded waters: the four starting ports (a conquered port keeps its waters; zones are fixed for now)
export const GUARDED = { portroyal: 2600, havana: 2200, fortroyal: 2000, willemstad: 2200 };

// perilous seas (world coordinates, x east, z south)
// (label: point at sea where the chart writes the name)
export const PERILOUS = [
  { name: 'Lucayan Banks', x0: -4200, x1: 4700, z0: -7800, z1: -5000, label: [-200, -5250] },
  { name: 'Tortuga Channel', x: 1750, z: -4350, rx: 1350, rz: 680, label: [1750, -3900] },
  { name: 'Western Passages', x0: -7800, x1: -5600, z0: -2600, z1: 6800, label: [-6700, 2800] },
  { name: 'Main Coast', x0: -7800, x1: 7800, z0: 6550, z1: 7800, label: [1900, 6600] },
];

export const ZONE_TEXT = {
  1: { tag: 'guarded waters', tip: `The forts and the coastguard keep big ships offshore: no Top 10 captain, no pirate stronger than you. A pursuer that is too heavy gives up at the boundary.` },
  2: { tag: 'trade routes', tip: `Corvettes and frigates cruise here, and six captains of the Top 10. Advised ship: corvette or light frigate.` },
  3: { tag: 'perilous seas', tip: `Ships of the line, treasure galleons, the most feared captains of the Top 10. Rewards ×1.6. Advised ship: frigate and beyond.` },
};
export function zoneEnterText(z) {
  if (z.tier === 1) return `${z.name}: big men-of-war and Top 10 captains keep offshore.`;
  if (z.tier === 3) return `${z.name}, perilous seas: ships of the line and Top 10 captains. Advised ship: frigate.`;
  return `Trade routes: corvettes and frigates cruise here. Advised ship: corvette or light frigate.`;
}
export const ZONE_NOTE = { confirm: 3, repeat: 600 };

// threat: current enemy strength / player's strength (hull, guns, men, sails), as the AI computes it (ai.js)
export const THREAT = [
  { key: 'prey', max: 0.6, label: 'Prey' },
  { key: 'even', max: 1.25, label: 'A fair match' },
  { key: 'tough', max: 2, label: 'Tough' },
  { key: 'over', max: Infinity, label: 'Out of your class' },
];
export function fightStrength(s) {
  return Math.max(0.05, s.hull / s.hullMax) * (s.guns + 4) * Math.min(1, 0.3 + s.crew / Math.max(1, s.crewMax)) * (0.6 + 0.4 * s.sails);
}
export function threatOf(ship, player) {
  if (!ship || !player) return null;
  const r = fightStrength(ship) / Math.max(0.01, fightStrength(player));
  const t = THREAT.find(x => r < x.max) || THREAT[THREAT.length - 1];
  return { ...t, ratio: r, cls: powerClass(livePower(ship)), roman: CLASS_NAMES[powerClass(livePower(ship)) - 1] };
}

export const LAIRS = {
  minFromStart: 3000,   // m: no lair within 3 km of a starting port (the cove stays a treasure cove)
  version: 2,           // state.lordsLairs: reassigns the lairs of old saves
};

export const BORDER = {
  provoked: 15,         // s: a ship hit by its target in a zone closed to it fights back for this long
  waypointTries: 4,     // draws of a cruising point outside the closed zones
};

export function buildZones(ports = []) {
  const guarded = [];
  for (const p of ports) {
    const r = GUARDED[p.id]; if (!r) continue;
    const hp = p.harborPoint || p;
    guarded.push({ x: hp.x, z: hp.z, r, port: p.id, name: `${p.name} guarded waters` });
  }
  return { guarded, perilous: PERILOUS.map(z => ({ ...z })) };
}

export function inShape(z, x, y) {
  if (z.r != null) return Math.hypot(x - z.x, y - z.z) < z.r;
  if (z.rx != null) { const a = (x - z.x) / z.rx, b = (y - z.z) / z.rz; return a * a + b * b < 1; }
  return x >= z.x0 && x <= z.x1 && y >= z.z0 && y <= z.z1;
}

export function zoneAt(zones, x, z) {
  if (zones) {
    for (const g of zones.guarded) if (inShape(g, x, z)) return { tier: 1, name: g.name, port: g.port, shape: g };
    for (const p of zones.perilous) if (inShape(p, x, z)) return { tier: 3, name: p.name, shape: p };
  }
  return { tier: 2, name: ZONE_TIERS[2].name, shape: null };
}

// nominal rating of a ship at sea (jettisoned guns and hull refits included)
export function livePower(ship) {
  if (!ship) return 0;
  return powerFrom(ship.guns ?? ship.spec?.guns ?? 0, ship.hullMax ?? ship.spec?.hull ?? 100);
}

// spawn cap of a role in a tier: { maxClass, maxPower }
export function capFor(tier, role, playerPower = 0) {
  const T = ZONE_TIERS[tier] || ZONE_TIERS[2];
  const maxClass = T.cap[role] ?? 5;
  let maxPower = Infinity;
  if (T.rel && role === 'pirate' && playerPower > 0) maxPower = Math.max(T.relMin || 0, T.rel * playerPower);
  return { maxClass, maxPower };
}

// a zone closed to this ship? (aggressors only: pirates, hunters, patrols; the Top 10 captains never enter
// guarded waters). Merchants go everywhere. target: the intended target; if it is the player, the relative cap
// on pirates in tier I applies too (rating ≤ max(relMin, rel × player's rating)).
export function forbidden(zones, ship, x, z, target = null) {
  if (!ship || ship.isPlayer) return false;
  const role = ship.role;
  if (role !== 'pirate' && role !== 'hunter' && role !== 'patrol') return false;
  const t = zoneAt(zones, x, z).tier;
  if (t >= 3) return false;
  if (ship.lordId && t === 1) return true;
  const cap = ZONE_TIERS[t].cap[role] ?? 5, p = livePower(ship);
  if (powerClass(p) > cap) return true;
  if (t === 1 && role === 'pirate' && target?.isPlayer) return p > capFor(1, 'pirate', livePower(target)).maxPower;
  return false;
}
