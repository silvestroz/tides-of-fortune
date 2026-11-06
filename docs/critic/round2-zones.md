# Ronde 2 — zones de niveau, lisibilité (23/10/2026)

Captures fraîches (rendu logiciel, `?quality=low`, 1366 × 768), branche finale (`ui-cta` : zones + villages + boutons),
dossier de travail `/home/claude/dbg/b2/` : `map_wide`, `map_fr` (carte M), `hud_zone` (devant La Havane, frégate
hostile en cible, message et conseil d'entrée en mers périlleuses émis), `plates` (combat, étiquettes), `governor_missions`
(offres de mission défilées), `registry` (escadre de deux navires).

## Verdict : FAIL (une correction visuelle, une vérification)

| Axe | Ronde 1 | Ronde 2 | Pirates! |
|---|---|---|---|
| Lisibilité de la menace (fiche cible, étiquettes) | 7 | 8 | 6 |
| Carte : zones et dangers | 6 | 7 | 3 |
| Cohérence de la direction artistique | 7 | 7 | 8 |
| Typographie et finitions | 5 | 8 | 7 |
| Artefacts techniques | 6 | 8 | 8 |

Corrections de la ronde 1 vérifiées : hachures des mers périlleuses lisibles à toutes les échelles ; « Côte de Terre
Ferme » au large ; légende de la carte de bord entière (« Eaux gardées · 1,3 mille ») ; la carte de bord passe désormais
au-dessus des étiquettes des navires (recadrage de `plates`) ; pastille de menace en 13 px ; « classe II » partout au
Registre ; étiquettes de niveau des offres de mission (« mers périlleuses » rouge, « eaux gardées » vert, rien pour les
routes marchandes, le cas courant).

## Corrections, par ordre d'impact
1. **Eaux gardées en « voie ferrée »** sur la carte agrandie (`map_fr` : double trait et pieux de la palissade) : liseré
   lavé à la manière des eaux territoriales des cartes anciennes, bande verte dégradée vers l'intérieur, trait plein et
   pointillé. *Fait.*
2. **Repaires sans article** sur la carte (« repaire de Veuve rouge ») : « repaire de la Veuve rouge », « repaire de
   l’Eau-Froide, de la Lanterne et du Muet ». *Fait.*
3. **Message d'entrée de zone absent de `hud_zone`** : la carte de conseil « Avaries » (même priorité) occupe la place et
   le message a sans doute expiré pendant l'attente (rendu logiciel lent). Ronde 3 : vérifier dans le DOM (`.toast`) au
   lieu de l'œil.
4. Étiquette passée sous la légende de la carte de bord : les deux premières lettres claires de la légende tombent sur
   le parchemin de l'étiquette. Rare (bord d'écran) ; on laisse.
