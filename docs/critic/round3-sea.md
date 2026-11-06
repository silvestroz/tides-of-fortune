# Critic round 3 (FINAL) - SEA systems

Shots judged (fresh, SwiftShader, shots/critic3/, each vs shots/critic2/): ocean_15, sky_192, sky_storm, ships, sailing_p4, combat, combat_ai.
Pirates! (2004) reference = the round-1/2 from-memory description (unchanged): saturated flat-ish blue water with simple sparkle, chunky textured hulls sitting firmly in the water, cream sails, small puffy sprites for smoke, readable faction by hull/sail colour.

## Verdicts and scores (ours / Pirates!, delta vs round-2 ours)
| Axis | Ocean | Sky/post | Ships | Sailing/cam | Combat |
|---|---|---|---|---|---|
| Materials/texture | 8/5 (=) | 8/5 (=) | 8/6 (=) | 7/6 (=) | 7/6 (=) |
| Lighting/atmosphere | 8/5 (=) | 9/6 (=) | 8/6 (+1) | 8/6 (=) | 8/6 (+1) |
| Silhouette/shape | n/a | 7/6 (=) | 8/7 (=) | 8/7 (=) | 7/6 (=) |
| Motion (still-inferred) | 7/5 (=) | 7/5 (=) | 6/6 (=) | 6/7 (=) | 7/6 (=) |
| VFX | 8/5 (=) | 9/5 (+1) | n/a | 7/5 (=) | 8/6 (+1) |
| Composition/readability | 8/7 (=) | 8/6 (=) | 8/8 (=) | 8/7 (=) | 8/8 (+1) |
| Art-direction coherence | 8/7 (=) | 9/6 (+1) | 8/8 (+1) | 8/7 (=) | 8/8 (+1) |
| Technical artefacts (higher=cleaner) | 7/7 (=) | 8/7 (=) | 7/8 (=) | 6/8 (=) | 7/8 (+1) |

## Per system
- OCEAN: FAIL (marginal; wins every look axis, ties on artefacts). Fixed: nothing visible changed vs round 2 (ocean_15 near-identical). Remaining:
  1. Ship contact: hull undersides/stern still show a gap to the water, no darkened/foam ring (ocean_15 stern, left ship).
  2. 10-40 m band is still a horizontal streak/smear with hard turquoise/navy patch edges.
  3. Horizon still dead flat; no long-wavelength swell visible at the skyline.
  4. Secondary faint wake streak at lower-left persists.
- SKY/POST: FAIL only on artefacts/motion parity; look is a clear win. FIXED: sunset glitter path (bright broken sparkle column under the sun, sky_192) and radial god-rays from the sun (huge improvement); storm clouds near the bolt are now lit/bright and the bolt reads as lit sky (sky_storm); island now has visible tree canopy structure. Remaining:
  1. Storm ship floats on a flat flat-shaded waterline (no wake, no foam at hull).
  2. Sunset ship is near-silhouetted/overexposed by bloom; hull detail lost.
  3. Cloud sprites at top of sky_192 are still blobby clustered puffs.
- SHIPS: FAIL (close). FIXED: faction identity - hull colours now differ per faction (olive/brown/tan vs old uniform navy), red wale bands on the sails and bigger pennants/flags are readable at 150-250 m (ships.png vs critic2). Remaining:
  1. Waterline: hulls still look perched; keel/underside visible, no boot-topping dark band, no contact foam at rest.
  2. Hulls read thin/flat-sided from the beam; little tumblehome/freeboard mass versus Pirates!' chunky hulls.
  3. Hull paint is flat-ish; strakes/wear faint at distance.
  4. Hull-to-sea scale: small ships look toy-like against the large wave texture.
- SAILING/CAMERA: FAIL (close). Essentially unchanged from round 2 (sailing_p4 identical framing, 8.8 kn, HUD fine; HUD text a touch bolder). WATERLINE specifically: bow splash and a short white wake exist, but the starboard hull side and stern show no contact foam and no dark waterline band; the keel line reads as a hard edge over water ("cut-out" look). Remaining:
  1. No hull-contact foam/wet-darkening along the length of the hull while sailing (only bow splash).
  2. Hull does not visibly heel/heave with the swell in the still; looks rigid.
  3. Stern wake starts detached from the transom.
- COMBAT: FAIL (close; best improvement this round). FIXED: muzzle flash is bright with additive bloom and smoke; shot tracer trails with glowing streaks and a visible splash column + ring ripple (combat_ai); target hull flash larger; HUD log trimmed. Remaining:
  1. Fire/impact on target hull still modest; hit sparks/splinters absent in combat.png vs previous.
  2. Hull of player ship at frame edge is clipped/flat (red/gold slab) - ugly foreground.
  3. Tracer dots look like beads on a string, uniform spacing.
  4. In view=ai both ships sit slightly above water (waterline issue again).

## Overall blind verdict
Cumulative: ocean, sky, storm, sunset, and combat VFX beat Pirates! (2004) clearly. Ships and waterline are the single recurring weakness: hulls look perched with no contact foam/dark band, and a few motion/artefact axes remain at or below parity, so strict WIN criteria (every axis) are not met on any system. But an average player, blind, choosing the sea experience would pick ours: far richer water, lighting, weather, rigging and battle effects, and a clean HUD. Pirates! wins only on chunky ship solidity and animation feel.
Verdict: pick ours over Pirates! 2004 for the sea experience - confidence ~80% (about 8 in 10 blind players).

## Screenshots judged
shots/critic3/ocean_15.png, sky_192.png, sky_storm.png, ships.png, sailing_p4.png, combat.png, combat_ai.png (vs shots/critic2/ equivalents). Extra files in critic3/ (isl_*, hud_*) belong to other agents.
