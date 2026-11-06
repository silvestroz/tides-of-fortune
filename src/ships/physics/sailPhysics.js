// Pure sailing-physics helpers (no THREE dependency, cheap — called per ship per frame).
//
//   angleOffWind(heading, windAngle)  -> 0..PI   0 = bow straight into the wind, PI = dead downwind
//   windRelative(heading, windAngle)  -> -PI..PI bearing the wind comes FROM, relative to the bow
//                                        (0 = on the nose, +PI/2 = from starboard, -PI/2 = from port, ±PI = from astern)
//   polar(offWind)                    -> 0..1    fraction of hull speed at full sail (luffing region < ~40° returns ~0)
//   luff(offWind)                     -> 0..1    1 = sails fully luffing (in irons), 0 = drawing
//   pointOfSail(offWind)              -> 'in irons'|'close-hauled'|'beam reach'|'broad reach'|'running'
//   sailDrive(sailSetting)            -> 0..1    canvas area factor (0 furled .. 1 full)
//   rigPolar(offWind, rig) / windAffinity(type, windSpeed)  rig- and size-aware variants (see RIGS)
//   HANDLING                          per-type handling constants (mass, inertia, leeway, heel)
import { wrapAngle } from '../../core/constants.js';

const D2R = Math.PI / 180;

export function angleOffWind(heading, windAngle) {
  // wind blows TOWARD windAngle, so it comes FROM windAngle + PI
  return Math.abs(wrapAngle(heading - (windAngle + Math.PI)));
}
export function windRelative(heading, windAngle) {
  return wrapAngle(windAngle + Math.PI - heading);
}

// Polar table for a square-rigged / fore-and-aft hybrid: [deg off wind, speed fraction]
// Slowest close to the wind, best on a broad reach (~120–135°), noticeably slower dead downwind.
const POLAR = [
  // arcade: head-to-wind was too slow in practice — real sailing is realistic but stalls progress in a
  // game. Floor raised ~0.18 -> ~0.35 so the player can always claw forward, not just manoeuvre in place.
  [0, 0.35], [30, 0.42], [38, 0.55], [45, 0.68], [55, 0.78], [70, 0.88], [90, 0.95],
  [110, 1.0], [125, 1.0], [140, 0.97], [155, 0.9], [170, 0.82], [180, 0.8],
];
const POLAR_LUT = new Float32Array(181);
for (let d = 0; d <= 180; d++) {
  let i = 0; while (i < POLAR.length - 2 && POLAR[i + 1][0] < d) i++;
  const [a0, v0] = POLAR[i], [a1, v1] = POLAR[i + 1];
  let t = (d - a0) / (a1 - a0); t = t * t * (3 - 2 * t); // smooth between table points
  POLAR_LUT[d] = v0 + (v1 - v0) * t;
}
export function polar(offWind) {
  const d = Math.min(180, Math.max(0, offWind / D2R));
  const i = d | 0, f = d - i;
  return i >= 180 ? POLAR_LUT[180] : POLAR_LUT[i] * (1 - f) + POLAR_LUT[i + 1] * f;
}
export function luff(offWind) {
  const d = offWind / D2R;
  if (d <= 32) return 1;
  if (d >= 48) return 0;
  const t = (48 - d) / 16; return t * t * (3 - 2 * t);
}
export function pointOfSail(offWind) {
  const d = offWind / D2R;
  if (d < 40) return 'in irons';
  if (d < 70) return 'close-hauled';
  if (d < 112) return 'beam reach';
  if (d < 155) return 'broad reach';
  return 'running';
}
export function sailDrive(s) {
  if (s <= 0) return 0;
  return Math.pow(Math.min(1, s), 0.75);
}

// Per-type handling. mass = relative displacement (brig = 1); accelTau = seconds to reach ~63% of target speed;
// yawTau = rudder→yaw-rate response lag; leeway = sideways slip factor; heelMax = max wind heel (rad);
// stiffness = buoyancy spring natural frequency (rad/s); bigger ships wallow slower.
export const HANDLING = {
  sloop:       { mass: 0.40, accelTau: 6.5,  yawTau: 0.55, leeway: 0.055, heelMax: 0.20, stiffness: 2.6 },
  schooner:    { mass: 0.62, accelTau: 7.5,  yawTau: 0.65, leeway: 0.050, heelMax: 0.18, stiffness: 2.3 },
  brig:        { mass: 1.00, accelTau: 9.5,  yawTau: 0.85, leeway: 0.045, heelMax: 0.15, stiffness: 2.0 },
  merchantman: { mass: 1.30, accelTau: 12.5, yawTau: 1.10, leeway: 0.050, heelMax: 0.12, stiffness: 1.8 },
  frigate:     { mass: 1.90, accelTau: 13.0, yawTau: 1.20, leeway: 0.035, heelMax: 0.11, stiffness: 1.6 },
  galleon:     { mass: 2.60, accelTau: 16.0, yawTau: 1.45, leeway: 0.040, heelMax: 0.09, stiffness: 1.4 },
};

// --- Rig character -----------------------------------------------------------------------------------
// Each hull type carries a rig. The rig reshapes the base polar (multiplier per angle off the wind):
//   square   : blunt into the wind, happiest running / on a broad reach
//   fore-aft : points high, best on a beam reach, loses drive dead downwind
//   mixed    : the base polar unchanged (balanced)
// Curves are normalised so each rig peaks at 1.0 (top speed per class unchanged, only its shape differs).
export const RIGS = {
  sloop: 'fore-aft', schooner: 'fore-aft', brig: 'mixed',
  merchantman: 'square', frigate: 'square', galleon: 'square',
};
const RIG_MUL = {
  square:     [[0, 0.9], [38, 0.72], [45, 0.8], [55, 0.85], [70, 0.9], [90, 0.92], [110, 0.98], [125, 1.03], [140, 1.09], [155, 1.17], [170, 1.22], [180, 1.22]],
  'fore-aft': [[0, 1], [38, 1.6], [45, 1.25], [55, 1.2], [70, 1.16], [90, 1.12], [110, 1.04], [125, 0.98], [140, 0.93], [155, 0.88], [170, 0.84], [180, 0.84]],
  mixed:      [[0, 1], [180, 1]],
};
function lerpTable(T, d) {
  let i = 0; while (i < T.length - 2 && T[i + 1][0] < d) i++;
  const [a0, v0] = T[i], [a1, v1] = T[i + 1];
  const t = Math.min(1, Math.max(0, (d - a0) / (a1 - a0)));
  return v0 + (v1 - v0) * t;
}
const RIG_LUT = {};
for (const r of Object.keys(RIG_MUL)) {
  const L = new Float32Array(181); let mx = 0;
  for (let d = 0; d <= 180; d++) { L[d] = POLAR_LUT[d] * lerpTable(RIG_MUL[r], d); mx = Math.max(mx, L[d]); }
  for (let d = 0; d <= 180; d++) L[d] /= mx;
  RIG_LUT[r] = L;
}
// rig-aware polar: 0..1 fraction of hull speed
export function rigPolar(offWind, rig = 'mixed') {
  const L = RIG_LUT[rig] || RIG_LUT.mixed;
  const d = Math.min(180, Math.max(0, offWind / D2R));
  const i = d | 0, f = d - i;
  return i >= 180 ? L[180] : L[i] * (1 - f) + L[i + 1] * f;
}
// Wind affinity by size: small hulls ghost along in light airs, heavy ones need a blow to get going.
// k > 0 favours strong wind. Returns a multiplier (~0.85..1.15) applied to drive.
export const WIND_AFFINITY = { sloop: -0.15, schooner: -0.10, brig: 0, merchantman: 0.08, frigate: 0.12, galleon: 0.15 };
export function windAffinity(type, windSpeed, nominal = 9) {
  const k = WIND_AFFINITY[type] ?? 0;
  const x = Math.max(-1, Math.min(1, (windSpeed - nominal) / nominal));
  return 1 + k * x;
}

// derived ship types (src/data/shipTypes.js) inherit their base type's handling, scaled by size
// (mass ∝ scale^2.5, response lags ∝ √scale), their own rig, and a size-shifted wind affinity.
import { SHIP_TYPES } from '../../data/shipTypes.js';
for (const [id, t] of Object.entries(SHIP_TYPES)) {
  RIGS[id] = t.rig;
  if (HANDLING[id]) continue;
  const b = HANDLING[t.base], k = t.scale, r = Math.sqrt(k);
  HANDLING[id] = { ...b, mass: +(b.mass * k ** 2.5).toFixed(3), accelTau: b.accelTau * r, yawTau: b.yawTau * r, heelMax: b.heelMax / r, stiffness: b.stiffness / r };
  WIND_AFFINITY[id] = Math.max(-0.18, Math.min(0.18, WIND_AFFINITY[t.base] + (k - 1) * 0.25));
}

