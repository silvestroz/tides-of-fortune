# Critic round 1: Islands/Towns/Vegetation and HUD/Menus

Shots judged (fresh, all 1600x900 unless noted): shots/critic1/isl_17.png, isl_aerial.png, isl_beach.png, isl_21.png,
hud_default.png, hud_menu.png, hud_captain.png, hud_1366.png (1366x768). All fresh captures succeeded; no builder-shot fallback.
I did not capture the browser console; the shot tool printed no errors.

## Pirates! (2004) from memory, written before viewing
- Port approach: ship seen from behind-above, small town on a green hillside: ~10-20 chunky hand-textured colonial
  houses with terracotta roofs, a white-walled fort with cannons, church spire, a wooden pier. Whole town is visibly
  dense and readable at once, saturated, warm sun. Hills are rounded with painted grass/dirt texture, palms are
  clustered with billboard-ish fronds.
- Coastline: bright yellow sand rim, turquoise shallow ring, bold white surf line, rounded low hills, sharp colour separation.
- Sailing HUD: very minimal. Small wind arrow, compass strip, little ship status, parchment-framed text only on demand. Mostly unobstructed sea.
- Main menu: pirate-flag/ship painting, parchment-style big serif list, period music; flat but charming.

## Verdicts
- ISLANDS / TOWNS / VEGETATION: **FAIL** (close on terrain and coastline from the air, clearly behind on towns, trees, and night).
- HUD / MENUS: **FAIL** (crafted and arguably better in menu and captain sheet, but the sailing HUD is too heavy,
  and there are state/bug problems visible).

## Scores (1-10; ours / Pirates!)
| Axis | Islands ours | Pirates! | HUD/Menus ours | Pirates! |
|---|---|---|---|---|
| Materials/texturing | 6 | 6 | 8 | 6 |
| Lighting/atmosphere | 7 (day) / 5 (night) | 6 | 7 | 5 |
| Silhouette/shape | 6 (towns 3) | 6 | 8 | 6 |
| Motion | n/a (frozen) | 5 | n/a | 5 |
| VFX | 6 (surf foam good) | 5 | 6 | 4 |
| Composition | 7 | 7 | 6 (too many panels) | 8 |
| Readability | 6 (towns tiny) | 8 | 6 | 8 |
| Art-direction coherence | 6 | 7 | 8 | 6 |
| Technical artefacts | 5 | 7 | 5 | 7 |

## Blind comparison
Aerial (isl_aerial): ours wins. Turquoise shelf, sand rim, surf dots and painted cloud shadow beat the 2004 look. Weakness:
the whole island is one uniform green carpet, no cleared fields, no visible town (a few red pixels at the south coast), no roads.
Port approach (isl_17): Pirates! wins. Our town is a row of white/blue/orange boxes with no windows, doors, chimneys, or
trim, scattered with big gaps. The church is a plain white slab. The fort is a flat grey untextured wall. The trees are
big smooth blobs of uniform green with hard flat shading; they read as low-poly, which the Art Bible explicitly forbids.
The mountain is smooth, with a plasticky painted shader and no rock or cliff variation. Beach (isl_beach): ours is
pleasant, palms are decent, sand-to-shallows gradient lovely, but the ground is a flat plane with zero props, and blob-tree
canopies sit on the palms' hill; far islands are silhouettes with lollipop trees.
Night (isl_21): moon and water glitter are strong, but the island and ships are crushed to black with no moonlit rim, and
the town is represented by blown-out white-orange orbs that look like floating light bulbs, not windows or lanterns.

HUD: default screen, 7 persistent elements (ledger, 3-line log, minimap, target card, condition, two gun panels, compass,
prompt). Pirates! shows far less. Parchment skin is coherent and handsome, but it covers about 20% of the frame. The
menu and Articles of Command sheet are better than anything in Pirates!.

## Bugs seen in shots
1. Floating brown planks (long flat brown boards hovering on the water at right, in hud_default/hud_menu/hud_1366, behind
   the Havana approach). Looks like unfinished piers/jetties detached from land or a placeholder; reads as a glitch.
2. In the islands shot the HUD is in a blank/uninitialised state: ship name and captain are "–", the minimap is an empty ring,
   and condition bars show "–". Even as a showcase this makes the scene look broken. (Shot-setup issue, but it is what ships to the critic.)
3. Foreground fort wall at screen left (hud shots) is a flat grey brick texture with perfectly straight edges, clipped by the
   frame, and a lighter-grey box at right edge; both look like debug geometry.
4. The date text is tiny (about 9 px italic) and the log kickers ("Seven bells, afternoon watch") are about 7 px, and unreadable at 1366x768.

## Ranked fix list: ISLANDS / TOWNS / VEGETATION (owners: src/world/islands.js, terrain/, towns/, data/world.js)
1. Rebuild town buildings (src/world/towns/builder.js). Houses need real detail: pitched roofs with overhang and a
   terracotta tile texture (canvas, per-tile jitter), lime-wash walls with AO gradient at the base, dark window shutters
   and doors via a shared atlas, chimneys, timber corner trim, 2-3 size variants, 1-2 storeys. Target at least 40 buildings per
   large town, packed along streets with a plaza, church with bell tower, market stalls, and a fort with crenellations. Use
   InstancedMesh per variant.
2. Fort and town walls (builder.js): replace the flat grey slab with a textured masonry wall (stone block canvas texture, UV in
   metres, block-level normal variation), crenellations, corner bastions with sentry boxes, visible cannon barrels, a flag, and a
   sloped glacis. Currently reads as a retaining wall.
3. Fix or delete the floating planks (towns/towns.js pier code). Piers must be attached: posts down to the sea floor, deck at
   about +1.2 m above the waterline, a mooring bollard, a crate/barrel prop, and connected to a quay. If not, remove.
4. Trees (terrain/vegetation.js): replace smooth blobs with a clustered-sphere canopy using 3-5 lobes, painterly leaf-cluster
   alpha-card texture or noise-displaced vertices, per-instance hue variation (#2f5a2a to #7fae4a), a light-top/dark-bottom
   gradient (vertex AO), and trunks visible under canopies. Add banana, mangrove, and a few dead trees to break repetition.
5. Terrain surface (terrain/terrainMaterial.js, textures.js): the mountain is smooth plastic. Add steep-slope rock (#8a8178) with
   triplanar strata, dirt paths, cleared cane fields and grass patches near towns, darker jungle on slopes, and a visible
   town footprint of bare earth and roads when seen from the aerial view.
6. Night look (towns/, terrain): add a moonlit rim/ambient floor so landforms keep readable form (cool blue ambient of at least
   0.15), and replace the huge bloomed orbs with small window quads (emissive 2x3 px at distance, warm #ffb46b) and a few
   lantern posts. Clamp the bloom on these emitters.
7. Beach props and ground (terrain/vegetation.js): add driftwood, rocks and wet-sand darkening, shoreline pebbles, beach
   grass tufts, and sea-grape shrubs; the beach view is a flat plain. Add a wet-sand band that darkens at the waterline.
8. Far islands (islands.js): distant islands read as flat silhouettes with lollipop trees. Add aerial-perspective colour ramp
   and low-density tree billboards or a baked colour-texture LOD so the horizon matches nearby shading.

## Ranked fix list: HUD / MENUS (owners: src/ui/, src/audio/)
1. Declutter the sailing HUD (ui/hud.js, hud.css). Collapse the condition panel, both gun panels and the speed readout into one
   compact bottom strip; hide the log panel until a new message arrives (fade after about 6 s); show the target card only
   within about 600 m or when locked. Goal: under 10% of the frame covered at rest.
2. Fix the blank state (hud.js): never render "–" or an empty minimap. Initialise from game state before first paint, or
   hide the panels until data exists. Also fix the islands showcase to set a ship name and a real minimap.
3. Minimum text sizes (hud.css): raise the log kicker to at least 10 px, date to at least 12 px, bar percentages and condition labels
   to at least 12 px; at 1366x768 they are illegible. Use clamp() relative to viewport height, not fixed px.
4. Minimap (ui/minimap.js): add parchment-chart detail (coast hatch, depth tint, town icons with names, a compass rose); right
   now it is a green blob and two tiny triangles. Make ship and target markers at least 2x bigger.
5. Compass/wind (ui/compass.js): the wind indicator is a pale-red sector that is hard to read; add a bold wind arrow with
   strength ticks and label the optimal-heading arc. Present sail-trim feedback as speed delta.
6. Interaction prompt (hud.js): "F Enter Havana 260 m" sits directly on the ship. Move it to the upper third and fade by distance; add a
   subtle pulse. It currently overlaps the stern and competes with the "Beam Reach" banner.
7. Main menu (ui/menu.js): the 3D background shows the floating planks and a cropped fort wall; choose a better hero camera
   (ship in front of a lit port at golden hour), and add a faction-flag motif under the title. Add menu ambience and a music sting
   in audio/music.js (could not audit audio offline; no evidence either way, please confirm it is not silent).
8. Menu items (menu.js): "Continue" greyed with a 6 px hint is nearly invisible, and left-aligned list leaves the screen
   centre empty; add hover/focus animation (brass diamond slide, glow) and keyboard focus rings; add a 1366-wide layout test for
   the Articles sheet (it fits at 1600; verify at 1366).

## WIN condition status
Not met. Ours loses clearly on towns, trees, night, and HUD density; wins on aerial coastline, water colour, menu quality,
and parchment-UI craft. Fix towns and trees first; that is where the average player would pick Pirates! blind.
