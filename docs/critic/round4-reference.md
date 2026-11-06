# Critic round 4 - blind side-by-side vs REAL Pirates! (2004) screenshots

Ours (SwiftShader, shots/critic4/): sail_chase.png, sail_tactical.png, combat.png, combat_ai.png, islands_aerial.png.
Reference (docs/reference/): 01-03, 24 (combat), 04 (prompt), 05-12 (open sea), 18 (coast).
Note: the reference is a high 3/4 top-down camera; our default is a low chase camera. Pairs 1-2 are like-for-like only for tactical.

## Pair verdicts (axis scores ours / Pirates!)
| Axis | P1 chase vs 08 | P2 tactical vs 05/08 | P3 combat vs 24 | P4 combat_ai vs 01-03 | P5 aerial vs 18 |
|---|---|---|---|---|---|
| Materials | 7/6 | 5/7 | 7/8 | 5/7 | 6/8 |
| Lighting/atmos | 9/6 | 7/6 | 8/6 | 8/6 | 6/9 |
| Water | 9/6 | 5/7 | 8/6 | 6/7 | 6/9 |
| Ships (shape/detail) | 7/8 | 4/8 | 6/9 | 4/8 | n/a |
| VFX | 7/5 | 5/5 | 8/6 | 6/6 | 5/8 |
| Composition/readability | 8/7 | 4/9 | 6/8 | 4/8 | 6/9 |
| UI | 8/7 | 8/7 | 8/7 | 7/7 | n/a |
| Artefacts (higher=cleaner) | 7/8 | 4/8 | 6/8 | 5/8 | 5/8 |
| Art-direction appeal | 8/7 | 5/8 | 7/8 | 5/8 | 6/9 |

Overall: P1 OURS (marginal: sky, water depth, rigging; loses on hull solidity). P2 PIRATES! clearly. P3 split: ours wins atmosphere and flash, Pirates! wins the hero ship (huge painted stern, big emblem sail, giant skull flag). P4 PIRATES!. P5 PIRATES! clearly.
Blind-pick estimate: P1 65% ours, P2 20%, P3 50%, P4 25%, P5 20%. Verdict: FAIL on every pair by the strict rule; we only convincingly win the low chase shot.

## Per pair, why
- P1 chase (sail_chase vs 08): we win on cloud sky, aerial perspective, island silhouettes at horizon, translucent depth water, rigging and gilded stern, crafted parchment HUD. Pirates! wins ship presence: its ship fills a readable, saturated, glowing-white sail mass with a big black pirate flag and painted emblem; ours has cream sails with thin red bands, small red ensign, hull a muddy maroon with tiny detail. Water wave pattern is a noisy combing at mid-distance (fine, bright).
- P2 tactical (sail_tactical vs 05/08/12): worst result. At the high camera both ships are tiny (about 12% of frame height vs 40-50% in Pirates!). Visible hard-edged dark rectangular/parallelogram shadow quads around both ships (clipped shadow-map or contact decal, looks like a bug). Open sea is covered by big soft turquoise blotches in diagonal stripes (reads as shallow reef/cloud-shadow in deep ocean, noise with no cause) and a dense high-frequency moire/comb pattern in the upper half that shimmers. No wake worth the name; ships are not readable by faction. Pirates!: uniform, calm blue, sparse glitter, huge ship, flag, emblem, long white wakes, reflected sail ghosting.
- P3 combat (combat vs 24): ours has beautiful sky, lit islands, big muzzle flash and glowing tracer line. Weak: the player ship is clipped at frame edge as a giant, flat, banner-heavy wall (huge red pennants look like flat cards), the enemy is small and distant; tracer beads are uniform-spaced dots; no crew, no cannon ports readable, no hull damage. Pirates! shows a stern with carved windows, lanterns, crew, hull-wide painted sails with emblem, huge flag: the characterful hero.
- P4 combat_ai (combat_ai vs 01-03): ours is a low grazing camera with ships clipped at both screen edges, huge unused water area, tiny enemy behind HUD panel, no ship names/health bars above ships, hard cyan beam streak in the water (looks like a spotlight/caustic bug), moire on far water. Pirates! frames both ships completely with nameplates, status icons, guns loaded, fire/smoke on the burning hull, readable at a glance.
- P5 aerial (islands_aerial vs 18): ours has no sky horizon, grey-white haze veils everything (washed, low-contrast, dull sea), terrain is a smooth noisy green blanket with blurry texture, beaches are thin, reef dots are a pattern of tiny white "u" tiles (repeating-texture artefact), cloud blob covers the island ridge, town is an unreadable speckled pink patch with no buildings, forts, palms or labels. Pirates!: luminous saturated turquoise shallows, bright cream sand shelves, dense individual tree canopy, visible red-roof town with fort, labelled places, rolling foam lines, cloud shadow.

## Top 8 changes (ranked by impact to win every pair)
1. Make the tactical/high camera the hero view and fix its framing: ship scale ~40% of frame height at tactical altitude (closer FOV/distance, pitch ~50-55 deg), auto-frame both ships in combat, keep player ship fully on-screen (never clipped). Owners: src/camera/, src/combat/ (framing hooks), src/ui/ (nameplates).
2. Kill the high-view water artefacts: remove the hard dark rectangular shadow quads around ships (shadow-camera bounds/bias/soft fade or replace with a soft blob decal), remove the diagonal turquoise blotch stripes in deep ocean (depth/shallow tint must come from seabed depth only), damp wave normal frequency with distance/altitude to kill moire, and drop the cyan beam streak in combat_ai. Owners: src/world/ocean*, src/core/post.js, src/post/.
3. Ship readability and "hero" art: saturated luminous sails with rim/back-light glow, large painted sail emblems per faction, big (2-3x) flags with cloth motion and a pirate skull flag, thicker chunkier hulls with strong faction paint bands and carved stern (windows, lanterns), boot-topping dark waterline band. Owners: src/ships/shipModel.js, src/ships/art/.
4. Wake and waterline: long white V-wakes with foam texture trailing 3-5 hull lengths, hull-side contact foam, reflection ghosting of sails on water in tactical view (Pirates! does this cheaply). Owners: src/world/ocean*, src/ships/shipModel.js, src/fx/.
5. Island/coast pass to match 18: remove the global grey haze at aerial altitude (fog height falloff, keep saturation), luminous turquoise shallow ring with wide sand shelf and foam lines, fix the repeating "u" reef tile pattern, per-tree canopy impostors with colour variation, readable towns (red roofs, fort, palms, pier) and place labels. Owners: src/world/terrain*, src/world/towns*, src/world/sky*, src/core/post.js.
6. Combat framing and info: both ships framed, nameplate with name/guns/crew/speed above each ship, damage state (fire, smoke columns, torn sails, hull holes) visible on the target, ship status icon strips; replace evenly spaced tracer beads with real cannonball sprites plus splash. Owners: src/combat/, src/fx/, src/ui/.
7. Saturation and exposure of the tactical/aerial palette: boost sea saturation toward Pirates!' clean azure, calmer low-frequency wave field at altitude with sparse bright glitter instead of white comb; reduce bloom washout; restore deep-teal vs turquoise value contrast. Owners: src/world/ocean*, src/core/post.js, src/post/.
8. Chase-view hero polish (keep our lead): hull heel/heave, larger and bolder ensign + sail emblems visible from behind, contact foam at stern, less muddy maroon hull (more honey oak and painted strakes). Owners: src/ships/shipModel.js, src/ships/art/, src/camera/.

## Screenshots judged
shots/critic4/sail_chase.png, sail_tactical.png, combat.png, combat_ai.png, islands_aerial.png vs docs/reference/08, 05, 24, 01-03, 18.
