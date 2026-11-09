# Étape 6c — Qualité des résultats

> Version 0.4 (9 novembre 2026) : décision après Q4 (piste b en version douce : pénalité de proximité aux films mal notés avant la calibration, sous-étape **Q4b**, pas encore codée). Version 0.3 (9 novembre 2026) : décision de Q3 (option B, mode « part de films », λ par cran : 0,1 de ∞ à 10 000, 0,9 de 5 000 à 200, table dans `model-meta.json`). Version 0.2 (8 novembre 2026). Mini-étape insérée entre l'étape 6b (retouches de l'interface) et l'étape 7 (mise en ligne). **Validée par Thibault le 8 novembre 2026** avec ses réponses à la section 7 : genres MovieLens, films sans genre hors des distributions (D1) ; `version_of` dans les deux sens (D3) ; seuil 0,3, films sans note jamais retirés, égalités au bord vérifiées, repli sous 5 films, phrase dans « comment ça marche » (D2) ; Steck sur un vivier de 150 par cran, reclassement une seule fois après l'analyse (D1) ; λ choisi en Q3 (au plus −3 % de NDCG@20 à ∞) ; test une seule fois à la clôture ; ordre Q1 → Q5. Section 8 ajoutée : tags des cartes, **après** Q5.
> Point de départ : l'essai de Thibault (trop d'animation aux crans bas, films proches de films qu'il a mal notés, une autre version d'un film déjà vu). Le diagnostic (Q0) est fait : chiffres en section 2, détails en section 5.

---

## 0. Mode d'emploi (pour Claude Code)

- Relis ce document au début de chaque sous-étape. Les décisions de la section 3 ne changent pas sans accord.
- Une sous-étape à la fois (Q1 → Q5), en suivant « Quand s'arrêter » de `CLAUDE.md`. **Arrêts obligatoires** :
  - en **Q3**, pour que Thibault choisisse la force de la calibration (λ) : courbe λ → NDCG@20 et Recall@20 (validation, à ∞, 2 000 et 500), écart de calibration, part d'animation sur l'export de Thibault et sur l'exemple. Règle proposée par Thibault : **le λ le plus fort qui coûte au plus 3 % de NDCG@20 à ∞** ;
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

- **Méthode** : re-classement glouton de Steck (*Calibrated Recommendations*, RecSys 2018). À chaque cran, on choisit les 48 films un par un parmi un **vivier** des `POOL = 150` meilleurs films sous le plafond (score du modèle ; v0.2), en maximisant `(1 − λ) × score normalisé − λ × KL(p ‖ q̃)`, avec :
  - `p(g)` = distribution des genres de l'**historique** (un film à k genres compte 1/k pour chacun ; pondéré par le signal du fold-in `1 + β × p`, donc les films aimés pèsent plus) ;
  - `q(g)` = la même chose sur la liste en cours de construction, `q̃ = (1 − α) q + α p` avec `α = 0,01` (lissage de Steck) ;
  - score normalisé = score / meilleur score du vivier du cran.
- **Genres** : les **genres MovieLens** de `catalog.json` (déjà embarqués, 19 genres, aucune donnée en plus ; Q1). **Les films sans genre ne comptent ni dans la distribution du profil ni dans celle des recos** (v0.2) : un film sans genre peut être choisi, il ne change pas `q`.
- **Force** : `λ` choisi en Q3 sur la **validation** (v0.2 : **le λ le plus fort qui coûte au plus 3 % de NDCG@20 à ∞**, proposé par Thibault à l'arrêt de Q3), pour une calibration (`C_KL` moyen, et « part du genre le plus sur-représenté par rangée de 8 ») nettement meilleure. Valeurs testées : 0 (actuel), 0,3, 0,5, 0,7, 0,9.
- **Où** : une fonction pure `calibrate()` (`web/src/reco/calibrate.ts`), appelée **une seule fois, après l'analyse** (dans le `recommend({ n: 48 })` unique), **après** `topByPosition` sur un vivier de 150 par cran ; le changement de cran reste un simple affichage (≤ 50 ms en médiane) ; **avant** les explications ; référence Python `pipeline/calibration.py` ; cas partagés dans `foldin_cases.json` (liste calibrée au cran 2 000 pour chaque cas). Le fold-in, les scores et `relativeScore` (moyenne des 20 meilleurs du modèle) ne changent pas.
- **Effets sur l'interface** : aucun texte nouveau ; le tampon « ✱ pépite », la diversité des explications et « loin de tes goûts » par rangée s'appliquent aux listes calibrées. Calcul unique, le changement de cran reste sans calcul.
- **Pourquoi pas une règle de quota par rangée** (« un genre au plus `part de l'historique + tolérance` dans chaque rangée de 8 ») : plus simple à expliquer, mais les genres multiples rendent les quotas contradictoires et le seuil est arbitraire. La mesure par rangée sert quand même de **critère** (Q3, Q4).

- **v0.3 (décision de Thibault après Q3, option B)** : mode **« part de films »** (et non « masse ») ; **λ par cran** : **0,1** à ∞, 20 000 et 10 000 ; **0,9** de 5 000 à 200. Table dans `model-meta.json` (`calibration.lambda_by_position`), jamais en dur dans le code, pour la recaler avec les volontaires. Raison : la règle « au plus −3 % de NDCG@20 » s'applique à ∞, où la métrique mesure bien ce qu'on veut ; aux crans bas, NDCG@20 ≈ 0,008 ne voit presque plus rien et la dérive de genre observée (94-100 % d'animation pour 13 % de l'historique) domine. La vraie mesure aux crans bas sera la question des volontaires (étape 7). Transition 10 000 → 5 000 vérifiée (pas de palier à 0,5 : voir Q4).

### D1b. Pénalité de proximité aux films mal notés, avant la calibration (v0.4, décision de Thibault après Q4)

- Aux crans où λ = 0,9 (5 000 à 200), **avant** la calibration, le score de chaque film du vivier devient
  **`score' = score − μ × max(cosinus avec les films mal notés de l'historique)`** ; la calibration (D1) travaille sur `score'`.
- « Mal notés » = les films **retirés du fold-in** par D2 (notés, percentile < 0,3) ; aucun film mal noté (ou historique sans note) → pas de pénalité.
- **Pas de filtre** : aucun film n'est retiré du vivier.
- **Raison** : « mal noté » = 30 % de l'historique par construction (percentile < 0,3), donc au hasard environ la moitié des recos (≈ 8/16) ont un film mal noté parmi leurs 2 plus proches voisins ; D2 seul est sous le hasard, la calibration y ramène ; un filtre dur retirerait la moitié du vivier.
- À étendre à tous les crans **si la mesure le justifie** (Q4b).
- **μ** dans `model-meta.json` (comme la table des λ), jamais en dur dans le code ; référence Python + parité TypeScript, comme D1.
- Si **aucun μ ne convient** (Q4b) : **option a** (on garde D1 tel quel), à juger avec les volontaires (étape 7).

### D2. Films mal notés retirés du fold-in

- Les films de l'historique dont le **percentile est < 0,3** (percentile calculé sur **tout** l'historique noté, comme aujourd'hui) **ne comptent plus dans le fold-in**. Ils restent **vus** : jamais recommandés, jamais cités dans « parce que t'as aimé » (déjà le cas : percentile ≥ 0,7).
- Les films **sans note** (percentile 0,5) ne sont **jamais** retirés ; un historique **sans aucune note** ne change pas.
- **Égalités au bord du seuil** : les ex æquo ont le même percentile (rang moyen, D2 de l'étape 2), donc un groupe de notes égales est retiré **en entier** ou gardé en entier ; la comparaison est stricte (`p < 0,3`). Testé en Python et en TypeScript, y compris un groupe dont le percentile vaut exactement 0,3 (gardé).
- Garde-fou : si le retrait laisse moins de **5 films** dans le fold-in, on garde tout l'historique (un tout petit export mal noté ne doit pas se vider).
- **Modifie la D2 de l'étape 2** (`docs/etape-2-modele.md` : « tout film vu est un positif ») **pour le fold-in de l'utilisateur du site** ; noté dans `contexte/decisions.md`, l'ancienne règle marquée ✗ avec la raison.
- « comment ça marche » : une phrase sur ce retrait (texte de Claude Web, en fin d'étape).
- L'entraînement ne change pas (tous les films vus restent des positifs pour les utilisateurs MovieLens) ; seul le fold-in de l'utilisateur du site change. Mesuré en 2.2 : +8,2 % de NDCG@20 à ∞ sur la validation.
- Code : `fold_in` Python (`models/als.py`, paramètre `drop_below`) et `foldIn` TypeScript ; `export.py` régénère `foldin_cases.json` **hors du dépôt** (`pipeline/data/processed/export/`, `web/test-data/`) avec la règle ; le moteur les rejoue : listes identiques, vecteurs à **10⁻¹⁵** près (v0.2 ; écart mesuré à l'étape 4 : 3·10⁻¹⁵).
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

- `pipeline/calibration.py` : glouton de Steck (vivier de 150), sur la validation avec D2 ; pour λ ∈ {0 ; 0,3 ; 0,5 ; 0,7 ; 0,9} et les crans ∞, 2 000, 500 : NDCG@20, Recall@20, `C_KL` moyen, part maximale d'un genre par rangée de 8 comparée à l'historique, temps.
- Mesures aussi sur l'**export de Thibault** et l'**exemple** (`quality-report`, avec la calibration de `calibrate.ts` appliquée hors de l'interface) : part d'animation par cran pour chaque λ.
- **Arrêt** : Thibault choisit λ (règle : **le λ le plus fort qui coûte au plus 3 % de NDCG@20 à ∞**).

### Q4 — Calibration dans le navigateur (D1)

- `calibrate.ts`, vivier de 150, cas partagés (listes calibrées identiques à Python), `reco-bench` (temps), `quality-report` (genres par cran sur l'export de Thibault et l'exemple, avant / après), Playwright (curseur, axe, réseau).

### Q4b — Pénalité de proximité aux films mal notés (D1b) — mesurée, **arrêt** pour le choix de μ (section 5)

- `pipeline/calibration.py` : `score'` avant la calibration aux crans à λ = 0,9 (option : tous les crans) ; **balayage de μ** sur la **validation** (D2 + D1 + D1b), NDCG@20 et Recall@20 à ∞, 2 000 et 500, avec la **règle −3 % de NDCG@20 à ∞** (par rapport à D2 + D1).
- **Mesure sur les deux exports** (`quality-report`) : part des 16 premières recos dont un des 2 films de l'historique les plus proches est mal noté, **nettement sous 8/16** aux crans 5 000 à 200 (après Q4 : 10, 9, 8, 8, 7 sur l'export de Thibault) ; **animation toujours ≤ 31 %** à chaque cran.
- Si un μ convient : `model-meta.json`, `calibrate.ts` / `engine.ts`, fixture régénérée hors du dépôt et parité Python / TypeScript (listes identiques), `reco-bench`, Playwright. **Arrêt** pour le choix de μ.
- Si **aucun μ ne convient** : option **a** (D1 seul), à juger avec les volontaires ; noter en §6.

### Q5 — Clôture

- Test **une seule fois** sur la configuration retenue (D2 + D1 au λ choisi), comme à l'étape 2 (C5), si Thibault le valide (Q5) ; section 5 ; `CLAUDE.md`, `docs/stack-technique.md`, `contexte/` ; essai sur un vrai téléphone ; **arrêt** pour relecture.

### Critères de réussite

| Critère | Seuil |
|---|---|
| Qualité hors ligne (validation) | D2 : NDCG@20 à ∞ ≥ actuel (mesuré : +8,2 %) ; D1 : NDCG@20 à ∞ ≥ 97 % de la valeur sans calibration (règle de Q3) |
| Calibration | sur l'export de Thibault, aux crans 2 000 à 200 : part d'animation dans les 16 premières ≤ **2 × sa part dans l'historique + 10 points** (aujourd'hui 69-81 % pour 11 %) ; `C_KL` moyen de la validation réduit d'au moins 30 % |
| Films mal notés | voisins mal notés (2 plus proches) : moins de recos concernées qu'aujourd'hui, à chaque cran de l'export de Thibault |
| Versions | les 2 cas exclus quand l'autre version est vue (tests) |
| Moteur | `foldin_cases.json` régénéré hors du dépôt et rejoué : listes identiques (y compris calibrées), vecteurs à 10⁻¹⁵ près (écart maximal mesuré et noté) |
| Temps | `recommend` + calibration + explications ≤ +100 ms par rapport à aujourd'hui pour 3 000 films ; changement de cran ≤ 50 ms (médiane) |
| Taille | `catalog.json` : + quelques octets (`version_of`) |
| Qualité du code | `pytest`, `ruff`, `npm test`, `typecheck`, `lint`, `format:check`, `build`, `e2e` verts |
| Confidentialité | aucun titre de l'export de Thibault dans un fichier versionné |

---

## 5. Résultats

### Q0 — Diagnostic (8 novembre 2026)

- Chiffres complets en section 2 (genres par cran sur deux exports, six seuils de retrait sur la validation, versions dans le catalogue).
- Remarque sur les ex æquo : sur l'export de Thibault, 45 films sont sous le percentile 0,2 **et** sous 0,3 (notes en demi-étoiles, même rang moyen) ; le seuil agit en pratique sur des **niveaux de note**.

### Q1 — Versions (8 novembre 2026)

- Action `version_of` (`build_catalog.py` : cible obligatoire, pas de film version de lui-même, pas de doublon, plusieurs lignes permises pour un même film) ; 3 lignes dans `manual_overrides.csv` (*Kill Bill: The Whole Bloody Affair* → *Vol. 1* et *Vol. 2* ; *Superman II: The Richard Donner Cut* → *Superman II*).
- `catalog.json` : `version_of` = 3 paires d'`item_idx` (`site_catalog.version_pairs`, vérifié par `catalog-verify`) ; total `web/public/data/` 3 115 839 octets gzip (+65).
- Moteur : `versionPartners`, `versionExclusions` (`engine.ts`) : les autres versions des films **vus** (historique) sont exclues ; référence Python `version_partners` / `seen_mask` (`export.py`) ; nouveau cas `version_seen` dans `foldin_cases.json`.
- Tests : `pytest` (lecture, fichiers invalides, paires), Vitest (paires dans les deux sens, exclusion, cas `version_seen` : jamais recommandé à aucun cran). Parité : 23 cas, 69 listes identiques, écart des vecteurs 3,3·10⁻¹⁵.

### Q2 — Films mal notés hors du fold-in (8 novembre 2026)

- Python : `als.kept_for_foldin` (seuil strict en float64 sur les percentiles float32, groupes d'ex æquo en bloc, films sans note jamais retirés, repli sous 5 films) ; `export.py` : `FOLDIN_RULE = {drop_below: 0,3, min_kept: 5}`, écrit dans `model-meta.json` (`foldin_drop_below`, `foldin_min_kept`, `foldin_rule`) ; deux cas ajoutés : `ties_at_threshold` (p = 0,05 ×2 et 0,2 retirés, p = 0,3 exactement **gardé**) et `guard_small` (6 films, 2 sous le seuil → tout gardé).
- TypeScript : `keptForFoldIn` (`foldIn.ts`), appliqué par `recommend` ; un ancien `model-meta.json` sans la règle garde tout.
- `foldin_cases.json` régénéré **hors du dépôt** (`pipeline/data/processed/export/`, `web/test-data/`) : **25 cas, 75 listes identiques**, `export.py verify` : écart 0 ; TypeScript : **écart maximal des vecteurs 2,0·10⁻¹⁵**, des scores 2,2·10⁻¹⁵ (seuil des tests resserré de 10⁻⁹ à **10⁻¹⁴**).
- Tests : `pytest` (ex æquo, 0,3 exact, sans note, repli), Vitest (mêmes cas + rejeu).
- **Export de Thibault, après D2** (16 premières recos) : recos dont un des 2 voisins les plus proches est mal noté : 0, 1, 3, 5, 1, 2, 3, 5 de ∞ à 200 (avant : 0, 2, 5, 5, 4, 3, 5, 8 ; **20 au lieu de 32** au total). Critère « moins à chaque cran » : **égalité** à ∞ (0) et à 5 000 (5), baisse ailleurs ; **égalités acceptées par Thibault** (9 novembre 2026). Exemple : 2, 0, 1, 5, 5, 2, 0, 0 (avant : 5, 4, 2, 5, 5, 2, 0, 0).
- Genres après D2 (sans calibration) : l'animation **monte encore** sur l'export de Thibault (94 % à 2 000, 100 % à 500, 75 % à 200) : c'est le rôle de D1.
- `decisions.md` : nouvelle règle, ancienne règle de l'étape 2 marquée ✗ avec la raison. La phrase de « comment ça marche » viendra de Claude Web en fin d'étape.

### Q3 — Calibration hors ligne (8 novembre 2026) — ⏸ arrêt : choix de λ (et du mode)

**Code** : `pipeline/calibration.py` (référence, glouton vectorisé par lots, `sweep --mode mass|share --lambdas …`), `web/src/reco/calibrate.ts` (même algorithme, pas encore branché sur le site), tests `pytest` et Vitest sur les mêmes cas ; `web/scripts/quality-report.ts --lambdas … [--share] [--pool N]` (exports, terminal). Protocole : validation, 10 000 utilisateurs, configuration A **avec D2**, vivier de 150 par cran, liste de 48, α = 0,01, crans sur les comptes d'entraînement.

**Deux façons de compter les genres** (écart découvert pendant Q3, voir plus bas) :
- **« masse »** (Steck, D1 v0.2) : un film à k genres compte 1/k pour chacun ; KL entre distributions ;
- **« part »** (variante ajoutée) : chaque genre est oui / non par film ; on compare la **part de films** qui ont chaque genre (KL de Bernoulli, somme sur les genres). C'est la grandeur que Thibault regarde (« 75 % de films d'animation »).

**Courbe λ → qualité (validation)**. NDCG@20 (écart à λ = 0), Recall@20, `C_KL@20` (écart de calibration, toujours mesuré en « masse » pour comparer), « excès » = de combien de points la part de films du genre le plus sur-représenté dépasse sa part dans le profil, dans la première rangée de 8 (moyenne des utilisateurs) :

| Mode | λ | NDCG@20 ∞ | Recall@20 ∞ | NDCG@20 2 000 | NDCG@20 500 | C_KL@20 ∞ / 2 000 / 500 | Excès ∞ / 2 000 / 500 |
|---|---|---|---|---|---|---|---|
| — | 0 (D2 seul) | 0,1635 | 0,1990 | 0,0267 | 0,0080 | 0,35 / 0,84 / 1,12 | 0,31 / 0,34 / 0,36 |
| masse | 0,1 | 0,1637 (+0,1 %) | 0,1992 | 0,0267 (+0,1 %) | 0,0081 | 0,32 / 0,76 / 1,00 | 0,30 / 0,32 / 0,35 |
| masse | 0,2 | 0,1636 (0,0 %) | 0,1994 | 0,0265 (−0,7 %) | 0,0080 | 0,30 / 0,67 / 0,87 | 0,28 / 0,31 / 0,33 |
| masse | 0,3 | 0,1620 (−1,0 %) | 0,1993 | 0,0259 (−3,0 %) | 0,0078 | 0,28 / 0,59 / 0,75 | 0,28 / 0,30 / 0,31 |
| **masse** | **0,4** | **0,1587 (−3,0 %)** | 0,1993 | 0,0251 (−6,2 %) | 0,0074 | 0,25 / 0,50 / 0,64 | 0,27 / 0,29 / 0,30 |
| masse | 0,5 | 0,1550 (−5,2 %) | 0,1979 | 0,0243 (−9,2 %) | 0,0072 | 0,22 / 0,43 / 0,55 | 0,26 / 0,27 / 0,28 |
| masse | 0,8 | 0,1399 (−14,4 %) | 0,1922 | 0,0214 (−20,0 %) | 0,0062 | 0,12 / 0,21 / 0,29 | 0,24 / 0,23 / 0,23 |
| masse | 0,9 | 0,1314 (−19,7 %) | 0,1858 | 0,0196 (−26,5 %) | 0,0057 | 0,08 / 0,13 / 0,20 | 0,23 / 0,22 / 0,22 |
| masse | 0,99 | 0,1038 (−36,6 %) | 0,1481 | 0,0156 (−41,6 %) | 0,0046 | 0,03 / 0,07 / 0,14 | 0,24 / 0,22 / 0,22 |
| part | 0,05 | 0,1620 (−0,9 %) | 0,1992 | 0,0265 (−0,9 %) | 0,0079 | 0,32 / 0,72 / 0,95 | 0,28 / 0,30 / 0,32 |
| **part** | **0,1** | **0,1598 (−2,3 %)** | 0,1994 | 0,0261 (−2,2 %) | 0,0077 | 0,29 / 0,62 / 0,80 | 0,26 / 0,27 / 0,29 |
| part | 0,15 | 0,1570 (−4,0 %) | 0,1994 | 0,0258 (−3,3 %) | 0,0076 | 0,27 / 0,54 / 0,70 | 0,24 / 0,25 / 0,26 |
| part | 0,2 | 0,1539 (−5,9 %) | 0,1983 | 0,0254 (−4,9 %) | 0,0074 | 0,24 / 0,48 / 0,62 | 0,22 / 0,23 / 0,24 |
| part | 0,5 | 0,1422 (−13,1 %) | 0,1940 | 0,0231 (−13,7 %) | 0,0068 | 0,15 / 0,26 / 0,35 | 0,17 / 0,16 / 0,16 |
| part | 0,8 | 0,1282 (−21,6 %) | 0,1805 | 0,0205 (−23,3 %) | 0,0060 | 0,08 / 0,13 / 0,21 | 0,12 / 0,11 / 0,12 |
| part | 0,9 | 0,1192 (−27,1 %) | 0,1676 | 0,0192 (−28,3 %) | 0,0056 | 0,06 / 0,11 / 0,18 | 0,10 / 0,11 / 0,12 |
| part | 0,99 | 0,0976 (−40,3 %) | 0,1315 | 0,0159 (−40,5 %) | 0,0047 | 0,05 / 0,09 / 0,17 | 0,10 / 0,11 / 0,12 |

(Valeurs 0,95 et 0,98 dans `pipeline/data/processed/results/quality/calibration_val_*.json`.) λ = 0 retrouve exactement D2 (0,1635 / 0,0267 / 0,0080).

**Part de films d'animation dans les 16 premières** (∞, 20 000, 10 000, 5 000, 2 000, 1 000, 500, 200 ; `quality-report`, avec D2) :

| | Export de Thibault (historique gardé : 13 % de films d'animation) | Exemple (7 %) |
|---|---|---|
| sans calibration | 25, 19, 31, 50, **94, 81, 100, 75** | 31, 44, 44, 25, 13, 0, 0, 0 |
| masse λ = 0,4 | 19, 19, 31, 63, **81, 75, 94, 81** | 31, 44, 38, 25, 19, 0, 6, 0 |
| part λ = 0,1 | 19, 19, 25, 50, **81, 81, 88, 69** | 31, 44, 38, 25, 19, 0, 6, 0 |
| part λ = 0,15 | 19, 19, 25, 50, **75, 75, 88, 63** | 31, 44, 38, 25, 19, 0, 6, 0 |
| masse λ = 0,99 | 13, 19, 19, 19, 38, 25, 38, 31 | 13, 13, 13, 13, 6, 13, 6, 6 |
| part λ = 0,8 | 13, 19, 13, 31, 44, 50, 44, 38 | 13, 19, 19, 19, 6, 6, 6, 6 |
| part λ = 0,9 | 13, 19, 19, 19, **31, 31, 31, 25** | 13, 13, 13, 13, 6, 6, 6, 6 |

**Lecture** :
1. **Avec la règle « au plus −3 % de NDCG@20 à ∞ »**, le λ retenu serait **0,4 en « masse »** (−3,0 %) ou **0,1 en « part »** (−2,3 % ; 0,15 coûte −4,0 %). Dans les deux cas, **l'animation reste à 69-94 % aux crans 2 000 à 200 de l'export de Thibault** : le critère de la spec (≤ 2 × 13 % + 10 points = 36 %) n'est **pas** atteint.
2. **« masse » ne règle pas l'animation, même à λ fort** : un film d'animation a souvent 3-4 genres MovieLens (*Animation | Adventure | Children | Fantasy*), il ne pèse que 1/4 dans « Animation » ; à λ = 0,99 l'écart de calibration est presque nul mais il reste 38 % de films d'animation à 2 000 et à 500. Un vivier plus grand n'y change rien (300 et 600 essayés : mêmes parts à ± 6 points).
3. **« part » vise la bonne grandeur** : à λ = 0,9, 25-31 % d'animation aux crans bas de l'export de Thibault (critère atteint), l'excès par rangée tombe de 0,34 à 0,11 sur la validation, au prix de −27 % de NDCG@20 à ∞ et −28 % à 2 000.
4. Le coût vient surtout de **l'ordre** : Recall@20 bouge peu jusqu'à λ = 0,3 (0,1990 → 0,1967 en « part ») ; NDCG baisse parce que les meilleurs films descendent de quelques places.
5. **Aux crans bas, la qualité hors ligne est déjà minuscule** (NDCG@20 de 0,008 à 500, contre 0,16 à ∞), et c'est là que la sur-représentation est la plus forte (excès 0,36). La règle des 3 % à ∞ protège surtout ∞, où la calibration est la moins nécessaire.

**Pistes pour le choix (arrêt)** :
- **A. Règle telle quelle** : « masse » λ = 0,4 ou « part » λ = 0,1. Coût ≤ 3 % ; effet faible sur l'animation (69-94 % aux crans bas de l'export de Thibault).
- **B. λ par cran, mode « part »** (recommandé) : λ faible là où le modèle est le plus fiable (∞ à 10 000 : 0,1, −2,3 % à ∞, règle respectée), fort aux crans bas où le profil dérive (5 000 à 200 : 0,8 ou 0,9 ; NDCG@20 −23 à −28 % à 2 000, mais sur une base de 0,027). Sur l'export de Thibault : animation 19-25 % de ∞ à 10 000, 31-50 % de 5 000 à 200 (λ 0,8) ou 19-31 % (λ 0,9). Une ligne de plus dans D1 : `λ(cran)`.
- **C. Pas de calibration au MVP**, D2 seul ; reporter à l'étape 7 avec les retours des volontaires.

**Temps** (Node, `quality-report`, 8 crans × 48 parmi 150) : **70 à 160 ms** selon l'export et λ, au-delà de ce que vise la spec (+100 ms au total avec les explications pour 3 000 films). La version TypeScript recalcule toute la distribution pour chaque candidat ; en Q4 elle doit passer à une mise à jour incrémentale (seuls les genres du candidat changent) : à mesurer, objectif ≤ 30 ms.

**Remarque** : à λ fort, les films **sans genre** (227 sur 23 019) sont favorisés une fois les genres équilibrés, puisqu'ils ne changent pas la distribution (réponse Q1) ; effet visible dans les tests, marginal en pratique (1 % du catalogue).

**Décision de Thibault (9 novembre 2026)** : option **B**, mode « part de films », λ = 0,1 de ∞ à 10 000 et 0,9 de 5 000 à 200 (table dans `model-meta.json`) ; raison : la règle « au plus −3 % de NDCG@20 » s'applique à ∞, où la métrique mesure bien ce qu'on veut ; aux crans bas, NDCG@20 ≈ 0,008 ne voit presque plus rien et la dérive de genre observée (94-100 % d'animation pour 13 % de l'historique) domine. La vraie mesure aux crans bas sera la question des volontaires (étape 7).

### Q4 — Calibration dans le navigateur (9 novembre 2026) — ⏸ arrêt : voisins mal notés aux crans bas

- **Transition 10 000 → 5 000** (16 premières, `quality-report --tables`) : films communs entre les deux crans · écart de genres (somme des |Δ part|). Export de Thibault : sans calibration 4/16 · 1,69 ; λ = 0,1 partout 3/16 · 1,44 ; **B 2/16 · 1,31** ; B avec palier 0,5 à 5 000 : 3/16 · 1,56 (et 44 % d'animation à 5 000 au lieu de 19 %). Exemple : sans calibration 5/16 · 1,81 ; **B 4/16 · 1,44** ; palier 5/16 · 1,56. Entre crans voisins les listes changent toujours beaucoup (le plafond change les candidats : 0 à 8 films communs sur 16 sans calibration) ; avec B, l'écart de genres au passage 10 000 → 5 000 est **plus petit** que sans calibration. **Pas de palier.**
- **Code** : `calibration.PRODUCTION` (Python) → `model-meta.json` `calibration` (`mode: share`, `pool: 150`, `n_list: 48`, `alpha: 0,01`, `lambda_by_position`, `positions`) ; référence un-utilisateur incrémentale `calibrate_one` / `share_profile_one` (`calibration.py`, testée contre la version par lots : 120 listes identiques) ; TypeScript `calibrateShare` / `shareProfile` / `lambdaOf` (`calibrate.ts`) et `calibratePositions` (`engine.ts`) : calcul **une seule fois** dans `recommend`, sur un vivier de 150 par cran, profil = films gardés dans le fold-in (D2) pondérés par leur signal ; `relativeScore` du cran inchangé (ordre du modèle), score relatif par carte sur la même base. Le changement de cran reste un affichage.
- **Incrémental** : à chaque pas, la divergence de base et un Δ par genre (19) sont calculés une fois ; un candidat coûte la somme des Δ de ses genres. Les comptes de genres sont des entiers : Python et TypeScript font exactement les mêmes opérations.
- **Parité** : `foldin_cases.json` régénéré hors du dépôt : 25 cas, 75 listes du modèle et **200 listes calibrées** (8 crans × 25 cas, 48 films) **identiques** en Python (`export.py verify`) et en TypeScript ; vecteurs 2,0·10⁻¹⁵.
- **Temps** (`reco-bench`, médiane de 7) : **calibration 3 à 7,5 ms** pour les 8 crans (objectif ≤ 30 ms). `recommend` complet pour 3 000 films : 123-255 ms selon la charge de la machine ; **sans calibration, mesuré juste avant dans les mêmes conditions : 128-151 ms** : la calibration ajoute < 10 ms (critère +100 ms tenu). Playwright : 11 verts, changement de cran **33 ms** en médiane (pire 46 ms), modèle prêt 1,2 s (machine chargée).
- **Tests** : Vitest 267 (rejeu des 200 listes calibrées ; deux anciens tests qui supposaient l'ordre du modèle à ∞ adaptés : le top 10 de `recommend()` est celui de la liste calibrée, et le score relatif par carte a la même base pour tous les films) ; `pytest` (référence incrémentale = version par lots, table de λ d'une valeur par cran).
- **Résultat sur l'export de Thibault** (16 premières, part de films ; historique entre parenthèses) : **Animation (11 %) : 19, 19, 25, 19, 31, 31, 31, 25 %** de ∞ à 200 (avant : 25, 19, 31, 50, 94, 81, 100, 75) ; Thriller (33 %) 19-31 % ; Crime (27 %) 6-38 % ; Drama (55 %) 50-75 %. Exemple : Animation (5 %) 31, 44, 38, 13, 6, 6, 6, 6 %.
- ⚠️ **Voisins mal notés** (recos dont un des 2 films de l'historique les plus proches est mal noté, < 0,3) : export de Thibault **1, 2, 3, 10, 9, 8, 8, 7** /16 de ∞ à 200 (après D2 seul : 0, 1, 3, 5, 1, 2, 3, 5 ; avant 6c : 0, 2, 5, 5, 4, 3, 5, 8). En écartant l'animation, la calibration prend dans le vivier des films proches de films que Thibault a mal notés. Exemple : 2, 0, 1, 2, 4, 0, 0, 0. **Le critère « films mal notés » de la section 4 échoue aux crans 5 000 à 200 avec la configuration complète** : arrêt avant Q5 (Q5 consomme l'évaluation unique sur le test).
- **Décision de Thibault (9 novembre 2026)** : piste **b en version douce** (pénalité, pas de filtre) → D1b, sous-étape **Q4b** (à faire). Raison : « mal noté » = 30 % de l'historique par construction (percentile < 0,3), donc au hasard environ la moitié des recos (≈ 8/16) ont un film mal noté parmi leurs 2 plus proches voisins ; D2 seul est sous le hasard, la calibration y ramène ; un filtre dur retirerait la moitié du vivier.
- **Pistes** (examinées à l'arrêt) :
  - **a.** accepter : la mesure regarde la ressemblance avec un film mal noté, pas la qualité ; à juger sur l'écran et avec les volontaires ;
  - **b.** retirer du vivier de calibration (crans bas) les films dont un des 2 voisins les plus proches de l'historique est mal noté (cosinus, déjà calculé pour les explications) : simple, à mesurer (validation + exports) ;
  - **c.** baisser λ aux crans bas (par ex. 0,5 : animation 69-94 % → à mesurer) ;
  - **d.** mettre les films mal notés dans le profil comme un « anti-profil » (pénaliser les genres que l'utilisateur a mal notés) : plus long.

### Q4b — Pénalité de proximité aux films mal notés (9 novembre 2026) — ⏸ arrêt : choix de μ (ou option a)

**Forme mesurée** (précision de D1b, à valider) : `s'_k = score_k / s_max − μ × max(0, cosinus max de k avec les films retirés du fold-in par D2)`, où `s_max` est le meilleur score du vivier du cran ; la calibration travaille sur `s'` sans renormaliser. μ est donc en **unités du meilleur score du vivier**, et non en score brut, pour deux raisons. D'abord, le meilleur score du vivier baisse d'un facteur ~15 du cran 5 000 au cran 200 (médianes sur la validation : 0,64 à ∞, 0,147 à 5 000, 0,065 à 2 000, 0,020 à 500, 0,010 à 200). Ensuite, il varie d'un facteur ~10 d'un utilisateur à l'autre : un μ brut n'aurait pas le même effet d'un cran ni d'un utilisateur à l'autre. Les cosinus négatifs (0,4 à 2 % des couples) sont ramenés à 0 : la pénalité n'est jamais un bonus. Aucun film n'est retiré du vivier.

**Code** (référence, pas branché sur le site) : `calibration.py` (`unit_rows`, `proximity`, paramètre `penalty` de `calibrate_one` / `calibrate_batch`, `disliked_near`, commande `penalty-sweep --mus … --tag …`) ; `calibrate.ts` (`proximity`, paramètre `penalty` de `calibrateShare`) ; `quality-report.ts --mus … [--all-positions]`. Tests `pytest` et Vitest sur les mêmes cas. `model-meta.json`, `engine.ts` et la fixture ne changent pas tant que μ n'est pas choisi.

**Validation** (10 000 utilisateurs, D2 + D1 « part » au λ de production : 0,1 à ∞, 0,9 à 2 000 et 500 ; pénalité appliquée aux trois crans mesurés ; à ∞, elle mesure l'option « tous les crans », l'option de D1b laisse ∞ à μ = 0). 99,3 % des utilisateurs ont au moins un film retiré du fold-in. « Voisins » = nombre moyen, parmi les 16 premières recos, de celles dont un des 2 films du fold-in les plus proches est mal noté (IC à 95 % : ± 0,03 à 0,09).

| μ | NDCG@20 ∞ | NDCG@20 2 000 | NDCG@20 500 | Recall@20 ∞ / 2 000 / 500 | Voisins /16 ∞ / 2 000 / 500 | C_KL@20 2 000 / 500 |
|---|---|---|---|---|---|---|
| 0 (D2 + D1) | 0,1598 | 0,0192 | 0,0056 | 0,1994 / 0,0221 / 0,0061 | 3,71 / 6,69 / 7,39 | 0,106 / 0,179 |
| 0,25 | 0,1596 (−0,1 %) | 0,0188 (−2,1 %) | 0,0054 (−3,6 %) | 0,1979 / 0,0216 / 0,0059 | 2,83 / 6,27 / 7,09 | 0,105 / 0,178 |
| 0,5 | 0,1559 (−2,4 %) | 0,0183 (−4,7 %) | 0,0052 (−7 %) | 0,1908 / 0,0209 / 0,0057 | 2,09 / 5,87 / 6,83 | 0,105 / 0,179 |
| 1 | 0,1397 (−12,6 %) | 0,0161 (−16 %) | 0,0048 (−14 %) | 0,1640 / 0,0181 / 0,0052 | 1,05 / 5,23 / 6,37 | 0,108 / 0,183 |
| 2 | 0,1097 (−31 %) | 0,0125 (−35 %) | 0,0036 (−36 %) | 0,1255 / 0,0138 / 0,0038 | 0,55 / 4,61 / 5,91 | 0,122 / 0,197 |
| 5 | 0,0805 (−50 %) | 0,0092 (−52 %) | 0,0028 (−50 %) | 0,0951 / 0,0098 / 0,0030 | 0,55 / 4,05 / 5,36 | 0,181 / 0,253 |

(IC à 95 % de NDCG@20 : ± 0,0034 à ∞, ± 0,0010 à 2 000, ± 0,0005 à 500 ; résultats dans `pipeline/data/processed/results/quality/penalty_val_{a,b}.json`.) μ = 0 retrouve exactement D2 + D1 (Q3 : 0,1598 / 0,0192 / 0,0056).

**Exports** (`quality-report --mus`, pénalité aux crans 5 000 à 200, ∞ à 10 000 inchangés). Voisins mal notés /16 (2 plus proches parmi les films notés, < 0,3) · animation dans les 16 premières, crans 5 000 · 2 000 · 1 000 · 500 · 200 :

| μ | Export de Thibault (45 films hors du fold-in sur 188) | Exemple (16 sur 61) |
|---|---|---|
| 0 (Q4) | **10 · 9 · 8 · 8 · 7** ; anim. 19 · 31 · 31 · 31 · 25 % | 2 · 4 · 0 · 0 · 0 ; anim. 13 · 6 · 6 · 6 · 6 % |
| 0,5 | 7 · 5 · 8 · 9 · 7 ; anim. 31 · 31 · 31 · 31 · 19 % | 3 · 2 · 0 · 0 · 0 ; anim. ≤ 19 % |
| 1 | 5 · 4 · 8 · 6 · 6 ; anim. 31 · 31 · 25 · 31 · 25 % ✓ | 1 · 0 · 0 · 0 · 0 ; anim. ≤ 13 % |
| 2 | 4 · 4 · 6 · 7 · 6 ; anim. **38** · 31 · 31 · 25 · 19 % | 1 · 0 · 0 · 0 · 0 ; anim. ≤ 19 % |
| 3 | 3 · 4 · 4 · 6 · 5 ; anim. **38 · 38** · 25 · 25 · 19 % | 2 · 0 · 0 · 0 · 0 ; anim. ≤ 25 % |
| 5 | 1 · 3 · 3 · 5 · 5 ; anim. **50** · 31 · 25 · 19 · 13 % | 2 · 0 · 0 · 0 · 0 ; anim. ≤ **38** % |
| 10 | 1 · 0 · 3 · 4 · 5 ; anim. **56** · 31 · 19 · 19 · 6 % | 2 · 0 · 0 · 0 · 0 ; anim. ≤ **50** % |

Score moyen (modèle) des 16 premières, rapporté à μ = 0 : 0,84-1,00 à μ = 1, 0,82-0,90 à μ = 2, 0,73-0,85 à μ = 5 (export de Thibault) ; temps de la calibration avec la pénalité : 14-48 ms dans le script pour les 8 crans (non optimisé, cosinus recalculés).

**Option « tous les crans »** (export de Thibault) : à μ = 0,5, voisins 0 · 1 · 1 à ∞ · 20 000 · 10 000, mais l'animation y monte à 38 · 19 · **56 %** (19 · 19 · 25 % sans pénalité) : à ces crans, λ = 0,1 ne retient plus le genre. Écartée.

**Variante relative essayée** (mesure seulement, hors D1b, retirée du code) : `max(0, cos max mal notés − cos max autres films notés)`. Encore plus faible : 6 · 5 · 7 · 7 · 4 à μ = 5 sur l'export de Thibault ; rien ne bouge sur l'exemple, même à μ = 10.

**Lecture** :
1. **Aux crans à λ = 0,9, la pénalité agit peu** : le score ne pèse que 1 − λ = 0,1 dans l'objectif, la pénalité avec lui ; la divergence de genres décide. Il faut μ ≥ 1 pour un effet visible, et plus μ monte, plus le terme de score (pénalité comprise) reprend le dessus sur les genres : **l'animation remonte** (38 % à 5 000 dès μ = 2 sur l'export de Thibault, 38-50 % sur l'exemple à μ = 5-10).
2. **Aucun μ ne remplit les deux critères de Q4b à tous les crans** de l'export de Thibault. Le seul μ qui garde l'animation ≤ 31 % partout et baisse nettement les voisins est **μ = 1** : 5 · 4 · **8** · 6 · 6 (total 29 au lieu de 42 aux crans bas) ; le cran 1 000 ne bouge pas (8).
3. **La pénalité coûte sur la validation, plus que prévu** : −16 % de NDCG@20 à 2 000 et −14 % à 500 pour μ = 1 (−4,7 % et −7 % pour μ = 0,5). Les films proches d'un film mal noté sont souvent de bons films pour l'utilisateur (dans MovieLens, on note mal surtout des films d'un genre qu'on regarde beaucoup). Sur la validation, D2 + D1 est déjà **sous le hasard** (6,7 et 7,4 /16 à 2 000 et 500, contre ≈ 8 au hasard) : l'écart vu sur l'export de Thibault (10 · 9 · 8 · 8 · 7) est en partie propre à cet export.
4. À ∞ (option « tous les crans »), la règle −3 % autoriserait μ = 0,5 (−2,4 %, voisins 3,7 → 2,1) ; mais sur l'export de Thibault, l'animation y remonte à 38-56 % (lecture 1).

**Pistes pour le choix (arrêt)** :
- **a. Option a, D1 seul** (recommandé) : la pénalité coûte 5 à 16 % de NDCG@20 aux crans bas pour une baisse partielle d'une mesure qui n'est pas une mesure de qualité ; à juger avec les volontaires (étape 7), μ restant prêt dans le code de référence.
- **b. μ = 1 aux crans 5 000 à 200** : voisins 10 · 9 · 8 · 8 · 7 → 5 · 4 · 8 · 6 · 6, animation ≤ 31 %, au prix de −14 à −16 % de NDCG@20 à 2 000 et 500 (sur une base de 0,019 et 0,0056). Il resterait à brancher (`model-meta.json`, `engine.ts`, fixture, parité, `reco-bench`, Playwright).
- **c. μ = 0,5 aux crans 5 000 à 200** : compromis plus léger (−5 à −7 %), effet faible sur l'export de Thibault (7 · 5 · 8 · 9 · 7).

---

## 6. À reporter

- **Genres TMDB** (plus fins que MovieLens, et utiles pour la mention « spectacle ») : enrichissement par `enrich_tmdb.py` puis `catalog.json` ; si Q1 les retient, la calibration les utilisera.
- **Pondération douce des films mal notés** (au lieu d'un retrait : `r = 1 + β × p` avec un β plus grand, ou un poids nul sous le seuil et réduit au-dessus) : non mesurée ; à essayer si D2 déçoit les volontaires.
- **Calibration sur d'autres axes** (décennies, pays, langues) : `etat-de-l-art.md` ; plus tard.
- **Seuils** (percentile 0,3, λ, vivier de 150) : à recaler avec les volontaires (étape 7). **λ des crans bas (0,9)** en particulier : la question des volontaires (« combien de ces films ne connaissais-tu pas et as-tu envie de voir ? ») est la vraie mesure à ces crans.

---

## 7. Questions pour la validation — réponses de Thibault (8 novembre 2026)

1. **Q1 — Genres** : **MovieLens**. Les films sans genre ne comptent ni dans la distribution du profil ni dans celle des recos. → D1.
2. **Q2 — `version_of` dans les deux sens** : oui. → D3.
3. **Q3 — Seuil 0,3** : oui ; les films vus sans note (0,5) ne sont jamais retirés ; vérifier les égalités au bord du seuil ; repli sous 5 films : oui ; une phrase dans « comment ça marche » (Claude Web, fin d'étape). → D2.
4. **Q4 — Steck** : oui ; reclassement **une seule fois** après l'analyse, sur un vivier plus large par cran (**150** candidats → 48 gardés) ; le changement de cran reste un affichage (≤ 50 ms en médiane). Arrêt de Q3 avec la courbe λ → NDCG@20 et Recall@20 (validation, ∞, 2 000, 500), l'écart de calibration et la part d'animation sur les deux exports ; Thibault proposera **le λ le plus fort qui coûte au plus 3 % de NDCG@20 à ∞**. → D1, Q3.
5. **Q5 — Test une seule fois, à la clôture** : oui.
6. **Q6 — Ordre Q1 → Q5** : oui. D2 change le fold-in : `foldin_cases.json` régénéré hors du dépôt, parité Python / TypeScript revérifiée à 10⁻¹⁵ ; D2 modifie la D2 de l'étape 2, à noter dans `decisions.md` (ancienne règle ✗ avec la raison).

---

## 8. Ensuite : tags des cartes (après Q5, nouvelle sous-étape Q6)

À coder **seulement après les corrections de qualité** (Q1-Q5), dans une sous-étape Q6 qui commence par une mesure et un **arrêt** pour fixer les seuils.

- **Trois tags** (textes définitifs de Claude Web) :
  - **réalisateur** : « (encore un <réalisateur> que t'as pas vu) » quand le réalisateur du film fait partie de ceux que Thibault aime (**même calcul que la phrase de profil** « t'aimes bien X, Y et Z », `profileDirectors`) ; couleur **verte** ;
  - **« ça divise »** : notes MovieLens très dispersées ; **écart-type des notes calculé dans le pipeline** (nouvelle colonne de `catalog.json`, quelques dizaines de Ko gzip, à mesurer) ; seuil fixé d'après la distribution (par exemple les **10 % les plus dispersés** parmi les films ≥ 20 notes) ; couleur **rose foncé** ;
  - **« vieux trésor »** : film ancien (avant 1970 ?) et peu vu (seuil de popularité à fixer) ; couleur **jaune**.
- **Règles** : **un seul tag par carte** ; hiérarchie **« ✱ pépite » > réalisateur > « ça divise » > « vieux trésor »** (une carte qui a le tampon pépite n'a pas d'autre tag) ; **peu de tags par rangée** (plafond par rangée de 8 à fixer avec la mesure, par exemple 2 ou 3).
- **Avant de fixer les seuils** : fréquence attendue de chaque tag **par cran**, sur l'export de Thibault et sur l'exemple (comptes seulement), pour plusieurs seuils candidats ; **arrêt** pour le choix.
- **Couleurs** : le design system n'a qu'un accent (le stylo bleu). Trois couleurs nouvelles (vert, rose foncé, jaune) demandent une palette dans les **deux thèmes** au **contraste AA** (le jaune sur fond clair est le cas difficile : texte foncé sur pastille jaune, ou jaune foncé), et **jamais d'orange** ; proposition de palette au moment de Q6, ajoutée à `docs/design-system.md`.
- Tests : priorité et plafond par rangée (fonctions pures, comme `pepiteStamps`), contraste des nouvelles couleurs, axe dans les deux thèmes, temps de changement de cran inchangé.
