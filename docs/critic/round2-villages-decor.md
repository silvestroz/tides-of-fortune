# Ronde 2 — villages de pêcheurs, décor (23/10/2026)

Captures fraîches (rendu logiciel, `?quality=high`, 1366 × 768), branche finale `ui-cta`, dossier de travail
`/home/claude/dbg/d2/` : `v_cayman_sea` (10 h), `v_cayman_close` (16 h 30), `v_redes_close` (8 h 30),
`v_andros_night` (21 h 30), `v_ponton` (feuille du village, 11 h), `v_perf`.

## Verdict : FAIL de peu (deux retouches)

| Axe | Ronde 1 | Ronde 2 | Pirates! |
|---|---|---|---|
| Silhouette et lisibilité à distance | 5 | 7 | 6 |
| Matières et détail de près | 6 | 7 | 5 |
| Composition et densité | 4 | 7 | 6 |
| Vie et animation | 6 | 7 | 5 |
| Lumière (jour, soir, nuit) | 6 | 8 | 6 |
| Cohérence avec la direction artistique | 7 | 8 | 7 |
| Artefacts techniques | 6 | 7 | 7 |

Corrections de la ronde 1 vérifiées : un hameau groupé et lisible depuis le large ; carbet au pied du ponton ;
pirogues à deux pointes et à balancier ; fumée des feux visible ; la nuit, lanternes aux portes, fenêtres allumées,
lanterne du ponton ; plus d'alerte de hauts-fonds dans la vitrine ; invite « Accoster aux Palétuviers » ; la feuille du
village montre le village sur toute la moitié droite.

Performances : 3,9 à 4,8 k triangles par village (contre 2,5–3,1 k en ronde 1), un appel de dessin proche et un
lointain par village. La mesure de la trame entière est à refaire (le compteur lisait la dernière passe de post-traitement).

## Corrections, par ordre d'impact
1. **Barque du ponton noyée** : la houle couvrait la coque, on ne voyait que le mât et une bouée (`v_redes_close`).
   Coque relevée, deux pointes, voile ferlée. *Fait.*
2. **Le troc ne se voit pas** : rien sur la grève ne dit ce que le village vend. Tas de sel sur natte, cadres à peaux,
   piles de rondins, sacs de cacao selon `v.sells`, tonneaux et caisses au pied du ponton. *Fait.*
3. Braises des feux de boucanage peu visibles la nuit (la fumée, elle, se voit) : on laisse, la lanterne et les
   fenêtres suffisent à la lecture nocturne.
4. Mesure de trame : `v_perf` de la ronde 3 compte toutes les passes (`info.autoReset = false`).
