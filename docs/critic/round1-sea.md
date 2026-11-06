# Critic round 1 — SEA systems (ocean, sky/post, ships, sailing/camera, combat)

Shots judged (all fresh, SwiftShader, in shots/critic1/): ocean_15.png, ocean_183.png, sky_192.png, sky_storm.png,
ships.png, ships_close.png, sailing_p4.png (--play 4), combat.png, combat_sink.png. No fallback builder shots were used.
Console: shot tool printed no errors for any run. Note: the --shot ocean/sky showcase frames show the sailing HUD, with an empty
minimap/captain plate (placeholder "—" values) — showcase-only, not scored.

## Pirates! (2004) from memory (written BEFORE viewing our images)
- Ocean: saturated cyan/turquoise, soft low swell, sparkly sun glint, white wake foam, lighter turquoise shallows around islands,
  slightly flat shader look, no real reflections, soft pale horizon haze.
- Sky: bright blue gradient, puffy cartoon cumulus billboards, strong warm sun, orange/pink sunsets; cheerful, dated, little post.
- Ships: chunky cartoon proportions, brown plank textures, gilded sterns, cream billowing sails, flags, rope lines, tiny crew sprites;
  very readable silhouettes per class.
- Sailing cam: chase cam behind/above, ship lower-centre, wake behind, ship pitches/rolls on the swell, wind/compass HUD.
- Combat: puffy grey broadside smoke, muzzle flashes, splashes, splinters, torn sails, damage decals, sinking ship tilts and goes under.

## Scores (1–10, ours / Pirates!)
| Axis | Ocean | Sky/light/post | Ships | Sailing/cam | Combat VFX |
|---|---|---|---|---|---|
| Materials/texture fidelity | 8 / 5 | 8 / 5 | 7 / 6 | 7 / 6 | 6 / 6 |
| Lighting & atmosphere | 8 / 5 | 9 / 6 | 6 / 6 | 8 / 6 | 7 / 6 |
| Silhouette/shape | n/a | 7 / 6 | 7 / 7 | 7 / 7 | 6 / 6 |
| Animation/motion | 7 / 5 | 7 / 5 | 6 / 6 | 5 / 7 | 6 / 6 |
| VFX | 8 / 5 | 8 / 5 | n/a | 7 / 5 | 6 / 6 |
| Composition/readability | 8 / 7 | 8 / 6 | 6 / 8 | 7 / 7 | 5 / 8 |
| Art-direction coherence | 8 / 7 | 8 / 6 | 6 / 8 | 7 / 7 | 6 / 8 |
| Technical artefacts (higher=cleaner) | 7 / 7 | 7 / 7 | 4 / 8 | 5 / 8 | 5 / 8 |

## Verdicts
- OCEAN: FAIL (close — best system). Beats Pirates! on look, but the horizon/world-edge and ship contact are not clean (see fixes).
- SKY/LIGHT/POST: FAIL (close). Golden hour and storm are better than Pirates! blind; but ship/rigging aliasing and a few softness issues
  keep "every axis" from holding.
- SHIPS: FAIL. Close-up stern is gorgeous, but at gameplay distance rigging/ratline noise, floating hulls and sail/hull sizing lose to Pirates!' clean silhouettes.
- SAILING/CAMERA: FAIL. Chase framing is decent; ship hovers above the water and the idle/no-input camera is static (--play 4 frame is good, but ship is too large and clips the HUD zone).
- COMBAT: FAIL. Smoke is good, but muzzle/hit feedback is small at range, sinking looks like a mast-farm with no hull, and no cinematic composition.
Average player blind 9/10: oceans and skies yes; ships/combat no.

## Per-system observations and ranked fixes

### 1. Ocean (src/world/ocean*)
Observed: ocean_15 — rich blue-to-teal depth gradient, strong foam wake with turquoise subsurface glow, good normal detail. ocean_183 — sun
band and warm crest tint work. Problems: (a) the horizon is a hard razor line with a bright white strip where water meets fog in
ocean_15 / sailing_p4 (looks like a seam, not a haze gradient); (b) far water becomes a uniform noisy "wrinkle" texture with visible
tiling-scale mismatch between near and mid ranges (ocean_183, lower-left); (c) swell is nearly zero amplitude — water looks
like a flat plane with normal-map ripple; hulls do not visibly rise on waves; (d) wake is a single white streak with a hard secondary
parallel streak at left (ocean_15, left of the ship), reads like a UV/trail artefact; (e) no foam/skirt where hull meets water.
1. Fade water colour into the sky-horizon colour by distance with a smooth exp-squared curve; kill the bright white band (check fresnel reflect of sky at grazing angle clamping to >1 before tone map; clamp to horizon fog colour).
2. Add 2–3 large-wavelength Gerstner swells (λ 40–120 m, amp 0.4–1.0 m) so the silhouette of the sea changes at the horizon and ships have something to ride; keep detail normals only for ripples.
3. Distance-based normal-detail fade/anisotropic filtering to remove mid-range "wrinkled paper" noise; blend 3 scales with distinct, non-integer ratios to break tiling.
4. Remove the left secondary wake streak or make it a proper bow/quarter-wave V with falling alpha; add foam texture advection (flow-map) instead of a static decal.
5. Expose a hull-contact foam/ripple ring uniform (ship position + length/beam) so ship owners can draw waterline foam in the ocean shader.
6. Shallows: ensure turquoise-to-sand transition near island rims reads (not verified in these shots; coast shots not in scope).
7. Stylise sun glitter as small sparkling flecks (high-frequency threshold on normals), not a smooth band, at tod 15 where it is absent.

### 2. Sky / lighting / post (src/world/sky*, src/core/post.js, src/post/)
Observed: sky_192 — excellent golden hour; sun disk with bloom, painterly clouds with pink underlight, island rim-lit. This clearly beats
Pirates!. sky_storm — convincing dark cumulonimbus, lightning bolt, rain streaks, grey-green desaturated fog. Problems: (a) the lightning
bolt is a thin flat white polyline pasted in sky with no cloud illumination or flash on the scene (storm); (b) at 19.2 the sea mid-ground
becomes a muddy purple-brown with low contrast; the sun reflection column is weak under the sun disk; (c) post sharpens/aliases thin
rigging into black dotted noise (see ships); (d) cloud shapes in sky_192 are flat pink blobs with hard-ish edges; (e) clouds at
tod 15 (ocean_15) show a visible banded vertical gradient left of frame; (f) sailing_p4 clouds are lovely but look slightly low-res/blurred vs sharp ships.
1. Make lightning flash the whole sky: boost cloud-layer emissive + directional light intensity for ~120 ms, thicken/branch the bolt with glow (additive quad pair + bloom).
2. Add a bright sun glitter path in the ocean shader driven by the sky uniform at low sun (coordinate with ocean owner) so the 19.2 water has a golden column.
3. Run anti-aliasing for thin geometry: enable MSAA/FXAA/SMAA after tone mapping or render scale 1.5x supersample before DOF/bloom; verify the post chain does not downsample thin lines without a pre-filter.
4. Soften/volumetrise cloud edges at sunset (extra noise-eroded alpha, rim light), and shrink pink hue range so shadow sides go violet-blue (split-tone per ART_BIBLE).
5. Remove banding at 15:00 sky (dither 1/255 noise after tone map).
6. Add god-rays/cheap radial blur from sun disk at tod 17–19.5 (ART_BIBLE promises "god-ray feel"); currently only bloom.
7. Slightly raise ambient/shadow tint at dusk so the sea is not mud-brown.

### 3. Ships (src/ships/shipModel.js, src/ships/art/)
Observed: ships_close — best asset in the game: carved gold stern, lanterns, window glow, painted strakes, ratlines, cream sails with seams. ships.png (line-up) —
six hull classes distinguishable by rig; sails read well. Problems: (a) at gameplay distance (ocean_15, sky_192, ships.png) rigging/ratlines
turn into black dotted noise ("dashed" lines) — severe shimmer/aliasing, looks like dirt on the sails; (b) hulls are thin dark slivers under huge sails —
hull height/freeboard is too low versus sail area, sails seem to float above; (c) in ships_close the hull's lower part has a flat unlit underside and
the keel/stern post is a plain brown wedge; no waterline paint cut, ship appears to hover; (d) sails are almost flat cream with no belly/billow
shape in ocean_15 (they do billow in sailing_p4); (e) nearly all ships look the same dark navy/maroon at distance — faction colour not
readable; (f) crew are sub-pixel tan dots, clutter the deck; (g) ships.png bowsprit spars cross neighbouring hulls (overlapping ships) — layout problem in showcase.
1. Render ratlines/shrouds as thick (>=1.5 px at 100 m) ribbon geometry or an alpha-tested texture with mip-safe coverage; LOD: fade ratlines out beyond ~60 m and replace with sail shading.
2. Raise freeboard by ~15–20% and add a distinct waterline: lighter boot-topping + dark tar bottom, clipped at y=0 with draw order after water so no gap; add a wet/foam contact decal.
3. Paint faction colour on a broad band + sail trim/cross + larger flags that remain readable at 150 m (e.g. 3x flag size, contrasting stripe on hull).
4. Fix underside: bake AO into hull vertex colours under counter and keel; shape keel/sternpost with proper rabbet profile; add rudder.
5. Increase sail curvature (belly) always, driven by wind angle, with cloth wobble; add gentle shading gradient so seams are visible at distance.
6. Cull/merge crew into fewer, larger figures or hide beyond 40 m; avoid dotted noise.
7. Re-space the ships.png showcase so bowsprits don't intersect neighbours.

### 4. Sailing / camera (src/ships/ship.js, src/camera/)
Observed: sailing_p4 — chase camera from quarter, ship heeled, bow wave and wake nice, enemy frigate ahead. Strong composition. ocean_15 (idle, 0 kn)
— camera sits very close behind the ship at stationary speed. Problems: (a) hull appears to hover over the water — no pitch/roll coupling to wave
height, no hull submersion, white wake begins at stern with no bow wave at the stern-quarter; (b) the heel is visible but looks rigid, as if rotated 12° with no oscillation; (c)
ship is huge in frame and overlaps/occludes the top-right HUD target plate region and centre, making the horizon obscured; (d) speed readout "19.3 KN" for a brig with sails 100% is implausibly high and the
wake does not scale; (e) idle camera is a static tripod: no sway, no look-ahead, no FOV change with speed.
1. Sample ocean height/normal at 3–4 hull points and drive heave, pitch, roll with low-pass spring damping; lower hull so the waterline sits ~0.3–0.5 m under the surface line.
2. Pull the camera back ~25% and up 10% (or ease distance with ship length) so the full hull + enemy are framed; offset ship to lower-third, leaving horizon at upper third.
3. Add speed-driven FOV (+4–6°), gentle handheld sway (0.2 Hz, 0.3°) and look-ahead toward heading/target.
4. Add bow wave crest and stern fountain as ship-owned foam sprites scaled by speed; ocean owner supplies foam sampling.
5. Clamp the speed model (brig 9–12 kn max) or rescale the display.
6. Make heel oscillate (gust noise) and rise with wind strength.

### 5. Combat VFX / AI (src/combat/, src/fx/, src/ships/ai.js)
Observed: combat.png — broadside smoke puff on the left (our ship) and fire/smoke at enemy hull; splashes and splinters present; combat log toasts. combat_sink — burning hull
with orange flame, brown smoke, flags still flying, wreck debris. Problems: (a) smoke puffs are cream-white blobs with hard cut edges and uniform size; no muzzle flash glow or fire-bright core visible at range; (b)
shots (black dots) are tiny, no tracers/trails, splashes tiny; (c) sinking (combat_sink): the hull is almost entirely gone from view while masts/rigging remain 100% rendered — reads
as a "mast farm", the hull goes under with no foam ring, bubbles, or hull tilt realism; sails still show 100% in HUD and masts are bare — inconsistent (sails vanished); (d) flames
are cartoon sprite clusters with no light cast on water/sea; (e) hits have no damage decals on hull (holes/planks) visible; (f) AI ships in combat.png sit stationary head-on, firing
from distance 120 m with a straight line — no circling/broadside positioning visible.
1. Broadside: per-gun staggered muzzle flash (additive bright 80 ms sprite + point light flicker) then layered smoke (3 sprite sizes, noise-eroded alpha, drift with wind, 4–6 s life).
2. Shot trails: thin additive streak with fading tail; larger splash (white column + ring wave + spray droplets) scaled to ~3–6 m.
3. Sinking sequence: pitch bow down 25–40° and roll over 8–12 s, spawn foam ring + bubbles + debris + oil slick; keep hull geometry until submerged, sails must tear/fall first.
4. Hull damage: decal planks/holes appearing per hit via instanced quads or a damage-mask texture in hull material; splinter bursts larger and bright-wood coloured.
5. Fire light: add a warm point light on burning ships and reflect it on water (dynamic light or additive blob in ocean shader).
6. ai.js: have AI turn to present broadside at 60–100 m and circle, so combat reads as broadsides rather than head-on approach.
7. Cinematic cut or tactical camera mode for combat (kick FOV, slow-mo on hit) — currently static.

## Cross-system issues
1. Fog vs ocean: the horizon is a hard white line; fog colour, sky horizon colour and ocean far colour are not the same value. Single source of truth for horizon colour (sky owner publishes uniform; ocean uses it).
2. Ship waterline: hulls hover (sailing_p4, ships_close, sky_192). Needs ocean-height sampling + hull foam contact; ships owner + ocean owner.
3. Rigging aliasing from post chain: ships geometry thin lines vs post/AA — shared concern between ships and sky/post owner.
4. Island/sea interface: islands appear with abrupt flat bases and no shoreline foam at distance (ships.png, ocean_15 left silhouette); islands owner not in scope, but ocean needs shore foam/shallow tint.
5. HUD framing: the HUD plates cover the lower ~25% of the frame; ship sits behind compass, so camera framing must account for HUD safe-area.
6. Scale: ships appear ~3x larger than islands warrant, and enemy ships at ~200 m look tiny vs player; unify unit scale between ships and terrain.
7. Showcase scenes: ocean/sky shots include the full HUD with placeholder values; give showcase mode a --hud off flag for cleaner critique next round.

## Screenshots judged
shots/critic1/ocean_15.png, ocean_183.png, sky_192.png, sky_storm.png, ships.png, ships_close.png, sailing_p4.png, combat.png, combat_sink.png
(also present from other runs: isl_*.png, hud_default.png — not judged).
