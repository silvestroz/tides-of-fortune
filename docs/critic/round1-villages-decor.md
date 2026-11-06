# Ronde 1 — villages de pêcheurs, décor (lot D, 23/10/2026)

Captures fraîches (rendu logiciel, `?quality=high`, 1366 × 768), dossier de travail `/home/claude/dbg/d1/` (hors dépôt) :
`v_cayman_sea` (10 h), `v_cayman_close` (16 h 30), `v_redes_sea` (8 h 30), `v_andros_close` (19 h 12), `v_ponton`
(feuille du village ouverte, 11 h).

Repère Pirates! (2004), de mémoire : pas de village de pêcheurs ; les petites colonies sont quelques maisons basses
autour d'un fort, vues de la mer comme des taches claires au pied des collines. À battre : silhouette lisible à 200 m,
vie (fumée, barques), lumière du soir.

## Verdict : FAIL

| Axe | Nous | Pirates! |
|---|---|---|
| Silhouette et lisibilité à distance | 5 | 6 |
| Matières et détail de près | 6 | 5 |
| Composition et densité | 4 | 6 |
| Vie et animation | 6 | 5 |
| Lumière (jour, soir) | 6 | 6 |
| Cohérence avec la direction artistique | 7 | 7 |
| Artefacts techniques | 6 | 7 |

Ce qui marche : grève aplanie, ponton sur pieux avec sa lanterne qui s'allume au soir, barques de `HarbourLife` qui
tirent des bords devant le village, toits de chaume dans la palette.

## Corrections, par ordre d'impact
1. **Village clairsemé, cases minuscules** (8 à 11 cases de 4–6 m éparpillées sur 120 m) : on lit un campement, pas un
   village. Cases ×1,35, 11 à 14, posées d'abord en arc près de la grève. *Fait.*
2. **Forêt de palmiers entre les cases** (jusqu'à ~60 palmiers plantés par le village lui-même) : 14 au plus, écartés des
   cases. *Fait.*
3. **Rien au pied du ponton** : carbet (grand toit de palmes sur poteaux), table de tri, paniers, poissons pendus. *Fait.*
4. **Pirogues = pavés rouges et bleus** : coque à deux pointes, plat-bord clair, balancier sur 40 %, pagaies, plus
   grandes (5,4–6,8 m). *Fait.*
5. **Village éteint la nuit** (seule la lanterne du ponton) : fenêtres qui s'allument (matière WINDOW des villes),
   lanternes à quelques portes, braises des feux de boucanage. *Fait.*
6. **Filets et claies illisibles** au-delà de 60 m : plus grands, filets plus sombres, flotteurs de liège. *Fait.*
7. **Feuille du village : décor trop loin** (caméra à 150 m, 15–19 m de haut) : 105 m, 11–14 m. *Fait.*
8. **Vitrine : alerte « Hauts-fonds »** et gréement du brick dans le champ : brick placé dans l'axe de la passe draguée.
   *Fait.* À vérifier en jeu : arriver sur un village hors de la passe touche-t-il le fond ? (mouillage à −8,5 m, passe
   de 64 m de large).
9. **Fumée des feux invisible** sur ces captures (prises quelques secondes après le chargement) : à revoir en ronde 2 avec
   une attente plus longue.
10. **Performances** (ancienne version, `v_perf`, Élevé, logiciel) : 70 appels et 189 k triangles avec un village proche ; 2,5 à 3,1 k triangles par village : marge large pour plus de détail.
