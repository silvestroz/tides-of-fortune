// Town assaults: settings of the land battle and its aftermath.
// All values are the game's own (in-house balancing).
export const LAND = {
  cell: 10, W: 48, H: 32,          // tactical grid: 48 × 32 cells of 10 m (480 × 320 m)
  timeLimit: 240,                  // s: past this delay, the assault is repulsed
  holdTime: 20, squareR: 42,       // hold the square for 20 s with no able defender within 42 m = victory
  manPerUnit: 22, playerUnitsMax: 6, enemyUnitsMax: 7,
  shipGuard: 0.1,                  // share of the crew that stays aboard
  woodSpot: 40,                    // a company in the woods is only seen at this distance (or when it fires)
  revealT: 4,                      // s of visibility after firing
  routMorale: 25, rallyMorale: 50,
  hillBonus: 1.3, woodCover: 0.5, flankMul: 1.5, meleeR: 9,
  killMelee: 0.016, killFire: 0.5,  // casualties inflicted per man per second (melee) / multiplier of the volleys
  moraleLoss: 80,                  // morale loss = share of the force lost × moraleLoss
  pillage: { base: 300, perWealth: 360, jitter: 0.35 },
  sea: { hullPerGarrison: 0.32, crewPerGarrison: 0.09, defenderCut: 0.3 },   // assault from the sea: the fort fires first
  haven: { bonus: 0.4, maxDist: 9000 },                                      // haven: reinforcement of freebooters
  rep: { newNation: 12, oldNation: -30, plunder: -18, merit: 6 },
  prison: 0.5,                     // complete defeat: risk of being captured
  town: { garrisonLeft: 8, prosper: -0.3, pop: 0.9, repulsed: 0.6 },
};

// Troop types. fire = casualties per man per volley at good range; reload in s; aura = officer (rallying).
export const UNIT_KINDS = {
  sabreurs:      { name: 'Cutlassmen',    speed: 6.5, melee: 1.0,  fire: 0,     range: 0,  reload: 0, morale: 72, color: '#8a2a1f' },
  mousquetaires: { name: 'Musketeers',    speed: 5.6, melee: 0.45, fire: 0.075, range: 85, reload: 5, morale: 62, color: '#3d5a2a' },
  officiers:     { name: 'Officers',      speed: 6.2, melee: 0.9,  fire: 0.05,  range: 50, reload: 6, morale: 95, aura: 60, color: '#2b2f4a' },
  milice:        { name: 'Militia',       speed: 5.0, melee: 0.5,  fire: 0.05,  range: 70, reload: 7, morale: 55 },
  gardes:        { name: 'Guards',        speed: 5.2, melee: 0.8,  fire: 0.07,  range: 80, reload: 5.5, morale: 82 },
  cavalerie:     { name: 'Cavalry',       speed: 11,  melee: 1.15, fire: 0,     range: 0,  reload: 0, morale: 66, charge: 1.6, mounted: true },
};

// Garrison coat colour by nation (matching the flags).
export const NATION_COATS = { english: '#9b2b24', spanish: '#c9a54a', french: '#2d4c8f', dutch: '#d07a2a', pirate: '#3a3a3a' };
