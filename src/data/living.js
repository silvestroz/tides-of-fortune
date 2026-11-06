// Settings of the living world (src/game/living.js): diplomacy, pirate hunters, trade profiles, announced convoys,
// growth of towns. All durations are calendar days (1 day = REAL_SECONDS_PER_DAY = 240 s of play = one day/night
// cycle, see src/game/career.js). Rates were divided down when days went from 10 s to 240 s, to keep the same
// real-time pace.

// Diplomacy: one draw every `checkEvery` days, at most one change per draw.
export const DIPLOMACY = {
  checkEvery: 1,          // one draw per day (4 min; formerly 20 days of 10 s)
  warChance: 0.10,        // neutrality -> war (per draw, spread over the neutral pairs)
  peaceChance: 0.14,      // war -> peace (only after `minWarDays`)
  allyChance: 0.05,       // neutrality -> alliance (if neither is at war with the other)
  breakChance: 0.06,      // alliance -> neutrality
  minWarDays: 6,          // a war lasts at least six days (~24 min of play)
  minPeaceDays: 5,        // a peace (or alliance) holds at least five days (~20 min)
  peaceReward: 600,       // the governor pays the captain who carries his peace proposals
  peaceRepMin: 20, otherRepMin: 0,           // reputation required with the governor / with the other side
  allyRepMin: 40, allyOtherRepMin: 25, allyRank: 2,
  // Envoy mission (peace / alliance): the governor hands over a letter for the governor of a port of the other
  // nation (the nearest is named, any port of that nation will do); the treaty only takes effect on delivery.
  // Failure: deadline passed (reputation −6, like any mission) or hostile destination port (soldiers on the quay).
  offerWarDays: 2,        // the governor offers peace after two days of war (~8 min)
  envoyDays: 4,           // delivery deadline (calendar days, ~16 min of play)
  envoyFarDays: 5,        // deadline if the named port is more than `envoyFar` m away
  envoyFar: 8000,
  envoyRep: 8,            // reputation with the governor who writes…
  envoyOtherRep: 5,       // …and with the nation that receives the letter
  peaceMerit: 3, allyMerit: 4, allyReward: 0,
};

// Pirate hunters: infamy with a nation = −reputation.
export const INFAMY = {
  threshold: 40,          // infamy from which the nation sends hunters (reputation ≤ −40)
  heavy: 70,              // beyond: two hunters at a time, heavier ships
  firstDelay: 25,         // seconds at sea before the first hunter once the threshold is crossed
  cooldown: 160,          // seconds at sea between two hunters of the same nation
  spawnMin: 1900, spawnMax: 2600,   // spawn distance (m)
  types: [['corvette', 'brig', 'raider'], ['frigate', 'heavyfrigate', 'raider']],   // [infamy ≥ threshold, ≥ heavy]
};

// Markets: volatile prices in havens (weekly factor per good), protectionism, smuggling.
export const MARKETS = {
  havenSwing: 0.4,        // ±40 % from one week to the next in havens
  protectWealth: 4,       // a port of wealth ≥ 4 of a nation at war with your flag closes its market
  contrabandWealth: 2,    // ports of wealth ≤ 2: a smuggler buys the cargo when the market is closed
  contrabandCut: 0.72,    // share of the official sale price
  foodPerPop: 0.05,       // extra barrels of provisions at equilibrium per inhabitant (large town ~6,000 → +300,
                          // medium ~2,600 → +130, small ~900 → +45; villages: nothing more). 120 men eat ~26 barrels a day
};

// Convoys announced by the barman: they set sail and really follow the route given.
export const CONVOYS = {
  planEvery: 1,           // days between two schedulings
  maxPlanned: 3,          // convoys planned or under way at once
  leadMin: 1, leadMax: 3,    // delay before sailing: 1 to 2 days
  minDist: 3000,          // minimum length of the route (m)
  treasure: 0.35,         // share of Spanish convoys that are treasure galleons
  spawnRange: 3000,       // the convoy appears when the player comes within 3 km of its position of the day
  speed: 0.55,            // fraction of a merchant's top speed used to compute the schedule
};

// Towns: one draw per day (a 4-minute day is roughly worth the former 5-minute month).
export const TOWNS = {
  growth: 0.007,          // monthly population growth (× prosperity)
  epidemic: 0.018,        // monthly risk of an epidemic (−10 to −22 % of souls, prosperity −0.12)
  raid: 0.012,            // monthly risk of a pirate raid (×2 for towns at war with a weak garrison)
  boom: 0.02,             // monthly chance of a boom (prosperity +0.15)
  garrisonBase: { small: 35, medium: 55, large: 75 },
  garrisonWar: 15,        // reinforcement while the nation is at war
  recover: 0.04,          // prosperity drifts back toward 1 (per month)
  noteDays: 4,           // how long an event stays displayed (chart, port)
};
