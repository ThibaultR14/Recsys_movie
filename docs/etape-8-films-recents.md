# Étape 8 — Films récents

> **⏸ Arrêt de R6 (12 novembre 2026) : essai à l'écran.** Site branché (films estimés dans les listes et le profil, cartes « ★ x,x · TMDB (estimé) », nouvelle popularité) ; parité, tests, Playwright, axe et temps verts ; emplacements de texte pour « comment ça marche » (section 5, R6).
> Version 0.5 (12 novembre 2026) : **facteur 0,8 sur la norme cible** (D1c ; rétrécissement d'une estimation incertaine) ; nouvelle popularité validée par Thibault.
> Version 0.4 (12 novembre 2026) : décisions de Thibault à l'arrêt de R3c : popularité par **rang absolu dans l'année, référence 2010-2018**, pour les films estimés et pour les films du catalogue sortis à partir de 2019 (`year_all` ✗ à partir de 2019) ; contrôles (a), (b), (c) ; ρ = 0 (R3b).
> Version 0.3 (12 novembre 2026) : **décisions de Thibault à l'arrêt de R3** : contenu seul (voisins TMDB et mélange ✗) ; norme cible par tranche de **popularité du curseur** (tranche de votes ✗) ; < 500 votes non recommandables, comptent dans le profil ; popularité référence 2019-2022, contrôle « aucun des 10 films les plus votés de chaque année sous 10 000 » ; ω = 1 ; ρ tranché par une mesure de plus (règle en D4) ; test de clôture contre la vraie direction recalée (D5).
> Version 0.2 (12 novembre 2026) : **validée par Thibault** avec ses réponses à la section 7 (périmètre 2022 → aujourd'hui, placés à ≥ 50 votes, recommandables à ≥ 100 ; `similar` écarté ; norme cible par tranche de votes TMDB ; fiches des 23 019 films ; seuil de D5 par tranche de votes, tranche < 500 non recommandable si elle échoue ; popularité calée sur les films 2019-2022 du catalogue ; ω mesuré sur la validation ; étape avant la mise en ligne). Version 0.1 (12 novembre 2026) : diagnostic R0 (section 2), décisions proposées.
> Point de départ : les pistes retenues avec Claude Web (D1-D8) et le trou accepté au MVP (« films sortis après 2023 : trop récents pour nous »). Étape insérée après l'étape 6c, avant la mise en ligne (étape 7) ; le nom du fichier suit la demande de Thibault.

---

## 0. Mode d'emploi (pour Claude Code)

- Relis ce document au début de chaque sous-étape. Les décisions de la section 3 ne changent pas sans accord.
- Une sous-étape à la fois (R1 → R7), en suivant « Quand s'arrêter » de `CLAUDE.md`. **Arrêts obligatoires** : fin de **R3** (faux départ à froid : seuil atteint ou non, choix des ingrédients et des forces), fin de **R6** (essai à l'écran), **R7** (relecture).
- **Protocole de l'étape 2** : tous les réglages (k, κ, force de la qualité, poids dans le fold-in, popularité) se font sur la **validation** ; le **test** n'est évalué **qu'une fois**, à la clôture.
- **Un seul moteur** : tout ce qui change les listes a une référence Python et des cas partagés que le TypeScript rejoue à l'identique (listes) et à 10⁻⁹ près (vecteurs).
- **Licences** : tout ce qui est embarqué vient de **TMDB** (ou de MovieLens) ; aucune donnée des datasets IMDb. L'`imdb_id` des films récents vient de l'API TMDB (champ `imdb_id`), pas des datasets IMDb.
- **Données personnelles** (inchangé) : sur les exports réels, comptes et parts seulement dans les fichiers versionnés ; titres dans le terminal uniquement ; ni pseudo ni titre d'un export.

---

## 1. Objectifs

1. **Recommander** des films absents de MovieLens 32M parce que trop récents, en leur donnant un vecteur dans l'espace ALS, calculé **hors ligne** (pipeline).
2. **Faire compter** ces films quand ils sont dans l'historique de l'utilisateur (fold-in) et ne plus les déclarer « trop récents ».
3. **Rester honnête** : un film placé par estimation est signalé comme tel ; si l'estimation n'est pas assez bonne (seuil fixé à l'avance, D5), on ne l'affiche pas, ou seulement dans une rangée à part.
4. Garder ce qui marche : listes et qualité des films du catalogue inchangées, parité Python / TypeScript, temps du navigateur, aucun appel réseau nouveau, ~3 Mo gzip à peu près tenus.

---

## 2. Diagnostic R0 (12 novembre 2026, chiffres seulement)

Script : `pipeline/recent_films_diagnostics.py` (`discover`, `fetch`, `stats`, `preview`, `exports`). Appels TMDB par le client de `enrich_tmdb.py` (20 requêtes/s, moitié de la limite documentée), réponses réduites en cache dans `pipeline/data/cache/tmdb/{discover,recent}/` (ignoré, règle des 6 mois), résultats dans `pipeline/data/processed/results/recent/` (ignoré). Fin de MovieLens 32M : 12 octobre 2023, donc « récent » = sortie (date de première sortie TMDB) **à partir du 13 octobre 2023**.

### 2.1 Volume et coût (point 1)

Films TMDB (`/discover/movie`, `primary_release_date` ≥ 13/10/2023, sans contenu adulte ni vidéo ; les séries ne sont pas des `movie`) :

| Votes TMDB | Tous | Sans documentaires | Sans documentaires ni téléfilms | Déjà au catalogue |
|---|---|---|---|---|
| ≥ 50 | 2 438 | 2 307 | 2 274 | 1 |
| ≥ 100 | 1 533 | 1 486 | 1 469 | 1 |
| ≥ 200 | 915 | 905 | 897 | 0 |
| ≥ 500 | 480 | 480 | 480 | 0 |

- Par année (≥ 50 votes) : 2023 (après le 13/10) 262 · 2024 957 · 2025 789 · 2026 (au 12/11) 430. Les films de 2026 ont encore peu de votes : leur nombre montera.
- **Le trou commence avant le 13 octobre 2023.** Films 2022 et 2023 sortis **avant** la fin de MovieLens, ≥ 50 votes TMDB, **absents du catalogue** (moins de 20 notes MovieLens) : **878** de 2022 (dont 470 ≥ 100 votes) et **711** de 2023 (dont 410 ≥ 100 votes), sur 1 200 et 847.
- **Coût** : `discover` de janvier 2022 à aujourd'hui par fenêtres mensuelles = **253 appels, 34 s** (aucune fenêtre au plafond de 500 pages). Une fiche par film (`/movie/{id}?append_to_response=credits,keywords,recommendations,similar`, **un seul appel**) : **4 490 appels en 225 s** (films récents, films 2022-2023 absents, base 2022-2023 du catalogue), 0 erreur, 0 nouvel essai. Le tout tient en **~5 minutes**.
- Pour D2 (contenu appris sur les films connus), il faudra la même fiche pour les **23 019 films du catalogue** (le cache actuel n'a ni genres TMDB, ni mots-clés, ni acteurs) : ~23 000 appels, **~20 minutes**, une fois.

### 2.2 Voisins TMDB des films récents (point 2)

Films récents absents du catalogue, sans documentaires, **≥ 50 votes : 2 306**. Pour chacun, la première page (20 films) de `recommendations` et de `similar`. Modes : **catalogue** = voisins dans les 23 019 films ; **chronologique** = plus les films récents sortis **avant** lui (placés avant lui) ; **tous** = plus tous les films récents (borne haute).

| Voisins | Mode | Médiane | ≥ 3 | ≥ 5 | ≥ 10 |
|---|---|---|---|---|---|
| recommendations | catalogue | 11 | 98,8 % | 94,5 % | 67,5 % |
| recommendations | chronologique | 13 | 99,2 % | 97,6 % | 77,8 % |
| recommendations | tous | 15 | 99,7 % | 99,0 % | 90,1 % |
| similar | catalogue | 10 | 82,8 % | 78,8 % | 56,9 % |
| union | catalogue | 22 | 99,5 % | 97,5 % | 87,1 % |
| union | chronologique | 24 | 99,8 % | 98,9 % | 90,0 % |

- Plus le film est voté, plus il a de voisins au catalogue : `recommendations`, ≥ 5 voisins au catalogue : 94,5 % (≥ 50 votes), 96,0 % (≥ 100), 97,7 % (≥ 200), 98,8 % (≥ 500).
- Aucun film récent n'a une liste `recommendations` vide ; `similar` est vide pour 15 % des films à ≥ 50 votes.
- D'où viennent les `recommendations` d'un film récent : **55,6 % du catalogue**, 15,7 % d'autres films récents placés, 28,7 % d'ailleurs (films sous 50 votes, séries…).
- Films 2022 → 12/10/2023 absents du catalogue (1 499, ≥ 50 votes, sans documentaires) : `recommendations` ≥ 5 voisins au catalogue 91,7 %, chronologique 95,3 %.
- Contenu disponible (films récents) : réalisateur 100 %, acteurs 99,8 %, résumé 99,7 %, affiche 100 %, `imdb_id` 99,9 %, **mots-clés 84,4 %**.

### 2.3 Base du faux départ à froid : films 2022-2023 du catalogue (point 3)

**463 films** 2022-2023 du catalogue ; voisins « catalogue » = films du catalogue **sortis avant 2022** ; « chronologique » = plus les autres films 2022-2023 sortis avant.

| Voisins | Mode | Médiane | ≥ 3 | ≥ 5 | ≥ 10 |
|---|---|---|---|---|---|
| recommendations | catalogue | 12 | 100 % | 99,1 % | 85,3 % |
| recommendations | chronologique | 13 | 100 % | 99,4 % | 86,8 % |
| similar | catalogue | 11 | 93,5 % | 87,9 % | 67,0 % |
| union | catalogue | 24 | 100 % | 99,8 % | 97,4 % |

- **La base est plus connue que les films à placer** : votes TMDB médians **812** (base) contre **145** (films récents à ≥ 50 votes) ; 301 films de la base sur 463 ont ≥ 500 votes. Le faux départ à froid sera donc **optimiste** : il faut le stratifier par nombre de votes.
- Les `recommendations` des films de la base : 61,6 % au catalogue avant 2022, 3,8 % parmi les 2022-2023, 13,1 % films récents (TMDB les calcule aujourd'hui).

**Aperçu de D1** (pas l'évaluation D5 : modèle final, vecteurs float32, `pipeline/recent_films_diagnostics.py preview`). Vecteur estimé = moyenne des vecteurs des voisins au catalogue avant 2022, comparée au vrai vecteur ALS du film. « Centré » = après soustraction du vecteur moyen des films (sinon tout vecteur ressemble à la moyenne : le hasard fait déjà 0,37).

| Voisins | k | Poids | Cosinus | Cosinus centré | Hasard (centré) | Norme estimée / vraie |
|---|---|---|---|---|---|---|
| recommendations | 5 | rang (1/r) | 0,473 | **0,149** | 0,022 | **3,99** |
| recommendations | 10 | rang | 0,479 | 0,131 | 0,003 | 3,90 |
| recommendations | 40 | rang | 0,483 | 0,117 | 0,012 | 3,93 |
| similar | 5 | rang | 0,163 | **−0,165** | 0,004 | 9,09 |
| union | 10 | rang | 0,470 | 0,121 | 0,016 | 4,16 |
| union | 40 | égal | 0,374 | −0,126 | −0,005 | 4,56 |

Par nombre de notes MovieLens du film (recommendations, k = 5, poids au rang) : cosinus centré **0,068** (20-99 notes, 295 films), **0,229** (100-499, 128 films), **0,289** (≥ 500, 40 films).

- **`similar` est pire que le hasard** une fois centré (voisins par genres et mots-clés, souvent obscurs) : il ne sert pas pour D1.
- **`recommendations` porte un vrai signal**, faible, meilleur avec peu de voisins (k = 5) et un poids au rang.
- **La norme est fausse d'un facteur 4** : les vrais vecteurs des films 2022-2023 sont petits (norme médiane 0,020, contre 0,034 avant 2022 : peu de notes, forte régularisation), la moyenne de voisins connus est grande. Or le score est un produit scalaire : **sans recalage de la norme, les films estimés écraseraient les listes.**
- **Le vrai vecteur est lui-même bruité** pour les films peu notés (64 % de la base a moins de 100 notes MovieLens) : le cosinus avec le vrai vecteur sous-estime la qualité pour ces films. L'évaluation D5 doit porter sur les **classements des utilisateurs**, pas seulement sur les vecteurs.

### 2.4 Popularité et crans du curseur

Avec la formule actuelle, un film sans notes MovieLens a pour popularité `arrondi(0,285 × votes TMDB)`. Part des films absents du catalogue (2022 → aujourd'hui, ≥ 50 votes, sans documentaires, 3 805 films) sous chaque plafond :

| Films | ≤ 20 000 | ≤ 5 000 | ≤ 2 000 | ≤ 1 000 | ≤ 500 | ≤ 200 |
|---|---|---|---|---|---|---|
| sortis en 2024 (910) | 100 % | 100 % | 100 % | 98 % | 94 % | **85 %** |
| sortis en 2026 (404) | 100 % | 100 % | 100 % | 98 % | 92 % | **80 %** |
| tous (3 805) | 100 % | 100 % | 100 % | 99 % | 96 % | **89 %** |
| catalogue actuel (`popularity.bin`, 23 019) | 99 % | 93 % | 87 % | 80 % | 71 % | 55 % |

- Votes TMDB des films absents : médiane 127, 90ᵉ centile 776, maximum 9 825. Les votes d'un film sorti il y a 2 mois sont encore en train de monter.
- **Lecture** : avec `0,285 × votes`, presque **tous les films récents passeraient pour des pépites**, y compris les gros succès de l'année. La popularité des films récents demande sa propre correction (D7), comme `year_all` pour les films 2015-2023.

### 2.5 Exports réels (point 4, comptes seulement)

Rapports `match-report` (dans `web/test-data/reports/`, ignoré). « Retrouvés » = rapprochés (titre normalisé v2 + année ± 1, ou `imdb_id` pour l'IMDb) d'un film TMDB à ≥ 50 votes absent du catalogue.

| Export | Entrées | Reconnus | Non trouvés | dont « trop récents » (≥ 2024) | retrouvés | dont 2022-2023 | retrouvés |
|---|---|---|---|---|---|---|---|
| Letterboxd A | 225 | 188 | 35 | **25** | 23 | 9 | 7 |
| Letterboxd B | 511 | 380 | 130 | **95** | 88 | 27 | 25 |
| IMDb (fabriqué) | 42 | 35 | 3 | 3 | 3 | 0 | 0 |

- Si tous les films retrouvés étaient placés : **+30 films** dans l'historique de A (188 → 218, +16 %) et **+113** dans celui de B (380 → 493, +30 %). Les films de 2022-2023 non trouvés aujourd'hui (dans « pas dans notre catalogue ») sont presque tous de vrais films TMDB : 22 des 32 retrouvés sont sortis après le 13/10/2023 (année Letterboxd 2023, sortie en salles plus tard), 10 avant.
- Votes TMDB médians des films retrouvés : 2 185 à 4 004 (minimum 51 à 513) : les cinéphiles voient surtout les films récents connus ; un seuil de 50 votes suffit pour l'historique.

### 2.6 Ce qu'on retient du diagnostic

1. **Le volume est petit et pas cher** : ~2 300 films après le 13/10/2023 et ~1 500 de 2022-2023 absents, à ≥ 50 votes ; ~5 minutes d'appels TMDB par passage.
2. **Les voisins existent** : `recommendations` en donne ≥ 5 au catalogue pour 94-99 % des films. Le placement chronologique gagne 2-3 points ; la propagation d'erreur restera limitée (16 % des voisins sont des films récents).
3. **Mais la moyenne brute de voisins est un vecteur médiocre** (cosinus centré 0,15, norme × 4) : il faut **recaler la norme** et **apprendre la combinaison** (D1, D3), et juger sur les classements (D5).
4. **`similar` ne sert pas au placement** ; il pourra servir de signal de contenu (D2) si la mesure le dit.
5. **Le périmètre doit inclure les films 2022-2023 absents** (même trou, même méthode).
6. **La popularité des films récents est à corriger** avant tout affichage aux crans bas (D7).

---

## 3. Décisions proposées

### D0. Périmètre (nouveau)

- Films TMDB **absents du catalogue**, sortis **depuis le 1ᵉʳ janvier 2022** (première sortie TMDB), **≥ 50 votes TMDB** : ~3 800 films aujourd'hui. Ils sont **placés** (vecteur estimé) : ils comptent dans le fold-in quand ils sont dans l'historique et sont « vus » (jamais recommandés à qui les a vus).
- **Recommandables** seulement s'ils ont **≥ 500 votes** (v0.3 : la tranche < 500 a échoué en R3 ; 563 films aujourd'hui, dont 480 sortis après le 13/10/2023 ; ancien seuil v0.2 : 100 votes). **Placés mais non recommandables** (50-499 votes, v0.3) : ils **comptent dans le profil** (fold-in) et sont « vus », jamais proposés (v0.2). Documentaires : gardés, avec la mention et le filtre qui existent ; téléfilms (genre TMDB 10770, 33 films) : gardés comme les autres films.
- Pas de dataset IMDb ; pas de film adulte ; mêmes exclusions manuelles (`manual_overrides.csv` : `exclude` accepte aussi un `tmdb_id` récent, colonne à préciser en R1).

### D1. ✗ Voisins TMDB dans le catalogue (abandonné en v0.3)

- Mesuré en R3 : moyenne des `recommendations` TMDB placées (k = 5, poids `1/r`, chronologique, γ = 0,5) : Recall@20 base 0,043, **pas mieux que la popularité** (+0,007 ± 0,020), chronologie sans effet ; le mélange avec le contenu le **dégrade** (κ = 3 : 0,081 contre 0,129). Décision de Thibault (v0.3) : **abandonné**. Le code reste dans `models/coldstart.py` (`place`, `use_neighbours`) pour la mesure, il n'est pas utilisé par l'export ; le rafraîchissement mensuel n'a plus besoin des `recommendations`.
- `similar` : écarté dès v0.2 (pire que le hasard une fois centré, 2.3).

### D1c. Norme cible (v0.3)

- L'estimation est ramenée à **0,8 × la norme médiane des films du catalogue de la même tranche de popularité du curseur** (v0.5 : facteur 0,8, rétrécissement d'une estimation incertaine : les vecteurs prédits par le contenu pointent vers la direction moyenne, à norme pleine ils envahissent les listes ; réglé sur la validation, R3d ; vérifié une fois sur le test à la clôture) (tranches aux plafonds : < 200, 200-499, 500-999, 1 000-1 999, 2 000-4 999, 5 000-9 999, 10 000-19 999, ≥ 20 000 ; une tranche de moins de 30 films prend la voisine). La popularité est celle de D7. Table dans `model-meta.json`.
- ✗ **Norme par tranche de votes TMDB** (v0.2) : en R3, les films estimés prenaient 40 % des top 20 au cran 2 000 et 55 % à 500 (2 % du catalogue), NDCG@20 −25 % à ces crans ; avec la popularité du curseur : 10 % et 18 %, NDCG@20 à 96-99 % du vrai.

### D2. Contenu TMDB → vecteur ALS

- Caractéristiques : réalisateurs, 5 premiers acteurs, genres TMDB, mots-clés, langue originale, pays d'origine, décennie, `log(1 + votes)`, note TMDB (moyenne bayésienne, D4) ; indicatrices creuses, une valeur gardée si elle apparaît dans ≥ 3 films d'apprentissage.
- **Régression ridge** des vecteurs ALS centrés (64 sorties) sur ces caractéristiques, apprise sur les films du catalogue (pondérés par leur nombre de notes MovieLens, les vecteurs des films peu notés étant bruités, 2.3) ; régularisation réglée par validation croisée sur les films connus.
- Demande la fiche TMDB des 23 019 films du catalogue (~20 min, une fois, R1).
- **Embedding du résumé** : en option, seulement si D2 sans résumé reste sous le seuil (R3) ; modèle de texte hors ligne, rien d'embarqué que le vecteur final. Non nécessaire : le contenu sans résumé passe le seuil.
- **Retenu seul en v0.3** : `ŷ = μ + ŷ_contenu`, puis norme D1c. λ = 100 (validation croisée en R3 ; réappris sur tout le catalogue pour l'export).

### D3. Placement (v0.3 ; mélange ✗)

- ✗ Mélange voisins / contenu : abandonné avec D1.
- **Non placé** sans contenu parlant (moins de 2 éléments connus du modèle parmi réalisateurs, acteurs, mots-clés ; 8 films sur 4 026) : le film reste « trop récent » à l'écran d'analyse.
- **Non recommandable** (mais placé, pour le fold-in) sous 500 votes (D0).

### D4. Qualité

- Note TMDB en **moyenne bayésienne** : `R̃ = (v × R + m × C) / (v + m)`, `C` = note moyenne des films placés, `m` = 200 votes (à régler).
- **Pénalité douce, jamais un filtre** : pour les films estimés seulement, `score' = score − ρ × max(0, C − R̃) × s_ref` (`s_ref` = meilleur score du vivier du cran, comme la forme mesurée de D1b à l'étape 6c). La note TMDB est celle du grand public, pas des critiques : ρ petit, réglé en R3 ; ρ = 0 si la mesure ne montre rien.
- **Règle de décision (v0.3, Thibault)** : mesure de plus sur la validation (contenu, norme D1c, ω = 1) : part du top 20 occupée par des **films de la base que l'utilisateur a vus et mal notés** (held-out, note sous la médiane de son fold-in), à ρ = 0 / 0,05 / 0,1. Si ρ la fait baisser **nettement (hors IC)** sans perte de Recall@20 (films bien notés) au-delà de l'IC → **ρ = 0,05** ; sinon **ρ = 0** (la note TMDB affichée sur la carte suffit). Décision prise par Claude Code selon cette règle (section 5, R3b).
- Les films du catalogue ne sont pas pénalisés (l'ALS porte déjà le jugement des spectateurs MovieLens).

### D5. Évaluation : faux départ à froid sur les films 2022-2023

- **Modèle** : ALS d'entraînement de l'étape 2 (utilisateurs d'entraînement seulement, `als_f64_r0.05_a1_b1_i30`), pas le modèle final.
- **Simulation** : les 463 films 2022-2023 du catalogue perdent leur vecteur ; régression D2 apprise **sans eux** ; placement D1 avec les voisins **avant 2022** et les autres films 2022-2023 placés dans l'ordre chronologique (comme des films récents).
- **Mesures** sur les **utilisateurs de validation** dont le held-out contient un film de la base :
  1. **Rang du film** dans les candidats de l'utilisateur, avec le vecteur estimé et avec le vrai vecteur (rang centile médian, Recall@20 et NDCG@20 restreints aux films de la base **bien notés**, pertinence de l'étape 2).
  2. **Références** : vrai vecteur (plafond), **classement des films de la base par popularité** (plancher), hasard.
  3. **Apport de chaque ingrédient** : voisins seuls, contenu seul, mélange, ± chronologique, ± norme recalée, ± qualité (D4).
  4. **Stratification** : votes TMDB (< 500 et ≥ 500, la base étant plus connue que les films récents, 2.3) et notes MovieLens (< 100, ≥ 100).
  5. **Effet sur les autres films** : NDCG@20 des listes complètes à ∞, 2 000 et 500 avec les films de la base estimés, comparé à leurs vrais vecteurs (les films estimés ne doivent ni envahir ni disparaître : part des films de la base dans les top 20, estimé contre vrai).
- **Seuil, fixé avant de mesurer** : sur la validation, Recall@20 **sur les films de la base bien notés seulement** (pertinence de l'étape 2 : note ≥ médiane du fold-in) avec vecteurs estimés **≥ 70 % de celui des vrais vecteurs**, et **meilleur que la popularité** hors de l'intervalle de confiance (différence appariée par utilisateur), sur l'ensemble **et par tranche de votes TMDB** (< 500, ≥ 500 ; la base est plus connue que les vrais films récents).
- **Si la tranche < 500 votes rate le seuil** (v0.2) : les films estimés de moins de 500 votes sont **non recommandables mais comptent dans le profil** ; la tranche ≥ 500 suit sa propre mesure.
- Si le seuil est atteint : les films récents entrent dans les listes normales, avec « (estimé) » sur la carte. Sinon : **rangée « sorties récentes (estimé) » seulement** si le classement bat la popularité, **rien** sinon ; dans les deux cas, ils comptent dans le fold-in si D6 le justifie.
- **Test** : une seule fois, à la clôture (R7), sur la configuration retenue.
- **Critères du test de clôture (v0.3)** : Recall@20 (films de la base bien notés) **≥ 70 % de la vraie direction avec la norme recalée** (D1c) ; **meilleur que la popularité** hors IC (différence appariée) ; **part des films estimés dans le top 20 ≤ 20 %** aux crans 2 000 et 500. (✗ « ≥ 70 % du vrai vecteur » : dégénéré, le vrai vecteur de ces films n'est presque jamais recommandé, R3.)

### D6. Moteur

- **`YᵀY` reste celui des films entraînés** (23 019) : il représente la « négative implicite » d'ALS ; parité inchangée. La variante « `YᵀY` + films estimés » est mesurée en R3 (validation), pour information.
- **Poids des films estimés dans le fold-in** : confiance `c = 1 + ω × (c_normal − 1)`, **ω = 1 (v0.3)**, le fold-in habituel (ω ∈ {0 ; 0,5 ; 1} mesuré en R3 sur la **validation** : aucune différence mesurable (v0.2 : les films 2022-2023 notés par les utilisateurs de validation sont mis dans leur fold-in **avec leur vecteur estimé**, NDCG@20 de la liste complète comparé aux vrais vecteurs)). Règle de D2 de l'étape 6c (percentile < 0,3 retiré) appliquée comme aux autres films.
- **`item_idx`** : les films estimés sont **ajoutés après** les films entraînés (`item_idx` ≥ 23 019), dans l'ordre du placement ; l'ordre des films entraînés ne change pas (règle de `CLAUDE.md`). `model-meta.json` donne `n_trained` (taille de `YᵀY`) et `n_items`.
- Exclusions, calibration, explications, tags : inchangés et appliqués aux films estimés (voir D7). Cas partagés : `foldin_cases.json` régénéré hors du dépôt avec des historiques qui contiennent des films estimés ; rejeu à l'identique.

### D7. Site

- **Popularité du curseur** des films estimés : **pas `0,285 × votes` tel quel** (2.4 : 89 % sous le plafond 200). **v0.4 : rang absolu dans l'année, référence 2010-2018, à partir de 2019, catalogue compris** (`popularity.py`, `rank_corrected` ; détails en section 5, R3d ; ✗ centile v0.2-v0.3 ci-après). Ancienne règle : **correspondance par rang dans l'année** (v0.2) : un film au centile c des votes TMDB parmi les films TMDB de son année de sortie (≥ 50 votes) reçoit la popularité au centile c de la **distribution de référence des films 2019-2022** (même univers : films TMDB ≥ 50 votes de ces années ; popularité `popularity.bin` pour ceux du catalogue, `0,285 × votes` pour les autres) ; jamais moins que `0,285 × votes`. **Contrôle (v0.3)** : **aucun des 10 films les plus votés de chaque année sous 10 000** (un succès doit disparaître au cran 10 000, pas forcément à 20 000 ; ✗ contrôle v0.2 « au-dessus de 20 000 », intenable avec cette référence). S'il échoue : arrêt. Table dans `model-meta.json`. Dans le faux départ à froid, la référence est 2018-2021 (sans la base).
- **Carte** : « ★ x,x · TMDB » (note TMDB ramenée sur 5, une décimale, au lieu de la moyenne MovieLens) et **« (estimé) »** ; lien Letterboxd par `tmdb_id` (inchangé) ; tag « encore un <réalisateur> » (réalisateurs TMDB, même calcul) et tampon « ✱ pépite » (popularité D7) **s'appliquent** ; **pas** « ça divise » (pas de notes individuelles) ; « vieux trésor » sans objet (récents par définition) ; « parce que t'as aimé X et Y » permis (cosinus des vecteurs estimés), à vérifier en R6.
- **Rangée « sorties récentes »** : non (v0.3) : le contenu passe le seuil de D5, les films estimés sont mêlés aux autres.
- **Calibration des genres** : genres TMDB des films estimés traduits en genres MovieLens (Action, Adventure, Animation, Comedy, Crime, Documentary, Drama, Fantasy, Horror, Mystery, Romance, Thriller, War, Western : même nom ; Science Fiction → Sci-Fi ; Family → Children ; Music → Musical ; History et TV Movie → aucun). Correspondance vérifiée en R1 sur les films du catalogue (accord par genre, rapporté).
- **Écran d'analyse** : les films placés sont reconnus (statut `exact`) ; « trop récents » ne garde que les films non placés (et la phrase dit pourquoi : « trop récents ou trop peu vus pour nous ») ; texte de Claude Web.
- **Index des titres** : titres TMDB (titre, titre original) des films placés, même normalisation v2 ; `imdb_id` TMDB pour l'import IMDb.
- **« comment ça marche »** : une section sur les films récents estimés (texte de Claude Web).
- **Taille** (estimée pour ~3 800 films placés, à mesurer en R4) : `catalog.json` +~200 Ko gzip (52 o/film aujourd'hui), `title-index.json` +~60 Ko, `embeddings.bin` +~260 Ko brut (68 o/film), `popularity.bin` +15 Ko : **~+0,5 Mo gzip** (3,06 → ~3,6 Mo). À ≥ 100 votes pour tout (~2 400 films) : ~+0,3 Mo.

### D8. Rafraîchissement

- Le rafraîchissement TMDB mensuel de l'étape 7 (GitHub Actions) lance aussi `discover` depuis le dernier passage, les fiches des nouveaux films et la mise à jour des votes des films placés (~5 min d'appels).
- **La régression D2 et les réglages (λ, norme, ρ, popularité) sont figés** (appris une fois, sauvegardés) ; seuls les votes, les fiches et la liste des films changent. Plus besoin des `recommendations` TMDB (v0.3). Placement recalculé en entier à chaque passage (déterministe).
- Les vecteurs estimés peuvent changer d'un mois à l'autre ; rien n'est stocké chez l'utilisateur, donc aucune migration. Cas partagés régénérés à chaque passage.
- Cache TMDB : 30 jours de réutilisation, 6 mois au plus (inchangé).

---

## 4. Sous-étapes

### R0 — Diagnostic (fait, section 2)

### R1 — Collecte TMDB (pipeline)

- Fiches complètes des films récents et des 23 019 films du catalogue (genres TMDB, mots-clés, acteurs, `recommendations`) ; module `pipeline/recent_films.py` (ou extension d'`enrich_tmdb.py`), table `recent_films.parquet` dans `data/processed/` ; accord genres TMDB → MovieLens rapporté ; tests sur fixtures synthétiques.

### R2 — Estimation (pipeline, Python)

- Voisins (D1, chronologique, γ), contenu (D2), mélange (D3), norme (D1c), qualité (D4) ; fonctions pures testées.

### R3 — Faux départ à froid (validation) — **arrêt**

- D5 complet (mesures 1-5, stratifiées), ω et `YᵀY` (D6), popularité (D7), seuils (votes, confiance) ; **arrêt** : Thibault décide (listes normales, rangée à part ou rien ; ingrédients ; forces).

### R4 — Export

- `embeddings.bin` (films estimés ajoutés), `popularity.bin`, `model-meta.json` (`n_trained`, table de popularité, ρ, ω), `catalog.json` (v3 : source de la note, `estimated`, genres traduits), `title-index.json` ; `foldin_cases.json` avec des films estimés ; `export.py verify` ; tailles.

### R5 — Moteur (TypeScript)

- Lecture des fichiers (`n_trained`), fold-in (ω), pénalité D4, exclusions ; parité (listes identiques, vecteurs à 10⁻⁹) ; `reco-bench`, `reco-report` sur les deux exports Letterboxd (comptes dans les fichiers, titres au terminal).

### R6 — Interface — **arrêt** (essai à l'écran)

- Carte (« ★ x,x · TMDB », « (estimé) »), rangée éventuelle, écran d'analyse, « comment ça marche » (textes de Claude Web) ; Playwright (réseau, stockage, axe, temps).

### R7 — Clôture — **arrêt**

- Test une seule fois ; section 5 ; `CLAUDE.md`, `docs/stack-technique.md`, `contexte/` ; relecture.

### Critères de réussite

| Critère | Seuil |
|---|---|
| Faux départ à froid (validation) | D5 : Recall@20 (films de la base bien notés) estimé ≥ 70 % du vrai, meilleur que la popularité hors IC, sur l'ensemble et sous 500 votes ; sinon rangée à part ou rien (décision R3) |
| Films du catalogue | NDCG@20 à ∞ des listes complètes (validation) ≥ 97 % de l'actuel avec les films estimés ajoutés |
| Popularité | part des films estimés sous chaque plafond proche de celle des films du catalogue de même âge (à préciser en R3) ; aucun film du catalogue changé |
| Exports | sur les deux exports Letterboxd, ≥ 90 % des films « trop récents » retrouvés deviennent reconnus |
| Moteur | `foldin_cases.json` régénéré hors du dépôt et rejoué : listes identiques, vecteurs à 10⁻⁹ près |
| Temps | `recommend` ≤ +20 ms pour 3 000 films ; changement de cran ≤ 50 ms (médiane) |
| Taille | `web/public/data/` ≤ 3,8 Mo gzip |
| Licences | rien d'IMDb dans `web/public/data/` (garde-fou `FORBIDDEN_WEB_PREFIXES`) ; mentions TMDB inchangées |
| Qualité du code | `pytest`, `ruff`, `npm test`, `typecheck`, `lint`, `format:check`, `build`, `e2e` verts |
| Confidentialité | aucun titre ni pseudo d'un export dans un fichier versionné |

---

## 5. Résultats

### R0 — Diagnostic (12 novembre 2026)

Chiffres en section 2. Script `pipeline/recent_films_diagnostics.py` ; 4 743 appels TMDB au total (253 `discover`, 4 490 fiches), ~4 min 20 s, 0 erreur. Rapports de correspondance des exports régénérés dans `web/test-data/reports/` (ignoré).

### R1 — Collecte TMDB (12 novembre 2026)

`pipeline/recent_films.py` (`collect`, `table`, `popularity`), tests `tests/test_recent_films.py`.
- `/discover/movie` de janvier 2010 à aujourd'hui (≥ 50 votes) : **18 933 films** ; une fiche complète (`credits`, `keywords`, `recommendations`, `similar`) par film du catalogue et par film absent depuis 2022 : **27 036 fiches demandées, 38 absentes** (404). Au total **23 337 appels HTTP** (22 824 pour la collecte, 513 pour prolonger `discover` jusqu'en 2010), ~22 min, 0 nouvel essai.
- Table `pipeline/data/processed/tmdb_films.parquet` (non versionnée) : **26 998 fiches**, dont 22 972 films du catalogue (sur 23 019) et **4 026 films absents depuis 2022** (2 412 à ≥ 100 votes, 563 à ≥ 500 ; 2 437 sortis à partir du 13/10/2023). Fiches gardées dans `pipeline/data/` (cache des 6 mois).
- **Genres TMDB → MovieLens** (D7), accord sur les films du catalogue (précision / rappel de la traduction) : Animation 97 / 98 %, Documentary 95 / 96 %, Comedy 86 / 93 %, Western 87 / 93 %, Horror 84 / 93 %, Drama 83 / 87 %, Sci-Fi 79 / 88 %, Action 76 / 81 %, War 75 / 75 %, Thriller 69 / 78 %, Children 66 / 88 %, Adventure 65 / 76 %, Crime 62 / 80 %, Romance 62 / 80 %, Fantasy 60 / 77 %, Mystery 49 / 66 %, **Musical 38 / 56 %** ; Film-Noir et IMAX n'existent pas dans TMDB. Assez bon pour la calibration (les genres qui pèsent sont au-dessus de 75 %) ; Musical est flou des deux côtés.

### R2 — Estimation (12 novembre 2026)

`pipeline/models/coldstart.py`, fonctions pures, tests `tests/test_coldstart.py` (12 tests) :
- norme cible par tranche (D1c : votes TMDB, ou popularité du curseur pour la comparaison de R3), tranche de moins de 30 films → la voisine ;
- placement chronologique (D1 : k premiers voisins placés, poids `1/r`, voisin estimé × γ, profondeur suivie) ;
- contenu (D2 : réalisateurs, 5 premiers acteurs, genres, mots-clés, langue, pays, décennie, tranche de votes, tranche de note bayésienne ; ridge par `lsqr`) ;
- mélange (D3) et règle « non placé » ;
- note bayésienne (D4) ;
- fold-in pondéré par ω (D6 ; ω = 1 rejoue `als.fold_in`, ω = 0 retire le film : testés) ;
- popularité par rang dans l'année (D7).

### R3 — Faux départ à froid (12 novembre 2026, validation) — ⏸ arrêt

`pipeline/recent_eval.py` (`retrain`, `run`) ; résultats dans `pipeline/data/processed/results/recent/coldstart_val.json` (ignoré).

**Protocole**
- ALS (configuration A, même graine) **réentraîné sur les utilisateurs d'entraînement sans les notes des 463 films 2022-2023** (77 361 notes retirées, 171 s) : ni `YᵀY` ni les autres vecteurs ne les connaissent. C'est un vrai départ à froid.
- Contenu appris sur les autres films du catalogue, pondérés par `min(1, notes MovieLens / 200)`. λ par validation croisée en 3 plis (cosinus centré moyen pondéré) : 0,51 (10), 0,55 (30), **0,57 (100, retenu)**, puis moins ; 21 653 caractéristiques.
- 10 000 utilisateurs de validation, fold-in de l'étape 6c (percentile < 0,3 retiré, 5 films au moins). Seuls **306 utilisateurs** ont un film de la base bien noté dans leur held-out (1 879 couples utilisateur × film). **Tranche < 500 votes : 62 utilisateurs, 115 couples seulement.**
- Popularité des films estimés (crans) : D7, référence 2018-2021. Popularité des autres films : `year_all` sur les comptes d'entraînement.

**Résultats principaux** (Recall@20 sur les films de la base bien notés ; rang centile = place moyenne du film parmi les candidats, 1 = premier ; part de la base dans le top 20, alors que la base fait 2 % du catalogue)

| Variante | Recall@20 base | ≥ 500 votes | rang centile (tout / < 500 votes) | NDCG@20 ∞ / 2 000 / 500 | part de la base dans le top 20 (∞ / 2 000 / 500) |
|---|---|---|---|---|---|
| vrai vecteur | 0,0008 ± 0,0010 | 0,0008 | 0,813 / 0,596 | **0,1635** / 0,0252 / 0,0070 | 0,0 / 0,1 / 0,0 % |
| vraie direction, norme votes (D1c) | 0,0532 ± 0,0176 | 0,0548 | 0,878 / 0,729 | 0,1637 / 0,0251 / 0,0070 | 0,3 / 6,6 / 18,4 % |
| vraie direction, norme popularité | 0,0317 ± 0,0144 | 0,0326 | 0,842 / 0,645 | 0,1638 / 0,0252 / 0,0071 | 0,2 / 1,2 / 2,3 % |
| popularité (direction moyenne, norme votes) | 0,0365 ± 0,0157 | 0,0375 | 0,962 / 0,810 | 0,1623 / 0,0231 / 0,0055 | 0,4 / 10,9 / 23,2 % |
| popularité, norme popularité | 0,0193 ± 0,0104 | 0,0199 | 0,931 / 0,722 | 0,1627 / 0,0252 / 0,0069 | 0,2 / 0,3 / 0,5 % |
| voisins tirés au hasard | 0,0056 ± 0,0041 | 0,0058 | 0,748 / 0,622 | 0,1620 / 0,0187 / 0,0032 | 0,6 / 28,8 / 59,1 % |
| **voisins** (D1, k = 5, γ = 0,5, chronologique) | 0,0434 ± 0,0144 | 0,0446 | 0,870 / 0,730 | 0,1611 / 0,0189 / 0,0037 | 1,7 / 36,5 / 68,0 % |
| **contenu** (D2) | **0,1286 ± 0,0249** | 0,1337 | 0,900 / **0,388** | 0,1607 / 0,0190 / 0,0053 | 2,3 / **39,8 / 55,4 %** |
| mélange κ = 3 (D3) | 0,0813 ± 0,0187 | 0,0846 | 0,928 / 0,620 | 0,1604 / 0,0185 / 0,0040 | 2,2 / 39,3 / 66,7 % |
| mélange κ = 30 | 0,1276 ± 0,0250 | 0,1324 | 0,913 / 0,465 | 0,1606 / 0,0189 / 0,0049 | 2,3 / 40,6 / 60,2 % |
| **contenu, norme popularité** | **0,0884 ± 0,0208** | 0,0915 | 0,874 / 0,336 | **0,1624 / 0,0243 / 0,0067** | **1,1 / 9,9 / 18,2 %** |
| contenu, norme popularité, référence D7 2010-2017 | 0,1821 ± 0,0302 | 0,1910 | 0,884 / 0,337 | 0,1579 / 0,0240 / 0,0068 | 3,8 / 12,9 / 11,7 % |

Écarts appariés avec « popularité » (Recall@20 base, par utilisateur, IC à 95 %) : voisins +0,007 ± 0,020 (non significatif) ; voisins sans chronologie +0,007 ± 0,020 ; **contenu +0,092 ± 0,024** ; mélange κ = 3 +0,045 ± 0,021 ; κ = 30 +0,091 ± 0,024 ; **contenu, norme popularité +0,052 ± 0,022** (et +0,069 par rapport à « popularité, norme popularité ») ; hasard −0,031 ± 0,015.

**Autres mesures**
- **Voisins** (D1) : k = 3 / 5 / 10 : 0,042 / 0,043 / 0,044 ; s = 0,5 / 1 / 2 : 0,045 / 0,043 / 0,041 ; chronologie sans effet (0,0434 contre 0,0436) : 397 films placés à la profondeur 0, 56 à 1, 9 à 2, 1 à 3 ; sans recalage de la norme : 60-94 % de la base dans le top 20 aux crans 2 000 et 500.
- **ω** (D6), NDCG@20 à ∞ des 263 utilisateurs dont le fold-in contient un film de la base (vrai vecteur : 0,1893 ± 0,024) ; contenu, norme popularité : ω = 0 → 0,1889, ω = 0,5 → 0,1876, ω = 1 → 0,1882. Aucune différence mesurable.
- **Qualité** (D4) : ρ = 0,05 / 0,1 / 0,2 : Recall@20 base inchangé (0,088 → 0,087-0,088), rang centile en baisse (0,874 → 0,850 / 0,835 / 0,818), surtout sous 500 votes (0,336 → 0,22-0,20). Aucun gain.
- **`YᵀY` avec les estimés** (D6, pour information) : moins bon (mélange κ = 3 : 0,081 → 0,072).
- **Contenu sans recalage de la norme** : 0,0015 (les prédictions ridge sont petites, rétrécies vers 0).
- Placés : 463/463 avec les voisins ; 454/463 avec le contenu seul (9 films sans 2 éléments parlants connus). Sur les vrais films absents, 8 sur 4 026 n'ont pas 2 éléments parlants.

**Popularité D7 sur les vrais films récents** (`recent_films.py popularity`, contrôle demandé en v0.2)
- Référence **2019-2022** (décision v0.2) : **aucun des 10 films absents les plus votés de chaque année ne dépasse 20 000** (maximum 19 627 en 2025, 18 768 en 2024 ; le 10ᵉ est vers 2 000-3 500). Part des films absents sous les plafonds : 98 % sous 2 000, 93 % sous 500, 85 % sous 200, autant que la référence elle-même (98 / 91 / 82 %). La raison : même avec `year_all`, presque aucun film de 2019-2022 ne dépasse 20 000 dans MovieLens (qui s'arrête en 2023).
- Référence **2010-2018** : 1 à 2 films sur 10 au-dessus de 20 000 par année (2024 : 27 872 et 21 361 ; 2025 : 30 408 et 20 298 ; 2026 : 23 116), le 10ᵉ vers 4 500-9 600. Référence **2015-2018** : 1 film sur 10 par an.

**Lecture**
1. **Le seuil « ≥ 70 % du vrai vecteur » ne veut rien dire ici.** Avec leur vrai vecteur, les films 2022-2023 ne sont presque **jamais** recommandés (Recall@20 0,0008, 0,01 % des top 20) : peu de notes MovieLens, donc des vecteurs de petite norme (biais de récence de MovieLens). Toutes les variantes le dépassent. Le plafond utile est la **vraie direction avec la norme recalée** (0,032 à 0,053) : **le contenu fait mieux** (0,088 à 0,129). Les vrais vecteurs de ces films sont mal appris ; le contenu, appris sur des films mûrs, donne une meilleure direction.
2. **Le contenu (D2) est le seul ingrédient qui bat la popularité.** Les voisins TMDB (D1) ne font pas mieux que la popularité, chronologie ou non. Les mélanger au contenu le dégrade (κ = 3 : 0,081 ; κ = 30 ≈ contenu).
3. **La norme par tranche de votes TMDB (D1c, v0.2) fait envahir les crans bas** : avec le contenu, 40 % des top 20 au cran 2 000 et 55 % à 500 sont des films estimés (2 % du catalogue), et NDCG@20 y perd 25 % (0,0252 → 0,0190 ; 0,0070 → 0,0053). La cause : la popularité D7 des films estimés est bien plus basse que celle des films du catalogue au même nombre de votes TMDB ; sous chaque plafond, ils gardent la norme de films plus connus qu'eux. **Avec une norme par tranche de popularité du curseur**, la part tombe à 10 % et 18 %, et NDCG@20 reste à 96-99 % du vrai à tous les crans.
4. **Tranche < 500 votes : échec.** Recall@20 = 0 pour toutes les variantes, vrai vecteur compris (62 utilisateurs). Au rang centile, le contenu y est **pire que le hasard** (0,34 contre 0,62 ; popularité 0,72-0,81). Règle v0.2 : ces films sont **non recommandables mais comptent dans le profil**. Sur les vrais films absents, il resterait **563 films recommandables** (≥ 500 votes, dont 480 sortis après le 13/10/2023), et 3 463 placés pour le profil seulement.
5. **ω et ρ** ne changent rien de mesurable : ω = 1 (le fold-in normal) et ρ = 0 (pas de pénalité de qualité).
6. **Popularité D7** : le contrôle « gros succès au-dessus de 20 000 » **échoue** avec la référence 2019-2022 ; une référence plus ancienne s'en approche sans l'atteindre (1-2 films sur 10 par an), et dans le faux départ à froid elle coûte 3,4 % de NDCG@20 à ∞ (0,1579, sous la règle des 97 %).

**Critères** (état à l'arrêt)
- D5, Recall@20 (films bien notés) ≥ 70 % du vrai vecteur : atteint par toutes les variantes, mais dégénéré (lecture 1) ; contre la vraie direction recalée : contenu 166-279 %.
- D5, meilleur que la popularité hors IC, sur l'ensemble et ≥ 500 votes : **contenu** ✅ (avec les deux normes) ; voisins ❌ ; mélange κ = 3 ✅ de justesse.
- D5, tranche < 500 votes : ❌ (→ non recommandables, comptent dans le profil).
- Films du catalogue, NDCG@20 à ∞ ≥ 97 % : ✅ pour toutes les variantes, sauf la référence D7 2010-2017 (96,6 %).
- Popularité, gros succès récents > 20 000 : ❌.

**Questions pour Thibault (arrêt de R3)**
1. **Ingrédients** : **contenu seul (D2)** ; voisins TMDB (D1) et mélange (D3) abandonnés, puisqu'ils ne battent pas la popularité ? D3 se réduit alors à « non placé sans 2 éléments parlants » (8 films sur 4 026).
2. **Norme (D1c)** : passer de la tranche de votes TMDB (v0.2) à la **tranche de popularité du curseur** (même grandeur que les plafonds), pour éviter l'invasion des crans bas (40 → 10 % au cran 2 000, 55 → 18 % à 500) ?
3. **Tranche < 500 votes** : appliquer la règle de v0.2 (non recommandables, comptent dans le profil), soit 563 films récents recommandables ? Ou un autre seuil (le faux départ à froid ne sait pas trancher entre 100 et 500 : 62 utilisateurs seulement) ?
4. **Popularité D7** : le contrôle des 20 000 échoue avec 2019-2022. Garder 2019-2022 (cohérent avec la popularité actuelle du catalogue, gros succès vers 10 000-20 000), passer à 2010-2018 (1-2 films par an au-dessus de 20 000, mais −3,4 % de NDCG@20 à ∞ au faux départ à froid), ou une autre règle (par exemple un plancher pour les N films les plus votés de chaque année) ?
5. **ω = 1** et **ρ = 0** (pas de pénalité de qualité), puisque ni l'un ni l'autre ne change rien de mesurable ?
6. **Seuil de D5** : remplacer « 70 % du vrai vecteur » par « 70 % de la vraie direction recalée » pour la suite (test de clôture) ?


### R3b — Pénalité de qualité ρ (12 novembre 2026) — décision : ρ = 0

Règle de Thibault (v0.3, D4), appliquée sans arrêt. Validation, contenu + norme par tranche de popularité, ω = 1 (`recent_eval.py run --only "contenu, norme popularité;contenu, norme pop., ρ = 0.05;contenu, norme pop., ρ = 0.1" --tag _rho`). « Mal notés » = films de la base dans le held-out de l'utilisateur, note sous la médiane de son fold-in ; part du top 20 à ∞, sur les 264 utilisateurs qui en ont un.

| ρ | part du top 20 : films de la base vus et mal notés | écart apparié avec ρ = 0 | Recall@20 (base, bien notés) | écart apparié avec ρ = 0 |
|---|---|---|---|---|
| 0 | 0,98 % ± 0,31 | — | 0,0884 ± 0,0208 | — |
| 0,05 | 0,98 % ± 0,31 | +0,000 ± 0,000 | 0,0883 | −0,0002 ± 0,0003 |
| 0,1 | 0,98 % ± 0,31 | +0,000 ± 0,000 | 0,0874 | −0,0010 ± 0,0016 |

**Décision (règle v0.3) : ρ = 0.** La pénalité ne retire aucun film mal noté du top 20 : les films estimés mal notés par TMDB qui y entrent ne sont pas ceux que les utilisateurs ont mal notés. La note TMDB affichée sur la carte suffit. D4 n'est pas branchée ; `bayes_rating` reste une caractéristique du contenu (D2).

### R3c — Contrôle de la popularité (v0.3) — ⏸ arrêt : le contrôle échoue

Contrôle de Thibault (v0.3, D7) : **aucun des 10 films les plus votés de chaque année sous 10 000**. Films TMDB de chaque année (≥ 50 votes) triés par votes ; les films du catalogue gardent leur popularité (`popularity.bin`), les films absents prennent celle de D7. Commande : `recent_films.py popularity --rule percentile|rank --ref 2019-2022|2010-2018`. Deux règles : **centile** dans l'année (D7 v0.2) et **rang absolu** dans l'année (le r-ième film le plus voté reçoit la médiane des r-ièmes popularités des années de référence ; il corrige les années récentes, qui ont moins de films à ≥ 50 votes et dont les centiles sont tirés vers le bas).

| Règle, référence | 2022 | 2023 | 2024 | 2025 | 2026 | 563 recommandables (≥ 500 votes) sous 2 000 / 500 / 200 |
|---|---|---|---|---|---|---|
| **centile, 2019-2022 (décision v0.3)** | 9/10 sous 10 000 | 10/10 | 8/10 (18 768, 10 410, puis 8 286…) | 9/10 | 9/10 | 89 / 52 / 6 % |
| centile, 2010-2018 | 9/10 | 9/10 | 1/10 | 3/10 | 6/10 | 77 / 31 / 0 % |
| rang absolu, 2019-2022 | 9/10 | 10/10 | 10/10 (8 726 en tête) | 9/10 | 10/10 | 87 / 37 / 1 % |
| **rang absolu, 2010-2018** | 9/10 | 9/10 | **0/10** (11 982 à 23 152) | **0/10** (11 982 à 27 145) | **0/10** (11 259 à 23 152) | **65 / 15 / 0 %** |

- **2022 et 2023 échouent quelle que soit la règle** : leurs 10 films les plus votés sont presque tous **du catalogue**, avec la popularité `year_all` de l'étape 4 (4 228, 8 945, 8 342, 3 731… en 2022 ; 4 949, 4 034, 3 217… en 2023). L'étape 8 n'y touche pas. Le site actuel classe déjà ces succès de 2022-2023 sous 10 000, parce que MovieLens s'arrête en 2023.
- **2024-2026** : seule la règle **rang absolu, référence 2010-2018** passe. Avec la référence 2019-2022, la tête de chaque année hérite du même tassement que les films 2022-2023 du catalogue.
- Effet sur les 563 films recommandables : avec la décision v0.3, 52 % sont sous le cran 500. Avec le rang absolu 2010-2018, c'est 15 %, et 65 % sous 2 000.
- Détail d'implémentation à corriger avant l'export : le rang absolu se calcule sur les votes de la fiche, et ceux-ci diffèrent un peu des votes de `discover` (quelques ex æquo, 16 281 deux fois en 2024) ; il faudra prendre une seule source.
- Le faux départ à froid de R3 a utilisé le centile avec la référence 2018-2021 ; si la règle change, les mesures aux crans de R3 sont à refaire (quelques minutes).

**Questions pour Thibault (arrêt de R3c)**
1. **Règle de popularité des films estimés** : garder le centile 2019-2022 (contrôle en échec, 52 % des recommandables sous 500), ou passer au **rang absolu dans l'année, référence 2010-2018** (contrôle atteint pour 2024-2026, 15 % sous 500) ?
2. **Portée du contrôle** : 2022 et 2023 échouent à cause des films **du catalogue** (popularité `year_all` de l'étape 4, hors de l'étape 8). Limiter le contrôle aux films absents (ou aux années 2024 et suivantes) ? Ou rouvrir `year_all` pour 2022-2023, ce qui changerait `popularity.bin` et les cas du fold-in ?
3. **Cohérence** : avec le rang absolu 2010-2018, un succès de 2024 (~23 000) passerait pour plus connu qu'un succès de 2022 du catalogue (~4 000-10 000). D'accord ?


### R3d — Nouvelle popularité (rang absolu dans l'année, à partir de 2019) — ⏸ arrêt : NDCG@20 à ∞ sous 97 % avec la norme D1c

Décisions de Thibault à l'arrêt de R3c : rang absolu dans l'année, référence 2010-2018, pour les films estimés **et** pour les films du catalogue des années sous-comptées ; une seule source de votes ; contrôles (a), (b), (c) ; mesures de R3 refaites aux crans.

**Année de départ.** Mesure avec `year_all` (films TMDB de chaque année triés par votes) : même les années mûres ont des succès sous 10 000 (2018 : 6 sur 10), donc le contrôle littéral ne donne pas d'année. Règle fixée avant le calcul : **première année où le 10ᵉ film le plus voté passe sous le minimum des années de référence** (7 225 en 2018 ; les autres entre 7 842 et 21 335). Résultat : **2019** (5 158), puis 2 129 à 4 562 de 2020 à 2023. `year_all` reste inchangé avant 2019.

**Règle** (`popularity.py`, `rank_corrected` ; `RANK_FIRST_YEAR = 2019`, `RANK_REFERENCE_YEARS = (2010, 2018)`) : à partir de 2019, le film classé r par votes TMDB dans son année (films `/discover` ≥ 50 votes, votes de `/discover` seulement ; un film absent de `/discover` est placé par ses votes) reçoit la **médiane, sur 2010-2018, de la r-ième plus haute popularité de l'année** (décroissante par construction) ; jamais moins que `year_all` ni que `0,285 × votes`. Même règle pour les films estimés (base `0,285 × votes`). Table : 27 145, 23 152, 17 742, 16 281, 15 466, 14 327, 13 852, 13 103, 12 136, 11 982 pour les 10 premiers rangs. **1 278 films du catalogue relevés, aucun baissé.**
- Une première version prenait la médiane par rang de **votes** puis la rendait décroissante par minimum cumulé : (a) échouait (8 480 aux rangs 9-10, tirés par un creux de la médiane). Ce n'était pas la règle validée en R3c ; revenu à celle-ci.

**Contrôles** (`recent_films.py popularity-check`, figure `docs/figures/etape8-popularite-rangs.png`)
- **(a) ✅** : de 2019 à 2026, aucun des 10 films les plus votés sous 10 000 (le 10ᵉ à 11 982).
- **(b) ✅** : popularité médiane autour des rangs 1 (1-3), 10 (9-11) et 100 (95-105). Saut 2018 → 2019 : ×1,51, ×1,66 et ×1,55, pour des plus grands sauts d'une année à l'autre en 2010-2018 de ×2,20, ×2,57 et **×1,56** (rang 100 : de justesse). À partir de 2019, les valeurs sont plates (23 152, 11 982, ~1 020) et un peu au-dessus de la moyenne des années de référence. La règle prend la r-ième plus haute popularité, alors que le profil des années de référence suit l'ordre des votes, qui est plus bruité.

| Année | rang 1 avant → après | rang 10 | rang 100 |
|---|---|---|---|
| 2018 | 15 290 → 15 290 | 7 225 → 7 225 | 664 → 664 |
| 2019 | 19 659 → 23 152 | 5 158 → 11 982 | 681 → 1 026 |
| 2020 | 7 844 → 23 152 | 2 129 → 11 982 | 357 → 1 018 |
| 2022 | 8 342 → 23 152 | 2 254 → 11 982 | 624 → 1 018 |
| 2023 | 4 034 → 23 152 | 1 603 → 11 982 | 682 → 1 018 |
| 2024 | 10 410 → 23 152 | 3 467 → 11 982 | 414 → 1 018 |
| 2026 | 7 015 → 23 152 | 2 088 → 11 982 | 142 → 1 018 |

- **(c)** Part des films recommandables sous 2 000 / 500 / 200, avant → après :
  - catalogue entier (22 968) : 86,8 / 70,9 / 55,3 % → 86,1 / 70,0 / 54,5 % ;
  - catalogue sorti à partir de 2019 (1 924) : 93,7 / 74,1 / 51,4 % → 85,5 / 63,7 / 42,6 % ;
  - films estimés recommandables (≥ 500 votes, 563) : 89,0 / 51,9 / 5,9 % (centile v0.3) → 64,8 / 15,3 / 0,0 %.

**Exports** : `popularity.bin` régénéré (`export.py export`, `--out web` ; `model-meta.json` : `popularity.rank_rule`), `foldin_cases.json` régénéré hors du dépôt ; `export.py verify` (les deux dossiers) : 200 listes calibrées identiques, écart des vecteurs 0 ; **Vitest 276/276** (parité Python / TypeScript : vecteurs et listes du fold-in) ; pytest 273/273. `catalog.json` ne dépend pas de la popularité.

**Validation avec la nouvelle popularité** (`recent_eval.py run --pop rank|old`, fold-in de l'étape 6c, sans calibration)
- Films du catalogue seuls (vrai vecteur), NDCG@20 : ∞ 0,1635 → 0,1635 ; 2 000 : 0,0252 → 0,0251 ± 0,0013 ; 500 : 0,0070 → 0,0070 ± 0,0007. Inchangé dans les IC.
- Faux départ à froid avec la nouvelle popularité (les films de la base suivent la même règle) :

| Variante | Recall@20 base | NDCG@20 ∞ / 2 000 / 500 | part de la base dans le top 20 ∞ / 2 000 / 500 |
|---|---|---|---|
| vrai vecteur | 0,0008 | 0,1635 / 0,0251 / 0,0070 | 0,0 / 0,0 / 0,0 % |
| vraie direction, norme popularité (plafond) | 0,1204 ± 0,028 | 0,1635 / 0,0252 / 0,0070 | 0,8 / 2,0 / 2,8 % |
| popularité, norme popularité (plancher) | 0,0512 ± 0,017 | 0,1603 / 0,0251 / 0,0068 | 1,1 / 0,3 / 2,3 % |
| **contenu, norme popularité (décision v0.3)** | 0,2178 ± 0,033 | **0,1553 (95,0 %)** / 0,0242 / 0,0068 | **5,3** / 14,0 / 10,4 % |
| contenu ×1,5 / ×2 / ×3 (écart à μ amplifié) | 0,218 / 0,215 / 0,212 | 0,1554 / 0,1555 / 0,1556 | 5,3 % à ∞ |
| **contenu, norme popularité × 0,8** | **0,1414 ± 0,026** | **0,1598 (97,7 %)** / 0,0248 / 0,0069 | **2,7 / 7,4 / 5,6 %** |
| contenu, norme popularité × 0,6 | 0,0650 ± 0,017 | 0,1626 / 0,0251 / 0,0069 | 0,9 / 2,6 / 2,1 % |

**Lecture**
- Avec la nouvelle popularité, la norme cible des films estimés monte avec leur tranche de popularité. Le contenu reste proche de la direction moyenne (celle qui plaît à tout le monde) : il prend **5,3 % des top 20 à ∞** pour 2 % du catalogue, et NDCG@20 à ∞ tombe à **95,0 %**, sous le critère des 97 %. La vraie direction, à la même norme, n'en prend que 0,8 %.
- Amplifier l'écart à μ ne change rien. **Réduire la norme cible de 20 %** passe tous les critères : NDCG@20 à ∞ 97,7 % ; Recall@20 base 0,141 = **117 % de la vraie direction recalée** (seuil 70 %), meilleur que la popularité (0,051) ; films estimés dans le top 20 : 7,4 % au cran 2 000 et 5,6 % à 500 (seuil 20 %). À × 0,6, le rappel tombe à 54 % du plafond.

**Critères** (état à l'arrêt) : (a) ✅, (b) ✅ (rang 100 de justesse) ; NDCG@20 de validation à 2 000 et 500 inchangé pour le catalogue ✅ ; films du catalogue, NDCG@20 à ∞ ≥ 97 % avec les films estimés ❌ avec la norme D1c (95,0 %), ✅ avec × 0,8 (97,7 %).

**Question pour Thibault (arrêt de R3d)** : ajouter à D1c un **facteur 0,8 sur la norme cible** (réglé sur la validation, dans `model-meta.json`), qui passe tous les critères ? Sinon : garder la norme D1c et accepter 95 % à ∞, ou une autre forme (par exemple la norme de la tranche de popularité inférieure).


### R3d — suite : facteur 0,8 sur la norme (v0.5, décision de Thibault)

**Facteur 0,8 accepté** : la norme cible des films estimés vaut **0,8 × la norme médiane** des films du catalogue de la même tranche de popularité.
- **Raison** : c'est le rétrécissement d'une estimation incertaine. Les vecteurs prédits par le contenu pointent vers la direction moyenne ; à norme pleine, ils envahissent les listes.
- Le facteur est réglé sur la validation et écrit dans `model-meta.json` (`estimated.norm_factor`). Il sera vérifié **une seule fois sur le test**, à la clôture.

Pour information (validation, nouvelle popularité ; le choix ne change pas) :

| Facteur | Recall@20 base | NDCG@20 ∞ / 2 000 / 500 | part des estimés dans le top 20 ∞ / 2 000 / 500 |
|---|---|---|---|
| 1 | 0,2178 | 0,1553 (95,0 %) / 0,0242 / 0,0068 | 5,3 / 14,0 / 10,4 % |
| 0,9 | 0,1763 | 0,1577 (96,5 %) / 0,0245 / 0,0068 | 3,9 / 10,6 / 7,8 % |
| **0,8** | **0,1414** | **0,1598 (97,7 %)** / 0,0248 / 0,0069 | **2,7 / 7,4 / 5,6 %** |
| 0,7 | 0,1100 | 0,1614 (98,7 %) / 0,0250 / 0,0069 | 1,7 / 4,8 / 3,6 % |
| 0,6 | 0,0650 | 0,1626 (99,4 %) / 0,0251 / 0,0069 | 0,9 / 2,6 / 2,1 % |

0,8 est le facteur le plus fort qui garde NDCG@20 à ∞ au-dessus de 97 %. À 0,7, Recall@20 = 91 % de la vraie direction recalée (0,1204) ; à 0,6, 54 %.

### R4 — Export (12 novembre 2026)

`recent_films.py estimate` produit `pipeline/data/processed/estimated_films.parquet` et `estimated_vectors.npy` (non versionnés) :
- **Contenu** (ridge, λ = 100) appris sur les 22 972 films du catalogue qui ont une fiche, vecteurs du **modèle final** ; 22 010 caractéristiques.
- **Films absents** à ≥ 50 votes : 4 026. **Placés : 3 358** ; il faut au moins 2 éléments parlants connus du modèle (réalisateurs, acteurs, mots-clés vus au moins 3 fois dans le catalogue). **668 ne le sont pas** : leurs réalisateurs, acteurs et mots-clés sont inconnus du catalogue, et ils restent « trop récents ».
- **Recommandables : 559** (≥ 500 votes).
- Popularité : rang dans l'année (R3d). Norme : 0,8 × médiane de la tranche de popularité. Normes médianes : estimés 0,0139, catalogue 0,0331.

`export.py` :
- les films estimés sont **ajoutés après les 23 019 films entraînés** (`item_idx` 23 019 à 26 376, triés par date de sortie puis `tmdb_id`) ;
- `yty.bin` = YᵀY des **seuls films entraînés** (D6) ;
- `model-meta.json` : `n_trained`, `estimated` (règle, seuils, λ, `norm_factor`, ρ = 0) et les films non recommandables (estimés sous 500 votes compris) ;
- `catalog.json` **v3** : `n_trained`, `tmdb_mean` (note TMDB sur 5 × 10), `tmdb_count` ; `ml_mean` / `ml_count` nuls pour les estimés ; genres TMDB traduits en genres MovieLens ;
- `title-index.json` : titre TMDB (source 0) et titre original des estimés ; `imdb_id` de TMDB pour l'import IMDb.

Résultats :
- `foldin_cases.json` (hors du dépôt) : **27 cas**, dont 2 nouveaux, `with_estimated` (un vrai historique + 3 estimés recommandables et 3 non recommandables) et `estimated_only`.
- `export.py verify` : 81 listes top 10 et **216 listes calibrées identiques**, écart des vecteurs 0. `catalog-verify` : 26 377 films, 38 890 clés, aucun titre TMDB sans clé.
- **Taille de `web/public/data/` : 3,58 Mo gzip** (critère ≤ 3,8 Mo).

### R5 — Moteur (12 novembre 2026)

- **Aucun changement du calcul** : le moteur lit `yty.bin` et la taille des fichiers. ω = 1 (fold-in habituel) et ρ = 0, donc pas de nouveau code de calcul.
- `workerCore.ts` : une carte d'un film estimé porte `estimated` et `tmdbRating` (`isEstimated` : `item ≥ n_trained`).
- **Parité** : Vitest rejoue les 27 cas (vecteurs, 81 listes, 216 listes calibrées) ; nouveau `estimated.test.ts` sur les vrais fichiers : films estimés après les entraînés, *Anora* et *The Substance* de l'exemple reconnus et comptés dans le profil, seuls des estimés recommandables proposés.
- **Temps** (`reco-bench`, médiane de 7) : export A (217 films) 30,4 ms ; 3 000 films 113,7 ms (étape 6c : 123-255 ms) ✅.
- **Exports réels** (`npx tsx scripts/recent-report.ts`, comptes seulement) :

| Export | Films de l'historique (avant → après) | Films estimés sur 48 par cran (∞ → 200) | dans les 8 premiers |
|---|---|---|---|
| Letterboxd A | 188 → **217** (+29 estimés) | 5, 10, 9, 8, 15, 15, 4, 0 | 0, 2, 1, 0, 2, 3, 1, 0 |
| Letterboxd B | 381 → **491** (112 estimés dans l'historique) | 7, 9, 7, 5, 8, 5, 1, 0 | 3, 4, 2, 0, 2, 0, 1, 0 |
| exemple | 61 → 63 | 2, 3, 3, 3, 0, 1, 0, 0 | 0, 0, 0, 1, 0, 0, 0, 0 |

### R6 — Interface (12 novembre 2026) — ⏸ arrêt : essai à l'écran

- **Carte d'un film estimé** : « ★ 3,4 · TMDB (estimé) » sous la ligne réalisateur/année (lecteur d'écran : « note TMDB 3,4 sur 5, (estimé) »). Sans note TMDB : « (estimé) » seul. Les tags « encore un … » et « ✱ pépite » s'appliquent ; « ça divise » jamais (pas dans `divisive`) ; « vieux trésor » sans objet.
- **Exemples synthétiques** (`npm run make-example`) : *Anora* et *The Substance* (2024) sont maintenant reconnus ; l'exemple IMDb prend le vrai id d'*Anora* (fourni par TMDB) au lieu de l'id inventé `tt99000002`. L'exemple ne montre donc plus de « trop récents » ; la règle reste testée par les tests unitaires.
- **Emplacements de texte** (Claude Web, à cet arrêt ; affichés « [texte à venir : … ] » ; `content.test.ts` non bloquant pendant l'étape, à remettre bloquant à la clôture) :
  - « comment ça marche », nouvelle section **`#recents`** (après « le curseur ») : `recents.titre`, `recents.pourquoi`, `recents.comment`, `recents.carte`, `recents.limites` ;
  - `curseur.recents` (une phrase sur la popularité à partir de 2019) ;
  - `donnees.noteTmdb` (la note TMDB sur les cartes des films estimés) ;
  - `limites.recents` (remplace « les films sortis après 2023 : nos données s'arrêtent là »).
  - Phrase de l'écran d'analyse « N films sont sortis après 2023 : trop récents pour nous, désolé. » : gardée, elle reste juste pour les films non placés ; à reformuler si tu veux.
- **Tests** :
  - Vitest **280/280**, dont les tests de la carte d'un film estimé ; `tsc`, ESLint, Prettier, `build` verts ; pytest 274/274.
  - **Playwright 13/13** (parcours, téléphone simulé, réseau : aucune requête nouvelle, stockage, **axe 0 dans les deux thèmes**) ; **changement de cran : médiane 33 ms** (max 35) ; modèle prêt 674 ms ; analyse 9 ms.

**Critères** (état à l'arrêt) :
- Moteur : parité Python / TypeScript à l'identique ✅.
- Temps ✅ ; taille ✅ ; licences ✅ (rien d'IMDb dans `web/public/data/`) ; qualité du code ✅.
- Exports réels : les films « trop récents » retrouvés dans `discover` sont reconnus, sauf ceux qui ne sont pas placés (sur l'export A : 29 films estimés dans l'historique, pour 30 retrouvés en R0) ✅.
- Restent pour la clôture : les textes, le test (une seule fois) et l'essai sur un vrai téléphone.

**À voir à l'écran** (`npm run dev`, ton export A) : les cartes « (estimé) » (aux crans 20 000, 2 000 et 1 000, 1 à 3 dans les 8 premières), la section `#recents` de « comment ça marche » (textes à venir) et l'écran d'analyse (les films de 2024-2025 reconnus).

---

## 6. À reporter

- **Embedding du résumé** (D2) : seulement si le contenu sans résumé reste sous le seuil.
- **Pages 2 et plus de `recommendations`** : non mesurées (k = 5 suffit d'après 2.3).
- **Films sous 50 votes** : non placés ; à revoir avec les volontaires (films de festival vus tôt).
- **Tranche 50-499 votes** (v0.3) : non mesurable au faux départ à froid (62 utilisateurs, vrai vecteur à 0, contenu sous le hasard au rang centile) ; ces films comptent dans le profil sans être recommandés ; à réévaluer avec les volontaires (étape 7).
- **Réentraînement d'ALS** avec d'autres sources de notes : hors projet (MovieLens 32M figé).

---

## 7. Questions pour la validation — réponses de Thibault (12 novembre 2026)

1. **Périmètre** : oui, films 2022-2023 absents inclus ; **placés à ≥ 50 votes, recommandables à ≥ 100** ; placés mais non recommandables = comptent dans le profil. → D0.
2. **`similar`** : écarté du placement (anti-signal mesuré). → D1.
3. **Estimation centrée + recalage de la norme** : oui ; cible = **norme médiane des films du catalogue de la même tranche de votes TMDB**, pas une norme globale. → D1c.
4. **Fiches TMDB des 23 019 films** : oui, une seule fois, gardées dans `pipeline/data/` (non versionné). → D2, R1.
5. **Seuil de D5** : oui, Recall@20 sur les films **bien notés seulement**, résultats **par tranche de votes** ; si la tranche < 500 votes rate le seuil, ces films sont **non recommandables mais comptent dans le profil**. → D5.
6. **Popularité** : rang des votes au sein de l'année, **calé sur les films 2019-2022 du catalogue** ; vérifier que les gros succès récents tombent **au-dessus de 20 000**. → D7.
7. **D6** : `YᵀY` limité aux films entraînés ; ω mesuré à 0 / 0,5 / 1 sur la validation (films 2022-2023 du fold-in avec leur vecteur estimé). → D6.
8. **Carte** : « ★ x,x · TMDB » + « (estimé) » ; pas de « ça divise » ; « encore un … » et « ✱ pépite » s'appliquent. → D7.
9. **Ordre** : cette étape passe **avant la mise en ligne** ; dans `CLAUDE.md`, « 8. Films récents », puis « 9. Ensuite ».

### Réponses de Thibault à l'arrêt de R3 (12 novembre 2026)

1. **Contenu seul** ; voisins TMDB et mélange abandonnés (✗ : pas mieux que la popularité, le mélange dégrade) ; le rafraîchissement n'a plus besoin des `recommendations`. → D1, D2, D3, D8.
2. **Norme cible par tranche de popularité du curseur** (✗ tranche de votes TMDB : 40-55 % des top 20 aux crans bas). → D1c.
3. **< 500 votes** : non recommandables, comptent dans le profil (563 films recommandables) ; tranche non mesurable, à réévaluer avec les volontaires (§6). → D0.
4. **Popularité** : référence 2019-2022 ; contrôle remplacé par « aucun des 10 films les plus votés de chaque année sous 10 000 » ; arrêt s'il échoue. → D7.
5. **ω = 1** ; ρ tranché par une mesure de plus (films de la base vus et mal notés dans le top 20). → D4, D6.
6. **Test de clôture** : 70 % de la vraie direction avec norme recalée, meilleur que la popularité hors IC, films estimés ≤ 20 % du top 20 aux crans 2 000 et 500. → D5.
