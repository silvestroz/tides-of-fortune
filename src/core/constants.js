// Shared world conventions. Every module MUST follow these.
//
// Units: 1 world unit = 1 metre. Y is up. Sea level is y = 0.
// Headings/angles (ships, wind): radians, 0 = north = -Z, increasing clockwise,
//   so PI/2 = east = +X.  forward(h) = (sin h, 0, -cos h).
// Wind angle = the direction the wind blows TOWARD (same convention).
// Time of day: hours 0..24 (6 = sunrise, 12 = noon, 18.5 = sunset).

export const WORLD_SIZE = 16000;          // square world, centred on origin (-8000..8000)
export const HALF_WORLD = WORLD_SIZE / 2;

export function forwardFromHeading(h, out) {
  out.set(Math.sin(h), 0, -Math.cos(h));
  return out;
}
export function headingFromVector(x, z) {
  return Math.atan2(x, -z);
}
export function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

// Factions
export const FACTIONS = {
  english: { name: 'English', color: '#b8242c' },
  spanish: { name: 'Spanish', color: '#e0b43a' },
  french:  { name: 'French',  color: '#2e5aa8' },
  dutch:   { name: 'Dutch',   color: '#e07a24' },
  pirate:  { name: 'Pirates', color: '#151515' },
};

// Render layers / quality
// QUALITY.tier is set by Game before any system is built: 'low' | 'medium' | 'high' | 'ultra'
// (from ?quality= or game.settings.quality). Systems read it at construction; changing it needs a reload
// except for post-processing (PostFX follows 'settings:change').
export const QUALITY = {
  tier: 'high',
  shadowMapSize: 2048,
  maxPixelRatio: 2,
};
export const QUALITY_TIERS = {
  //        shadow map, max DPR, cloud fraction, vegetation fraction, ocean angular segments factor, canvas MSAA
  // low/high: shipLodFarM/shipLodNearM and shadowR tightened from the 250/220 m and 90 m defaults
  // (src/ships/shipModel.js, src/world/sky.js) — hulls switch to the far LOD sooner, smaller shadow box (fewer
  // towns/ships rasterised into the shadow map, same idea as splitting towns into chunks).
  // `medium` keeps its original values (old saves / ?quality=medium) but is no longer offered in the
  // “Graphics” menu since the switch to 3 presets (QUALITY_UI_ORDER: Performance/Standard/Ultra).
  low:    { shadowMapSize: 1024, maxPixelRatio: 1,    clouds: 0.45, vegetation: 0.35, oceanSegs: 0.75, antialias: false,
            shipLodFarM: 170, shipLodNearM: 145, shadowR: 65 },
  medium: { shadowMapSize: 2048, maxPixelRatio: 1.25, clouds: 0.75, vegetation: 0.65, oceanSegs: 0.875, antialias: true  },
  high:   { shadowMapSize: 2048, maxPixelRatio: 2,    clouds: 1,    vegetation: 1,    oceanSegs: 1,    antialias: true,
            shipLodFarM: 220, shipLodNearM: 190, shadowR: 80 },
  // Ultra: spends the headroom of a desktop GPU, never on by default (proposed by src/core/gpuProbe.js).
  // shadowR: sun shadow frustum half-size (m, 90 elsewhere); shadowSoft: PCF kernel radius; vegStep: scatter grid (m,
  // 10 elsewhere -> 1.56x instances); vegNear/vegMid/vegFar/vegShadowR: vegetation LOD distances; msaa: scene MSAA
  // samples; oceanLodR: ocean LOD band radii (250 / 2000 elsewhere); cloudDetail: extra small lobes per cloud (x puffs); smaa: SMAA instead of FXAA; ao: GTAO pass; particles: VFX emission multiplier; wakeSize: wake RT size;
  // prCap: dynres pixel-ratio ceiling (supersampling on a 1x screen, dynres drops it first when frames run long).
  // shipLodFarM/shipLodNearM: hull geometry LOD switch distances (m, 250/220 elsewhere, src/ships/shipModel.js) —
  // full-detail hulls (guns, rails, ratlines) stay up further out; godRayDiv: sun-shaft render target divisor
  // (screen size / this value, 4 elsewhere, src/post/godRaysPass.js) — smaller = sharper shafts, more pixels.
  ultra:  { swell: 1.6, shadowMapSize: 4096, maxPixelRatio: 2,    clouds: 1,    cloudDetail: 0.6, vegetation: 1,    oceanSegs: 1.3,  antialias: true, oceanLodR: [380, 2800],
            shadowR: 150, shadowSoft: 2.5, vegStep: 8, vegNear: 760, vegMid: 1900, vegFar: 3600, vegShadowR: 230,
            msaa: 8, smaa: true, ao: true, particles: 1.6, wakeSize: 2048, prCap: 1.5,
            shipLodFarM: 340, shipLodNearM: 295, godRayDiv: 2.5 },
};
// “Graphics” menu: 3 presets shown instead of 4. Medium merged with Low under “Performance” —
// clicking “Performance” writes quality:'low'; `medium` stays a valid internal id (compat, never written by the
// menu) for saves and ?quality= already on that tier, also shown selected under “Performance”.
export const QUALITY_UI_ORDER = ['low', 'high', 'ultra'];
export const QUALITY_UI_LABELS = { low: 'Performance', high: 'Standard', ultra: 'Ultra' };
export const QUALITY_UI_GROUP = { low: 'low', medium: 'low', high: 'high', ultra: 'ultra' };
export function applyQualityTier(tier) {
  if (!QUALITY_TIERS[tier]) tier = 'high';
  for (const k of Object.keys(QUALITY)) if (k !== 'shadowMapSize' && k !== 'maxPixelRatio') delete QUALITY[k];
  Object.assign(QUALITY, QUALITY_TIERS[tier], { tier });
  return QUALITY;
}
