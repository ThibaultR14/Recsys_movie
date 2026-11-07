# CLAUDE.md — Pépite (nom de travail)

Site gratuit de recommandation de films pour cinéphiles. L'utilisateur dépose son export Letterboxd (ZIP) ou IMDb (CSV), et le site lui recommande des films qu'il n'a pas vus, avec un curseur « connu ↔ pépite ». Projet étudiant (M2, ECE Paris), non commercial.

Documentation de référence dans `docs/` — **la lire avant toute décision structurante** :
- `docs/projet-reco-films.md` : vision, fonctionnalités, décisions, contraintes
- `docs/stack-technique.md` : stack, sources de données, architecture, ordre de construction
- `docs/design-system.md` : direction visuelle « C · Fanzine » (couleurs, polices, composants, ton)
- `docs/maquette-C-fanzine.html` : maquette de référence (accueil + recommandations)
- `docs/etat-de-l-art.md` : concurrents et positionnement

## Architecture (ne pas dévier sans en parler)

- **Site 100 % statique.** Pas de serveur, pas de base de données, pas de comptes.
- **Tout le calcul de reco se fait dans le navigateur** (Web Worker). Les données de l'utilisateur ne quittent jamais son navigateur : aucun appel réseau ne doit contenir ses films ou ses notes.
- **Pipeline Python hors ligne** (`pipeline/`) : MovieLens 32M + TMDB (+ IMDb datasets pour les contrôles hors ligne seulement, voir « Données IMDb ») → modèle **ALS** → fichiers statiques dans `web/public/data/`.
- Arborescence : `pipeline/` (`config.py`, `download.py`, `build_catalog.py`, `enrich_tmdb.py`, `titles.py`, `manual_overrides.csv`, étape 2 : `split.py`, `metrics.py`, `baselines.py`, `evaluate.py`, `models/`, `train.py`, `train_ease.py`, `colab_bundle.py`, `slider.py`, `sweep_slider.py`, `slider_variants.py`, `popularity.py`, `export.py`, `{notebooks,tests,data/raw,data/processed,data/cache}`), `web/src/{adapters,matching,reco,components,pages,styles}`, `web/public/data/`, `web/test-data/` (ignoré), `.github/workflows/`, `docs/` (dont `etape-2-modele.md`, `figures/` ; voir `docs/stack-technique.md` §7).
- Corrections manuelles du catalogue : **uniquement** via `pipeline/manual_overrides.csv` (`exclude` / `merge_into`, avec une raison), jamais en dur dans le code.
- **Front** (`web/`) : **React + Vite + TypeScript**, Tailwind CSS, PapaParse, fflate, Fuse.js, idb-keyval.
- Hébergement : Cloudflare Pages (ou GitHub Pages). Métadonnées TMDB rafraîchies chaque mois par GitHub Actions.

## Décisions prises (ne pas remettre en question sans raison)

- Modèle en production : **ALS** (`implicit`), 64 facteurs, `regularization` 0,05, `alpha` 1, β 1, 30 itérations, réentraîné sur tous les utilisateurs, vecteurs en int8. EASE uniquement pour comparer hors ligne.
- Catalogue : films avec **≥ 20 notes** MovieLens, ~20 000–25 000 films, ~5 Mo de données au total.
- Curseur : **plafond de popularité**. À chaque position, seuls les films avec une popularité ≤ plafond sont candidats, classés par le score du modèle ; positions ∞ → 20 000 → 10 000 → 5 000 → 2 000 → 1 000 → 500 → 200 (∞ = ordre du modèle). Popularité = `max(ml_rating_count, arrondi(r × tmdb_vote_count))`, r ≈ 0,285 (films récents). Le re-classement `score − λ × log(popularité)` a été testé et écarté (`docs/etape-2-modele.md`, D5).
- Films récents (après 2023) : **trou accepté au MVP**, à signaler honnêtement dans l'interface.
- Import : architecture d'**adaptateurs** (un par source) qui produisent tous le même format interne `{ titre, annee, imdbId?, tmdbId?, noteNormalisee, date? }`. Notes normalisées en percentiles par utilisateur.
- Pas d'IA au MVP pour les listes faites main : correspondance floue (Fuse.js).
- Scraping Letterboxd : **hors MVP**, option secondaire seulement (contraire aux conditions de Letterboxd).

## Règles impératives

- **Clé TMDB** : jamais dans le code, jamais dans un commit, jamais affichée dans une sortie de commande. Variables `TMDB_API_KEY` (clé v3) et `TMDB_READ_TOKEN` (jeton v4 « API Read Access Token », optionnel) dans le `.env` à la racine (ignoré par git, modèle vide : `.env.example`) et dans les secrets GitHub Actions. Le pipeline les lit via `python-dotenv`. Le site n'appelle jamais l'API TMDB : les données sont pré-calculées par le pipeline ; seules les images d'affiches sont chargées depuis `image.tmdb.org`.
- **Licences** : MovieLens, TMDB et IMDb datasets sont en usage **non commercial**. Pas de pub, pas de fonctions payantes, pas de liens affiliés, pas de bouton de dons sans validation.
- **Mentions obligatoires** sur la page « à propos » : logo TMDB + « This product uses the TMDB API but is not endorsed or certified by TMDB. » ; citation MovieLens (Harper & Konstan, 2015) sans laisser croire à un soutien de l'Université du Minnesota.
- **Ne jamais utiliser « Letterboxd » ou « IMDb » dans le nom ou le logo.** « Compatible avec les exports Letterboxd et IMDb » est OK.
- Les datasets Letterboxd scrapés (Hugging Face, Kaggle) servent **uniquement à l'évaluation**, jamais embarqués dans le site.
- **Données IMDb** : les datasets IMDb (datasets.imdbws.com) servent **uniquement hors ligne** (jointures, vérification des `imdbId`, contrôles qualité). **Rien de ce qui est embarqué dans le site** (réalisateurs, popularité, titres, index de correspondance) **ne vient d'IMDb** : uniquement TMDB ou MovieLens. Les colonnes issues des datasets IMDb portent le préfixe `imdbds_` et ne doivent **jamais** être écrites dans `web/public/data/`. L'`imdb_id` (`tt…`) vient de MovieLens `links.csv` et reste autorisé.
- Données brutes (MovieLens, IMDb) dans `pipeline/data/raw/`, intermédiaires dans `pipeline/data/processed/`, cache des appels TMDB dans `pipeline/data/cache/` : **contenu ignoré par git** (seuls les `.gitkeep` sont versionnés).
- **`item_idx` est figé à l'entraînement ; l'export lit l'ordre sauvegardé avec les vecteurs, ne le recalcule jamais.** (Si une étape du pipeline retire des films avant l'entraînement, elle renumérote 0..n-1.)
- **`web/public/data/` n'est pas versionné tant que GroupLens n'a pas répondu** sur la licence (données dérivées de MovieLens). Seul le `.gitkeep` y est suivi.
- **Aucune note MovieLens brute dans le dépôt** : les cas de test du fold-in (`foldin_cases.json`) sont générés par `export.py` dans `pipeline/data/processed/export/` ou `web/test-data/`, tous deux ignorés par git ; les tests qui en dépendent sont sautés s'ils sont absents. (Un ancien commit les contenait : historique purgé le 7 novembre 2026.)

## Conventions

- Code, noms de variables et commentaires : **anglais**. Textes de l'interface : **français**, ton de `docs/design-system.md` (tutoiement, minuscules, simple, un peu d'humour).
- Python : 3.12, `uv`, Polars, `ruff` pour le lint et le formatage.
- TypeScript : strict, ESLint + Prettier, tests Vitest (+ React Testing Library pour les composants).
- Accessibilité : vrais `<button>`, `<a>`, `<label>` + `<input>` ; contraste AA ; zones tactiles ≥ 44 px ; fonctionne sur téléphone.
- Commits petits et descriptifs. Tester les adaptateurs d'import sur de vrais exports avant de les considérer terminés.

## Ordre de construction

1. ✅ Pipeline de données : téléchargement MovieLens + IMDb, catalogue, correspondances d'ids (MovieLens ↔ IMDb ↔ TMDB via `links.csv`). Fait : 23 019 films (seuil 20 → 23 350, − 1 exclu à la main, − 315 séries/épisodes, − 15 fusions) ; TMDB : tmdb_id 99,96 %, titres/années 99,8 %, réalisateurs et affiches 99,7 % ; 51 films `recommendable = false`.
2. ✅ Modèle ALS + évaluation hors ligne, avec et sans curseur. Fait (`docs/etape-2-modele.md`) : ALS 64 facteurs, NDCG@20 test **0,152** (EASE 0,172, −11 % ; populaire 0,084) ; curseur = plafond de popularité (8 positions) ; popularité hybride MovieLens/TMDB ; export int8 dans `web/public/data/` : `embeddings.bin` 1,57 Mo, `yty.bin`, `popularity.bin`, `model-meta.json` (1,57 Mo gzip au total) ; perte int8 < 0,08 % ; 22 cas de test du fold-in pour l'étape 4.
3. Adaptateur Letterboxd + correspondance des titres (titre + année → id).
4. Calcul dans le navigateur : fold-in ALS, scores, curseur (plafond) ; à valider contre `web/test-data/foldin_cases.json` (régénérer avec `export.py export --out web` s'il manque).
5. Interface (style C) : accueil / dépôt, analyse du fichier, résultats + curseur, fiche film.
6. Adaptateur IMDb.
7. Mise en ligne (après la réponse de GroupLens), tests avec 10–20 cinéphiles.
8. Ensuite : explications, dispo en France, listes faites main, scraping.

## Quand s'arrêter

Méthode de travail : avancer seul, ne s'arrêter qu'aux points de décision.

- **Tous les critères d'une sous-étape atteints et rien à trancher** : résultats dans la section 5 de la spec d'étape, commit, push, puis sous-étape suivante **sans demander**.
- **S'arrêter seulement si** :
  - un critère échoue ;
  - un choix sort d'une décision écrite (D1-D9 de la spec d'étape, ou §9 de `docs/stack-technique.md`) ;
  - la spec prévoit explicitement un arrêt ;
  - une action est irréversible ou touche aux secrets.
- **Avant chaque arrêt** : tout est commité et poussé (`git status` à jour avec `origin`), et la section 5 de la spec est à jour, pour qu'une relecture puisse se faire directement depuis GitHub.

## Commandes

### Pipeline (depuis `pipeline/`)

```sh
uv sync                    # crée pipeline/.venv à partir de uv.lock (Python 3.12)
uv run ruff check .        # lint
uv run ruff format .       # formatage (--check pour vérifier sans modifier)
uv run pytest              # tests

uv run python download.py                # données brutes → data/raw/ (--force, --skip-imdb)
uv run python build_catalog.py           # catalogue → data/processed/ (--min-ratings N)
uv run python enrich_tmdb.py --limit 50  # essai TMDB, catalogue non modifié
uv run python enrich_tmdb.py             # enrichissement complet (repart du cache data/cache/tmdb/)
```

Étape 2 (modèle) :

```sh
uv run python split.py                    # découpage validation / test (déterministe)
uv run python train.py search             # recherche ALS sur la validation
uv run python slider_variants.py sweep    # variantes du curseur (validation) ; test : `test`
uv run python export.py train             # modèle final, tous les utilisateurs (~3 min)
uv run python export.py int8-check        # perte int8 sur le test
uv run python export.py export            # → data/processed/export/ (relecture)
uv run python export.py export --out web  # → web/public/data/ + web/test-data/foldin_cases.json
uv run python export.py verify [--out web]  # relecture des fichiers + rejeu des cas de test
```

EASE (comparaison, ~6 Gio de RAM libre) : `uv run python train_ease.py ram` ; si insuffisant, `uv run python colab_bundle.py` puis `notebooks/ease_colab.ipynb` sur Colab.

Si le catalogue change (`build_catalog.py`, `enrich_tmdb.py`), relancer `export.py train` avant `export` : l'ordre `item_idx` est sauvegardé avec les vecteurs et `export` refuse un catalogue différent.

Relancer `build_catalog.py` réécrit `catalog.parquet` sans les colonnes TMDB : relancer ensuite `enrich_tmdb.py`.

Chemins et constantes partagés : `pipeline/config.py` (`RAW`, `PROCESSED`, `CACHE`, `WEB_DATA`, `MIN_RATINGS`) ; il charge le `.env` de la racine.

⚠️ Si la variable d'environnement `UV_PROJECT_ENVIRONMENT` est définie (globalement), uv utilise ce venv au lieu de `pipeline/.venv` — et `uv sync` y supprime les paquets absents du lock. La retirer, ou lancer `uv` avec la variable vidée.

### Site

À compléter quand Vite sera initialisé (serveur de dev, tests, build).
