# Ronde 6 — critique globale (navigation, combat, port vu du large, écrans de port, duel)

Captures jugées (SwiftShader, crénelage ignoré), dans /tmp/claude-0/-home-claude/622fcff2-21a9-5b33-a8df-d605207a612d/scratchpad/ :
- night1 : `after_sailing`, `after_combat`, `after_combat_wide`, `after_combat_ai` (+ `before_combat`, `before_sailing`)
- night2 : `after_duel` (+ `before_duel`), `after_market`, `after_tavern`, `after_governor`
- night3 : `after_islands_port`, `after_islands_quay`, `after_port-{market,shipyard,tavern,governor}-1920`
Étalon : captures de référence internes (non reproduites ici). Pas vues : `after_combat_low`, versions 1366.

## Verdicts

Notes ours / référence. Moyenne ours (progrès vs ronde 5).

| Système | Composition | Lumière | Matériaux | Lisibilité | Finition AAA | Moy. ours | Moy. réf | Progrès R5 -> R6 | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| Navigation | 7 / 7 | 8 / 6 | 6 / 6 | 6 / 7 | 7 / 7 | 6,8 | 6,6 | 6,2 -> 6,8 (+0,6) | FAIL (très proche) |
| Combat | 5 / 7 | 7 / 6 | 5 / 6 | 5 / 8 | 5 / 7 | 5,4 | 6,8 | 4,8 -> 5,4 (+0,6) | FAIL |
| Port vu du large | 7 / 7 | 8 / 7 | 6 / 7 | 7 / 7 | 6 / 7 | 6,8 | 7,0 | 5,6 -> 6,8 (+1,2) | FAIL (très proche) |
| Écrans de port | 7 / 6 | 8 / 6 | 6 / 8 | 7 / 6 | 7 / 7 | 7,0 | 6,6 | 6,8 -> 7,0 (+0,2) | FAIL (matériaux 3D) |
| Duel | 6 / 8 | 6 / 7 | 5 / 8 | 6 / 8 | 5 / 8 | 5,6 | 7,8 | 4,8 -> 5,6 (+0,8) | FAIL |

Règle WIN = mieux sur chaque axe ET choix à l'aveugle 9/10 : aucun système n'y est. Meilleur progrès : port vu du large (maisons à toits, palmiers, eau turquoise, navires voilés). Plus gros écart restant : duel, puis combat.

## Navigation (`after_sailing`)
Progrès : navire ~2x plus grand, vu de trois-quarts arrière avec poupe dorée et pavillon lisibles, sillage en ruban de mousse continu, voiles avec liserés rouges et cambrure, îles à plusieurs plans. Le HUD est resté mais plus propre.
Défauts : flou de profondeur de champ envahissant (toute l'eau au premier plan est empâtée, le navire seul est net : effet « miniature ») ; ombre/reflet du navire quasi absents ; îles lointaines toujours délavées et homogènes ; eau sans crêtes écumeuses ni glitter ; toujours aucun élément proche en plan moyen ; fiche cible permanente même en « Neutre » ; l'emblème rouge rond sur la voile majeure fait autocollant.
Corrections :
1. Ramener le DoF à ~30 % (focus plus profond, rayon de flou limité à l'eau très proche) : l'eau doit rester peinte et texturée.
2. Ombre portée douce + reflet de coque/voiles dans l'eau sous la coque (planar fake) ; ajouter écume d'étrave plus dense.
3. Ajouter mousse de crête (seuil sur le Jacobien) et glitter solaire sur le côté éclairé de la houle.
4. Plan moyen : îlot/rocher avec écume de brisants, bancs turquoise, mouettes sillonnant, bouée ; casser le vide à 100-300 m.
5. Îles lointaines : saturation et contraste de valeur par plan (3 couches de brume au lieu d'un gris-vert unique), silhouettes de falaises plus marquées.
6. HUD : fiche cible repliée tant qu'aucun navire n'est visé ; réduire l'opacité des 3 blocs ; rétrécir la mini-boussole en haut à droite.

## Combat (`after_combat`, `after_combat_wide`, `after_combat_ai`)
Progrès : énorme vs « before » (écran noir vide) ; deux navires cadrés avec bulles d'identification, bordées avec flash et fumée, sillages en rubans, reflets sous coque en vue large. Mais les navires ne remplissent toujours que 15-25 % de la hauteur et la lecture est loin de la référence.
Défauts : trajectoires de boulets en longues traînées horizontales type lasers, sans impact visible ; fumée en « boules de coton » découpées et disque de splash à bord net en `combat_ai` (artefact très visible) ; moiré/bandes sur l'eau du haut de l'écran (`combat_ai`) ; aucun dégât de coque/voile/mât lisible ; vue large : navires minuscules, 60 % d'eau vide ; 4 blocs HUD (bulles, fiche, message, boussole) pour deux navires ; DoF pâteux sur les coques.
Corrections :
1. Caméra : cadrer la paire à 30-35 % de la hauteur, caméra plus basse et plus proche, jamais de vue « wide » comme défaut ; verrouiller les deux navires dans le tiers central.
2. Boulets : projectiles courts et lisibles (sphère sombre + fine traînée de 0,3 s), gerbe d'eau à l'impact (colonne + anneau + retombée), éclats de bois et trou noirci à l'impact sur coque.
3. Dégâts persistants : trous de boulets sur la coque, voiles déchirées/percées (alpha-clip), mâts brisés, feu et fumée noire sur la coque comme l'étalon ; chaque palier de 25 % de dégâts doit se voir.
4. Fumée : remplacer les sprites boule par volutes à bord doux, dégradé éclairé-ombré, durée 4-6 s, dérive vent ; supprimer le disque de splash opaque (fade du bord + alpha de bruit).
5. Eau : corriger le moiré (mipmaps/anisotropie ou atténuer la normale à distance) ; sillage avec écume d'étrave et décroissance plus longue.
6. HUD : fusionner bulles + fiche cible (une seule par navire), retirer le message parchemin du coin quand une bordée est en cours.

## Port vu du large (`after_islands_port`, `after_islands_quay`)
Progrès : le plus net. Maisons à toits tuile orange et volets bleus, palmiers et arbres instanciés, fort de pierre, plage et muret de quai, eau turquoise au rivage, navires amarrés avec voiles/pavillon, ponton de bois. L'ambiance « livre d'aventure » existe enfin.
Défauts : navires amarrés qui flottent (pas de contact eau/coque, pas d'ombre, pas de remous) ; haubans/étais démesurés qui traversent la ville (`quay`) ; maisons encore toutes pareilles (même module, même hauteur, alignées en rang d'oignons) ; ville trop petite et basse dans le cadre, 50 % du cadre = eau vide répétitive ; montagne en dégradé vert flou sans strates ni roche ; aucun mouvement de vie (gens, barques, fumée de cheminée).
Corrections :
1. Ancrer chaque navire : ombre de coque, ligne de flottaison avec écume, légère gîte/roulis, ancre ou amarres vers le quai ; raccourcir/corriger les haubans et bout-dehors qui dépassent.
2. Variation des maisons : 2-3 étages, pignons, cheminées, balcons, enduits de couleurs différentes, église/clocher visible, rues en pente ; casser l'alignement.
3. Cadrage : baisser la caméra et monter la ville à 40 % de la hauteur, réduire l'eau vide, ajouter une ligne de brisants et un reflet des bâtiments.
4. Eau du port : transparence avec fond sableux, vaguelettes de rive, glitter ; supprimer la répétition de normale au premier plan.
5. Montagne : strates rocheuses, ravines peintes, bosquets plus denses en lisière, nuage accroché au sommet, rayons de soleil rasants.
6. Vie : barques de pêche, mouettes, fumées, pavillons animés, silhouettes sur le quai.

## Écrans de port (marché, taverne, chantier, gouverneur ; `after_port-*-1920`)
Progrès : UI toujours la meilleure du jeu et supérieure à la référence en artisanat ; scènes 3D nettement plus riches (taverne : lanternes, tables, tapis ; gouverneur : lustre, perruques, damier ; chantier : voiles rapiécées, échafaudage, ponton). Navire du chantier bien meilleur (voiles trouées).
Défauts : matériaux 3D encore sous l'étalon : fenêtres du marché en aplats jaunes émissifs sans cadre ni profondeur, façades unies, mur de fond du chantier absent (ciel/eau plats), pavés répétitifs sombres ; PNJ aux bras/jambes cylindriques, mains absentes ; gouverneur : cadres noirs vides, sol damier sans joints, fenêtre blanche cramée, ombres en escalier ; chantier : drapeau pixellisé géant au premier plan qui bouche le cadre, haubans en fils uniformes ; liste du marché toujours tronquée en bas (dernière ligne coupée), panneau ~40 % de la largeur ; texte de dialogue sur bandeau (bien) mais portrait clip-art qui jure.
Corrections :
1. Personnages : modèle commun à volumes (épaules, manches bouffantes, mains à 3-4 segments, plis de manteau, visage modelé) ; supprimer les cylindres.
2. Façades/fenêtres : encadrements en relief, volets, rideaux, lueur chaude avec gradient et reflet ; salissures et briques en normal map.
3. Tableaux du gouverneur : peindre portraits/cartes dans les cadres, rideaux, tapis, globe, étagères ; supprimer le blanc cramé de la fenêtre (extérieur peint).
4. Chantier : reculer la caméra de 15 %, supprimer le drapeau de premier plan, ajouter arrière-plan (cale sèche, hangars, grue), texture de drapeau haute résolution.
5. Ombres : PCF doux 2048+ avec bias réglé pour supprimer l'escalier ; point lights à halos pour lanternes.
6. Mise en page : liste du marché scrollable avec fondu et dernière ligne jamais coupée ; panneau réduit à ~32 % ; portrait PNJ rendu depuis la scène.

## Duel (`after_duel`)
Progrès : réel. Visages avec barbe/chapeaux, foule rayée aux bras levés, boiseries rouges et dorées sculptées, barre d'avantage centrale, effectifs, bloom plus sage, ombres plus nettes. Le contraste de niveau avec l'étalon reste très grand.
Défauts : combattants à jambes/bras cylindriques, pas de mains ni de doigts, pieds en blocs, poses raides (le capitaine est en fente mais sans torsion du buste) ; épées très fines et translucides, aucun feedback de contact ; pont en planches orange lisses sans veinage, sans joints sombres ni usure, ombres en escalier ; ornement sculpté plat (volutes à plat, pas de relief doré) ; fond gauche encore cramé par le soleil ; foule en poupées identiques ; HUD du haut sombre bien fait mais textes secondaires illisibles (« Le pont / Équipage ») ; barre d'avantage trop discrète vs l'étalon.
Corrections :
1. Corps : torse en volume, épaules, manches, mains, bottes à talon, manteau qui flotte sur la fente ; torsion de colonne et poids sur la jambe avant.
2. Épées : lame plus épaisse, reflet spéculaire, garde en coquille, traînée lors des coups, étincelles + son + hitstop à la parade/contact.
3. Pont : veinage et joints sombres, clous, taches de sang/usure, éclats de planches après coup ; ombres douces (PCF) sous les pieds.
4. Décor : relief doré avec vrai normal map sur les panneaux de poupe, lanternes allumées, cordages enroulés, voile déchirée en haut ; tamiser le contre-jour de gauche (tone-map/bloom threshold).
5. Lisibilité : surimpression de ligne haute/médiane/basse au sol, étourdissement visible, indicateur d'attaque/parade au-dessus de chaque duelliste.
6. HUD : barre d'avantage plus grande, texte secondaire plus contrasté, foule variée (corps, couleurs, animations désynchronisées).

## Top 10 global (par impact)
1. Combat : navires trop petits (15-25 %) et vue large par défaut ; cadrer à 30-35 % de la hauteur, caméra basse.
2. Combat : dégâts invisibles (trous, voiles déchirées, mâts brisés, feu) et projectiles en lasers sans impact d'eau ni de bois.
3. Combat/FX : fumée en boules de coton et disque de splash à bord net ; remplacer par volutes ombrées, gerbes d'eau et éclats de bois.
4. Duel + PNJ de port : refaire le modèle de personnage (volumes, mains, plis de vêtement, textures peintes) ; commun aux deux systèmes.
5. Duel : lames, contact et poses (étincelles, hitstop, torsion, traînées) et pont veiné, ombres douces.
6. Navigation/Combat : DoF trop fort qui empâte l'eau ; descendre à ~30 % et corriger le moiré de l'eau lointaine.
7. Navires (tous systèmes) : ombre portée, reflet et écume de flottaison ; amarrés au port qui flottent, haubans démesurés.
8. Port vu du large : variété des maisons, ville plus haute dans le cadre, montagne stratifiée, vie (barques, mouettes, fumées).
9. Matériaux des scènes de port : fenêtres en relief, façades salies, tableaux peints, pavés normal-mappés, chantier avec décor et sans drapeau parasite.
10. Navigation : plan moyen (îlot, brisants, bancs turquoise), mousse de crête, glitter ; HUD allégé (fiche cible repliable) ; marché sans ligne tronquée.
