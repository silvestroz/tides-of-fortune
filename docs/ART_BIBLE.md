# Tides of Fortune — Art Bible & Team Rules

Original game. Genre: open-world pirate/privateer life sim (same genre as Sid Meier's Pirates! 2004).
**No names, art, UI, music or text from Pirates! or any other game.** Original everything.

## Target
Every screen should beat Sid Meier's Pirates! (2004) side by side, blind. Reference for what we must beat:
bright saturated Caribbean, textured wooden hulls with painted strakes and gilded sterns, billowing cream sails
with visible seams, Gerstner-ish blue water with sun glitter and white wakes, lush green islands with sand rims,
palm trees, small colonial towns with forts, strong warm sunlight, cartoonish-but-detailed proportions.
We win by: far better water (depth colour, foam, SSS-like crest glow, reflections), painterly sky and clouds,
light and atmosphere (golden hour, aerial perspective, god-ray feel), richer ship detail (rigging, ratlines,
lanterns, flags with cloth motion), juicy combat VFX, and a crafted UI.

## Look: stylized painterly
Think a living oil painting / storybook adventure, grounded proportions. NOT low-poly flat shading, NOT
untextured primitives. Every surface carries a procedural texture with a hand-painted feel
(canvas/shader-generated brush noise, edge wear highlights, baked AO in vertex colours, subtle colour variation).

Palette (sRGB):
- Deep water #0b4a6e → open teal #12708a → shallows turquoise #39c4c0 → sand-lit shallows #8fe3c9
- Foam / crests #f4fbf8 ; sun glitter warm white #fff4d6
- Sky zenith #3a7fc4 → horizon haze #cfe6ef ; golden hour #ffb46b / #ff7e5f ; night #0d1b33
- Sails cream #efe3c2 (aged #d9c89c) ; hull honey oak #8a5a2b, tar dark #2b1a10, paint bands faction colour
- Island greens #4f8a3a / #7fae4a / dark jungle #2f5a2a ; sand #e8d39a ; rock #8a8178
- Roofs terracotta #c0623a ; walls lime-wash #efe4cf
- UI parchment #e9d8ae, ink #2a1c10, brass #c9a24a, blood red #8e1b1b

Lighting & grading: ACES, warm key light, cool sky fill, gentle bloom on sun/glitter/lanterns only,
warm highlights / cool shadows split-tone, mild vignette, aerial perspective fog to horizon colour.

## Interface — charte graphique
Parchemin, encre, laiton et cachet de cire : l'interface est un livre de bord, posée sur la 3D. Palette ci-dessus ;
jetons CSS dans `src/ui/hud.css` (`#ui` : `--ink`, `--parch`, `--brass`, `--blood`… ; `:root` : `--cta-*`).
Typographie : `--sc` (IM Fell English SC) pour les titres, noms et chiffres, `--txt` (Spectral) pour tout texte à lire,
`--deco` (IM Fell English) pour les ornements ; à 1366 × 768, texte à lire ≥ 13 px, mentions et touches ≥ 11 px ;
typographie anglaise (guillemets “ ”, pas d'espace avant ; : ! ? %).

### Boutons (23/10/2026 : l'or estampé des villages de pêcheurs devient le défaut)
**Bouton d'action principal** : classe `.btn` (fiches d'abordage et de prise : `.board-sheet button` ; tableaux serrés :
`.vb` de `village.css`). C'est le bouton de toute action, dans toutes les interfaces : menus et création, port, villages,
fiches (prise, prison, naufrage, mutinerie, registre, cale), bataille à terre, carte, conseils.
- Fond : dégradé vertical `#f3dfa6` → `#d9b35c` (`--cta-bg`) ; filet 1 px `#6e4a14` (`--cta-edge`) ; encre `#2a1c10`
  (`--cta-ink`) ; ombre portée nette `0 0.1em 0 #6e4a14`, sans flou (`--cta-drop`) ; coins 0,2 em.
- Texte : IM Fell English SC (`--sc`), interlettrage 0,06 em, sans ombre (au port, léger liseré clair de 0,04 em).
- Tailles : menus et fiches 1,15 em (marges 0,4 / 1,3 em) ; port 1 em ; `.sm` 0,9 em ; dans un tableau 1 em, marges
  0,18 / 0,6 em. Jamais sous 13 px de corps à 1366 × 768.
- États : survol = luminosité × 1,08 et halo doré doux (`--cta-glow`) ; appui = le bouton descend de 0,1 em et perd son
  ombre ; focus clavier = contour 2 px `--blood` décalé de 2 px ; choix d'Entrée dans une fiche (`.sel`) = anneau rouge
  de 0,16 em autour de l'ombre ; désactivé = aplat parchemin (`--cta-off-bg`), filet 35 % (`--cta-off-edge`), encre brune,
  **opacité 1** (le texte reste lisible ; au port, Spectral italique).
- Touche : pastille `.kc` à gauche du libellé (« [Échap] Lever l'ancre »). Prix : après « · » (« Acheter · 11 745 »).
  Libellé : verbe à l'infinitif et objet court, sans point final.

**Variantes**
- `.seal` (cachet de cire rouge, `--cta-seal-*`) : grosse dépense ou décision sans retour, jamais l'action courante
  (acheter un navire, l'amnistie, partager le butin, demander sa main ; second clic de confirmation pour vendre un navire
  de l'escadre ou finir sa carrière). Un seul par panneau. Appareiller, accepter une promotion, inviter à danser, un
  radoub ou un achat restent en or.
- `.ghost` (lien souligné, encre adoucie) : action secondaire (passer, plus tard, réafficher les conseils).

**Ce qui n'est pas un bouton d'action** (garde son dessin) : entrées de menu `.mi`, cartes de choix `.choice` (nation,
talent, époque), onglets `.seg` et `.ll`, plaques du marché `.pb` (achat / vente pas à pas), lignes de choix `.lb-ch`
de la bataille à terre, cartes du duel `.da-card`, touches `.prompt .key`.

**Règles** : ne jamais coder une couleur de bouton en dur dans une nouvelle interface, reprendre `.btn` ou les jetons
`--cta-*` ; un bouton = une action ; pas d'opacité sur un bouton désactivé (voir les états).

## Technical rules
- Three.js r186 (`import * as THREE from 'three'`, addons from `three/addons/...`). No external asset files,
  no network fetches at runtime: everything procedural (geometry, canvas textures, shaders, WebAudio).
  Google Fonts link in index.html is the only exception.
- Performance budget: 60 fps on a mid-range laptop GPU at 1080p. Share materials/geometries, use
  InstancedMesh for repeated props, merge static geometry, LOD distant objects. Keep draw calls < 400.
- Conventions in `src/core/constants.js` (metres, Y up, heading 0 = north = -Z clockwise).
- Respect file ownership. You may only edit files you own. If you need a hook in a shared file
  (`src/core/game.js`, `src/main.js`, `index.html`), make the smallest additive edit and say so in your report.
  Never rewrite another agent's file.
- Each system has a showcase scene `src/shots/<name>.js` exporting `async setup(game)`; the critic uses it.
- Screenshots: dev server at http://127.0.0.1:5173 (restart with `cd /home/claude/pirates && (nohup npx vite > /tmp/claude-0/vite.log 2>&1 &)` if down —
  check with `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:5173/`).
  `node tools/shot.mjs --shot <name> --out shots/<name>/<file>.png [--tod 17.5] [--play 4]`.
  Rendering is software WebGL (SwiftShader) on 2 CPUs shared by several agents: one shot can take 10–90 s. Be patient;
  don't launch many in parallel. Look at every screenshot you take with the Read tool.
- No console errors. Run a shot and check the CONSOLE output before reporting.
