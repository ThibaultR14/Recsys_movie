# Feuille de route

> Mise à jour le 12 novembre 2026, à la clôture de l'étape 6c. Ordre des étapes : `docs/stack-technique.md` §8.
> Renvois : `é2` à `é6` = `docs/etape-2-modele.md`, `docs/etape-3-letterboxd.md`, `docs/etape-4-navigateur.md`, `docs/etape-5-interface.md`, `docs/etape-6-imdb.md`, `é6b` = `docs/etape-6b-retouches.md`, `é6c` = `docs/etape-6c-qualite.md` (§6 = « À reporter » ou questions ouvertes).

## En cours : tags des cartes (après l'étape 6c)

L'étape 6c (qualité des résultats) est close le 12 novembre 2026 (`é6c` v0.6) : versions, films mal notés hors du fold-in, calibration des genres (λ par cran), pénalité D1b écartée, test évalué une fois, textes de « comment ça marche ».

1. ✅ **Tags des cartes** (Q6, sections 5 et 8 de la spec 6c) : **faits et validés à l'écran** le 12 novembre 2026 : un tag par carte (✱ pépite > encore un <réalisateur> > ça divise > vieux trésor), une couleur par tag, 2 au plus par rangée de 8, `catalog.json` `divisive` (2 302 films), section « les tampons ». Reste : essai sur un vrai téléphone (Suivi).

## Ensuite : étape 7, mise en ligne et volontaires

L'étape 6b (retouches de l'interface) est close le 8 novembre 2026 (`docs/etape-6b-retouches.md` v0.4) : thème sombre, pages par ancre, contact, aide des exports, note du public, explications, site élargi, « loin de tes goûts » par rangée. **À faire en premier** : l'essai sur un vrai téléphone, non confirmé à la clôture.

L'étape 6 (adaptateur IMDb) est close et relue le 8 novembre 2026 (`é6`). L'étape 7 reste **bloquée par la réponse de GroupLens** pour la mise en ligne ; les tests avec des volontaires peuvent se préparer en local.

Historique de l'étape 6 : Spec `docs/etape-6-imdb.md` v0.2 **validée** le 8 novembre 2026 (repli par titre toujours dans « à vérifier »). G1-G3 faits sur fixtures synthétiques. G0 fait sur un export IMDb fabriqué par Thibault : `Title Type` est traduit dans la langue du compte (`Film`, `Série télévisée`) ; corrigé en **v0.3** (repli refusé seulement aux types non-films connus, anglais et français ; type inconnu = film). Second export (libellé `Épisode télévisé` ajouté) et watchlist réelle (bien détectée comme liste) traités. Libellés de mini-série et de jeu ajoutés comme probables, non vérifiés. G4 : rapport de bout en bout seulement, mesure des taux reportée à l'étape 7. G5 : clôture.

## Étapes restantes

### 7. Mise en ligne et tests avec 10 à 20 cinéphiles

- **Objectif** :
  - publier le site sur Cloudflare Pages ou GitHub Pages ;
  - lancer le rafraîchissement mensuel des métadonnées TMDB par GitHub Actions ;
  - faire tester par 10 à 20 volontaires, avec la question clé : « combien de ces films ne connaissais-tu pas et as-tu envie de voir ? ».
- **Dépendances** :
  - **la réponse de GroupLens**, bloquante pour la mise en ligne et le versionnement de `web/public/data/` ;
  - la clé TMDB dans les secrets GitHub ;
  - les étapes 5 et 6.
- **Questions ouvertes** :
  - hébergeur (Cloudflare ou GitHub Pages) et nom de domaine ;
  - nom définitif du site ;
  - forme du retour des volontaires : lien « dis-nous si on s'est planté », formulaire, ou boutons « ça me tente / pas pour moi » sans stockage côté serveur ;
  - cache du modèle (IndexedDB ou cache HTTP seul) ;
  - en-têtes de cache et de sécurité de l'hébergeur ;
  - que faire si GroupLens refuse ou impose des conditions.

### 8. Ensuite

- **Fiche film** : retirée de l'étape 5. Pour l'instant, la carte renvoie vers Letterboxd. Il faut choisir le contenu (résumé TMDB ? casting ? films proches ?) et vérifier ce que TMDB permet d'embarquer.
- ✅ **Explications** : avancées à l'étape 6b (« parce que t'as aimé X et Y », `é6b` D6). Reste pour plus tard : l'explication exacte de l'ALS (contributions du fold-in), à voir avec la fiche film.
- **Dispo en France** : à partir des *watch providers* TMDB (région FR), précalculés chaque mois et ajoutés à `catalog.json`. Il faut vérifier les conditions TMDB et l'attribution JustWatch.
- **Listes faites main** : texte libre rapproché par Fuse.js, puis une IA via un Cloudflare Worker avec une limite d'usage. À trancher : coût, garde-fous, et ce qu'on envoie à l'API (des titres, jamais rien de personnel).
- **Scraping Letterboxd par pseudo** : option secondaire seulement, puisque c'est contraire aux conditions de Letterboxd. Il faudrait un Worker, à cause de CORS.
- **Autres imports** : SensCritique, Trakt, Criticker, un adaptateur chacun.

## Points « à reporter » des specs, par étape cible

### Suivi de l'étape 6c

- **Essai sur un vrai téléphone de la version 6b** : **fait, OK** (Thibault, 12 novembre 2026).
- **Essai sur un vrai téléphone de la version 6c** (équilibre des genres, tags des cartes, deux thèmes) : à faire par Thibault.
- **μ de D1b** et **λ des crans bas** : à recaler avec les volontaires (voir « Étape 7 »).

### Suivi de l'étape 6

- Ids inventés `tt99000001`-`tt99000005` de `imdb-exemple.csv` : à revérifier de temps en temps, IMDb pourrait les attribuer un jour (`é6` §6).

### Étape 7 (mise en ligne, volontaires)

- **λ des crans bas** (0,9) et **μ** de D1b (option a en Q4b : pénalité non branchée, référence prête) : à recaler avec la question des volontaires, vraie mesure aux crans bas (`é6c` §6).
- **Seuil de retrait du fold-in** (percentile 0,3) : à recaler avec les volontaires (`é6c` §6).

- **Essai sur un vrai téléphone** de la version 6b (deux thèmes, mise en page élargie, annotation « loin de tes goûts » par rangée) : non confirmé à la clôture (`é6b` §6).
- **Seuil « loin de tes goûts » par rangée** (0,04, moitié d'une rangée de 8) : à recaler avec les volontaires (`é6b` R10).

- **Seuil « loin de tes goûts »** (0,04) : le recaler d'après la distribution des scores relatifs par cran et le ressenti des volontaires (`é5` §6).
- **Tampon « ✱ pépite »** : il est visible à ∞ mais presque jamais aux crans bas, parce que le plafond resserre les popularités. Il faudra peut-être un seuil plus doux, par exemple deux tiers de la médiane (`é5` §6, G6).
- **Correspondance sur les exports des volontaires** : mêmes taux qu'à l'étape 3, en particulier la précision de `probable_variant`, qui n'avait aucun cas dans le premier export. Taux seulement, fichiers supprimés ensuite (`é3` §6).
- **Correspondance IMDb sur un vrai historique** (si aucun proche n'a fourni d'export avant) : reconnus par id, échecs, précision par id, part d'homonymes parmi les candidats par titre ; taux seulement (`é6` §6). L'export de Thibault (42 titres, fabriqué) ne suffit pas.
- **Libellés français probables de `Title Type`** (« Mini-série télévisée », « Jeu vidéo », non vérifiés) et autres langues de compte : à vérifier sur les exports IMDb des volontaires (`é6` §6).
- **Évaluation sur de vrais historiques Letterboxd** : les exports des volontaires, sans dataset scrapé (`é2` §6).
- **Formulaire de retour** derrière « dis-nous si on s'est planté » (`é5` D5).
- **Cache du modèle** : IndexedDB éventuellement (`é4` D1).
- **Changement de cran** : critère sur la médiane depuis l'étape 6b (33 ms ; pire cas 36-54 ms sur une machine chargée, journalisé). À surveiller sur les téléphones des volontaires (`é6b` R6).
- **Seuils des explications** (percentile ≥ 0,7, cosinus > 0, 2 cartes par film cité et par rangée) : à recaler avec les retours des volontaires (`é6b` §6, Q4).
- **Contact** : le formulaire `mailto:` de l'étape 6b peut servir de retour des volontaires ; à décider avec la forme du retour (`é6b` §6).

### Plus tard (pipeline, données)

- **Mention « spectacle »** (stand-up) : la refaire avec les genres ou mots-clés TMDB, via un champ ajouté par `enrich_tmdb.py` puis `catalog.json`. La règle sur les titres est écartée (`é5` §6).
- **Seuil ≥ 10 notes** (catalogue plus grand) : optionnel, pas fait (`é2` D9).
- Pas de réentraînement périodique : MovieLens 32M est figé. Seules les métadonnées TMDB sont rafraîchies (`é2` §6).

## Idées « plus tard »

- **Films sortis après 2023** : un modèle de contenu (genres, mots-clés, réalisateur, résumé TMDB, éventuellement des embeddings de texte calculés hors ligne) pour combler le trou de MovieLens. Aujourd'hui, ces films sont seulement signalés.
- **Enrichissement des genres TMDB** : pour les spectacles, de meilleurs filtres et la calibration.
- **Recalage avec les volontaires** : seuil « loin de tes goûts » et tampon « ✱ pépite » (voir plus haut).
- **Feedback « ça me tente / pas pour moi »** sur les cartes : il mesure la qualité perçue. Il faut une solution sans compte ni données personnelles.
- **Blocage** d'un film recommandé, pour qu'il ne revienne pas. Il faudrait un stockage local, donc une décision.
- **Calibration** : respecter les proportions du profil (genres, décennies, pays).
- **Filtres** : durée, décennie, pays, langue, genre.
- **« Comme ce film »** : partir d'un seul film. **Partir d'une liste ou d'une watchlist.**
- **Profil cinéphile façon « Wrapped »** : réalisateurs, pays, décennies, part de pépites.
- **Mode à deux** : fusionner deux historiques.
- **Transition douce** près du plafond du curseur.
- **Modèle séquentiel** (SASRec, ONNX Runtime Web) qui tient compte de l'ordre du journal.
- **« Quel abonnement prendre pour voir ma watchlist ? »**, une suite de la dispo en France.
