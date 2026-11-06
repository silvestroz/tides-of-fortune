# Ronde 1 — zones de niveau, lisibilité (lot B, 23/10/2026)

Captures fraîches (rendu logiciel, `?quality=low`, 1366 × 768), dossier de travail `/home/claude/dbg/b1/` (hors dépôt) :
`map_wide`, `map_fr` (carte M, calque « Eaux et dangers »), `hud` (devant La Havane, frégate espagnole en cible),
`hud_edge` (bord des eaux gardées), `governor`, `shipyard` (ligne « Classe »), `combat` (étiquettes des navires).

Repère Pirates! (2004), de mémoire : la carte du monde ne montre ni niveau de mer ni danger ; on lit la menace au type
de navire (silhouette, nom du type au-dessus du navire, nombre de canons dans la fiche de la longue-vue). Rien
n'indique au joueur débutant qu'une zone est trop dure pour lui : il l'apprend en coulant.

## Verdict : FAIL

| Axe | Nous | Pirates! |
|---|---|---|
| Lisibilité de la menace (fiche cible, étiquettes) | 7 | 6 |
| Carte : zones et dangers | 6 | 3 |
| Cohérence de la direction artistique | 7 | 8 |
| Typographie et finitions | 5 | 7 |
| Artefacts techniques | 6 | 8 |

Ce qui marche : la pastille « IV Coriace » dans la fiche cible se lit d'un coup d'œil, le niveau de mer sous la carte de
bord dit où l'on est, les cercles verts des eaux gardées sont clairs sur la carte M.

## Corrections, par ordre d'impact
1. **Hachures des mers périlleuses trop pâles** sur la carte M (on les confond avec la texture du papier) : lavis 0,13,
   traits rgba(150, 48, 26, 0,55), épaisseur 1,8, pas de 8. *Fait.*
2. **Légende de la carte de bord coupée** au bord droit de l'écran (« Eaux gardées · 1,3 milles de large ») : légende
   courte « Eaux gardées · 1,3 mille », singulier sous 2 milles. *Fait.*
3. **Étiquettes des navires par-dessus la carte de bord et la fiche cible** (capture `combat` : l'étiquette du
   San Telmo masque « Routes marchandes ») : la couche des étiquettes passe sous le HUD. *Fait.*
4. **« Côte de Terre Ferme » posée sur Carthagène** : étiquette déplacée au large de Willemstad (1 900, 6 600). *Fait.*
5. **« repaire de Eau-Froide »** : élision « repaire d’Eau-Froide » ; plusieurs capitaines dans un même repaire écrits
   « A, B et C ». *Fait.*
6. **Pastille de menace trop petite** à 1366 × 768 : `max(1em, 13px)` ; puce de classe des étiquettes `max(.82em, 11px)`. *Fait.*
7. **Registre** : « Sloop · II » pour l'escadre mais « classe IV » pour le navire amiral : « classe » partout. *Fait.*
8. **Chantier** : « Classe IV » sans explication ; info-bulle sur la valeur (canons et coque, ce que la classe change en
   mer). *Fait.*
9. **Gouverneur** : l'étiquette de niveau des offres de mission n'est pas dans le champ de la capture (sous le bal) : à
   capturer en ronde 2, faire défiler jusqu'aux missions.
10. **Capture `hud_edge`** : mer blanche et arbres en l'air après un téléport de toute la scène suivi de 4 images ;
    artefact de l'outil (le monde n'a pas eu le temps de suivre), pas du jeu. Ronde 2 : message d'entrée de zone et
    conseil `zone3` montrés sans téléport.
