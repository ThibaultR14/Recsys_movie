# Étape 6 — Adaptateur IMDb

> Version 0.1 (8 novembre 2026). Spécification de l'étape 6 de l'ordre de construction (`stack-technique.md` §8). **À valider par Thibault avant de coder.**
> Décisions de départ données par Thibault le 8 novembre 2026 ; les points marqués « à confirmer en G0 » dépendent du vrai export, **absent de `web/test-data/exports/` au moment de la rédaction**.

---

## 0. Mode d'emploi (pour Claude Code)

- Relis ce document au début de chaque sous-étape. Les décisions de la section 3 ne changent pas sans accord.
- Une sous-étape à la fois (G0 → G5), en suivant « Quand s'arrêter » de `CLAUDE.md`. **Arrêts obligatoires** :
  - **avant G0 si l'export IMDb de Thibault manque** dans `web/test-data/exports/` (c'est le cas au 8 novembre 2026) ;
  - en G0, si le vrai fichier contredit une décision de la section 3 (colonnes, encodage, types, titre localisé) ;
  - en G4, pour que Thibault vérifie à la main l'échantillon et les correspondances par titre ;
  - en fin d'étape, pour la relecture.
- Résultats dans la section 5 : chiffres exacts.
- **Données personnelles** (comme à l'étape 3, D6) :
  - l'export IMDb reste dans `web/test-data/exports/`, rapports et fichiers de vérification dans `web/test-data/reports/`, tous ignorés par git ;
  - dans les fichiers versionnés : **noms de colonnes, comptes et taux seulement, aucun titre** ; les titres ne s'affichent que dans le terminal ou dans les fichiers ignorés, pour la vérification de Thibault ;
  - volontaires (étape 7) : taux seulement, fichiers supprimés après la mesure.

---

## 1. Objectifs

1. Lire le CSV des notes IMDb dans le navigateur et produire le même format interne (`HistoryEntry`) que l'adaptateur Letterboxd.
2. Relier chaque film au catalogue **d'abord par `imdb_id`**, puis par titre + année en repli pour les seuls types « film », sans aucun appel réseau contenant les films de l'utilisateur.
3. Reconnaître automatiquement la source déposée (ZIP ou CSV Letterboxd, CSV IMDb) et retirer les messages « imdb arrive bientôt ».
4. Mesurer les mêmes taux qu'à l'étape 3 sur l'export réel de Thibault.

---

## 2. Données d'entrée

- **Catalogue** (`web/public/data/catalog.json`, 23 019 films). Mesures du 8 novembre 2026 :
  - `imdb_id` présent pour **23 019 / 23 019** films, tous distincts ; 22 195 sur 7 chiffres (`tt` + 7), 824 sur 8 ;
  - `imdb_id_aliases` : 40 films, 40 alias, **aucun ne coïncide avec un `imdb_id` principal** ;
  - types IMDb des films du catalogue (contrôle hors ligne, colonne `imdbds_title_type`, jamais embarquée) : `movie` 21 111, `tvMovie` 587, `short` 573, `video` 428, `tvSpecial` 237, `tvShort` 31, inconnu 52. **Aucune série, aucun épisode, aucun jeu.**
- **Format attendu de l'export « Your ratings »** (documentation et exports publics, **à confirmer en G0**) :

| Point | Attendu | À vérifier en G0 |
|---|---|---|
| Colonnes | `Const, Your Rating, Date Rated, Title, Original Title, URL, Title Type, IMDb Rating, Runtime (mins), Year, Genres, Num Votes, Release Date, Directors` | noms exacts, ordre, colonnes en plus ou en moins (les anciens exports n'avaient pas `Original Title`) |
| Encodage | UTF-8, BOM possible ; certains anciens exports en Windows-1252 | BOM, fins de ligne, caractères accentués lisibles |
| `Your Rating` | entier de 1 à 10 | valeurs présentes |
| `Date Rated` | `AAAA-MM-JJ` | format exact |
| `Title` | **localisé** selon la langue du compte IMDb (titre français pour un compte en français) | localisé ou non ; `Original Title` présent et rempli |
| `Title Type` | « Movie », « TV Series », « TV Mini Series », « TV Episode », « TV Movie », « TV Special », « TV Short », « Short », « Video », « Video Game »… (anciens exports : `movie`, `tvSeries`…) | valeurs réelles et leurs comptes |
| `Year` | année de sortie (première année pour une série) | vide possible ? |
| Watchlist / liste | mêmes colonnes **plus** `Position, Created, Modified, Description` | non vérifiable sur l'export de Thibault : on s'appuie sur la documentation |

  - Le nom du fichier n'aide pas : IMDb le nomme souvent `ratings.csv`, **comme le fichier Letterboxd**. La détection se fait sur l'en-tête (D5).
- **Export IMDb de Thibault** : `web/test-data/exports/<fichier>.csv`, non versionné. **Absent au 8 novembre 2026** ; G0 remplira cette section (comptes et colonnes seulement).

---

## 3. Décisions

### D1. Adaptateur IMDb (`web/src/adapters/imdb.ts`)

- **Entrée** : un CSV, lu avec PapaParse (`parseCsv` commun avec Letterboxd), lecture **par nom d'en-tête** (colonnes en plus ou dans un autre ordre tolérées, BOM, CRLF, guillemets et virgules dans les titres).
- **Encodage** : décodage UTF-8 strict (`TextDecoder('utf-8', { fatal: true })`) ; en cas d'échec, Windows-1252. Le BOM est retiré.
- **Colonnes lues** : `Const`, `Your Rating`, `Date Rated`, `Title`, `Original Title` (si présente), `Title Type`, `Year`. **Toutes les autres sont ignorées** (`IMDb Rating`, `Num Votes`, `Genres`, `Directors`… : rien de ce qui vient d'IMDb n'est gardé au-delà du rapprochement).
- **Sortie** : une `HistoryEntry` par ligne :
  - `imdbId` = `Const` s'il a la forme `tt` + chiffres, sinon absent (avertissement) ;
  - `title` = `Title`, `originalTitle` (nouveau champ facultatif de `HistoryEntry`) = `Original Title` s'il diffère ;
  - `year` = `Year` ; `rating` = `Your Rating`, entier de 1 à 10, sinon ignorée avec avertissement ; `scaleMax` = 10 ;
  - `date` = `Date Rated` (`AAAA-MM-JJ`) ;
  - `titleType` (nouveau champ facultatif) = `Title Type` **normalisé** : minuscules, sans espaces ni tirets (`TV Movie` et `tvMovie` → `tvmovie`) ;
  - `source: "imdb"`, `sourceKey` = `imdbId`, sinon `title:<Title>|<Year>`.
- **Percentiles** : `normalizeRatings` commun, inchangé (il ne dépend que des rangs, donc l'échelle 1-10 ne change rien) ; doublons (deux lignes → même `item_idx`, via un alias) : la note la plus récente, comme pour Letterboxd.

### D2. Rapprochement par `imdb_id`

- Index construit au chargement à partir de `catalog.json` : `imdb_id` puis `imdb_id_aliases` → `item_idx`. Clé = partie numérique de l'id (`tt0114709` et `tt114709` désignent le même film), sans tenir compte de la casse.
- Ordre, pour chaque entrée :
  1. `imdbId` dans les `imdb_id` → `exact`, `via: "imdb_id"` ;
  2. sinon dans les `imdb_id_aliases` → `exact`, `via: "imdb_alias"` ;
  3. sinon repli par titre (D3), **seulement si le type est un type film**.
- Un film trouvé par id est gardé **quel que soit son `Title Type`** : l'id fait foi (le catalogue ne contient que des films, cf. section 2).
- Les statuts restent ceux de l'étape 3 (`MatchStatus` inchangé) ; le champ `via` distingue l'id, l'alias et le titre pour la mesure. `RECOMMENDATION_STATUSES` est inchangé.
- La correspondance passe par une fonction unique `matchEntry(entry)` (id puis titre), utilisée par `matchHistory` pour toutes les sources ; pour Letterboxd (pas d'id) elle revient exactement à l'étape 3.

### D3. Repli par titre + année, types film seulement

- **Types film** : `movie`, `tvmovie`, `short`, `video`, `tvspecial`, `tvshort` (les six types présents dans le catalogue, section 2), plus une ligne **sans** `Title Type`. Liste à ajuster en G0 d'après les valeurs réelles (arrêt si une valeur inattendue apparaît en nombre).
- Le repli est **le matcher de l'étape 3, inchangé** (normalisation v2, année ±1 TMDB ou ML, variantes) : d'abord sur `Title`, puis, si `Title` ne donne ni `exact` ni `probable_variant`, sur `Original Title`. On garde le meilleur résultat (`exact` > `probable_variant` > `ambiguous` > `probable_fuzzy` > `not_found`).
- **Le flou (Fuse.js) n'est jamais automatique** : comme à l'étape 3, `probable_fuzzy` n'entre pas dans le fold-in ; il ne sert qu'à proposer des candidats dans « à vérifier ».
- **Risque connu** : un film absent par id mais trouvé par titre peut être un **autre film** du même nom (le film de l'utilisateur a moins de 20 notes MovieLens, un homonyme ±1 an est dans le catalogue). La mesure G4 compte ces cas à part (`via: "title"`) et Thibault les vérifie **tous**. Si leur précision est sous le seuil (section 4), arrêt : on proposera de les envoyer dans « à vérifier » au lieu du fold-in.

### D4. Séries, épisodes, jeux et autres types

- Une ligne d'un type non film (`tvseries`, `tvminiseries`, `tvepisode`, `videogame`, `podcastseries`, `podcastepisode`, `musicvideo` et tout autre type absent de la liste D3) **non trouvée par id** n'a **pas de repli par titre** : statut `not_found`, raison `non_film`.
- Écran d'analyse : un groupe à part, après « trop récents », avec une phrase dans le ton du site, par exemple « 12 séries, épisodes ou jeux : on fait que les films ». Ces lignes ne comptent **pas** dans « pas dans notre catalogue ».
- `Unrecognized` (worker) reçoit une raison (`reason?: "non_film"`) ; `groupUnrecognized` ajoute le groupe `nonFilm`.

### D5. Détection de la source (`web/src/pages/readUpload.ts`, `web/src/adapters/detect.ts`)

- Fonction pure `detectCsv(header)` → `"imdb-ratings" | "imdb-list" | "letterboxd" | "unknown"`, sur les noms de colonnes (minuscules, sans guillemets ni BOM) :
  - `const` présent et `your rating` présent et **`position` absent** → `imdb-ratings` ;
  - `const` présent, et `position` présent ou `your rating` absent → `imdb-list` (watchlist ou liste) ;
  - `name` + `letterboxd uri` → `letterboxd` (comme aujourd'hui) ; sinon `unknown`.
- **ZIP** : toujours Letterboxd (IMDb ne fournit que des CSV). Un ZIP sans fichier Letterboxd garde le message actuel.
- **CSV** : décidé par l'en-tête, jamais par le nom de fichier (D1, section 2), sauf la règle actuelle « watchlist » de Letterboxd (nom contenant `watchlist`), gardée.
- `ExportInput` gagne `{ kind: 'imdb'; name: string; text: string }` ; `readExport` appelle l'adaptateur IMDb.
- Un export qui mélange Letterboxd et IMDb (deux fichiers à la fois) : **non prévu** ; un seul fichier à la fois, comme aujourd'hui.

### D6. CSV sans note (watchlist ou liste IMDb)

- `imdb-list` : **pas d'import**, message clair, par exemple « ça, c'est une liste imdb (ou ta watchlist) : il nous faut tes notes. sur imdb : « your ratings » → exporter. » (texte final en G3, ton de `docs/design-system.md`).
- Un export de notes où **aucune** ligne n'a de note valide : même traitement que « aucun film reconnu ».
- **Watchlist hors MVP** (reportée avec « partir d'une liste ou d'une watchlist », feuille de route, idées « plus tard »).

### D7. Interface et textes

- `MESSAGES.imdbSoon` est **supprimé** ; le cas `imdb-list` a son propre message (D6).
- `APropos.tsx` : retirer « (pour imdb, ça arrive bientôt) » ; garder « compatible avec les exports Letterboxd et IMDb ».
- Accueil : la zone de dépôt annonce déjà « tes notes imdb (le .csv) » ; ajouter, sous le lien de l'exemple ou dans « à propos », une ligne courte sur **où trouver l'export IMDb** (« your ratings » → menu « … » → exporter), à rédiger en G3.
- Aucun nom de marque dans le nom ou le logo du site (règle inchangée).

### D8. Export d'exemple IMDb synthétique

- `web/public/exemple/imdb-exemple.csv`, versionné, généré par `npm run make-example` (même script que l'exemple Letterboxd) : **films connus du catalogue, notes et dates inventées**, colonnes de la section 2 (ajustées en G0), `Const` = `imdb_id` du catalogue (issu de MovieLens `links.csv`, permis).
- Il contient aussi, pour les tests : une série et un épisode (ids inventés, hors catalogue), une ligne dont l'id n'est pas dans le catalogue mais dont le titre l'est (repli D3), un titre localisé avec `Original Title`, une ligne sans note.
- Les colonnes IMDb (`IMDb Rating`, `Num Votes`, `Genres`, `Directors`…) y sont **vides** : on n'y met rien qui vienne des datasets IMDb.
- Utilisé par Vitest et Playwright ; **pas de second lien « exemple » à l'accueil** (celui de Letterboxd suffit pour démontrer le site).

### D9. Confidentialité et licences

- L'export IMDb de l'utilisateur est lu **dans son navigateur** : c'est permis (c'est son fichier). Aucun `fetch` nouveau ; le test d'interception de `fetch` et le test Playwright « réseau » couvrent le parcours IMDb.
- Rien des datasets IMDb n'est embarqué (règle inchangée) : l'index des ids est construit à partir des `imdb_id` de `catalog.json`, qui viennent de MovieLens.
- Les diagnostics hors ligne (`match_diagnostics.py`) peuvent utiliser les datasets IMDb (`title.basics`) pour classer les films non reconnus ; sortie dans le terminal ou dans `web/test-data/reports/`.

---

## 4. Sous-étapes

### G0 — Inspection du vrai export (bloquée tant qu'il manque)

- Compter : lignes, colonnes exactes et leur ordre, encodage (BOM, fins de ligne, UTF-8 valide), format de `Date Rated`, valeurs de `Your Rating`, valeurs de `Title Type` avec leurs comptes, `Year` vide, `Title` localisé (nombre de lignes où `Title` ≠ `Original Title`), `Original Title` présent.
- Compléter la section 2 (**comptes et noms de colonnes seulement**). Si un point contredit D1-D6 : **arrêt**.

### G1 — Adaptateur et détection

- `web/src/adapters/imdb.ts`, `web/src/adapters/detect.ts`, champs `originalTitle` et `titleType` de `HistoryEntry`.
- Fixtures **synthétiques écrites à la main** : en-têtes actuels et anciens, BOM, Windows-1252, guillemets et virgules, note absente ou invalide, `Const` invalide, colonnes en plus, watchlist, liste, CSV Letterboxd nommé `ratings.csv`.
- Tests : détection, sortie de l'adaptateur, percentiles sur une échelle 1-10.

### G2 — Rapprochement par id et repli

- Index des ids (`web/src/matching/`), `matchEntry`, repli D3, raison `non_film` D4 ; `readExport`, `summarize`, worker.
- Tests : id, alias, id inconnu de type film (repli `Title` puis `Original Title`), id inconnu non film (pas de repli), Letterboxd inchangé (les 22 cas de `foldin_cases.json` et les tests existants restent verts) ; performance ; test `fetch`.

### G3 — Interface et exemple

- `readUpload.ts` (D5, D6), groupe « séries, épisodes ou jeux » (D4), `APropos.tsx` et accueil (D7), `make-example` (D8).
- Vitest (composants) et Playwright : parcours complet avec `imdb-exemple.csv` (dépôt → analyse → résultats), message de la watchlist, réseau (aucune requête hors du site sauf les affiches TMDB), stockage (rien), axe (0 violation grave), téléphone. Le test qui attend aujourd'hui « les exports imdb arrivent bientôt » est remplacé.

### G4 — Mesure sur l'export de Thibault

- `npm run match-report` accepte le CSV IMDb ; le rapport (`web/test-data/reports/`, ignoré) distingue : trouvés par id, par alias, par titre (`exact`, `probable_variant`), à vérifier (`ambiguous`, `probable_fuzzy`), types non film, films non trouvés (après 2023, dans MovieLens sous le seuil, absents de MovieLens : `match_diagnostics.py`, via `links.csv`).
- Contrôle automatique des correspondances par id : titre/année de l'export comparés au catalogue (normalisation v2, `Title` ou `Original Title`, année ±1) ; écarts listés pour Thibault.
- Fichier de vérification (`web/test-data/reports/<nom>_verification.csv`, ignoré) : 100 correspondances par id tirées au hasard (graine fixe ; toutes s'il y en a moins), **toutes** les correspondances par titre, tous les échecs.
- **Arrêt** : Thibault vérifie le fichier ; section 5 avec les taux seulement.

### G5 — Clôture

- Section 5 complète ; `CLAUDE.md`, `docs/stack-technique.md` (§3 ou §6, §9) et `contexte/` mis à jour dans le même commit ; **arrêt** pour relecture.

### Critères de réussite

| Critère | Seuil |
|---|---|
| Films reconnus (`exact` + `probable_variant`, par id ou par titre) parmi ceux présents dans le catalogue | ≥ 98 % |
| Échecs de correspondance (film du catalogue non trouvé) | ≤ 1 % des films de l'export, chacun listé |
| Précision des correspondances par id (100 tirées au hasard, vérifiées par Thibault) | ≤ 1 % d'erreurs |
| Précision des correspondances par titre (toutes vérifiées) | ≤ 1 % d'erreurs ; sinon arrêt (D3) |
| Types non film | aucun envoyé au repli par titre ; tous comptés à part |
| Letterboxd | inchangé : tests existants verts, 22 cas de `foldin_cases.json` rejoués à l'identique |
| Performance | 3 000 lignes IMDb lues et rapprochées en ≤ 300 ms (Node) |
| Réseau | **0 requête nouvelle** : test `fetch` et Playwright (seules les affiches TMDB hors du site) |
| Stockage | rien de stocké (Playwright) |
| Qualité | `npm test`, `typecheck`, `lint`, `format:check`, `e2e` verts ; `pytest` et `ruff` si le pipeline est touché |
| Confidentialité | aucun export, rapport ni titre de l'export dans un fichier suivi par git |

« Présents dans le catalogue » = trouvés par id, plus les films non trouvés que `match_diagnostics.py` rattache à un film du catalogue (par `links.csv` ou par vérification de Thibault). Le rapport donne aussi le taux brut (toutes les lignes) et les films hors catalogue comptés à part (après 2023, moins de 20 notes, séries).

---

## 5. Résultats

*(à remplir pendant l'étape)*

| Critère | Résultat |
|---|---|
| G0 — format réel | ⏳ export IMDb de Thibault absent au 8 novembre 2026 |

---

## 6. À reporter

- **Watchlist et listes IMDb** (et watchlist Letterboxd) : « partir d'une liste », idées « plus tard » de la feuille de route.
- **ZIP contenant un CSV IMDb** (navigateurs ou utilisateurs qui compressent le fichier) : non géré au MVP.
- **Export mélangeant Letterboxd et IMDb** (dépôt de deux fichiers) : non prévu.
- **Exports IMDb des volontaires** (étape 7) : mêmes taux, taux seulement, fichiers supprimés ensuite.
