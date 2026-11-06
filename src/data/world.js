// World data for the archipelago (Caribbean-inspired, 16 km square world, metres, x = east, z = south).
// Deterministic from the seed: the geography is authored, the seed jitters shapes/positions/economy.
//
// API:
//   GOODS                      { id: { name, basePrice, unit, bulk } }
//   generateWorld(seed) -> {
//     islands: [{ id, name, type, x, z, radius, faction|null, spine:[[x,z,r]], peak, ... terrain params }],
//     ports:   [{ id, name, faction, islandId, size, anchor:[x,z], side:[dx,dz], goods:{ good:{ price, supply, demand } },
//                population, haven(bool) }],          // geometry fields (x,z,harborPoint,...) are filled in by islands.js
//     coves:   [{ id, islandId, anchor:[x,z], side:[dx,dz] }],  // hidden coves (treasure); x,z filled by islands.js
//     villages:[{ id, name, islandId, anchor:[x,z], side:[dx,dz], sells:[good], seed }],  // fishing villages (neutral)
//     banks:   [{ x, z, rx, rz, depth }],             // shallow sand banks (seabed shaping)
//   }
import { mulberry32, hashString } from '../core/rng.js';

export const GOODS = {
  // name/unit/unitPl are display strings; pl = the name is a plural ('Provisions are…')
  food:    { name: 'Provisions', basePrice: 12,  unit: 'barrel', unitPl: 'barrels', bulk: 1, pl: true },
  sugar:   { name: 'Sugar',      basePrice: 38,  unit: 'hogshead', unitPl: 'hogsheads', bulk: 1 },
  tobacco: { name: 'Tobacco',    basePrice: 52,  unit: 'bale', unitPl: 'bales', bulk: 1 },
  rum:     { name: 'Rum',        basePrice: 46,  unit: 'cask', unitPl: 'casks', bulk: 1 },
  cotton:  { name: 'Cotton',     basePrice: 34,  unit: 'bale', unitPl: 'bales', bulk: 1 },
  spice:   { name: 'Spices',     basePrice: 110, unit: 'chest', unitPl: 'chests', bulk: 0.5, pl: true },
  timber:  { name: 'Timber',     basePrice: 18,  unit: 'load', unitPl: 'loads', bulk: 2 },
  cloth:   { name: 'Cloth',      basePrice: 64,  unit: 'bolt', unitPl: 'bolts', bulk: 0.5 },
  cocoa:   { name: 'Cocoa',      basePrice: 58,  unit: 'sack', unitPl: 'sacks', bulk: 1 },
  coffee:  { name: 'Coffee',     basePrice: 62,  unit: 'sack', unitPl: 'sacks', bulk: 1 },
  indigo:  { name: 'Indigo',     basePrice: 90,  unit: 'crate', unitPl: 'crates', bulk: 0.5 },
  hides:   { name: 'Hides',      basePrice: 26,  unit: 'bundle', unitPl: 'bundles', bulk: 1, pl: true },
  salt:    { name: 'Salt',       basePrice: 14,  unit: 'barrel', unitPl: 'barrels', bulk: 1 },
  silver:  { name: 'Silver',     basePrice: 240, unit: 'chest', unitPl: 'chests', bulk: 0.3 },
  arms:    { name: 'Arms',       basePrice: 130, unit: 'crate', unitPl: 'crates', bulk: 1, pl: true },
  powder:  { name: 'Powder',     basePrice: 70,  unit: 'keg', unitPl: 'kegs', bulk: 1 },
};

// type: mountain | jungle | volcanic | flat | cay | atoll | mainland | dry
// spine: tapered capsule chain [x, z, radius]
const ISLANDS = [
  // --- Greater Antilles ---
  { id: 'cuba', name: 'Cuba', type: 'mountain', spine: [[-6500, -3050, 360], [-5300, -3500, 520], [-3950, -3750, 600], [-2750, -3600, 560], [-1750, -3250, 460], [-950, -2950, 320]], peak: 330, cliff: 0.35, moist: 0.8 },
  { id: 'juventud', name: 'Isla de Pinos', type: 'jungle', spine: [[-4850, -2050, 300], [-4450, -2150, 280]], peak: 70, moist: 0.75, reef: 0.6 },
  { id: 'jamaica', name: 'Jamaica', type: 'mountain', spine: [[-2950, -480, 320], [-2150, -680, 450], [-1250, -620, 400], [-650, -420, 270]], peak: 420, cliff: 0.3, moist: 0.95 },
  { id: 'grandcayman', name: 'Grand Cayman', type: 'cay', spine: [[-5650, -950, 150], [-5250, -1050, 120]], peak: 6, reef: 1, shelfW: 380 },
  { id: 'hispaniola', name: 'Hispaniola', type: 'mountain', spine: [[700, -2850, 430], [1600, -2750, 720], [2750, -2500, 820], [3700, -2200, 640], [4300, -2000, 360]], peak: 470, cliff: 0.4, moist: 0.85,
    volcano: { at: [2350, -2700], h: 520, r: 560, crater: 0 } },
  { id: 'tortuga', name: 'Tortuga', type: 'jungle', spine: [[1350, -4300, 210], [2150, -4330, 250]], peak: 110, cliff: 0.6, moist: 0.9 },
  { id: 'puertorico', name: 'Puerto Rico', type: 'mountain', spine: [[5350, -2600, 360], [6150, -2700, 440], [6950, -2600, 340]], peak: 300, moist: 0.9 },
  { id: 'navassa', name: 'Navassa', type: 'jungle', spine: [[650, -1250, 150]], peak: 55, cliff: 1, moist: 0.5 },
  // --- Bahamas ---
  { id: 'newprovidence', name: 'New Providence', type: 'flat', spine: [[550, -6300, 280], [950, -6250, 240]], peak: 28, moist: 0.6, reef: 0.7, shelfW: 260 },
  { id: 'andros', name: 'Andros', type: 'flat', spine: [[-1650, -6300, 380], [-1350, -5650, 360]], peak: 18, moist: 0.7, reef: 0.8, shelfW: 320 },
  { id: 'exuma', name: 'Exuma Cays', type: 'cay', spine: [[2300, -5950, 80], [2550, -5650, 100]], peak: 5, reef: 1, shelfW: 360 },
  { id: 'eleuthera', name: 'Eleuthera', type: 'cay', spine: [[2650, -7050, 110], [3300, -6900, 140], [3750, -6650, 100]], peak: 9, reef: 0.8, shelfW: 300 },
  { id: 'caysal', name: 'Cay Sal Bank', type: 'atoll', center: [-3000, -6900], ringR: 460, ringW: 70 },
  // --- Lesser Antilles ---
  { id: 'antigua', name: 'Antigua', type: 'flat', spine: [[6850, -700, 320]], peak: 70, moist: 0.55, reef: 0.8, shelfW: 260 },
  { id: 'statia', name: 'Sint Eustatius', type: 'volcanic', spine: [[5950, -1150, 210]], peak: 40, moist: 0.6,
    volcano: { at: [5980, -1200], h: 190, r: 200, crater: 26 } },
  { id: 'guadeloupe', name: 'Guadeloupe', type: 'volcanic', spine: [[6250, 1050, 400], [6700, 900, 160], [7050, 800, 300], [7350, 650, 230]], peak: 60, moist: 0.95, reef: 0.5,
    volcano: { at: [6180, 1100], h: 420, r: 380, crater: 30 } },
  { id: 'dominica', name: 'Dominica', type: 'mountain', spine: [[6480, 2150, 280], [6560, 2700, 300]], peak: 380, cliff: 0.8, moist: 1 },
  { id: 'martinique', name: 'Martinique', type: 'volcanic', spine: [[6300, 3500, 300], [6500, 4000, 360], [6780, 4320, 250]], peak: 140, moist: 0.95, reef: 0.4,
    volcano: { at: [6290, 3460], h: 400, r: 330, crater: 22 } },
  { id: 'barbados', name: 'Barbados', type: 'flat', spine: [[7450, 3200, 320]], peak: 85, moist: 0.65, reef: 1, shelfW: 240 },
  { id: 'grenada', name: 'Grenada', type: 'jungle', spine: [[5950, 5350, 240], [6050, 5600, 200]], peak: 230, moist: 1, cliff: 0.3 },
  // --- ABC (dry) ---
  { id: 'aruba', name: 'Aruba', type: 'dry', spine: [[700, 5200, 130], [1150, 5030, 150]], peak: 40, moist: 0.15, reef: 0.6 },
  { id: 'curacao', name: 'Curaçao', type: 'dry', spine: [[2150, 5650, 170], [2800, 5380, 250], [3350, 5150, 170]], peak: 110, moist: 0.25, reef: 0.8, cliff: 0.4 },
  { id: 'bonaire', name: 'Bonaire', type: 'dry', spine: [[4250, 4950, 190], [4400, 5250, 140]], peak: 60, moist: 0.2, reef: 1, shelfW: 140 },
  // --- Spanish Main (mainland, runs off the south edge) ---
  { id: 'main', name: 'Tierra Firme', type: 'mainland', spine: [[-9400, 8500, 1500], [-5200, 8150, 1200], [-2500, 7950, 1000], [200, 8200, 1100], [3600, 8400, 1300], [7000, 8350, 1200], [9600, 8600, 1400]], peak: 560, cliff: 0.3, moist: 0.9 },
  // --- open sea ---
  { id: 'islaverde', name: 'Isla Verde', type: 'volcanic', spine: [[-3850, 1800, 420], [-3450, 2050, 300]], peak: 90, moist: 1, cliff: 0.5, reef: 0.5,
    volcano: { at: [-3800, 1780], h: 300, r: 380, crater: 0 } },
  { id: 'serrana', name: 'Serrana Bank', type: 'atoll', center: [-500, 2700], ringR: 520, ringW: 80 },
  { id: 'alacranes', name: 'Arrecife Alacranes', type: 'atoll', center: [-6800, -5700], ringR: 600, ringW: 90 },
  { id: 'providencia', name: 'Providencia', type: 'volcanic', spine: [[-6000, 4400, 360]], peak: 60, moist: 0.95, cliff: 0.4, reef: 0.9,
    volcano: { at: [-6020, 4380], h: 280, r: 300, crater: 0 } },
  { id: 'cozumel', name: 'Cozumel', type: 'flat', spine: [[-7350, -1950, 200], [-7250, -1450, 220]], peak: 14, moist: 0.8, reef: 0.9, shelfW: 200 },
  { id: 'swan', name: 'Swan Cay', type: 'cay', spine: [[-6200, 1500, 110]], peak: 4, reef: 1, shelfW: 260 },
  // mid-ground rocks — small cliffed stacks ringed by reef and breakers, so open-sea legs are not empty
  // `bare` = naked sea stack (no vegetation; basalt, guano and wash in the terrain shader)
  { id: 'rk_gulls', name: 'Gull Rocks', type: 'volcanic', spine: [[-560, 470, 55], [-505, 505, 35]], peak: 26, cliff: 1, moist: 0.55, reef: 1, shelfW: 120, bare: 1 },
  { id: 'rk_sentinel', name: 'The Sentinel', type: 'volcanic', spine: [[-1500, 1500, 50]], peak: 34, cliff: 1, moist: 0.35, reef: 1, shelfW: 110 },
  { id: 'rk_teeth', name: 'Devil\'s Teeth', type: 'volcanic', spine: [[2300, -1250, 45], [2380, -1210, 30]], peak: 20, cliff: 1, moist: 0.3, reef: 1, shelfW: 130 },
  { id: 'rk_pelican', name: 'Pelican Stack', type: 'volcanic', spine: [[5300, 400, 50]], peak: 30, cliff: 1, moist: 0.6, reef: 1, shelfW: 110 },
  { id: 'rk_morro', name: 'Morro Chico', type: 'volcanic', spine: [[-3600, 300, 55]], peak: 28, cliff: 1, moist: 0.5, reef: 1, shelfW: 120 },
  { id: 'roncador', name: 'Roncador Cay', type: 'cay', spine: [[-2200, 3900, 70]], peak: 3, reef: 1, shelfW: 300 },
];

// side: seaward direction (dx, dz) of the harbour from the town (x east, z south)
const PORTS = [
  { id: 'havana',       name: 'Havana',          faction: 'spanish', islandId: 'cuba',          size: 'large',  anchor: [-5150, -3500], side: [0.15, -1] },
  { id: 'santiago',     name: 'Santiago de Cuba', faction: 'spanish', islandId: 'cuba',         size: 'medium', anchor: [-1900, -3300], side: [0, 1] },
  { id: 'santodomingo', name: 'Santo Domingo',   faction: 'spanish', islandId: 'hispaniola',    size: 'large',  anchor: [3150, -2350], side: [0.1, 1] },
  { id: 'sanjuan',      name: 'San Juan',        faction: 'spanish', islandId: 'puertorico',    size: 'medium', anchor: [6050, -2700], side: [0, -1] },
  { id: 'cartagena',    name: 'Cartagena',       faction: 'spanish', islandId: 'main',          size: 'large',  anchor: [-2600, 7950], side: [0.05, -1] },
  { id: 'portroyal',    name: 'Port Royal',      faction: 'english', islandId: 'jamaica',       size: 'large',  anchor: [-1350, -620], side: [0, 1] },
  { id: 'bridgetown',   name: 'Bridgetown',      faction: 'english', islandId: 'barbados',      size: 'medium', anchor: [7450, 3200], side: [-0.75, 0.66] },
  { id: 'stjohns',      name: "St. John's",      faction: 'english', islandId: 'antigua',       size: 'small',  anchor: [6850, -700], side: [-1, -0.15] },
  { id: 'fortroyal',    name: 'Fort Royal',      faction: 'french',  islandId: 'martinique',    size: 'medium', anchor: [6500, 4050], side: [-1, 0.2] },
  { id: 'basseterre',   name: 'Basse-Terre',     faction: 'french',  islandId: 'guadeloupe',    size: 'small',  anchor: [6250, 1150], side: [-0.6, 0.8] },
  { id: 'willemstad',   name: 'Willemstad',      faction: 'dutch',   islandId: 'curacao',       size: 'medium', anchor: [2800, 5380], side: [0.2, 1] },
  { id: 'oranjestad',   name: 'Oranjestad',      faction: 'dutch',   islandId: 'statia',        size: 'small',  anchor: [5950, -1150], side: [-1, 0.1] },
  { id: 'nassau',       name: 'Nassau',          faction: 'pirate',  islandId: 'newprovidence', size: 'small',  anchor: [750, -6280], side: [0, -1], haven: true },
  { id: 'tortuga',      name: 'Cayona',          faction: 'pirate',  islandId: 'tortuga',       size: 'small',  anchor: [1750, -4320], side: [0, 1], haven: true },
];

const COVES = [
  { id: 'cove_verde',     islandId: 'islaverde',  anchor: [-3500, 2050], side: [0.6, 0.8] },
  { id: 'cove_dominica',  islandId: 'dominica',   anchor: [6560, 2700], side: [1, 0.2] },
  { id: 'cove_grenada',   islandId: 'grenada',    anchor: [6000, 5450], side: [1, -0.1] },
  { id: 'cove_juventud',  islandId: 'juventud',   anchor: [-4650, -2100], side: [0, 1] },
  { id: 'cove_providencia', islandId: 'providencia', anchor: [-6000, 4400], side: [-0.7, 0.7] },
  { id: 'cove_cozumel',   islandId: 'cozumel',    anchor: [-7300, -1700], side: [1, 0] },
  // sea tiers: two more lairs on the trade routes (src/game/pirateLords.js lairSites)
  { id: 'cove_hispaniola', islandId: 'hispaniola', anchor: [1100, -2800], side: [0, 1] },
  { id: 'cove_borinquen',  islandId: 'puertorico', anchor: [5750, -2650], side: [0.1, 1] },
];

// Fishing villages: neutral ports of call (src/game/village.js, settings in src/data/villages.js), sited by
// islands.js like the ports (`anchor` on land, `side` toward open sea). Invented names. `sells`: local goods,
// sold cheap; the village buys everything else back at a low price.
const VILLAGES = [
  { id: 'v_cayman',   name: 'Turtle Cove',      islandId: 'grandcayman', anchor: [-5450, -1000], side: [0, 1], sells: ['food', 'salt', 'hides'], seed: 11 },
  { id: 'v_roncador', name: 'Netmender’s Point', islandId: 'roncador',   anchor: [-2200, 3900],  side: [0, -1], sells: ['food', 'salt'], seed: 23 },
  { id: 'v_swan',     name: 'Driftwood',        islandId: 'swan',        anchor: [-6200, 1500],  side: [1, 0], sells: ['food', 'timber'], seed: 37 },
  { id: 'v_andros',   name: 'The Mangroves',    islandId: 'andros',      anchor: [-1400, -5800], side: [1, 0.2], sells: ['food', 'timber', 'salt'], seed: 41 },
  { id: 'v_redes',    name: 'Punta Redes',      islandId: 'main',        anchor: [600, 7700],    side: [0, -1], sells: ['food', 'hides', 'timber'], seed: 53 },
  { id: 'v_pargo',    name: 'Caleta Pargo',     islandId: 'main',        anchor: [5300, 7800],   side: [0, -1], sells: ['food', 'cocoa', 'hides'], seed: 67 },
];

const BANKS = [
  { x: 600, z: -6150, rx: 3600, rz: 1350, depth: -8 },
  { x: -1500, z: -5950, rx: 1100, rz: 1300, depth: -6.5 },
  { x: -5450, z: -1000, rx: 900, rz: 500, depth: -9 },
  { x: -900, z: 2900, rx: 1600, rz: 1000, depth: -12 },
  { x: -6800, z: -5700, rx: 1300, rz: 1100, depth: -11 },
  { x: 3200, z: -6800, rx: 1300, rz: 700, depth: -7 },
];

// Production/demand profiles per port (supply/demand 0..1). Good not listed = neutral (0.3 / 0.4).
const ECONOMY = {
  havana:       { supply: { tobacco: 0.95, sugar: 0.7, hides: 0.5, silver: 0.3 }, demand: { cloth: 0.9, arms: 0.7, food: 0.6, spice: 0.6 } },
  santiago:     { supply: { tobacco: 0.8, coffee: 0.6, timber: 0.6 }, demand: { cloth: 0.8, powder: 0.6, rum: 0.5 } },
  santodomingo: { supply: { sugar: 0.85, cocoa: 0.7, hides: 0.8 }, demand: { cloth: 0.9, arms: 0.7, spice: 0.7 } },
  sanjuan:      { supply: { sugar: 0.7, coffee: 0.75, food: 0.6 }, demand: { cloth: 0.8, rum: 0.5, powder: 0.7 } },
  cartagena:    { supply: { silver: 0.95, cocoa: 0.8, indigo: 0.5, hides: 0.6 }, demand: { cloth: 1, arms: 0.8, food: 0.7, rum: 0.6 } },
  portroyal:    { supply: { rum: 0.9, sugar: 0.8, cotton: 0.4 }, demand: { food: 0.7, timber: 0.6, silver: 0.8, spice: 0.6 } },
  bridgetown:   { supply: { sugar: 1, rum: 0.85, cotton: 0.5 }, demand: { food: 0.9, timber: 0.8, cloth: 0.6 } },
  stjohns:      { supply: { sugar: 0.75, salt: 0.6 }, demand: { food: 0.8, timber: 0.7, arms: 0.4 } },
  fortroyal:    { supply: { sugar: 0.8, coffee: 0.7, rum: 0.6, cocoa: 0.5 }, demand: { cloth: 0.7, food: 0.6, arms: 0.6 } },
  basseterre:   { supply: { coffee: 0.8, cotton: 0.6, indigo: 0.6 }, demand: { food: 0.7, cloth: 0.6, powder: 0.5 } },
  willemstad:   { supply: { salt: 0.9, cloth: 0.7, arms: 0.6, spice: 0.7 }, demand: { tobacco: 0.8, sugar: 0.7, cocoa: 0.8, hides: 0.6 } },
  oranjestad:   { supply: { arms: 0.8, powder: 0.8, cloth: 0.6, spice: 0.5 }, demand: { sugar: 0.7, tobacco: 0.7, cotton: 0.6 } },
  nassau:       { supply: { salt: 0.7, timber: 0.6, food: 0.3 }, demand: { rum: 0.9, powder: 0.9, arms: 0.8, food: 0.8 } },
  tortuga:      { supply: { hides: 0.9, timber: 0.8, food: 0.5 }, demand: { rum: 1, powder: 0.9, arms: 0.9, cloth: 0.6 } },
};

const SIZE_POP = { small: 900, medium: 2600, large: 6000 };

// Default terrain parameters per island type.
const TYPE_DEFAULTS = {
  mountain: { beachW: 34, shelfW: 150, shelfDepth: 4.5, dropW: 260, dropDepth: 60, hill: 22, warp: 140, coastAmp: 70, cliffH: 34, moist: 0.85, dry: 0.05, reef: 0.3 },
  jungle:   { beachW: 30, shelfW: 170, shelfDepth: 4.0, dropW: 240, dropDepth: 60, hill: 16, warp: 90,  coastAmp: 40, cliffH: 24, moist: 0.95, dry: 0.0,  reef: 0.5 },
  volcanic: { beachW: 26, shelfW: 130, shelfDepth: 5.0, dropW: 220, dropDepth: 70, hill: 14, warp: 70,  coastAmp: 40, cliffH: 30, moist: 0.85, dry: 0.0,  reef: 0.3 },
  flat:     { beachW: 46, shelfW: 240, shelfDepth: 3.2, dropW: 280, dropDepth: 55, hill: 8,  warp: 90,  coastAmp: 45, cliffH: 10, moist: 0.65, dry: 0.15, reef: 0.7 },
  cay:      { beachW: 40, shelfW: 320, shelfDepth: 2.6, dropW: 300, dropDepth: 50, hill: 1.5, warp: 40, coastAmp: 22, cliffH: 3,  moist: 0.5, dry: 0.3,  reef: 1.0 },
  dry:      { beachW: 30, shelfW: 140, shelfDepth: 4.0, dropW: 230, dropDepth: 60, hill: 12, warp: 70,  coastAmp: 40, cliffH: 16, moist: 0.25, dry: 0.85, reef: 0.7 },
  mainland: { beachW: 40, shelfW: 200, shelfDepth: 4.5, dropW: 400, dropDepth: 55, hill: 30, warp: 260, coastAmp: 150, cliffH: 40, moist: 0.9, dry: 0.05, reef: 0.3 },
  atoll:    { beachW: 18, shelfW: 160, shelfDepth: 3.0, dropW: 260, dropDepth: 60, hill: 0, warp: 30, coastAmp: 0, cliffH: 0, moist: 0.5, dry: 0.3, reef: 1.0 },
};

export function generateWorld(seed = 1717) {
  const islands = ISLANDS.map(src => {
    const r = mulberry32((seed ^ hashString(src.id)) >>> 0);
    const j = (a) => (r() * 2 - 1) * a;
    const d = TYPE_DEFAULTS[src.type];
    const scale = 0.94 + r() * 0.12;
    const shift = src.id.startsWith('rk_') ? [j(0), j(0)] : [j(90), j(90)];   // rocks stay where placed (r() still consumed)
    const isl = {
      ...d, ...src,
      cliff: src.cliff ?? 0,
      moist: src.moist ?? d.moist,
      dry: d.dry + (src.type === 'dry' ? 0 : 0),
      reef: src.reef ?? d.reef,
      shelfW: (src.shelfW ?? d.shelfW) * (0.9 + r() * 0.2),
      peak: (src.peak ?? 20) * (0.88 + r() * 0.24),
      noiseOff: [r() * 1000, r() * 1000],
      faction: null,
      shift,
    };
    if (isl.type === 'main') isl.shift = [0, 0];
    if (isl.spine) {
      // the mainland and big islands keep their shape; others jitter more
      const big = isl.type === 'mainland';
      isl.spine = src.spine.map(([x, z, rad]) => [x + (big ? 0 : shift[0]), z + (big ? 0 : shift[1]), rad * (big ? 1 : scale)]);
      let cx = 0, cz = 0;
      for (const p of isl.spine) { cx += p[0]; cz += p[1]; }
      cx /= isl.spine.length; cz /= isl.spine.length;
      let rad = 0;
      for (const p of isl.spine) rad = Math.max(rad, Math.hypot(p[0] - cx, p[1] - cz) + p[2]);
      isl.x = cx; isl.z = cz; isl.radius = rad;
      if (src.volcano) isl.volcano = { ...src.volcano, at: [src.volcano.at[0] + shift[0], src.volcano.at[1] + shift[1]], h: src.volcano.h * (0.9 + r() * 0.2) };
    } else {
      isl.center = [src.center[0] + shift[0], src.center[1] + shift[1]];
      isl.x = isl.center[0]; isl.z = isl.center[1]; isl.radius = src.ringR + src.ringW;
      isl.passAngle = r() * Math.PI * 2;
    }
    if (isl.type === 'mainland') { isl.x = -1000; isl.z = 7300; isl.radius = 9000; }
    return isl;
  });
  const byId = Object.fromEntries(islands.map(i => [i.id, i]));

  const goodIds = Object.keys(GOODS);
  const ports = PORTS.map(src => {
    const r = mulberry32((seed ^ hashString('port:' + src.id)) >>> 0);
    const isl = byId[src.islandId];
    const eco = ECONOMY[src.id] || { supply: {}, demand: {} };
    const goods = {};
    for (const g of goodIds) {
      const supply = Math.min(1, Math.max(0, (eco.supply[g] ?? 0.25) + (r() - 0.5) * 0.15));
      const demand = Math.min(1, Math.max(0, (eco.demand[g] ?? 0.35) + (r() - 0.5) * 0.15));
      const price = Math.round(GOODS[g].basePrice * (1 + 0.6 * demand - 0.55 * supply) * (0.95 + r() * 0.1));
      goods[g] = { price: Math.max(2, price), supply: +supply.toFixed(2), demand: +demand.toFixed(2) };
    }
    const s = Math.hypot(src.side[0], src.side[1]);
    const port = {
      ...src,
      anchor: [src.anchor[0] + isl.shift[0], src.anchor[1] + isl.shift[1]],
      side: [src.side[0] / s, src.side[1] / s],
      haven: !!src.haven,
      goods,
      population: Math.round(SIZE_POP[src.size] * (0.8 + r() * 0.4)),
      fortSide: r() < 0.5 ? -1 : 1,
      townSeed: Math.floor(r() * 1e9),
    };
    if (!isl.faction) isl.faction = src.faction;
    return port;
  });

  const coves = COVES.map(c => {
    const isl = byId[c.islandId];
    const s = Math.hypot(c.side[0], c.side[1]);
    return { ...c, anchor: [c.anchor[0] + isl.shift[0], c.anchor[1] + isl.shift[1]], side: [c.side[0] / s, c.side[1] / s] };
  });

  const villages = VILLAGES.map(v => {
    const isl = byId[v.islandId];
    const s = Math.hypot(v.side[0], v.side[1]);
    return { ...v, anchor: [v.anchor[0] + isl.shift[0], v.anchor[1] + isl.shift[1]], side: [v.side[0] / s, v.side[1] / s] };
  });

  return { islands, ports, coves, villages, banks: BANKS.map(b => ({ ...b })) };
}
