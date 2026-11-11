# Refit icons (shipyard)

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
