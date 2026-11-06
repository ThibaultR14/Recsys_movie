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
| **Letterboxd** | ZIP d'export (`ratings.csv`, `watched.csv`, `diary.csv`, `watchlist.csv`) | ❌ Pas d'id IMDb/TMDB : seulement titre + année + URL Letterboxd | 0,5 à 5 |
| **IMDb** | CSV d'export des notes | ✅ Id IMDb (`tt…`) : correspondance directe | 1 à 10 |
| **Liste faite main** (plus tard) | Texte libre | ❌ Titre (et parfois année) | Variable ou absente |

> ⚠️ Colonnes exactes des exports à vérifier sur de vrais fichiers avant de coder les adaptateurs.

---

## 3. Partie hors ligne : données et modèle

| Besoin | Outil | Pourquoi |
|---|---|---|
| Langage | **Python 3.12** | Standard pour la data et les recsys |
| Gestion de l'environnement | **uv** | Rapide, simple, reproductible |
| Manipulation des données | **Polars** (ou pandas) | Polars tient 32 M de lignes sans problème sur un PC |
| Calcul matriciel | **NumPy**, **SciPy** (matrices creuses) | Base de tous les modèles |
| **Modèle retenu** | **ALS** via la librairie `implicit` | Vecteurs compacts, faciles à charger dans le navigateur |
| Modèle de comparaison (hors ligne uniquement) | **EASE** codé en NumPy (~20 lignes) | Référence de précision pour juger ALS ; jamais embarqué dans le site |
| Modèle n°3 (plus tard) | **SASRec** (PyTorch) exporté en ONNX | Tient compte de l'ordre du journal de visionnage |
| Évaluation | Scripts maison (Recall@20, NDCG@20, popularité moyenne, couverture du catalogue) | Mesurer précision **et** découverte |
| Expérimentation | **Jupyter** en local ou **Google Colab** (gratuit) | Colab si le PC manque de RAM |
| Qualité du code | **ruff** | Lint + formatage |

### Points d'attention
- **Taille du catalogue embarqué (décidé)** : seuil bas de **≥ 20 notes** dans MovieLens, cible **~20 000 à 25 000 films**. On garde volontairement la longue traîne (ce sont les pépites). Seuil ajusté pour rester autour de **5 Mo** de données au total. **Réel : 23 019 films** (voir « Pipeline de données » ci-dessous).
- **Pourquoi ALS et pas EASE en production** : EASE produit une matrice film × film, trop lourde pour le navigateur. ALS donne un vecteur de 64-128 nombres par film.
- **Compression** : vecteurs en `float16` ou quantifiés en `int8` → 23 019 films × 64 dims × 1 octet ≈ **1,5 Mo** (≈ 1,4 Mo gzip, mesuré à l'exploration des seuils).
- **Films récents (après 2023), décidé** : absents de MovieLens, donc non recommandables. **On accepte le trou au MVP** et on l'affiche honnêtement sur le site. En v2 : modèle basé sur le contenu (genres, mots-clés, réalisateur via TMDB).

### Pipeline de données (étape 1, faite)

Scripts dans `pipeline/` (lancés depuis ce dossier avec `uv run python <script>`), sorties dans `pipeline/data/processed/` (non versionnées) :

| Script | Rôle | Sorties |
|---|---|---|
| `download.py` | Télécharge MovieLens 32M + IMDb `title.basics` et `title.ratings` (seulement), avec un `manifest.json` (md5, dates) | `data/raw/`, `ratings.parquet` |
| `build_catalog.py` | Catalogue : seuil, exclusions et fusions, filtre de type | `catalog.parquet`, `ratings_filtered.parquet`, `movie_id_merges.parquet` |
| `enrich_tmdb.py` | Enrichissement TMDB + vérification des ids | `catalog.parquet` (colonnes TMDB ajoutées), `tmdb_mismatch.csv` |
| `titles.py` | Normalisation des titres (partagée par B3/B4, base de l'index de correspondance) | — |
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

### Fichiers produits (dans `web/public/data/`)
Écrits par `export.py` (à venir). **Uniquement des champs MovieLens et TMDB**, rien qui vienne des datasets IMDb.

| Fichier | Contenu | Taille (estimée à l'exploration, gzip, seuil 20) |
|---|---|---|
| `catalog.json` | `item_idx`, `tmdb_id`, `imdb_id`, `imdb_id_aliases`, titre et titre original TMDB, `year`, réalisateurs TMDB, `poster_path`, genres MovieLens, `recommendable` | ~1,35-1,5 Mo (gzip/brotli par l'hébergeur) |
| `embeddings.bin` | vecteurs des films (binaire, ordre = `item_idx`) | ~1,4 Mo (int8, 64 dims) |
| `popularity.bin` | `ml_rating_count` ou `tmdb_vote_count` (choix à l'étape 2), en log, pour le curseur | ~40 Ko |
| `title-index.json` | index de correspondance : `tmdb_title`, `tmdb_original_title`, `ml_title` nettoyé + titre alternatif entre parenthèses, normalisés, avec les deux années (TMDB et ML) | à mesurer |

Total estimé ≈ **2,8 Mo** gzip hors index des titres, sous la cible de ~5 Mo.

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
| Correspondance floue des titres | **Fuse.js** (ou un index maison normalisé) | Gérer « Le Fabuleux Destin d'Amélie Poulain » vs « Amélie » |
| Calcul des scores | TypeScript pur sur des `Float32Array` | Produit scalaire sur ~23 000 films = quelques millisecondes |
| Calcul lourd sans bloquer la page | **Web Worker** | L'interface reste fluide pendant le calcul |
| Cache du modèle | **IndexedDB** (via `idb-keyval`) | Le modèle n'est téléchargé qu'une fois |
| Modèle SASRec (plus tard) | **ONNX Runtime Web** | Fait tourner un modèle PyTorch exporté dans le navigateur |
| Tests | **Vitest** + **React Testing Library** | Tester les adaptateurs, la normalisation des notes et les composants clés |
| Qualité du code | **ESLint** + **Prettier** | Standard |

### Comment on calcule une recommandation (ALS)
1. On construit le vecteur de goût de l'utilisateur à partir de ses films notés (« fold-in » : une petite résolution de moindres carrés, faisable dans le navigateur).
2. Score de chaque film = produit scalaire entre ce vecteur et le vecteur du film.
3. On retire les films déjà vus et les films `recommendable = false`.
4. **Curseur** : `score_final = score − λ × log(popularité)`, λ suit la position du curseur.
5. On affiche les 50 meilleurs.

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
│   ├── train.py              # (à venir) entraîne ALS / EASE
│   ├── evaluate.py           # (à venir) Recall, NDCG, popularité, couverture
│   ├── export.py             # (à venir) écrit les fichiers dans web/public/data
│   ├── notebooks/            # 01_explore.py (seuils du catalogue)
│   ├── tests/                # test_download, test_catalog, test_manual_overrides, test_enrich_tmdb…
│   └── data/                 # raw/, processed/, cache/tmdb/ : contenu ignoré par git
├── web/                      # site statique (Vite pas encore initialisé)
│   ├── src/
│   │   ├── adapters/         # letterboxd.ts, imdb.ts, (manual.ts)
│   │   ├── matching/         # correspondance des titres
│   │   ├── reco/             # fold-in, scores, curseur (dans un Web Worker)
│   │   ├── components/       # composants React (Curseur, CarteFilm, ZoneDepot…)
│   │   ├── pages/            # Accueil, Analyse, Resultats, Fiche
│   │   └── styles/           # tokens de la direction C (design-system.md)
│   └── public/data/          # fichiers produits par le pipeline
├── .github/workflows/        # mise à jour mensuelle TMDB (à venir)
├── docs/                     # projet-reco-films.md, stack-technique.md, design-system.md, etat-de-l-art.md, maquette
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
```

Relancer `build_catalog.py` réécrit `catalog.parquet` sans les colonnes TMDB : relancer ensuite `enrich_tmdb.py` (il repart du cache).

### Secrets
- `TMDB_API_KEY` (clé v3) et `TMDB_READ_TOKEN` (jeton v4, optionnel) : stockés **uniquement** dans les secrets GitHub (Settings → Secrets and variables → Actions) et dans le fichier `.env` à la racine, **ignoré par git** (modèle vide : `.env.example`). Jamais dans le code du site, jamais dans un commit.

---

## 8. Ordre de construction conseillé

1. ✅ **Pipeline de données** : télécharger MovieLens + IMDb, construire le catalogue et les correspondances d'ids (fait : 23 019 films, enrichis par TMDB, voir §3).
2. **Modèle** : ALS (et EASE pour comparer), évaluation hors ligne avec et sans curseur.
3. **Adaptateur Letterboxd** + correspondance des titres, testé sur nos propres exports. L'index de correspondance utilise `tmdb_title`, `tmdb_original_title` et `ml_title` nettoyé (article replacé : « Usual Suspects, The » → « The Usual Suspects »), plus le titre alternatif entre parenthèses, tous normalisés (casse, accents, ponctuation, comme `pipeline/titles.py`), avec les deux années (TMDB et ML) acceptées à ±1 an. Mesuré en B4 : 28,6 % des titres TMDB diffèrent du titre ML brut normalisé, 6,7 % après nettoyage.
4. **Calcul dans le navigateur** : fold-in, scores, curseur.
5. **Interface** : dépôt du fichier, liste de recos, curseur.
6. **Adaptateur IMDb**.
7. Mise en ligne, tests avec 10-20 cinéphiles.
8. Ensuite seulement : explications, dispo en France, liste faite main, scraping.

---

## 9. Décisions prises (6 novembre 2026)

| Sujet | Décision |
|---|---|
| Modèle en production | **ALS** (EASE seulement pour comparer hors ligne) |
| Catalogue | **≥ 20 notes**, ~20 000 à 25 000 films (réel : 23 019), ~5 Mo de données |
| Données IMDb | **Hors ligne uniquement** (jointures, vérif des imdbId, contrôles qualité), jamais embarquées ; colonnes préfixées `imdbds_` |
| Corrections du catalogue | Fusions de doublons, filtre de type, `manual_overrides.csv` versionné ; films en mismatch TMDB gardés pour l'entraînement mais `recommendable = false` |
| `item_idx` | Figé à l'entraînement ; l'export lit l'ordre sauvegardé avec les vecteurs, ne le recalcule jamais |
| Films récents | **Trou accepté au MVP**, modèle de contenu en v2 |
| Framework | **React** + Vite + TypeScript |
| IA pour les listes faites main | **Pas d'IA au MVP** (Fuse.js) ; API + Cloudflare Worker plus tard |
| Licences | **Contact direct** avec GroupLens et TMDB |

## 10. Actions

- [x] Clé API TMDB obtenue (à stocker dans les secrets GitHub et un `.env` local ignoré par git)
- [x] Mail envoyé à GroupLens → réponse en attente (bloquante seulement pour la mise en ligne)
- [x] Framework choisi : React

## 11. Questions encore ouvertes

- [ ] Réponse de GroupLens
