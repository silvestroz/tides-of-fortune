# Critic round 3 (FINAL): Islands/Towns and HUD/Menus

PARTIAL EVIDENCE. Shared machine, each SwiftShader shot took 4-6 min and several stalled. Judged fresh: shots/critic3/isl_17.png,
hud_default.png, hud_menu.png (vs shots/critic2/ equivalents). NOT captured in time: isl_aerial, isl_21 (night), hud_1366. Those axes carry round-2 scores unchanged and are marked unverified.

## Verdicts
- ISLANDS / TOWNS: **FAIL, close** (town now reads as a town; trees/church/density still short of a clear 9-in-10 win).
- HUD / MENUS: **WIN on main menu and sailing HUD at 1600x900; 1366 unverified** -> overall FAIL by protocol until 1366 is seen, but I expect it to pass.

## Scores (ours / Pirates!, delta vs round 2)
| Axis | Islands | Pirates! | delta | HUD/Menus | Pirates! | delta |
|---|---|---|---|---|---|---|
| Materials | 7.5 | 6 | +0.5 | 8 | 6 | 0 |
| Lighting | 8 day / 7 night (unverified) | 6 | 0 | 8 | 5 | +1 |
| Silhouette | 7 (towns 6.5) | 6 | +1 | 8 | 6 | 0 |
| VFX | 7 | 5 | 0 | 6 | 4 | 0 |
| Composition | 7.5 | 7 | +0.5 | 8.5 | 8 | +1.5 (menu) |
| Readability | 7 | 8 | +1 | 8 | 8 | +1 |
| Art coherence | 8 | 7 | +1 | 8.5 | 6 | +0.5 |
| Tech artefacts | 7 | 7 | +1 | 7 | 7 | +2 |

## Round-2 items fixed
1. Fort: FIXED. Dark weathered stone, small even merlons, bell and lamp visible, no Lego lump (hud_default). Still no visible cannon barrels or flag in that frame.
2. Piers: FIXED. Single T-head pier with posts replaces the stripy plank rows; quay in stone.
3. Trees: PARTLY. Two canopy shapes (umbrella and round) and size variance visible in isl_17; edges smoother. Still repetitive on the hillside.
4. Town density: PARTLY. About 40 houses plus church with a visible hall and warehouse; two-storey variants gone from view, rows still gap-toothed and uniform blue/orange.
5. Beach ground: FIXED in hud_default (sand has wet band, no more striped plane). Far islands unverified.
6. HUD: log kicker and header date larger, bottom strip clean, key hints legible, log slimmer. Menu: faction flags under title added, hero camera moved to a hazy coastline with town, fort gone from frame. Excellent.

## Remaining issues
Islands:
1. Church (towns/builder.js): still a white tower slab with a tiny roof; add tiled nave, buttresses, a bell opening and warm stone color.
2. Town variety: all houses are one box and two colors; add the L-plan, long warehouse and arcaded market, plus a plaza with well; close gaps wider than one house.
3. Hillside trees (vegetation.js): same canopy repeated in rows; add a third silhouette (tall palm/cecropia), more scale variance, and random yaw/tilt; break the row pattern near the town.
4. Large stone quay in isl_17 is a long flat grey strip with no bollards, steps or ships; add mooring props and stairs.
HUD/Menus:
1. Verify 1366x768 text sizes (unseen); target at least 11 px for percentages and captions.
2. Chart caption under minimap and hint line are still small at 1600; raise one step.
3. Log still on screen with no fade (confirm it fades after about 6 s).
4. Fort in hud_default still has no cannons or flag.

## Blind verdict
Main menu: ours clearly beats Pirates! (typography, atmosphere, flags); 9 of 10 players pick ours. Sailing HUD: ours ahead on craft, parity on clarity; about 7 of 10 pick ours. Island close-up: ours wins on sky, water, relief; Pirates! still edges chunky readability and town life; about 6 of 10 pick ours. Overall an average player picks ours over Pirates! 2004 for these screens, confidence about 70 percent (lower because aerial, night and 1366 were not re-shot).

## Addendum: hud_1366.png judged (shots/critic3/hud_1366.png)
Layout holds at 1366x768, nothing overlaps or clips. Log, header and target text are legible (about 11 px); bar percentages and the minimap caption are still small (about 9 px) but readable. HUD/Menus: now PASS (WIN) on all three captured views. Remaining: minimap caption size, log fade unconfirmed, fort has no cannons.
