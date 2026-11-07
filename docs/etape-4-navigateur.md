# Étape 4 — Calcul des recommandations dans le navigateur

> Version 0.1 (7 novembre 2026). Spécification de l'étape 4 de l'ordre de construction (`stack-technique.md` §8). Plan validé par Thibault le 7 novembre 2026 (D4 compris), avec un ajout : le script `reco-report`.

---

## 0. Mode d'emploi (pour Claude Code)

- Relis ce document au début de chaque sous-étape ; les décisions de la section 3 ne changent pas sans accord.
- Une sous-étape à la fois (F1 → F5), en suivant « Quand s'arrêter » de `CLAUDE.md`. **Arrêt obligatoire en fin d'étape** pour relecture, avec la sortie de `reco-report` sur l'export de Thibault.
- Résultats en section 5. Aucun titre d'un export réel dans un fichier versionné : les recommandations de Thibault n'apparaissent que dans le terminal et dans le compte rendu.

---

## 1. Objectifs

1. Charger les fichiers du site et calculer les recommandations dans le navigateur : fold-in ALS, scores, curseur V3, exclusions. Aucune donnée de l'utilisateur ne quitte le navigateur.
2. Reproduire exactement le calcul Python : les 22 vecteurs et les 66 listes top 10 de `web/test-data/foldin_cases.json`.
3. Garder l'interface fluide : tout le travail lourd dans un Web Worker.
4. Mesurer les temps de calcul.

---

## 2. Données d'entrée

- `web/public/data/` (non versionné) :
  - `embeddings.bin` (int8 + échelles), `yty.bin` (float32 64 × 64), `popularity.bin` (uint32, popularité hybride) ;
  - `model-meta.json` (hyperparamètres, positions du curseur, films non recommandables) ;
  - `catalog.json`, `title-index.json`.
- `web/test-data/foldin_cases.json` (non versionné) : 22 historiques avec notes, percentiles, signal, vecteur attendu et top 10 attendus aux positions ∞, 2 000 et 500.
- Références Python : `pipeline/models/als.py` (`fold_in`, `signal_values`), `pipeline/export.py` (`dequantize`, `top_under_cap`).
- Mesure préalable : dans les 66 listes, l'écart relatif minimal entre deux scores consécutifs du top 11 vaut **2·10⁻⁵**, des milliards de fois plus que les écarts d'arrondi entre Python et TypeScript (~10⁻¹⁵).

---

## 3. Décisions

### D1. Chargement des fichiers (`web/src/reco/modelFiles.ts`)

- `fetch` de `/data/embeddings.bin`, `yty.bin`, `popularity.bin`, `model-meta.json`, plus `catalog.json` et `title-index.json` via `loadTitleIndex`. La même fonction `fetch` injectable sert aux tests.
- `embeddings.bin` : en-tête vérifié (`PEPE`, version 1, `n_items`, `dims`) et taille exacte. Déquantification au chargement dans un `Float32Array` (23 019 × 64), par `Math.fround(q × scale)`, identique au `dequantize` Python.
- Contrôles de cohérence : `n_items` identique dans `model-meta.json`, `catalog.json` et `popularity.bin` ; version de format 1 ; normalisation `titles-v2`. Sinon : erreur « fichiers du modèle incohérents ».
- Pas de cache IndexedDB à cette étape (cache HTTP au MVP ; `idb-keyval` éventuellement à l'étape 7).

### D2. Fold-in (`web/src/reco/foldIn.ts`), reproduction de `als.fold_in`

- Signal `r = fround(1 + β · p)`, avec `p` le percentile float32 (`normalizeRatings.percentiles`) ; confiance `c = alpha · r`.
- `A = YᵀY + reg · I + Σᵢ (cᵢ − 1) yᵢ yᵢᵀ` et `b = Σᵢ cᵢ yᵢ`, en float64 ; résolution par Cholesky (A est symétrique définie positive). Hyperparamètres lus dans `model-meta.json`.
- Historique vide : erreur « aucun film reconnu ».

### D3. Scores et curseur V3 (`web/src/reco/recommend.ts`)

- `score_i = y_i · x`, en float64, pour tous les films.
- Candidats : films recommandables et non exclus (D4). Tri unique : score décroissant, puis `item_idx` croissant (comme `top_under_cap`).
- Pour chaque position de `model-meta.json` (∞, 20 000, 10 000, 5 000, 2 000, 1 000, 500, 200) : les N premiers (N = 50 par défaut) avec `popularité ≤ plafond`.
- Par position, le **score relatif** (score moyen des 20 premiers / celui de la position ∞), prévu pour l'indicateur d'éloignement de l'étape 5.

### D4. Films exclus (validé par Thibault)

- Toujours exclus :
  - les films non recommandables ;
  - les films vus utilisés pour le fold-in (`exact`, `probable_variant`) ;
  - **les candidats à égalité des entrées `ambiguous`** ;
  - **le candidat principal des entrées `probable_fuzzy`**.
- Raison : masquer un film non vu coûte peu, recommander un film déjà vu coûte cher.
- **L'historique du fold-in ne change pas** : `exact` et `probable_variant` seulement (`toUserHistory`).

### D5. Web Worker (`web/src/reco/worker.ts`, `client.ts`)

- Le worker (module Vite) fait tout le travail lourd : chargement, `Matcher`, lecture de l'export, correspondance, fold-in, scores.
- Protocole typé : `init` → `ready` ; `import` (ZIP ou CSV) → résumé de la correspondance ; `recommend` → listes par position.
- Le cœur (`engine.ts`) est pur et testé en Node. `worker.ts` ne fait qu'aiguiller les messages (`handleMessage`, testé directement). `client.ts` offre des promesses à l'étape 5.
- `web/scripts/reco-report.ts` (`npm run reco-report -- <export>`) utilise **exactement le même moteur** (`engine.ts`) que le worker. Il affiche dans le terminal le top 20 aux positions ∞, 2 000 et 500 (titre, année, nombre de notes, score) et n'écrit rien sur le disque.

### D6. Confidentialité

- Seuls des `fetch` vers `/data/*`. L'export n'est lu que dans le worker ; aucun stockage, aucun envoi.
- Test : avec un `fetch` factice, sur tout le parcours `init` → `import` → `recommend` ; il échoue sur toute URL hors `/data/`.

---

## 4. Sous-étapes et critères

- **F1** : `modelFiles.ts` (lecture et contrôles), tests synthétiques et sur les vrais fichiers.
- **F2** : `foldIn.ts` ; critère : les 22 vecteurs de la fixture.
- **F3** : `recommend.ts` et `engine.ts` ; critère : les 66 listes top 10.
- **F4** : worker et client ; `handleMessage` et confidentialité testés ; `npm run build` produit le worker séparé.
- **F5** : `reco-bench.ts` (temps) et `reco-report.ts` (export de Thibault) ; **arrêt** pour relecture.

| Critère | Seuil |
|---|---|
| Vecteurs de la fixture | 22/22, écart maximal ≤ 10⁻⁹ par composante ; signal identique |
| Listes top 10 de la fixture | 66/66 identiques (`item_idx`, ordre) ; scores à ≤ 10⁻⁹ |
| Lecture des fichiers | vecteurs déquantifiés identiques au Python ; tailles et versions cohérentes |
| Exclusions | aucun film vu, ambigu, flou ou non recommandable dans les listes (test) |
| Temps de recommandation (Node, après chargement : fold-in + scores + 8 positions × 50) | ≤ 50 ms pour 225 films vus ; ≤ 100 ms pour 3 000 |
| Chargement et analyse des 6 fichiers (Node, hors réseau) | ≤ 500 ms (construction du `Matcher` rapportée à part) |
| Worker | tout le calcul dans le worker ; worker séparé dans `dist/` |
| Confidentialité | test `fetch` vert sur tout le parcours |
| Qualité | `tsc`, ESLint, Prettier, Vitest verts |

Les temps dans un vrai navigateur (téléphone compris) seront mesurés à l'étape 5.

---

## 5. Résultats

*À remplir à la fin de chaque sous-étape.*

### F1

*7 novembre 2026.* `web/src/reco/modelFiles.ts` :
- `parseEmbeddings` vérifie l'en-tête et la taille exacte ;
- `dequantize` produit un `Float32Array` (`q × scale` arrondi en float32) ;
- `buildModelFiles` vérifie la cohérence de `n_items`, `dims`, `yty.bin`, `popularity.bin` et `catalog.json`, et marque les films non recommandables ;
- `fetchModelFiles` utilise un `fetch` injectable.

Tests synthétiques : déquantification identique à numpy float32 ; en-tête faux, fichier tronqué, fichiers incohérents refusés avec un message clair.

### F2

*7 novembre 2026.* `web/src/reco/foldIn.ts` : `signal` (`fround(1 + β·fround(p))`) et `foldIn` (système 64 × 64 en float64, triangle supérieur puis symétrie, `choleskySolve`).
- Sur les 22 cas de `foldin_cases.json`, calculés depuis les vrais fichiers de `web/public/data/` : percentiles et signal **identiques**, **écart maximal sur les vecteurs : 3,3·10⁻¹⁵** (critère ≤ 10⁻⁹) ✅. Cholesky contre LU de LAPACK : l'écart reste au niveau de l'arrondi float64.
- Cas limites testés : système résolu à la main, matrice non définie positive refusée, historique vide refusé (« aucun film reconnu »).

### F3

*7 novembre 2026.* `web/src/reco/recommend.ts` :
- `scoreAll` (produit scalaire float64) ;
- `rankCandidates` (recommandables et non exclus, score décroissant puis `item_idx` croissant) ;
- `topByPosition` (N premiers sous chaque plafond, score relatif toujours calculé sur les 20 premiers de la position, rapporté à ∞).

`web/src/reco/engine.ts` : moteur partagé par le worker et les scripts (`loadEngine`, `importExport`, `exclusions`, `recommend`).
- **66 listes top 10 sur 66 identiques** (`item_idx` et ordre), **écart maximal sur les scores : 1,9·10⁻¹⁵** ✅.
- `recommend()` sur un cas réel : 8 positions × 50 films, aucun film vu ni non recommandable, plafonds respectés. Le top 10 à ∞ est celui de la fixture.
- **Exclusions (D4)** testées : historique du fold-in + candidats à égalité des `ambiguous` (pas les candidats moins bien classés) + candidat principal des `probable_fuzzy`. L'historique du fold-in reste `toUserHistory` (`exact` + `probable_variant`).
- 123 tests Vitest verts ; `tsc` et ESLint sans remarque.

### F4
### F5
