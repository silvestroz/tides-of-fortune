# Ronde 10 — personnages (critique indépendante)

Système jugé : tous les personnages (modèle commun `CaptainFigure` : duellistes, foule du pont et des décors, figurants
des ports, bal ; médaillons 3D ; tableaux de la salle du gouverneur et du bal ; soldats de l'attaque de ville et de
l'infiltration ; équipage des navires). Rendu logiciel 1600×900 = vérité terrain.

## Images jugées
- Avant : `shots/round8/before/` (duel_action, duel_finish, duel_garden, duel_tavern, dance, port_tavern, port_governor,
  landbattle, sneak, ships_close, z_dance_face, z_land, z_sneak, z_duel_action_*), `shots/round8/lab-before/` (line, duel,
  faces, profile, crowd).
- Après : `shots/round8/final/` (duel_action, duel_finish, duel_garden, duel_tavern, dance, port_tavern, port_governor),
  `shots/round8/after3/` (landbattle, sneak, ships_close), `shots/round8/after1/` (z_land, z_sneak, z_dance_face — ce
  dernier montre l'état intermédiaire d'avant la ronde 9, jugé sur `final/dance.png`), `shots/round8/lab-final/` (line,
  line-night, duel, faces, profile, crowd, hands, expr, portraits).
- Comparaison à l'aveugle : 18 paires avant/après copiées en A/B tirés au sort, clé lue après le jugement.

## Étalon (écrit de mémoire, avant de regarder nos images)
Pirates! (2004) : caricature assumée (têtes ~1/5,5 du corps, mentons, nez et sourcils exagérés, grosses mains), lisible
à 20 m. Modèles bas poly (~2–4 k triangles pour un duelliste, < 1 k pour la foule) ; tout le détail est peint dans la
texture (rides, barbe, ombre sous le chapeau, plis, broderies), éclairage simple, pas de contour. Duel sur le pont : caméra
de profil, deux capitaines au centre, équipage qui lève le poing ou brandit des armes en arrière-plan ; animations amples
et lisibles (fentes, tailles, provocations) : c'est le point fort. Défauts : mains en moufles, coudes et genoux à facettes
en gros plan, bords de chapeau en aplat, sabres et pans de manteau qui traversent. Ports : pièces 3D avec personnages en
pied animés (barman, serveuse, gouverneur, fille du gouverneur) ; quelques portraits peints aux murs. Bal : couple au
centre, robe à panier. Attaque de ville : figurines simplifiées aux couleurs franches ; infiltration en vue plongeante,
personnages lisibles par la couleur ; équipage quasi invisible en mer.

## Verdict : FAIL

L'après gagne toutes les paires à l'aveugle : nettement au port (taverne 85/15, gouverneur 80/20), au bal (85/15), au
duel de taverne (75/25), au jardin (70/30) et à l'atelier ; **de justesse seulement sur le pont** (duel 55/45, coup final
55/45) et pour l'équipage des navires (55/45). Le travail se voit de près et au port ; à la caméra du duel sur le pont,
écran-roi des personnages, il ne se voit presque pas. Face à Pirates!, un joueur moyen choisirait encore l'étalon
(caricature, poses, lisibilité).

| Axe | Avant | Après | Étalon |
|---|---|---|---|
| Matières et textures | 6 | 6,5 | 7 |
| Lumière et modelé | 5 | 6 | 6,5 |
| Silhouettes et formes | 4,5 | 6 | 8 |
| Articulations et poses | 5 | 6 | 8 |
| Lisibilité à la caméra du jeu | 5,5 | 6 | 8 |
| Cohérence de la direction artistique | 5,5 | 6,5 | 8 |
| Défauts techniques | 5 | 6 | 6,5 |
| **Moyenne** | **5,2** | **6,1** | **7,4** |

Acquis réels : genoux et coudes continus (plus de tube ouvert ni de triangle à la cuisse, `lab duel`), poches posées sur
les basques, poing autour de la poignée, dames enfin reconnaissables (corsage, manches au coude, anglaises), figurants de
taverne variés (tricornes, jabots, rayures), médaillons et tableaux cohérents avec les figures 3D, soldats avec tricorne
et arme (`z_sneak`, `z_land`).

## Régressions (pire qu'avant ou apparu avec la refonte)
1. **Contour d'encre partiel** : cernés épais sur certaines figures, rien sur leurs voisines dans le même cadre
   (`lab faces`, `hands` : capitaine cerné, gouverneur et dames non ; pont : duellistes cernés, foule non ; bal : couple
   cerné sur un décor sans trait) → effet « autocollant », incohérence de style.
2. **Vignettes des recrues (taverne)** : bustes 3D sombres et gris à ~40 px, moins lisibles que les anciens pictos (plus
   variés, mais on ne lit plus un visage).
3. **Reflet blanc au sommet des chevelures** des dames (`expr`, `faces`, cavalière du bal, tableau du gouverneur) : point
   spéculaire qui fait un crâne chauve.
4. **Métal en surchauffe** : plastron et épaulières du garde blancs purs même de nuit (`line-night`), morion du médaillon
   du garde brûlé en tache blanche (`portraits`).
5. **Matelot du pont dans le mât** (`final/duel_action`, à droite) : genoux pliés dans le vide, jambes qui traversent.
6. **Coût** : atelier +70 à +87 % de triangles (rang 74 → 127 k, visages 80 → 139 k, foule 63 → 118 k).

Toujours là (non corrigé) : ombre de barbe au menton de la cavalière du bal (`final/dance`), mâchoire carrée des dames,
robes en cônes lisses, galet noir du pied sous l'ourlet, lame en règle blanche crénelée.

## Corrections classées (12 au plus)
1. **Duel sur le pont : on ne voit pas les visages.** Le capitaine du joueur est vu de 3/4 dos (seule une joue et la
   « capsule » noire de l'oreille), le visage ennemi fait ~25 px à l'ombre du tricorne, la foule est en contre-jour :
   ovales bruns. Attendu : les deux visages de 3/4, lisibles, la foule détachée du ciel. Technique : éclairage propre aux
   personnages (lumière de face chaude côté caméra, ~0,6, et liseré froid de contre-jour sur un calque `figures`), tête de
   la foule ×1,15, azimut de caméra plus de profil (Pirates! filme les deux bretteurs de côté). Même liseré de nuit
   (`line-night` = jour assombri, sans lune). Déplacer l'étiquette « Garde médiane » hors du chapeau.
2. **Pas de caricature : des mannequins à 7 têtes.** Corps réalistes et identiques, petites mains, jambes en échasses
   blanches, torse court (`line`, `crowd`). Attendu : stylisation « livre d'aventure » cohérente. Technique : échelles
   d'os par graine — tête 1,15–1,25 pour tous, mains ×1,2, tibias −8 %, 3 gabarits (trapu, ventru, sec : largeur du bassin,
   ventre, épaules), taille ±8 %.
3. **Dames encore viriles.** Visage long, mâchoire carrée, barbe naissante au menton, cou épais et long, poitrail plat
   et ombré comme un torse d'homme, sourcils froncés chez la blonde (`faces`, `expr`, `final/dance`). Attendu : visage
   plus court (−10 %), menton pointu, joues pleines, cou −20 %, lèvres colorées, trait de cils épais, sourcils fins et
   arqués jamais froncés, poitrine sous le corsage. Technique : préréglage de tête féminin dans la sculpture ; `stubble` et
   AO du menton à zéro pour `o.dress` ; deux lobes doux poussés dans le corsage.
4. **Robes en cônes lisses** à facettes, sans panier ni plis, galet noir à l'ourlet (`line`, jardin, bal). Attendu :
   hanches élargies par le panier, 12–16 plis verticaux, robe ouverte sur un jupon de couleur, galon d'ourlet, tablier pour
   la tavernière, pied caché. Technique : déplacement radial sinusoïdal des sommets de la jupe, anneau de panier, jupon en
   second cône, balancement de l'ourlet au shader selon la rotation du bassin.
5. **Foule clonée.** Huit matelots, même pose (poing droit levé), même taille, alignés au bastingage (`crowd`, pont).
   Attendu : une foule qui vit. Technique : 6–8 poses (deux poings, sabre brandi, bras croisés, chope levée, mains en
   porte-voix, assis sur un canon, accroché aux haubans), décalage de phase, 2–3 rangs à hauteurs différentes (cabestan,
   lisse, haubans), test de collision avec mâts et bastingage (cf. régression 5).
6. **Visages tous pareils, profils plats.** Nez en bouton de profil, pas d'arcade, menton rond ; les 9 médaillons ont le
   même ovale, les mêmes yeux ronds au regard fixe, seul l'accessoire change (`profile`, `portraits`). Attendu : des
   « gueules ». Technique : paramètres de sculpture par graine (nez aquilin / bourbon / retroussé, arcade, avancée du
   menton, pommettes, bajoues des vieux, oreilles visibles), rides peintes par sommet (front, sillons nasogéniens),
   expression par rôle (tavernier rieur, gouverneur hautain, garde sévère).
7. **Médaillons et tableaux éclairés à plat.** Lumière frontale de figurine en plastique, tricorne coupé par le cadre,
   même halo partout ; tableaux = rendu 3D flouté, ni touche ni vernis, cou en tube, regard vide (`portraits`,
   `final/port_governor`, `final/dance`). Attendu : clair-obscur de portrait d'apparat. Technique : éclairage trois points
   (clé chaude à 45°, liseré froid, débouchage faible : triangle de Rembrandt), cadrage à ~1,3 hauteur de tête avec le
   chapeau entier ; vignettes < 64 px : exposition +0,5, tête ×1,3, fond plus clair ; tableaux : filtre de Kuwahara + touches
   orientées + toile + vernis jauni + craquelures, fond sombre, poses variées (3/4, main sur l'épée, éventail).
8. **Contour d'encre : une seule règle** (régression 1). Soit tous les personnages (foule comprise), soit aucun ; largeur
   constante à l'écran (~1,2 px) qui s'efface au-delà de 25 m, trait brun chaud (#2a1a10) plutôt que noir, plus fin côté
   lumière. Mieux : passe d'arêtes à l'écran (profondeur + normales) sur toute la scène pour unir personnages et décor.
9. **Mains ouvertes en saucisses** : doigts pâles sans phalanges ni ongles, paume plate, pouce collé ; poing levé qui
   se lit comme un pouce levé (`hands`, `crowd`). Attendu : 3 phalanges effilées, jointures, pouce opposé à 30–45°,
   courbure croissante de l'index à l'auriculaire, ongles teintés par sommet ; poing levé : doigts refermés, pouce
   par-dessus l'index ; mains ×1,15.
10. **Matières : métal, cheveux, lames** (régressions 3 et 4). Plastron, morion et lames blancs brûlés et crénelés ;
    calottes de cheveux en plastique luisant. Technique : métal rugosité ≥ 0,35, environnement ×0,6, spéculaire borné
    sous le seuil du bloom ; cheveux : bande anisotrope peinte ou spéculaire très faible + mèches en sillons dans la
    calotte ; lame gris-bleu rugosité 0,3, fil sombre, biseau en normales pour casser le crénelage. Perruques : boucles
    en rouleaux allongés et frisés, pas des boules empilées.
11. **Détails de costume.** Entrejambe en triangle plat (« couche ») des culottes, bas blancs en tubes, souliers en
    semelles plates noires « palmes », parements dorés à 8 pans visibles, galons en planches rayées (`hands`, `crowd`,
    `line`). Attendu : culotte froncée au siège avec jarretière au genou, mollet galbé, soulier avec talon, empeigne et
    boucle, parements à 16 segments (LOD), galons biseautés.
12. **Petits personnages (attaque de ville, infiltration, équipage).** À 15–20 px seule la couleur se lit : capitaine
    = tache rouge dans un anneau, garde = sac jaune, équipage = 3 points (`after3/sneak`, `z_land`, `ships_close`).
    Attendu : silhouettes-signes. Technique : échelle ×1,3 (Pirates! grossit ses figurines), tricorne large, mousquet en
    diagonale qui casse la colonne, baudriers blancs en X ; capitaine de l'infiltration avec cape et chapeau clairs et un
    rebond de marche ; équipage un peu plus gros, chemises blanches et bonnets rouges, poses de travail (haler).

## Suites données (même soirée)
- Fait : « barbe » d'ombre au menton de la cavalière (normales du bas du visage tirées vers un masque arrondi, rampe
  d'occlusion de la tête 0,94, terminateur de peau plus léger) ; tache de peau au sommet des chevelures de dames (raie
  enfoncée dans le crâne) ; plastrons et morions brûlés en blanc (armures avec le laiton, plus avec la lame qui luit la
  nuit ; acier un peu plus gris) ; vignettes des recrues plus grandes et plus exposées. Captures : `shots/round8/final2/`.
- Reporté à plus tard : corrections 1 à 6, 7 (tableaux, clair-obscur), 8 (contour
  à une seule règle), 9 à 12.
