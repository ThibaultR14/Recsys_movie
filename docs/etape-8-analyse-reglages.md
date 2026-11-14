# Étape 8 — Analyse des réglages (arrêt visuel)

> **14 novembre 2026.** Document demandé par Thibault à l'arrêt visuel de l'étape 8 (« pas encore OK »). **Analyse seulement : aucun réglage du site n'est changé**, l'étape 8 n'est pas close. Seuls changements du site : le texte du bas de page des résultats, et des interrupteurs **en mode dev uniquement** pour juger à l'œil (§ 8). Validation seulement, le test n'est pas touché. Exports réels nommés **A** (Letterboxd, 217 films reconnus, dont 29 estimés) et **B** (Letterboxd, 491 films, dont 112 estimés) ; aucun de leurs titres ici, seulement des comptes. Les titres cités (*12 Angry Men*, *The Godfather Part II*, *Spirited Away*) sont des films de référence du catalogue.

## 0. Synthèse

**Ce qui a dégradé le milieu du curseur** : d'abord la **calibration forte** (λ = 0,9 dès 5 000). Elle va chercher loin dans le vivier des films qui corrigent le mélange de genres, et le score de la première rangée chute (A, 5 000 : 0,41 → 0,24). Ensuite les **films estimés** : 9 à 14 sur 48 aux crans du milieu de A. Le terme de qualité n'y est presque pour rien. **Le curseur lui-même n'est pas en cause**, et les crans de gauche ne bougent pas.

| réglage | valeur actuelle | valeur recommandée | gain | coût | confiance |
|---|---|---|---|---|---|
| λ de la calibration à 5 000 (§ 2) | 0,9 | **0,7** | NDCG@20 bien notés +11,7 % (validation) ; score de la 1ʳᵉ rangée 0,24 → 0,29 (A), 0,37 → 0,52 (B) | animation des 16 premières 25 → 31 % sur A (profil 14 %) | moyenne |
| λ de 2 000 à 200 (§ 2) | 0,9 | 0,9 (inchangé) | l'animation reste contenue | renonce à ~+11 % de NDCG par cran | moyenne, à l'œil |
| λ de ∞ à 10 000 | 0,1 | 0,1 (inchangé) | — | — | bonne |
| films estimés par rangée de 8 (§ 5d) | pas de plafond | **1 au plus** | milieu de A : 9-14 → 6 au plus sur 48 ; watchlist +1 | quelqu'un qui voit surtout du récent en verra moins | moyenne |
| q des films estimés (§ 5a) | droite du catalogue (`0,526 t − 3,637`) | **droite des films 2019-2023** (`0,295 t − 2,163`) | résidu des films récents très votés −0,28 → −0,14 ; estimés au-dessus du centile 98 : 48 → 0 | un très bon film récent est un peu moins relevé | moyenne |
| « ✱ pépite » sur un film estimé (§ 5b) | permis | **interdit** | A : 5 tampons sur 14 ne tombent plus sur un film « peu connu parce que nouveau » | aucun mesurable | bonne |
| « parce que t'as aimé » sur un film estimé (§ 5c) | affiché | **masqué** | plus de citations passe-partout (cosinus 0,51-0,60) | 12-17 % des cartes sans explication | bonne |
| cosinus des explications (§ 5c) | brut | brut (inchangé) | — | le centrage ne rend pas les citations moins génériques | bonne |
| bonus des classiques (§ 4) | aucun | **centile 99, γc = 0,5, films entraînés seulement** | *12 Angry Men* 42ᵉ → 1ᵉʳ (A), absent → 2ᵉ (B) | NDCG@20 bien notés à ∞ −1,0 % ; 4-5 films changent à ∞ ; watchlist neutre | moyenne |
| terme de qualité γ (§ 2, § 4) | 0,1 | 0,1 (inchangé) | aide à droite (sans lui : −3,8 % à 500) | — | bonne |
| curseur à plafond cumulatif (§ 6) | 8 crans | inchangé | — | — | bonne |

**Ordre d'application proposé** (chacun mesuré puis regardé avant le suivant ; aucune nouvelle évaluation du test) :
1. **Règles d'affichage des films estimés** : pas de tampon, pas d'explication, 1 au plus par rangée de 8. Règles pures, sans effet sur le reste, et elles traitent la deuxième cause du milieu.
2. **Droite récente du q des films estimés** : paramètre du pipeline (`model-meta.json` `quality.tmdb`). Elle passe avant le bonus des classiques pour qu'aucune note gonflée ne s'en approche.
3. **λ = 0,7 à 5 000** : une valeur de la table `calibration` de `model-meta.json`.
4. **Bonus des classiques** (centile 99, γc = 0,5) : en dernier, parce que sa place affichée à ∞ dépend de la calibration.
5. **Puis l'œil** : ce que les mesures ne tranchent pas, au § 7. Les URL de comparaison sont au § 8.

**Rien de tout cela n'est appliqué** : ce document attend ton accord.

---

## 1. Méthode

**Exports A et B** (`web/scripts/tuning-report.ts`, même moteur que le site, résultats dans `web/test-data/reports/tuning_{A,B}.json`, ignoré). Pour chaque variante, aux 8 crans, sur les 48 films calculés :
- **recouvrement** avec la version actuelle (films communs sur 48) ;
- **animation** : part des films avec le genre MovieLens *Animation* dans les 48, dans les 8 et dans les 16 premières cartes ; **genre n° 1 du profil** (*Drama* pour A et B) dans les 48. Le profil est celui que vise la calibration (part pondérée des films du fold-in) : animation **14 %** pour A, **26 %** pour B ; *Drama* 60 % et 43 % ;
- **films estimés** dans les 48 et dans les 8 premiers ;
- **« loin de tes goûts »** : cartes de score relatif < 0,04 (règle de l'étape 6b) ;
- **score relatif médian des 8 premières cartes** (score du modèle / moyenne des 20 premiers films à ∞ : la mesure de « loin de tes goûts ») ;
- **sauts** : cartes des 8 premières venues d'au-delà du rang 24 du vivier (le vivier = les 150 meilleurs candidats du cran par `score'`, avant la calibration) ;
- **watchlist** (§ 3) : films de la watchlist dans les 48 et dans les 8 premiers, rang médian.

**Validation** (`pipeline/tuning_analysis.py sweep`, protocole de `quality_term.py` : 10 000 utilisateurs de validation, fold-in D2, plafonds sur les comptes d'entraînement, q = moyenne bayésienne des notes d'entraînement, K = 50, vivier de 150, calibration de production). NDCG@20 et Recall@20 sur les 20 premiers des 48, sur les films **bien notés** du held-out (note ≥ médiane du fold-in) et sur **tous** les films revus ; Δ = écart apparié avec la version actuelle (IC à 95 %). La validation ne contient pas de film estimé : « sans films récents » ne s'y mesure pas (les films récents ont été mesurés par le faux départ à froid, spec § 5, R3).

**Limite, déjà écrite en R6b** : le held-out, c'est « ce que l'utilisateur a regardé ensuite ». Il favorise par construction le modèle seul (pas de calibration, pas de qualité). Aux crans bas, NDCG@20 vaut quelques millièmes et ne voit presque rien. Les verdicts s'appuient donc sur trois choses : la validation pour **ne pas casser** ce qui marche, les exports pour **ce qu'on voit**, et la watchlist comme arbitre secondaire.

---

## 2. Question 1 — Qu'est-ce qui a dégradé le milieu du curseur ?

### Constat

- **Crans de gauche (∞ → 10 000) : rien ne bouge avec λ.** La calibration y vaut 0,1. Les variantes de λ ne touchent que les crans ≤ 5 000, où le terme de qualité change 1 à 3 films sur 48 et les films estimés 6 à 11.
- **Le saut est entre 10 000 et 5 000, là où λ passe de 0,1 à 0,9.** Le score relatif médian des 8 premières cartes tombe de 0,64 à 0,24 sur A, et de 0,82 à 0,37 sur B. Sans calibration, il serait de 0,41 et 0,54 à 5 000 : **la calibration retire à elle seule 40 % (A) et 31 % (B) du score de la première rangée à 5 000**, et près de 40 % à 2 000 (0,26 → 0,16 ; 0,33 → 0,20).
- **Le mécanisme : la calibration ne retire pas l'animation des 48, elle la repousse plus bas.** À λ = 0,9, l'algorithme glouton place d'abord les films qui corrigent le mélange de genres (drames, thrillers), qu'il va chercher loin dans le vivier : 3 à 7 des 8 premières cartes viennent d'au-delà du rang 24, et jusqu'au rang 148. Les 48 films calibrés, remis dans l'ordre du score, ont **la même première rangée que sans calibration** : 62-88 % d'animation sur A, 12-75 % sur B. L'animation est donc toujours là, dans les rangées 2 à 6.
- **Qui change le plus le milieu ?** Films communs avec la version actuelle, crans 5 000 à 1 000 :
  - sans calibration : 30 à 37 (11 à 18 films changent) ;
  - sans films estimés recommandés : 33 à 42 (6 à 15) ;
  - sans terme de qualité : 39 à 45 (3 à 9).

  L'ordre est donc **calibration > films récents > qualité**. À droite (500, 200), la calibration domine seule.
- **Retirer les films estimés du profil** (pas seulement des recommandations) dégrade tout. Le score de la première rangée baisse (A, 2 000 : 0,16 → 0,08), « loin de tes goûts » monte (A, 1 000 : 2 → 18 cartes), l'animation remonte sur B (38 → 52 % à 2 000). Les films récents vus comptent dans les goûts : **à garder dans le profil**.
- **12 Angry Men à 45ᵉ à ton écran contre 42ᵉ ici** : le script n'applique aucun choix de l'écran « à vérifier ». Un candidat coché change le profil, ce qui explique probablement l'écart.

### Mesures sur les exports

**Recouvrement des 48 avec la version actuelle** (A / B ; 48 = identique)

| variante | ∞ | 20 000 | 10 000 | 5 000 | 2 000 | 1 000 | 500 | 200 |
|---|---|---|---|---|---|---|---|---|
| sans calibration | 48 / 47 | 47 / 48 | 48 / 48 | 35 / 37 | 35 / 37 | 32 / 30 | 29 / 33 | 26 / 25 |
| λ 0,3 (≤ 5 000) | 48 / 48 | 48 / 48 | 48 / 48 | 38 / 40 | 36 / 38 | 34 / 34 | 32 / 37 | 29 / 30 |
| λ 0,5 (≤ 5 000) | 48 / 48 | 48 / 48 | 48 / 48 | 39 / 43 | 38 / 39 | 36 / 34 | 33 / 39 | 31 / 32 |
| λ 0,7 (≤ 5 000) | 48 / 48 | 48 / 48 | 48 / 48 | 41 / 43 | 41 / 40 | 40 / 38 | 37 / 42 | 38 / 35 |
| vivier 96 (≤ 5 000) | 48 / 48 | 48 / 48 | 48 / 48 | 42 / 43 | 46 / 40 | 41 / 39 | 37 / 43 | 35 / 36 |
| sans qualité | 45 / 46 | 46 / 47 | 47 / 45 | 43 / 44 | 42 / 45 | 44 / 39 | 42 / 41 | 45 / 43 |
| sans récents (non recommandés) | 42 / 41 | 38 / 39 | 39 / 40 | 37 / 41 | 33 / 39 | 33 / 42 | 40 / 43 | 48 / 48 |
| sans récents (ni profil) | 40 / 32 | 37 / 30 | 38 / 31 | 36 / 31 | 29 / 24 | 25 / 23 | 30 / 29 | 24 / 26 |

**Animation dans les 48** (%, A / B ; profil : A 14 %, B 26 %)

| variante | 5 000 | 2 000 | 1 000 | 500 | 200 |
|---|---|---|---|---|---|
| actuel | 29 / 29 | 31 / 38 | 31 / 33 | 35 / 33 | 44 / 44 |
| sans calibration | 33 / 25 | 48 / 48 | 42 / 48 | 65 / 46 | 65 / 56 |
| λ 0,3 (≤ 5 000) | 33 / 29 | 46 / 50 | 42 / 46 | 60 / 40 | 62 / 60 |
| λ 0,5 (≤ 5 000) | 33 / 29 | 46 / 48 | 42 / 44 | 56 / 35 | 60 / 58 |
| λ 0,7 (≤ 5 000) | 33 / 29 | 40 / 46 | 38 / 40 | 48 / 35 | 50 / 52 |
| vivier 96 (≤ 5 000) | 29 / 29 | 31 / 40 | 35 / 40 | 38 / 38 | 46 / 46 |
| sans qualité | 29 / 29 | 33 / 40 | 35 / 33 | 35 / 33 | 44 / 42 |
| sans récents (non recommandés) | 27 / 27 | 31 / 38 | 29 / 31 | 35 / 35 | 44 / 44 |
| sans récents (ni profil) | 27 / 40 | 40 / 52 | 33 / 48 | 38 / 50 | 38 / 54 |

**Animation dans les 8 premières cartes** (%, A / B)

| variante | 5 000 | 2 000 | 1 000 | 500 | 200 |
|---|---|---|---|---|---|
| actuel | 25 / 25 | 25 / 25 | 25 / 25 | 25 / 25 | 25 / 25 |
| sans calibration | 62 / 12 | 88 / 62 | 88 / 75 | 62 / 75 | 88 / 75 |
| λ 0,3 (≤ 5 000) | 50 / 38 | 62 / 50 | 62 / 38 | 50 / 50 | 62 / 50 |
| λ 0,5 (≤ 5 000) | 25 / 25 | 38 / 25 | 50 / 38 | 50 / 38 | 50 / 50 |
| λ 0,7 (≤ 5 000) | 38 / 25 | 38 / 25 | 38 / 25 | 38 / 38 | 25 / 38 |
| vivier 96 (≤ 5 000) | 25 / 38 | 38 / 38 | 38 / 25 | 25 / 25 | 25 / 25 |
| sans qualité | 25 / 25 | 25 / 38 | 25 / 25 | 25 / 25 | 25 / 25 |
| sans récents (non recommandés) | 25 / 12 | 25 / 25 | 12 / 25 | 25 / 25 | 25 / 25 |
| sans récents (ni profil) | 25 / 25 | 25 / 38 | 25 / 38 | 25 / 38 | 25 / 38 |

**Animation dans les 16 premières cartes** (%, A / B ; deux rangées, la mesure de l’étape 6c)

| variante | 5 000 | 2 000 | 1 000 | 500 | 200 |
|---|---|---|---|---|---|
| actuel | 25 / 25 | 31 / 25 | 31 / 31 | 25 / 25 | 25 / 31 |
| sans calibration | 44 / 25 | 69 / 56 | 56 / 62 | 69 / 56 | 75 / 81 |
| λ 0,3 (≤ 5 000) | 50 / 25 | 56 / 50 | 62 / 44 | 56 / 44 | 62 / 62 |
| λ 0,5 (≤ 5 000) | 44 / 25 | 44 / 38 | 62 / 44 | 50 / 38 | 44 / 56 |
| λ 0,7 (≤ 5 000) | 31 / 25 | 38 / 31 | 44 / 38 | 38 / 38 | 44 / 44 |
| vivier 96 (≤ 5 000) | 19 / 31 | 31 / 31 | 31 / 31 | 25 / 38 | 38 / 38 |
| sans qualité | 25 / 25 | 25 / 31 | 25 / 31 | 25 / 25 | 25 / 31 |
| sans récents (non recommandés) | 19 / 25 | 25 / 25 | 31 / 31 | 25 / 31 | 25 / 31 |
| sans récents (ni profil) | 25 / 25 | 25 / 38 | 31 / 44 | 31 / 44 | 25 / 44 |

**Genre n° 1 du profil (Drama) dans les 48** (%, A / B ; profil : A 60 %, B 43 %)

| variante | 5 000 | 2 000 | 1 000 | 500 | 200 |
|---|---|---|---|---|---|
| actuel | 60 / 42 | 58 / 44 | 62 / 42 | 58 / 40 | 54 / 35 |
| sans calibration | 60 / 50 | 58 / 48 | 67 / 56 | 44 / 46 | 31 / 17 |
| λ 0,3 (≤ 5 000) | 60 / 50 | 58 / 44 | 65 / 52 | 44 / 44 | 35 / 21 |
| λ 0,5 (≤ 5 000) | 60 / 44 | 54 / 44 | 67 / 52 | 48 / 40 | 38 / 23 |
| λ 0,7 (≤ 5 000) | 60 / 44 | 56 / 44 | 67 / 50 | 48 / 44 | 44 / 27 |
| vivier 96 (≤ 5 000) | 62 / 42 | 60 / 44 | 65 / 46 | 52 / 42 | 52 / 35 |
| sans qualité | 60 / 42 | 58 / 44 | 62 / 44 | 56 / 40 | 54 / 38 |
| sans récents (non recommandés) | 60 / 44 | 60 / 44 | 60 / 40 | 58 / 38 | 54 / 35 |
| sans récents (ni profil) | 62 / 40 | 62 / 40 | 60 / 42 | 60 / 38 | 52 / 29 |

**Score relatif médian des 8 premières cartes** (score du modèle / moyenne des 20 premiers à ∞ ; A / B)

| variante | 5 000 | 2 000 | 1 000 | 500 | 200 |
|---|---|---|---|---|---|
| actuel | 0,24 / 0,37 | 0,16 / 0,20 | 0,07 / 0,13 | 0,04 / 0,08 | 0,01 / 0,03 |
| sans calibration | 0,41 / 0,54 | 0,26 / 0,33 | 0,13 / 0,17 | 0,05 / 0,11 | 0,03 / 0,06 |
| λ 0,3 (≤ 5 000) | 0,38 / 0,53 | 0,26 / 0,32 | 0,12 / 0,14 | 0,05 / 0,10 | 0,02 / 0,05 |
| λ 0,5 (≤ 5 000) | 0,33 / 0,52 | 0,19 / 0,28 | 0,11 / 0,14 | 0,04 / 0,09 | 0,02 / 0,04 |
| λ 0,7 (≤ 5 000) | 0,29 / 0,52 | 0,18 / 0,20 | 0,09 / 0,13 | 0,04 / 0,09 | 0,01 / 0,04 |
| vivier 96 (≤ 5 000) | 0,23 / 0,52 | 0,15 / 0,28 | 0,07 / 0,14 | 0,03 / 0,08 | 0,01 / 0,04 |
| sans qualité | 0,23 / 0,37 | 0,14 / 0,22 | 0,07 / 0,13 | 0,04 / 0,08 | 0,01 / 0,03 |
| sans récents (non recommandés) | 0,22 / 0,36 | 0,16 / 0,20 | 0,04 / 0,13 | 0,03 / 0,08 | 0,01 / 0,04 |
| sans récents (ni profil) | 0,17 / 0,30 | 0,08 / 0,17 | 0,04 / 0,09 | 0,03 / 0,05 | 0,01 / 0,03 |

**Sauts** : cartes des 8 premières venues d’au-delà du rang 24 du vivier (A / B)

| variante | 5 000 | 2 000 | 1 000 | 500 | 200 |
|---|---|---|---|---|---|
| actuel | 6 / 5 | 3 / 6 | 4 / 6 | 6 / 3 | 6 / 7 |
| sans calibration | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |
| λ 0,3 (≤ 5 000) | 2 / 2 | 0 / 1 | 0 / 4 | 2 / 1 | 3 / 2 |
| λ 0,5 (≤ 5 000) | 3 / 3 | 2 / 4 | 0 / 4 | 2 / 4 | 3 / 4 |
| λ 0,7 (≤ 5 000) | 4 / 3 | 2 / 5 | 3 / 6 | 4 / 3 | 5 / 5 |
| vivier 96 (≤ 5 000) | 6 / 3 | 3 / 4 | 4 / 4 | 6 / 5 | 6 / 5 |
| sans qualité | 6 / 5 | 4 / 5 | 4 / 6 | 6 / 5 | 6 / 8 |
| sans récents (non recommandés) | 6 / 5 | 2 / 6 | 6 / 6 | 6 / 4 | 6 / 7 |
| sans récents (ni profil) | 5 / 5 | 6 / 6 | 6 / 6 | 7 / 6 | 6 / 5 |

**Films estimés dans les 48** (A / B)

| variante | ∞ | 20 000 | 10 000 | 5 000 | 2 000 | 1 000 | 500 | 200 |
|---|---|---|---|---|---|---|---|---|
| actuel | 6 / 7 | 10 / 9 | 9 / 8 | 10 / 5 | 13 / 9 | 14 / 5 | 5 / 2 | 0 / 0 |
| sans calibration | 6 / 7 | 10 / 9 | 9 / 8 | 11 / 6 | 12 / 10 | 13 / 9 | 8 / 3 | 0 / 0 |
| λ 0,3 (≤ 5 000) | 6 / 7 | 10 / 9 | 9 / 8 | 10 / 6 | 12 / 11 | 13 / 9 | 8 / 3 | 0 / 0 |
| λ 0,5 (≤ 5 000) | 6 / 7 | 10 / 9 | 9 / 8 | 10 / 6 | 12 / 10 | 14 / 9 | 8 / 3 | 0 / 0 |
| λ 0,7 (≤ 5 000) | 6 / 7 | 10 / 9 | 9 / 8 | 9 / 6 | 13 / 11 | 13 / 9 | 8 / 2 | 0 / 0 |
| vivier 96 (≤ 5 000) | 6 / 7 | 10 / 9 | 9 / 8 | 10 / 7 | 13 / 10 | 13 / 10 | 5 / 2 | 0 / 0 |
| sans qualité | 5 / 7 | 10 / 9 | 9 / 7 | 8 / 5 | 15 / 8 | 15 / 5 | 4 / 1 | 0 / 0 |
| sans récents (non recommandés) | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |
| sans récents (ni profil) | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |

**« loin de tes goûts »** : cartes de score relatif < 0,04 sur 48 (A / B ; * = note sous le curseur)

| variante | 1 000 | 500 | 200 |
|---|---|---|---|
| actuel | 2 / 0 | 27 / 0 | 48* / 27 |
| sans calibration | 0 / 0 | 21 / 0 | 48* / 20 |
| λ 0,3 (≤ 5 000) | 0 / 0 | 21 / 0 | 48* / 20 |
| λ 0,5 (≤ 5 000) | 0 / 0 | 21 / 0 | 48* / 20 |
| λ 0,7 (≤ 5 000) | 1 / 0 | 21 / 0 | 48* / 21 |
| vivier 96 (≤ 5 000) | 0 / 0 | 27 / 0 | 48* / 29 |
| sans qualité | 1 / 0 | 26 / 0 | 48* / 28 |
| sans récents (non recommandés) | 5 / 0 | 29 / 0 | 48* / 26 |
| sans récents (ni profil) | 18 / 0 | 35 / 8 | 48* / 41* |

### Mesures sur la validation

NDCG@20 et Recall@20 de la version actuelle, puis écart relatif de chaque variante (écart apparié ; « n.s. » = IC à 95 % qui contient 0 ; « = » : variante identique à l'actuel à ce cran).

| cran | NDCG bien notés | Recall bien notés | NDCG tous | Recall tous |
|---|---|---|---|---|
| ∞ | 0,1592 | 0,1987 | 0,1687 | 0,1902 |
| 20 000 | 0,1057 | 0,1264 | 0,1196 | 0,1291 |
| 10 000 | 0,0725 | 0,0820 | 0,0836 | 0,0860 |
| 5 000 | 0,0362 | 0,0445 | 0,0447 | 0,0502 |
| 2 000 | 0,0192 | 0,0224 | 0,0247 | 0,0270 |
| 1 000 | 0,0102 | 0,0115 | 0,0138 | 0,0148 |
| 500 | 0,0058 | 0,0062 | 0,0078 | 0,0081 |
| 200 | 0,0026 | 0,0027 | 0,0036 | 0,0036 |

**NDCG@20, films bien notés** (écart à l'actuel)

| cran | sans calibration | sans qualité | λ 0,3 | λ 0,5 | λ 0,7 |
|---|---|---|---|---|---|
| ∞ | +2,6 % | +0,4 % (n.s.) | = | = | = |
| 20 000 | +3,6 % | +0,6 % | = | = | = |
| 10 000 | +1,7 % | +0,1 % (n.s.) | = | = | = |
| 5 000 | +37,2 % | 0,0 % (n.s.) | +26,0 % | +18,7 % | +11,7 % |
| 2 000 | +39,3 % | −0,5 % (n.s.) | +27,8 % | +19,8 % | +11,3 % |
| 1 000 | +40,6 % | −1,7 % (n.s.) | +26,8 % | +17,7 % | +11,8 % |
| 500 | +39,3 % | −3,8 % | +25,0 % | +19,4 % | +10,8 % |
| 200 | +25,4 % | +0,4 % (n.s.) | +17,0 % | +11,7 % | +6,5 % |

**Recall@20, films bien notés** (écart à l'actuel)

| cran | sans calibration | sans qualité | λ 0,3 | λ 0,5 | λ 0,7 |
|---|---|---|---|---|---|
| ∞ | +0,2 % (n.s.) | +0,4 % (n.s.) | = | = | = |
| 20 000 | +0,1 % (n.s.) | +0,7 % | = | = | = |
| 10 000 | −0,2 % (n.s.) | +0,3 % (n.s.) | = | = | = |
| 5 000 | +19,5 % | +1,9 % | +17,1 % | +14,5 % | +11,2 % |
| 2 000 | +23,4 % | −1,1 % (n.s.) | +22,5 % | +18,0 % | +11,6 % |
| 1 000 | +20,4 % | −1,8 % (n.s.) | +17,6 % | +13,5 % | +9,9 % |
| 500 | +19,9 % | −2,6 % (n.s.) | +17,5 % | +16,3 % | +9,9 % |
| 200 | +11,2 % | +1,0 % (n.s.) | +11,0 % | +8,5 % | +7,1 % |

**NDCG@20, tous les films revus** (écart à l'actuel)

| cran | sans calibration | sans qualité | λ 0,3 | λ 0,5 | λ 0,7 |
|---|---|---|---|---|---|
| ∞ | +2,1 % | +1,1 % | = | = | = |
| 20 000 | +2,9 % | +2,0 % | = | = | = |
| 10 000 | +1,8 % | +1,7 % | = | = | = |
| 5 000 | +33,5 % | +1,7 % | +23,4 % | +16,4 % | +10,6 % |
| 2 000 | +36,6 % | +1,4 % (n.s.) | +25,8 % | +18,5 % | +10,4 % |
| 1 000 | +37,8 % | +1,5 % (n.s.) | +25,1 % | +16,7 % | +10,5 % |
| 500 | +38,8 % | −0,7 % (n.s.) | +25,3 % | +18,5 % | +10,3 % |
| 200 | +30,9 % | +2,8 % (n.s.) | +19,4 % | +13,9 % | +7,2 % |

**Animation dans les 48** (moyenne des utilisateurs de validation ; profil moyen : 7,4 %)

| cran | actuel | sans calibration | λ 0,3 | λ 0,5 | λ 0,7 |
|---|---|---|---|---|---|
| ∞ | 8,7 % | 8,6 % | 8,7 % | 8,7 % | 8,7 % |
| 20 000 | 9,4 % | 9,4 % | 9,4 % | 9,4 % | 9,4 % |
| 10 000 | 10,0 % | 10,0 % | 10,0 % | 10,0 % | 10,0 % |
| 5 000 | 8,0 % | 8,4 % | 8,7 % | 8,7 % | 8,6 % |
| 2 000 | 7,1 % | 7,5 % | 7,8 % | 7,8 % | 7,7 % |
| 1 000 | 6,3 % | 6,1 % | 6,5 % | 6,7 % | 6,7 % |
| 500 | 6,3 % | 5,9 % | 6,5 % | 6,6 % | 6,6 % |
| 200 | 7,4 % | 8,4 % | 8,7 % | 8,6 % | 8,4 % |

**Lecture**
- **La calibration coûte cher au milieu et à droite.** Sans elle, NDCG@20 sur les films bien notés gagnerait 37 à 41 % de 5 000 à 500 (contre 2 à 4 % à gauche, où λ = 0,1). C'est le prix déjà mesuré à l'étape 6c, et il vient presque entièrement du passage de λ à 0,9.
- **Adoucir λ rend une part de ce prix, en proportion.** À chaque cran ≤ 5 000 : λ = 0,7 gagne environ 11 %, λ = 0,5 environ 18 %, λ = 0,3 environ 26 %. Recall@20 et les films revus suivent le même ordre.
- **La validation ne peut pas juger l'animation.** Le profil moyen n'a que 7,4 % d'animation : que λ vaille 0,3 ou 0,9, l'animation des 48 ne bouge que de 0,5 à 1 point. Le problème que la calibration corrige concerne des profils comme A (14 %) et B (26 %), où l'animation envahit les premières rangées. C'est donc aux exports de trancher sur l'animation, la validation dit seulement ce que coûte chaque λ.
- **Le terme de qualité (γ = 0,1) ne coûte rien à gauche et aide à droite.** Sans lui : +0,4 % (n.s.) à ∞, mais −3,8 % à 500. La watchlist de A va dans le même sens (15 films sans lui, 18 avec). **Il est gardé tel quel.**

### Options étudiées

1. **λ plus doux aux crans ≤ 5 000** (0,3, 0,5, 0,7). Comme la calibration traite chaque cran séparément, on peut composer une table cran par cran à partir des lignes ci-dessus.
   - À **5 000**, λ = 0,7 garde l'animation des 16 premières cartes à 31 / 25 % (actuel : 25 / 25 %). Le score de la première rangée monte de 0,24 à 0,29 (A) et de 0,37 à 0,52 (B), et les sauts passent de 6 / 5 à 4 / 3.
   - À 5 000, λ = 0,5 refait l'erreur que l'étape 6c avait écartée : 44 % d'animation dans les 16 premières de A.
   - À **2 000 et en dessous**, tout adoucissement fait revenir l'animation dans les premières rangées. À 2 000 avec λ = 0,7 : 38 / 31 % dans les 16 premières (actuel : 31 / 25 %) et 40 / 46 % dans les 48 (actuel : 31 / 38 %), pour un score de première rangée presque inchangé (0,18 / 0,20 contre 0,16 / 0,20).
2. **Vivier de calibration moins profond** (72 ou 96 au lieu de 150, crans ≤ 5 000). Moins de sauts lointains (rang max 60-96 au lieu de 100-150), mais le score de la première rangée ne monte pas et l'animation des 48 remonte (vivier 72 : 40 / 44 % à 1 000). **Écarté** : il ne règle ni l'un ni l'autre.
3. **Calibrer l'ensemble des 48, puis l'afficher dans l'ordre du score.** La première rangée redevient celle du modèle seul (62-88 % d'animation sur A). **Écarté.**
4. **Ne plus calibrer au milieu.** 48 % d'animation à 2 000 pour 14 % dans le profil de A. **Écarté** : c'est le problème que l'étape 6c a réglé.

### Verdict

**Table de λ recommandée (∞ d'abord) : 0,1 · 0,1 · 0,1 · 0,7 · 0,9 · 0,9 · 0,9 · 0,9**, soit **λ = 0,7 au cran 5 000 seulement**. Elle va de pair avec le plafond des films estimés par rangée (§ 5d), qui traite la deuxième cause.

| cran | λ actuel | λ recommandé | pourquoi |
|---|---|---|---|
| ∞, 20 000, 10 000 | 0,1 | 0,1 | crans excellents, rien à changer |
| 5 000 | 0,9 | **0,7** | la plus grande marche du curseur ; gain net sans retour de l'animation |
| 2 000, 1 000, 500, 200 | 0,9 | 0,9 | tout adoucissement fait revenir l'animation dans les premières rangées de A et B |

- **Raison**, à 5 000 :
  - NDCG@20 sur les films bien notés **+11,7 %** en validation (Recall@20 +11,2 %) ;
  - score de la première rangée 0,24 → 0,29 (A) et 0,37 → 0,52 (B) ;
  - sauts lointains dans les 8 premières : 6 → 4 (A) et 5 → 3 (B) ;
  - animation des 16 premières cartes : 31 % (A) et 25 % (B), contre un profil à 14 % et 26 % ; dans les 48 : 29 → 33 % (A), 29 → 29 % (B). λ = 0,5 donnerait 44 % dans les 16 premières de A : écarté ;
  - 7 (A) et 5 (B) films changent sur 48 ; watchlist dans les 48 : 4 → 5 (A), 1 → 1 (B).
- **Pourquoi pas plus bas que 5 000** : la validation y promet le même gain (+11 % avec λ = 0,7), mais elle ne voit pas l'animation (voir plus haut). Sur les exports, λ = 0,7 à 2 000 remonte l'animation des 48 de 31 / 38 % à 40 / 46 % pour un score de première rangée presque inchangé (0,18 / 0,20 contre 0,16 / 0,20), et la watchlist de B, sommée sur les crans ≤ 5 000, perd 3 films (16 → 13 sur les 8 crans). Les tables plus douces étudiées (A, B, C : 0,3 à 0,7 de 5 000 à 500) ont le même défaut. **À juger à l'œil avec `?lambda=0.7`** (§ 7, point 2) : c'est le seul endroit où la mesure ne tranche pas.
- **Risque** : à 5 000, la première rangée de A a 3 films d'animation sur 8 au lieu de 2.
- **Confiance : moyenne.** Le gain en validation est net ; le juste niveau d'animation relève de l'œil.
- **Ce qui ne change pas** : le vivier (150), l'ordre d'affichage (celui de la calibration), le terme de qualité (γ = 0,1), les films estimés dans le profil.

---

## 3. Question 2 — La watchlist comme mesure personnelle

**Lecture** : `watchlist.csv` de chaque export, même correspondance des titres que l'historique, rapprochements sûrs seulement (`exact`, `probable_variant`). Les films déjà vus sont retirés. C'est une mesure seulement : rien dans le site, rien de versionné à part des comptes.

| | A | B |
|---|---|---|
| lignes de la watchlist | 31 | 46 |
| reconnues, pas vues | 30 | 43 |
| recommandables (dont estimés) | 30 (3) | 42 (3) |

Combien sont candidats à chaque cran (popularité ≤ plafond) et combien entrent dans les 48 aujourd'hui :

| | ∞ | 20 000 | 10 000 | 5 000 | 2 000 | 1 000 | 500 | 200 |
|---|---|---|---|---|---|---|---|---|
| candidats | 30 / 42 | 25 / 39 | 20 / 26 | 16 / 19 | 6 / 14 | 4 / 10 | 2 / 6 | 1 / 3 |
| dans les 48 | 2 / 5 | 4 / 5 | 5 / 2 | 4 / 1 | 1 / 1 | 2 / 0 | 0 / 1 | 0 / 1 |

**Films de la watchlist dans les 48, sommés sur les 8 crans** (entre parenthèses : dans les 8 premières cartes). La somme compte deux fois un film visible à deux crans ; c'est voulu, chaque cran est un écran.

| variante | A | B |
|---|---|---|
| actuel | 18 (3) | 16 (2) |
| sans calibration | 18 (3) | **12** (2) |
| λ 0,3 / 0,5 / 0,7 (≤ 5 000) | 18 / 18 / 19 (3) | **12 / 13 / 13** (1) |
| vivier 96 (≤ 5 000) | 18 (4) | 13 (2) |
| sans qualité | **15** (4) | 15 (2) |
| sans films estimés recommandés | **21** (4) | **17** (1) |
| sans films estimés (ni profil) | 19 (3) | 18 (2) |
| γ 0,2 / 0,3 | 19 / 17 (4) | 14 / 14 (1) |
| classiques c99, γc 0,5 / 1 | 18 / 17 (4) | 16 / 15 (2 / 1) |
| classiques c98, γc 0,5 / 1 | 16 / 16 (4) | 16 / 15 (1) |
| classiques c95, γc 0,5 / 1 | 19 / 18 (4 / 5) | 15 / 13 (1) |

**Lecture**
- **C'est un arbitre faible.** Les comptes sont petits : 16 à 18 « touches » sur 384 cartes, et un seul film qui entre ou sort fait ±1 à un cran, souvent ±2 sur la somme. Seuls des écarts de 3 ou plus, dans le même sens sur A et B, disent quelque chose.
- **Deux signaux, dans le même sens sur A et B :**
  - les **films estimés** prennent la place de films de la watchlist : sans eux, +3 (A) et +1 (B). La watchlist ne contient que 3 films estimés recommandables sur 30 et 42 ;
  - la **calibration** aide B (16 contre 12 sans calibration, et contre 12-13 avec un λ plus doux au milieu) et ne change rien pour A.
- **Le terme de qualité** aide A (18 contre 15 sans lui) et ne change rien pour B.
- **Les classiques** ne changent presque rien en somme (−2 à +1) ; à ∞, ils font entrer un film de la watchlist de A dans les 8 premiers (0 → 1).
- **Rang médian à ∞** (A / B) : 43 / 30 aujourd'hui. Il varie beaucoup (1 à 43) dès qu'un seul film bouge : il n'est pas exploitable avec 2 à 5 films présents.

**Verdict** : la watchlist sert d'arbitre secondaire dans les verdicts qui suivent. Elle penche **contre un λ plus doux** aux crans 2 000 à 500 (B), **pour un plafond des films estimés**, et elle est **neutre pour le bonus des classiques**. Elle mérite d'être lue chez les volontaires (étape 7) : avec 10 à 20 watchlists, les sommes deviennent mesurables. Idée gardée pour plus tard : un tag « dans ta watchlist » (feuille de route).

---

## 4. Question 3 — Classiques par consensus

### Constat

- *12 Angry Men* : ★ 4,3, 21 863 notes, q = +0,72 (au-dessus du centile 99). Visible seulement à ∞ (popularité 21 863).
  - **A** : 56ᵉ au score du modèle, **42ᵉ avec γ = 0,1**, affiché 42ᵉ.
  - **B** : 73ᵉ du vivier, **absent des 48**.
- Le terme γ·q relève tous les films selon leur q, bons comme mauvais. Pour faire monter un classique, il faut un γ qui déplace aussi tout le reste, à tous les crans.

### Options

- **Hausse de γ** : 0,2 et 0,3, pour tous les films.
- **Bonus ciblé** : `score' += γc × max(0, q − q_seuil)`, en plus de γ·q.
  - Seuils q_seuil (q des films entraînés recommandables) : centile 95 = 0,280, centile 98 = 0,408, centile 99 = 0,478.
  - Forces : γc ∈ {0,2 ; 0,5 ; 1}.
  - **Seuls les films entraînés y ont droit** (le consensus, ce sont des notes MovieLens), et une variante « estimés compris » sert au contrôle.
- Films au-dessus du seuil, entraînés recommandables (estimés recommandables entre parenthèses) :
  - c95 : 1 140 (79) ;
  - c98 : 457 (48) ;
  - c99 : 229 (35).

### Mesures sur les exports

Rang à ∞ : **affiché (rang dans le vivier par `score'`)**. Le vivier compte 150 films ; « — » = absent des 48. Recouvrement avec l'actuel à ∞ / 2 000 / 500.

| variante | *12 Angry Men* A | *12 Angry Men* B | *Godfather II* A | *Godfather II* B | *Spirited Away* A | recouvrement ∞ / 2 000 / 500 (A ; B) | estimés à ∞ (A / B) | watchlist, 8 crans (A / B) |
|---|---|---|---|---|---|---|---|---|
| actuel | 42 (42) | — (73) | 10 (9) | — (> 150) | 2 (1) | 48 / 48 / 48 ; 48 / 48 / 48 | 6 / 7 | 18 / 16 |
| γ 0,2 | 1 (37) | — (54) | 10 (6) | — (> 150) | 2 (1) | 46 / 44 / 42 ; 44 / 42 / 42 | 6 / 7 | 19 / 14 |
| γ 0,3 | 1 (27) | 2 (40) | 7 (4) | — (> 150) | 2 (1) | 45 / 40 / 36 ; 42 / 40 / 41 | 7 / 7 | 17 / 14 |
| classiques c95 γc 0,2 | 1 (27) | 46 (43) | 7 (4) | — (> 150) | 2 (1) | 45 / 45 / 45 ; 42 / 44 / 46 | 5 / 7 | 18 / 16 |
| classiques c95 γc 0,5 | 1 (16) | 2 (23) | 7 (3) | — (> 150) | 2 (1) | 40 / 41 / 44 ; 37 / 44 / 46 | 4 / 7 | 19 / 15 |
| classiques c95 γc 1 | 1 (9) | 2 (11) | 5 (3) | — (73) | 2 (1) | 35 / 39 / 39 ; 28 / 41 / 43 | 3 / 5 | 18 / 13 |
| classiques c98 γc 0,2 | 28 (28) | — (50) | 1 (4) | — (> 150) | 2 (1) | 46 / 47 / 48 ; 45 / 47 / 47 | 6 / 7 | 18 / 16 |
| classiques c98 γc 0,5 | 1 (17) | 2 (27) | 7 (3) | — (> 150) | 2 (1) | 42 / 47 / 45 ; 42 / 45 / 46 | 4 / 7 | 16 / 16 |
| classiques c98 γc 1 | 1 (9) | 2 (12) | 4 (3) | — (110) | 2 (1) | 37 / 45 / 45 ; 37 / 44 / 45 | 4 / 7 | 16 / 15 |
| classiques c99 γc 0,2 | 30 (31) | — (54) | 1 (4) | — (> 150) | 2 (1) | 47 / 48 / 48 ; 47 / 47 / 47 | 6 / 7 | 18 / 16 |
| classiques c99 γc 0,5 | 1 (20) | 2 (32) | 7 (3) | — (> 150) | 2 (1) | 44 / 48 / 48 ; 43 / 47 / 46 | 6 / 7 | 18 / 16 |
| classiques c99 γc 1 | 1 (10) | 2 (13) | 5 (3) | — (> 150) | 2 (1) | 40 / 47 / 48 ; 41 / 45 / 46 | 4 / 7 | 17 / 15 |
| classiques c98 γc 0,5, estimés compris | 1 (21) | 2 (29) | 7 (3) | — (> 150) | 2 (1) | 41 / 45 / 45 ; 41 / 43 / 47 | 8 / 9 | 17 / 15 |

**Stabilité : les sauts dus à la calibration.**
- Dès que *12 Angry Men* entre dans les ~40 premiers du vivier, la calibration à ∞ (λ = 0,1) le fait passer **1ᵉʳ (A) ou 2ᵉ (B)**. Pour un profil à 60 % *Drama*, un drame pur est le meilleur premier choix pour équilibrer les genres. Exemples :
  - A, γ 0,2 : 37ᵉ du vivier → 1ᵉʳ affiché ;
  - B, c98 γc 0,5 : 27ᵉ → 2ᵉ.
- Ce saut n'est pas systématique : sur B, avec c95 γc 0,2, le film est 43ᵉ du vivier et reste 46ᵉ affiché.
- La place affichée est donc binaire. Le critère « dans les 15 premiers » est atteint par ce saut, qui dépend de la composition du profil. **La mesure stable est le rang dans le vivier.** Il passe sous 15 sur A et B seulement avec **γc = 1** :
  - c99 : 10 (A) et 13 (B) ;
  - c98 : 9 et 12 ;
  - c95 : 9 et 11.
- *The Godfather Part II* (q = 0,72) passe de 10ᵉ à 5ᵉ ou 7ᵉ sur A selon la variante. Il saute lui aussi à 1ᵉʳ avec γc = 0,2 (c98, c99) : c'est alors lui, et non *12 Angry Men*, qui prend la place du drame pur.
- *Spirited Away* reste 2ᵉ sur A partout. B l'a vu.

### Mesures sur la validation

Écart relatif à l'actuel (γ = 0,1, pas de bonus). En gras : critère « au plus −2 % de NDCG@20 sur les films bien notés à ∞ » non tenu.

| variante | NDCG bien notés ∞ | Recall bien notés ∞ | NDCG tous ∞ | NDCG bien notés 2 000 | NDCG bien notés 500 |
|---|---|---|---|---|---|
| γ 0,2 | −0,9 % | −0,7 % | −1,6 % | −1,3 % (n.s.) | −0,4 % (n.s.) |
| γ 0,3 | −1,9 % | −2,0 % | −3,1 % | −3,1 % | −2,6 % (n.s.) |
| classiques c95 γc 0,2 | −0,9 % | −0,6 % | −1,3 % | −0,8 % (n.s.) | −0,1 % (n.s.) |
| classiques c95 γc 0,5 | **−2,9 %** | −3,0 % | −4,2 % | −2,7 % | −1,2 % (n.s.) |
| classiques c95 γc 1 | **−10,4 %** | −12,3 % | −12,3 % | −8,1 % | −3,9 % |
| classiques c98 γc 0,2 | −0,3 % | 0,0 % (n.s.) | −0,7 % | +0,1 % (n.s.) | +0,4 % (n.s.) |
| classiques c98 γc 0,5 | −1,5 % | −1,0 % | −2,1 % | −0,8 % (n.s.) | +0,1 % (n.s.) |
| classiques c98 γc 1 | **−5,1 %** | −5,5 % | −6,5 % | −2,9 % | +0,3 % (n.s.) |
| classiques c99 γc 0,2 | −0,2 % (n.s.) | +0,1 % (n.s.) | −0,4 % | +0,1 % (n.s.) | 0,0 % (n.s.) |
| classiques c99 γc 0,5 | −1,0 % | −0,7 % | −1,4 % | −0,7 % (n.s.) | +0,1 % (n.s.) |
| classiques c99 γc 1 | **−2,6 %** | −2,6 % | −3,5 % | −1,6 % | +0,1 % (n.s.) |

**Lecture**
- Plus le seuil est bas ou γc fort, plus le coût monte : c95 γc 1 retire 10 % à ∞. Au seuil c99 (230 films entraînés recommandables), γc = 0,2 ne coûte rien de mesurable, γc = 0,5 coûte **−1,0 %**, γc = 1 coûte **−2,6 %** et sort du critère.
- **Une simple hausse de γ coûte autant pour moins de résultat.** γ = 0,2 coûte −0,9 % à ∞ mais laisse *12 Angry Men* hors des 48 de B (54ᵉ du vivier). γ = 0,3 le fait entrer (−1,9 %), mais touche tous les crans : −3,1 % à 2 000 et −3,1 % sur tous les films revus à ∞. Le bonus ciblé ne touche que les films très au-dessus du seuil, et presque rien aux crans bas, où ces films sont rares.
- Aux crans 2 000 et 500, le bonus c99 est sans effet mesurable (−0,7 % n.s. et +0,1 % n.s. pour γc = 0,5).

### Films estimés et note gonflée

- Avec q tiré de la note TMDB, **48 films estimés recommandables dépassent le centile 98**, alors qu'aucun n'a de consensus MovieLens. Le § 5 montre que leur note est gonflée.
- Variante « estimés compris » (c98 γc 0,5) : estimés dans les 48 à ∞ 6 → 8 (A) et 7 → 9 (B) ; à 5 000, 10 → 12 (A) et 5 → 12 (B).
- **Le bonus doit exclure les films estimés** (règle « films entraînés seulement »). Avec la droite récente du § 5, aucun estimé ne dépasserait plus le centile 98 (48 → 0) : double sécurité.

### Verdict

**Bonus ciblé, seuil au centile 99 (q > 0,478), γc = 0,5, films entraînés seulement**, en plus de γ = 0,1 inchangé.

| critère proposé | c99 γc 0,5 | c99 γc 1 | γ 0,3 |
|---|---|---|---|
| *12 Angry Men* dans les 15 premiers à ∞ | oui : 1ᵉʳ (A), 2ᵉ (B) | oui : 1ᵉʳ, 2ᵉ | oui : 1ᵉʳ, 2ᵉ |
| rang dans le vivier (la mesure stable) | 20 (A), 32 (B) | 10, 13 | 27, 40 |
| NDCG@20 bien notés à ∞ ≥ −2 % | **oui, −1,0 %** | non, −2,6 % | oui de peu, −1,9 % |
| plus de films de la watchlist dans les 48 | non : 18 / 16, comme l'actuel | non : 17 / 15 | non : 17 / 14 |
| films changés à ∞ (sur 48) | 4 (A), 5 (B) | 8, 7 | 3, 6 |
| effet aux crans bas | nul | faible | −3,1 % à 2 000 |

- **Raison** : c'est la seule variante qui tient les deux premiers critères sans toucher au reste du curseur. Elle remet les classiques là où on les attend, en tête de la liste à ∞ (*The Godfather Part II* passe aussi de 10ᵉ à 7ᵉ sur A), pour un coût sous le seuil fixé.
- **Le troisième critère n'est atteint par aucune variante.** La watchlist est neutre (§ 3) : une ou deux watchlists de 30 à 42 films candidats ne suffisent pas à dire si les classiques ajoutés sont « les bons ». À relire avec les volontaires.
- **Pourquoi pas γc = 1** : le rang dans le vivier serait stable (sous 15 sur A et B), mais −2,6 % sort du critère, et 7 à 8 films changent à ∞. À regarder à l'œil (§ 7, point 4) si γc = 0,5 paraît trop timide.
- **Risque** : la place affichée dépend du saut de la calibration (§ 4, « Stabilité »). Un classique entre le 20ᵉ et le 40ᵉ rang du vivier peut passer 1ᵉʳ chez un profil et rester en bas chez un autre. C'est un effet de la calibration à ∞, pas du bonus.
- **Garde-fous** : films estimés exclus (règle du bonus, et droite récente du § 5a) ; seuil calculé sur les films entraînés recommandables, écrit dans `model-meta.json` avec γc.
- **Confiance : moyenne.** C'est un jugement de produit (« un classique très bien noté vaut d'être proposé »), que la validation tolère mais ne peut pas confirmer.

### La rangée « les classiques qui te manquent »

**Avis : c'est la meilleure réponse à long terme, mais pas pour cette étape.**

Pour :
- elle ne mélange pas deux objectifs dans un même classement. La liste principale reste « ce que le modèle prévoit pour toi », la rangée dit franchement « très bien noté par beaucoup de monde, loin de tes habitudes » ;
- elle n'a pas besoin du saut de la calibration ;
- elle explique pourquoi le film est là, ce qu'un bonus caché ne fait pas.

Contre, ou plutôt ce qu'il reste à trancher :
- le design et les textes d'une rangée de plus ;
- sa place face au curseur : les classiques sont presque tous au-dessus de 10 000 de popularité, donc la rangée n'a de sens qu'à gauche, ou alors elle est indépendante du cran ;
- son critère : q au-dessus du centile 99, pas vu, ni trop loin des goûts (par exemple dans les 2 000 premiers au score).

**Proposition** : bonus ciblé maintenant, petit, mesurable et réversible ; rangée à l'étape 9, avec la watchlist des volontaires comme mesure. Si la rangée est faite, **mettre γc à 0**, pour ne pas compter deux fois la même chose.

---

## 5. Question 4 — Films récents

### 5a. Note TMDB gonflée à la sortie

**Constat.**
- Films du catalogue, ≥ 50 votes TMDB et ≥ 20 notes MovieLens. Pour chacun, le résidu entre son q MovieLens et le q prédit par la droite TMDB du site (`q = 0,526 × t − 3,637`, ajustée sur tout le catalogue). Un résidu négatif veut dire que TMDB surestime le film.
- Le défaut est net sur les films récents et très votés : leur note TMDB annonce environ **0,28 étoile de trop**, contre 0,09 pour les films 2010-2018 aux mêmes votes. Les films estimés sont dans ce cas.

| sortie | films | résidu moyen | note TMDB moyenne |
|---|---|---|---|
| avant 2000 | 8 159 | −0,01 | 6,57 |
| 2000-2009 | 4 547 | −0,01 | 6,38 |
| 2010-2014 | 2 957 | +0,05 | 6,39 |
| 2015-2018 | 2 831 | +0,03 | 6,42 |
| 2019-2020 | 1 009 | −0,04 | 6,58 |
| 2021 | 409 | −0,07 | 6,69 |
| 2022 | 322 | −0,08 | 6,66 |
| 2023 | 136 | −0,04 | 6,60 |

| votes TMDB | films 2019-2023 : résidu | films 2010-2018 : résidu |
|---|---|---|
| 50-499 | +0,07 (841) | +0,10 (3 354) |
| 500-1 999 | −0,10 (674) | −0,01 (1 432) |
| 2 000-9 999 | **−0,28** (323) | −0,09 (826) |
| ≥ 10 000 | **−0,30** (39) | −0,15 (176) |

- Films estimés recommandables (≥ 500 votes) : note TMDB moyenne **6,76** à 500-1 999 votes et **7,16** à 2 000-9 999, contre 6,42 et 6,61 pour les films 2010-2018 du catalogue aux mêmes votes.
- Leur q moyen est −0,06, contre −0,20 pour le catalogue : ils passent pour meilleurs que la moyenne, en bonne partie parce que leur note est gonflée.

**Options** (q des films estimés ; « résidu » = sur les films 2019-2023 du catalogue à ≥ 2 000 votes, ceux qui ressemblent aux estimés) :

| q des films estimés | q moyen (recommandables) | > c95 / c98 / c99 | résidu |
|---|---|---|---|
| actuel : droite du catalogue, 200 votes fictifs | −0,06 | 81 / 49 / 36 | −0,28 |
| 1 000 votes fictifs | −0,11 | 30 / 13 / 10 | −0,25 |
| **droite des films 2019-2023** (`q = 0,295 × t − 2,163`) | −0,16 | **7 / 0 / 0** | **−0,14** |
| décalage par tranche de votes (−0,10 / −0,28 / −0,30) | −0,20 | 41 / 19 / 10 | 0 (ajusté sur ces films) |

**Effet sur les listes** (films estimés dans les 48, A / B, actuel → droite 2019-2023) :
- ∞ : 6 → 4 et 7 → 7 ;
- 5 000 : 10 → 7 et 5 → 5 ;
- 2 000 : 13 → 12 et 9 → 8 ;
- 8 premiers, tous crans réunis : 12 → 8 (A) et 11 → 8 (B).

La part des estimés baisse peu. Elle tient surtout à leurs vecteurs (norme D1c), pas à q.

**Verdict : droite des films 2019-2023** pour le q des films estimés.
- **Raison** :
  - elle est ajustée sur les films qui ressemblent le plus aux estimés ;
  - elle divise par deux le résidu des films récents très votés ;
  - aucun estimé ne dépasse plus le centile 98, donc aucun ne profiterait du bonus des classiques à cause d'une note gonflée ;
  - c'est un simple changement de paramètres (`model-meta.json` `quality.tmdb`), sans nouveau code.
- **Risque** : la pente est plus faible (0,29 contre 0,53), donc un vrai très bon film récent est un peu moins relevé. Le décalage par tranche de votes fait mieux sur le papier, mais il est ajusté sur les films mêmes qui servent à le juger : écarté.
- **Confiance : moyenne.** Les notes MovieLens des films 2022-2023 viennent des premiers spectateurs (MovieLens s'arrête en octobre 2023), qui peuvent être eux-mêmes généreux.

### 5b. « ✱ pépite » sur un film estimé

**Constat** (version actuelle, tampons sur les 48 des 8 crans) :
- A : **5 tampons sur 14** tombent sur un film estimé (36 %) ;
- B : 1 sur 6.

Les films estimés ne font pourtant que 17 % (A) et 12 % (B) des cartes.

**Raison** : la popularité d'un film estimé est une **estimation** (rang de ses votes TMDB dans l'année, R3d), et un film sorti il y a quelques mois est « peu connu » parce qu'il est **nouveau**, pas parce que c'est une pépite. Le tampon promet le second.

**Verdict : l'interdire sur les films estimés.**
- Le film le moins connu parmi les films entraînés de la rangée le reçoit, s'il passe la règle (au plus la moitié de la popularité médiane de la rangée) ; sinon, pas de tampon.
- Changement d'une ligne dans `pepiteStamps` / `cardTags` : un film estimé n'est jamais candidat.
- Risque : aucun mesurable. **Confiance : bonne.**

### 5c. « parce que t'as aimé » sur un film estimé

**Mesure** : les 384 cartes de chaque export, citations choisies comme à l'écran (`citationPicks`). Cosinus actuel, puis cosinus centré : on retire des vecteurs le vecteur moyen des films entraînés.

| | A : cartes de films estimés | A : autres cartes | B : cartes de films estimés | B : autres cartes |
|---|---|---|---|---|
| cartes | 67 | 317 | 45 | 339 |
| cosinus moyen avec les films cités | **0,51** | 0,65 | **0,60** | 0,78 |
| part des citations allant aux 2 films les plus cités de l'export | **22 %** | 16 % | **17 %** | 14 % |
| avec le cosinus centré : cosinus moyen | 0,51 | 0,65 | 0,59 | 0,77 |
| avec le cosinus centré : part des 2 films les plus cités | 19 % | 15 % | 18 % | 14 % |
| cartes dont les citations changent en centrant | 40 % | 24 % | 49 % | 38 % |

**Lecture** :
- sur un film estimé, le lien avec les films cités est plus faible (cosinus 0,51-0,60 contre 0,65-0,78), et les citations reviennent plus souvent aux mêmes films « passe-partout » ;
- centrer change beaucoup de citations (40-49 % des cartes de films estimés) mais **ne rend pas les citations moins génériques** (A : 22 → 19 % ; B : 17 → 18 %) et ne renforce pas le lien. Le vecteur d'un film estimé est une prédiction du contenu : il pointe vers la direction moyenne, et le centrage n'y peut rien ;
- l'inverse a déjà été fait en R6c : un film estimé n'est jamais **cité**.

**Verdict : ne pas afficher « parce que t'as aimé » sur la carte d'un film estimé**, et garder le cosinus actuel partout ailleurs.
- **Coût** : 67 cartes sur 384 (17 %) pour A et 45 sur 384 (12 %) pour B perdent leur explication. La carte garde « ★ x,x · TMDB (estimé) », qui dit déjà pourquoi on la connaît moins bien.
- **Confiance : bonne.**

### 5d. Plafonner les films estimés par rangée

**Mesure** : au plus **1 film estimé par rangée de 8**. Les autres sont repoussés aux rangées suivantes, et la liste est complétée par les films calibrés 49 à 96.

| cran | ∞ | 20 000 | 10 000 | 5 000 | 2 000 | 1 000 | 500 | 200 |
|---|---|---|---|---|---|---|---|---|
| A : estimés dans les 48, avant → après | 6 → 5 | 10 → 6 | 9 → 6 | 10 → 6 | 13 → 6 | 14 → 6 | 5 → 5 | 0 → 0 |
| A : rangées avec ≥ 2 estimés (sur 6) | 1 | 4 | 4 | 3 | 3 | 6 | 1 | 0 |
| A : recouvrement, watchlist dans les 48 (avant → après) | 47, 2 → 2 | 44, 4 → 4 | 45, 5 → 5 | 44, 4 → 4 | 41, 1 → 2 | 40, 2 → 2 | 48, 0 → 0 | 48, 0 → 0 |
| B : estimés dans les 48, avant → après | 7 → 6 | 9 → 6 | 8 → 6 | 5 → 5 | 9 → 6 | 5 → 5 | 2 → 2 | 0 → 0 |
| B : rangées avec ≥ 2 estimés (sur 6) | 2 | 2 | 2 | 2 | 4 | 1 | 0 | 0 |
| B : recouvrement, watchlist dans les 48 (avant → après) | 47, 5 → 5 | 45, 5 → 6 | 46, 2 → 2 | 48, 1 → 1 | 45, 1 → 1 | 48, 0 → 0 | 48, 1 → 1 | 48, 1 → 1 |

**Lecture**
- Aujourd'hui, les crans du milieu de A portent 9 à 14 films estimés sur 48 (19-29 %), avec 3 à 6 rangées sur 6 qui en ont au moins 2.
- Le plafond les ramène à 6 au plus (12,5 %). Il change 0 à 8 films sur 48 et ne fait perdre aucun film de la watchlist (A : +1 à 2 000 ; B : +1 à 20 000).
- Le critère de clôture de D5 (au plus 20 % du top 20 aux crans 2 000 et 500) devient vrai par construction.

**Verdict : oui, 1 film estimé au plus par rangée de 8.**
- **Raison** : leurs vecteurs sont des estimations rétrécies vers la moyenne, donc « proches » de beaucoup de profils. C'est la cause directe de l'invasion du milieu (§ 2) ; le q n'y est presque pour rien (§ 5a).
- **Risque** : une personne qui regarde surtout des films récents (B a 112 films estimés dans son historique) en verra moins. Ces films restent dans son profil, et 6 sur 48 reste visible.
- **Confiance : moyenne.** À relire avec les volontaires.
- Règle d'affichage pure, comme le tampon ; elle s'applique après la calibration.

---

## 6. Question 5 — Le curseur

### Comment il marche

- **Huit crans** : ∞, 20 000, 10 000, 5 000, 2 000, 1 000, 500, 200. Chacun est un **plafond de popularité**.
- À un cran, les candidats sont **tous** les films pas vus, recommandables, dont la popularité est sous le plafond. Le plafond est **cumulatif** : un film de popularité 150 est candidat à tous les crans, un film de popularité 30 000 seulement à ∞.
- Les candidats sont classés par `score'` (score du modèle / meilleur score du cran + γ·q). On garde un vivier de 150, puis la calibration choisit les 48 films affichés.
- Aller vers la droite ne change donc pas le classement : on retire les films les plus connus, et le modèle se rabat sur ce qui reste.

### Ce que disent les mesures

- **Le score de la première rangée baisse à chaque cran** (score relatif médian des 8 premières) :

  | cran | ∞ | 20 000 | 10 000 | 5 000 | 2 000 | 1 000 | 500 | 200 |
  |---|---|---|---|---|---|---|---|---|
  | A | 1,11 | 0,85 | 0,64 | 0,24 | 0,16 | 0,07 | 0,04 | 0,01 |
  | B | 1,10 | 0,99 | 0,82 | 0,37 | 0,20 | 0,13 | 0,08 | 0,03 |
  | A, sans calibration | 1,11 | 0,85 | 0,64 | 0,41 | 0,26 | 0,13 | 0,05 | 0,03 |

  C'est attendu : moins de candidats, des films moins sûrs.
- **La plus grande marche (10 000 → 5 000) n'est pas due au curseur.** Elle vient du passage de λ de 0,1 à 0,9 (§ 2) : sans calibration, la marche serait 0,64 → 0,41 au lieu de 0,64 → 0,24.
- **À 200, un petit profil n'a plus rien à dire.** Les 48 cartes de A sont « loin de tes goûts », et la note sous le curseur le dit déjà. B (491 films) garde 21 cartes sur 48 au-dessus du seuil.
- **Crans de gauche** : aucune variante de λ ne les touche. Seuls les films estimés (6 à 10 sur 48), le terme de qualité (1 à 3) et le bonus des classiques (4 à 8 à ∞) y changent quelque chose.

### Verdict : ne pas changer le curseur

- Le plafond cumulatif fait ce qu'on lui demande, et les crans de gauche restent tels quels. Les tranches de popularité ne sont pas étudiées (tu n'en veux pas).
- Ce qui se ressent comme une dégradation au milieu vient de la **calibration** (§ 2) et des **films estimés** (§ 5d). Les deux se corrigent sans toucher aux plafonds.
- **Confiance : bonne.**

---

## 7. Ce qui reste à juger à l'œil

Les mesures ne tranchent pas ce qui suit ; c'est à toi de le juger (URL au § 8).

1. **Cran 5 000 avec λ = 0,7** : la première rangée est-elle meilleure ? Elle a un peu plus d'animation sur A (3 films sur 8 au lieu de 2).
2. **Crans 2 000 à 200** : `?lambda=0.7` montre ce qu'on gagnerait en adoucissant (scores) et ce qu'on perdrait (animation). Ce document recommande de ne pas le faire ; à confirmer à l'œil.
3. **Les classiques à ∞** : *12 Angry Men* passe 1ᵉʳ (A) ou 2ᵉ (B). Est-ce trop haut, puisque c'est la calibration qui le fait sauter ? Les autres films qui entrent sont-ils de « vrais » classiques pour toi ?
4. **Le niveau du bonus** : γc 0,5 ou 1 au centile 99. Le second change 7 à 8 films à ∞ au lieu de 4 à 5.
5. **Ce que les interrupteurs ne montrent pas** (code à écrire après ton accord) : plafond de 1 film estimé par rangée, tampon interdit et explication masquée sur les films estimés, droite récente du q. `?recents=0` donne l'idée de la borne.
6. **Le texte du bas de page** : « les films récents sont placés d'après leur contenu : on les connaît moins bien. » Il est posé (ta formulation). La phrase de l'écran d'analyse (« N films sont sortis après 2023 : trop récents pour nous, désolé. ») n'a pas été touchée, comme demandé.

---

## 8. Interrupteurs dev et URL à comparer

**Mode dev uniquement.** Les interrupteurs sont lus dans l'URL au chargement de la page (`web/src/dev/devTuning.ts`), derrière `import.meta.env.DEV`. Ils sont **absents du build de production** : vérifié, aucune de leurs chaînes dans `dist/`. Quand au moins un interrupteur est actif, un bandeau en bas à droite de l'écran des résultats les liste (« dev : … »). Le moteur reçoit un objet `Tuning` ; sans lui, le calcul est celui de production, à l'identique (tests `tuning.test.ts`).

| interrupteur | effet |
|---|---|
| `?calibration=0` | pas de calibration des genres (vivier coupé à 48, dans l'ordre de `score'`) |
| `?lambda=0.7` | λ = 0,7 aux crans ≤ 5 000 ; ∞, 20 000 et 10 000 inchangés |
| `?lambda=0.1;0.1;0.1;0.7;0.9;0.9;0.9;0.9` | un λ par cran (∞ d'abord) |
| `?qualite=0` | sans terme de qualité (γ = 0) ; `?qualite=0.2` : γ = 0,2 |
| `?recents=0` | films estimés jamais recommandés (ils restent dans le profil) |
| `?recents=aucun` | films estimés ni recommandés ni dans le profil |
| `?classiques=0.5` | bonus des classiques, γc = 0,5, seuil au centile 98 ; `&centile=99` pour changer le seuil ; `&classiques_estimes=1` pour l'ouvrir aux films estimés |

Les interrupteurs se combinent. Mode d'emploi :
1. `cd web && npm run dev` ;
2. ouvrir l'URL ;
3. déposer l'export.

Rien n'est stocké : recharger une autre URL demande de redéposer l'export.

**URL à ouvrir pour comparer** (`http://localhost:5173/`, le port par défaut de Vite) :

1. Actuel : `http://localhost:5173/`
2. Ce qui a changé au milieu (§ 2) :
   - `http://localhost:5173/?calibration=0`
   - `http://localhost:5173/?lambda=0.7`
   - `http://localhost:5173/?lambda=0.5`
   - `http://localhost:5173/?lambda=0.3`
   - `http://localhost:5173/?qualite=0`
   - `http://localhost:5173/?recents=0`
   - `http://localhost:5173/?recents=aucun`
3. Table λ recommandée : `http://localhost:5173/?lambda=0.1;0.1;0.1;0.7;0.9;0.9;0.9;0.9`
4. Classiques (§ 4), à ∞ :
   - `http://localhost:5173/?classiques=0.5&centile=99`
   - `http://localhost:5173/?classiques=1&centile=99`
   - `http://localhost:5173/?classiques=0.5&centile=98`
   - `http://localhost:5173/?qualite=0.2`
   - `http://localhost:5173/?qualite=0.3`
   - `http://localhost:5173/?classiques=0.5&centile=98&classiques_estimes=1` (contrôle : estimés compris)
5. Combinaison recommandée, sur ce que les interrupteurs couvrent : `http://localhost:5173/?lambda=0.1;0.1;0.1;0.7;0.9;0.9;0.9;0.9&classiques=0.5&centile=99`

**Pas d'interrupteur** pour le plafond des films estimés par rangée, le tampon, les explications et la droite récente du q (§ 5). Ce sont des règles d'affichage ou des paramètres du pipeline. `?recents=0` montre la borne : aucun film estimé recommandé.

---

## 9. Reproduire

Pipeline (depuis `pipeline/`, résultats dans `data/processed/results/quality/`, ignoré) :

```sh
env -u UV_PROJECT_ENVIRONMENT uv run python tuning_analysis.py sweep      # validation, ~1 h 30 → tuning_val.json
env -u UV_PROJECT_ENVIRONMENT uv run python tuning_analysis.py tmdb-age   # note TMDB selon l'âge → tmdb_age.json
                                                                          # + web/test-data/estimated_q_alternatives.json
```

Site (depuis `web/`, comptes seulement, résultats dans `test-data/reports/tuning_<nom>.json`, ignoré) :

```sh
npx tsx scripts/tuning-report.ts test-data/exports/<export A> --name A
npx tsx scripts/tuning-report.ts test-data/exports/<export B>.zip --name B
```

Code ajouté pour l'analyse :
- `pipeline/tuning_analysis.py` ;
- `web/scripts/tuning-report.ts` ;
- `Tuning` dans `web/src/reco/engine.ts` (`tunedLambda`, `qualityPercentile`, bonus `ClassicsBonus` de `qualityPool`) ;
- interrupteurs `web/src/dev/` ;
- tests `web/src/reco/tuning.test.ts` (sans `Tuning`, le résultat est celui de production ; vivier exact avec le bonus).
