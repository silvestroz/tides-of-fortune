# Ronde 3 — villages de pêcheurs, décor (23/10/2026)

Captures fraîches (rendu logiciel, 1366 × 768), branche finale `ui-cta`, dossier de travail `/home/claude/dbg/d3/` :
`v_cayman_close` (Élevé, 16 h 30), `v_pargo_close` (Élevé, 9 h 30), `v_swan_close` (Moyen, 18 h 48, soleil couchant),
`v_perf` (Élevé, Les Palétuviers, midi).

## Verdict : WIN

| Axe | Ronde 1 | Ronde 2 | Ronde 3 | Pirates! |
|---|---|---|---|---|
| Silhouette et lisibilité à distance | 5 | 7 | 8 | 6 |
| Matières et détail de près | 6 | 7 | 8 | 5 |
| Composition et densité | 4 | 7 | 8 | 6 |
| Vie et animation | 6 | 7 | 7 | 5 |
| Lumière (jour, soir, nuit) | 6 | 8 | 9 | 6 |
| Cohérence avec la direction artistique | 7 | 8 | 8 | 7 |
| Artefacts techniques | 6 | 7 | 8 | 7 |

Pirates! n'a pas d'escale de ce genre : la comparaison porte sur ses petites colonies vues de la mer. Le village se lit
comme un hameau de pêcheurs à 150 m (cases groupées, carbet, ponton et lanterne, pirogues, fumées) ; au soleil couchant
(`v_swan_close`) les lanternes, la barque amarrée et les rondins de Bois-Flotté composent un vrai tableau.

Performances (Élevé, trame entière, ombres comprises, Les Palétuviers en gros plan) : 102 appels de dessin,
0,60 M triangles, dans le budget en mer (100–170 appels, 0,5–0,8 M triangles). Villages : 4,1 à 5,0 k triangles
chacun, deux maillages (proche, lointain au-delà de 1 100 m).

## Dernières corrections
1. **Barque amarrée sur le sable** devant un ponton court (Caleta Pargo : sa voile ferlée dressée comme un poteau) :
   placée à au moins 1,2 m de fond le long du ponton. *Fait.*
2. Tas de sel peu lisibles au-delà de 80 m (blanc sur sable clair) : on laisse, les cadres à peaux et les rondins portent
   l'idée.
3. À vérifier sur le PC (vrai GPU) : la fumée des feux, les lanternes en Élevé et en Bas, le changement de maillage à
   1 100 m.
