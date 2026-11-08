// Hull weathering per ship: one value, 0 = fresh from the yard, 1 = years at sea without a careening.
// The baked skin texture (art/hull.js) is painted at HULL_WEAR.base; the hull shader (art/materials.js, uniform uWear)
// lifts it toward richer, cleaner paint below that value and adds sun-faded paint, long rust and grime runs, more
// chips and a higher band of weed above it. Visual only: no effect on speed or handling.
//
//   HULL_WEAR              tuning table (roles, player drift)
//   wearForRole(role, key) AI ship wear, drawn in the role's range from a stable key (ship name)
//   playerWear(state)      the player's flagship wear (state.hullWear, absent = fresh)
//   wearSeaDay(state)      one day at sea: the flagship's hull fouls a little more
//   wearRefit(state)       hull repaired at a shipyard: back to fresh paint
export const HULL_WEAR = {
  base: 0.45,                  // the skin texture as painted (showcases, moored hulls, duel stages)
  roles: {                     // [min, max]
    patrol: [0.08, 0.32],      // navy: kept up by the arsenal
    hunter: [0.15, 0.4],
    merchant: [0.35, 0.72],
    pirate: [0.62, 1.0],       // never careened in a proper yard
  },
  player: { fresh: 0.18, perDay: 0.012, max: 0.9 },   // ~40 days at sea from fresh to well worn
  yardNew: 0.06,               // a new hull on the slipway
};

function hash01(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 10007) / 10007;
}

export function wearForRole(role, key = '') {
  const r = HULL_WEAR.roles[role]; if (!r) return HULL_WEAR.base;
  return r[0] + (r[1] - r[0]) * hash01(String(key) + '|' + role);
}

export function playerWear(state) {
  const w = state?.hullWear;
  return Number.isFinite(w) ? w : HULL_WEAR.player.fresh;
}

export function wearSeaDay(state) {
  const P = HULL_WEAR.player;
  state.hullWear = Math.min(P.max, playerWear(state) + P.perDay);
  return state.hullWear;
}

export function wearRefit(state) {
  state.hullWear = HULL_WEAR.player.fresh;
  return state.hullWear;
}
