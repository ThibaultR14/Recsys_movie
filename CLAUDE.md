# CLAUDE.md — Pépite (nom de travail)

Site gratuit de recommandation de films pour cinéphiles. L'utilisateur dépose son export Letterboxd (ZIP) ou IMDb (CSV), et le site lui recommande des films qu'il n'a pas vus, avec un curseur « connu ↔ pépite ». Projet étudiant (M2, ECE Paris), non commercial.

Contexte résumé pour une nouvelle session ou pour Claude Web : `contexte/` (`etat-du-projet.md`, `decisions.md`, `feuille-de-route.md`).

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
- Arborescence : `pipeline/` (`config.py`, `download.py`, `build_catalog.py`, `enrich_tmdb.py`, `titles.py`, `manual_overrides.csv`, étape 2 : `split.py`, `metrics.py`, `baselines.py`, `evaluate.py`, `models/`, `train.py`, `train_ease.py`, `colab_bundle.py`, `slider.py`, `sweep_slider.py`, `slider_variants.py`, `popularity.py`, `export.py`, étape 3 : `site_catalog.py`, `title_fixtures.py`, `match_diagnostics.py`, `{notebooks,tests,data/raw,data/processed,data/cache}`), `web/src/{adapters,matching,reco,components,pages,styles,content}` (`content/` : textes de l'interface, étape 6b), `web/scripts/`, `web/e2e/` (Playwright), `web/public/data/`, `web/public/exemple/` (exports d'exemple synthétiques Letterboxd et IMDb, versionnés), `web/test-data/` (ignoré), `shared/fixtures/` (cas partagés Python / TypeScript), `.github/workflows/`, `docs/` (dont `etape-2-modele.md` à `etape-6b-retouches.md`, `figures/` ; voir `docs/stack-technique.md` §7).
- Corrections manuelles du catalogue : **uniquement** via `pipeline/manual_overrides.csv` (`exclude` / `merge_into` / `title`, avec une raison), jamais en dur dans le code. `title` = titre affiché sur le site (colonne `title`), appliqué par `site_catalog.py` seulement.
- **Front** (`web/`) : **React + Vite + TypeScript**, Tailwind CSS v4, PapaParse, fflate, Fuse.js ; polices auto-hébergées (`@fontsource`, aucune requête vers Google) ; rien de stocké dans le navigateur, **sauf le choix du thème clair** (une seule clé `localStorage`, `pepite-theme`, étape 6b D7) ; ni IndexedDB, ni cookie, ni `sessionStorage`.
- Hébergement : Cloudflare Pages (ou GitHub Pages). Métadonnées TMDB rafraîchies chaque mois par GitHub Actions.

## Décisions prises (ne pas remettre en question sans raison)

- Modèle en production : **ALS** (`implicit`), 64 facteurs, `regularization` 0,05, `alpha` 1, β 1, 30 itérations, réentraîné sur tous les utilisateurs, vecteurs en int8. EASE uniquement pour comparer hors ligne.
- Catalogue : films avec **≥ 20 notes** MovieLens, ~20 000–25 000 films, ~5 Mo de données au total.
- Curseur : **plafond de popularité**. À chaque position, seuls les films avec une popularité ≤ plafond sont candidats, classés par le score du modèle ; positions ∞ → 20 000 → 10 000 → 5 000 → 2 000 → 1 000 → 500 → 200 (∞ = ordre du modèle). Popularité = `max(arrondi(ml_rating_count × f_année), arrondi(0,285 × tmdb_vote_count))`, `f_année = max(1, 0,285 / r_année)` (rapport médian MovieLens / TMDB de l'année de sortie ; correction des films récents, `pipeline/popularity.py`), jamais plus confidentielle qu'avant. Le re-classement `score − λ × log(popularité)` a été testé et écarté (`docs/etape-2-modele.md`, D5).
- Films récents (après 2023) : **trou accepté au MVP**, à signaler honnêtement dans l'interface.
- Import : architecture d'**adaptateurs** (un par source) qui produisent tous le même format interne `{ titre, annee, imdbId?, tmdbId?, noteNormalisee, date? }`. Notes normalisées en percentiles par utilisateur.
- Pas d'IA au MVP pour les listes faites main : correspondance floue (Fuse.js).
- Calcul des recos : **un seul moteur** (`web/src/reco/engine.ts`) utilisé par le Web Worker et par les scripts du terminal (`reco-report`, `reco-bench`) ; il doit rejouer `foldin_cases.json` à l'identique (listes) et à 10⁻⁹ près (vecteurs). L'historique du fold-in = `exact` + `probable_variant` ; sont exclus des recommandations les films vus, non recommandables, les candidats `ambiguous` et le candidat principal `probable_fuzzy`.
- Correspondance des titres : normalisation « v2 » **identique** en Python (`pipeline/titles.py`) et en TypeScript (`web/src/matching/normalize.ts`), vérifiée par `shared/fixtures/` ; toute modification passe par les deux et par les cas partagés. Titre + année ±1 (TMDB ou ML), puis variantes ; le flou (Fuse.js) n'est **jamais** utilisé automatiquement pour les recommandations.
- Import IMDb (étape 6, `docs/etape-6-imdb.md`) : CSV des notes, source détectée par l'**en-tête** (jamais le nom du fichier) ; liste ou watchlist IMDb (colonne `Position`) : message, pas d'import ; rapprochement par `imdb_id` puis `imdb_id_aliases` (partie numérique) → `exact` ; sinon repli titre (`Title` puis `Original Title`) **toujours envoyé dans « à vérifier »** (`ambiguous`, `matchedBy: "title"`), jamais dans le fold-in sans choix ; `Title Type` est traduit dans la langue du compte : seuls les types **connus comme non-films** (anglais, français, liste `NON_FILM_TITLE_TYPES`) sont sans repli et comptés à part, tout type inconnu est un film.
- Interface (étape 5, `docs/etape-5-interface.md`) : machine à états accueil → analyse → résultats (pas de routeur, rien de stocké) ; le flou n'est jamais coché par défaut, un candidat choisi devient `confirmed` (il entre dans le fold-in) ; un seul `recommend({ n: 48 })` pour les 8 crans, départ au cran 2 000, 8 cartes puis 8 par 8 ; « loin de tes goûts » si score relatif < 0,04 ; tampon « ✱ pépite » : au plus un par rangée de 8, sur le moins connu s'il a au plus la moitié de la popularité médiane de la rangée ; carte = lien `letterboxd.com/tmdb/<id>/` ; mention « spectacle » non affichée (reportée aux genres TMDB).
- Retouches (étape 6b, `docs/etape-6b-retouches.md`) : **thème sombre par défaut**, même si le système est en clair (seule exception à « rien de stocké » : `pepite-theme` = `light`, supprimée au retour au sombre) ; pages « comment ça marche », « à propos » (à la première personne, sans nom d'école) et « contact » ouvertes **par l'ancre** par-dessus l'écran courant (gardé, cran compris) ; contact = adresse + `mailto:` pré-rempli, aucun service tiers ; textes de l'interface dans `web/src/content/` (`{en:…}` = libellé anglais, `lang="en"`) ; carte : « ★ 3,9 · 1 240 notes » (moyenne MovieLens, `catalog.json` v2 : `ml_mean` × 10, `ml_count`) et « (parce que t'as aimé X et Y) » (cosinus des vecteurs, films notés de percentile ≥ 0,7, repli « vu » sans aucune note, 20 voisins candidats, 2 cartes au plus par film cité et par rangée de 8, rien sur une carte de série) ; « loin de tes goûts » par rangée : si au moins la moitié d'une rangée de 8 a un score relatif par carte < 0,04, une annotation au-dessus de la grille et les explications restent, sinon règle de l'étape 5 (cran < 0,04 : note sous le curseur, explications masquées) ; tampon « ✱ pépite » en haut à droite de l'affiche ; aide des exports ouverte sous la zone de dépôt ; conteneur unique de 1 200 px aligné à gauche, paragraphes à ~65 caractères ; liens externes des textes en `{a:url|libellé}` (nouvel onglet) ; changement de cran ≤ 50 ms sur la médiane.
- Dataset Letterboxd 10M : **non utilisé** (collecte probablement par scraping).
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
- **Exports réels** (Thibault, volontaires) : uniquement dans `web/test-data/exports/` (ignoré) ; ceux des volontaires sont supprimés après la mesure, et on n'en cite jamais les films (taux seulement). Pas de pseudo ni de titre d'un export dans un fichier versionné.
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
3. ✅ Adaptateur Letterboxd + correspondance des titres. Fait (`docs/etape-3-letterboxd.md`) : `catalog.json` (1,12 Mo gzip) et `title-index.json` (0,37 Mo), total `web/public/data/` 3,06 Mo gzip ; sur l'export de Thibault, 188/188 films du catalogue reconnus (précision vérifiée à la main 100/100), les 37 autres hors catalogue (après 2023, séries) ; 3 000 entrées en ~100 ms.
4. ✅ Calcul dans le navigateur. Fait (`docs/etape-4-navigateur.md`) : moteur TypeScript (`web/src/reco/` : lecture des fichiers, fold-in Cholesky, scores, curseur à plafond) dans un Web Worker ; reproduit les 22 vecteurs (écart 3·10⁻¹⁵) et les 66 listes top 10 de `foldin_cases.json` ; recommandations en 19 ms pour un export réel, 42 ms pour 3 000 films. Exclus des recos : films vus, non recommandables, candidats `ambiguous` et candidat principal `probable_fuzzy`. Diagnostic du biais des films récents en section 6 de la spec (décision en attente).
5. ✅ Interface (style C). Fait (`docs/etape-5-interface.md`) : accueil / dépôt, analyse du fichier (à vérifier, trop récents, hors catalogue), résultats + curseur 8 crans, « à propos » avec les mentions ; 5 titres corrigés à la main (action `title`) ; export d'exemple synthétique ; Playwright : aucune requête hors du site sauf les affiches TMDB, rien de stocké, 0 violation axe grave ; modèle prêt en 0,8–0,9 s, analyse 11–30 ms, changement de cran ≤ 40 ms ; validé sur l'export de Thibault et sur un vrai téléphone. La fiche film passe à l'étape 8.
6. ✅ Adaptateur IMDb. Fait (`docs/etape-6-imdb.md`) : adaptateur, détection par l'en-tête, rapprochement par id (+ alias), repli par titre dans « à vérifier », types non-films à part, exemple IMDb synthétique ; sur un export fabriqué de Thibault (42 lignes, compte en français), 35 films trouvés par id ; 3 000 lignes en 22 ms ; mesure représentative reportée à l'étape 7.
6b. ✅ Retouches de l'interface (`docs/etape-6b-retouches.md`), **close le 8 novembre 2026** (essai sur un vrai téléphone non confirmé, à refaire au début de l'étape 7). Fait : thème sombre par défaut (clair au choix, seule clé `localStorage` `pepite-theme`), pages « comment ça marche », « à propos » (« je ») et « contact » par ancre, contact par `mailto:` sans service tiers, aide des exports en carrousel (7 schémas SVG), note du public MovieLens sur les cartes (`catalog.json` v2, +55 Ko gzip), « (parce que t'as aimé X et Y) » (cosinus, percentile ≥ 0,7, 2 cartes au plus par film cité et par rangée de 8 ; 3,5 ms sur un export réel, 38 ms pour 3 000 films), textes de Claude Web ; axe 0 dans les deux thèmes, réseau inchangé.
7. Mise en ligne (après la réponse de GroupLens), tests avec 10–20 cinéphiles.
8. Ensuite : fiche film, dispo en France, listes faites main, scraping (les explications ont été avancées à l'étape 6b).

## Quand s'arrêter

Méthode de travail : avancer seul, ne s'arrêter qu'aux points de décision.

- **Tous les critères d'une sous-étape atteints et rien à trancher** : résultats dans la section 5 de la spec d'étape, commit, push, puis sous-étape suivante **sans demander**.
- **S'arrêter seulement si** :
  - un critère échoue ;
  - un choix sort d'une décision écrite (D1-D9 de la spec d'étape, ou §9 de `docs/stack-technique.md`) ;
  - la spec prévoit explicitement un arrêt ;
  - une action est irréversible ou touche aux secrets.
- **À la fin de chaque étape**, mettre à jour `contexte/` (état, décisions, feuille de route) dans le même commit que la clôture.
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

Étape 3 :

```sh
uv run python export.py catalog [--out web]   # catalog.json + title-index.json (puis catalog-verify)
uv run python title_fixtures.py catalog-keys   # web/test-data/catalog_title_keys.json (test TS exhaustif)
uv run python match_diagnostics.py ../web/test-data/reports/<nom>.json [--show]  # --show : export de Thibault seulement
```

### Site (depuis `web/`)

```sh
npm install
npm run dev                 # serveur de développement (Vite)
npm test                    # Vitest ; les tests sur données réelles sont sautés si web/public/data ou web/test-data manquent
npm run typecheck           # tsc strict
npm run lint                # ESLint
npm run format:check        # Prettier (npm run format pour corriger)
npm run build
npm run match-report -- test-data/exports/<export> --name <nom>  # ZIP/dossier Letterboxd ou CSV IMDb → test-data/reports/
npm run reco-report -- test-data/exports/<export>  # top 20 à ∞ / 2 000 / 500, terminal seulement
npm run reco-bench -- [--export <export>]          # temps du moteur
npm run make-example        # régénère public/exemple/letterboxd-exemple.zip et imdb-exemple.csv (synthétiques ; l'IMDb lit public/data) ; --check : statuts
npm run spectacles          # heuristique « spectacle » → docs/figures/etape-5-spectacles.md
npx playwright install chromium   # une fois
npm run e2e                 # Playwright (build + vite preview, port 4173) : parcours, téléphone, réseau, stockage, axe, temps
```

Sorties de Playwright et captures : `web/test-data/playwright/` et `web/test-data/screenshots/` (ignorés). Si le port 4173 est déjà pris (ancien `vite preview`), l'arrêter avant `npm run e2e`.

Diagnostic popularité (pipeline) : `uv run python recency_diagnostics.py years | validation | user <rapport>` (titres dans le terminal seulement ; ne modifie pas `popularity.bin`).
