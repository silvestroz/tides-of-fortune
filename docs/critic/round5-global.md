# Ronde 5 — critique globale (navigation, combat, port vu du large, écrans de port, duel)

Captures jugées (SwiftShader, crénelage ignoré) :
- gfx/final : `after_sailing.png`, `after_combat.png`, `after_combat_wide.png`, `after_harbour.png`, `after_port.png`, `after_duel.png`
- portui : `after-harbour-1920.png`, `after-market-1920.png`, `after-shipyard-1920.png`, `after-tavern-1920.png`
(dans /tmp/claude-0/-home-claude/622fcff2-21a9-5b33-a8df-d605207a612d/scratchpad/{gfx/final,portui}/)
Étalon : captures de référence internes (non reproduites ici). Non vues faute de temps : bank, governor, keys, tactical, combat_ai, duel_parry.

## Verdicts

| Système | Composition | Lumière | Matériaux | Lisibilité | Finition AAA | Moy. ours | Moy. réf | Verdict |
|---|---|---|---|---|---|---|---|---|
| Navigation | 6 / 7 | 8 / 6 | 5 / 6 | 6 / 7 | 6 / 7 | 6,2 | 6,6 | FAIL |
| Combat | 4 / 7 | 7 / 6 | 4 / 6 | 4 / 8 | 5 / 7 | 4,8 | 6,8 | FAIL |
| Port vu du large | 6 / 7 | 7 / 7 | 4 / 7 | 6 / 7 | 5 / 7 | 5,6 | 7,0 | FAIL |
| Écrans de port | 7 / 6 | 7 / 6 | 5 / 8 | 8 / 6 | 7 / 7 | 6,8 | 6,6 | FAIL (proche) |
| Duel | 5 / 8 | 6 / 7 | 4 / 8 | 5 / 8 | 4 / 8 | 4,8 | 7,8 | FAIL |

(notes ours / référence). Aucun système ne remplit « mieux sur chaque axe » ; les écrans de port sont les seuls à gagner en moyenne (UI et lisibilité), mais pas sur les matériaux de la scène 3D.

## Navigation (`after_sailing`)
Points forts : eau et ciel nettement au-dessus (profondeur, nuages volumétriques, brume atmosphérique, îles en perspective aérienne), HUD parchemin cohérent.
Défauts : le navire est petit, collé au centre, sans ombre portée ni reflet ; voiles en panneaux plats quasi uniformes ; eau sans mousse de crête ni reflet du ciel, texture répétitive à gauche ; îles lointaines trop délavées (gris-vert uniforme) ; aucune île proche, rien à lire en premier plan ; HUD (3 panneaux + boussole + carte) trop lourd pour la surface.
Corrections :
1. Rapprocher la caméra par défaut (navire ~1,5x plus grand) et incliner légèrement pour montrer le pont et la poupe dorée.
2. Ombre portée du navire sur l'eau + reflet des voiles (planar fake ou SSR léger) : sans cela, le navire flotte au-dessus.
3. Voiles : cambrure vers le vent, coutures, ombres de vergue, translucidité à contre-jour, bord de fuite qui claque.
4. Eau : mousse de crête dans le sillage et aux crêtes (seuil de Jacobien), glitter solaire plus lisible, supprimer la répétition visible sur le quart gauche.
5. Ajouter un point d'intérêt proche (îlot, bouée, oiseaux, banc de sable turquoise) pour donner de l'échelle et un plan moyen.
6. Alléger le HUD : replier la fiche cible quand rien n'est ciblé, réduire l'opacité des panneaux, garder la boussole seule.

## Combat (`after_combat`, `after_combat_wide`)
Points forts : fumée et flash de bordée crédibles, bulles d'identification lisibles.
Défauts : les deux navires sont minuscules (≈ 5 % de l'écran) ; la scène est un grand aplat d'eau vide, la référence remplit le cadre avec deux coques détaillées ; navire du joueur absent du cadre sur `after_combat` ; sillage en pointillés (points blancs répétés) ; impacts et dégâts de coque invisibles à cette échelle ; trois blocs HUD parchemin plus un message écrasent la lecture.
Corrections :
1. Caméra de combat : cadrer les deux navires à 25–35 % de la hauteur d'écran, caméra plus basse, plus proche, avec suivi de l'ennemi.
2. Sillage continu en ruban de mousse décroissante (pas de sprites espacés), avec écume à l'étrave.
3. Dégâts lisibles : trous de boulets, voiles déchirées, mâts brisés, flammes sur la coque ; feedback d'impact (gerbes d'eau, éclats de bois, flash).
4. Fumée de bordée : volutes plus épaisses et persistantes, ombrées et éclairées par le soleil, dérivant avec le vent.
5. Ligne de tir / arcs de bordée tracés sur l'eau pour que la manœuvre se lise sans HUD.
6. Réduire le HUD en combat : fusionner les bulles et la fiche cible, retirer le doublon de la boussole.

## Port vu du large (`after_harbour`, `after_port`, `after-harbour-1920`)
Points forts : lumière dorée chaude, brume, ciel, esprit « livre d'aventure ». Titre et menu typographiquement soignés.
Défauts : les maisons sont des boîtes à toits plats, sans ouvertures lisibles ni arbres ni palmiers autour, donc la ville fait maquette ; les navires amarrés sont des coques plates marron sans voiles ni détail (cf. quai en `after_harbour`, nettement sous le niveau du navire joueur) ; la falaise occupe 60 % du cadre avec une texture verte floue ; eau verdâtre terne, sans transparence ni rivage turquoise ; fond sombre et vignette trop forts derrière le menu ; fort contraste de niveau avec la référence (toits, palmiers, sable, rayons de soleil).
Corrections :
1. Maisons : toits à deux pans avec débords, cheminées, volets, fenêtres, murs chaux avec salissure ; variation de hauteur et d'orientation.
2. Végétation : palmiers et bosquets instanciés au pied des maisons et sur la plage, buissons en couronne autour de la ville.
3. Navires amarrés : réutiliser le modèle de navire du joueur en LOD bas, voiles carguées, pavillons.
4. Eau du port : gradient turquoise vers le rivage, transparence avec fond sableux, petites vagues de rive, reflets des bâtiments.
5. Recadrer : moins de falaise, ville plus grande et plus haute dans le cadre, rayons de soleil (god rays) sur la ville.
6. Éclaircir le dégradé sombre gauche et la vignette pour garder des couleurs saturées.

## Écrans de port (marché, chantier, taverne ; `after-*-1920`)
Points forts : meilleure UI du jeu et meilleure que la référence en lisibilité et en artisanat (parchemin, hiérarchie typographique, icônes, tableau marchand, onglets). Éclairage chaud et ambiance de taverne réussis.
Défauts : les scènes 3D de gauche sont à un niveau très inférieur à la référence : personnages à bras en bâtons, visages plats, pavés bruns répétés et sombres, murs en aplats, ombres en escalier (marché), navire du chantier aux proportions étranges (coque pixellisée, haubans en spaghettis) ; le panneau parchemin couvre 40 % de l'écran et coupe le contenu (liste du marché et chantier tronqués en bas) ; le texte de dialogue en bas est grand mais sans fond, parfois sur zones claires ; le portrait du PNJ en bas à gauche est du clip-art plat, en rupture avec la scène.
Corrections :
1. Personnages : modèle commun avec mains, épaules, vêtements en volumes, textures peintes, expressions ; éviter les bras en bâtons.
2. Sol : pavés avec normal map, joints sombres, mousse et flaques, variation de teinte ; supprimer la répétition marron.
3. Murs et façades : enduit avec salissures, pierres d'angle, poutres apparentes, volets en relief ; réduire les aplats.
4. Ombres : augmenter la résolution et adoucir (PCF) pour supprimer l'escalier ; lumières ponctuelles avec halos et rebonds chauds.
5. Chantier : modèle de navire propre (voir navigation) et cadrage plus loin pour éviter la déformation ; supprimer les mâts flottants du fond.
6. Mise en page : permettre un panneau plus étroit et scroll visible, ajouter un fond sous le texte du bas, portrait PNJ en rendu de la scène.

## Duel (`after_duel`)
Points forts : lumière chaude contre-jour, public en arrière-plan, HUD sobre.
Défauts : personnages bas de gamme, membres cylindriques, mains absentes, visages sans détail, aucune texture de vêtement ; contraste de niveau énorme avec la référence (ornements dorés sculptés, bois veiné, voile déchirée, expressions) ; planches du pont en aplat orange avec flou lourd ; caméra trop basse et trop proche des boiseries, avec un flou de profondeur de champ qui empâte la scène ; bloom excessif sur le fond gauche (silhouettes grillées) ; épées très fines et peu lisibles ; la lisibilité du duel (qui attaque, qui pare, position des lames) est faible sans animation ; barre d'avantage absente, remplacée par une jauge discrète.
Corrections :
1. Refaire les personnages d'escrime : torse, bras en volumes, épaules, vêtements en plis, chapeaux, bottes, visages avec yeux/nez/barbe.
2. Poses : cadrage plus latéral, postures d'estoc/parade marquées (fente, garde), traînées d'épées lors des coups.
3. Décor : ornements sculptés à la poupe (reliefs dorés, volutes), pont avec veinage, joints et usure ; lanternes, cordages enroulés.
4. Éclairage : réduire le bloom et le flou de profondeur de champ à 30 % ; ombres nettes sous les combattants.
5. Feedback : étincelles de contact, indication de ligne haute/basse en surimpression au sol, étourdissement visible.
6. HUD : jauge d'avantage centrale grande, avec effectifs des deux camps de chaque côté.

## Top 10 global (par impact)
1. Combat : navires beaucoup trop petits et scène vide — recadrer à 25–35 % de la hauteur d'écran, caméra plus proche.
2. Duel et PNJ de port : refaire le modèle de personnage (volumes, mains, visage, textures peintes) ; commun aux deux systèmes.
3. Port vu du large : maisons détaillées, palmiers, navires amarrés réutilisant le modèle du joueur, eau turquoise vers le rivage.
4. Navire (tous systèmes) : voiles cambrées avec coutures et translucidité, ombre portée et reflet sur l'eau.
5. Combat : dégâts visibles (trous, voiles déchirées, flammes) et sillage continu en ruban de mousse.
6. Matériaux 3D des scènes de port : pavés, murs, bois avec normal maps et variation, ombres adoucies.
7. Navigation : caméra plus proche et point d'intérêt en plan moyen ; alléger le HUD (fiche cible repliable).
8. Eau : mousse de crête, glitter, suppression de la répétition de texture, reflet du ciel.
9. Duel : décor sculpté doré, bloom et profondeur de champ réduits, poses lisibles, jauge d'avantage.
10. Mise en page des écrans de port : panneau parchemin moins envahissant, texte de dialogue sur fond, contenu non tronqué.
