# Critic round 2: Islands/Towns/Vegetation and HUD/Menus

Shots judged (fresh): shots/critic2/isl_17.png, isl_aerial.png, isl_beach.png, isl_21.png, hud_default.png, hud_menu.png,
hud_1366.png (1366x768). Compared against shots/critic1/ equivalents. hud_captain not re-shot (not in brief). Console not captured.
Note: islands shots are now nohud, so round-1 bug 2 (blank HUD in showcase) is fixed by removal.

## Verdicts
- ISLANDS / TOWNS / VEGETATION: **FAIL** (big jump; ahead of Pirates! on coast, aerial, night mood; still behind on tree shape, town density/readability, beach ground).
- HUD / MENUS: **FAIL, but close** (sailing HUD now restrained and populated; new defects are the fort/pier geometry that the HUD shot frames, and tiny text at 1366).

## Scores (ours / Pirates!, delta vs round 1)
| Axis | Islands ours | Pirates! | delta | HUD/Menus ours | Pirates! | delta |
|---|---|---|---|---|---|---|
| Materials/texturing | 7 | 6 | +1 | 8 | 6 | 0 |
| Lighting/atmosphere | 8 day / 7 night | 6 | +1 / +2 | 7 | 5 | 0 |
| Silhouette/shape | 6 (towns 5) | 6 | 0 (towns +2) | 8 | 6 | 0 |
| Motion | n/a (frozen) | 5 | - | n/a | 5 | - |
| VFX | 7 | 5 | +1 | 6 | 4 | 0 |
| Composition | 7 | 7 | 0 | 7 | 8 | +1 |
| Readability | 6 | 8 | 0 | 7 | 8 | +1 |
| Art-direction coherence | 7 | 7 | +1 | 8 | 6 | 0 |
| Technical artefacts | 6 | 7 | +1 | 5 | 7 | 0 |

## Round-1 items status
Islands:
1. Town buildings: PARTLY FIXED. Houses now have terracotta/slate pitched roofs, windows, shutters, two-storey variants, lamp posts,
   a bell-tower church with a lit-window night pass. Still only about 25 visible buildings, all the same gable box, big gaps, no plaza/stalls/streets visible; church still a white slab.
2. Fort walls: PARTLY FIXED. Masonry block texture, crenellations and bastion visible in isl_17. In hud shots the foreground fort is still a pale brick lump
   with chunky Lego-like merlons and a single barrel; reads as debug geometry.
3. Floating planks: FIXED in isl_17 (piers now have posts/shadow). In hud shots the piers are thin parallel planks with no pilings or quay; they now at least attach to a pier head but look like stripy boards. PARTLY.
4. Trees: PARTLY FIXED. Clustered canopies with trunks and hue variation, much better than blobs; still uniform lollipop shape and size, and canopy in beach shot is blocky with visible stair-stepped alpha edges.
5. Terrain surface: FIXED enough. Rock ridges, cane/field patches and a hazy cleared town footprint are visible in aerial and isl_17. Fields at aerial look like a flat colour-checker patch.
6. Night: FIXED. Moonlit rim, small warm windows, lamp posts, no orbs, mountain keeps form. Water glitter excellent.
7. Beach props: PARTLY. Mangrove roots and palm clusters now appear, sand/shallows lovely; ground still a bare plane, no driftwood, rocks or wet-sand band.
8. Far islands: PARTLY. Distant islands carry haze and a tree or two; still smooth bald humps (isl_beach left).

HUD/Menus:
1. Declutter: MOSTLY FIXED. Condition, guns and speed merged into one bottom strip; ledger shortened to one line; two log entries (was three, fine); coverage now about 8-10%.
   Target card remains visible at 179 m (acceptable) but log stays on screen; confirm it fades.
2. Blank state: FIXED (ship name, captain, live minimap, bars populated).
3. Minimum text: PARTLY. Log text fine; log kicker and minimap caption (about 7-8 px) and date still tiny; at 1366 the bar percentages and strip labels are about 9-10 px.
4. Minimap: FIXED. Parchment chart, coast, Havana label, ship icons, wind arrow.
5. Compass/wind: FIXED. Clear arrow and tinted danger sector with trim arc.
6. Prompt: FIXED. Moved to upper third, pill-style, no longer on stern.
7. Main menu: PARTLY. Title, ornament and brass-diamond hover are great, but the hero camera still shows the cropped fort lump and plank piers, no faction flag motif under title, audio unverified.
8. Menu items: FIXED visibly (left list, dim Continue with hint). Hint still about 8 px. 1366 Articles layout not tested.

## Blind comparison
isl_17: Ours now wins on sky, water, mountain relief, fort and church silhouette; Pirates! still wins on town density and chunky readability. Close. Trees at about 20 identical lollipops still read low-poly.
Aerial: ours wins decisively (cloud haze is heavier than round 1 and slightly washes the frame, but the reef, sand and town fields beat 2004).
Beach: ours is prettier than Pirates! in water and sky; vegetation edge is jagged and the ground is empty. Pirates! lacks this water, so it is a narrow ours win.
Night: ours wins clearly.
HUD: ours now at parity with Pirates! on density, ahead on craft. The giant brick fort and plank piers in the frame are the worst artefacts left in the whole HUD shot.

## Ranked fix list (at most 6)
1. Fort geometry as seen in hud shots (towns/builder.js): the foreground fort is a pale Lego-brick pile with oversized merlons and a single black cannon box. Use a darker weathered stone texture with mortar lines scaled in metres, merlons 1/3 the current size and evenly spaced, a parapet walk, 3-4 visible cannon barrels with carriages, and a flag. Keep the same asset at distance and close.
2. Piers (towns/towns.js): thin parallel planks with no pilings. Add posts every 3 m down to the seabed, cross-beams, a wider T-head, bollards and crate/barrel props, and connect to a stone quay; shorten to 2 piers max per frame.
3. Tree variety (terrain/vegetation.js): add 2-3 canopy silhouettes (tall umbrella, wide spreading, conifer-like cecropia), scale variance 0.6-1.4, and smooth alpha edges (alphaToCoverage or noise-displaced sphere instead of stepped cards). Add dead trunk and banana plants at town edges.
4. Town density (towns/builder.js): at least 40 buildings in a large town with 3-4 distinct plans (L-shape, long warehouse, arcaded market), a visible plaza with a well/market stalls, street-aligned rows and no gaps over 1 house width; give the church a tiled roof and buttressed nave.
5. Beach ground and far islands (vegetation.js, islands.js): wet-sand darkening band, driftwood, rocks, sea-grape tufts; tint distant islands with a hazy colour ramp and scatter trees on them so they stop reading as bald humps.
6. HUD text sizes (ui/hud.css): clamp log kicker, date, map caption, bar percentages and menu hint to at least 11 px at 1366x768 (use clamp with vh). Also fade the log after about 6 s and add the faction-flag motif under the menu title; re-frame the menu hero camera away from the fort wall.

## WIN condition status
Not met, but gap is small. Remaining losses are geometry quality of fort/piers, tree repetition, and town density. HUD would pass once the framed fort/pier geometry and tiny text are fixed.
