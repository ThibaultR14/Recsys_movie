# Étape 3 — Adaptateur Letterboxd et correspondance des titres

> Version 0.1 (7 novembre 2026). Spécification de l'étape 3 de l'ordre de construction (`stack-technique.md` §8). Plan validé par Thibault le 7 novembre 2026, avec quatre ajustements (Letterboxd 10M suspendu, deux statuts « probable », exports de volontaires en local, taille totale ≤ 5 Mo gzip).

---

## 0. Mode d'emploi (pour Claude Code)

- Relis ce document au début de chaque sous-étape. Les décisions de la section 3 ne changent pas sans accord.
- Une sous-étape à la fois (E1 → E6), en suivant « Quand s'arrêter » de `CLAUDE.md`. **Arrêts obligatoires** :
  - en E1, si la normalisation v2 modifie le catalogue ;
  - avant tout téléchargement du dataset Letterboxd 10M (montrer sa provenance et sa licence) ;
  - avant E6 si l'export de Thibault manque ;
  - en fin d'étape, pour la relecture.
- Résultats dans la section 5 : chiffres exacts.
- **Données personnelles** :
  - les exports réels restent dans `web/test-data/exports/`, ignoré par git ;
  - on n'affiche jamais les films d'un export dans un compte rendu, sauf ceux de Thibault quand il doit les vérifier (correspondances `probable_*`, échecs, échantillon) ;
  - pour les volontaires, uniquement des taux.

---

## 1. Objectifs

1. Lire un export Letterboxd (ZIP ou CSV) dans le navigateur et produire le format interne commun des adaptateurs.
2. Relier chaque film à un `item_idx` du catalogue par titre + année, avec des replis, sans aucun appel réseau contenant les films de l'utilisateur.
3. Produire les fichiers `catalog.json` et `title-index.json` pour le site.
4. Mesurer le taux de correspondance et la précision sur de vrais exports.

---

## 2. Données d'entrée

- **Catalogue** (`pipeline/data/processed/catalog.parquet`, 23 019 films).
  - Colonnes utiles : `tmdb_title`, `tmdb_original_title`, `ml_title`, `year` (TMDB, sinon ML), `ml_year`, `tmdb_id`, `imdb_id`, `imdb_id_aliases`, `tmdb_directors`, `poster_path`, `ml_genres`.
  - Mesures (7 novembre 2026) :
    - 36 318 clés de titre normalisées (34 723 distinctes) ; 1 345 clés partagées par plusieurs films, **22 seulement une fois l'année ajoutée** ;
    - `year` ≠ `ml_year` pour 1 663 films (128 à plus d'un an) ;
    - 2 176 titres originaux en écriture non latine ; 45 films sans titre TMDB ; 3 sans année.
- **Export Letterboxd de Thibault** (`web/test-data/exports/letterboxd-<pseudo>-2026-11-07-…/`, non versionné). Fichiers et en-têtes réels, constatés le 7 novembre 2026 :

| Fichier | Lignes | Colonnes |
|---|---|---|
| `ratings.csv` | 225 | Date, Name, Year, Letterboxd URI, Rating |
| `watched.csv` | 225 | Date, Name, Year, Letterboxd URI |
| `diary.csv` | 112 | Date, Name, Year, Letterboxd URI, Rating, Rewatch, Tags, Watched Date |
| `reviews.csv` | 1 | Date, Name, Year, Letterboxd URI, Rating, Rewatch, Review, Tags, Watched Date |
| `watchlist.csv` | 31 | Date, Name, Year, Letterboxd URI |
| `profile.csv` | 1 | Date Joined, Username, Given Name, Family Name, Email Address, Location, Website, Bio, Pronoun, Favorite Films |
| `comments.csv` | 0 | Date, Content, Comment |
| `likes/films.csv`, `likes/lists.csv`, `likes/reviews.csv` | 0 | (Date, Name, Year, Letterboxd URI) ; (Date, Content) |
| `deleted/*`, `orphaned/*` (comments, diary, reviews) | 0 | mêmes colonnes que les fichiers principaux |

  - Encodage UTF-8 sans BOM, fins de ligne CRLF, dates `AAAA-MM-JJ`.
  - Notes de 0,5 à 5 par demi-points ; `Rewatch` vaut `Yes` ou est vide.
  - Liens au format `https://boxd.it/…`.
  - **Les liens de `ratings.csv` et `watched.csv` désignent le film et coïncident (225/225). Ceux de `diary.csv` désignent l'entrée du journal : aucun ne coïncide avec ceux de `ratings.csv` ou `watched.csv`.** Les 109 films distincts du journal sont tous dans `watched.csv`, par (titre, année).

---

## 3. Décisions

### D1. Normalisation des titres « v2 », portable Python ↔ TypeScript

Règle, dans cet ordre :
1. repli de casse complet (`str.casefold`) ;
2. décomposition NFKD ;
3. suppression de **tous** les signes diacritiques (`\p{M}`) ;
4. on garde lettres et chiffres (`\p{L}`, `\p{N}` ; en Python : catégorie Unicode commençant par `L` ou `N`), tout le reste devient une espace ;
5. espaces regroupées, début et fin retirés.

- **Différence avec la v1** : la v1 ne supprimait que les signes de classe de combinaison > 0 et utilisait `isalnum`. Seuls ~325 titres (écritures indiennes surtout) sont concernés.
- **TypeScript** : `toLowerCase()` puis une table de repli versionnée (`shared/fixtures/casefold_table.json`, générée depuis Python : les caractères pour lesquels `casefold` ≠ `lower`, par ex. ß → ss, ς → σ), puis NFKD, puis les mêmes classes Unicode.
- Les règles MovieLens (`ml_title_variants`, `title_keys` : article remis en tête, titre alternatif entre parenthèses, « a.k.a. ») sont inchangées et appliquées **seulement côté catalogue**, en Python.
- **Cas partagés** : `shared/fixtures/title_normalization.json` (versionné, écrit à la main) est lu par pytest et par Vitest. Test exhaustif : `web/test-data/catalog_title_keys.json` (non versionné, généré par Python) contient toutes les chaînes du catalogue et leur forme normalisée ; Vitest vérifie l'égalité sur 100 % d'entre elles.
- **Contrôle** : après le passage en v2, `build_catalog.py` puis `enrich_tmdb.py` (depuis le cache) doivent redonner un catalogue **identique**, colonne par colonne. **Sinon : arrêt** (il faudrait réentraîner le modèle).

### D2. `catalog.json` (affichage, adaptateur IMDb de l'étape 6)

Format en colonnes, dans l'ordre des `item_idx` ; uniquement des champs MovieLens et TMDB :

```json
{ "v": 1, "n": 23019,
  "title": ["Toy Story", "..."],
  "original_title": {"123": "..."},
  "year": [1995, null, "..."],
  "tmdb_id": [862, "..."], "imdb_id": ["tt0114709", "..."],
  "imdb_id_aliases": {"456": ["tt..."]},
  "directors": [["John Lasseter"], "..."],
  "poster_path": ["/uXDf....jpg", "..."],
  "genres": [[1, 2], "..."], "genre_names": ["Action", "..."] }
```

- `title` = `tmdb_title`, sinon `ml_title` nettoyé (article remis en tête, sans le titre alternatif) ; `original_title` seulement s'il diffère de `title`.
- `movie_id` et les films non recommandables restent dans `model-meta.json` ; la popularité, dans `popularity.bin`.
- Garde-fou `assert_web_safe` (aucun champ `imdbds_`). Cible : **≤ 1,5 Mo gzip**.

### D3. `title-index.json` (correspondance), précalculé en Python

```json
{ "v": 1, "norm": "titles-v2",
  "keys": ["12 angry men", "..."],
  "post": [[37, 9201], "..."],
  "ml_year": {"789": 1994} }
```

- `keys` : clés normalisées triées et uniques.
- `post[i]` : la liste des `4 × item_idx + source` de `keys[i]`, avec source = 0 pour `tmdb_title`, 1 pour `ml_title` (tel quel ou nettoyé), 2 pour `tmdb_original_title`, 3 pour le titre alternatif MovieLens. Un même film garde la meilleure source pour une clé donnée.
- `ml_year` : seulement là où il diffère de `year`.
- Cible : **≤ 0,5 Mo gzip**.
- Les deux fichiers sont écrits par `export.py catalog`, d'abord dans le dossier intermédiaire puis avec `--out web`.

### D4. Adaptateur Letterboxd (`web/src/adapters/letterboxd.ts`)

Ajusté le 7 novembre 2026 d'après l'export réel (section 2).

- **Entrée** : ZIP d'export (fflate) ou CSV seul (`ratings.csv`, `watched.csv` ou `diary.csv`), lu avec PapaParse. Tolère BOM, CRLF, guillemets et virgules dans les titres, colonnes en plus ou dans un autre ordre (lecture par nom d'en-tête).
- **Fichiers lus** : `ratings.csv`, `watched.csv`, `diary.csv`.
- **Fichiers ignorés** :
  - `reviews.csv` : la note y est aussi dans `ratings.csv` ou `diary.csv` ;
  - `watchlist.csv`, `likes/`, `deleted/`, `orphaned/`, `comments.csv`, `lists/` ;
  - **`profile.csv`, jamais lu** (données personnelles).
- **Identité d'un film** :
  - le lien Letterboxd de `ratings.csv` et `watched.csv` ;
  - `diary.csv` est rattaché **par (Name, Year)**, puisque ses liens désignent les entrées du journal ;
  - une entrée du journal sans film correspondant dans `ratings.csv` ou `watched.csv` (cas d'un CSV seul) devient un film à part entière.
- **Note** : `ratings.csv` (note actuelle) ; à défaut, la note de l'entrée **la plus récente** du journal (par « Watched Date ») ; sinon le film est vu sans note.
- **Date** : la dernière « Watched Date » du journal, sinon la date de `ratings.csv`, sinon celle de `watched.csv`.
- **Sortie** : `HistoryEntry { title, year?, imdbId?, tmdbId?, rating? (échelle source), scaleMax, ratingNormalized, date?, source: "letterboxd", sourceKey }`.
- **Percentiles** (`web/src/adapters/normalizeRatings.ts`, commun à tous les adaptateurs) :
  - calculés après la correspondance et la fusion des doublons (deux entrées → même `item_idx` : on garde la note la plus récente) ;
  - règle de Python `percentile_values` : `p = (rang moyen − 1) / (n − 1)` parmi les films notés, 0,5 si une seule note, **0,5 pour un film vu sans note** ;
  - vérifiés contre les `percentile` des 22 cas de test du fold-in (`web/test-data/foldin_cases.json`).

### D5. Stratégie de correspondance (`web/src/matching/`)

Pour chaque entrée, `clé = normalize(Name)`.

1. **Exacte** (`exact`) : candidats = films de l'index sous cette clé avec `|Year − year| ≤ 1` ou `|Year − ml_year| ≤ 1`.
   - Classement : écart d'année (0 avant 1), puis source (0 > 1 > 2 > 3), puis popularité (`popularity.bin`).
   - Si les deux premiers sont à égalité sur l'année et la source : `ambiguous`.
2. **Année absente** : clé seule ; un seul film → `exact`, plusieurs → `ambiguous`.
3. **Repli 1 — variantes** (`probable_variant`), toujours avec le filtre d'année ±1 :
   - « & » ↔ « and » ;
   - article de tête déplacé ou retiré (the/a/an, le/la/les, l', etc.) ;
   - année entre parenthèses retirée du titre ;
   - titre principal seul (avant « : » ou « – »), accepté seulement s'il désigne un film unique.
4. **Repli 2 — flou** (`probable_fuzzy`) : Fuse.js sur les clés des films d'année ±1, seuil 0,3 (à régler sur l'export de Thibault), 3 candidats gardés pour l'écran « films non reconnus » (étape 5).
5. Sinon : `not_found`.

Utilisation des statuts :
- l'étape 4 (recommandation) utilise `exact` et `probable_variant`, plus `probable_fuzzy` seulement si son taux d'erreur mesuré est ≤ 2 % ;
- les statuts `ambiguous`, `not_found` et `probable_fuzzy` (si non retenu) alimentent l'écran « films non reconnus » de l'étape 5.

### D6. Confidentialité

- Adaptateur et correspondance tournent localement ; les seuls `fetch` autorisés visent `/data/*`. Un test intercepte `fetch` et échoue sur toute autre URL.
- Exports réels dans `web/test-data/exports/`, rapports dans `web/test-data/reports/` : ignorés par git, jamais commités.
- **Exports des volontaires** :
  - utilisés avec leur accord, en local uniquement ;
  - **supprimés après la mesure**, avec leurs rapports détaillés ;
  - les comptes rendus ne citent **aucun de leurs films**, seulement des taux (« volontaire 1, 2… »).
- **Letterboxd 10M : suspendu.** Ce dataset vient a priori d'un scraping de Letterboxd, que nos règles écartent. **Avant tout téléchargement : arrêt** pour présenter sa provenance et sa licence ; décision de Thibault.

### D7. Mise en place du site

- `web/` : Vite + React + TypeScript strict, npm (Node 24.20, npm 11.19), Vitest, ESLint, Prettier.
- Dépendances : papaparse, fflate, fuse.js ; tsx (développement) pour les scripts de mesure.
- Tailwind et les écrans : étape 5.

---

## 4. Sous-étapes

### E1 — Normalisation v2

- `pipeline/titles.py` en v2 ; cas partagés `shared/fixtures/title_normalization.json` et table `shared/fixtures/casefold_table.json` ; tests pytest.
- Catalogue reconstruit (`build_catalog.py`, `enrich_tmdb.py` depuis le cache) et comparé à la version précédente : **identique, sinon arrêt**.

### E2 — Fichiers du catalogue

- `export.py catalog` : `catalog.json` et `title-index.json`, garde-fou, tailles brutes et gzip, tests ; dossier intermédiaire puis `--out web`.
- `web/test-data/catalog_title_keys.json` pour le test exhaustif TypeScript.

### E3 — Site et normalisation TypeScript

- Initialisation de `web/` (D7) ; `web/src/matching/normalize.ts` ; tests partagés et exhaustifs : **100 % d'égalité**.

### E4 — Adaptateur Letterboxd et percentiles

- `web/src/adapters/{types,letterboxd,normalizeRatings}.ts`.
- Fixtures **synthétiques écrites à la main** (aucune donnée réelle) : chaque fichier, année vide, virgules et guillemets, BOM, revisionnages, demi-notes, journal seul, ZIP sans `ratings.csv`, journal rattaché par (titre, année).
- Percentiles identiques aux cas de test du fold-in.

### E5 — Correspondance

- `web/src/matching/{titleIndex,match}.ts` : statuts D5 ; tests unitaires ; test de performance ; test de confidentialité.

### E6 — Mesure

- `web/scripts/match-report.ts` (`npx tsx`) : export → rapport JSON dans `web/test-data/reports/`.
- `pipeline/match_diagnostics.py` : classe les films non reconnus (sortis après 2023, dans MovieLens mais sous le seuil de 20 notes, absents de MovieLens, séries) à partir de `movies.csv` brut.
- Export de Thibault : taux, liste des `probable_*` et des échecs à vérifier par lui, échantillon de 100 `exact`.
- Volontaires : taux seulement, puis suppression. Letterboxd 10M : seulement après accord.
- **Arrêt en fin d'étape** pour relecture, puis mise à jour de `stack-technique.md` et `CLAUDE.md` (diff montré avant le commit).

### Critères de réussite

| Critère | Seuil |
|---|---|
| Normalisation Python ≡ TypeScript | 100 % des cas partagés et des chaînes du catalogue |
| Catalogue après la v2 | identique (sinon arrêt) |
| `catalog.json` / `title-index.json` (gzip) | ≤ 1,5 Mo / ≤ 0,5 Mo ; aucun champ `imdbds_` |
| **Total `web/public/data/` (gzip, tous fichiers)** | **≤ 5 Mo** |
| Percentiles TypeScript | identiques aux 22 cas de test du fold-in |
| Export de Thibault : films reconnus (`exact` + `probable_variant` [+ `probable_fuzzy` s'il passe son seuil]) parmi ceux présents dans le catalogue | ≥ 98 % |
| Export de Thibault : échecs de correspondance (film du catalogue non trouvé) | ≤ 1 % des films de l'export, chacun listé |
| Précision `exact` (100 tirés au hasard, vérifiés par Thibault) | ≤ 1 % d'erreurs |
| Précision `probable_variant` (toutes vérifiées) | ≤ 1 % d'erreurs |
| Précision `probable_fuzzy` (toutes vérifiées) | ≤ 2 % pour être utilisé à l'étape 4 ; sinon réservé à l'écran « films non reconnus » |
| Volontaires | mêmes seuils, taux seulement |
| Performance | 3 000 entrées en ≤ 300 ms (Node) |
| Confidentialité | test `fetch` vert ; aucun export ni rapport suivi par git |

Le rapport distingue le taux brut (tous les films de l'export) et le taux sur les films présents dans le catalogue ; les films hors catalogue (après 2023, moins de 20 notes, séries) sont comptés à part.

---

## 5. Résultats

*À remplir à la fin de chaque sous-étape.*

### E1

*7 novembre 2026.* Code : `pipeline/titles.py` (v2, `NORMALIZATION_VERSION = "titles-v2"`), `pipeline/title_fixtures.py` (`casefold-table`, `catalog-keys`), `pipeline/tests/test_titles.py` (214 tests au total, tous verts). Fichiers partagés versionnés : `shared/fixtures/title_normalization.json`, `shared/fixtures/casefold_table.json`.

- **Effet de la v2** : sur les 33 252 chaînes de titre du catalogue (`tmdb_title`, `tmdb_original_title`, `ml_title`), **309 changent de forme normalisée, toutes en écriture non latine** (signes vocaliques indiens, thaïs… supprimés au lieu de devenir des espaces) ; aucune chaîne latine ne change.
- **Catalogue reconstruit** (`build_catalog.py` puis `enrich_tmdb.py` depuis le cache) et comparé à la sauvegarde : `catalog.parquet`, `ratings_filtered.parquet`, `movie_id_merges.parquet` et `tmdb_mismatch.csv` **identiques** ; l'empreinte SHA-256 de `catalog.parquet` est celle enregistrée à l'entraînement du modèle final. **Pas d'arrêt, pas de réentraînement.**
- **Repli de casse** : 183 caractères déjà en minuscules ont un `casefold` différent (ß → ss, ς → σ, µ → μ, ſ → s…). Vérifié en Python sur **tous les points de code Unicode** : `lower()` puis cette table = `casefold()`. La table versionnée est contrôlée à chaque test (elle doit rester égale à la table recalculée).
- **Cas partagés** : 78 cas écrits à la main, en 10 groupes (bases, accents et signes, lettres sans décomposition comme æ œ ø ł, repli de casse, compatibilité NFKD comme ½ ⅓ ﬁ Ⅻ et pleine chasse, ponctuation, chiffres, écritures non latines, signes indiens, formes MovieLens). Sorties relues une à une. À noter : « 8½ » → `81 2`, « Schindler's List » → `schindler s list`, « Mr. & Mrs. Smith » → `mr mrs smith` (le « & » disparaît : la variante « & » ↔ « and » est traitée par le repli 1 de D5).
- **Test exhaustif** : `web/test-data/catalog_title_keys.json` (33 252 chaînes, non versionné) généré pour E3.

### E2

*7 novembre 2026.* Code : `pipeline/site_catalog.py` (construction, fonctions pures), `export.py catalog` et `export.py catalog-verify` (écriture, garde-fou, tailles, relecture), `tests/test_site_catalog.py` (219 tests au total, tous verts). Fichiers écrits dans le dossier intermédiaire puis dans `web/public/data/` (identiques, non versionnés).

| Fichier | Octets | gzip -9 | Cible |
|---|---|---|---|
| `catalog.json` | 2 543 586 | **1 117 252** | ≤ 1,5 Mo ✅ |
| `title-index.json` | 1 069 768 | **367 969** | ≤ 0,5 Mo ✅ |
| `embeddings.bin`, `yty.bin`, `popularity.bin`, `model-meta.json` (étape 2) | 1 813 371 | 1 575 032 | |
| **Total `web/public/data/`** | 5 426 725 | **3 060 253** (2,92 Mio) | ≤ 5 Mo ✅ |

- `catalog.json` : 23 019 films ; `original_title` pour 4 815 films (différent du titre affiché) ; `imdb_id_aliases` pour 40 films ; 19 genres MovieLens (« (no genres listed) » → liste vide). Le titre affiché est `tmdb_title`, sinon le titre MovieLens nettoyé (45 films).
- `title-index.json` : 34 723 clés, 36 318 entrées (source 0 `tmdb_title` : 22 973 ; 1 `ml_title` : 7 235 ; 2 titre original : 4 453 ; 3 titre alternatif ML : 1 657) ; 1 345 clés partagées par plusieurs films ; `ml_year` pour 1 663 films.
- **Contrôles** (`catalog-verify`) : tailles des colonnes = 23 019 = `n_items` de `model-meta.json` ; clés triées et uniques ; toutes les entrées pointent vers un film existant ; **chaque film a au moins une clé** ; chaque `tmdb_title` est indexé avec la source 0. Ordre des films = celui sauvegardé à l'entraînement (`trained_movie_ids`). Garde-fou `assert_web_safe` sur les deux fichiers.

### E3

*7 novembre 2026.* Site initialisé dans `web/` : Vite 8 + React 19 + TypeScript 6 (strict, `noUncheckedIndexedAccess`), Vitest 5, ESLint 10 (typescript-eslint, react-hooks), Prettier 3 ; dépendances papaparse 5.7, fflate 0.8, fuse.js 7.5 ; tsx en développement. Squelette créé à la main (le dossier contenait déjà l'arborescence), page provisoire « en construction ». Commandes : `npm test`, `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run dev`.

- `web/src/matching/normalize.ts` : `casefoldText` (`toLowerCase()` + table `shared/fixtures/casefold_table.json`) et `normalizeTitle` (NFKD, `\p{M}` supprimés, `\p{L}\p{N}` gardés).
- **Cas partagés : 78/78 identiques à Python.** **Test exhaustif : 33 252/33 252 chaînes du catalogue identiques** (`web/test-data/catalog_title_keys.json`, non versionné ; test sauté s'il manque). 81 tests Vitest verts ; `tsc`, ESLint et Prettier sans remarque.

### E4

*7 novembre 2026.* Code : `web/src/adapters/types.ts` (format commun `HistoryEntry`), `letterboxd.ts` (ZIP, fichiers d'un dossier, ou CSV seul), `normalizeRatings.ts` (`percentiles`, `dedupeLatest`) ; tests `letterboxd.test.ts`, `normalizeRatings.test.ts` (97 tests Vitest au total, tous verts, aucun sauté ; `tsc`, ESLint, Prettier sans remarque).

- **Colonnes réelles confirmées** sur l'export de Thibault avant d'écrire l'adaptateur (section 2) ; D4 ajusté : le journal est rattaché aux films par (titre, année), car ses liens désignent les entrées du journal.
- **Lecture** : seuls `ratings.csv`, `watched.csv` et `diary.csv` du dossier principal (ou d'un dossier englobant) sont lus. Dans un ZIP, les autres fichiers ne sont **même pas décompressés** (filtre de fflate) : `profile.csv`, `watchlist.csv`, `reviews.csv`, `deleted/`, `orphaned/`, `likes/`. Un CSV seul est reconnu par son nom, sinon par ses colonnes. La watchlist est refusée. Une note hors de 0,5-5 ou pas sur un demi-point est ignorée avec un avertissement.
- **Fixtures synthétiques** (écrites à la main : vrais titres, notes et dates inventées) :
  - fusion par lien et par (titre, année) ;
  - BOM, CRLF, virgules et guillemets doublés dans les titres, année vide ;
  - film vu sans note ;
  - film présent seulement dans le journal ;
  - revisionnage (la note la plus récente du journal) ;
  - journal seul ;
  - ZIP avec dossier englobant, sans `ratings.csv`, avec `profile.csv` et `deleted/diary.csv` ignorés ;
  - CSV renommé ;
  - watchlist et fichier inconnu refusés ;
  - note invalide.
- **Percentiles** : identiques (égalité exacte, arrondi float32 comme le signal d'entraînement) aux `percentile` Python des **22 cas de test du fold-in**, en plus de cas calculés à la main (égalités, une seule note, films non notés).
- **Export réel de Thibault** (test structurel, sans afficher de titre) :
  - les trois fichiers sont lus, **aucun avertissement** ;
  - une entrée par film vu (autant que de lignes dans `watched.csv`), toutes avec titre, année et date ;
  - le journal est entièrement rattaché, sans film « journal seulement ».

### E5

*7 novembre 2026.* Code : `web/src/matching/titleIndex.ts` (chargement de `title-index.json`, `catalog.json` pour les années et `popularity.bin` pour les départages ; refuse un index d'une autre version de normalisation), `match.ts` (`Matcher`, statuts D5), `history.ts` (`matchHistory`, `toUserHistory` : statuts utilisables, un film par `item_idx` en gardant l'entrée la plus récente, percentiles) ; tests `match.test.ts` (110 tests Vitest au total, tous verts ; `tsc`, ESLint, Prettier sans remarque).

- **Algorithme** (D5) :
  - correspondance exacte : clé normalisée, année ±1 (TMDB ou MovieLens), classement par écart d'année, source du titre, popularité ; `ambiguous` si les deux premiers sont à égalité ;
  - sans année : clé seule, film unique ;
  - `probable_variant` :
    - « & » ↔ « and » ;
    - année entre parenthèses retirée ;
    - titre principal avant « : » ou « - » (film unique seulement) ;
    - **article de tête ignoré des deux côtés** : une table des clés sans article, construite au chargement, couvre « Misérables » ↔ « Les Misérables » comme « The Matrix » ↔ « Matrix ». La première version retirait seulement l'article du titre saisi et ratait le premier cas ;
  - `probable_fuzzy` : Fuse.js (seuil 0,3), 3 candidats.
- **Performance** :
  - une première version (Fuse.js sur tous les films de l'année ±1) mettait **5,0 s** pour 3 000 entrées dont 10 % de titres altérés ;
  - le flou est désormais préfiltré par trigrammes, avec un index **découpé par année** : seuls les films de l'année ±1 sont parcourus, et les 40 plus proches (coefficient de Dice ≥ 0,3) sont confiés à Fuse.js ;
  - **101 ms pour 3 000 entrées** (Node, catalogue réel, 10 % de titres altérés qui passent par les replis) ; critère ≤ 300 ms ✅. La construction du `Matcher` (index sans article et trigrammes) se fait une fois au chargement.
- **Tests** :
  - catalogue synthétique : exacte, double année (via `ml_year`), écart > 1 rejeté, ambigu (deux « Hamlet » de 1964), sans année, chaque variante, flou limité à l'année ±1 et absent sans année, titre vide ou inconnu ;
  - `toUserHistory` : doublons, statuts exclus, percentiles ;
  - **confidentialité** : le chargement ne demande que `/data/title-index.json`, `/data/catalog.json` et `/data/popularity.bin`, et la correspondance n'appelle jamais `fetch` (vérifié en remplaçant `fetch` global) ;
  - catalogue réel : 5 films connus en `exact`, et le test de vitesse.

### E6

*7 novembre 2026 — mesure sur l'export de Thibault ; **arrêt de fin d'étape** (vérification manuelle des correspondances par Thibault, puis exports des volontaires).* Code : `web/scripts/match-report.ts` (`npm run match-report -- <export> --name <label>` → `web/test-data/reports/<label>.json`), `pipeline/match_diagnostics.py` (classe les films non reconnus ; `--show` affiche les titres, pour l'export de Thibault seulement). Rapports, diagnostic et fichier de vérification dans `web/test-data/reports/` (ignoré par git). **Aucun titre de l'export n'est cité ici** (dépôt public) : les listes ont été montrées à Thibault dans le compte rendu.

**Export de Thibault** (225 films vus, tous notés ; aucun avertissement de l'adaptateur)

| Statut | Films | Part |
|---|---|---|
| `exact` | 188 | 83,6 % |
| `probable_variant` | 0 | 0 % |
| `probable_fuzzy` | 2 | 0,9 % |
| `ambiguous` | 0 | 0 % |
| `not_found` | 35 | 15,6 % |

- Temps : construction du `Matcher` 361 ms (une fois), correspondance des 225 films 16 ms.
- **Diagnostic des 37 films non reconnus ou flous** (`match_diagnostics.py`, recherche par titre + année ±1 dans tout MovieLens 32M, puis dans les datasets IMDb hors ligne) :

| Catégorie | `not_found` | `probable_fuzzy` |
|---|---|---|
| sortis en 2024-2026 (après MovieLens 32M) | 25 | 0 |
| dans MovieLens, sous le seuil de 20 notes (sortis en 2023 : 1 à 10 notes) | 5 | 0 |
| absents de MovieLens (2 films de 2023, 3 séries) | 5 | 0 |
| absents de MovieLens : séries | — | 2 |
| **dans le catalogue (échec de correspondance)** | **0** | **0** |

- **Taux de correspondance sur les films présents dans le catalogue : 188 / 188 = 100 %** (critère ≥ 98 %) ; **échecs : 0** (critère ≤ 1 %). Taux brut : 188 / 225 = 83,6 % ; les 37 autres sont hors catalogue (« trou » des films récents accepté au MVP, séries).
- **Précision des `exact`** :
  - contrôle automatique : pour 187 films, l'écart d'année est de 0 (1 an pour le dernier). Le titre affiché est identique pour 184, ne diffère que par le tiret pour 3 (« Star Wars: Episode I – … » contre « - »), et pour 1 cas le titre TMDB du catalogue est un autre titre du même film (même `tmdb_id` 81 et même `imdb_id`).
  - **Vérification manuelle par Thibault en attente** : 100 correspondances tirées au hasard (graine 42) dans `web/test-data/reports/thibault_verification.csv`.
- **Précision des `probable_fuzzy` : 0 / 2 correctes.** Les deux sont des **séries** absentes du catalogue, rattachées à des films au titre proche : un documentaire sur la série, et un film d'horreur au mot commun. **Taux d'erreur 100 % > 2 % : `probable_fuzzy` n'est pas utilisé par l'étape 4** ; il servira seulement à proposer des candidats dans l'écran « films non reconnus » de l'étape 5. Échantillon minuscule (2 cas), mais l'erreur est structurelle : les exports Letterboxd contiennent des séries, et le flou trouve toujours un film voisin.
- `probable_variant` : aucun cas dans cet export ; précision non mesurable ici (à mesurer sur les exports des volontaires).
- **Défaut de données repéré** (à traiter à l'étape 5, affichage) : pour *Nausicaä de la vallée du vent* (TMDB 81), le `tmdb_title` du catalogue est « Warriors of the Wind », le titre de l'ancien montage américain. La correspondance est juste (titre MovieLens), mais c'est ce titre qui s'afficherait.

**Letterboxd 10M** (page Hugging Face lue le 7 novembre 2026, **rien téléchargé**) :
- `titouann/letterboxd-10m-movies-ratings-2025`, auteur Titouan Mokrani, licence CC-BY-NC-SA 4.0 (« research, education and personal projects ») ; 10,46 M de notes de 6 519 utilisateurs populaires, collectées en décembre 2025 ; « Original data belongs to Letterboxd and its community contributors ».
- La méthode de collecte n'est pas décrite (ni API, ni autorisation de Letterboxd) : c'est très probablement un scraping des profils publics.
- Colonnes : `user`, `movie_id` (identifiant Letterboxd), `title` (en pratique le slug Letterboxd, ex. « zootopia-2 »), `rating` : **ni identifiant TMDB/IMDb, ni année**.
- Il ne donnerait donc **pas de vérité terrain** pour la précision, seulement des slugs à faire correspondre (ce qui demanderait d'autres règles que nos titres).
- **Recommandation : ne pas l'utiliser pour l'étape 3.** Décision de Thibault.

**Critères** (état à l'arrêt)

| Critère | Résultat |
|---|---|
| Normalisation Python ≡ TypeScript | ✅ 78/78 cas partagés, 33 252/33 252 titres du catalogue |
| Catalogue identique après la v2 | ✅ (octet pour octet) |
| `catalog.json` / `title-index.json` | ✅ 1,12 Mo / 0,37 Mo gzip ; aucun champ `imdbds_` |
| Total `web/public/data/` | ✅ 3,06 Mo gzip (≤ 5 Mo) |
| Percentiles TypeScript | ✅ identiques aux 22 cas de test du fold-in |
| Films reconnus parmi ceux du catalogue | ✅ 100 % (188/188) |
| Échecs de correspondance | ✅ 0 |
| Précision `exact` | ⏳ contrôle automatique cohérent sur 188/188 ; vérification manuelle de 100 cas en attente |
| Précision `probable_variant` | — aucun cas dans cet export |
| Précision `probable_fuzzy` | ❌ 0/2 → non utilisé par l'étape 4 (prévu par D5, pas un échec de l'étape) |
| Volontaires | ⏳ aucun export pour l'instant |
| Performance | ✅ 101 ms pour 3 000 entrées ; 16 ms pour l'export réel |
| Confidentialité | ✅ test `fetch` ; exports, rapports et fichier de vérification ignorés par git |
