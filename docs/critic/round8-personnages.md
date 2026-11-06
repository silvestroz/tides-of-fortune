# Ronde 8 — personnages (avant correction)

Captures : `shots/round8/before/` (scènes du jeu, 1600×900, rendu logiciel) et `shots/round8/lab-before/` (atelier
`tools/figlab.html` : rang, duel, visages, profil, foule). Système jugé : tous les personnages — le modèle commun
`CaptainFigure` (duellistes, foule du pont, figurants des ports, bal), l'équipage des navires, les soldats de l'attaque
de ville et de l'infiltration, les médaillons des interlocuteurs du port.

## Étalon (de mémoire, avant de regarder nos images)
Pirates! (2004) : personnages trapus et caricaturés, grosses têtes et grosses mains, visages expressifs d'un seul tenant
(nez, pommettes et menton modelés, bouche animée), vêtements texturés avec plis et relief, femmes du bal reconnaissables
au premier coup d'œil (corsage, décolleté, coiffure), animations souples sans cassure aux coudes et aux genoux ; portraits
d'interlocuteurs peints, cohérents avec les modèles.

## Verdict : FAIL

| Axe | Nous | Étalon |
|---|---|---|
| Matières et textures | 6 | 7 |
| Lumière et modelé | 5 | 7 |
| Silhouettes et formes | 4 | 8 |
| Animation, articulations | 5 | 8 |
| Lisibilité à la caméra du jeu | 6 | 7 |
| Cohérence de la direction artistique | 6 | 8 |
| Défauts techniques | 5 | 7 |
| **Moyenne** | **5,3** | **7,4** |

## Défauts relevés
- Visages en « tête de pomme de terre » : pommettes, menton, nez, narines et arcade sont des boules et un cône posés
  sur une sphère ; joues roses en deux disques ; aucun modelé continu.
- Sourcils inversés : l'angle « féroce » relève l'intérieur des sourcils (air inquiet), « sourire » le fronce.
- Femmes : même buste en V que les hommes, peint à la couleur du corsage, manches longues en tube, cheveux cachés
  sous une coiffe ou réduits à une queue ; au bal, la cavalière a un visage d'homme grimaçant.
- Membres en tubes : profils de 4 ou 5 anneaux, chaque segment lié à un seul os ; aux coudes et aux genoux deux tubes
  se rejoignent en angle (fente, boule).
- Mains en palettes : paume et doigts parallèles à la lame, la poignée n'est pas tenue ; gantelets de cuir évasés même
  sur le gouverneur et le commis.
- Épaules en boules (« manches bouffantes ») chez tous les hommes ; buste à facettes visibles (18 segments).
- Poches du manteau flottant devant la culotte (manteau ouvert).
- Foule du pont : chemises et culottes claires, une rangée de silhouettes blanches ; poings levés lisibles par hasard.
- Médaillons du port : visages vectoriels plats (ovale, deux points, un trait), sans rapport avec les figures 3D.
- Soldats (attaque de ville, infiltration) : cylindres et cônes, aucune arme tenue, chapeau plat ; cavaliers en boîtes.
- Équipage des navires : cylindres à 5–6 faces, bras raides.

## Corrections classées
1. Tête sculptée d'un seul tenant (pommettes, menton, tempes poussés depuis une sphère dense), nez sculpté d'une pièce,
   couleurs peintes par sommet (joues, lèvres, bout du nez, cernes, barbe naissante, paupières des femmes).
2. Sourcils : corriger le sens de l'angle ; sourcils effilés et arqués.
3. Femmes : corsage lacé (taille, poitrine, décolleté sur épaules nues), dentelle d'encolure, manches au coude avec
   engageantes, cheveux à raie avec chignon et anglaises, coiffe posée en arrière ; sourire à bouche presque fermée.
4. Articulations : profils rééchantillonnés (14 anneaux, bouts arrondis) et peau répartie sur deux os aux épaules, coudes,
   hanches et genoux ; manches et cuisses avec du volume (biceps, quadriceps, mollets, plis au coude, culotte froncée).
5. Mains : poing fermé autour de la poignée pour la main armée et la foule qui acclame ; mains ouvertes au repos, doigts
   en deux phalanges ; gantelets réservés aux bretteurs ; dents cachées tant que la bouche est fermée.
6. Matières : peau à éclairage enveloppant (terminateur chaud) et cavités chaudes, drap et laine avec un lustre (sheen).
7. Épaules en pente dans le buste, bustes à 30 segments, poches cousues sur les basques.
8. Foule : culottes foncées, gilets sans manches, poings.
9. Médaillons : bustes rendus d'après les figures 3D du rôle (gouverneur, tavernier, tavernière, armateur, banquier,
   garde, conseil des frères de la côte, négociant).
10. Soldats : habits à basques teints aux couleurs de la troupe, buffleteries et baudriers non teints, armes tenues,
    tricorne ; chevaux en volumes. Équipage : silhouette plus solide, bras pliés, bord de chapeau sur une partie.

# Ronde 9 — personnages (après la première passe de corrections)

Captures : `shots/round8/after3/` (scènes, même cadrage que `before/`) et `shots/round8/lab-a7/` (atelier).

## Verdict : FAIL (progrès net de près, faible à la distance du duel)

| Axe | Ronde 8 | Ronde 9 | Étalon |
|---|---|---|---|
| Matières et textures | 6 | 7 | 7 |
| Lumière et modelé | 5 | 6 | 7 |
| Silhouettes et formes | 4 | 6,5 | 8 |
| Animation, articulations | 5 | 6 | 8 |
| Lisibilité à la caméra du jeu | 6 | 5,5 | 7 |
| Cohérence de la direction artistique | 6 | 7 | 8 |
| Défauts techniques | 5 | 5 | 7 |
| **Moyenne** | **5,3** | **6,1** | **7,4** |

## Défauts relevés
- **Éclats blancs** sur les visages et les poings de la foule du pont à contre-jour (`after1`, `after2`) : la peau
  enveloppante passait aussi dans le lobe spéculaire (N·L enveloppé ≈ 0,3 au terminateur, vue rasante → GGX énorme,
  bloom). Régression introduite par la ronde 9 elle-même.
- Foule du pont moins lisible qu'avant à 15 px de visage : sourcils effilés trop fins, chapeaux presque tous des
  foulards, laine claire « lavée » par le lustre à contre-jour.
- Cavalière du bal : le visage agrandi (`headScale`) recevait la grimace des duellistes (« joie » = bouche large et
  haute, mâchoire ouverte) : rictus et menton assombri.
- Coût : figurants des ports et du bal avec contour d'encre = 4 appels de plus chacun, et autant dans la carte
  d'ombre (le contour projetait une ombre) ; bal 224 → 302 appels, 187 k → 644 k triangles.
- À la distance du duel sur le pont, les gains du visage et des mains se voient peu ; ils se voient au bal, dans les
  médaillons, à l'atelier.

## Corrections faites
1. Peau : lobe spéculaire avec le vrai N·L (`SKIN_LIGHT`, clé `figure-painterly-3`).
2. Détail par figure (`o.detail`) : figurants des ports 0,65, foule `DETAIL_EXTRA` 0,55 ; drap, laine, peau et cuir
   dans une seule géométrie à groupes : contour en un appel, sans ombre (`userData.noCast`).
3. Foule : sourcils plus épais et plus sombres et trait de paupière plus marqué quand `detail` < 0,8 ; chapeaux variés
   (tricorne, bonnet, foulard, tête nue) ; lustre adouci (0,19).
4. Dames : pas d'exagération de duelliste ; « joie » = lèvres entrouvertes.
Mesures après : duel 330 / 842 k, taverne du port 596 / 313 k, bal 234 / 297 k (trame entière, logiciel).
