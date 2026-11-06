# Ronde 7 — critique globale (navigation, combat, port vu du large, écrans de port, duel)

Captures jugées (SwiftShader, crénelage ignoré), dans /tmp/claude-0/-home-claude/622fcff2-21a9-5b33-a8df-d605207a612d/scratchpad/ :
- night6 : `after_sailing`, `after_combat_ai`, `after_islands_port`, `after_port_harbour`, `after_port_market`, `after_port_shipyard`, `after_port_tavern`, `after_port_governor`
- night5 : `after_combat`, `after_duel_parry`, `after_duel_hit`, `after_duel_finish`
- night4 : `after_combat_wide`, `after_combat_low`, `after_quay`
Étalon : captures de référence internes (non reproduites ici). Non vues : `after_harbour` (night4), `after_combat_ai` (night5), `after_sailing` (night4/gfx).

## Verdicts

Notes ours / référence. Moyennes ours : R5 -> R6 -> R7.

| Système | Composition | Lumière | Matériaux | Lisibilité | Finition AAA | Moy. ours | Moy. réf | R5 -> R6 -> R7 | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| Navigation | 7 / 7 | 8 / 6 | 7 / 6 | 7 / 7 | 7 / 7 | 7,2 | 6,6 | 6,2 -> 6,8 -> 7,2 | FAIL (à égalité sur 3 axes, ne gagne pas à l'aveugle 9/10) |
| Combat | 6 / 7 | 7 / 6 | 6 / 6 | 6 / 8 | 6 / 7 | 6,2 | 6,8 | 4,8 -> 5,4 -> 6,2 | FAIL |
| Port vu du large | 7 / 7 | 8 / 7 | 7 / 7 | 7 / 7 | 6 / 7 | 7,0 | 7,0 | 5,6 -> 6,8 -> 7,0 | FAIL (très proche) |
| Écrans de port | 8 / 6 | 8 / 6 | 7 / 8 | 8 / 6 | 8 / 7 | 7,8 | 6,6 | 6,8 -> 7,0 -> 7,8 | FAIL (matériaux 3D seulement) |
| Duel | 7 / 8 | 7 / 7 | 6 / 8 | 7 / 8 | 6 / 8 | 6,6 | 7,8 | 4,8 -> 5,6 -> 6,6 | FAIL |

Moyenne globale ours : R5 5,6 -> R6 6,1 -> R7 7,0. Aucun WIN strict, mais navigation, port et écrans de port battent ou égalent la référence en moyenne. Plus gros progrès de la nuit : duel (+1,0), combat (+0,8), écrans de port (+0,8). Plus gros écart restant : duel (-1,2), combat (-0,6).

## Navigation (`night6/after_sailing`)
Progrès vs R6 : DoF réduit (l'eau redevient texturée), un îlot proche avec palmiers et plage donne le plan moyen, îles lointaines mieux étagées, sillage large et lisible, mouettes, HUD allégé (fiche cible plus petite, boussole compacte). Le meilleur écran 3D du jeu.
Défauts : ombre et reflet du navire toujours faibles (il glisse sur l'eau) ; eau sans crêtes écumeuses ni glitter côté soleil ; sillage trop long et trop uniforme, bande blanche rectiligne sans turbulence ; l'emblème rouge sur la grand-voile reste un autocollant ; fiche cible « Neutre » toujours permanente ; ciel/horizon à gauche légèrement délavé.
Corrections :
1. Ombre portée douce + reflet de coque et voiles sous la carène ; écume de flottaison à l'étrave et le long de la coque.
2. Mousse de crête sur la houle (seuil Jacobien) + glitter solaire sur les faces éclairées.
3. Sillage : turbulence, bords effilochés, deux lignes de mousse divergentes de l'étrave, durée de vie plus courte.
4. Voiles : emblème intégré à la toile (déformation, couture, transparence), ombre de vergue, translucidité à contre-jour.
5. Fiche cible repliée sans cible, panneaux plus transparents.

## Combat (`night5/after_combat`, `night4/after_combat_wide`, `night4/after_combat_low`, `night6/after_combat_ai`)
Progrès : vrai saut. Navires ennemis aux voiles déchirées et mâts abîmés lisibles, fumée noire de coque, gerbes d'eau, reflets en vue basse, bulles d'identification propres. Vue basse (`low`) correcte : mer, îles, navires.
Défauts : `night6/after_combat_ai` régresse nettement : caméra quasi zénithale, soleil cramé qui noie la moitié supérieure, rayons moirés sur toute l'eau, flou énorme, bulles minuscules ; les nuages de fumée restent des « boules de coton » découpées ; les boulets sont encore des pointillés + traînées fines horizontales sans impact net ; navires toujours à 20-25 % de la hauteur en vue haute ; flammes absentes (l'étalon brûle) ; mini-nuages de splash blancs opaques à bord trop net ; 5 blocs HUD (message, 2 bulles, fiche, boussole) pour deux navires ; DoF encore pâteux sur les coques.
Corrections :
1. Caméra de combat : plafonner l'élévation (pas de vue zénithale), paire à 30-35 % de la hauteur, jamais de contre-jour direct sur le soleil ; corriger l'exposition/bloom en vue haute.
2. Moiré : atténuer la normale et le glitter avec la distance/l'angle rasant, anisotropie ; supprimer les rayons striés sur l'eau.
3. Impacts : gerbe d'eau en colonne + anneau + retombée, éclats de bois et trou noirci sur coque ; boulets en sphères sombres courtes.
4. Fumée : volutes à bord doux, ombrées/éclairées, 4-6 s, dérive vent ; splash en alpha bruité (pas de disque net).
5. Feu sur coque à ≤ 40 % de dégâts, mâts brisés visibles ; HUD : fusionner bulle + fiche cible, masquer le message pendant la bordée.

## Port vu du large (`night6/after_islands_port`, `night6/after_port_harbour`, `night4/after_quay`)
Progrès : ville plus variée (blanc, rose, jaune, tuiles orange/rouge, clocher), fort, palmiers, montagne striée avec ravines et nuages accrochés, mouettes, voilier, eau turquoise vers le rivage. Menu du port : fond sombre allégé, ville lisible, panneau « Rapport du port » excellent.
Défauts : navires amarrés toujours posés sur l'eau sans ombre ni remous ; drapeaux et haubans qui se croisent et se superposent aux maisons (`islands_port` : pavillon rouge géant qui bouche la ville) ; coques du menu orange uni, très plates, avec gréement filaire uniforme ; la ville reste basse (≈ 12 % de la hauteur) et alignée le long du quai ; eau du premier plan en bandes répétitives et floue ; arrière du menu : falaise verte floue à 45 % du cadre, assombrie.
Corrections :
1. Ancrer les navires : ombre, ligne de flottaison avec écume, roulis léger, amarres ; réduire pavillons et haubans surdimensionnés.
2. Surélever la ville : terrasses, rues en pente, bâtiments 2-3 étages, étagement vers la colline ; casser l'alignement du quai.
3. Cadrage : caméra plus basse, ville à 30-40 % de la hauteur, moins d'eau vide ; décaler le navire de premier plan pour ne pas masquer le centre.
4. Eau de port : transparence sur fond sableux, vaguelettes de rive, suppression du motif répétitif.
5. Menu : replacer une vue moins zoomée sur la falaise, coques amarrées avec couleurs de factions plutôt qu'ocre uniforme, vie (barques, fumée de cheminée).

## Écrans de port (`night6/after_port_market`, `shipyard`, `tavern`, `governor`)
Progrès : le meilleur ensemble. Marché : façades, fenêtres à volets lumineuses, auvent rayé, fruits, tonneaux, liste complète et lisible (dernière ligne visible). Taverne : lanternes, poutres, tapis rouge, convives variés, ambiance. Gouverneur : lustre, bureau, tableaux peints, perruques, damier, colonne. Chantier : navire à voiles rapiécées, ponton, rendu net. UI parchemin supérieure à l'étalon, portraits ronds et bandeau de dialogue lisibles.
Défauts : personnages encore en tubes (bras/jambes cylindriques, mains absentes, bustes rigides) ; sol de pavés sombre et répétitif au marché et à la taverne ; gouverneur : damier sans joints, murs plats avec « briques » épinglées, fenêtre blanche cramée, ombres en escalier ; chantier : gros drapeau pixelisé au premier plan, panneau coupé en bas (grille Navires/stats tronquée), mur de fond/arrière-plan toujours vide (aplat de ciel/eau) ; ratio panneau ~38 %.
Corrections :
1. Modèle de personnage commun : épaules, manches, mains 3-4 segments, plis de manteau, visage modelé.
2. Pavés et sols : normal map, joints, mousse, flaques, variation de teinte ; damier avec joints et usure.
3. Chantier : supprimer/reculer le drapeau, ajouter cale sèche/hangar/grue en fond, rendre le drapeau en haute résolution, rendre la dernière ligne du panneau visible (scroll avec fondu).
4. Gouverneur : extérieur peint derrière la fenêtre, murs avec lambris/enduit, ombres PCF doux 2048+.
5. Marché : textures de murs salies, profondeur aux fenêtres (cadre en relief), passants à l'arrière-plan.

## Duel (`night5/after_duel_parry`, `after_duel_hit`, `after_duel_finish`)
Progrès : sensible. Personnages à manteaux, boucles de ceinture, bottes, barbes, tricornes, torsion et poses d'estoc/chute lisibles, foule variée (rayures, couleurs, bras levés), boiseries rouge/or avec ornements, ombres plus nettes, barre d'avantage centrale lisible, effectifs, écran « Victoire ». Sur le plan de la comparaison à l'aveugle, une personne identifierait encore la référence (modelés, reliefs dorés, plis).
Défauts : membres tubulaires, mains en pastilles, pieds en blocs, visages caricaturaux sans modelé ; épées translucides et sans garde lisible, aucun feedback de contact (pas d'étincelles) ; pont en planches orange lisses, ombres de gréement floues, flou de fond persistant ; panneaux de poupe en aplat avec volutes peintes (pas de relief) ; foule en poupées proches ; caméra trop près de la lisse et du mât, la scène ressemble à une maquette ; HUD haut sombre et bas parchemin corrects mais textes secondaires (« Le pont / Équipage ») faibles.
Corrections :
1. Corps : torse en volume, mains détaillées, pieds avec talon, plis de manteau flottant, torsion de la colonne plus marquée.
2. Épées : lame plus épaisse, reflet spéculaire, garde en coquille, traînée au coup ; étincelles + hitstop au contact et à la parade.
3. Pont : veinage, joints sombres, clous, usure, éclats de planches après impact ; ombres douces nettes sous les pieds.
4. Poupe : vrai relief doré (normal map), lanternes allumées, cordages enroulés, voile déchirée dans le cadre.
5. Cadrage : reculer et élever la caméra, supprimer les éléments de premier plan qui bouchent, réduire le flou de fond ; lignes haute/médiane/basse en surimpression au sol ; indicateur d'attaque/parade au-dessus de chaque duelliste.

## Top 8 global (par impact)
1. Duel + PNJ de port : refaire le modèle de personnage (volumes, mains, plis, visage) ; commun aux deux systèmes.
2. Combat : caméra haute `combat_ai` cramée, moirée et floue ; plafonner l'élévation, corriger exposition et moiré de l'eau.
3. Combat/FX : impacts (gerbes d'eau, éclats de bois), fumée en volutes douces, boulets courts, feu sur coque.
4. Navires (tous systèmes) : ombre portée, reflet, écume de flottaison, amarrés qui flottent, pavillons/haubans surdimensionnés.
5. Duel : lames épaisses avec étincelles et hitstop, pont veiné, relief doré réel sur la poupe, cadrage plus ouvert.
6. Eau : mousse de crête, glitter, anisotropie contre le moiré, suppression des bandes répétitives au premier plan.
7. Scènes de port : pavés et sols normal-mappés, chantier avec décor et sans drapeau parasite, ombres PCF doux, panneau sans ligne coupée.
8. Port vu du large : ville plus haute/étagée et moins alignée, eau de port transparente, vie (barques, fumées).
