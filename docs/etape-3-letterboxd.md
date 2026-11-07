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
### E2
### E3
### E4
### E5
### E6
