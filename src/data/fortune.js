// Long-term goals. Original tables: ship's specialists, special items, treasure maps, the Top 10 pirate captains,
// retirement trades and the weighting of the final score. Single source: the logic is in src/game/fortune.js,
// src/game/pirateLords.js and src/game/retirement.js.

// ---- Specialists: one of each at most, found aboard prizes (capture screen). Effects read through Fortune.fx.
export const SPECIALISTS = {
  carpenter:    { name: 'Carpenter',       effect: 'R repairs ×1.6 on the hull, ceiling at sea 85%' },
  sailmaker:    { name: 'Sailmaker',       effect: 'R repairs ×1.6 on the sails, +4% speed' },
  cooper:       { name: 'Cooper',          effect: 'Provisions eaten −30%' },
  gunner:       { name: 'Gunner',          effect: 'Broadside reload −15%' },
  surgeon:      { name: 'Surgeon',         effect: 'Men lost under fire −30%, hunger less deadly, lighter wounds' },
  navigator:    { name: 'Navigator',       effect: '+5% speed, the hull scrapes less on reefs (−50%)' },
  quartermaster:{ name: 'Quartermaster',   effect: 'Morale wear at sea −40%, desertions −50%' },
  cook:         { name: 'Cook',            effect: 'Morale +0.4 per day at sea while provisions last' },
};
export const SPECIALIST_IDS = Object.keys(SPECIALISTS);
// chance that a specialist not yet aboard is found on a prize, by the role of the captured ship
export const SPECIALIST_CHANCE = { merchant: 0.3, patrol: 0.4, hunter: 0.45, pirate: 0.4, lord: 1 };

// ---- Special items: 10 categories × 2 levels. state.items[cat] = 1 | 2.
export const ITEMS = {
  sword:      { name: ['Toledo sword', 'Master’s blade'],             effect: ['Duel wind-up −8%', 'Duel wind-up −15%'] },
  pistol:     { name: ['Horse pistol', 'Brace of pistols'],            effect: ['A shot when boarding: 60% chance to wound', 'A shot when boarding: a sure wound'] },
  armor:      { name: ['Leather breastplate', 'Steel cuirass'],        effect: ['+1 wound taken in a duel', '+2 wounds taken in a duel'] },
  spyglass:   { name: ['Spyglass', 'Dutch telescope'],                 effect: ['Sight range +25% (chart, ships identified)', 'Sight range +50% (chart, ships identified)'] },
  barometer:  { name: ['Barometer', 'Marine barometer'],               effect: ['Storm damage −40%', 'Storm damage −65%'] },
  disguise:   { name: ['Merchant’s coat', 'False papers and a wig'],   effect: ['Hostile port: 60% chance to slip past the soldiers', 'Hostile port: never arrested, market and shipyard open'] },
  instrument: { name: ['Fiddle', 'Bagpipes'],                          effect: ['Morale +0.3 per day at sea', 'Morale +0.6 per day at sea'] },
  remedy:     { name: ['Cinchona bark', 'Physician’s chest'],          effect: ['Deaths from hunger −40%, health +5', 'Deaths from hunger −70%, health +10'] },
  jewel:      { name: ['Signet ring', 'Pearl necklace'],               effect: ['Mission rewards +10%', 'Mission rewards +20%'] },
  hat:        { name: ['Laced tricorn', 'Plumed hat'],                 effect: ['Volunteers +20%, bounty −10%', 'Volunteers +40%, bounty −20%'] },
  lockpick:   { name: ['Skeleton key', 'Lockpicking kit'],             effect: ['Escape: the grille gives in 3.5 s instead of 7', 'Escape: the grille gives in 1.5 s'] },
};
export const ITEM_IDS = Object.keys(ITEMS);
export const ITEM_PRICE = [0, 900, 2800];        // base price at the traveller, per level (±25 %)
export const MAP_PIECE_PRICE = 450;              // one treasure-map piece from the traveller

// ---- Treasure maps: 4 pieces → an assembled map that shows a cove (islands.coves).
export const TREASURE = {
  pieces: 4,
  digRange: 320,                 // m: distance to the spot on the beach to dig (F)
  gold: [3500, 9000],            // gold found
  itemChance: 0.5,               // an item (level 2 at 40 %) in the chest
  avengerDelay: [20, 45],        // s before the avenging pirate appears
  captureMapChance: 0.22,        // a piece in a prize's strongbox
  captureItemChance: 0.1,        // an item in a prize's strongbox
};

// ---- Top 10 pirate captains (original names). fame = renown (ranking), lair = cove id or 'haven'.
// difficulty = duel level; type = ship.
export const PIRATE_LORDS = [
  { id: 'gallowglass', name: 'Ambrose Gallowglass', nick: 'the Raven',       ship: 'Crown of Ashes',      type: 'heavyfrigate', fame: 300, difficulty: 0.92 },
  { fem: true, id: 'hespera',     name: 'Hespera Quill',       nick: 'Mother Grey',     ship: 'Last Word',           type: 'frigate',      fame: 260, difficulty: 0.88 },
  { id: 'wrenn',       name: 'Tobias Wrenn',        nick: 'Clinker',         ship: 'Iron Jaw',            type: 'raider',       fame: 225, difficulty: 0.85 },
  { fem: true, id: 'ardent',      name: 'Salomé Ardent',       nick: 'the Red Widow',   ship: 'Veuve Rouge',         type: 'lightfrigate', fame: 195, difficulty: 0.82 },
  { id: 'coldwater',   name: 'Jasper Coldwater',    nick: 'Icewater',        ship: 'Restless',            type: 'corvette',     fame: 165, difficulty: 0.78 },
  { id: 'malbec',      name: 'Ignace Malbec',       nick: 'Three-Fingers',   ship: 'Bonne Aubaine',       type: 'snow',         fame: 140, difficulty: 0.74 },
  { fem: true, id: 'harrowgate',  name: 'Rosalind Harrowgate', nick: 'the Lantern',     ship: 'Will-o’-the-Wisp',    type: 'topschooner',  fame: 115, difficulty: 0.7 },
  { id: 'lamproie',    name: 'Bastien Lamproie',    nick: 'the Leech',       ship: 'Ventouse',            type: 'brig',         fame: 95,  difficulty: 0.66 },
  { id: 'skarre',      name: 'Nils Skarre',         nick: 'the Mute',        ship: 'Silence',             type: 'brigantine',   fame: 75,  difficulty: 0.62 },
  { id: 'pinch',       name: 'Ezekiel Pinch',       nick: 'Little Iron',     ship: 'Sea Flea',            type: 'cutter',       fame: 55,  difficulty: 0.58 },
];
export const LORD_TUNING = {
  spawnRange: 3600,      // m: a captain puts to sea near his lair when the player approaches it
  cruise: 900,           // m: cruising radius around the lair
  maxAlive: 2,
  respawnDays: 1,        // a captain who fled puts to sea again after this delay
  goldBonus: [2500, 6000],
  crewF: 1.0,            // full crew
  gunPower: 1.15,
};
// the player's renown (ranking): base + per prize, rank, mission, treasure, pirate captain defeated
export const PLAYER_FAME = { capture: 3, rank: 4, mission: 3, treasure: 12, lord: 40 };

// ---- End of career
export const AGEING = {
  retireAge: 58,                 // forced retirement at this age (was 62)
  healthAgeFrom: 34,             // health declines beyond this age (was 38)
  healthPerYear: 5,              // health points lost per year beyond it (was 4; health reaches zero at 54 without wounds)
  healthPerWound: 9,             // per wound (duel lost, shipwreck)
  surgeonWound: 0.6,             // the surgeon eases wounds
  duelAgeSlow: 0.012,            // duel wind-up +1.2 % per year beyond healthAgeFrom
};
// Final score: each line is shown on the retirement screen.
export const SCORE = {
  wealthDiv: 250,                // (savings + gold) / 250
  rank: 10,                      // per rank held (all nations together)
  acresDiv: 40,                  // acres / 40
  capture: 2, mission: 5, treasure: 20, lord: 25, topLordBonus: 30,   // defeating the n° 1
  spouse: 40,                    // married in an older save (a governor's daughter, state.spouse)
  agePenaltyFrom: 45, agePenalty: 2, wound: 3,
};
// Retirement trade by score (minimum threshold).
export const RETIRE_TRADES = [
  [0,   'Beggar',                 'You end your days holding out your hand on the quay, telling of your prizes to anyone who buys a drink.'],
  [30,  'Fisherman',              'A boat, some nets and the memory of broadsides.'],
  [70,  'Tavern keeper',          'Your tavern is the busiest in the port: people come for your stories.'],
  [120, 'Merchant',               'A counting house on the harbour and a few chartered ships.'],
  [180, 'Shipowner',              'Your ships fly your flag on every trade route.'],
  [250, 'Planter',                'A great plantation, a house with columns and land as far as the eye can see.'],
  [330, 'Harbour master',         'The Crown entrusts you with the policing of its roads.'],
  [420, 'King’s councillor',      'You are consulted on the affairs of the colonies.'],
  [520, 'Lieutenant governor',    'You govern in the King’s name in his absence.'],
  [650, 'Governor',               'The palace is yours: your career ends at the summit.'],
];
export function retireTrade(score) {
  let r = RETIRE_TRADES[0];
  for (const t of RETIRE_TRADES) if (score >= t[0]) r = t;
  return { min: r[0], title: r[1], text: r[2], next: RETIRE_TRADES[RETIRE_TRADES.indexOf(r) + 1] || null };
}
