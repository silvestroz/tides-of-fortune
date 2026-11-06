# Ronde 3 — zones de niveau, lisibilité (23/10/2026)

Captures fraîches (rendu logiciel, `?quality=low`, 1366 × 768), branche finale `ui-cta`, dossier de travail
`/home/claude/dbg/b3/` : `map_fr` (carte agrandie devant Fort Royal), `map_west` (Cuba, Jamaïque, Hispaniola),
`hud_toast` (message d'entrée en mers périlleuses, vérifié dans le DOM).

## Verdict : WIN

| Axe | Ronde 1 | Ronde 2 | Ronde 3 | Pirates! |
|---|---|---|---|---|
| Lisibilité de la menace (fiche cible, étiquettes) | 7 | 8 | 8 | 6 |
| Carte : zones et dangers | 6 | 7 | 9 | 3 |
| Cohérence de la direction artistique | 7 | 7 | 8 | 8 |
| Typographie et finitions | 5 | 8 | 8 | 7 |
| Artefacts techniques | 6 | 8 | 8 | 8 |

- Eaux gardées en liseré lavé : on les lit comme les eaux territoriales d'une carte ancienne, à toutes les échelles,
  sans masquer le relief ni les villes.
- Repaires nommés avec l'article (« repaire de la Veuve rouge », « repaire de l’Eau-Froide, de la Lanterne et du Muet ») ;
  villages de pêcheurs sur la carte.
- Message d'entrée de zone présent dans le DOM : « Bancs des Lucayes, mers périlleuses : vaisseaux de ligne et
  capitaines du Top 10. Navire conseillé : frégate. » (sur la capture, les messages de la colonne de gauche n'apparaissent
  pas, ceux d'avant non plus : sonde de visibilité dans le rapport de la nuit).
- Le conseil `zone3` attend derrière le conseil « Avaries » (même priorité) : file normale des conseils.

Reste pour le PC : sensation de la frontière en jeu (un poursuivant qui renonce), densité des rencontres en eaux gardées.
