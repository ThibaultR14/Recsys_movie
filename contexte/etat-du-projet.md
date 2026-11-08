# État du projet

> Mis à jour le 8 novembre 2026, à la clôture de l'étape 6. Point d'entrée pour Claude Web et toute nouvelle session : lire ce fichier, puis `decisions.md` et `feuille-de-route.md` (même dossier), puis les documents de référence selon le sujet.
> Dépôt : https://github.com/ThibaultR14/Recsys_movie

## Le projet en 5 lignes

- **Pépite** (nom de travail) : un site gratuit qui recommande à un cinéphile des films qu'il n'a pas encore vus.
- **Cible** : les cinéphiles qui tiennent un journal sur Letterboxd ou IMDb. Ils déposent leur export (ZIP ou CSV Letterboxd, CSV des notes IMDb).
- **Curseur « connu ↔ pépite »** : il fait glisser les recommandations des classiques vers des films très peu vus mais proches du goût de l'utilisateur.
- **Tout se passe dans le navigateur** : site 100 % statique, sans serveur, sans compte ni stockage. Les films et les notes de l'utilisateur ne quittent jamais sa machine.
- Projet étudiant (M2, ECE Paris), **non commercial** : MovieLens, TMDB et les datasets IMDb l'imposent.

## Où on en est : étapes 1 à 6 faites

| Étape | Résultat | Chiffres clés | Détail |
|---|---|---|---|
| 1. Pipeline de données | catalogue MovieLens 32M + TMDB | **23 019 films** (≥ 20 notes, séries et doublons retirés) ; tmdb_id 99,96 %, affiches et réalisateurs 99,7 % | `docs/stack-technique.md` §3 |
| 2. Modèle | ALS, configuration A (64 facteurs, reg 0,05, alpha 1, β 1) | NDCG@20 test **0,152**, contre EASE 0,172 (−11 %) et « populaire » 0,084 ; perte int8 < 0,08 % | `docs/etape-2-modele.md` |
| 2. Curseur | variante **V3** : plafond de popularité, **8 crans** (∞ → 20 000 → … → 200) | popularité hybride MovieLens/TMDB corrigée par année de sortie (`year_all`) | `docs/etape-2-modele.md` D5 |
| 3. Import Letterboxd et correspondance des titres | adaptateur ZIP/CSV, normalisation identique en Python et en TypeScript | **100 % des films du catalogue reconnus** sur un export réel (précision vérifiée à la main sur 100), 3 000 entrées en ~100 ms | `docs/etape-3-letterboxd.md` |
| 4. Calcul dans le navigateur | moteur TypeScript dans un Web Worker | reproduit le Python à 10⁻¹⁵ près (22 vecteurs, 66 listes) ; recommandations en 19-42 ms | `docs/etape-4-navigateur.md` |
| 5. Interface | style « C · Fanzine » : accueil, analyse du fichier, résultats et curseur, « à propos » | modèle prêt en 0,8-0,9 s, analyse 11-30 ms, changement de cran ≤ 40 ms ; aucune requête hors du site sauf les affiches TMDB ; validée sur un vrai téléphone | `docs/etape-5-interface.md` |
| 6. Import IMDb | CSV des notes détecté par l'en-tête, rapprochement par `imdb_id` (+ alias), repli par titre seulement proposé dans « à vérifier », séries et épisodes à part, watchlist refusée avec un message | export fabriqué de Thibault (compte en français, 42 lignes) : 35 films trouvés par id ; 3 000 lignes en 22 ms ; mesure sur un vrai historique reportée à l'étape 7 | `docs/etape-6-imdb.md` |

Données embarquées par le site (`web/public/data/`) : **~3 Mo gzip** au total. Elles se composent des vecteurs int8, de la popularité, du catalogue et de l'index des titres.

## Ce qui tourne aujourd'hui

- **Le site complet en local**, avec l'export Letterboxd ou le CSV des notes IMDb de l'utilisateur, ou l'export d'exemple synthétique (« montre-moi un exemple »). Un exemple IMDb synthétique (`web/public/exemple/imdb-exemple.csv`) sert aux tests.
- **Pas encore en ligne** : il faut d'abord la réponse de GroupLens (voir « En attente »).
- Les fichiers de `web/public/data/` ne sont pas versionnés. Pour les obtenir, il faut faire tourner le pipeline (MovieLens 32M, plus une clé TMDB dans `.env` pour l'enrichissement).

### Lancer le pipeline (depuis `pipeline/`, Python 3.12 + uv)

```sh
uv sync
uv run python download.py && uv run python build_catalog.py && uv run python enrich_tmdb.py
uv run python split.py && uv run python export.py train
uv run python export.py export --out web && uv run python export.py catalog --out web
uv run pytest && uv run ruff check .
```

Si la variable `UV_PROJECT_ENVIRONMENT` est définie globalement, la vider (`env -u UV_PROJECT_ENVIRONMENT uv …`).

### Lancer le site (depuis `web/`, Node + npm)

```sh
npm install
npm run dev                  # http://localhost:5173 ; « npm run dev -- --host » pour tester sur téléphone
npm test                     # Vitest (unités, composants)
npm run typecheck && npm run lint && npm run format:check
npx playwright install chromium && npm run e2e   # parcours complet dans un vrai navigateur
npm run build
```

Les commandes complètes, avec les scripts de mesure, sont dans `CLAUDE.md` (section « Commandes »).

## Fichiers de référence

| Sujet | À lire |
|---|---|
| Règles du dépôt, décisions figées, commandes | `CLAUDE.md` |
| Vision, fonctionnalités, contraintes de licence | `docs/projet-reco-films.md` |
| Stack, sources de données, architecture, ordre des étapes | `docs/stack-technique.md` |
| Modèle, évaluation, curseur, popularité | `docs/etape-2-modele.md` (+ `etape-2-curseur-qualitatif.md`) |
| Import Letterboxd, correspondance des titres | `docs/etape-3-letterboxd.md` |
| Moteur dans le navigateur, biais des films récents | `docs/etape-4-navigateur.md` |
| Interface, textes, tests navigateur | `docs/etape-5-interface.md` |
| Import IMDb (format réel, types traduits, repli par titre) | `docs/etape-6-imdb.md` |
| Direction visuelle (couleurs, polices, composants, ton) | `docs/design-system.md`, `docs/maquette-C-fanzine.html` |
| Concurrents, positionnement | `docs/etat-de-l-art.md` |
| Décisions résumées, feuille de route | `contexte/decisions.md`, `contexte/feuille-de-route.md` |

Chaque spec d'étape suit le même plan : décisions (D1, D2…), sous-étapes et critères, **résultats (section 5)** et points à reporter (section 6).

## Méthode de travail

- **Thibault** décide : il valide les plans, tranche les choix et teste avec ses propres exports.
- **Claude Code** code dans le dépôt et **avance seul** dans une étape, sous-étape par sous-étape. Quand tous les critères sont atteints, il note les résultats en section 5, commite, pousse, puis passe à la suite.
- Il **s'arrête aux points de décision** :
  - un critère qui échoue ;
  - un choix hors des décisions écrites ;
  - un arrêt prévu par la spec ;
  - une action irréversible ou qui touche aux secrets.

  Avant chaque arrêt, tout est poussé et la section 5 est à jour, pour qu'une relecture se fasse depuis GitHub.
- **Claude Web** intervient **aux arrêts**, en lisant le dépôt public : choix produit, design, textes de l'interface, licences, recherche (concurrents, méthodes), relecture des specs. Il rédige les ajustements que Thibault transmet ensuite à Claude Code.
- **Une étape commence par une spec** (`docs/etape-N-….md`) validée par Thibault. **Elle se termine** par la mise à jour de `CLAUDE.md`, de `docs/stack-technique.md` et de ce dossier `contexte/`, dans le même commit que la clôture.
- **Confidentialité** :
  - les exports réels restent dans `web/test-data/` (ignoré par git) ;
  - on ne cite jamais un pseudo ni les films d'un export ;
  - pour les volontaires : taux seulement, et fichiers supprimés après la mesure.

## En attente

- **Réponse de GroupLens** sur la licence MovieLens (mail envoyé le 6 novembre 2026). **Elle bloque la mise en ligne** (étape 7) et le versionnement de `web/public/data/`, mais pas le développement en local.
- **Exports de 10 à 20 cinéphiles volontaires** (étape 7). Ils serviront à mesurer la correspondance des titres et à recaler les seuils de l'interface : « loin de tes goûts » et tampon « ✱ pépite ».
- **Un vrai historique IMDb** (export d'un proche ou d'un volontaire) : pour mesurer les taux de correspondance, et vérifier les libellés français probables de `Title Type` (mini-série, jeu vidéo).
- **Le nom définitif** du site (plus tard). Il ne doit contenir ni « Letterboxd » ni « IMDb ».
