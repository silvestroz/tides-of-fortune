// Fishing villages: settings and texts of these neutral ports of call (src/game/village.js); the list of villages
// (name, island, coast, goods sold) is VILLAGES in src/data/world.js.
//   VILLAGE.repair     refit: price × mul (no rank privilege), hull raised up to hullCap of max hull, sails to
//                      100 %; hours spent at the quay (career.advanceHours) per hull / sails
//   VILLAGE.trade      prices: local goods at sellK × base price (buying ≈ ×1.08 more), everything else bought back
//                      at ≈ buyK × price; small market (size 'small'), it settles fast when you sell
//   VILLAGE.men        fishermen to sign on: [min, max] per village, +perDay per day, price per man
//   VILLAGE.news       news: ships one class above the player within this radius (m), Top 10 lairs
//   VILLAGE.hours      hours spent ashore when landing (like PORT_HOURS)
//   VILLAGE.enterR     landing distance (m), like a port
export const VILLAGE = {
  hours: 3,
  enterR: 400,
  repair: { mul: 1.4, hullCap: 0.9, hullHours: 6, sailHours: 3 },
  trade: { sellK: 0.72, buyK: 0.76 },
  men: { range: [3, 8], perDay: 1, cost: 20 },
  news: { radius: 5000, lairR: 6500 },
};

export const VILLAGE_TEXT = {
  sub: 'Fishing village · no flag',
  welcome: [
    'Boats drawn up on the sand, nets drying, a smell of smoked fish. Nobody here asks where you come from.',
    'The fishermen barely look up. An old man waves you towards the slipway.',
    'A few huts at the water’s edge, a jetty of grey wood. They offer you fresh water without asking questions.',
  ],
  repairNote: 'No dry dock here: they caulk and patch, the hull only comes back to 90%.',
  repairFull: 'The sails are mended and the hull holds. For the rest you will need a real shipyard.',
  hullDone: 'The fishermen caulk and nail on new planks. It took them the whole day.',
  sailDone: 'The village women darn the canvas, singing as they work.',
  noGold: 'Your purse is too thin to pay the carpenters.',
  tradeNote: 'The village sells what it fishes and grows, and buys the rest cheap without asking where it comes from.',
  menNone: 'Nobody in the village wants to sign on for now.',
  menDone: n => `${n} fisherm${n > 1 ? 'en leave' : 'an leaves'} the nets to join your crew.`,
  quiet: 'Nothing threatening in sight from the point, so the fishermen say.',
};
