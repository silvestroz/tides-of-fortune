# Round 4 critic: port screens vs Pirates! (2004)

Capture note: fresh `shot.mjs` captures all timed out (5 attempts, one ran 8 min; SwiftShader machine saturated, 9 shot.mjs processes alive).
Judged the existing shots instead: shots/port/v3-market.png, v2-tavern.png, v2-shipyard.png, v2-governor.png, v3-bank.png.
References: docs/reference/15-market, 16-tavern, 14-shipyard, 17-port-menu, 13-fleet-status, 19-plunder.

Overall layout in all five of ours is identical: a dark carved-wood header, a left tab rail, a parchment sheet, a wood footer, over a darkened blurred 3D harbour. The scene never changes per tab. Pirates! changes the whole scene per screen.

## Pair verdicts (blind). Scores: Ours / Pirates!, 1-10

| Pair | Atmosphere | Scene/illustration | Typography/readability | Info clarity | Delight | Verdict |
|---|---|---|---|---|---|---|
| Market vs 15 | 4/8 | 2/8 | 6/8 | 9/6 | 4/8 | FAIL (Pirates! wins blind ~8/10) |
| Tavern vs 16 | 3/10 | 1/10 | 6/8 | 6/6 | 2/10 | FAIL, heaviest loss |
| Shipyard vs 14 | 4/8 | 3/8 | 6/8 | 8/6 | 4/8 | FAIL |
| Governor/header vs 17 | 4/9 | 2/9 | 6/8 | 7/7 | 3/8 | FAIL |
| Counting House vs 13 | 4/7 | 3/8 | 6/8 | 8/6 | 3/7 | FAIL (closest) |

### Market vs 15-market
Pirates!: lit stone alley, crates, barrels, fruit, a merchant gesturing, big gold-leaf numerals, one row per commodity with an icon, almost no chrome. Ours: a dense spreadsheet on parchment. Information is better (stock bars, margin, demand tags, hold bar, shift-click hint) and beats theirs on clarity. But it is a 15-row table in ~11px small-caps with tiny stock bars, greyed Sell buttons that make half the sheet look disabled, and the blurred backdrop is mostly hidden. A player gives it one second and sees "accounting software". Their screen shows trade as place and people.

### Tavern vs 16-tavern
Not close. Theirs is a lit interior: hearth glow, hanging lanterns, patrons, barmaid, the player in frame, a caption that reads as story. Ours is two boxes of text on parchment with ~40% of the sheet empty below, and the scene behind it is the sunny harbour, which contradicts "smoke, fiddle and spilled rum". Nothing about the screen says tavern except the icon. The rumour quotes are good writing but sit in 11px italic. Hire buttons are tiny. Worst screen of the set.

### Shipyard vs 14-shipyard
Theirs has a dock scene with a huge sail-filled ship and a shipwright, plus a bold panel with a ship portrait and fitting icons. Ours has a line-drawn brig that looks like a placeholder (flat strokes, pale fill, sails like paper) in a box half the size of the page. Repairs and refits are clear, but the rows of three hollow diamonds and tiny price pills are hard to read, and the lower half of the sheet is empty. The one ship drawing in the whole set is also the weakest drawing.

### Governor/header vs 17-port-menu
Theirs is a painted harbour vista with a town, sun rays, clouds, a flag and large menu text. It is the most beautiful screen in the game. Ours opens on a heavy brown frame; the header gives the town name in nice gilded letters but no town view, no portrait of the governor, and a "Civil / Wealth" block in ~9px text. The faction flag is a flat swatch. The ranked-standing meter and commission list are good UI, but the screen shows no governor and no sense of place. The wood-grain frame is the dominant visual, so the harbour backdrop reads as an afterthought.

### Counting House vs 13-fleet-status
Closest. Theirs is a chart-on-sea backdrop with portraits and big gold titles. Ours is clear, but the faint watermark of the counting-house icon is the only illustration, and the lower 40% of the sheet is empty. No coin stacks, no ledger art, no crew portraits. The ink-line items read like a form.

## Cross-cutting problems
1. Same stage for every tab; Pirates! gets a new 3D scene per screen.
2. Parchment sheet covers ~55% of the viewport with ~35% of it empty on four of five tabs. Content is small, space is wasted.
3. Body type 10-12px, 9px sub-labels. Theirs is 30-40px for the numbers that matter. We win only when someone reads closely.
4. No characters anywhere: no merchant, barkeep, shipwright, governor, no portraits.
5. Icons are small flat line/duotone badges. No gold-leaf, no illustrated cargo.
6. Palette is monotone brown/cream; their scenes are saturated and lit.

## Ranked fix list (owner: src/ui/port/, src/game/ports/)
1. Per-tab 3D (or layered painted) stage with its own lighting, camera and a staffed scene, shown at full brightness with the UI panel shrunk to a side column (~38%) over it. Tavern first: interior with hearth point light (flicker), 3-5 hanging lanterns (emissive + bloom), barrels, tables, rug, 4+ low-poly patrons and a barkeep with idle animation, warm/dark grade. Reuse for Market (stone alley, crates, awning, merchant, fruit stalls) and Shipyard (slipway, hull on stocks, scaffolding, a big ship in the background, planks, barrels). Files: src/game/ports/ports.js (scene builders), src/ui/port/portScreen.js (stage switching).
2. Stop darkening/blurring the backdrop. Remove the blur and dark overlay in port.css; let the scene carry the screen and give panels a semi-opaque surface only where text sits.
3. Characters: build a shared procedural NPC kit (head, hat, coat, pose) and place a named NPC per tab; add a speech/caption bar in the Pirates! style (large serif lines on a dark gradient) for tavern and shipyard dialogue. Governor tab: a portrait of the governor behind the residence desk.
4. Port header/Governor: replace the wood banner with a painted vista of the town (their screen 17): large faction-coloured flag in wind, terracotta town, sun shafts, and put the tab menu as big gilded text with fleur or anchor bullets on the left over the sky, not a boxed rail. Raise the town name to ~56px gilded display type.
5. Typography pass: market rows at 20px+ numerals with icon-per-commodity at 40px (illustrated crate/sack/barrel, not line badges), buy/sell as large +/- chevrons, stock bar thicker. Panel body min 15px, sub-labels min 12px. Add a gold text-shadow/outline for text over scenes.
6. Shipyard ship portrait: replace the line drawing with a rendered 3D ship (render-to-texture of the real hull model, slow turntable, lit) with fitted upgrades shown as icons beside it, and damage % in red as Pirates! does. Make refit rows icon-led with filled/empty pips.
7. Fill the empty space: Tavern (a recruit list with crew portraits and per-man skills, a visible gossip board), Counting House (coin stacks scaled to purse, a ledger sparkline, crew portraits for the plunder split), Governor (a rank-ladder graphic, the flag of each nation with reputation). No panel should leave more than ~10% blank.
8. Motion and sound cues: tab transitions as a camera move/crossfade, hover glow on rows, coin-flip counters when gold changes, ambient audio per scene (tavern chatter/fiddle, gulls, hammering). Delight is currently ~3/10 against ~8/10.

## Verdict
FAIL on all five pairs. Ours wins information clarity on market, shipyard and bank (rows, margins, hold bar, standing meter), loses atmosphere, illustration and delight by 4-7 points everywhere. Fix 1-3 move the needle most; the tavern needs a real scene or it will always lose.
