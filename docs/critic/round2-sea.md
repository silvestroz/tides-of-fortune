# Critic round 2 - SEA systems

Shots judged (fresh, SwiftShader, shots/critic2/), each compared to the matching shots/critic1/ image:
ocean_15, ocean_183, sky_192, sky_storm, ships, ships_close, sailing_p4 (--play 4), combat, combat_sink. No console errors surfaced by the shot tool.
HUD is now hidden in showcase shots and slimmer in gameplay (round-1 cross-issue #7 fixed, #5 mostly fixed).
Pirates! (2004) reference = the round-1 from-memory description (unchanged).

## Verdicts and scores (ours / Pirates!, delta vs round-1 ours)
| Axis | Ocean | Sky/post | Ships | Sailing/cam | Combat |
|---|---|---|---|---|---|
| Materials/texture | 8/5 (=) | 8/5 (=) | 8/6 (+1) | 7/6 (=) | 7/6 (+1) |
| Lighting/atmosphere | 8/5 (=) | 9/6 (=) | 7/6 (+1) | 8/6 (=) | 7/6 (=) |
| Silhouette/shape | n/a | 7/6 (=) | 8/7 (+1) | 8/7 (+1) | 7/6 (+1) |
| Animation/motion (still-inferred) | 7/5 (=) | 7/5 (=) | 6/6 (=) | 6/7 (+1) | 7/6 (+1) |
| VFX | 8/5 (=) | 8/5 (=) | n/a | 7/5 (=) | 7/6 (+1) |
| Composition/readability | 8/7 (=) | 8/6 (=) | 8/8 (+2) | 8/7 (+1) | 7/8 (+2) |
| Art-direction coherence | 8/7 (=) | 8/6 (=) | 7/8 (+1) | 8/7 (+1) | 7/8 (+1) |
| Technical artefacts (higher=cleaner) | 7/7 (=) | 8/7 (+1) | 7/8 (+3) | 6/8 (+1) | 6/8 (+1) |

- OCEAN: FAIL (very close). Beats Pirates! on look; still not clean at ship contact, and mid-range water is streaky.
- SKY/POST: FAIL (close). Storm is now a clear win; sunset sea lacks a glitter path.
- SHIPS: FAIL (much closer). Rigging noise is gone - biggest single improvement. Hulls still read slightly thin/hovering and faction colour is only on flags.
- SAILING/CAMERA: FAIL (close). Framing is now good (ship smaller, lower-third, enemy frigate and horizon visible, speed 8.8 kn). Hull still looks perched on the water.
- COMBAT: FAIL (close). Sinking is now convincing; at-range hit feedback still modest.

## Round-1 items status
FIXED: ships rigging/ratline black dotted noise (ships.png, ocean_15, sky_192 all clean); showcase bowsprit overlap (ships.png now evenly spaced); sails now carry belly and gradient; speed display rescaled (19.3 -> 8.8 kn); camera pulled back, ship off-centre, HUD no longer occludes subject; HUD placeholder plates hidden; sunset sea no longer mud-brown (rich magenta/amber) and sun has bloom with a visible reflection streak; storm lightning is a thick, branched, glowing bolt; storm sea now has foam streaks and desaturated blue-grey; storm gets palms/island detail; horizon white band removed (now a soft haze line); sinking ship now keeps its hull, pitches bow-up/stern-down, has a white foam ring, burning fire, and sails are stripped (15% in HUD, bare yards) - consistent; ships got bow-wave foam while sailing; crew dots no longer clutter.
PARTIAL: Gerstner swell (silhouette of the horizon is still flat, but near-water has visible large undulation); hull contact foam (small white splash at the bow in sailing_p4 and a ring at sink, but none at the waterline of ships.png / ocean_15 where hulls sit still); wake double streak (ocean_15 still shows a faint secondary streak at left - weaker); AI broadside positioning (not verifiable in stills; combat shows one ship broadside at ~120 m).
NOT FIXED: faction colour readable on hulls at 150 m (only flags differ); lightning illuminating clouds/scene (bolt is nicer but clouds around it are not lit); god-rays at tod 17-19 (only bloom); sun glitter flecks at tod 15 (still smooth highlights); crew still unreadable.

## Remaining ranked fix list (max 6)
1. Waterline contact for ships (ships.png, ocean_15, sailing_p4 stern): at rest and in the ship-line-up the keel/stern underside shows daylight and no foam. Sink hull 0.3-0.5 m, sample ocean height at 3-4 hull points for heave/pitch/roll (low-pass spring), and expose a ship-ring uniform so the ocean shader draws a foam/darkened-water ring around the hull outline. Biggest remaining "hovering" cue.
2. Sunset glitter path (sky_192, ocean_183): add a high-frequency threshold-on-normal sparkle column under the sun (warm white #fff4d6, anisotropic stretch toward the viewer) and a sun-axis godray radial blur at tod 17-19.5. The sun reads as a blob with a thin streak; ART_BIBLE promises god-rays.
3. Mid-range water streakiness (ocean_15 / ocean_183 / ships.png foreground): the 10-40 m band is a motion-blur-like horizontal smear with turquoise/navy patch boundaries that look like a large low-frequency tint map. Fade normal detail by distance with a mip-aware scale, use two non-integer-ratio scales, and soften the colour-patch contrast; add 2 real long-wavelength Gerstner swells (lambda 60-120 m, amp 0.6-1.0 m) so the horizon line itself undulates.
4. Faction readability at range (ships.png, sailing_p4): hulls of all factions are the same dark navy/maroon. Add a broad faction-colour wale band plus sail-trim/cross on the courses, and enlarge pennants ~2x, so Dutch/Spanish/English are readable at 150-250 m without flags.
5. Lightning scene flash (sky_storm): when the bolt fires, raise cloud emissive and key light for ~120 ms and tint rain/water, and add a faint glow halo on the nearest cloud; currently the bolt sits on an unlit sky.
6. Combat hit feedback at range (combat.png): add per-gun staggered muzzle flash (80 ms additive + brief point light), additive shot streak trails, and a larger splash column with ring ripple; broadside smoke is good but flame/impact on the target hull is small. Keep fire light cast on water (visible as orange blob in sink shot; make it reflect on the sea).

## Screenshots judged
shots/critic2/ocean_15.png, ocean_183.png, sky_192.png, sky_storm.png, ships.png, ships_close.png, sailing_p4.png, combat.png, combat_sink.png
(vs shots/critic1/ same names). Extra files in critic2/ (isl_*, hud_*) came from other agents, not judged.
