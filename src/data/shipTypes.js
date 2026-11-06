// Single source of truth for the 27 ship types: 9 families × 3 sizes.
// Original table (no names or figures taken from any other game). Each type derives its 3D model from one of the six
// procedural base designs (`base`, see src/ships/art/configs.js) scaled by `scale`, with small visual mods (`art`).
// The six historical ids (sloop, schooner, brig, merchantman, frigate, galleon) keep their stats: old saves stay valid.
// Fields:
//   fam, size (0 small, 1 medium, 2 large), name (displayed type name)
//   guns, hull, crew (crewMax), cargo (hold units), speed (spec.maxSpeed, class m/s), turn (spec.turn, rad/s peak)
//   draft  navigation draft in metres (gameplay: shoals; the visual hull keeps its own draft)
//   price  shipyard list price;  rig 'square'|'fore-aft'|'mixed' (RIGS in sailPhysics.js)
//   roles  traffic weights per AI role;  nat  per-nation weight multipliers (default 1)
//   merit  career weight of a kill;  gold [min,max] boarding gold;  vol  boarding cargo volume
// Consumers fill their own per-type tables from this one at import (shipModel SHIP_SPECS, sailPhysics HANDLING/RIGS/
// WIND_AFFINITY, economy CARGO_CAPACITY/SHIP_PRICES, i18n names, career merit, duel/sim spoils, port art silhouettes).

export const SHALLOW_DRAFT = 1.3;   // ships drawing ≤ this cross reefs and sand bars (only beaches stop them)

const T = (o) => o;
export const SHIP_TYPES = {
  // --- cutters: one mast, fore-and-aft rig, very fast and handy, shallow draft
  lugger:      T({ base: 'sloop', fam: 'cotre', size: 0, name: 'Lugger', scale: 0.8, guns: 4, hull: 42, crew: 40, cargo: 25, speed: 14.8, turn: 0.62, draft: 0.8, price: 1300, rig: 'fore-aft',
    roles: { pirate: 2, merchant: 1 }, nat: { pirate: 1.5 }, merit: 0.6, gold: [80, 300], vol: 8,
    art: { ports: [2], headsails: 1, crew: 5 } }),
  sloop:       T({ base: 'sloop', fam: 'cotre', size: 1, name: 'Sloop', scale: 1, guns: 8, hull: 60, crew: 75, cargo: 40, speed: 14, turn: 0.55, draft: 1.1, price: 2400, rig: 'fore-aft',
    roles: { pirate: 4, merchant: 0.5, patrol: 0.5 }, merit: 1, gold: [150, 500], vol: 12 }),
  cutter:      T({ base: 'sloop', fam: 'cotre', size: 2, name: 'Armed cutter', scale: 1.18, guns: 10, hull: 78, crew: 85, cargo: 45, speed: 14.3, turn: 0.52, draft: 1.5, price: 3300, rig: 'fore-aft',
    roles: { pirate: 2, patrol: 1, hunter: 0.5 }, nat: { english: 1.4 }, merit: 1.3, gold: [200, 600], vol: 14,
    art: { ports: [5], headsails: 3, crew: 8 } }),
  // --- schooners: two fore-and-aft masts
  ketch:       T({ base: 'schooner', fam: 'goelette', size: 0, name: 'Ketch', scale: 0.82, guns: 6, hull: 55, crew: 50, cargo: 45, speed: 13.2, turn: 0.5, draft: 0.9, price: 2000, rig: 'fore-aft',
    roles: { merchant: 1.5, pirate: 1 }, nat: { dutch: 1.4 }, merit: 0.9, gold: [120, 450], vol: 14,
    art: { ports: [3], mastH: [1, 0.72], crew: 6 } }),
  schooner:    T({ base: 'schooner', fam: 'goelette', size: 1, name: 'Schooner', scale: 1, guns: 10, hull: 80, crew: 90, cargo: 60, speed: 13.5, turn: 0.48, draft: 1.2, price: 3800, rig: 'fore-aft',
    roles: { pirate: 2, merchant: 1, patrol: 1 }, nat: { french: 1.3 }, merit: 1.5, gold: [250, 700], vol: 18 }),
  topschooner: T({ base: 'schooner', fam: 'goelette', size: 2, name: 'Topsail schooner', scale: 1.16, guns: 14, hull: 100, crew: 110, cargo: 70, speed: 13.8, turn: 0.45, draft: 2.0, price: 5300, rig: 'mixed',
    roles: { pirate: 1.5, patrol: 1, hunter: 1 }, nat: { french: 1.4, pirate: 1.3 }, merit: 1.9, gold: [300, 850], vol: 20,
    art: { ports: [7], crew: 11 } }),
  // --- brigs: two square-rigged masts
  brigantine:  T({ base: 'brig', fam: 'brick', size: 0, name: 'Brigantine', scale: 0.86, guns: 10, hull: 95, crew: 90, cargo: 70, speed: 12.7, turn: 0.44, draft: 1.9, price: 4600, rig: 'mixed',
    roles: { pirate: 2, merchant: 1, patrol: 0.5 }, merit: 1.6, gold: [300, 850], vol: 20,
    art: { ports: [5], mastRig: { 1: { rig: 'gaff', topsail: 'gaff', tiers: undefined } }, crew: 10 } }),
  brig:        T({ base: 'brig', fam: 'brick', size: 1, name: 'Brig', scale: 1, guns: 14, hull: 120, crew: 120, cargo: 90, speed: 12, turn: 0.40, draft: 2.6, price: 6200, rig: 'mixed',
    roles: { pirate: 1, merchant: 1, patrol: 2, hunter: 1 }, merit: 2, gold: [400, 1100], vol: 26 }),
  snow:        T({ base: 'brig', fam: 'brick', size: 2, name: 'Snow', scale: 1.12, guns: 18, hull: 145, crew: 140, cargo: 110, speed: 11.8, turn: 0.37, draft: 3.0, price: 8000, rig: 'square',
    roles: { patrol: 1.5, hunter: 1, merchant: 0.5 }, nat: { dutch: 1.4, english: 1.2 }, merit: 2.3, gold: [450, 1250], vol: 30,
    art: { ports: [8], stern: { windowRows: [5], quarterGalleries: true }, crew: 13 } }),
  // --- corvettes: small three-masted warships (a reduced frigate)
  aviso:       T({ base: 'frigate', fam: 'corvette', size: 0, name: 'Aviso', scale: 0.62, guns: 12, hull: 110, crew: 100, cargo: 60, speed: 12.9, turn: 0.42, draft: 2.3, price: 7000, rig: 'square',
    roles: { patrol: 2, hunter: 0.5 }, nat: { french: 1.3 }, merit: 2, gold: [300, 900], vol: 18,
    art: { ports: [6, 0, 0], stern: { windowRows: [4], gallery: false }, castles: 0.7, crew: 10 } }),
  corvette:    T({ base: 'frigate', fam: 'corvette', size: 1, name: 'Corvette', scale: 0.72, guns: 20, hull: 150, crew: 150, cargo: 80, speed: 12.4, turn: 0.38, draft: 2.8, price: 9500, rig: 'square',
    roles: { patrol: 2.5, hunter: 1.5 }, nat: { french: 1.4 }, merit: 2.5, gold: [450, 1200], vol: 22,
    art: { ports: [8, 2, 0], stern: { windowRows: [4], gallery: false }, castles: 0.8, crew: 12 } }),
  raider:      T({ base: 'frigate', fam: 'corvette', size: 2, name: 'Raiding corvette', scale: 0.82, guns: 24, hull: 180, crew: 190, cargo: 95, speed: 12.1, turn: 0.35, draft: 3.2, price: 11800, rig: 'square',
    roles: { hunter: 2, pirate: 0.6, patrol: 1 }, nat: { pirate: 1.5 }, merit: 2.8, gold: [600, 1500], vol: 26,
    art: { ports: [9, 2, 1], stern: { windowRows: [5], gallery: false }, castles: 0.85, crew: 14 } }),
  // --- coasters: small coastal carriers, deep hold for their size
  coaster:     T({ base: 'merchantman', fam: 'caboteur', size: 0, name: 'Coaster', scale: 0.66, guns: 2, hull: 70, crew: 25, cargo: 110, speed: 10.3, turn: 0.36, draft: 1.2, price: 2600, rig: 'square',
    roles: { merchant: 3 }, merit: 0.8, gold: [200, 800], vol: 34,
    art: { ports: [1], masts: 2, crew: 5 } }),
  pink:        T({ base: 'merchantman', fam: 'caboteur', size: 1, name: 'Pink', scale: 0.78, guns: 4, hull: 90, crew: 35, cargo: 150, speed: 10.0, turn: 0.34, draft: 2.2, price: 3600, rig: 'square',
    roles: { merchant: 2.5 }, nat: { spanish: 1.3 }, merit: 1, gold: [350, 1200], vol: 44,
    art: { ports: [2], stern: { quarterGalleries: false }, crew: 7 } }),
  storeship:   T({ base: 'merchantman', fam: 'caboteur', size: 2, name: 'Storeship', scale: 0.9, guns: 6, hull: 115, crew: 45, cargo: 185, speed: 9.6, turn: 0.31, draft: 2.9, price: 4500, rig: 'square',
    roles: { merchant: 2 }, nat: { french: 1.3 }, merit: 1.2, gold: [500, 1700], vol: 52,
    art: { ports: [3], crew: 8 } }),
  // --- merchantmen: three-masted traders
  bilander:    T({ base: 'merchantman', fam: 'marchand', size: 0, name: 'Bilander', scale: 0.94, guns: 6, hull: 125, crew: 50, cargo: 175, speed: 9.9, turn: 0.32, draft: 2.9, price: 4600, rig: 'square',
    roles: { merchant: 2 }, nat: { dutch: 1.6 }, merit: 1.3, gold: [600, 2000], vol: 52,
    art: { ports: [3], crew: 9 } }),
  merchantman: T({ base: 'merchantman', fam: 'marchand', size: 1, name: 'Merchantman', scale: 1, guns: 8, hull: 140, crew: 60, cargo: 210, speed: 9.5, turn: 0.30, draft: 3.4, price: 5400, rig: 'square',
    roles: { merchant: 4 }, merit: 1.5, gold: [800, 2600], vol: 60 }),
  companyship: T({ base: 'merchantman', fam: 'marchand', size: 2, name: 'Company ship', scale: 1.2, guns: 16, hull: 195, crew: 95, cargo: 280, speed: 9.3, turn: 0.27, draft: 4.2, price: 9800, rig: 'square',
    roles: { merchant: 1.2 }, nat: { english: 1.4, dutch: 1.5, pirate: 0 }, merit: 2.4, gold: [1400, 4200], vol: 80,
    art: { ports: [7], stern: { windowRows: [4], gallery: true }, crew: 12 } }),
  // --- frigates: three-masted warships, one covered gun deck
  lightfrigate: T({ base: 'frigate', fam: 'fregate', size: 0, name: 'Light frigate', scale: 0.9, guns: 22, hull: 185, crew: 180, cargo: 110, speed: 12.0, turn: 0.33, draft: 3.5, price: 11500, rig: 'square',
    roles: { patrol: 2, hunter: 1.5 }, merit: 2.7, gold: [550, 1500], vol: 26,
    art: { ports: [9, 2, 1], crew: 14 } }),
  frigate:     T({ base: 'frigate', fam: 'fregate', size: 1, name: 'Frigate', scale: 1, guns: 28, hull: 220, crew: 220, cargo: 140, speed: 11.5, turn: 0.30, draft: 4.0, price: 14500, rig: 'square',
    roles: { patrol: 3, hunter: 2 }, merit: 3, gold: [700, 1800], vol: 30 }),
  heavyfrigate: T({ base: 'frigate', fam: 'fregate', size: 2, name: 'Heavy frigate', scale: 1.13, guns: 36, hull: 270, crew: 270, cargo: 160, speed: 11.0, turn: 0.27, draft: 4.6, price: 18500, rig: 'square',
    roles: { patrol: 1, hunter: 1 }, nat: { english: 1.3, pirate: 0 }, merit: 3.6, gold: [900, 2300], vol: 34,
    art: { ports: [12, 4, 1], crew: 18 } }),
  // --- ships of the line: big warships with tiered gun decks (galleon hull, castles cut down)
  twodecker:   T({ base: 'galleon', fam: 'vaisseau', size: 0, name: 'Two-decker', scale: 0.98, guns: 44, hull: 330, crew: 330, cargo: 180, speed: 9.9, turn: 0.24, draft: 5.0, price: 24000, rig: 'square',
    roles: { patrol: 0.6 }, nat: { pirate: 0, english: 1.3 }, merit: 4.5, gold: [1000, 2800], vol: 40,
    art: { ports: [11, 8, 3, 2], castles: 0.6, head: 'lion', mizzen: 'square', crew: 18 } }),
  seventyfour: T({ base: 'galleon', fam: 'vaisseau', size: 1, name: 'Seventy-four', scale: 1.08, guns: 56, hull: 390, crew: 420, cargo: 200, speed: 9.7, turn: 0.22, draft: 5.4, price: 31000, rig: 'square',
    roles: { patrol: 0.35 }, nat: { pirate: 0, french: 1.4 }, merit: 5.5, gold: [1300, 3400], vol: 44,
    art: { ports: [12, 10, 3, 2], castles: 0.55, head: 'lion', mizzen: 'square', crew: 20 } }),
  threedecker: T({ base: 'galleon', fam: 'vaisseau', size: 2, name: 'Three-decker', scale: 1.18, guns: 72, hull: 470, crew: 540, cargo: 230, speed: 9.2, turn: 0.2, draft: 5.9, price: 39000, rig: 'square',
    roles: { patrol: 0.12 }, nat: { pirate: 0, dutch: 0.5 }, merit: 7, gold: [1600, 4200], vol: 50,
    // three tiers of gunports — lower gundeck added (addPorts), middle = the galleon's lower battery, upper =
    // the waist battery stretched along the upper deck; 12 + 12 + 8 + 2 + 2 per side = 72 guns (spec)
    art: { ports: [12, 8, 2, 2], portRows: { 1: { s0: 0.22, s1: 0.58 } }, addPorts: [{ deck: 'main', y: -3.36, s0: 0.15, s1: 0.66, n: 12, size: 0.7 }],
      castles: 0.65, head: 'lion', mizzen: 'square', stern: { windowRows: [5, 5, 4] }, crew: 22 } }),
  // --- galleons: heavy three/four-masters, high castles, deep holds
  nao:         T({ base: 'galleon', fam: 'galion', size: 0, name: 'Nao', scale: 0.8, guns: 18, hull: 220, crew: 160, cargo: 200, speed: 9.3, turn: 0.26, draft: 4.0, price: 13000, rig: 'square',
    roles: { merchant: 1, patrol: 0.3 }, nat: { spanish: 3, pirate: 0 }, merit: 2.6, gold: [1000, 3000], vol: 56,
    art: { ports: [6, 2, 2, 0], crew: 12 } }),
  galleon:     T({ base: 'galleon', fam: 'galion', size: 1, name: 'Galleon', scale: 1, guns: 36, hull: 300, crew: 300, cargo: 260, speed: 9, turn: 0.22, draft: 5.0, price: 21000, rig: 'square',
    roles: { merchant: 1, patrol: 0.6 }, nat: { spanish: 3, pirate: 0 }, merit: 4, gold: [1500, 4500], vol: 70 }),
  greatgalleon: T({ base: 'galleon', fam: 'galion', size: 2, name: 'Great galleon', scale: 1.16, guns: 44, hull: 380, crew: 360, cargo: 340, speed: 8.6, turn: 0.19, draft: 5.8, price: 28000, rig: 'square',
    roles: { merchant: 0.2, patrol: 0.2 }, nat: { spanish: 4, pirate: 0, english: 0.3, french: 0.3, dutch: 0.3 }, merit: 5, gold: [2200, 6000], vol: 90,
    art: { ports: [11, 6, 3, 2], stern: { crest: 2 }, crew: 20 } }),
};

export const SHIP_IDS = Object.keys(SHIP_TYPES);
export const BASE_IDS = ['sloop', 'schooner', 'brig', 'merchantman', 'frigate', 'galleon'];

// Starting epoch (character creation, src/data/creation.js EPOCHS): traffic weight per family (fam) and types missing
// from the shipyard (yardBan). setShipEra(null) = golden age (tables above unchanged).
export const SHIP_ERA = { fam: null, yardBan: null };
export function setShipEra(e) { SHIP_ERA.fam = e?.fam || null; SHIP_ERA.yardBan = e?.yardBan || null; }

// Sea tiers: power rating P = (guns + 4) × √(hull / 100) and five classes (I to V).
// Bounds: I < 12 ≤ II < 25 ≤ III < 46 ≤ IV < 81 ≤ V (brig 20 = II, corvette 29 = III, frigate 47 = IV, two-decker 87 = V).
export const POWER_BOUNDS = [12, 25, 46, 81];
export const CLASS_NAMES = ['I', 'II', 'III', 'IV', 'V'];
export const powerFrom = (guns, hull) => (Math.max(0, guns) + 4) * Math.sqrt(Math.max(1, hull) / 100);
export const powerOf = type => { const t = SHIP_TYPES[type] || SHIP_TYPES.brig; return powerFrom(t.guns, t.hull); };
export function powerClass(p) { let c = 1; for (const b of POWER_BOUNDS) if (p >= b) c++; return c; }
export const classOf = type => powerClass(powerOf(type));

// Traffic: weighted pick of a type for an AI role and nation (rnd = 0..1 generator).
// opts.maxClass / opts.maxPower: sea-tier cap (src/data/seaZones.js). Nothing under the cap: the lightest type
// this role can draw.
export function pickTrafficType(role, faction, rnd = Math.random, { maxClass = 5, maxPower = Infinity } = {}) {
  let tot = 0; const list = []; let light = null, lightP = Infinity;
  for (const id of SHIP_IDS) {
    const t = SHIP_TYPES[id];
    let w = (t.roles?.[role] || 0) * (t.nat?.[faction] ?? 1) * (SHIP_ERA.fam?.[t.fam] ?? 1);
    if (w <= 0) continue;
    const p = powerFrom(t.guns, t.hull);
    if (p < lightP) { lightP = p; light = id; }
    if (powerClass(p) > maxClass || p > maxPower) w = 0;
    if (w > 0) { tot += w; list.push([id, w]); }
  }
  if (!list.length) return light || 'brig';
  let r = rnd() * tot;
  for (const [id, w] of list) { if ((r -= w) <= 0) return id; }
  return list[list.length - 1][0];
}

// Shipyard stock: small ports build small hulls, large ports everything; ships of the line only in large national
// yards; pirate havens sell no warship heavier than a corvette. Always lists the player's own type first.
export function yardTypes(port, ownType) {
  const max = { small: 0, medium: 1, large: 2 }[port?.size] ?? 1;
  const haven = !!port?.haven || port?.faction === 'pirate';
  const out = SHIP_IDS.filter(id => {
    const t = SHIP_TYPES[id];
    if (t.size > max) return false;
    if (t.fam === 'vaisseau' && (max < 2 || haven)) return false;
    if (haven && (t.fam === 'fregate' && t.size > 0 || t.fam === 'galion')) return false;
    if (t.fam === 'galion' && port?.faction !== 'spanish' && t.size > 0) return false;
    if (SHIP_ERA.yardBan?.includes(id)) return false;   // starting epoch
    return true;
  });
  if (ownType && !out.includes(ownType)) out.unshift(ownType);
  return out;
}
