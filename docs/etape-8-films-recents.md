# Étape 8 — Films récents

> Version 0.1 (12 novembre 2026) : diagnostic R0 fait (section 2), décisions **proposées**, **en attente de validation par Thibault** (questions en section 7). Rien n'est codé dans le site.
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
- **Recommandables** seulement s'ils ont **≥ 100 votes** (~2 400 films ; à confirmer en R3) et passent les règles de D3 et D5. Documentaires : gardés, avec la mention et le filtre qui existent ; téléfilms (genre TMDB 10770, 33 films) : gardés comme les autres films.
- Pas de dataset IMDb ; pas de film adulte ; mêmes exclusions manuelles (`manual_overrides.csv` : `exclude` accepte aussi un `tmdb_id` récent, colonne à préciser en R1).

### D1. Voisins TMDB dans le catalogue

- Source : **`recommendations` seulement** (première page, 20 films) ; `similar` écarté du placement (2.3 : pire que le hasard une fois centré).
- **k premiers voisins placés** (au catalogue, ou films récents déjà placés), **poids au rang** `1/r` ; k réglé en R3 (départ : 5).
- Estimation **centrée et recalée** : `ŷ = μ + s × Σ w_r (y_r − μ) / Σ w_r`, puis norme ramenée à une **norme cible** (D1c). `μ` = vecteur moyen des films du catalogue ; `s` (rétrécissement) appris en R3.
- **D1c. Norme cible** : régression de `log ‖y‖` sur `log(1 + votes TMDB)`, l'année de sortie et le nombre de voisins, apprise sur les films du catalogue ; sinon, norme médiane des films du catalogue de popularité voisine. Mesuré en R3.
- **Placement chronologique** : films triés par date de sortie, chacun placé avec les voisins déjà placés (catalogue + films récents plus anciens). **Surveillance de la propagation** : profondeur de placement (0 = tous les voisins au catalogue) et part du poids venue de films estimés, rapportées en R3 ; un voisin estimé compte avec un poids réduit `γ` (réglé en R3, départ 0,5).

### D2. Contenu TMDB → vecteur ALS

- Caractéristiques : réalisateurs, 5 premiers acteurs, genres TMDB, mots-clés, langue originale, pays d'origine, décennie, `log(1 + votes)`, note TMDB (moyenne bayésienne, D4) ; indicatrices creuses, une valeur gardée si elle apparaît dans ≥ 3 films d'apprentissage.
- **Régression ridge** des vecteurs ALS centrés (64 sorties) sur ces caractéristiques, apprise sur les films du catalogue (pondérés par leur nombre de notes MovieLens, les vecteurs des films peu notés étant bruités, 2.3) ; régularisation réglée par validation croisée sur les films connus.
- Demande la fiche TMDB des 23 019 films du catalogue (~20 min, une fois, R1).
- **Embedding du résumé** : en option, seulement si D2 sans résumé reste sous le seuil (R3) ; modèle de texte hors ligne, rien d'embarqué que le vecteur final.

### D3. Mélange

- `ŷ = α(n) × ŷ_voisins + (1 − α(n)) × ŷ_contenu`, `α(n) = n / (n + κ)`, `n` = poids des voisins placés ; κ appris en R3. Norme recalée après le mélange (D1c).
- **Non placé** si ni voisins (n < 3) ni contenu parlant (moins de 2 caractéristiques connues parmi réalisateur, acteurs, mots-clés) : le film reste « trop récent » à l'écran d'analyse.
- **Non recommandable** (mais placé, pour le fold-in) sous 100 votes ou sous le seuil de confiance fixé en R3.

### D4. Qualité

- Note TMDB en **moyenne bayésienne** : `R̃ = (v × R + m × C) / (v + m)`, `C` = note moyenne des films placés, `m` = 200 votes (à régler).
- **Pénalité douce, jamais un filtre** : pour les films estimés seulement, `score' = score − ρ × max(0, C − R̃) × s_ref` (`s_ref` = meilleur score du vivier du cran, comme la forme mesurée de D1b à l'étape 6c). La note TMDB est celle du grand public, pas des critiques : ρ petit, réglé en R3 ; ρ = 0 si la mesure ne montre rien.
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
- **Seuil, fixé avant de mesurer** : sur la validation, Recall@20 (films de la base bien notés) avec vecteurs estimés **≥ 70 % de celui des vrais vecteurs**, et **meilleur que la popularité** hors des intervalles de confiance, sur la tranche **< 500 votes** comme sur l'ensemble.
- Si le seuil est atteint : les films récents entrent dans les listes normales, avec « (estimé) » sur la carte. Sinon : **rangée « sorties récentes (estimé) » seulement** si le classement bat la popularité, **rien** sinon ; dans les deux cas, ils comptent dans le fold-in si D6 le justifie.
- **Test** : une seule fois, à la clôture (R7), sur la configuration retenue.

### D6. Moteur

- **`YᵀY` reste celui des films entraînés** (23 019) : il représente la « négative implicite » d'ALS ; parité inchangée. La variante « `YᵀY` + films estimés » est mesurée en R3 (validation), pour information.
- **Poids des films estimés dans le fold-in** : confiance `c = 1 + ω × (c_normal − 1)`, ω ∈ {0 ; 0,5 ; 1} mesuré en R3 (utilisateurs de validation dont le fold-in contient des films de la base, estimés). Règle de D2 de l'étape 6c (percentile < 0,3 retiré) appliquée comme aux autres films.
- **`item_idx`** : les films estimés sont **ajoutés après** les films entraînés (`item_idx` ≥ 23 019), dans l'ordre du placement ; l'ordre des films entraînés ne change pas (règle de `CLAUDE.md`). `model-meta.json` donne `n_trained` (taille de `YᵀY`) et `n_items`.
- Exclusions, calibration, explications, tags : inchangés et appliqués aux films estimés (voir D7). Cas partagés : `foldin_cases.json` régénéré hors du dépôt avec des historiques qui contiennent des films estimés ; rejeu à l'identique.

### D7. Site

- **Popularité du curseur** des films estimés : **pas `0,285 × votes` tel quel** (2.4 : 89 % sous le plafond 200). Proposition : **correspondance par rang dans l'année** : un film au centile c des votes TMDB parmi les films de son année de sortie reçoit la popularité du film au centile c parmi des films de référence (catalogue 2015-2019, sur le même univers « ≥ 50 votes TMDB ») ; jamais moins que `0,285 × votes`. Alternatives mesurées en R3 : facteur d'âge sur les votes TMDB ; `year_all` prolongé. Choix à l'arrêt de R3, table dans `model-meta.json`.
- **Carte** : « ★ x,x · TMDB » (note TMDB ramenée sur 5, une décimale, au lieu de la moyenne MovieLens) et **« (estimé) »** ; lien Letterboxd par `tmdb_id` (inchangé) ; tag « encore un <réalisateur> » (réalisateurs TMDB, même calcul) et tampon « ✱ pépite » (popularité D7) ; **pas** « ça divise » (pas de notes individuelles) ni « vieux trésor » (récents par définition) ; « parce que t'as aimé X et Y » permis (cosinus des vecteurs estimés), à vérifier en R6.
- **Rangée « sorties récentes »** : seulement si D5 le décide (seuil non atteint, popularité battue) ; sinon films mêlés aux autres.
- **Calibration des genres** : genres TMDB des films estimés traduits en genres MovieLens (Action, Adventure, Animation, Comedy, Crime, Documentary, Drama, Fantasy, Horror, Mystery, Romance, Thriller, War, Western : même nom ; Science Fiction → Sci-Fi ; Family → Children ; Music → Musical ; History et TV Movie → aucun). Correspondance vérifiée en R1 sur les films du catalogue (accord par genre, rapporté).
- **Écran d'analyse** : les films placés sont reconnus (statut `exact`) ; « trop récents » ne garde que les films non placés (et la phrase dit pourquoi : « trop récents ou trop peu vus pour nous ») ; texte de Claude Web.
- **Index des titres** : titres TMDB (titre, titre original) des films placés, même normalisation v2 ; `imdb_id` TMDB pour l'import IMDb.
- **« comment ça marche »** : une section sur les films récents estimés (texte de Claude Web).
- **Taille** (estimée pour ~3 800 films placés, à mesurer en R4) : `catalog.json` +~200 Ko gzip (52 o/film aujourd'hui), `title-index.json` +~60 Ko, `embeddings.bin` +~260 Ko brut (68 o/film), `popularity.bin` +15 Ko : **~+0,5 Mo gzip** (3,06 → ~3,6 Mo). À ≥ 100 votes pour tout (~2 400 films) : ~+0,3 Mo.

### D8. Rafraîchissement

- Le rafraîchissement TMDB mensuel de l'étape 7 (GitHub Actions) lance aussi `discover` depuis le dernier passage, les fiches des nouveaux films et la mise à jour des votes des films placés (~5 min d'appels).
- **La régression D2 et les réglages (k, γ, κ, s, ρ, popularité) sont figés** (appris une fois, sauvegardés) ; seuls les voisins, les votes et la liste des films changent. Placement recalculé en entier à chaque passage (déterministe).
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

---

## 6. À reporter

- **Embedding du résumé** (D2) : seulement si le contenu sans résumé reste sous le seuil.
- **Pages 2 et plus de `recommendations`** : non mesurées (k = 5 suffit d'après 2.3).
- **Films sous 50 votes** : non placés ; à revoir avec les volontaires (films de festival vus tôt).
- **Réentraînement d'ALS** avec d'autres sources de notes : hors projet (MovieLens 32M figé).

---

## 7. Questions pour la validation

1. **Périmètre (D0)** : inclure les **films 2022-2023 absents du catalogue** (~1 500, même trou) en plus des films sortis après le 13/10/2023 ? Seuils : **50 votes pour placer** (historique), **100 pour recommander** ?
2. **`similar`** écarté du placement (pire que le hasard) : d'accord ? Le garder comme simple caractéristique de contenu si R3 le montre utile ?
3. **Norme recalée (D1c)** et estimation centrée avec rétrécissement : d'accord pour l'ajouter à D1 ? (Sans elle, les films estimés écraseraient les listes.)
4. **Collecte des 23 019 fiches du catalogue** (~20 min d'appels TMDB, une fois) pour apprendre D2 : d'accord ?
5. **Seuil de D5** : Recall@20 des films de la base bien notés ≥ 70 % du vrai vecteur, meilleur que la popularité, sur l'ensemble **et** sous 500 votes : d'accord avec cette forme, fixée avant de mesurer ?
6. **Popularité (D7)** : `0,285 × votes` fait passer 89 % des films récents sous le plafond 200. D'accord pour une **correspondance par rang dans l'année** (référence : catalogue 2015-2019), comparée en R3 à un facteur d'âge ?
7. **D6** : `YᵀY` limité aux films entraînés (variante mesurée pour information) ; ω mesuré ∈ {0 ; 0,5 ; 1} : d'accord ?
8. **Carte** : « ★ x,x · TMDB » (note sur 5) + « (estimé) » ; pas « ça divise » ni « vieux trésor » sur ces films : d'accord ?
9. **Ordre et nom** : cette étape avant la mise en ligne (étape 7), qui reste bloquée par GroupLens ? Le point « 8. Ensuite » de `CLAUDE.md` (fiche film, dispo en France…) devient alors « 9. Ensuite » à la clôture.
