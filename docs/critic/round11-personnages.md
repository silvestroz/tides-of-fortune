# Ronde 11 — personnages (critique indépendante)

Date : 22/10/2026. Critique fraîche : les rapports des rondes 8 et 10 n'ont pas été lus avant le jugement.
Captures en rendu logiciel 1600 × 900 (SwiftShader, d'après les `.log`) : c'est la vérité terrain, aucun défaut n'est
excusé par le moteur de rendu.

## Images jugées
- Avant (jeu) : `shots/round8/final/{duel_action,duel_finish,duel_garden,duel_tavern,dance,port_tavern,port_governor}.png`,
  `shots/round8/after3/{landbattle,sneak}.png`
- Après (jeu) : `shots/round11/final/{duel_action,duel_finish,duel_garden,duel_tavern,dance,port_tavern,port_governor,landbattle,sneak}.png`
- Atelier, avant : `shots/round8/lab-final/{line,faces,profile,crowd,hands,expr,portraits,line-night,duel}.png`
- Atelier, après : `shots/round11/lab-final/{line,faces,profile,crowd,fists,expr,portraits,line-night,duel}.png`
  (chemins relatifs à `/home/claude/tides-of-fortune/`)

## Étalon : Pirates! (2004), de mémoire (écrit avant de voir nos images)
Duel : deux bretteurs de profil sur un pont, dans une taverne ou un salon, caméra à mi-distance un peu basse. Modèles
bas-poly (environ 3 000 à 5 000 triangles), proportions de caricature (grosse tête, menton, mains épaisses), textures
diffuses peintes à la main avec ombrage cuit, yeux et bouche peints, cheveux en casque texturé. **Animation très vivante**
(feintes et coups lisibles), équipage qui encourage en fond (3–4 variantes clonées, textures floues). Éclairage simple
(directionnelle + ambiante, ombre en tache). Palette saturée, **silhouettes nettes** (grands chapeaux, habits,
baudriers). Défauts : mains en moufles, coutures aux épaules, lame qui traverse le manteau. Bal : salle dorée, fille du
gouverneur en robe à paniers (cône texturé), visage joli mais plastique, poses lisibles, portraits aux murs. Ports :
personnages 3D à mi-corps dans un intérieur, ralenti et lèvres qui battent, chaleureux et lisible. Attaque de ville :
vue tactique, petits groupes de soldats aux couleurs d'équipe très lisibles. Infiltration : ruelles de nuit en 3/4,
gardes qui patrouillent, lisibilité par le contraste.

## Comparaison à l'aveugle (A/B tirés au hasard par paire, clé lue après le jugement)

| Paire | Choix aveugle | Clé | Gagnant | Raison principale |
|---|---|---|---|---|
| duel_action | A (≈65/35) | A = Après | **Après** | foule du pont lisible et énergique (poings levés) ; avant : visages lavés au contre-jour, matelot assis dans le vide devant le mât |
| duel_finish | A (60/40) | A = Après | **Après** | visages de la foule sombres et lisibles ; avant : visages fantômes |
| duel_garden | A (60/40) | A = Après | **Après** | robes ouvertes sur jupon (vraie robe d'époque) ; avant : jupes en cône à bande |
| duel_tavern | B (55/45) | B = Après | **Après** | visages des spectateurs un peu plus nets ; sinon identiques |
| dance | A (65/35) | A = Après | **Après** | robe de bal à paniers ; avant : « chemise de nuit », ombre en barbe sur la dame. Mais tableau de la salle plus mauvais (voir régressions) |
| port_tavern | A (≈52/48) | A = Après | Après, d'un cheveu | serveuse en robe ouverte ; médaillon et recrues : égalité ou léger recul |
| port_governor | B (55/45) | B = Avant | **Avant** | perruques de face en « chou-fleur » (médaillon, gouverneur) ; seul gain après : l'officier regarde la caméra, tableau sans tache blanche |
| landbattle | A (≈52/48) | A = Après | Après, nul en pratique | gardes un peu plus lisibles ; sabreurs olive toujours invisibles sur l'herbe |
| sneak | A (net) | A = Avant | **Avant** | **le capitaine a disparu** dans la capture d'après : anneau vide, ni modèle ni ombre |
| lab line | A (60/40) | A = Après | **Après** | robe ouverte, jupon, souliers galbés ; avant : semelles en dalle |
| lab faces | A (55/45) | A = Après | **Après** | taches blanches à la raie et bande claire sur la lèvre supérieure disparues |
| lab profile | B (60/40) | B = Après | **Après** | perruque à rouleaux horizontaux ; avant : chapelet de boules |
| lab crowd | B (60/40) | B = Après | **Après** | souliers galbés au lieu de sabots |
| lab expr | A (65/35) | A = Après | **Après** | plus de « goutte » blanche à la raie, plus de moustache de lait, menton des dames plus court |
| lab portraits | B (55/45) | B = Après | **Après** | chapeaux entiers, morion sans éclat brûlé ; mais trous de peau dans les barbes |
| lab line-night | A (60/40) | A = Après | **Après** | robe |
| lab duel | A (60/40) | A = Après | **Après** | souliers |
| lab hands → fists | pas à l'aveugle (contenus différents) | — | Après | vrais doigts à phalanges, ongles, pouce opposé ; mais poing vide en **tore creux** |

**Bilan : l'après gagne 15 paires aveugles sur 17**, dont 7 scènes de jeu sur 9 ; il perd `sneak` (bug bloquant) et
`port_governor` (perruques de face). Plusieurs victoires sont courtes (tavernes, attaque de ville) : un joueur moyen ne
choisirait pas l'après 9 fois sur 10 sur ces scènes.

## Verdict : **FAIL**
Progrès réel par rapport à la ronde 8, mais l'étalon reste devant en lisibilité, poses, silhouettes et cohérence, et
l'après contient un bug bloquant (capitaine invisible dans l'infiltration).

| Axe | Avant (r8) | Après (r11) | Étalon (2004) |
|---|---|---|---|
| Matières, textures | 5 | 5 | 6 |
| Éclairage, modelé | 5 | 6 | 5 |
| Silhouettes, formes | 5 | 6 | 7 |
| Articulations, poses | 5 | 6 | 7 |
| Lisibilité à la caméra du jeu | 5 | 5 | 8 |
| Cohérence de la direction artistique | 6 | 6 | 8 |
| Artefacts techniques | 4 | 4 | 6 |
| **Moyenne** | **5,0** | **5,4** | **6,7** |

Le seul axe gagné sur l'étalon est le modelé (ombres portées, sheen, liseré). Lisibilité inchangée : le gain de la
foule du pont est annulé par le capitaine absent de l'infiltration. Artefacts inchangés : neuf défauts corrigés, six
nouveaux, dont un bloquant.

## Corrigé depuis la ronde 8 (vérifié)
Matelot qui flottait devant le mât (duel_action) ; visages lavés de la foule à contre-jour ; taches blanches à la raie
des cheveux (dames, tableau du gouverneur) ; bande claire au-dessus de la lèvre ; ombre en barbe sur le visage de la
danseuse ; semelles en dalle ; morion brûlé dans les médaillons ; chapeaux coupés dans les grands médaillons ; officier
du gouverneur qui regardait ses mains.

## Régressions et nouveaux artefacts
1. **Infiltration : le capitaine n'est plus rendu** (`round11/final/sneak.png`, anneau vide vers (800, 545), aucune ombre ;
   présent en r8). Bug bloquant, pas un réglage.
2. **Perruques de face en chou-fleur** : les rouleaux, devenus horizontaux, se lisent de face comme des houppes de coton
   facettées empilées (médaillon du gouverneur, gouverneur dans la salle, lab line/faces/portraits). Le profil y gagne,
   la face (le cas le plus fréquent : médaillon, dialogue) y perd.
3. **Tableau de la salle de bal** (`dance.png`, cadre en haut à gauche) : mosaïque carrée visible, yeux en points noirs,
   boucles facettées ; en r8 il était plus fondu et plus « peint ».
4. **Robe ouverte, nouveaux défauts** : liseré menthe/cyan lumineux le long des revers (dance, fists) ; jupon clair qui
   perce l'ourlet de la robe en « dents » triangulaires (dance, lab line).
5. **Trous de peau dans les barbes des médaillons** : tache orange sous la lèvre inférieure (capitaine gris, matelot,
   lab portraits).
6. **Petits médaillons des recrues** (taverne) : peau plus pâle, presque blanche (Coq, Charpentier, Canonnier), tricorne
   du canonnier toujours coupé par le cadre.
7. **Poing vide en tore** (fists : poing baissé du matelot = anneau orange creux avec bagues fantômes ; poing levé = pile
   d'anneaux). Le même anneau creux se voit en jeu dans la taverne (homme au tricorne, à gauche).
8. Ligne des cheveux en dents de scie avec encoches de peau (matelot, fists).
9. Coût : +7 à +10 % de triangles à figures égales (atelier : line 127 → 138 k, profile 139 → 152 k, crowd 118 → 127 k,
   duel 66 → 71 k).

## Défauts persistants (avant et après)
Visage de l'adversaire en duel ≈ 50 px de haut, yeux de 3–4 px : deux points et une barbe, effet Playmobil ; capitaine
du joueur vu de dos = boule + chapeau. Jambes en échasses (aucun mollet, genoux mous). Mèches latérales noires en
« écouteurs » autour d'une oreille ovale pâle. Boucle de soulier lue comme un anneau doré autour de la cheville (fers
de forçat). Crispins en entonnoir. Entrejambe des culottes blanches en couche. Pans de l'habit rouge du capitaine avec
dents blanches à l'ourlet (dance). Mains posées sur les pans = tache blanche déchiquetée (dance). Points noirs du contour
sur le nez et les joues de la danseuse. Lèvres foncées lues comme une moustache à distance (dame blonde, jardin).
Frange jusqu'aux sourcils, sourcils posés sur la frange (dames). Morion brûlé de nuit (line-night), plastron en
bavette. Attaque de ville : soldats en mouchetis, sabreurs olive invisibles sur l'herbe.

## Corrections classées (12 au plus, la plus importante d'abord)

1. **Capitaine invisible en infiltration.** Où : `src/game/sneak/view.js` (capitaine ×1,2, `manGeo` / `menMaterial`
   `landMen_v2`, attribut `aTint`). Attendu : capitaine rouge à l'épée lisible dans l'anneau, avec son ombre, comme en r8.
   Technique : lire la console de `?shot=sneak` (exception à la construction ou attribut `aTint` manquant sur sa
   géométrie → programme qui n'affiche rien) ; ajouter à `test-sneak.mjs --browser` une sonde de pixels dans l'anneau
   (au moins N pixels de la couleur de l'habit) pour que ça ne revienne pas.

2. **Visages illisibles à la caméra du duel.** Où : `figure.js`, duellistes (`headScale` 1,26). Attendu : à 1600 × 900,
   le visage adverse doit porter une expression lisible (sourcils, blanc des yeux, bouche), comme les têtes peintes de
   l'étalon. Technique : agrandir les traits avec la distance (yeux et sourcils ×1,25–1,35 au-delà de 4 m, épaisseur des
   sourcils ×1,5), creuser les orbites et l'ombre sous le nez dans `col(v)` (valeurs sombres plus fortes), bouche plus
   large et plus contrastée ; viser un visage d'au moins 60 px (focale, ou tête 1,32 pour l'adversaire seul).

3. **Poing vide en tore.** Où : `buildFist` (poing sans arme : foule `o.fists`, figurants). Attendu : un bloc de poing
   plein, jointures en relief, pouce replié devant. Technique : sans poignée, ramener l'axe d'enroulement des doigts à
   0–5 mm (doigts serrés dans la paume) et boucher l'intérieur par une capsule « paume » ; fusionner les anneaux des
   phalanges du poing levé en une seule surface de dos de main (moins de rangées, normales lissées).

4. **Perruques de face.** Où : perruques à rouleaux (gouverneur, médaillons, tableaux). Attendu : de face, des rouleaux
   horizontaux superposés lus comme des cylindres poudrés, séparés par un sillon sombre ; de profil, comme aujourd'hui.
   Technique : chaque rouleau = segment de tore ou capsule orientée avant-arrière (plus de sphères), normales lissées sur
   le rouleau entier, AO peinte dans les sillons, 3 rouleaux au lieu de 4–5 sur le médaillon.

5. **Robe ouverte : liseré menthe et jupon qui perce.** Où : robe sur l'os `gown`, `o.petticoat`. Attendu : revers de
   la couleur de la robe (doublure plus sombre ou crème), ourlet net. Technique : le liseré vient de la face arrière ou
   de la doublure éclairée par un `sheenColor` froid à incidence rasante → doublure en double face avec sa propre teinte
   chaude, `sheenColor` dérivé de la couleur de base ; jupon 1,5 cm plus étroit que la robe à l'ourlet et 1 cm plus
   court, ou découpe de la robe sans recouvrement du jupon dans `DanceView.pose` (évasement).

6. **Tableau du bal en mosaïque.** Où : `paintedBust()` / `kuwahara()` (`scenes.js`). Attendu : buste peint fondu
   comme en r8 (ou mieux), touches orientées, iris colorés. Technique : rendre le buste à 2× puis réduire, Kuwahara
   anisotrope (orienté par le tenseur de structure) au lieu de secteurs carrés, filtrage linéaire et mipmaps sur la
   texture du tableau, rehauts blancs dans les yeux.

7. **Barbes trouées dans les médaillons.** Où : barbe (`o.stubble`, maillage de barbe) des portraits du capitaine et du
   matelot. Attendu : barbe continue jusqu'à la lèvre inférieure. Technique : étendre le masque de la barbe jusqu'à la
   lèvre (zone de la mouche), ou foncer la peau sous la barbe dans `col(v)` pour qu'un jour entre barbe et menton ne se
   lise pas comme une tache orange.

8. **Petits médaillons pâles.** Où : `portraitLazy` (recrues, équipage). Attendu : peau aussi chaude que dans les
   grands médaillons, chapeau entier. Technique : exposition −0,3 IL ou clé moins forte pour les petits formats,
   saturation de la peau +10 %, cadre élargi des grands médaillons appliqué aussi aux petits (tricorne du canonnier).

9. **Jambes et chevilles.** Où : `limb()` des jambes, souliers. Attendu : mollet galbé dans le bas, genou marqué,
   boucle posée à plat sur le cou-de-pied. Technique : profil de rayon de la jambe avec renflement du mollet (+18 % au
   tiers haut du tibia), tibia 5 % plus court ; boucle = plaque rectangulaire sur le dessus du soulier, plus d'anneau
   autour de la cheville.

10. **Cheveux sur les côtés et ligne des cheveux.** Où : calottes de cheveux (`hairline()`), mèches latérales. Attendu :
    tempes fondues dans la calotte, oreille de couleur peau et dessinée, ligne des cheveux lisse. Technique : supprimer
    l'anneau sombre autour de l'oreille, raccorder les mèches à la calotte (même matière, AO douce) ; dans `hairline()`,
    lisser le remappage (pas de rangées sautées) et imposer un décalage minimal de 3 mm partout pour éviter les
    encoches de peau.

11. **Défauts d'habit.** Où : crispins, culottes, pans d'habit, morion. Attendu : crispin évasé à bord roulé, braguette
    à pont sombre, pans sans dents blanches, acier mat de nuit. Technique : évasement des crispins −40 % avec épaisseur
    de bord ; couture et rabat sombres peints sur l'entrejambe ; doublure des pans en double face de la couleur de
    l'habit (les dents blanches sont la doublure ou les faces arrière) ; morion `roughness` ≥ 0,35 et éclat plafonné
    sous le bloom ; plastron du garde suivant le torse.

12. **Lisibilité des petits soldats (attaque de ville).** Où : `manGeo` / `menMaterial` (`landMen_v2`). Attendu : chaque
    troupe lue comme un groupe de petits hommes aux couleurs nettes, comme l'étalon. Technique : couleur de troupe plus
    saturée et plus claire que le terrain (sabreurs olive → ocre ou rouge selon la nation), chapeau sombre agrandi
    ×1,2 pour la silhouette vue de dessus, liseré clair en bord d'écran (fresnel) et ombre de contact sous chaque homme.


## Suites données (même soirée)
- Fait : capitaine de l'infiltration de nouveau rendu (un commentaire avalait la mise à jour de sa matrice, `sneak/view.js`) ;
  perruques vues de face (côtés et arrière en masses roulées d'un seul tenant, sillons peints, plus de boules) ; tableaux
  peints à 2× avec un Kuwahara plus fin (plus de mosaïque au bal) ; liseré des robes à la vraie couleur du revers (plus
  de menthe) ; jupon plus étroit et plus court que la robe (plus de dents claires à l'ourlet) ; barbes poussées avec le
  menton et peau teintée sous la lèvre (plus de tache orange) ; petites vignettes des recrues moins exposées.
  Captures : `shots/round11/fix1/`.
- Reporté à plus tard : visages encore petits au duel sur le pont (yeux et sourcils agrandis au-delà de 4 m, caméra),
  poing vide fermé par une capsule, mollets et boucles de souliers, ligne des cheveux, détails d'habit, couleurs des
  troupes de l'attaque de ville.
