# Stack technique et sources de données

> Version 0.4 (6 novembre 2026), décisions intégrées, étape 1 (pipeline de données) faite. Complète `projet-reco-films.md`.
> Principe directeur : **tout ce qui peut être calculé à l'avance l'est, et le site reste 100 % statique.** Pas de serveur à payer, pas de données utilisateur stockées.

---

## 1. Vue d'ensemble

```
┌─────────────── HORS LIGNE (notre PC / Google Colab) ───────────────┐
│                                                                     │
│  MovieLens 32M ─┐                                                   │
│  IMDb datasets ─┼─► Python : nettoyage, correspondance des ids,     │
│  TMDB API ──────┘   entraînement du modèle, évaluation              │
│                              │                                      │
│                              ▼                                      │
│            Fichiers statiques : vecteurs des films, popularité,     │
│            catalogue (titres, années, ids, affiches)                │
└──────────────────────────────┬──────────────────────────────────────┘
                               │  (régénérés chaque mois par GitHub Actions)
┌──────────────────────────────▼──── EN LIGNE (navigateur de l'utilisateur) ┐
│                                                                           │
│  Fichier de l'utilisateur ─► adaptateur ─► correspondance des titres      │
│        ─► calcul des scores ─► curseur connu/pépite ─► affichage          │
│                                                                           │
│  Hébergé sur Cloudflare Pages ou GitHub Pages (gratuit)                   │
└───────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Sources de données

### 2.1 Pour entraîner le modèle

| Source | Ce qu'on prend | Où | Licence | Rôle |
|---|---|---|---|---|
| **MovieLens 32M** (GroupLens) | `ratings.csv` (32 M de notes, ~200 000 utilisateurs, ~87 000 films, 1995-2023), `movies.csv`, `links.csv` (MovieLens ↔ IMDb ↔ TMDB) | grouplens.org/datasets/movielens/32m | Non commercial, citer le dataset | **Source principale** du filtrage collaboratif |
| **IMDb Non-Commercial Datasets** | `title.basics.tsv` (titres, titres originaux, année, durée, genres), `title.ratings.tsv` (note moyenne, nombre de votes) | datasets.imdbws.com | Usage personnel et non commercial | **Hors ligne uniquement** (jointures, vérification des imdbId, contrôles qualité), **jamais embarqué dans le site** |
| **TMDB API** | Affiches, réalisateurs, titres (`title`, `original_title`), année de sortie, `vote_count`, pays, langue, résumé, plateformes de streaming par pays | developer.themoviedb.org | Gratuit en non commercial, attribution obligatoire, cache ≤ 6 mois | Enrichir l'affichage, filtre « dispo en France » plus tard |

> **Popularité du curseur** : `ml_rating_count` ou `tmdb_vote_count`, choix à l'étape 2. Le champ `popularity` de TMDB n'est pas utilisé (indicateur de tendance, instable).

### 2.2 Pour évaluer (pas pour le site)

| Source | Rôle | Réserve |
|---|---|---|
| **Nos propres exports Letterboxd** + ceux de volontaires | Vérifier que le modèle marche sur de vrais cinéphiles | Avec leur accord |
| Dataset *Letterboxd 10M* (Hugging Face, déc. 2025) | Tester le biais « public MovieLens » vs « public Letterboxd » | Données scrapées, CC-BY-NC-SA : **usage d'évaluation uniquement**, jamais embarqué dans le site |

### 2.3 Fournies par l'utilisateur

| Source | Format | Identifiant disponible | Échelle de notes |
|---|---|---|---|
| **Letterboxd** | ZIP d'export : on lit `ratings.csv`, `watched.csv`, `diary.csv` (jamais `profile.csv`) | ❌ Pas d'id IMDb/TMDB : seulement titre + année + lien `boxd.it` (celui du journal désigne l'entrée, pas le film) | 0,5 à 5 |
| **IMDb** | CSV d'export des notes | ✅ Id IMDb (`tt…`) : correspondance directe | 1 à 10 |
| **Liste faite main** (plus tard) | Texte libre | ❌ Titre (et parfois année) | Variable ou absente |

> Colonnes de l'export Letterboxd vérifiées sur un vrai export (étape 3, `docs/etape-3-letterboxd.md` §2). Export IMDb : à vérifier à l'étape 6.

---

## 3. Partie hors ligne : données et modèle

| Besoin | Outil | Pourquoi |
|---|---|---|
| Langage | **Python 3.12** | Standard pour la data et les recsys |
| Gestion de l'environnement | **uv** | Rapide, simple, reproductible |
| Manipulation des données | **Polars** (ou pandas) | Polars tient 32 M de lignes sans problème sur un PC |
| Calcul matriciel | **NumPy**, **SciPy** (matrices creuses) | Base de tous les modèles |
| **Modèle retenu** | **ALS** via la librairie `implicit` 0.7 (64 facteurs, voir « Modèle ») | Vecteurs compacts, faciles à charger dans le navigateur |
| Modèle de comparaison (hors ligne uniquement) | **EASE** en NumPy/LAPACK, calculé sur Google Colab (RAM) | Référence de précision pour juger ALS ; jamais embarqué dans le site |
| Modèle n°3 (plus tard) | **SASRec** (PyTorch) exporté en ONNX | Tient compte de l'ordre du journal de visionnage |
| Évaluation | Scripts maison (Recall@20, NDCG@20, popularité médiane, longue traîne, couverture, régularité) | Mesurer précision **et** découverte |
| Figures | **matplotlib** (dépendance de développement) | Courbes du curseur, `docs/figures/` |
| Expérimentation | **Jupyter** en local ou **Google Colab** (gratuit) | Colab si le PC manque de RAM |
| Qualité du code | **ruff** | Lint + formatage |

### Points d'attention
- **Taille du catalogue embarqué (décidé)** : seuil bas de **≥ 20 notes** dans MovieLens, cible **~20 000 à 25 000 films**. On garde volontairement la longue traîne (ce sont les pépites). Seuil ajusté pour rester autour de **5 Mo** de données au total. **Réel : 23 019 films** (voir « Pipeline de données » ci-dessous).
- **Pourquoi ALS et pas EASE en production** : EASE produit une matrice film × film, trop lourde pour le navigateur. ALS donne un vecteur de 64-128 nombres par film.
- **Compression (fait)** : vecteurs quantifiés en **`int8`** (une échelle par film) → `embeddings.bin` = **1 565 308 octets** (1,46 Mo gzip). Perte mesurée sur le test : < 0,08 % de NDCG@20 et Recall@20.
- **Films récents (après 2023), décidé** : absents de MovieLens, donc non recommandables. **On accepte le trou au MVP** et on l'affiche honnêtement sur le site. En v2 : modèle basé sur le contenu (genres, mots-clés, réalisateur via TMDB).
- **Films de 2019-2023** : présents, mais avec peu de notes MovieLens parce que récents. Pour le curseur, leur popularité est relevée avec les votes TMDB (popularité hybride, voir « Modèle »).

### Pipeline de données (étape 1, faite)

Scripts dans `pipeline/` (lancés depuis ce dossier avec `uv run python <script>`), sorties dans `pipeline/data/processed/` (non versionnées) :

| Script | Rôle | Sorties |
|---|---|---|
| `download.py` | Télécharge MovieLens 32M + IMDb `title.basics` et `title.ratings` (seulement), avec un `manifest.json` (md5, dates) | `data/raw/`, `ratings.parquet` |
| `build_catalog.py` | Catalogue : seuil, exclusions et fusions, filtre de type | `catalog.parquet`, `ratings_filtered.parquet`, `movie_id_merges.parquet` |
| `enrich_tmdb.py` | Enrichissement TMDB + vérification des ids | `catalog.parquet` (colonnes TMDB ajoutées), `tmdb_mismatch.csv` |
| `titles.py` | Normalisation des titres « v2 » (identique à `web/src/matching/normalize.ts`, cas partagés dans `shared/fixtures/`), base de l'index de correspondance | — |
| `manual_overrides.csv` (versionné) | Corrections manuelles du catalogue, une ligne documentée par décision | — |

Étapes de `build_catalog.py`, dans l'ordre :
1. **Seuil ≥ 20 notes** sur les comptes bruts MovieLens, avant toute fusion → 23 350 films.
2. **Exclusions manuelles** (`manual_overrides.csv`, action `exclude`) → 1 (Mulholland Dr. 1999, pilote TV).
3. **Fusion des doublons** → `movie_id_merges.parquet` (15 fusions) :
   - automatiques (13) : deux movieIds avec le même tmdbId et des années à ±1 an. Fusion dans le movieId le plus noté ; une paire (utilisateur, film) en double garde la note la plus récente. Écart > 1 an : films différents, tmdb_id vidé et recherché via TMDB ;
   - manuelles (2, action `merge_into`) : appliquées seulement si le titre MovieLens normalisé et l'année (±1) concordent, sinon refusées et signalées ;
   - le canonique garde son movie_id et prend le meilleur imdb_id de la paire (et le tmdb_id qui va avec). Les anciens imdb_id (`imdb_id_from`, `imdb_id_to_original`) deviennent des alias. Colonne `origin` = `tmdb_duplicate` ou `manual`.
4. **Filtre de type** (hors ligne, via `titleType` des datasets IMDb) : `tvSeries`, `tvEpisode`, `tvMiniSeries` exclus (315). Gardés : `movie`, `tvMovie`, `short`, `tvShort`, `video`, `tvSpecial`, type inconnu.
5. Résultat : 23 350 − 1 − 315 − 15 = **23 019 films**, `ratings_filtered` ≈ 31,7 M de notes.

`enrich_tmdb.py` : un appel `/movie/{id}?append_to_response=credits` par film (20 req/s, nouveaux essais sur 429/5xx), `/find` pour les films sans tmdb_id et en cas d'écart. Cache allégé dans `data/cache/tmdb/` (réutilisé si < 30 jours, supprimé après 6 mois). L'imdb_id renvoyé par TMDB est vérifié pour **100 %** des films :
- corrections de tmdb_id (66) ;
- `imdb_id_outdated` quand TMDB porte l'imdb_id à jour du même film : titre et année (±1) concordent (25) ;
- le reste reste en `tmdb_mismatch`, avec une raison.

Couverture : tmdb_id 99,96 %, titre 99,8 %, année 99,8 %, réalisateurs 99,7 %, affiches 99,7 %.

Colonnes et règles à retenir :
- **Provenance** : colonnes `ml_*` (MovieLens), `tmdb_*` et champs TMDB (`poster_path`, `original_language`, `origin_country`), colonnes `imdbds_*` (datasets IMDb, **jamais** écrites dans `web/public/data/`). `imdb_id` vient de `links.csv`.
- **`year`** = `tmdb_release_year`, sinon `ml_year` : c'est l'année affichée (Letterboxd s'appuie sur TMDB).
- **`imdb_id_aliases`** : anciens imdb_id des fusions + imdb_id TMDB quand il diffère du nôtre (hors mismatch), pour l'adaptateur IMDb.
- **`recommendable`** (publiable) : `false` pour les films encore en `tmdb_mismatch` (51). Ils restent dans le catalogue et l'entraînement, mais ne sont jamais affichés en reco.
- **`item_idx`** = 0..n-1 dans l'ordre du catalogue. **Il est figé à l'entraînement ; l'export lit l'ordre sauvegardé avec les vecteurs, ne le recalcule jamais.** Une étape qui retire des films avant l'entraînement renumérote.

### Modèle (étape 2, faite)

Détail complet, chiffres et figures : `docs/etape-2-modele.md` (décisions D1-D9, résultats en section 5).

- **Protocole** : 10 000 utilisateurs de validation et 10 000 de test, jamais vus à l'entraînement ; pour chacun, les 80 % de notes les plus anciennes servent de fold-in, les 20 % les plus récentes sont à retrouver. Réglages sur la validation, test évalué une fois par modèle retenu.
- **Signal** : tout film vu est un positif, pondéré par le percentile de sa note dans l'historique de l'utilisateur (`r = 1 + β·p`, β = 1).
- **ALS retenu** (configuration A) : 64 facteurs, `regularization` 0,05, `alpha` 1, β 1, 30 itérations. Fold-in maison en NumPy, identique au recalcul d'`implicit` ; c'est la référence de la version TypeScript.
- **Résultats test** (NDCG@20) : ALS **0,1522** ; EASE (référence, jamais embarqué) 0,1715, soit ALS à −11,3 % ; `populaire` 0,0841 ; hasard 0,0010.
- **Curseur connu ↔ pépite** : **plafond de popularité**. À la position `plafond`, seuls les films avec au plus `plafond` « notes » sont candidats, classés par le score du modèle ; positions ∞ → 20 000 → 10 000 → 5 000 → 2 000 → 1 000 → 500 → 200. Retenu après comparaison de trois variantes (le re-classement `score − λ × log(popularité)` prévu au départ ne descendait pas assez et donnait des listes mixtes ou identiques pour tous).
- **Popularité** = `max(arrondi(ml_rating_count × f_année), arrondi(r × tmdb_vote_count))`, r = médiane MovieLens / TMDB des films de 2010-2018 (0,285), `f_année = max(1, r / r_année)` (rapport de l'année de sortie, de 1,08 en 2015 à 4,30 en 2023) : corrige les films récents, sous-représentés dans MovieLens.
- **Modèle final** : configuration A réentraînée sur tous les utilisateurs (200 948), vecteurs en int8.

| Script (`pipeline/`) | Rôle |
|---|---|
| `split.py` | découpage validation / test / entraînement → `data/processed/split/` |
| `metrics.py`, `baselines.py`, `evaluate.py` | métriques, références `populaire` / hasard, protocole d'évaluation |
| `models/als.py`, `train.py` | signal, entraînement ALS, fold-in NumPy, recherche d'hyperparamètres |
| `models/ease.py`, `train_ease.py`, `colab_bundle.py`, `notebooks/ease_colab.ipynb` | EASE (comparaison), paquet pour Google Colab |
| `slider.py`, `sweep_slider.py`, `slider_variants.py` | curseur : variantes, balayages, figures, évaluation test |
| `popularity.py` | popularité hybride MovieLens + TMDB |
| `export.py` | modèle final, int8, fichiers du site, cas de test du fold-in |

### Fichiers produits (dans `web/public/data/`)
Écrits par `export.py` (`export` pour le modèle, `catalog` pour le catalogue et l'index des titres). **Uniquement des champs MovieLens et TMDB**, rien qui vienne des datasets IMDb (garde-fou `FORBIDDEN_WEB_PREFIXES`). Non versionnés tant que GroupLens n'a pas répondu.

| Fichier | Contenu | Taille (gzip) |
|---|---|---|
| `embeddings.bin` | en-tête `PEPE` (version, `n_items`, `dims`), vecteurs int8 23 019 × 64 (ordre = `item_idx`), une échelle float32 par film | 1,57 Mo (1,46 Mo) |
| `yty.bin` | `YᵀY` 64 × 64 en float32, calculé sur les vecteurs déquantifiés (fold-in) | 16 Ko (12 Ko) |
| `popularity.bin` | popularité hybride (uint32 par film) : le plafond du curseur porte sur elle | 92 Ko (42 Ko) |
| `model-meta.json` | hyperparamètres, formules (signal, confiance, fold-in, popularité), positions du curseur, `movie_id` par `item_idx`, films non recommandables, versions des données | 140 Ko (58 Ko) |
| `catalog.json` | en colonnes, ordre = `item_idx` : titre affiché, titre original (s'il diffère), `year`, `tmdb_id`, `imdb_id`, `imdb_id_aliases`, réalisateurs, `poster_path`, genres MovieLens | 2,5 Mo (1,12 Mo) |
| `title-index.json` | clés de titre normalisées → `4 × item_idx + source` (titre TMDB, titre MovieLens, titre original, titre alternatif ML) ; `ml_year` quand il diffère | 1,07 Mo (0,37 Mo) |

Total mesuré : **3,06 Mo** gzip (5,4 Mo bruts), sous la cible de 5 Mo.

Les **cas de test du fold-in** (`foldin_cases.json`, 22 historiques, vecteur et top 10 attendus aux positions ∞, 2 000 et 500) contiennent des notes MovieLens brutes : ils sont écrits dans `web/test-data/` (ignoré par git, hors de `web/public/`, donc jamais servi) et ne sont **jamais versionnés**.

---

## 4. Partie en ligne : le site

| Besoin | Outil | Pourquoi |
|---|---|---|
| Langage | **TypeScript** | Typage, moins de bugs |
| Build / serveur de dev | **Vite** | Rapide, standard |
| Framework UI | **React 18+** (décidé) | Le plus répandu, énormément de ressources et d'aide |
| État de l'interface | `useState` / `useReducer` ; **Zustand** seulement si l'état devient partagé entre beaucoup d'écrans | Rester simple |
| Navigation entre écrans | **React Router**, ou un simple état « étape » si le site reste à 3-4 écrans | Pas besoin de plus pour un site statique |
| Style | **Tailwind CSS** | Rapide pour prototyper, cohérent |
| Polices | **Courier Prime** + **Caveat** (Google Fonts) | Direction visuelle « C · Fanzine » retenue |
| Lecture des CSV | **PapaParse** | Robuste, gère les virgules dans les titres, les encodages |
| Lecture du ZIP Letterboxd | **fflate** | Petit et rapide, dézippe dans le navigateur |
| Correspondance des titres | Index précalculé (`title-index.json`) + **Fuse.js** en dernier recours (préfiltre par trigrammes, par année) | Titre + année ±1, variantes ; le flou ne sert qu'à proposer des candidats |
| Calcul des scores | TypeScript pur sur des `Float32Array` | Produit scalaire sur ~23 000 films = quelques millisecondes |
| Calcul lourd sans bloquer la page | **Web Worker** | L'interface reste fluide pendant le calcul |
| Cache du modèle | **IndexedDB** (via `idb-keyval`) | Le modèle n'est téléchargé qu'une fois |
| Modèle SASRec (plus tard) | **ONNX Runtime Web** | Fait tourner un modèle PyTorch exporté dans le navigateur |
| Tests | **Vitest** + **React Testing Library** | Tester les adaptateurs, la normalisation des notes et les composants clés |
| Qualité du code | **ESLint** + **Prettier** | Standard |

### Comment on calcule une recommandation (ALS)
1. Signal : pour chaque film vu, `r = 1 + β·p`, `p` = percentile de sa note dans l'historique de l'utilisateur (0,5 sans note).
2. Vecteur de goût de l'utilisateur (« fold-in ») : résolution d'un système 64 × 64, `(YᵀY + reg·I + Σ (C − 1) y yᵀ) x = Σ C y` avec `C = alpha·r`, `YᵀY` lu dans `yty.bin`. Quelques millisecondes dans le navigateur.
3. Score de chaque film = produit scalaire entre ce vecteur et le vecteur du film (déquantifié).
4. On retire les films déjà vus, les films non recommandables (`model-meta.json`), et par prudence les candidats des correspondances ambiguës et le candidat principal d'une correspondance floue (films peut-être vus, jamais utilisés pour le fold-in).
5. **Curseur** : on ne garde que les films dont la popularité (`popularity.bin`) est au plus le plafond de la position choisie (∞ = pas de filtre), classés par score.
6. On affiche les 50 meilleurs.

Mise en œuvre (étape 4, `docs/etape-4-navigateur.md`) :
- `web/src/reco/` : `modelFiles.ts` (lecture et contrôles), `foldIn.ts` (Cholesky 64 × 64 en float64), `recommend.ts` (scores, curseur), `engine.ts` (moteur commun) ;
- `workerCore.ts` + `worker.ts` (Web Worker) et `client.ts` (promesses pour l'interface) ;
- rejoue à l'identique les listes du Python (écarts ~10⁻¹⁵) ;
- temps mesurés dans Node : lecture des fichiers 133 ms, préparation de la correspondance 405 ms (une fois), recommandations 19 ms pour un export réel, 42 ms pour 3 000 films.

Le score moyen de la liste par rapport à la position ∞ mesure l'éloignement du goût de l'utilisateur (0,17 en moyenne au plafond 2 000, 0,06 à 500, plus bas pour les profils grand public) : piste pour un avertissement dans l'interface (étape 5).

---

## 5. Hébergement et automatisation

| Besoin | Outil | Coût |
|---|---|---|
| Code source | **GitHub** | Gratuit |
| Hébergement du site | **Cloudflare Pages** (ou GitHub Pages) | Gratuit |
| Fichiers du modèle | Dans le site si < limite de taille par fichier de l'hébergeur ; sinon **Cloudflare R2** | Gratuit dans les quotas |
| Mise à jour mensuelle des métadonnées TMDB | **GitHub Actions** (tâche planifiée) | Gratuit |
| Nom de domaine | Registrar au choix | ~10-15 €/an (optionnel) |
| Statistiques de visite (optionnel) | **GoatCounter** ou équivalent sans cookies | Gratuit |
| Retours utilisateurs | Formulaire simple (Tally, Google Forms) | Gratuit |

> ⚠️ Limites de taille par fichier et quotas gratuits à vérifier au moment du déploiement.

### Pourquoi pas d'appel TMDB depuis le navigateur ?
Appeler TMDB depuis le site exposerait notre clé d'API. On **pré-calcule** donc les infos utiles (affiches, réalisateurs) dans `catalog.json` lors de la mise à jour mensuelle. Les images d'affiches, elles, sont chargées directement depuis le serveur d'images de TMDB (pas besoin de clé).

---

## 6. Fonctions « à garder en tête » : ce qu'elles demanderaient

| Fonction | Ce qu'il faut en plus | Impact sur la stack |
|---|---|---|
| **Liste faite main remise en forme par IA** (décidé) | **MVP : pas d'IA**, correspondance floue des titres (Fuse.js + index des titres). **Plus tard** : un petit modèle via API pour les cas difficiles. | L'API passe par un **Cloudflare Worker** (pour cacher la clé), avec une **limite d'usage** pour maîtriser le coût. Modèle dans le navigateur écarté pour l'instant (trop lourd). |
| **Scraping Letterboxd par pseudo** | Récupérer les pages publiques du profil | Impossible depuis le navigateur (CORS) → il faut un **Cloudflare Worker**. ⚠️ Contraire aux conditions de Letterboxd et fragile : option secondaire uniquement. |
| **Filtre « dispo en France »** | Endpoint *watch providers* de TMDB pour chaque film du catalogue | Pré-calculé chaque mois par GitHub Actions, ajouté à `catalog.json` (région FR uniquement). |
| **Explications** | Pour chaque reco, les films de l'utilisateur les plus proches | Aucun outil en plus : calcul de similarité entre vecteurs, déjà disponible. |
| **Autres imports** (SensCritique, Trakt…) | Un adaptateur par source | Aucun outil en plus si la source fournit un export. |
| **Films récents** | Modèle basé sur le contenu (genres, mots-clés, réalisateur, résumé) | Données TMDB + éventuellement embeddings de texte calculés hors ligne. |

---

## 7. Organisation du dépôt

```
projet/
├── pipeline/                 # Python 3.12, hors ligne (uv, Polars, ruff, pytest)
│   ├── pyproject.toml, uv.lock
│   ├── config.py             # chemins (RAW, PROCESSED, CACHE, WEB_DATA), MIN_RATINGS, charge .env
│   ├── download.py           # MovieLens 32M + IMDb title.basics/title.ratings → data/raw/
│   ├── build_catalog.py      # seuil, exclusions/fusions, filtre de type → catalog.parquet
│   ├── enrich_tmdb.py        # métadonnées TMDB + vérification des ids → catalog.parquet
│   ├── titles.py             # normalisation des titres (partagée)
│   ├── manual_overrides.csv  # corrections manuelles du catalogue (versionné)
│   ├── split.py              # découpage validation / test / entraînement
│   ├── metrics.py, baselines.py, evaluate.py  # protocole d'évaluation
│   ├── models/               # als.py (ALS + fold-in), ease.py (comparaison)
│   ├── train.py, train_ease.py, colab_bundle.py  # entraînement, recherche, EASE (Colab)
│   ├── slider.py, sweep_slider.py, slider_variants.py  # curseur
│   ├── popularity.py         # popularité hybride MovieLens + TMDB
│   ├── export.py             # modèle final, int8 → web/public/data, cas de test du fold-in
│   ├── notebooks/            # 01_explore.py (seuils), ease_colab.ipynb (EASE sur Colab)
│   ├── tests/                # un fichier de tests par module
│   └── data/                 # raw/, processed/, cache/tmdb/ : contenu ignoré par git
├── web/                      # site statique : Vite + React + TypeScript (npm, Vitest, ESLint, Prettier)
│   ├── src/
│   │   ├── adapters/         # types.ts (format commun), letterboxd.ts, normalizeRatings.ts (percentiles) ; imdb.ts (étape 6)
│   │   ├── matching/         # normalize.ts, titleIndex.ts, match.ts, history.ts
│   │   ├── reco/             # modelFiles, foldIn, recommend, engine, workerCore, worker, client
│   │   ├── components/       # composants React (Curseur, CarteFilm, ZoneDepot…)
│   │   ├── pages/            # Accueil, Analyse, Resultats, Fiche
│   │   └── styles/           # tokens de la direction C (design-system.md)
│   ├── public/data/          # fichiers produits par le pipeline (non versionnés)
│   ├── scripts/              # match-report.ts, reco-report.ts, reco-bench.ts (terminal seulement)
│   └── test-data/            # ignoré par git, jamais servi : cas de test du fold-in, titres du catalogue, exports réels, rapports
├── shared/fixtures/          # cas de normalisation des titres partagés Python / TypeScript (versionnés)
├── .github/workflows/        # mise à jour mensuelle TMDB (à venir)
├── docs/                     # projet-reco-films.md, stack-technique.md, design-system.md, etat-de-l-art.md, etape-2-modele.md, etape-3-letterboxd.md, maquette, figures/
└── CLAUDE.md                 # instructions pour Claude Code
```

### Commandes du pipeline (depuis `pipeline/`)

```sh
uv sync                                  # environnement (Python 3.12) depuis uv.lock
uv run python download.py                # données brutes (--force, --skip-imdb)
uv run python build_catalog.py           # catalogue (--min-ratings N), ~20 s
uv run python enrich_tmdb.py --limit 50  # essai sur 50 films, catalogue non modifié
uv run python enrich_tmdb.py             # tout le catalogue (~20 min sans cache, quelques minutes au plus avec)
uv run ruff check . && uv run ruff format --check .
uv run pytest

# étape 2 (modèle)
uv run python split.py                  # découpage validation / test
uv run python train.py search           # recherche ALS (validation)
uv run python slider_variants.py sweep  # variantes du curseur (validation)
uv run python export.py train           # modèle final (tous les utilisateurs, ~3 min)
uv run python export.py int8-check      # perte int8 (test)
uv run python export.py export          # → data/processed/export/ (relecture)
uv run python export.py export --out web  # → web/public/data/ + web/test-data/
uv run python export.py verify [--out web]  # relecture + rejeu des cas de test du fold-in

# étape 3 (correspondance des titres)
uv run python export.py catalog [--out web]       # catalog.json + title-index.json
uv run python export.py catalog-verify [--out web]
uv run python title_fixtures.py catalog-keys       # titres du catalogue pour le test TypeScript exhaustif
uv run python match_diagnostics.py ../web/test-data/reports/<nom>.json  # films non reconnus
```

### Commandes du site (depuis `web/`)

```sh
npm install
npm run dev                 # serveur de développement
npm test                    # Vitest (cas partagés, adaptateur, correspondance…)
npm run typecheck && npm run lint && npm run format:check
npm run build
npm run match-report -- test-data/exports/<export> --name <nom>  # mesure sur un export réel
npm run reco-report -- test-data/exports/<export>  # top 20 à ∞ / 2 000 / 500 (terminal)
npm run reco-bench -- [--export <export>]          # temps du moteur
```

Relancer `build_catalog.py` réécrit `catalog.parquet` sans les colonnes TMDB : relancer ensuite `enrich_tmdb.py` (il repart du cache).

### Secrets
- `TMDB_API_KEY` (clé v3) et `TMDB_READ_TOKEN` (jeton v4, optionnel) : stockés **uniquement** dans les secrets GitHub (Settings → Secrets and variables → Actions) et dans le fichier `.env` à la racine, **ignoré par git** (modèle vide : `.env.example`). Jamais dans le code du site, jamais dans un commit.

---

## 8. Ordre de construction conseillé

1. ✅ **Pipeline de données** : télécharger MovieLens + IMDb, construire le catalogue et les correspondances d'ids (fait : 23 019 films, enrichis par TMDB, voir §3).
2. ✅ **Modèle** : ALS (et EASE pour comparer), évaluation hors ligne avec et sans curseur (fait : ALS 64 facteurs, NDCG@20 test 0,152, EASE 0,172 ; curseur = plafond de popularité ; export int8 de 1,57 Mo, voir §3 « Modèle »).
3. ✅ **Adaptateur Letterboxd** + correspondance des titres (fait, `docs/etape-3-letterboxd.md` : sur l'export de Thibault, 188/188 films du catalogue reconnus, précision vérifiée à la main 100/100, 0 échec ; les 37 autres films sont hors catalogue, sortis après 2023 ou séries). L'index de correspondance utilise `tmdb_title`, `tmdb_original_title` et `ml_title` nettoyé (article replacé : « Usual Suspects, The » → « The Usual Suspects »), plus le titre alternatif entre parenthèses, tous normalisés (casse, accents, ponctuation, comme `pipeline/titles.py`), avec les deux années (TMDB et ML) acceptées à ±1 an. Mesuré en B4 : 28,6 % des titres TMDB diffèrent du titre ML brut normalisé, 6,7 % après nettoyage.
4. ✅ **Calcul dans le navigateur** : fold-in, scores, curseur, dans un Web Worker (fait : 22 vecteurs et 66 listes top 10 rejoués à l'identique ; 19 ms par recommandation pour un export réel). Diagnostic du biais des films récents : `docs/etape-4-navigateur.md` §6, décision en attente.
5. **Interface** : dépôt du fichier, liste de recos, curseur.
6. **Adaptateur IMDb**.
7. Mise en ligne, tests avec 10-20 cinéphiles.
8. Ensuite seulement : explications, dispo en France, liste faite main, scraping.

---

## 9. Décisions prises (6-8 novembre 2026, étapes 1-4)

| Sujet | Décision |
|---|---|
| Modèle en production | **ALS** (EASE seulement pour comparer hors ligne) : 64 facteurs, `reg` 0,05, `alpha` 1, β 1, 30 itérations, réentraîné sur tous les utilisateurs |
| Curseur | **Plafond de popularité**, 8 positions (∞ → 20 000 → 10 000 → 5 000 → 2 000 → 1 000 → 500 → 200), classement par le score du modèle ; pas de transition douce au MVP |
| Popularité | `max(arrondi(ml_rating_count × f_année), arrondi(0,285 × tmdb_vote_count))`, `f_année = max(1, 0,285 / r_année)` (correction des films récents par année de sortie, adoptée le 8 novembre 2026) |
| Export | Vecteurs **int8** + `YᵀY` déquantifié ; cas de test du fold-in jamais versionnés (notes MovieLens brutes) |
| Catalogue | **≥ 20 notes**, ~20 000 à 25 000 films (réel : 23 019), ~5 Mo de données |
| Données IMDb | **Hors ligne uniquement** (jointures, vérif des imdbId, contrôles qualité), jamais embarquées ; colonnes préfixées `imdbds_` |
| Corrections du catalogue | Fusions de doublons, filtre de type, `manual_overrides.csv` versionné ; films en mismatch TMDB gardés pour l'entraînement mais `recommendable = false` |
| `item_idx` | Figé à l'entraînement ; l'export lit l'ordre sauvegardé avec les vecteurs, ne le recalcule jamais |
| Films récents | Après 2023 : **trou accepté au MVP**, modèle de contenu en v2. 2019-2023 : popularité corrigée par TMDB pour le curseur |
| Framework | **React** + Vite + TypeScript |
| Correspondance des titres | Normalisation v2 identique Python / TypeScript ; titre + année ±1 (TMDB ou ML), variantes ; **flou (Fuse.js) jamais utilisé automatiquement** (séries rattachées à des films), seulement proposé dans l'écran « films non reconnus » |
| Export Letterboxd | Lu dans le navigateur ; `ratings.csv`, `watched.csv`, `diary.csv` seulement ; journal rattaché par (titre, année) |
| Dataset Letterboxd 10M | **Non utilisé** (collecte probablement par scraping, pas de vérité terrain) |
| Calcul des recos | Moteur TypeScript unique (Web Worker + scripts), identique au Python ; exclus : vus, non recommandables, candidats ambigus, candidat flou principal |
| IA pour les listes faites main | **Pas d'IA au MVP** (Fuse.js) ; API + Cloudflare Worker plus tard |
| Licences | **Contact direct** avec GroupLens et TMDB |

## 10. Actions

- [x] Clé API TMDB obtenue (à stocker dans les secrets GitHub et un `.env` local ignoré par git)
- [x] Mail envoyé à GroupLens → réponse en attente (bloquante seulement pour la mise en ligne)
- [x] Framework choisi : React

## 11. Questions encore ouvertes

- [ ] Réponse de GroupLens
