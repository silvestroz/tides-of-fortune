# Painted icons (refits, goods, messages, places)

`src/ui/refitIcons.js` holds eight inline SVG icons (six refits, the two card titles), drawn with Recraft and cleaned
by script. No image file is loaded by the game: the drawings are path data in the module (about 22 kB, 2 to 3.5 kB each).

## One drawing, three states
Every path carries a role class: `k` ink, `m` main wash, `s` shadow, `l` light, `i` iron, `h` highlight.
The colours live in `src/ui/port/port.css` (`.ri`):

| State | Class on `.uico` | Look |
|---|---|---|
| Not bought (level 0) | `l0` | line drawing: every wash takes the paper colour |
| Bought (level 1 and up) | none | material colours, set per icon as `--m --s --l --i --h` on the `<svg>` |
| At best (level = max) | `max` | gold washes and a soft glow |

The ink of these drawings is a full silhouette lying under the washes, not an outline. Hiding the washes gives a
black shape: recolour them instead (that is what `l0` does).

## Making or changing an icon
1. Recraft, vector model, custom style "Tides of Fortune — icônes chantier" (bold dark-brown outline, flat fills, one
   object, transparent background, no text). Ask for a compact, square composition.
2. Recraft does not follow requested hues: only regenerate for a shape, never for a colour.
3. Clean the SVG: drop the metadata and the near-transparent paths, crop tight (the subject should fill about 92 % of
   a 32 grid), run SVGO at precision 1, then tag each path with its role and write the per-icon palette.
4. Check at 24, 30 and 16 px on the parchment card, in the three states (`?shot=port&tab=shipyard`).

Chain shot and grapeshot rows still use the older stroke icons of `icons.js`.

## The other painted icons
`src/ui/paintedIcons.js` (about 92 kB) holds four more families made the same way, as plain coloured path data
(no role classes, no states):

| Export | Count | Used by | Shown at |
|---|---|---|---|
| `GOOD_ART` | 16 | `GOOD_ICON()` in `port/art.js` (market, smuggler, hold) | 22 to 30 px |
| `TOAST_ART` | 16 | `TOAST_ICONS` in `toasts.js` (messages, banner, journal, hints, shoal alert) | about 18 px |
| `VIGNETTE_ART` | 5 | `VIGNETTE` in `port/art.js` (beside the port screen titles) | about 55 px |
| `AMMO_ART` | 2 | chain shot and grapeshot rows of the shipyard | 24 to 30 px |

Goods and message icons are small on screen, so they are drawn simplified: ask Recraft for "only 3 to 5 large shapes,
extra-thick outline, no small details, must read at 16 pixels". Places and refits are larger and keep more detail.

Colours are remapped by script, since Recraft pulls every hue towards oak brown: each fill is sorted into a role by hue
and lightness (ink, brown, dark brown, cream, greys, red, green, blue, purple), then each icon gets its own palette.

Left as they were, on purpose: the monochrome glyphs (`ICONS`, `GLYPH`), which are tinted by CSS with `currentColor`
(gold on the dark menu, ink on parchment), and the chart ornaments drawn on the canvas of the world map.
