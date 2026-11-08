# Étape 6c — Qualité des résultats

> Version 0.1 (8 novembre 2026). Mini-étape insérée entre l'étape 6b (retouches de l'interface) et l'étape 7 (mise en ligne). **En attente de validation par Thibault** : voir les questions de la section 7.
> Point de départ : l'essai de Thibault (trop d'animation aux crans bas, films proches de films qu'il a mal notés, une autre version d'un film déjà vu). Le diagnostic (Q0) est fait : chiffres en section 2, détails en section 5.

---

## 0. Mode d'emploi (pour Claude Code)

- Relis ce document au début de chaque sous-étape. Les décisions de la section 3 ne changent pas sans accord.
- Une sous-étape à la fois (Q1 → Q5), en suivant « Quand s'arrêter » de `CLAUDE.md`. **Arrêts obligatoires** :
  - en **Q3**, pour que Thibault choisisse la force de la calibration (λ) au vu de la courbe qualité / calibration ;
  - en **Q5**, pour l'essai sur un vrai téléphone et la relecture.
- **Protocole de l'étape 2** (`docs/etape-2-modele.md`, D1-D3) : les choix se font sur la **validation** ; le **test** n'est évalué **qu'une fois**, à la clôture, sur la configuration retenue (question Q5).
- **Un seul moteur** (`CLAUDE.md`) : toute règle qui change les listes (fold-in, exclusions, re-classement) a une **référence Python** et des cas partagés que le TypeScript rejoue à l'identique.
- **Données personnelles** (inchangé) : sur l'export de Thibault, comptes et parts seulement dans les fichiers versionnés ; titres dans le terminal uniquement.

---

## 1. Objectifs

1. **Équilibre des genres** : que les listes ressemblent à l'historique (pas 75 % d'animation pour un historique qui en a 11 %), à tous les crans.
2. **Films mal notés** : qu'ils ne tirent plus les recommandations vers eux.
3. **Versions et montages** : ne pas proposer une autre version d'un film déjà vu.
4. Garder ce qui marche : qualité hors ligne (NDCG@20) à ∞ et aux crans, temps du navigateur, aucun appel réseau nouveau.

---

## 2. Données d'entrée (diagnostic Q0, 8 novembre 2026)

Scripts : `pipeline/quality_diagnostics.py` (`foldin`, `versions` ; résultats dans `pipeline/data/processed/results/quality/`, ignoré) et `web/scripts/quality-report.ts` (terminal, comptes seulement). Genres = **genres MovieLens** de `catalog.json` (les genres TMDB ne sont pas récupérés par le pipeline ; voir Q1).

### 2.1 Genres par cran (16 premières recommandations)

Part de chaque genre : historique · recos au cran · catalogue recommandable sous le plafond. Un film peut avoir plusieurs genres.

**Export de Thibault** (188 films) :

| Genre | Historique | ∞ | 20 000 | 10 000 | 5 000 | 2 000 | 1 000 | 500 | 200 | Catalogue (∞ → 200) |
|---|---|---|---|---|---|---|---|---|---|---|
| **Animation** | **11 %** | 25 % | 19 % | 19 % | 38 % | **69 %** | **75 %** | **81 %** | **75 %** | 6 % |
| Drama | 55 % | 38 % | 75 % | 81 % | 50 % | 69 % | 50 % | 50 % | 44 % | 46 % |
| Thriller | 33 % | 44 % | 31 % | 25 % | 44 % | 6 % | 19 % | 6 % | 13 % | 18 → 15 % |
| Action | 31 % | 19 % | 13 % | 19 % | 19 % | 13 % | 38 % | 44 % | 25 % | 15 → 12 % |
| Adventure | 31 % | 38 % | 13 % | 25 % | 0 % | 19 % | 13 % | 38 % | 0 % | 9 → 7 % |
| Crime | 27 % | 50 % | 31 % | 6 % | 13 % | 6 % | 13 % | 13 % | 6 % | 11 → 9 % |
| Sci-Fi | 26 % | 13 % | 19 % | 13 % | 19 % | 13 % | 31 % | 44 % | 50 % | 8 → 7 % |

**Export d'exemple** (61 films) : Animation 5 % de l'historique, mais **44 % et 50 %** aux crans 20 000 et 10 000 (31 % à 5 000, 0 % de 1 000 à 200) ; Drama 80 % de l'historique, 88-100 % aux crans 2 000 à 200 ; Sci-Fi 16 % de l'historique, 31-38 % à ∞ et 20 000.

**Lecture** : l'animation est **sur-représentée d'un facteur 6 à 7** aux crans bas de l'export de Thibault, alors que le catalogue sous ces plafonds n'en contient que 6 % : ce n'est pas l'offre, c'est le modèle (un groupe de films d'animation peu notés, très liés entre eux, ressort dès que le plafond retire les films connus). Le polar (Thriller, Crime) disparaît presque aux crans bas, à l'inverse de l'historique.

### 2.2 Films mal notés dans le fold-in (validation, protocole de l'étape 2)

Configuration A, 10 000 utilisateurs de validation, crans sur les comptes d'entraînement (comme `slider_variants.py test`). Variante : les films du fold-in de **percentile < seuil** (percentile calculé sur tout le fold-in, D2 de l'étape 2) sont **retirés du signal** du fold-in ; ils restent « vus » (jamais recommandés). La pertinence ne change pas (note ≥ médiane du fold-in). IC à 95 % non appariés (± 0,0034 sur NDCG à ∞).

| Seuil | Notes retirées | NDCG@20 ∞ | Recall@20 ∞ | Recall_all@20 ∞ | NDCG@20 2 000 | Recall_all@20 2 000 | NDCG@20 500 |
|---|---|---|---|---|---|---|---|
| aucun (actuel) | 0 % | 0,1511 | 0,1875 | 0,1888 | 0,0258 | 0,0347 | 0,0077 |
| 0,1 | 9 % | 0,1556 | 0,1917 | 0,1904 | 0,0264 | 0,0343 | 0,0078 |
| 0,2 | 19 % | 0,1600 | 0,1959 | 0,1920 | 0,0266 | 0,0340 | 0,0080 |
| **0,3** | 29 % | **0,1635 (+8,2 %)** | **0,1990** | **0,1923** | **0,0267** | 0,0335 | **0,0080** |
| 0,4 | 39 % | 0,1650 | 0,1991 | 0,1907 | 0,0265 | 0,0325 | 0,0078 |
| 0,5 | 49 % | 0,1645 | 0,1980 | 0,1883 | 0,0259 | 0,0314 | 0,0075 |

**Lecture** : retirer les films mal notés **améliore** la qualité à ∞ jusqu'à 0,3-0,4 (+8 à +9 % de NDCG) ; aux crans 2 000 et 500, gain faible (dans les IC) jusqu'à 0,3, puis baisse. `Recall_all` (tout film revu, même mal noté) culmine à 0,3 à ∞ et baisse doucement au cran 2 000. **0,3 est le meilleur compromis.**

**Sur l'export de Thibault** (188 films notés ; 45 sous 0,2 comme sous 0,3, à cause des ex æquo de demi-étoiles) : parmi les 16 premières recos de chaque cran, celles dont **un des 2 films de l'historique les plus proches** (cosinus) est mal noté (< 0,3) : 0, 2, 5, 5, 4, 3, 5 et **8**/16 de ∞ à 200 ; avec les 5 plus proches : 4, 4, 8, 8, 5, 5, 6 et **10**/16. Exemple : 0 à 5/16 avec 2 voisins, 11 à 15/16 avec 5.

### 2.3 Versions et montages (catalogue seulement)

- **Mots de version dans le titre** (TMDB ou MovieLens : director's cut, extended, redux, whole bloody affair, version longue, final cut, uncut, special edition, remastered…) : 59 titres avec la liste large, dont **2 vraies autres versions d'un film du catalogue** : *Kill Bill: The Whole Bloody Affair* (2011, 254 notes ; versions de *Kill Bill: Vol. 1* et *Vol. 2*) et *Superman II: The Richard Donner Cut* (2006, 92 notes ; version de *Superman II*). Un troisième, *Stargate SG-1: Children of the Gods – Final Cut*, remonte un épisode télé absent du catalogue. Les autres sont des faux positifs (*Uncut Gems*, *The Final Cut*, *Urban Legends: Final Cut*, *The Browning Version*, les « Holiday Special »…).
- **Même réalisateur + titre très proche** : 509 paires, **aucune version** : 256 suites (*Scream 2 / 3*), 116 titres à suffixe (*Alien / Alien: Covenant*), 117 titres voisins (*Before Sunrise / Before Sunset*), 20 titres identiques = remakes par le même réalisateur ou courts métrages devenus longs (*Funny Games* 1997 / 2008, *The Man Who Knew Too Much* 1934 / 1956, *Bottle Rocket* 1993 / 1996).
- **Lecture** : MovieLens a presque toujours **une seule entrée par film**, toutes versions confondues (*Apocalypse Now*, *Blade Runner*, *Das Boot* n'ont pas d'entrée « redux » ou « final cut »). Le problème est **rare** (2 films) : une liste manuelle suffit, une règle automatique ferait plus de faux positifs que de vrais.

---

## 3. Décisions proposées

### D1. Calibration par genres (Steck 2018), au moment du `recommend`

- **Méthode** : re-classement glouton de Steck (*Calibrated Recommendations*, RecSys 2018). À chaque cran, on choisit les 48 films un par un parmi un **vivier** des `POOL = 200` meilleurs films sous le plafond (score du modèle), en maximisant `(1 − λ) × score normalisé − λ × KL(p ‖ q̃)`, avec :
  - `p(g)` = distribution des genres de l'**historique** (un film à k genres compte 1/k pour chacun ; pondéré par le signal du fold-in `1 + β × p`, donc les films aimés pèsent plus) ;
  - `q(g)` = la même chose sur la liste en cours de construction, `q̃ = (1 − α) q + α p` avec `α = 0,01` (lissage de Steck) ;
  - score normalisé = score / meilleur score du vivier du cran.
- **Genres** : les **genres MovieLens** de `catalog.json` (déjà embarqués, 19 genres, aucune donnée en plus) ; « (no genres listed) » ne compte pas. Les genres TMDB : question Q1.
- **Force** : `λ` choisi en Q3 sur la **validation** : on vise une baisse de NDCG@20 ≤ 5 % à ∞ et à 2 000, pour une calibration (`C_KL` moyen, et « part du genre le plus sur-représenté par rangée de 8 ») nettement meilleure. Valeurs testées : 0 (actuel), 0,3, 0,5, 0,7, 0,9.
- **Où** : une fonction pure `calibrate()` (`web/src/reco/calibrate.ts`), appelée **après** `topByPosition` sur un vivier de 200, **avant** les explications ; référence Python `pipeline/calibration.py` ; cas partagés dans `foldin_cases.json` (liste calibrée au cran 2 000 pour chaque cas). Le fold-in, les scores et `relativeScore` (moyenne des 20 meilleurs du modèle) ne changent pas.
- **Effets sur l'interface** : aucun texte nouveau ; le tampon « ✱ pépite », la diversité des explications et « loin de tes goûts » par rangée s'appliquent aux listes calibrées. Calcul unique, le changement de cran reste sans calcul.
- **Pourquoi pas une règle de quota par rangée** (« un genre au plus `part de l'historique + tolérance` dans chaque rangée de 8 ») : plus simple à expliquer, mais les genres multiples rendent les quotas contradictoires et le seuil est arbitraire. La mesure par rangée sert quand même de **critère** (Q3, Q4).

### D2. Films mal notés retirés du fold-in

- Les films de l'historique dont le **percentile est < 0,3** (percentile calculé sur **tout** l'historique noté, comme aujourd'hui) **ne comptent plus dans le fold-in**. Ils restent **vus** : jamais recommandés, jamais cités dans « parce que t'as aimé » (déjà le cas : percentile ≥ 0,7).
- Les films **sans note** (percentile 0,5) ne sont jamais retirés ; un historique **sans aucune note** ne change pas.
- Garde-fou : si le retrait laisse moins de **5 films** dans le fold-in, on garde tout l'historique (un tout petit export mal noté ne doit pas se vider).
- L'entraînement ne change pas (tous les films vus restent des positifs pour les utilisateurs MovieLens) ; seul le fold-in de l'utilisateur du site change. Mesuré en 2.2 : +8,2 % de NDCG@20 à ∞ sur la validation.
- Code : `fold_in` Python (`models/als.py`, paramètre `drop_below`) et `foldIn` TypeScript ; `export.py` régénère `foldin_cases.json` avec la règle ; le moteur les rejoue à l'identique.
- Le seuil 0,3 est à recaler avec les volontaires (étape 7).

### D3. Action `version_of` dans `pipeline/manual_overrides.csv`

- Nouvelle action : `movie_id,version_of,target_movie_id,,raison` : le film est une **autre version** (montage, version longue) du film cible. Une ligne par cible (*The Whole Bloody Affair* → *Vol. 1* et → *Vol. 2*).
- Effet : si l'**un** des deux est dans l'historique (n'importe quel statut qui entre dans le fold-in), **l'autre est exclu des recommandations** (symétrique : avoir vu la version longue, c'est avoir vu l'original ; question Q2). Pas d'effet sur le modèle ni sur le fold-in.
- `site_catalog.py` écrit `version_of` dans `catalog.json` (paires d'`item_idx`, quelques octets) ; `catalog-verify` vérifie que les deux films sont dans le catalogue ; le moteur ajoute ces films aux exclusions (`exclusions()` de `engine.ts`, et la référence Python des cas du fold-in).
- Liste de départ : les **2 cas** trouvés en 2.3 (3 lignes). D'autres cas s'ajoutent à la main, avec une raison, comme les autres actions.
- L'annotation « (même série que « X », que t'as vu) » reste pour les vraies suites.

### D4. Ordre dans le moteur

`fold-in (D2) → scores → exclusions (vus, non recommandables, ambigus, flou, versions D3) → vivier par cran → calibration (D1) → 48 films par cran → explications, séries`.

---

## 4. Sous-étapes

### Q0 — Diagnostic (fait)

- `pipeline/quality_diagnostics.py`, `web/scripts/quality-report.ts` ; chiffres en section 2.

### Q1 — Versions (D3)

- Action `version_of` (`build_catalog.py` la laisse passer, `site_catalog.py` l'écrit, `catalog-verify`), 3 lignes dans `manual_overrides.csv`, exclusion dans le moteur (TS + référence Python), tests (`pytest`, Vitest : vu *Vol. 1* → *The Whole Bloody Affair* absent ; vu la version longue → *Vol. 1* et *Vol. 2* absents).

### Q2 — Films mal notés hors du fold-in (D2)

- `fold_in(drop_below=0.3)` en Python, `foldIn` en TypeScript, garde-fou des 5 films ; `export.py export --out web` régénère `foldin_cases.json` ; rejeu à l'identique (vecteurs à 10⁻⁹, listes identiques).
- Mesure sur l'export de Thibault : nombre de recos dont un des 2 voisins les plus proches est mal noté (avant / après), genres par cran (avant / après).

### Q3 — Calibration hors ligne (D1, Python, validation) — **arrêt**

- `pipeline/calibration.py` : glouton de Steck, sur la validation avec D2 ; pour λ ∈ {0 ; 0,3 ; 0,5 ; 0,7 ; 0,9} et les crans ∞, 2 000, 500 : NDCG@20, Recall@20, `C_KL` moyen, part maximale d'un genre par rangée de 8 comparée à l'historique, temps.
- **Arrêt** : Thibault choisit λ (proposition : la plus grande valeur qui garde NDCG@20 ≥ 95 % de la valeur sans calibration à ∞ et à 2 000).

### Q4 — Calibration dans le navigateur (D1)

- `calibrate.ts`, vivier de 200, cas partagés (listes calibrées identiques à Python), `reco-bench` (temps), `quality-report` (genres par cran sur l'export de Thibault et l'exemple, avant / après), Playwright (curseur, axe, réseau).

### Q5 — Clôture

- Test **une seule fois** sur la configuration retenue (D2 + D1 au λ choisi), comme à l'étape 2 (C5), si Thibault le valide (Q5) ; section 5 ; `CLAUDE.md`, `docs/stack-technique.md`, `contexte/` ; essai sur un vrai téléphone ; **arrêt** pour relecture.

### Critères de réussite

| Critère | Seuil |
|---|---|
| Qualité hors ligne (validation) | D2 : NDCG@20 à ∞ ≥ actuel (mesuré : +8,2 %) ; D1 : NDCG@20 ≥ 95 % de la valeur sans calibration, à ∞ et à 2 000 |
| Calibration | sur l'export de Thibault, aux crans 2 000 à 200 : part d'animation dans les 16 premières ≤ **2 × sa part dans l'historique + 10 points** (aujourd'hui 69-81 % pour 11 %) ; `C_KL` moyen de la validation réduit d'au moins 30 % |
| Films mal notés | voisins mal notés (2 plus proches) : moins de recos concernées qu'aujourd'hui, à chaque cran de l'export de Thibault |
| Versions | les 2 cas exclus quand l'autre version est vue (tests) |
| Moteur | `foldin_cases.json` régénéré et rejoué à l'identique (vecteurs 10⁻⁹, listes, listes calibrées) |
| Temps | `recommend` + calibration + explications ≤ +100 ms par rapport à aujourd'hui pour 3 000 films ; changement de cran ≤ 50 ms (médiane) |
| Taille | `catalog.json` : + quelques octets (`version_of`) |
| Qualité du code | `pytest`, `ruff`, `npm test`, `typecheck`, `lint`, `format:check`, `build`, `e2e` verts |
| Confidentialité | aucun titre de l'export de Thibault dans un fichier versionné |

---

## 5. Résultats

### Q0 — Diagnostic (8 novembre 2026)

- Chiffres complets en section 2 (genres par cran sur deux exports, six seuils de retrait sur la validation, versions dans le catalogue).
- Remarque sur les ex æquo : sur l'export de Thibault, 45 films sont sous le percentile 0,2 **et** sous 0,3 (notes en demi-étoiles, même rang moyen) ; le seuil agit en pratique sur des **niveaux de note**.

---

## 6. À reporter

- **Genres TMDB** (plus fins que MovieLens, et utiles pour la mention « spectacle ») : enrichissement par `enrich_tmdb.py` puis `catalog.json` ; si Q1 les retient, la calibration les utilisera.
- **Pondération douce des films mal notés** (au lieu d'un retrait : `r = 1 + β × p` avec un β plus grand, ou un poids nul sous le seuil et réduit au-dessus) : non mesurée ; à essayer si D2 déçoit les volontaires.
- **Calibration sur d'autres axes** (décennies, pays, langues) : `etat-de-l-art.md` ; plus tard.
- **Seuils** (percentile 0,3, λ, vivier de 200) : à recaler avec les volontaires (étape 7).

---

## 7. Questions pour la validation

1. **Q1 — Genres MovieLens ou TMDB pour la calibration ?** Proposé : **MovieLens** (déjà dans `catalog.json`, 19 genres, aucune étape de pipeline en plus). TMDB serait un peu plus fin mais demande d'enrichir le catalogue (étape de pipeline, appels TMDB, `catalog.json` plus gros).
2. **Q2 — Exclusion des versions symétrique ?** Proposé : **oui** (vu la version longue → l'original n'est pas proposé, et inversement).
3. **Q3 — Seuil de retrait du fold-in** : proposé **0,3** (meilleur compromis mesuré) ; 0,4 donne un peu plus à ∞ (+0,0015) mais baisse aux crans.
4. **Q4 — Calibration par la méthode de Steck** (glouton sur un vivier de 200, λ choisi en Q3) **plutôt qu'un quota par rangée** ? Proposé : Steck, avec la mesure par rangée comme critère.
5. **Q5 — Évaluation sur le test** : une seule fois, à la clôture, sur la configuration retenue (D2 + D1), pour la documenter comme à l'étape 2 ? Proposé : oui.
6. **Q6 — Ordre de travail** : Q1 (versions, petit) → Q2 (fold-in) → Q3 (calibration hors ligne, arrêt) → Q4 → Q5. D'accord ?
