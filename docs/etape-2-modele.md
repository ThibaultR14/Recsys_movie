# Étape 2 — Modèle ALS et évaluation hors ligne

> Version 0.1 (6 novembre 2026). Spécification de l'étape 2 de l'ordre de construction (`stack-technique.md` §8).
> Complète `stack-technique.md` et `CLAUDE.md`. Décisions validées le 6 novembre 2026.

---

## 0. Mode d'emploi (pour Claude Code)

- **Relis ce document au début de chaque sous-étape.** Les décisions de la section 3 ne se changent pas sans accord : si l'une pose problème, arrête-toi et explique pourquoi.
- Une sous-étape à la fois (C1 → C6). **Arrête-toi à la fin de chacune** et rends compte : ce qui a été fait, critères atteints ou non, choix faits sans demander.
- Après chaque sous-étape, **ajoute les résultats dans la section 5** de ce document (tableaux, chiffres, chemins des figures). C'est la trace qui servira au rapport : chiffres exacts, pas d'arrondis flatteurs.
- **Règle d'or : le jeu de test ne sert pas à régler quoi que ce soit.** Tous les réglages (hyperparamètres, λ, choix de la popularité) se font sur les utilisateurs de validation. Le test est évalué une fois par modèle retenu, et on note le résultat même s'il déçoit.
- Graines aléatoires fixées partout (`SEED = 42` dans `config.py`). Avant l'entraînement : `OPENBLAS_NUM_THREADS=1` et `MKL_NUM_THREADS=1` (recommandation de la librairie `implicit`).

---

## 1. Objectifs

1. Entraîner un modèle **ALS** (librairie `implicit` 0.7.x) et vérifier qu'il recommande bien des films à des utilisateurs **qu'il n'a jamais vus**, exactement comme le fera le site (fold-in).
2. Le comparer à des références simples (populaire, hasard) et à **EASE** (référence de précision, jamais embarqué).
3. Montrer que le **curseur connu ↔ pépite** fonctionne : courbe précision ↔ popularité quand λ varie. Choisir la source de popularité (`ml_rating_count` ou `tmdb_vote_count`).
4. Exporter les vecteurs pour le navigateur (`embeddings.bin` en int8) sans perte de qualité, avec des cas de test qui permettront de vérifier le fold-in TypeScript à l'étape 4.

---

## 2. Données d'entrée

| Fichier | Contenu |
|---|---|
| `pipeline/data/processed/catalog.parquet` | 23 019 films, `item_idx` 0..n-1, colonne `recommendable` (51 à `false`) |
| `pipeline/data/processed/ratings_filtered.parquet` | 31 662 542 notes, uniquement sur les films du catalogue, doublons fusionnés |

- Les films `recommendable = false` **restent dans l'entraînement et le fold-in** (ils aident à comprendre le goût), mais ne sont **jamais proposés** : ils sont retirés des candidats et des films à retrouver (held-out).
- `item_idx` est l'ordre des lignes de la matrice des vecteurs. Il est figé par l'entraînement final (C5), et sauvegardé avec les vecteurs.

---

## 3. Décisions

### D1. Découpage des données

- **Utilisateurs éligibles** à la validation et au test : au moins **10 notes** dans le catalogue.
- Tirage aléatoire (`SEED`) de **10 000 utilisateurs de validation** et **10 000 utilisateurs de test** parmi les éligibles. Tous les autres utilisateurs servent à l'entraînement, avec toutes leurs notes.
- Les utilisateurs de validation et de test **ne sont jamais dans la matrice d'entraînement.** Leur vecteur est calculé par fold-in, comme sur le site.
- Pour chaque utilisateur de validation/test : notes triées par `timestamp` (puis `movie_id` en cas d'égalité). Les **80 % les plus anciennes** (arrondi inférieur) forment le **fold-in** ; les **20 % les plus récentes** (au moins 1) forment le **held-out** à retrouver.
- Limite assumée : des utilisateurs d'entraînement peuvent avoir noté après la période held-out d'un utilisateur de test. C'est le protocole standard « utilisateurs nouveaux » ; on le note dans le rapport.

### D2. Signal et confiance

ALS implicite apprend « a vu / n'a pas vu », pondéré par une confiance.

- **Tout film vu est un positif**, même mal noté.
- `p_ui` = percentile de la note dans l'historique de l'utilisateur, entre 0 et 1 (rang moyen en cas d'égalité : `p = (rang_moyen − 1) / (n − 1)`, et `p = 0,5` si l'utilisateur n'a qu'une note).
- Valeur stockée dans la matrice : `r_ui = 1 + β × p_ui` (donc toujours ≥ 1 : jamais de zéro, qui ferait disparaître le film d'une matrice creuse). `β = 0` équivaut à un signal binaire.
- **Film vu sans note** (cas fréquent dans `watched.csv` de Letterboxd) : `p = 0,5`.
- La confiance finale vient de `r_ui` et du paramètre `alpha` d'`implicit`. **À vérifier dans le code d'`implicit` 0.7.x** : la formule exacte qui transforme les valeurs de la matrice et `alpha` en confiance, et la documenter ici. Le fold-in maison (D4) doit utiliser exactement la même.
- Pour le fold-in d'un utilisateur de validation/test, les percentiles sont calculés **sur son fold-in uniquement** (pas de fuite du held-out).

**Pertinence pour l'évaluation** : un film held-out est **pertinent** si sa note est **≥ la médiane des notes du fold-in** de cet utilisateur. On rapporte aussi une variante secondaire « tout film held-out compte » (`recall_all`).

### D3. Métriques et références

Candidats pour un utilisateur : films `recommendable = true` qui ne sont pas dans son fold-in. Le held-out est restreint aux films recommandables.

| Métrique | Définition |
|---|---|
| `Recall@20` | films pertinents trouvés dans le top 20 / min(20, nombre de pertinents) |
| `NDCG@20` | gain binaire (pertinent = 1), normalisé par le NDCG idéal |
| `recall_all@20` | comme Recall@20, avec tout le held-out comme pertinent |
| `pop_moyenne@20` | moyenne de `log(1 + ml_rating_count)` des films recommandés (plus bas = plus pépite) |
| `pop_mediane@20` | médiane du nombre de notes des films recommandés (lisible : « un film typique de la liste a N notes ») |
| `couverture@20` | films distincts recommandés à au moins un utilisateur / films recommandables |
| `longue_traine@20` | part des recos hors des 20 % de films les plus populaires |

- Chaque métrique est donnée en **moyenne ± intervalle de confiance à 95 %** (erreur standard × 1,96 sur les utilisateurs).
- Utilisateurs sans aucun film pertinent dans leur held-out : exclus de Recall/NDCG (comptés et signalés), inclus dans les métriques de popularité et de couverture.
- **Références** à rapporter systématiquement : `populaire` (films les plus notés par les utilisateurs d'entraînement) et `hasard` (`SEED`).
- Pour l'évaluation, `ml_rating_count` est **recalculé sur les seuls utilisateurs d'entraînement** (pas de fuite). En production, on utilisera les comptes complets.

### D4. Fold-in (calcul du vecteur d'un nouvel utilisateur)

- Formule ALS implicite : `x_u = (YᵀY + Yᵀ(C_u − I)Y + λ_reg·I)⁻¹ · Yᵀ C_u p_u`, avec `Y` les vecteurs des films, `C_u` les confiances de l'utilisateur, `p_u` = 1 sur ses films vus. À aligner exactement sur ce que fait `implicit` (régularisation, éventuelle mise à l'échelle).
- Implémentation **maison en NumPy** (`pipeline/models/als.py`), qui servira de référence pour la version TypeScript. Elle doit donner le même résultat que le recalcul d'utilisateur fourni par `implicit` (critère en C2).
- `YᵀY` (64 × 64) est précalculé et exporté (C5) : le navigateur n'a qu'un petit système 64 × 64 à résoudre.

### D5. Curseur connu ↔ pépite

Les scores ALS n'ont pas la même échelle d'un utilisateur à l'autre. Pour qu'un même λ ait le même effet pour tous :

- `s_ui` = score ALS **centré-réduit sur les candidats de l'utilisateur** (moyenne 0, écart-type 1).
- `z_i` = `log(1 + popularité_i)` **centré-réduit sur l'ensemble des films recommandables** (calculé une fois).
- **Score final : `score_ui = s_ui − λ × z_i`.**
- Balayage de λ de **−0,5 à 2,0 par pas de 0,1** (les valeurs négatives favorisent les classiques : à voir si l'extrémité gauche du curseur doit aller jusque-là).
- Deux sources de popularité testées : `ml_rating_count` (comptes d'entraînement) et `tmdb_vote_count` (manquant → plus petite valeur observée).
- **Livrable clé** : la courbe `NDCG@20` (ou `Recall@20`) en fonction de `pop_mediane@20` quand λ varie, une courbe par source de popularité, avec les références `populaire` et `hasard` en points.
- Le choix de la source et de la plage de λ se fait sur la validation, **par Thibault**, au vu des courbes (C4).

### D6. Hyperparamètres d'ALS

| Paramètre | Valeurs testées |
|---|---|
| `factors` | 32, **64** (défaut), 128 — 128 seulement si gain ≥ 3 % relatif de NDCG@20, car il double la taille |
| `regularization` | 0,01 ; 0,05 ; 0,1 ; 0,5 |
| `alpha` | 1 ; 5 ; 10 ; 20 ; 40 |
| `β` (D2) | 0 ; 1 ; 3 |
| `iterations` | 15 (vérifier la convergence sur la meilleure config : 15 vs 30) |

- Recherche limitée (~30 configurations, tirées au hasard dans la grille, `SEED`), évaluée sur la **validation** à λ = 0. Critère de choix : `NDCG@20`.
- Rapporter les 5 meilleures configurations et le temps d'entraînement.
- Le modèle final pour l'export (C5) est **réentraîné sur tous les utilisateurs** (entraînement + validation + test) avec la configuration retenue.

### D7. EASE (comparaison uniquement)

- Matrice `X` utilisateurs d'entraînement × films, mêmes valeurs que D2 avec le `β` retenu (et variante binaire).
- `G = XᵀX + λ_ease·I`, `P = G⁻¹`, `B = I − P · diag(1 / diag(P))` (diagonale de `B` à 0). Score d'un utilisateur : `x_u · B` avec son fold-in, sans entraînement supplémentaire.
- `λ_ease` testé : 100 ; 300 ; 1 000 ; 3 000 ; 10 000 (validation).
- **Mémoire** : `G` fait 23 019² × 4 octets ≈ 2,1 Go en float32 ; l'inversion en demande 3 à 4 fois plus. **Vérifier la RAM disponible avant de lancer.** Si elle ne suffit pas, préparer un notebook Google Colab à la place.
- EASE n'est **jamais exporté** vers le site.

### D8. Quantification et export

- Vecteurs des films en **int8**, échelle symétrique par film : `scale_i = max|y_i| / 127`, une échelle float32 par film.
- **`YᵀY` est calculé à partir des vecteurs déquantifiés**, pour que le navigateur fasse exactement le même calcul que le test.
- Critère : perte **< 1 % relative** sur `NDCG@20` et `Recall@20` (test, à λ = 0 et à une valeur de λ intermédiaire) entre float32 et int8.
- Fichiers produits dans `web/public/data/` (non versionnés) :
  - `embeddings.bin` : en-tête (magie `PEPE`, version, `n_items`, `dims`, little-endian), puis vecteurs int8 `n_items × dims`, puis échelles float32 `n_items` ;
  - `yty.bin` : float32 `dims × dims` ;
  - `model-meta.json` : version, date, `dims`, `regularization`, `alpha`, `β`, formule de confiance, source de popularité choisie, liste des `movie_id` dans l'ordre de `item_idx`, version des données (hash du manifeste) ;
  - `popularity.bin` : comptes de la source choisie (uint32), dans l'ordre de `item_idx`.
- **Cas de test du fold-in** : `pipeline/tests/fixtures/foldin_cases.json` (versionné) : 20 historiques de test (films, percentiles), vecteur attendu et top 10 attendu à λ = 0 et à λ intermédiaire. Calculés avec les vecteurs **déquantifiés**. Ils serviront à tester le code TypeScript à l'étape 4.
- `catalog.json` et `title-index.json` ne sont **pas** produits ici (étapes 3-4).

### D9. Seuil ≥ 10 (optionnel)

- Seulement si ALS ≥ 20 donne des résultats satisfaisants (C2-C4 validés).
- Construire un catalogue ≥ 10 dans un **dossier séparé** (ne pas écraser le catalogue ≥ 20), mêmes utilisateurs de validation/test, même protocole.
- EASE ≥ 10 : ~4,2 Go par matrice → Colab.
- Comparer : NDCG/Recall sur le held-out complet, `longue_traine@20`, `couverture@20`, taille de l'export. La décision revient à Thibault.

---

## 4. Sous-étapes

### C1 — Découpage, métriques, références

**Objectif** : le protocole d'évaluation complet, testé, avant tout modèle.

**Fichiers** : `pipeline/split.py`, `pipeline/metrics.py`, `pipeline/baselines.py`, `pipeline/evaluate.py` (lance un modèle sur la validation ou le test, écrit les résultats en JSON dans `pipeline/data/processed/results/`), tests associés. Constantes (`SEED`, tailles, seuil d'éligibilité) dans `config.py`.

**Sorties** : `pipeline/data/processed/split/` : `train.parquet`, `val_foldin.parquet`, `val_heldout.parquet`, `test_foldin.parquet`, `test_heldout.parquet`, `users.parquet` (userId → rôle).

**Critères** :
- 10 000 utilisateurs de validation, 10 000 de test, aucun utilisateur dans deux rôles ; nombre d'utilisateurs d'entraînement et d'éligibles rapportés.
- Chaque utilisateur de validation/test a ≥ 8 films en fold-in et ≥ 2 en held-out ; aucun film held-out n'a un timestamp antérieur au dernier film de son fold-in.
- Relancer `split.py` produit exactement les mêmes fichiers (hash identique).
- Métriques testées sur des exemples calculés à la main (Recall, NDCG, cas sans pertinent, cas avec moins de 20 pertinents).
- Résultats des références `populaire` et `hasard` sur la validation, avec intervalles de confiance. Attendu : `populaire` très au-dessus de `hasard`.
- Nombre d'utilisateurs de validation sans film pertinent rapporté.

### C2 — ALS

**Objectif** : entraîner ALS, évaluer par fold-in, régler les hyperparamètres.

**Fichiers** : ajouter `implicit` aux dépendances ; `pipeline/models/als.py` (entraînement, fold-in NumPy, scores), `pipeline/train.py`, tests.

**Critères** :
- Formule de confiance d'`implicit` documentée dans D2 (section 5).
- Fold-in maison vs recalcul d'`implicit` sur 200 utilisateurs de validation : similarité cosinus des vecteurs > 0,999 et top 20 identique pour ≥ 95 % d'entre eux.
- Tableau des ~30 configurations (validation, λ = 0), 5 meilleures mises en avant, temps d'entraînement.
- Vérification de convergence (15 vs 30 itérations) sur la meilleure configuration.
- La meilleure configuration bat `populaire` sur `NDCG@20` en validation, intervalles de confiance non chevauchants.
- Une seule évaluation sur le **test** avec la configuration retenue.
- Arrêt et compte rendu avant C3.

### C3 — EASE

**Objectif** : la référence de précision.

**Fichiers** : `pipeline/models/ease.py`, tests (petit exemple calculable à la main). Notebook Colab si la RAM manque.

**Critères** :
- RAM disponible vérifiée et rapportée avant le calcul.
- `λ_ease` choisi sur la validation ; résultats test EASE vs ALS vs références.
- Écart relatif ALS / EASE sur `NDCG@20` rapporté. Si ALS est plus de 20 % en dessous d'EASE : le signaler et proposer des pistes (plus de facteurs, autre `alpha`/`β`), sans les lancer.

### C4 — Curseur

**Objectif** : montrer que le curseur fonctionne et choisir la source de popularité.

**Fichiers** : `pipeline/slider.py` (re-classement D5), script de balayage, figures dans `docs/figures/` (PNG versionnés).

**Critères** :
- Balayage λ ∈ [−0,5 ; 2,0] pas 0,1, sur la validation, pour les deux sources de popularité : tableau complet + figure `etape2-curseur-validation.png` (précision vs `pop_mediane@20`, références en points).
- Pour 3 utilisateurs de test au profil différent : les 10 titres recommandés à λ = 0, λ intermédiaire et λ max (`tmdb_title`, année, nombre de notes). Contrôle qualitatif : les pépites ont-elles l'air cohérentes ?
- **Arrêt** : Thibault choisit la source de popularité et la plage de λ. Ensuite seulement, évaluation sur le test pour la configuration choisie + figure `etape2-curseur-test.png`.

### C5 — Modèle final, quantification, export

**Objectif** : les fichiers que le navigateur chargera.

**Fichiers** : `pipeline/export.py`, `pipeline/tests/fixtures/foldin_cases.json`, tests.

**Critères** :
- Modèle final réentraîné sur tous les utilisateurs avec la configuration retenue.
- Perte int8 vs float32 < 1 % relative (protocole D8, mesuré avec le modèle de C2 sur le test).
- `embeddings.bin` ≈ 23 019 × 64 + 23 019 × 4 octets ≈ 1,6 Mo ; tailles réelles de tous les fichiers rapportées (brutes et gzip).
- Relecture de `embeddings.bin` en Python → vecteurs identiques aux vecteurs déquantifiés.
- Les cas de test du fold-in se rejouent à l'identique depuis les fichiers exportés.
- Aucune colonne `imdbds_` dans ce qui est écrit dans `web/public/data/` (garde-fou `FORBIDDEN_WEB_PREFIXES`).

### C6 — Seuil ≥ 10 (optionnel)

Voir D9. Uniquement sur demande de Thibault.

### Fin de l'étape 2

Mettre à jour `docs/stack-technique.md` (§3, §4, §8, §9) et `CLAUDE.md` (étape 2 ✅, chiffres clés, commandes) avec les choix réels. Montrer le diff avant de committer.

---

## 5. Résultats

*À remplir par Claude Code à la fin de chaque sous-étape.*

### C1
### C2
### C3
### C4
### C5
### C6

---

## 6. Questions ouvertes (pour plus tard)

- Correspondance entre la position du curseur (0-100) et λ dans l'interface : à décider avec les courbes de C4 (étape 4-5).
- Évaluation sur de vrais historiques Letterboxd (nos exports, puis le dataset Letterboxd 10M en évaluation uniquement) : dès que l'adaptateur de l'étape 3 existe.
- Réentraînement périodique : pas prévu (MovieLens 32M est figé) ; seules les métadonnées TMDB sont rafraîchies chaque mois.
