# Étape 8b — UX de la page des résultats

> Version 0.3 (17 novembre 2026, décisions de Thibault et de Claude Web à l'arrêt de U0) : bonus des classiques **gardé à tous les crans** (D7) ; étape 8 close (commit `e7d4384`, test évalué une fois avec ce réglage) ; acteurs **5 rôles, ≥ 3 films**, `directors` **plus écrit** dans `catalog.json` v4 (reconstruit par le site), seule règle de taille : `web/public/data/` ≤ 4,0 Mo gzip (D4, D5) ; feu vert pour les appels `/person/{id}` ; explications **seulement pour les crans affichés**, avec un cache dans le worker (D2).
> Version 0.2 (17 novembre 2026) : **validée par Thibault**, avec ses réponses à la section 7 (tranché) : D7 tranchée en U0 puis test unique de clôture de l'étape 8 avant U1 (Q1) ; noms des acteurs par `/person/{id}`, sans relancer la collecte (Q2) ; table `people` par identifiant TMDB, `director_ids` (D4, D5) ; IMAX hors du filtre (Q3) ; seul un genre change la cible de la calibration (Q4) ; grille d'une personne triée par `score'`, sans « loin de tes goûts » ni plafond des films estimés (Q5) ; v3 refusée (Q6) ; seuil de D7 (Q7) ; D8 et D9 validées, quatre textes de Claude Web posés (D9).
> Version 0.1 (17 novembre 2026) : spec à valider. Décisions de départ données par Thibault le 17 novembre 2026 (D1-D7) ; D8 et D9 proposées par Claude Code.
> Étape insérée après l'étape 8 (films récents) et **avant les volontaires de l'étape 7**. L'étape 8 reste à l'arrêt visuel de R6e. **Ordre (Q1)** : U0 → décision de Thibault sur le bonus des classiques → **test unique de clôture de l'étape 8** avec le réglage retenu (clôture complète de l'étape 8 : section 5, documents, `contexte/`) → U1. Rien de l'étape 8b ne change les entrées de ce test : en U0, **aucune régénération** de `catalog.json`, `embeddings.bin`, `popularity.bin` ni `model-meta.json` (sauf le bonus, si Thibault le décide).
> Les **textes de l'interface** nouveaux viennent de Claude Web : le code prévoit des emplacements (D9).

---

## 0. Mode d'emploi (pour Claude Code)

- Relis ce document au début de chaque sous-étape. Les décisions de la section 3 ne changent pas sans accord.
- Une sous-étape à la fois (U0 → U7), en suivant « Quand s'arrêter » de `CLAUDE.md`. **Arrêts obligatoires** :
  - fin de **U0** (mesures : bonus des classiques, durée, acteurs, temps d'un recalcul filtré), puis clôture de l'étape 8 avant U1 (Q1) ;
  - **avant les ~10 000 appels TMDB** des noms d'acteurs (feu vert de Thibault sur les chiffres de taille de U0, Q2) ;
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
- **`cast` ne garde que les identifiants TMDB des 10 premiers acteurs, sans leurs noms** (`slim_full` : `"cast": [p.get("id") for p in cast]`). Les **noms** des acteurs de D4 ne sont donc **pas** dans le cache : il faut un appel TMDB par acteur (Q2, option a). Les **réalisateurs**, eux, y sont en `{id, name}` : on a leur identifiant TMDB.
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
- **Inchangés** (ils dépendent du cran affiché et des rangées de 8) : `titlePhrase` (∞ → « voilà des valeurs sûres qui devraient te plaire. » depuis la v0.2, D9 ; 2 000 → « voilà un mélange de classiques et de découvertes. », 500 → « voilà huit films que t'as sûrement jamais vus. »), les tags, le tampon « ✱ pépite », « loin de tes goûts » (les deux règles).
- Le texte `aria-live` dit le **nom de la catégorie** : « les moins connus : 8 films » (avec filtres : « les moins connus, 2 filtres : 8 films »).
- **Modifie** é5 D5 (curseur natif à 8 crans) pour l'interface de production ; noté dans `contexte/decisions.md` (ancienne règle marquée ✗ avec la raison : 8 crans peu lisibles, les crans voisins se ressemblent).

### D2. Les filtres relancent un calcul dans le worker (modifie é5 D5)

- **Changer de catégorie** reste un **affichage sans calcul** (≤ 50 ms en médiane, critère de é6b R6).
- **Activer ou retirer un filtre** (D3) relance `recommend` dans le worker, **sans refaire le fold-in** : le worker garde le vecteur `x` et les scores du dernier fold-in (`WorkerState`), et ne refait que les exclusions des films qui ne passent pas le filtre, les viviers sous les plafonds (γ·q et bonus des classiques compris), la calibration, le plafond des films estimés et les explications, **sur les films qui passent le filtre**. Toujours **48 films par cran**, 8 crans.
- **Explications (v0.3)** : calculées **seulement pour les films des crans affichés** (les 3 crans des catégories : ∞, 2 000, 500 ; les 8 crans en mode dev avec `?crans=8`), avec un **cache des explications dans le worker** (par film : elles ne dépendent que de l'historique ; cache vidé par `import` et `confirm`). La règle vaut pour la recommandation de départ, le recalcul filtré et la grille « des films de… ». Les listes des autres crans restent calculées (sans explications). **Modifie** é5 D5 et é6b D6 (explications calculées pour tous les crans), à noter dans `contexte/decisions.md` à la clôture. Mesure de U0 : 18-33 ms (export A), 45-76 ms (3 000 films).
- Nouveau message du worker `refine` (`{ filters }`) ; le fold-in et les scores sont invalidés par `import` et `confirm`. Seule la **dernière** demande compte : une réponse plus ancienne qu'une demande en cours est ignorée (identifiant de requête).
- Un filtre = un **prédicat sur `item_idx`** (fonction pure `passesFilters`, `web/src/reco/filters.ts`) ; les films qui ne passent pas sont ajoutés aux exclusions **avant** le vivier (ils ne prennent jamais une place du vivier de 150).
- Pendant le calcul : la **grille précédente reste visible**, avec `aria-busy="true"` sur la zone des résultats ; pas de spinner plein écran ; les puces restent utilisables.
- **Score relatif** (« loin de tes goûts ») : la base reste la moyenne des 20 premiers films **à ∞ sans filtre** (le goût de l'utilisateur ne change pas parce qu'il filtre). Conséquence assumée : une liste très filtrée peut s'afficher « loin de tes goûts » ; c'est honnête.
- **Critère** : **médiane ≤ 100 ms par recalcul** (`reco-bench`, nouveau cas « recalcul filtré », sur l'export A et sur l'export de 3 000 films, filtres types : un genre, une époque, genre + langue) ; temps sur un vrai téléphone mesuré à l'arrêt de U6. **Si le critère échoue : arrêt**, et proposition du repli : garder **150 films calibrés par cran** (vivier élargi en conséquence) et filtrer **dans la page**, sans recalcul.
- **Calibration quand un genre est filtré** : la cible `p` devient la part des genres parmi les films **du fold-in** qui ont au moins un des genres choisis (même pondération par le signal qu'aujourd'hui) ; **λ = 0** si le fold-in en contient **moins de 10**. Le filtre **prime toujours** : la calibration ne choisit que parmi les films qui passent le filtre. Les filtres époque, durée, langue et documentaires **ne changent pas la cible** (profil de tout l'historique, Q4 ; à revoir à l'essai, section 6).
- **Pas de parité Python exigée** pour les filtres (aucune évaluation hors ligne) : tests Vitest (prédicats, cible de calibration filtrée, seuil de 10, liste sans filtre identique à `recommend`, 48 films par cran quand il y en a assez).

### D3. Panneau « affiner »

- Bouton **« affiner »** sous les catégories, avec le nombre de filtres actifs : « affiner (2) ». Il déplie un panneau **sous les catégories** (disclosure : `<button aria-expanded aria-controls>`, pas de fenêtre modale, pas de piège du focus).
- Chaque section est un **groupe de puces à bascule** (`<button aria-pressed>`, groupe nommé par son titre) ; dans une section, les choix s'additionnent (**OU**) ; d'une section à l'autre, ils se cumulent (**ET**) :
  - **« genres »** : genres MovieLens du catalogue, libellés français en minuscules (table dans `web/src/content/`), **sauf « documentaire »** (voir « on montre aussi ») et sauf « IMAX » (format de projection, pas un genre ; il reste dans les données et la calibration, inchangées, Q3). Libellés proposés : action, aventure, animation, jeunesse, comédie, policier, drame, fantastique, film noir, horreur, comédie musicale, mystère, romance, science-fiction, thriller, guerre, western ;
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
  - **Personnes par identifiant TMDB** (pas par nom affiché) : une table `people` commune aux réalisateurs et aux acteurs ; une même personne réalisatrice et actrice = **une seule entrée** (ses films des deux rôles), deux homonymes = **deux entrées**. En cas d'homonymes, la suggestion affiche en plus les **années de ses films** (« 1950-1965 ») pour les distinguer. Nombre de noms affichés qui correspondent à plus d'un identifiant : compté en U0.
- Le choix d'une personne affiche, **à la place de la grille**, ses films que l'utilisateur **n'a pas vus**, **triés par `score'`** (score / s_max + γ·q + bonus des classiques, comme la grille : à goût égal, ses films les mieux reçus passent avant ; exclusions habituelles : vus, non recommandables, ambigus, flou, versions), **sans plafond de catégorie**, au plus **48**, 8 par 8 comme ailleurs, avec le titre « les films de <nom> que t'as pas vus » et un bouton **« revenir à tes recos »** (la catégorie et les filtres d'avant sont retrouvés). Calcul dans le worker (les scores y sont), message `person`.
- Les **filtres d'affiner s'appliquent aussi**. Pas de calibration (la liste est celle d'une personne) ; **pas de « loin de tes goûts »** (choix explicite de l'utilisateur) ; **pas de plafond des films estimés** (le film récent d'un réalisateur qu'on cherche a toute sa place) ; les autres règles des films estimés restent (**pas de « ✱ pépite »**, **pas de « parce que t'as aimé »** sur leur carte) ; tampon, tags et « parce que t'as aimé » s'appliquent sinon comme sur la grille (Q5).
- Aucun film non vu : « t'as déjà vu tous ses films qu'on connaît. » (texte de Claude Web).
- **Réalisateurs** : noms déjà dans `catalog.json` ; leurs identifiants TMDB sont dans le cache (`directors` `{id, name}` des fiches de l'étape 8).
- **Acteurs** : les **5 premiers acteurs** des fiches TMDB de l'étape 8, seulement ceux présents dans **au moins 3 films du catalogue** (films estimés compris). **Règle de taille (v0.3)** : `web/public/data/` **≤ 4,0 Mo gzip au total**, sans plafond séparé pour les acteurs (le +250 Ko de la v0.2 est retiré). Si, avec les vrais noms, le total dépasse 4,0 Mo : passer à **au moins 4 films** (option a de U0) **sans s'arrêter**, et le noter en section 5.
- **Noms des acteurs (Q2, option a)** : un appel **`/person/{id}`** par acteur gardé (~10 000 appels), mis en cache dans `pipeline/data/cache/tmdb/person/`, qui ne garde **que `{id, name}`** (ni biographie, ni date ou lieu de naissance, rien d'autre) ; mêmes règles de cache que les autres (ignoré par git). **Pas de collecte forcée des fiches** : elle réécrirait le cache qui sert à placer les films estimés (votes, mots-clés, distribution ont bougé chez TMDB) et changerait les vecteurs de l'étape 8. La taille se mesure d'abord en U0 avec des **noms factices de longueur réaliste** ; les appels ne partent qu'**après le feu vert de Thibault** (donné le 17 novembre 2026, v0.3). Le téléchargement reprend après une coupure (cache par personne), la clé n'est jamais affichée. Ensuite : nombre d'homonymes chez les acteurs et total réel en section 5.
- `slim_full` garde désormais `{id, name}` pour le cast (comme pour les réalisateurs), **sans relancer la collecte** : pour le rafraîchissement mensuel (étape 7, section 6). Les lecteurs du cache (`recent_films.py table`, `estimate`) acceptent les deux formes (identifiant seul ou `{id, name}`), test `pytest`.

### D5. Données ajoutées à `catalog.json` (v4)

- `site_catalog.py` écrit, à partir du cache TMDB (fiches de l'étape 8), **sans aucun appel réseau** :
  - **langue d'origine** : table `languages` (codes ISO 639-1 tels que TMDB les donne) + `language` (un indice par film, `null` si inconnue) ;
  - **durée** : `runtime` (minutes, entier, `null` si inconnue ou 0) ; **mesurer d'abord la couverture** (2.3) ; si `runtime` manquait dans le cache, arrêt avant tout appel TMDB (il y est) ;
  - **personnes** (D4) : table `people` = `{ id, name }` par **identifiant TMDB** (réalisateurs et acteurs gardés, une entrée par personne) ; `director_ids` (par film, indices dans `people`) et `cast` (par film, indices des acteurs gardés, ordre des rôles) ; `people` ne garde que les **noms** (l'indice sépare deux homonymes, l'identifiant TMDB ne sert pas au site). **v0.3 : `directors` n'est plus écrit** dans `catalog.json` v4 (sinon chaque nom de réalisateur y serait deux fois) : `loadEngine` le reconstruit à la lecture à partir de `people` et `director_ids`, et tout le code qui lit `catalog.directors` (profil, tag « encore un… », cartes) reste inchangé. **Test** : noms reconstruits identiques à ceux de `catalog.json` v3, film par film (sur le catalogue réel en local, sauté s'il manque, et sur une fixture synthétique versionnée).
- `catalog-verify` vérifie les nouvelles colonnes (longueurs, indices valides, `director_ids` cohérent avec `directors`, aucune colonne `imdbds_`) ; tests `pytest` ; type `CatalogFile` et lecture côté web : **v3 refusée** avec le message habituel (Q6).
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
- Si le bonus fait **nettement baisser** les scores à 2 000 ou 500 (Q7 : **médiane des 8 premiers en baisse de plus de 10 %, ou un film de plus sous 0,04 dans la première rangée**, à 2 000 ou à 500), **proposer de le réserver aux crans ∞ à 10 000, et s'arrêter**. Dans tous les cas, **arrêt** en fin de U0 : Thibault décide, puis test unique de l'étape 8 avec le réglage retenu (Q1).
- **Décision (v0.3)** : **bonus gardé à tous les crans** (seuil de Q7 non atteint à 2 000 ni à 500 ; il n'agit qu'à ∞) ; `model-meta.json` ne change pas. L'étape 8 a été close avec ce réglage (commit `e7d4384`, 17 novembre 2026).

### D8. État de l'écran des résultats (validée)

- `ResultsView` devient `{ index, visible, filters, person, refineOpen }` : `index` = cran affiché (une des trois catégories, ou un des 8 crans avec `?crans=8`), `filters` = `{ genres, decades, durations, languages, docs }` (ensembles de clés, `docs: true` par défaut), `person` = nom choisi ou `null`. Gardé par `App` quand une page s'ouvre ; rien n'est stocké (ni URL, ni stockage du navigateur).
- Ordre du moteur avec filtres : fold-in (gardé) → scores (gardés) → exclusions (+ films qui ne passent pas les filtres) → vivier par cran (γ·q, bonus des classiques) → calibration (cible filtrée si un genre est choisi) → plafond des films estimés → 48 films par cran → explications, séries.

### D9. Textes (Claude Web)

- Les textes nouveaux passent par `web/src/content/` (`pending()` jusqu'à ce que Claude Web les rédige) :
  - « comment ça marche » : la section `#curseur` devient **les catégories** (trois catégories, un plafond chacune, « moins de 2 000 notes ») ; nouvelle section **« affiner »** (filtres, recalcul, calibration qui suit le genre choisi) ; une phrase sur **« des films de… »** et une sur le **téléchargement** (fichier fabriqué chez toi, rien n'est envoyé) ;
  - « on garde rien » : une phrase sur le CSV (fabriqué dans ton navigateur) si Claude Web le juge utile.
  Ces textes-là arrivent à l'arrêt de U6.
- **Textes déjà rédigés par Claude Web** (17 novembre 2026), posés tels quels en U1 (U4 pour la recherche) :
  - sans filtre, plus aucun film : « plus rien ici : essaie « les valeurs sûres ». » (remplace « plus rien à ce cran-là : essaie un peu plus à gauche. ») ;
  - `FAR_ROWS_NOTE` : « (ici, on s'éloigne un peu de tes goûts : c'est le prix des vraies pépites) » ;
  - recherche sans film non vu : « t'as déjà vu tous ses films qu'on connaît. » ;
  - `titlePhrase` à ∞ (et ≥ 10 000) : « voilà des valeurs sûres qui devraient te plaire. » (cohérent avec le nom de la catégorie ; à ∞ il n'y a pas que des classiques) ; **modifie** é5 D5 ; tests de `titlePhrase` mis à jour.
- Les textes donnés par Thibault dans cette spec (libellés, sous-libellés, messages) sont posés tels quels.

---

## 4. Sous-étapes

### U0 — Mesures — **arrêt** avec les chiffres

1. **D7** : scores médians des 8 premiers (∞, 2 000, 500) avec et sans le bonus, sur B (ou A) ; recouvrement des 10 premiers à ∞ entre A, B et l'exemple, avec et sans le bonus. Si le bonus fait nettement baisser 2 000 ou 500 : proposition « bonus de ∞ à 10 000 seulement ».
2. **Durée et langue** : couverture de `runtime` et de `original_language` dans le cache (films entraînés, films estimés, recommandables) ; répartition dans les 3 tranches de durée et les 8 époques ; langues avec ≥ 30 films recommandables, et codes que `Intl.DisplayNames('fr')` ne sait pas nommer.
3. **Acteurs** : nombre d'acteurs gardés (5 premiers rôles, ≥ 3 films), nombre de paires film-acteur, personnes par identifiant (réalisateurs et acteurs, une personne des deux rôles comptée une fois), **noms affichés qui correspondent à plus d'un identifiant** ; **taille** de `catalog.json` v4 avec et sans acteurs (gzip niveau 9, même sérialisation que `site_catalog.py`), avec des **noms factices de longueur réaliste** pour les acteurs (longueurs tirées de celles des réalisateurs), et total de `web/public/data/`. **Arrêt avant les ~10 000 appels** (feu vert de Thibault).
4. **Temps d'un recalcul filtré prototypé** (script de mesure, hors interface) : moteur avec fold-in gardé, sur l'export A et l'export de 3 000 films ; filtres : un genre, une époque, genre + langue, sans documentaires ; médiane de 21.
- **Rien n'est régénéré** en U0 (`catalog.json`, `embeddings.bin`, `popularity.bin`, `model-meta.json` intacts : entrées du test de l'étape 8, Q1) ; les mesures de taille se font sur une copie en mémoire.
- Résultats en section 5 ; commit, push, **arrêt**. Ensuite : décision sur le bonus, **test unique et clôture de l'étape 8**, puis U1.

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

- Appels `/person/{id}` (après le feu vert de U0), cache `person/` (`{id, name}` seulement), `slim_full` avec `{id, name}` pour le cast (sans relancer la collecte, lecteurs compatibles avec les deux formes) ; `people`, `director_ids`, `cast` dans `catalog.json` v4, index des noms côté web (homonymes : années des films), `PersonSearch` (combobox), message `person`, grille de la personne, « revenir à tes recos ».
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
| Taille | `web/public/data/` ≤ 4,0 Mo gzip au total (v0.3 : plus de plafond séparé pour les acteurs) |
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

### U0 — Mesures (17 novembre 2026) — ⏸ arrêt : trois décisions

Scripts : `pipeline/ux_diagnostics.py measure` (cache TMDB, tailles en mémoire) et `web/scripts/ux-measure.ts` (`classics`, `filters`). Comptes, scores et temps seulement. **Rien n'a été régénéré** : `web/public/data/` est inchangé (fichiers du 14 novembre), et aucun appel TMDB n'a été fait.

**1. Bonus des classiques aux crans 2 000 et 500 (D7)**

Score relatif médian des 8 premiers films, avec le bonus / sans le bonus (`?classiques=0`) :

| export | ∞ | 2 000 | 500 | films sous 0,04 dans les 8 premiers (∞ / 2 000 / 500), avec / sans | films communs avec / sans, sur 48 (∞ / 2 000 / 500) |
|---|---|---|---|---|---|
| A | 1,104 / 1,115 | 0,161 / 0,161 | 0,040 / 0,040 | 0·0·4 / 0·0·4 | 44 · 48 · 48 |
| B | 1,116 / 1,116 | 0,230 / 0,230 | 0,083 / 0,083 | 0·0·0 / 0·0·0 | 44 · 46 · 46 |
| exemple | 1,226 / 1,226 | 0,313 / 0,313 | 0,108 / 0,108 | 0·0·0 / 0·0·0 | 44 · 48 · 48 |

- Recouvrement des 10 premiers à ∞ (films communs par paire) : avec le bonus, A-B **1**, A-exemple **2**, B-exemple **0** ; sans le bonus, 0, 2, 0. Les listes à ∞ restent personnelles.
- **Le seuil de Q7 n'est pas atteint.** À 2 000 et à 500, les médianes sont identiques, aucun film de plus ne passe sous 0,04, et 46 à 48 films sur 48 sont les mêmes. Le bonus n'agit vraiment qu'à ∞ (4 films sur 48). → **Proposition : garder le bonus à tous les crans** (aucun changement de `model-meta.json`).

**2. Durée et langue (D5)**

- `runtime` connu : 22 957 / 23 019 films entraînés et 3 348 / 3 358 films estimés. Parmi les **recommandables** : 22 951 / 22 968 et 559 / 559 (17 sans durée).
- Tranches (recommandables) : moins d'1h40 **11 480** · 1h40 à 2h15 **10 498** · plus de 2h15 **1 532** · inconnue 17.
- Époques (recommandables) : avant 1960 1 849 · 60 1 057 · 70 1 256 · 80 2 106 · 90 3 362 · 2000 5 298 · 2010 6 721 · 2020 1 878.
- `original_language` connue : 22 966 / 22 968 recommandables entraînés et 559 / 559 estimés ; **77** codes au total, **25** langues avec ≥ 30 films recommandables (anglais 17 756 … hongrois et thaï 30). Un seul code que `Intl.DisplayNames('fr')` ne nomme pas : **`cn`** (147 films, cantonais chez TMDB), d'où la table de secours de D3.
- Genre « IMAX » : 185 films recommandables (hors du filtre, Q3).
- Pour la durée et la langue seules, `catalog.json` prend **+39 596 octets gzip**.

**3. Personnes (D4, D5)**

- Réalisateurs : **11 772** identifiants TMDB distincts. **23 noms affichés** correspondent à plusieurs identifiants (46 identifiants en tout). Les homonymes des acteurs ne se comptent qu'avec leurs vrais noms (après les appels).
- Acteurs gardés (5 premiers rôles, ≥ 3 films) : **10 018**, dont 739 sont aussi réalisateurs, soit **21 051 personnes** et **82 506 paires** film-acteur.
- Listes de réalisateurs du cache `full/` comparées à `catalog.json` `directors` : 465 films diffèrent (**451 par l'ordre seulement**, 11 différents, 2 inclus l'un dans l'autre, 1 sans fiche). `director_ids` sera donc tiré de la même source que `directors` (fiches `movie/` de `enrich_tmdb.py`), à vérifier en U4 par `catalog-verify`.

**Taille de `catalog.json` v4** (gzip niveau 9, même sérialisation que `export.py`, noms d'acteurs **factices**, formés de prénoms et de noms de réalisateurs mélangés). Aujourd'hui : v3 **1 407 265**, total de `web/public/data/` **3 627 954** (3,63 Mo). Tous les écarts ci-dessous comprennent la durée et la langue (+39,6 Ko).

| forme | acteurs | écart gzip | total `web/public/data/` | +250 Ko | ≤ 4,0 Mo |
|---|---|---|---|---|---|
| réalisateurs seuls, `people` avec identifiants, `directors` gardé | 0 | +238 365 | 3 866 319 | ✓ | ✓ |
| **décision (5 rôles, ≥ 3 films)**, `people` = `[id, nom]`, `directors` gardé | 10 018 | **+527 995** | 4 155 949 | ✗ | ✗ |
| même chose, `people` = noms seuls | 10 018 | +451 140 | 4 079 094 | ✗ | ✗ |
| même chose, **sans doublon** (`directors` reconstruit par le site), noms seuls | 10 018 | **+272 669** | 3 900 623 | ✗ (de 23 Ko) | ✓ |
| sans doublon, `[id, nom]` | 10 018 | +349 730 | 3 977 684 | ✗ | ✓ |
| sans doublon, noms seuls, **5 rôles, ≥ 4 films** | 7 167 | **+230 172** | 3 858 126 | ✓ | ✓ |
| sans doublon, noms seuls, 5 rôles, ≥ 5 films | 5 563 | +203 104 | 3 831 058 | ✓ | ✓ |
| sans doublon, noms seuls, 3 rôles, ≥ 3 films | 6 105 | +169 686 | 3 797 640 | ✓ | ✓ |
| sans doublon, réalisateurs seuls | 0 | +14 434 | 3 642 388 | ✓ | ✓ |

- Pourquoi c'est lourd : avec `directors` gardé, chaque nom de réalisateur est écrit deux fois (dans `directors` et dans `people`). « Sans doublon » veut dire que le fichier ne garde plus que `people` + `director_ids`, et que `loadEngine` reconstruit `catalog.directors` (noms) en mémoire, si bien que le code existant (profil, tag « encore un… ») ne change pas. Les identifiants TMDB eux-mêmes ne servent pas au site : l'indice dans `people` suffit à séparer deux homonymes (Q2).
- **La décision (5 rôles, ≥ 3 films) dépasse +250 Ko sous toutes les formes** : arrêt prévu par D4.

**4. Temps d'un recalcul filtré (prototype, D2)**

Fold-in gardé. Le prototype enchaîne les étapes du moteur : exclusions + filtre, viviers, γ·q et bonus, calibration (cible filtrée pour un genre), plafond des films estimés, explications. Médiane de 21, en ms (part des explications entre parenthèses) :

| | sans filtre | horreur | années 70 | drame + français | sans documentaires |
|---|---|---|---|---|---|
| export A, comme D2 (explications des 8 crans) | 44,6 (15,0) | 24,3 (13,2) | 26,0 (10,6) | 24,5 (9,5) | 42,7 (15,1) |
| 3 000 films, comme D2 | 175,7 (149,7) | **128,2** (109,8) | **96,9** (82,8) | **100,7** (85,0) | **171,3** (146,8) |
| export A, variante | 32,7 (1,4) | 20,1 (7,9) | 22,0 (7,6) | 18,0 (5,5) | 31,3 (1,5) |
| 3 000 films, variante | 54,8 (25,6) | 76,1 (61,3) | 69,5 (55,6) | 76,4 (61,1) | 44,8 (21,1) |

- Le prototype sans filtre reproduit `recommend` à l'identique (8 crans). Chaque cran garde 48 films. Pour l'horreur sur l'export A, le fold-in ne compte que 9 films du genre, donc λ = 0 (seuil de 10).
- **Comme D2, le critère échoue sur 3 000 films** (97 à 171 ms). Ce sont les **explications** qui coûtent : 83 à 150 ms. Sans elles, le recalcul prend 14 à 26 ms.
- **Variante mesurée**, qui garde le recalcul de D2 : on n'explique que les films des **3 crans des catégories** (∞, 2 000, 500 ; les 8 avec `?crans=8`, en dev), et le worker **garde en cache** les explications déjà calculées (elles dépendent de l'historique, jamais des filtres). On obtient **18 à 33 ms sur l'export A et 45 à 76 ms sur 3 000 films** : critère atteint, sans passer au repli de D2.
- Pour comparer, la recommandation de départ (fold-in + 8 crans + explications) prend aujourd'hui 51 à 63 ms sur l'export A et 200 ms sur 3 000 films. Avec la même variante, elle descendrait d'autant.

**Décisions demandées à Thibault** (tranchées le 17 novembre 2026, voir plus bas)

1. **Bonus des classiques** : on le garde à tous les crans (proposé : le seuil de Q7 n'est pas atteint). Ensuite viennent le test unique et la clôture de l'étape 8 (Q1).
2. **Acteurs**, la décision dépassant le budget. Options :
   - **(a) recommandé** : sans doublon, noms seuls, **5 rôles et ≥ 4 films**, soit +230 Ko et 7 167 acteurs (~7 200 appels `/person` au lieu de ~10 000). Un acteur qui n'a que 3 films dans le catalogue, souvent déjà vus, donne une grille presque vide ;
   - **(b)** garder la décision (5 rôles, ≥ 3 films), sans doublon, et porter le budget à **+275 Ko** : total 3,90 Mo, sous les 4,0 Mo ;
   - **(c)** 3 rôles et ≥ 3 films, sans doublon : +170 Ko, 6 105 acteurs.

   Toutes ces options demandent de **ne plus écrire `directors` dans le fichier** (le site le reconstruit, le code existant ne change pas) : c'est un écart à « la colonne `directors` reste telle quelle », d'où la question. Les appels `/person` attendent le feu vert, une fois l'option choisie.
3. **Explications** : passer, dans le recalcul **et** dans la recommandation de départ, aux explications des 3 crans des catégories avec un cache par film dans le worker (proposé). C'est le seul moyen mesuré de tenir les 100 ms sur 3 000 films sans le repli de D2.

### U1 — Catégories (17 novembre 2026)

- `web/src/pages/categories.ts` : seule table des trois catégories (nom, sous-libellé, cran, morceau du nom de fichier). Une catégorie dont le cran manque dans `model-meta.json` est masquée (test).
- `CategoryPicker` : `<fieldset>` + `<legend>` « plutôt connu ou plutôt pépite ? », trois `<input type="radio">` visuellement masqués et le `<label>` comme bouton (≥ 44 px, retour à la ligne sur téléphone). Choix courant : bordure encre et nom souligné au stylo bleu, anneau de focus `has-[:focus-visible]`. Départ sur « les moins connus ».
- Région `aria-live` : « les pépites : 8 films ». `titlePhrase`, les tags, le tampon et « loin de tes goûts » ne changent pas ; le moteur calcule toujours les 8 crans.
- `?crans=8` (`devTuning.ts`, `Tuning.allNotches`, bandeau « curseur à 8 crans ») : l'ancien curseur (`Slider.tsx`, gardé), en dev seulement.
- Textes de Claude Web posés : `titlePhrase` à ∞ et ≥ 10 000 « voilà des valeurs sûres qui devraient te plaire. » ; `FAR_ROWS_NOTE` « (ici, on s'éloigne… » ; `NOTHING_HERE` « plus rien ici : essaie « les valeurs sûres ». ».
- Tests : Vitest **304** (dont groupe de trois radios, sous-libellés, liste par catégorie, annonce, catégorie masquée, « plus rien ici », `?crans=8`). Les tests des règles qui demandent un cran quelconque (« loin de tes goûts », tampon par cran…) passent par le curseur à 8 crans (`allNotches`). Playwright **13/13** : catégories aux **flèches du clavier natives**, une première carte différente par catégorie, la catégorie gardée à l'ouverture d'une page, tags « au plus 2 par rangée » sur les trois catégories, mise en page et axe dans les deux thèmes ; **changement de catégorie : médiane 33 ms** (max 37) ; modèle prêt 740 ms, analyse 11 ms. `typecheck`, `lint`, `format:check` verts.

### U2 — Recalcul filtré et calibration (17 novembre 2026)

- **Moteur** : `recommend` est découpé en `userProfile` (fold-in, scores, exclusions, candidats sans filtre, base du score relatif) et `recommendFrom` (filtre, viviers, γ·q et bonus des classiques, calibration, plafond des films estimés). `recommend` = l'un puis l'autre, donc les listes sans filtre sont identiques (`foldin_cases.json` rejoué, test « sans filtre = `recommend` » sur les vrais fichiers). Avec un filtre, les films qui ne passent pas sont exclus **avant** le vivier, la base du score relatif reste celle **sans filtre** (`topByPosition(…, base)`), et la cible de calibration suit les genres choisis. Si le fold-in compte moins de `MIN_GENRE_FOLDIN` = 10 films de ces genres, λ = 0.
- `web/src/reco/filters.ts` : `Filters`, `compileFilters` (OU dans une section, ET entre sections ; sans année, durée ou langue, un film ne passe aucun filtre de la section), `activeCount`, `sameFilters`, tranches `DECADES` et `DURATIONS`. Les champs v4 de `CatalogFile` (`language`, `languages`, `runtime`) sont optionnels jusqu'à U3.
- **Worker** : fold-in gardé entre deux requêtes (même historique ; réglages comparés **par valeur**, puisque `postMessage` en donne une copie à chaque message), et vidé par `import` et `confirm`. **Cache des explications** par film, avec `null` pour « aucune ». Explications calculées seulement pour les films des crans de `explainCaps` ; sans `explainCaps` (scripts), sur tous les crans, comme avant. `App` envoie les 3 crans des catégories, ou rien avec `?crans=8`.
- **Interface** : `ResultsView.filters` remplace `noDocs`. La case devient « les documentaires », cochée par défaut, et passe par le recalcul (la page ne filtre plus rien d'elle-même). Pendant un recalcul, la grille précédente reste avec `aria-busy="true"`. Seule la dernière demande compte : une réponse plus ancienne est ignorée (test). Changer un filtre remet la grille à 8 cartes. Avec des filtres et plus aucun film : « rien ne passe tous ces filtres ici. enlève-en un, ou essaie « les valeurs sûres ». ».
- **Temps** (`reco-bench`, explications des 3 crans affichés ; médiane de 21, et « première fois » = médiane de 7 juste après un import, donc sans cache pour les films filtrés) :

| historique | recommandation de départ | horreur | années 70 | drame + années 2000 | sans documentaires |
|---|---|---|---|---|---|
| export A (217 films) | 38-55 ms | 10,7 ms (1ʳᵉ fois 13,8) | 12,8 (18,0) | 16,4 (20,9) | 25,2 (23,2) |
| 3 000 films | 98-102 ms | 30,7 (**62,2**) | 27,3 (**59,2**) | 31,3 (**74,1**) | 35,1 (39,6) |

  **Critère atteint** : ≤ 100 ms en médiane, y compris la première fois (pire cas 74 ms sur 3 000 films). Pour comparer, avant U2, les explications des 8 crans prenaient 83 à 150 ms à elles seules (U0). Genre + langue se mesurera en U3, avec la langue dans `catalog.json`. Le temps sur un vrai téléphone se mesure à l'arrêt de U6.
- Tests : Vitest **317** (filtres purs ; vrais fichiers : sans filtre = `recommend`, chaque film affiché passe le filtre, 48 par cran, base inchangée, λ = 0 sous 10 films, cible suivie au-dessus ; worker : explications des seuls crans affichés, retour sans filtre identique, cache, `confirm` qui vide le fold-in gardé ; `App` : demande au worker, `aria-busy`, réponse périmée ignorée). Playwright **13/13**, changement de catégorie : médiane 33 ms. `typecheck`, `lint`, `format:check` verts.

### U3-U4 — Données : `catalog.json` v4 (17 novembre 2026)

Les données de U3 (durée, langue) et de U4 (personnes) sont faites en une seule régénération.

- `site_catalog.py` v4 : `languages` (77 codes, triés par nombre de films) + `language` (indice par film), `runtime` (minutes, connu pour **26 305 / 26 377** films), `people` (noms seuls, l'indice fait l'identité), `director_ids`, `cast`. **`directors` n'est plus écrit.** `site_columns` refuse des personnes qui ne redonnent pas les réalisateurs de la v3.
- Source unique : le cache TMDB de l'étape 8 (`full/`) et le cache `person/` (noms des acteurs), sans aucun appel. `people.py` : réalisateurs par identifiant, retrouvés par nom dans la liste de leur film (l'ordre du cache diffère pour 451 films). Un nom sans identifiant sur son film prend celui du même nom ailleurs s'il est unique ; sinon il a sa propre entrée (11 cas). Une personne réalisatrice et actrice = une entrée.
- `slim_full` garde `{id, name}` pour le cast, **sans relancer la collecte** ; `cast_id` lit les deux formes (`recent_films.py table`), test.
- **Taille réelle** (vrais noms) : `catalog.json` **1 686 050** octets gzip (v3 : 1 407 265, soit +278 785) ; **`web/public/data/` 3 906 719 octets gzip ≤ 4,0 Mo** avec la décision (5 rôles, ≥ 3 films) : le repli à ≥ 4 films (automatique dans `export.py catalog` au-delà de 4,0 Mo) n'a pas servi.
- Personnes : **21 051** (11 772 réalisateurs + 10 018 acteurs, dont 739 aussi réalisateurs), **82 506** paires film-acteur. **Homonymes** : **49** noms affichés correspondent à plusieurs personnes, dont **31** chez des acteurs ; aucun identifiant n'a deux noms.
- Contrôles : `export.py catalog --out web` puis `catalog-verify` (colonnes v4, indices valides, `directors` reconstruit = celui du catalogue, film par film) ; `export.py verify --out web` : 27 cas, 81 listes top 10 et **216 listes calibrées identiques**, écart des vecteurs 0 ; staging régénéré (`export.py catalog`). pytest **288** (dont `test_people.py` : ordre du cache, nom sans identifiant, homonymes = deux entrées, réalisateur-acteur = une entrée, seuil et premiers rôles, `/person` réduit à `{id, name}`), ruff vert.
- Site : `web/src/reco/catalogFile.ts` (`parseCatalog`) **refuse un fichier v3** (« catalog.json v3 : il faut la v4 (relancer export.py catalog) », message habituel de moteur indisponible à l'écran) et reconstruit `directors`. Utilisé par `loadEngine`, `match-report` et `spectacles`. Test d'identité sur une **fixture synthétique** (versionnée) et sur le **catalogue réel** contre une copie v3 gardée dans `web/test-data/catalog_v3.json` (ignoré) : **0 film différent**. Vitest **320**.

**Noms des acteurs** (D4, appels lancés pendant U1) : `pipeline/people.py fetch`. **10 018** acteurs gardés, **10 018** appels `/person/{id}` en 501 s, aucun nouvel essai, **aucun nom manquant** ; cache `data/cache/tmdb/person/` réduit à `{id, name}`. Avant les appels, `people.py stats` a vérifié que les noms des réalisateurs reconstruits depuis `people` + `director_ids` sont **identiques à ceux de la v3 pour chaque film** (11 noms sans identifiant sur leur film ont leur propre entrée). Taille réelle et homonymes chez les acteurs : en U4.

**Réponses de Thibault et de Claude Web (17 novembre 2026, v0.3)**

1. Bonus des classiques gardé à tous les crans ; `model-meta.json` inchangé. Test unique et clôture de l'étape 8 : déjà faits avec ce réglage (commit `e7d4384` du 17 novembre 2026, tous les critères tenus) ; rien n'a été relancé (le test ne s'évalue qu'une fois).
2. Acteurs : option (b) sans doublon (5 rôles, ≥ 3 films) ; règle de taille ramenée à `web/public/data/` ≤ 4,0 Mo gzip ; repli automatique à ≥ 4 films si les vrais noms dépassent ; `directors` reconstruit par le site, test d'identité avec la v3 ; feu vert pour les appels `/person/{id}`.
3. Explications des crans affichés seulement, avec un cache dans le worker (départ, recalcul, « des films de… ») ; 8 crans avec `?crans=8`.

---

## 6. À reporter

- **Rafraîchissement mensuel** (GitHub Actions, étape 7) : il doit aussi rafraîchir la durée, la langue et les acteurs ; `slim_full` garde désormais `{id, name}` pour le cast (Q2), donc les fiches rafraîchies porteront les noms et le cache `person/` deviendra inutile pour elles.
- **Filtre par pays** (idée de la feuille de route) : `origin_country` est dans le cache ; pas au MVP de 8b.
- **Filtres dans l'URL** (lien partageable « mes pépites d'horreur des années 70 ») : rien n'est stocké aujourd'hui, l'URL ne contient pas l'historique ; à rediscuter.
- **Calibration selon l'époque ou la langue choisie** (Q4) : si l'essai montre des listes déséquilibrées.
- **Recherche par titre** (« et celui-là, il me plairait ? », idée de l'étape 8) : la combobox de D4 pourrait l'accueillir plus tard.
- **Seuils** : 30 films par langue, 3 films par acteur, 5 premiers rôles, tranches de durée : à revoir avec les volontaires.
- **Page à imprimer « ton fanzine de recos »** (idée, feuille de route, à la clôture).

---

## 7. Questions pour la validation — tranché (Thibault, 17 novembre 2026)

1. **Q1 — D7 et le test de l'étape 8** : D7 se tranche en U0 (arrêt avec les chiffres). Ordre : U0 → décision de Thibault sur le bonus → test unique de clôture de l'étape 8 avec le réglage retenu (clôture complète de l'étape 8 : section 5, documents, `contexte/`) → U1. En U0, aucune régénération de `catalog.json`, `embeddings.bin`, `popularity.bin` ni `model-meta.json`, sauf le bonus si Thibault le décide. → en-tête, U0, D7.
2. **Q2 — Noms des acteurs** : **option (a)**, pas (b) : une collecte forcée réécrirait le cache qui sert à placer les films estimés (votes, mots-clés, distribution ont bougé chez TMDB) et changerait les vecteurs de l'étape 8 avant son test. Un appel `/person/{id}` par acteur gardé (~10 000), cache `data/cache/tmdb/person/` réduit à `{id, name}` ; `slim_full` garde `{id, name}` pour le cast sans relancer la collecte (rafraîchissement mensuel, section 6) ; taille mesurée d'abord avec des noms factices, appels après le feu vert. **Homonymes** : table `people` par identifiant TMDB (réalisateurs et acteurs), `director_ids` en parallèle de `directors` (inchangée) ; années des films dans la suggestion en cas d'homonymes ; compte en U0. → D4, D5, U0, U4.
3. **Q3 — « IMAX »** : hors du filtre des genres (il reste dans les données et la calibration). → D3.
4. **Q4 — Cible de la calibration** : seul un genre choisi la change ; époque, durée, langue et documentaires gardent la cible de tout l'historique ; à revoir à l'essai (section 6). → D2.
5. **Q5 — Recherche « des films de… »** : pas de « loin de tes goûts » ; tri par **`score'`** (γ·q et bonus des classiques) ; pas de plafond des films estimés ; ni « ✱ pépite » ni « parce que t'as aimé » sur un film estimé. → D4.
6. **Q6 — Version de `catalog.json`** : v3 refusée côté web, message habituel. → D5.
7. **Q7 — Seuil de D7** : baisse de plus de 10 % de la médiane des 8 premiers, ou un film de plus sous 0,04 dans la première rangée, à 2 000 ou à 500. → D7.

D8 et D9 validées ; quatre textes de Claude Web posés (D9), les autres à l'arrêt de U6.
