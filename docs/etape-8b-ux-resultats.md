# Étape 8b — UX de la page des résultats

> Version 0.1 (17 novembre 2026) : **spec à valider par Thibault**, rien n'est codé. Décisions de départ données par Thibault le 17 novembre 2026 (D1-D7), reprises telles quelles ; D8 et D9 sont proposées par Claude Code (à valider) ; les points qui sortent des décisions ou qui demandent un choix sont dans la section 7.
> Étape insérée après l'étape 8 (films récents) et **avant les volontaires de l'étape 7**. L'étape 8 reste à l'arrêt visuel de R6e (test une seule fois et vrai téléphone à faire à sa clôture) : l'étape 8b ne touche ni au modèle ni à l'évaluation hors ligne, sauf si D7 change la portée du bonus des classiques (section 7, Q1).
> Les **textes de l'interface** nouveaux viennent de Claude Web : le code prévoit des emplacements (D9).

---

## 0. Mode d'emploi (pour Claude Code)

- Relis ce document au début de chaque sous-étape. Les décisions de la section 3 ne changent pas sans accord.
- Une sous-étape à la fois (U0 → U7), en suivant « Quand s'arrêter » de `CLAUDE.md`. **Arrêts obligatoires** :
  - fin de **U0** (mesures : bonus des classiques, durée, acteurs, temps d'un recalcul filtré) ;
  - en **U0**, **avant tout appel TMDB** (noms des acteurs, voir 2.3) ;
  - en **U2**, si un recalcul filtré dépasse 100 ms en médiane (repli de D2) ;
  - en **U4**, si les acteurs dépassent le budget de taille (D4) ;
  - fin de **U6** (essai à l'écran, textes de Claude Web) ;
  - **U7** (relecture).
- **Un seul moteur** (inchangé) : les filtres passent par `web/src/reco/engine.ts`, utilisé par le worker et par les scripts du terminal. Les listes **sans filtre** doivent rester identiques à aujourd'hui (rejeu de `foldin_cases.json` : listes identiques, vecteurs à 10⁻⁹ près). Les filtres n'ont **pas de référence Python** (D2) : tests Vitest.
- **Données personnelles** (inchangé) : les exports réels restent dans `web/test-data/exports/` ; dans les fichiers versionnés, comptes, temps et parts seulement, ni titre ni pseudo ; pour la recherche « des films de… », aucun nom tiré d'un export réel dans un test ou un document (noms de l'exemple synthétique seulement).
- **Réseau** (inchangé) : aucune requête nouvelle depuis le site ; le CSV est fabriqué dans le navigateur.

---

## 1. Objectifs

1. Remplacer le curseur à 8 crans par **trois catégories** lisibles (« les valeurs sûres », « les moins connus », « les pépites »), sans changer le moteur.
2. Laisser l'utilisateur **affiner** : genres, époque, durée, langue, documentaires, avec un vrai recalcul (calibration comprise) pour garder 48 films par catégorie.
3. Chercher **« des films de… »** un réalisateur ou un acteur, parmi les films pas encore vus.
4. **Télécharger la liste** au format d'import de listes de Letterboxd, sans rien envoyer.
5. Vérifier le **bonus des classiques** aux crans qui deviennent les catégories (2 000 et 500), reporté de l'étape 8.

---

## 2. Données d'entrée

### 2.1 Interface actuelle (fin de l'étape 8, R6e)

- `web/src/pages/Resultats.tsx` : titre (« on a lu tes N films. » + `titlePhrase(cap, nShown)`), profil, curseur `Slider` (`<input type="range">`, 8 crans), case « sans les documentaires » (filtre **dans la page**, sans recalcul, `isDocumentary`), note « loin de tes goûts » (règle de l'étape 5 sous le curseur, ou par rangée au-dessus de la grille, é6b R10), grille, « encore des films » 8 par 8, mention des films récents.
- `web/src/pages/resultsView.ts` : `ResultsView = { index, visible, noDocs }`, départ au cran 2 000 (`START_CAP`), gardé par `App` quand une page par ancre s'ouvre (é6b D2).
- `web/src/reco/workerCore.ts` : un seul message `recommend` (`n: 48`, 8 crans) ; le worker garde `engine`, `imported`, `matched`, mais **pas** le vecteur du fold-in ni les scores : chaque `recommend` refait le fold-in.
- `web/src/reco/engine.ts` `recommend` : fold-in (D2 de é6c) → scores → exclusions → `topByPosition` (vivier) → `qualityPools` (γ·q + bonus des classiques) → `calibratePositions` (λ par cran, cible = profil de genres des films du fold-in) → `capEstimated` (1 film estimé par rangée de 8, calibration de 96 films) ; le score relatif (« loin de tes goûts ») est calculé sur la base des 20 premiers films **à ∞**.
- `web/src/components/cardRules.ts` : `pepiteStamps`, `cardTags`, `hasFarRow`, `citationPicks` travaillent par **rangée de 8 de la liste affichée** ; ils ne dépendent pas de la façon dont la liste a été obtenue.
- `web/src/dev/devTuning.ts` : interrupteurs lus dans l'URL, uniquement derrière `import.meta.env.DEV` (absents du build).

### 2.2 Catalogue (`catalog.json` v3, 17 novembre 2026)

- 26 377 films (23 019 entraînés + 3 358 estimés) ; colonnes `title`, `original_title`, `year`, `tmdb_id`, **`imdb_id`** (déjà là : rien à ajouter pour le CSV de D6), `imdb_id_aliases`, `directors` (noms), `poster_path`, `genres` (indices) + `genre_names` (19 genres MovieLens), `ml_mean`, `ml_count`, `version_of`, `divisive`, `n_trained`, `tmdb_mean`, `tmdb_count`, `quality`.
- Genres MovieLens : Action, Adventure, Animation, Children, Comedy, Crime, Documentary, Drama, Fantasy, Film-Noir, Horror, **IMAX**, Musical, Mystery, Romance, Sci-Fi, Thriller, War, Western. « IMAX » n'est pas un genre (format de projection) : proposé hors du filtre (Q3).
- `web/public/data/` : 3,63 Mo gzip au total (chiffre de Thibault ; recompté en U0).

### 2.3 Cache TMDB (`pipeline/data/cache/tmdb/full/`, étape 8)

Vérifié en lisant le cache (aucun appel) le 17 novembre 2026 :

- les fiches de l'étape 8 (`recent_films.py`, `slim_full`) gardent **`runtime`** et **`original_language`** : D5 ne demande aucun appel TMDB pour la durée et la langue (couverture exacte en U0) ;
- **`cast` ne garde que les identifiants TMDB des 10 premiers acteurs, sans leurs noms** (`slim_full` : `"cast": [p.get("id") for p in cast]`). Les **noms** des acteurs de D4 ne sont donc **pas** dans le cache : il faut un appel TMDB, ce qui demande un arrêt (CLAUDE.md : « arrête-toi avant tout appel TMDB » pour la durée ; même règle appliquée aux acteurs). Options en section 7, Q2.
- Première mesure (lecture du cache, 17 novembre 2026 ; détail par statut en U0) :
  - fiches en cache : **26 330 / 26 377** films de `catalog.json` ; `runtime` > 0 : **26 305** (99,7 %) ;
  - acteurs présents dans **≥ 3 films** parmi leurs 5 premiers rôles : **10 018** acteurs, **82 506** paires film-acteur ;
  - `catalog.json` v3 : 3 285 649 octets, **1 407 265 octets gzip** (niveau 9).
  Ordre de grandeur (à mesurer en U0, pas un résultat) : 10 018 noms (~150 Ko bruts) et 82 506 indices (~400 Ko bruts) donnent **de l'ordre de 200 à 300 Ko gzip** : le budget de +250 Ko est **juste**. Si U0 le dépasse, variantes à proposer à l'arrêt : 3 premiers rôles, seuil à 4 ou 5 films, ou acteurs des films recommandables seulement.

---

## 3. Décisions

### D1. Trois catégories au lieu du curseur à 8 crans

- Le **plafond de popularité cumulatif reste** (pas de tranches) : une catégorie = un cran du moteur.
- Un groupe de **3 boutons radio** :
  - `<fieldset>`, `<legend>` « plutôt connu ou plutôt pépite ? » ;
  - de vrais `<input type="radio">` (même `name`), stylés en boutons (le radio est visuellement masqué mais focalisable, le `<label>` fait le bouton) ; **flèches du clavier natives** (pas de gestion maison) ; anneau de focus visible ;
  - zones ≥ 44 px ; le groupe tient sur **360 px** de large (trois boutons sur une ligne si la place le permet, sinon empilés ; jamais de défilement horizontal) ;
  - choix courant : contour encre épais + soulignement manuscrit stylo bleu (style C, `docs/design-system.md` § 5), contraste AA dans les deux thèmes.

  | catégorie | sous-libellé | cran |
  |---|---|---|
  | « les valeurs sûres » | « tout » | ∞ |
  | « les moins connus » | « moins de 2 000 notes » | 2 000 |
  | « les pépites » | « moins de 500 notes » | 500 |

- **Départ sur « les moins connus »** (cran 2 000, inchangé par rapport à l'étape 5).
- Le **moteur calcule toujours les 8 crans** (`recommend({ n: 48 })`, inchangé) ; l'interface n'en montre que trois. Table des catégories dans `web/src/pages/categories.ts` (nom, sous-libellé, cran, morceau du nom de fichier de D6), jamais de cran en dur ailleurs ; si un cran de la table est absent de `model-meta.json`, la catégorie est masquée (test).
- **Interrupteur dev `?crans=8`** : remet le curseur à 8 crans (`Slider.tsx` gardé), `npm run dev` seulement, lu dans `devTuning.ts` (absent du build, vérifié dans `dist/` comme les autres).
- **Inchangés** (ils dépendent du cran affiché et des rangées de 8) : `titlePhrase` (∞ → « voilà des classiques qui devraient te plaire. », 2 000 → « voilà un mélange de classiques et de découvertes. », 500 → « voilà huit films que t'as sûrement jamais vus. »), les tags, le tampon « ✱ pépite », « loin de tes goûts » (les deux règles).
- Le texte `aria-live` dit le **nom de la catégorie** : « les moins connus : 8 films » (avec filtres : « les moins connus, 2 filtres : 8 films »).
- **Modifie** é5 D5 (curseur natif à 8 crans) pour l'interface de production ; noté dans `contexte/decisions.md` (ancienne règle marquée ✗ avec la raison : 8 crans peu lisibles, les crans voisins se ressemblent).

### D2. Les filtres relancent un calcul dans le worker (modifie é5 D5)

- **Changer de catégorie** reste un **affichage sans calcul** (≤ 50 ms en médiane, critère de é6b R6).
- **Activer ou retirer un filtre** (D3) relance `recommend` dans le worker, **sans refaire le fold-in** : le worker garde le vecteur `x` et les scores du dernier fold-in (`WorkerState`), et ne refait que les exclusions des films qui ne passent pas le filtre, les viviers sous les plafonds (γ·q et bonus des classiques compris), la calibration, le plafond des films estimés et les explications, **sur les films qui passent le filtre**. Toujours **48 films par cran**, 8 crans.
- Nouveau message du worker `refine` (`{ filters }`) ; le fold-in et les scores sont invalidés par `import` et `confirm`. Seule la **dernière** demande compte : une réponse plus ancienne qu'une demande en cours est ignorée (identifiant de requête).
- Un filtre = un **prédicat sur `item_idx`** (fonction pure `passesFilters`, `web/src/reco/filters.ts`) ; les films qui ne passent pas sont ajoutés aux exclusions **avant** le vivier (ils ne prennent jamais une place du vivier de 150).
- Pendant le calcul : la **grille précédente reste visible**, avec `aria-busy="true"` sur la zone des résultats ; pas de spinner plein écran ; les puces restent utilisables.
- **Score relatif** (« loin de tes goûts ») : la base reste la moyenne des 20 premiers films **à ∞ sans filtre** (le goût de l'utilisateur ne change pas parce qu'il filtre). Conséquence assumée : une liste très filtrée peut s'afficher « loin de tes goûts » ; c'est honnête.
- **Critère** : **médiane ≤ 100 ms par recalcul** (`reco-bench`, nouveau cas « recalcul filtré », sur l'export A et sur l'export de 3 000 films, filtres types : un genre, une époque, genre + langue), à vérifier sur un vrai téléphone. **Si le critère échoue : arrêt**, et proposition du repli : garder **150 films calibrés par cran** (vivier élargi en conséquence) et filtrer **dans la page**, sans recalcul.
- **Calibration quand un genre est filtré** : la cible `p` devient la part des genres parmi les films **du fold-in** qui ont au moins un des genres choisis (même pondération par le signal qu'aujourd'hui) ; **λ = 0** si le fold-in en contient **moins de 10**. Le filtre **prime toujours** : la calibration ne choisit que parmi les films qui passent le filtre. Les filtres époque, durée, langue et documentaires **ne changent pas la cible** (proposition, Q4).
- **Pas de parité Python exigée** pour les filtres (aucune évaluation hors ligne) : tests Vitest (prédicats, cible de calibration filtrée, seuil de 10, liste sans filtre identique à `recommend`, 48 films par cran quand il y en a assez).

### D3. Panneau « affiner »

- Bouton **« affiner »** sous les catégories, avec le nombre de filtres actifs : « affiner (2) ». Il déplie un panneau **sous les catégories** (disclosure : `<button aria-expanded aria-controls>`, pas de fenêtre modale, pas de piège du focus).
- Chaque section est un **groupe de puces à bascule** (`<button aria-pressed>`, groupe nommé par son titre) ; dans une section, les choix s'additionnent (**OU**) ; d'une section à l'autre, ils se cumulent (**ET**) :
  - **« genres »** : genres MovieLens du catalogue, libellés français en minuscules (table dans `web/src/content/`), **sauf « documentaire »** (voir « on montre aussi ») et sauf « IMAX » (Q3). Libellés proposés : action, aventure, animation, jeunesse, comédie, policier, drame, fantastique, film noir, horreur, comédie musicale, mystère, romance, science-fiction, thriller, guerre, western ;
  - **« époque »** : « avant 1960 », « années 60 », « années 70 », « années 80 », « années 90 », « années 2000 », « années 2010 », « années 2020 » (année de `catalog.json` ; années 2020 = 2020 et après ; un film sans année ne passe aucun filtre d'époque) ;
  - **« durée »** : « moins d'1h40 » (< 100 min), « 1h40 à 2h15 » (100 à 135 min), « plus de 2h15 » (> 135 min) ; un film sans durée connue ne passe aucun filtre de durée ;
  - **« langue »** : langue d'origine TMDB, noms par `Intl.DisplayNames('fr', { type: 'language' })` en minuscules ; seulement les langues qui ont **au moins 30 films recommandables** (compté dans le site, à partir du catalogue), triées par nombre de films ; les **8 premières** visibles, puis « autres langues » (disclosure) qui déplie la suite. Codes TMDB hors norme : `xx` (sans langue) jamais proposé ; `cn` (cantonais chez TMDB) et tout code que `Intl.DisplayNames` ne connaît pas passent par une petite table de secours (ou sont omis), testée ;
  - **« on montre aussi »** : case à cocher **« les documentaires »**, **cochée par défaut**. Elle remplace la case « sans les documentaires » de é5 D6 (même effet quand elle est décochée) et passe, elle aussi, par le recalcul (la liste sans documentaires garde 48 films).
- **Filtres actifs** : sous les catégories, en puces « × horreur », « × années 70 » (chaque puce est un `<button>` qui retire le filtre, nom accessible « retirer le filtre horreur »), plus **« tout effacer »**. Visibles panneau fermé.
- Les filtres sont **gardés dans `ResultsView`** quand une page par ancre s'ouvre (é6b D2), comme la catégorie ; rien n'est stocké.
- **Plus aucun film** dans la catégorie : « rien ne passe tous ces filtres ici. enlève-en un, ou essaie « les valeurs sûres ». » (remplace « plus rien à ce cran-là… » quand des filtres sont actifs).
- Changer un filtre remet la grille à **8 cartes** (`visible = 8`).

### D4. Recherche « des films de… »

- Un champ `<input>` avec `<label>` « des films de… », placeholder « un réalisateur, une actrice… », et des **suggestions accessibles** (motif combobox ARIA 1.2 : `role="combobox"`, `aria-expanded`, `aria-controls` vers un `role="listbox"`, `aria-activedescendant`, flèches haut et bas, Entrée choisit, Échap ferme), sur les **noms du catalogue** (réalisateurs et acteurs).
  - Correspondance : sans accents ni casse, début de mot (« kuro » → Akira Kurosawa), 8 suggestions au plus, triées par nombre de films du catalogue ; chaque suggestion dit le rôle (« réalisateur », « acteur ») et le nombre de films ; aucun appel réseau, aucun flou automatique.
  - Homonymes : les noms sont regroupés par nom affiché (pas d'identifiant de personne embarqué pour les réalisateurs aujourd'hui) ; risque accepté, compté en U0.
- Le choix d'un nom affiche, **à la place de la grille**, ses films que l'utilisateur **n'a pas vus**, **triés par score** (score du modèle, exclusions habituelles : vus, non recommandables, ambigus, flou, versions), **sans plafond de catégorie**, au plus **48**, 8 par 8 comme ailleurs, avec le titre « les films de <nom> que t'as pas vus » et un bouton **« revenir à tes recos »** (la catégorie et les filtres d'avant sont retrouvés). Calcul dans le worker (les scores y sont), message `person`.
- Les **filtres d'affiner s'appliquent aussi**. Pas de calibration (la liste est celle d'une personne) ; tampon, tags et « parce que t'as aimé » s'appliquent comme sur la grille ; « loin de tes goûts » n'est pas affiché (proposition, Q5).
- Aucun film non vu : « t'as déjà vu tous ses films qu'on connaît. » (texte à confirmer par Claude Web).
- **Réalisateurs** : déjà dans `catalog.json`.
- **Acteurs** : les **5 premiers acteurs** des fiches TMDB de l'étape 8, seulement ceux présents dans **au moins 3 films du catalogue** (films estimés compris). **Mesure d'abord le coût** : les acteurs sont gardés si `catalog.json` prend **au plus +250 Ko gzip** et que `web/public/data/` reste **≤ 4,0 Mo gzip** au total. Sinon : **arrêt** avec les chiffres. ⚠️ Les noms ne sont pas dans le cache (2.3) : arrêt avant l'appel TMDB (Q2).

### D5. Données ajoutées à `catalog.json` (v4)

- `site_catalog.py` écrit, à partir du cache TMDB (fiches de l'étape 8), **sans aucun appel réseau** :
  - **langue d'origine** : table `languages` (codes ISO 639-1 tels que TMDB les donne) + `language` (un indice par film, `null` si inconnue) ;
  - **durée** : `runtime` (minutes, entier, `null` si inconnue ou 0) ; **mesurer d'abord la couverture** (2.3) ; si `runtime` manquait dans le cache, arrêt avant tout appel TMDB (il y est) ;
  - **acteurs** (D4) : table `people` (noms) + `cast` (par film, indices des acteurs gardés, ordre des rôles) ; les réalisateurs restent en noms (`directors`), inchangés.
- `catalog-verify` vérifie les nouvelles colonnes (longueurs, indices valides, aucune colonne `imdbds_`) ; tests `pytest` ; type `CatalogFile` et lecture côté web (v3 refusée avec un message clair, ou lue sans les filtres : proposé « refusée », comme les autres changements de version).
- Tout ce qui est ajouté vient de **TMDB** (licence : aucune donnée des datasets IMDb).
- **Aucun appel réseau nouveau depuis le site.**
- Régénérer `web/public/data/` avec les commandes habituelles : `export.py catalog --out web`, `export.py verify --out web`, puis `npm test`. Le modèle, `embeddings.bin`, `popularity.bin` et `foldin_cases.json` ne changent pas.

### D6. Télécharger la liste (CSV)

- Bouton **« télécharger la liste (csv) »** sous la grille, et phrase d'aide sous le bouton : « compatible avec l'import de listes de Letterboxd. » (le nom n'apparaît que dans cette aide, jamais dans le nom du site ni du fichier).
- Contenu : les **48 films** de la catégorie et des filtres en cours (ou de la recherche D4), **dans l'ordre affiché** (même s'il n'y a que 8 cartes à l'écran) ; moins de 48 s'il y en a moins.
- Généré dans le navigateur (`Blob` + `URL.createObjectURL` + lien `download`, URL libérée ensuite) ; **rien n'est envoyé** (vérifié par Playwright : aucune requête au clic).
- Format d'import de Letterboxd : **UTF-8 sans BOM**, séparateur **virgule sans espace**, guillemets **RFC 4180** (champ entre guillemets s'il contient une virgule, un guillemet ou un retour à la ligne ; guillemet doublé), fin de ligne `\r\n` (RFC 4180, proposé), colonnes **`tmdbID,imdbID,Title,Year`** ; `imdbID` vide si inconnu ; `Year` vide si inconnue. Fonction pure `listCsv` (`web/src/pages/download.ts`).
- Nom du fichier : `pepite-valeurs-sures-AAAA-MM-JJ.csv`, `pepite-moins-connus-…`, `pepite-pepites-…`, `pepite-films-de-<nom-sans-accents>-…` (minuscules, accents retirés, tout autre caractère → `-`, tirets en double fusionnés) ; date **locale** du jour. Les filtres n'entrent pas dans le nom.
- **Test Vitest** sur le contenu **exact** d'un CSV synthétique (virgules et guillemets dans un titre, `imdbID` vide, année vide), et sur les noms de fichier (accents, apostrophe, espaces).

### D7. Vérification reportée de l'étape 8 : le bonus des classiques aux crans 2 000 et 500

- Le bonus des classiques (γc = 0,5, centile 99, films entraînés) se vérifie maintenant aux crans **2 000 et 500** (et non plus 5 000), puisqu'ils deviennent « les moins connus » et « les pépites ».
- Avec l'**export B** s'il est dans `web/test-data/exports/`, sinon l'export A :
  - **score médian des 8 premiers** (score relatif, comme R6e) à ∞, 2 000 et 500, avec et sans `?classiques=0` (`tuning-report.ts`) ;
  - **recouvrement des 10 premiers à ∞** entre A, B et l'exemple synthétique, avec et sans le bonus (nombre de films communs par paire).
- **Chiffres seulement**, aucun titre dans le dépôt.
- Si le bonus fait **nettement baisser** les scores à 2 000 ou 500 (proposé : médiane des 8 premiers en baisse de plus de 10 %, ou un film de plus sous le seuil « loin de tes goûts » dans la première rangée), **proposer de le réserver aux crans ∞ à 10 000, et s'arrêter**.

### D8. État de l'écran des résultats (proposée)

- `ResultsView` devient `{ index, visible, filters, person, refineOpen }` : `index` = cran affiché (une des trois catégories, ou un des 8 crans avec `?crans=8`), `filters` = `{ genres, decades, durations, languages, docs }` (ensembles de clés, `docs: true` par défaut), `person` = nom choisi ou `null`. Gardé par `App` quand une page s'ouvre ; rien n'est stocké (ni URL, ni stockage du navigateur).
- Ordre du moteur avec filtres : fold-in (gardé) → scores (gardés) → exclusions (+ films qui ne passent pas les filtres) → vivier par cran (γ·q, bonus des classiques) → calibration (cible filtrée si un genre est choisi) → plafond des films estimés → 48 films par cran → explications, séries.

### D9. Textes (Claude Web)

- Les textes nouveaux passent par `web/src/content/` (`pending()` jusqu'à ce que Claude Web les rédige) :
  - « comment ça marche » : la section `#curseur` devient **les catégories** (trois catégories, un plafond chacune, « moins de 2 000 notes ») ; nouvelle section **« affiner »** (filtres, recalcul, calibration qui suit le genre choisi) ; une phrase sur **« des films de… »** et une sur le **téléchargement** (fichier fabriqué chez toi, rien n'est envoyé) ;
  - les textes qui parlent de « cran » ou de « curseur » à l'écran des résultats : « plus rien à ce cran-là : essaie un peu plus à gauche. » (sans filtre ; proposé : « plus rien ici : essaie « les valeurs sûres ». »), `FAR_ROWS_NOTE` « (à ce cran, on s'éloigne un peu de tes goûts : c'est le prix des vraies pépites) » (proposé : « (ici, on s'éloigne… ») ;
  - « on garde rien » : une phrase sur le CSV (fabriqué dans ton navigateur) si Claude Web le juge utile.
- Les textes donnés par Thibault dans cette spec (libellés, sous-libellés, messages) sont posés tels quels.

---

## 4. Sous-étapes

### U0 — Mesures — **arrêt** avec les chiffres

1. **D7** : scores médians des 8 premiers (∞, 2 000, 500) avec et sans le bonus, sur B (ou A) ; recouvrement des 10 premiers à ∞ entre A, B et l'exemple, avec et sans le bonus. Si le bonus fait nettement baisser 2 000 ou 500 : proposition « bonus de ∞ à 10 000 seulement ».
2. **Durée et langue** : couverture de `runtime` et de `original_language` dans le cache (films entraînés, films estimés, recommandables) ; répartition dans les 3 tranches de durée et les 8 époques ; langues avec ≥ 30 films recommandables, et codes que `Intl.DisplayNames('fr')` ne sait pas nommer.
3. **Acteurs** : nombre d'acteurs gardés (5 premiers rôles, ≥ 3 films), nombre de paires film-acteur, homonymes de noms (réalisateurs et acteurs) ; **taille** de `catalog.json` v4 avec et sans acteurs (gzip niveau 9, même sérialisation que `site_catalog.py`) et total de `web/public/data/`. Les noms manquent dans le cache : **arrêt avant l'appel TMDB** (Q2) ; la taille se mesure d'abord avec des noms factices de longueur réaliste si Thibault préfère trancher avant l'appel.
4. **Temps d'un recalcul filtré prototypé** (script de mesure, hors interface) : `reco-bench` avec fold-in gardé, sur l'export A et l'export de 3 000 films ; filtres : un genre, une époque, genre + langue, sans documentaires ; médiane de 21.
- Résultats en section 5 ; commit, push, **arrêt**.

### U1 — Catégories (D1)

- `categories.ts`, composant `CategoryPicker` (fieldset + radios), `aria-live` par nom de catégorie, départ « les moins connus », `?crans=8` (`devTuning.ts`, `Slider` gardé), `ResultsView` (D8).
- Vitest + RTL : radios au clavier (flèches natives : vérifiées par Playwright, RTL ne les simule pas), annonce, départ, titre et tags inchangés par cran, `?crans=8` lu seulement en dev.

### U2 — Recalcul filtré et calibration (D2) — **arrêt** si > 100 ms

- `filters.ts` (`passesFilters`), `recommend` avec filtres et fold-in gardé, message `refine`, réponses périmées ignorées, cible de calibration filtrée, λ = 0 sous 10 films, `aria-busy`.
- Vitest : liste sans filtre identique à aujourd'hui (et `foldin_cases.json` rejoué), prédicats (bords d'époque et de durée, valeurs inconnues), OU dans une section et ET entre sections, cible filtrée et seuil de 10, 48 films par cran quand il y en a assez, aucun film qui ne passe pas le filtre dans aucun cran, score relatif sur la base sans filtre.
- `reco-bench` : cas « recalcul filtré » ; critère ≤ 100 ms en médiane sur A et 3 000 films.

### U3 — Panneau « affiner » (D3) et données de `catalog.json` v4 (D5, durée et langue)

- `site_catalog.py` (v4 : `languages`, `language`, `runtime`), `catalog-verify`, `pytest` ; `export.py catalog --out web`, `export.py verify --out web`.
- `RefinePanel` (disclosure, sections de puces, « autres langues »), puces des filtres actifs, « tout effacer », message « rien ne passe tous ces filtres ici… », case « les documentaires ».
- Vitest + RTL : `aria-expanded`, `aria-pressed`, compteur « affiner (2) », retrait par puce, filtres gardés à l'ouverture d'une page, langues ≥ 30 films et ordre, table de secours des codes.

### U4 — Recherche « des films de… » (D4, D5 acteurs) — **arrêt** si le budget de taille est dépassé

- Acteurs dans `catalog.json` v4 (après la décision de Q2), index des noms côté web, `PersonSearch` (combobox), message `person`, grille de la personne, « revenir à tes recos ».
- Vitest + RTL : combobox au clavier (flèches, Entrée, Échap), sans accents ni casse, début de mot, 8 suggestions, films vus exclus, filtres appliqués, au plus 48, retour aux recos avec catégorie et filtres.
- Taille de `catalog.json` et total de `web/public/data/` en section 5.

### U5 — Téléchargement (D6)

- `download.ts` (`listCsv`, `csvFileName`), bouton et phrase d'aide.
- Vitest : contenu exact d'un CSV synthétique, noms de fichier ; Playwright : fichier téléchargé (événement `download`), contenu relu, aucune requête au clic.

### U6 — Tests, textes, **arrêt visuel**

- Playwright : parcours avec filtre, recherche et téléchargement ; aucune requête hors du site sauf les affiches TMDB ; rien de stocké (sauf `pepite-theme`) ; axe : 0 violation grave dans les deux thèmes (résultats, panneau ouvert, suggestions ouvertes) ; téléphone 360 px (pas de défilement horizontal, catégories et puces ≥ 44 px) ; changement de catégorie ≤ 50 ms en médiane ; recalcul filtré mesuré.
- « comment ça marche » : emplacements marqués (D9), textes de Claude Web intégrés dès qu'ils arrivent.
- `docs/design-system.md` : catégories, puces, panneau « affiner », champ de recherche.
- **Arrêt** : essai à l'écran par Thibault (deux thèmes), textes de Claude Web ; vrai téléphone (D2 : temps du recalcul).

### U7 — Clôture — **arrêt** pour relecture

- Section 5 complète ; `CLAUDE.md` (catégories, filtres, `catalog.json` v4, arborescence, commandes), `docs/stack-technique.md`, `contexte/` (état, décisions — é5 D5 modifiée, catégories, filtres, recherche, CSV —, feuille de route : idée « ton fanzine de recos », page à imprimer) **dans le même commit**.

### Critères de réussite

| Critère | Seuil |
|---|---|
| Qualité | `npm test`, `typecheck`, `lint`, `format:check`, `build`, `e2e` verts ; `pytest`, `ruff check`, `ruff format --check` (pipeline touché en U3-U4) |
| Moteur | sans filtre, listes identiques à aujourd'hui ; `foldin_cases.json` rejoué (listes identiques, vecteurs à 10⁻⁹ près) ; `export.py verify --out web` vert |
| Filtres | aucun film affiché qui ne passe pas les filtres ; 48 films par cran quand le catalogue filtré en a assez ; λ = 0 sous 10 films du fold-in du genre choisi |
| Temps | changement de catégorie ≤ 50 ms (médiane, Playwright) ; **recalcul filtré ≤ 100 ms** (médiane, `reco-bench`, export A et 3 000 films ; vrai téléphone) ; modèle prêt et analyse : pas plus de 10 % au-dessus de R6e |
| Taille | acteurs : `catalog.json` ≤ +250 Ko gzip ; `web/public/data/` ≤ 4,0 Mo gzip au total |
| Accessibilité | axe : 0 violation grave dans chaque thème (résultats, panneau, suggestions) ; radios aux flèches natives, puces `aria-pressed`, disclosure `aria-expanded`, combobox ARIA 1.2 ; zones ≥ 44 px ; contraste AA |
| Téléphone | 360 px : catégories sur une ligne ou empilées, panneau lisible, pas de défilement horizontal (Playwright) ; vrai téléphone |
| Réseau | 0 requête nouvelle (recalcul, recherche, téléchargement compris) ; seules les affiches TMDB hors du site |
| Stockage | inchangé : rien sauf `pepite-theme` = `light` |
| CSV | contenu exact (test) ; import d'une liste téléchargée accepté par Letterboxd (essai à la main par Thibault, nombre de films reconnus seulement) |
| Licences | rien des datasets IMDb dans `catalog.json` (aucune colonne `imdbds_`) ; « Letterboxd » seulement dans la phrase d'aide |
| Confidentialité | aucun titre ni pseudo d'un export réel, aucun nom de personne tiré d'un export réel dans un fichier versionné |
| Textes | aucun `pending` restant à la clôture |

---

## 5. Résultats

*(à remplir, sous-étape par sous-étape)*

---

## 6. À reporter

- **Rafraîchissement mensuel** (GitHub Actions, étape 7) : il doit aussi rafraîchir la durée, la langue et les acteurs (et garder les noms des acteurs dans le cache, si Q2 retient un changement de `slim_full`).
- **Filtre par pays** (idée de la feuille de route) : `origin_country` est dans le cache ; pas au MVP de 8b.
- **Filtres dans l'URL** (lien partageable « mes pépites d'horreur des années 70 ») : rien n'est stocké aujourd'hui, l'URL ne contient pas l'historique ; à rediscuter.
- **Calibration selon l'époque ou la langue choisie** (Q4) : si l'essai montre des listes déséquilibrées.
- **Recherche par titre** (« et celui-là, il me plairait ? », idée de l'étape 8) : la combobox de D4 pourrait l'accueillir plus tard.
- **Seuils** : 30 films par langue, 3 films par acteur, 5 premiers rôles, tranches de durée : à revoir avec les volontaires.
- **Page à imprimer « ton fanzine de recos »** (idée, feuille de route, à la clôture).

---

## 7. Questions pour la validation

1. **Q1 — D7 et le test de l'étape 8** : si U0 propose de réserver le bonus des classiques aux crans ∞ à 10 000, la décision change `model-meta.json` et donc ce que mesure le test unique de clôture de l'étape 8 (pas encore fait). Proposition : trancher Q1 en U0, puis faire le test de l'étape 8 avec le réglage retenu.
2. **Q2 — Noms des acteurs** (le cache n'a que les identifiants, 2.3). Options :
   - **(a)** un appel `/person/{id}` par acteur gardé (seulement ceux de ≥ 3 films : **~10 000 appels**, 2.3), mis en cache dans `data/cache/tmdb/person/` ; le moins d'appels ;
   - **(b)** garder `{id, name}` des acteurs dans `slim_full` et relancer `recent_films.py collect` en forçant les fiches (~26 000 appels, ~20 min, comme l'étape 8) ; plus simple pour le rafraîchissement mensuel ;
   - **(c)** pas d'acteurs au MVP de 8b (réalisateurs seulement).
   Recommandation : **(b)**, parce que le rafraîchissement mensuel (étape 7) devra de toute façon garder les noms, et qu'une seule source évite les décalages ; (a) si Thibault veut le moins d'appels possible maintenant.
3. **Q3 — « IMAX »** n'est pas un genre (format de projection) : le retirer du filtre des genres (proposé) ?
4. **Q4 — Cible de la calibration** pour les filtres époque, durée, langue : inchangée (proposé), ou filtrée comme pour un genre (part des genres parmi les films de l'historique de cette époque ou de cette langue, λ = 0 sous 10) ?
5. **Q5 — Recherche « des films de… »** : pas de « loin de tes goûts » sur la grille d'une personne (proposé : c'est un choix explicite de l'utilisateur, la note serait du bruit) ; tri par score du modèle brut (proposé) ou par `score'` (avec γ·q et le bonus des classiques, comme la grille) ?
6. **Q6 — Version de `catalog.json`** : refuser une v3 côté web (proposé, comme les changements précédents) plutôt que la lire sans filtres de durée et de langue.
7. **Q7 — Seuil « nettement » de D7** : baisse de plus de 10 % de la médiane des 8 premiers, ou un film de plus sous 0,04 dans la première rangée (proposé) ?
